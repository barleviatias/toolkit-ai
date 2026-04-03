import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type { Source, SourcesConfig, CatalogEntry } from '../types.js';
import { SOURCES_FILE, CACHE_DIR } from './platform.js';
import { ensureDir } from './fs-helpers.js';
import { parseFrontmatter, hashDir, hashFile } from './catalog.js';

function loadDefaultConfig(): SourcesConfig {
  // Load defaults from resources/sources.json (bundled with the package)
  const bundledPath = path.join(__dirname, '..', 'resources', 'sources.json');
  try {
    return JSON.parse(fs.readFileSync(bundledPath, 'utf8')) as SourcesConfig;
  } catch {
    return { sources: [], cacheTTL: 86400 };
  }
}

// ---------------------------------------------------------------------------
// Parse source input — accepts URLs, owner/repo, or shorthand
// ---------------------------------------------------------------------------

export function parseSourceInput(input: string): Source {
  let repo: string;
  let type: Source['type'] = 'github';

  // Full URL: https://github.com/owner/repo or https://bitbucket.org/owner/repo
  const urlMatch = input.match(/^https?:\/\/(github\.com|bitbucket\.org)\/([^/]+\/[^/.]+)/);
  if (urlMatch) {
    type = urlMatch[1] === 'bitbucket.org' ? 'bitbucket' : 'github';
    repo = urlMatch[2];
  }
  // SSH: git@github.com:owner/repo.git or git@bitbucket.org:owner/repo.git
  else if (input.match(/^git@/)) {
    const sshMatch = input.match(/git@(github\.com|bitbucket\.org):([^/]+\/[^/.]+)/);
    if (sshMatch) {
      type = sshMatch[1] === 'bitbucket.org' ? 'bitbucket' : 'github';
      repo = sshMatch[2];
    } else {
      repo = input;
    }
  }
  // owner/repo shorthand (default to github)
  else {
    repo = input.replace(/\.git$/, '');
  }

  const name = repo.split('/').pop() || repo;
  return { name, type, repo };
}

// ---------------------------------------------------------------------------
// Sources config CRUD
// ---------------------------------------------------------------------------

export function loadSources(): SourcesConfig {
  try {
    return JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')) as SourcesConfig;
  } catch {
    return loadDefaultConfig();
  }
}

export function saveSources(config: SourcesConfig): void {
  ensureDir(path.dirname(SOURCES_FILE));
  fs.writeFileSync(SOURCES_FILE, JSON.stringify(config, null, 2));
}

export function addSource(source: Source): void {
  const config = loadSources();
  const existing = config.sources.findIndex(s => s.name === source.name);
  if (existing >= 0) {
    config.sources[existing] = source;
  } else {
    config.sources.push(source);
  }
  saveSources(config);
}

export function removeSource(name: string): void {
  const config = loadSources();
  config.sources = config.sources.filter(s => s.name !== name);
  saveSources(config);
}

// ---------------------------------------------------------------------------
// Fetch and cache external sources
// ---------------------------------------------------------------------------

function getCacheDir(source: Source): string {
  return path.join(CACHE_DIR, source.name);
}

function isCacheStale(source: Source, ttl: number): boolean {
  const marker = path.join(getCacheDir(source), '.fetched');
  try {
    const stat = fs.statSync(marker);
    const age = (Date.now() - stat.mtimeMs) / 1000;
    return age > ttl;
  } catch {
    return true; // no marker = never fetched
  }
}

function fetchSource(source: Source): void {
  if (source.type !== 'github' && source.type !== 'bitbucket') return;

  const cacheDir = getCacheDir(source);
  const host = source.type === 'bitbucket' ? 'bitbucket.org' : 'github.com';
  const repoUrl = `https://${host}/${source.repo}.git`;

  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  ensureDir(cacheDir);

  const result = spawnSync('git', ['clone', '--depth', '1', '--single-branch', repoUrl, cacheDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000,
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || 'unknown error';
    throw new Error(`Failed to fetch ${source.repo}: ${stderr}`);
  }

  fs.writeFileSync(path.join(cacheDir, '.fetched'), new Date().toISOString());
}

/** Force-refresh one or all sources (re-clone from remote) */
export function refreshSources(sourceName?: string): { name: string; ok: boolean; error?: string }[] {
  const config = loadSources();
  const targets = sourceName
    ? config.sources.filter(s => s.name === sourceName)
    : config.sources.filter(s => s.type === 'github' || s.type === 'bitbucket');

  const results: { name: string; ok: boolean; error?: string }[] = [];
  for (const source of targets) {
    try {
      fetchSource(source);
      results.push({ name: source.name, ok: true });
    } catch (e: any) {
      results.push({ name: source.name, ok: false, error: e.message });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Scan a cached source for resources (skills, agents, MCPs)
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

function findSkillDirs(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }

    // Check if this directory itself contains a SKILL.md
    if (entries.some(e => e.isFile() && e.name === 'SKILL.md')) {
      results.push(current);
      return; // don't recurse into skill dirs
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(path.join(current, entry.name));
    }
  }

  walk(dir);
  return results;
}

function findAgentFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.agent.md')) {
        results.push(path.join(current, entry.name));
      } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        walk(path.join(current, entry.name));
      }
    }
  }

  walk(dir);
  return results;
}

function findMcpFiles(dir: string): string[] {
  const results: string[] = [];
  // Look for mcps/ directory with .json files, or *.mcp.json anywhere
  function walk(current: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }

    const isMcpsDir = path.basename(current) === 'mcps';

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json') && isMcpsDir) {
        results.push(path.join(current, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.mcp.json')) {
        results.push(path.join(current, entry.name));
      } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        walk(path.join(current, entry.name));
      }
    }
  }

  walk(dir);
  return results;
}

function scanSourceSkills(source: Source): CatalogEntry[] {
  const cacheDir = getCacheDir(source);
  if (!fs.existsSync(cacheDir)) return [];

  const skillDirs = findSkillDirs(cacheDir);
  const entries: CatalogEntry[] = [];

  for (const skillDir of skillDirs) {
    const skillMd = path.join(skillDir, 'SKILL.md');
    const meta = parseFrontmatter(fs.readFileSync(skillMd, 'utf8'));
    const dirName = path.basename(skillDir);

    entries.push({
      name: meta.name || dirName,
      description: meta.description || '',
      hash: hashDir(skillDir),
      path: path.relative(cacheDir, skillDir),
      source: source.name,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function scanSourceAgents(source: Source): CatalogEntry[] {
  const cacheDir = getCacheDir(source);
  if (!fs.existsSync(cacheDir)) return [];

  const agentFiles = findAgentFiles(cacheDir);
  const entries: CatalogEntry[] = [];

  for (const agentFile of agentFiles) {
    const meta = parseFrontmatter(fs.readFileSync(agentFile, 'utf8'));
    const fileName = path.basename(agentFile, '.agent.md');

    entries.push({
      name: meta.name || fileName,
      description: meta.description || '',
      hash: hashFile(agentFile),
      path: path.relative(cacheDir, agentFile),
      source: source.name,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function scanSourceMcps(source: Source): CatalogEntry[] {
  const cacheDir = getCacheDir(source);
  if (!fs.existsSync(cacheDir)) return [];

  const mcpFiles = findMcpFiles(cacheDir);
  const entries: CatalogEntry[] = [];

  for (const mcpFile of mcpFiles) {
    try {
      const config = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
      const fileName = path.basename(mcpFile, '.json');

      entries.push({
        name: config.name || fileName,
        description: config.description || '',
        hash: hashFile(mcpFile),
        path: path.relative(cacheDir, mcpFile),
        source: source.name,
      });
    } catch {
      // Skip malformed JSON
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

// ---------------------------------------------------------------------------
// Public: external resources (skills, agents, MCPs)
// ---------------------------------------------------------------------------

export interface ExternalResources {
  skills: CatalogEntry[];
  agents: CatalogEntry[];
  mcps: CatalogEntry[];
}

export function fetchExternalResources(forceRefresh = false): ExternalResources {
  const config = loadSources();
  const result: ExternalResources = { skills: [], agents: [], mcps: [] };

  for (const source of config.sources) {
    if (source.type !== 'github' && source.type !== 'bitbucket') continue;

    try {
      if (forceRefresh || isCacheStale(source, config.cacheTTL)) {
        fetchSource(source);
      }
      result.skills.push(...scanSourceSkills(source));
      result.agents.push(...scanSourceAgents(source));
      result.mcps.push(...scanSourceMcps(source));
    } catch {
      // Silently skip failed sources in TUI
    }
  }

  return result;
}

/** @deprecated Use fetchExternalResources instead */
export function fetchExternalSkills(forceRefresh = false): CatalogEntry[] {
  return fetchExternalResources(forceRefresh).skills;
}
