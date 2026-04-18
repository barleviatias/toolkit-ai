import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type { Source, SourcesConfig, CatalogEntry } from '../types.js';
import { SOURCES_FILE, CACHE_DIR, assertSafePathSegment } from './platform.js';
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

/** Parse a GitHub/Bitbucket URL or shorthand into a Source object. */
export function parseSourceInput(input: string): Source {
  const normalized = input.trim();
  let repo: string;
  let type: Source['type'] = 'github';

  // Full URL: https://github.com/owner/repo or https://bitbucket.org/owner/repo
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    try {
      const parsed = new URL(normalized);
      const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
      if ((parsed.hostname === 'github.com' || parsed.hostname === 'bitbucket.org') && parts.length >= 2) {
        type = parsed.hostname === 'bitbucket.org' ? 'bitbucket' : 'github';
        repo = `${parts[0]}/${parts[1].replace(/\.git$/, '')}`;
      } else {
        repo = normalized.replace(/\.git$/, '');
      }
    } catch {
      repo = normalized.replace(/\.git$/, '');
    }
  }
  // SSH: git@github.com:owner/repo.git or git@bitbucket.org:owner/repo.git
  else if (normalized.match(/^git@/)) {
    const sshMatch = normalized.match(/^git@(github\.com|bitbucket\.org):([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch) {
      type = sshMatch[1] === 'bitbucket.org' ? 'bitbucket' : 'github';
      repo = `${sshMatch[2]}/${sshMatch[3]}`;
    } else {
      repo = normalized;
    }
  }
  // owner/repo shorthand (default to github)
  else {
    repo = normalized.replace(/\.git$/, '');
  }

  const name = repo.split('/').pop() || repo;
  assertSafePathSegment(name, 'source name');
  return { name, type, repo };
}

// ---------------------------------------------------------------------------
// Sources config CRUD
// ---------------------------------------------------------------------------

/** Load the sources config from the user's `~/.toolkit/sources.json` (or bundled defaults). */
export function loadSources(): SourcesConfig {
  try {
    return JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')) as SourcesConfig;
  } catch {
    return loadDefaultConfig();
  }
}

/** Persist the sources config to `~/.toolkit/sources.json`. */
export function saveSources(config: SourcesConfig): void {
  ensureDir(path.dirname(SOURCES_FILE));
  fs.writeFileSync(SOURCES_FILE, JSON.stringify(config, null, 2));
}

/** Add an external source and immediately fetch it. */
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

/** Remove a source by name and delete its cache directory. */
export function removeSource(name: string): void {
  const config = loadSources();
  config.sources = config.sources.filter(s => s.name !== name);
  saveSources(config);
}

/**
 * Flip a source's enabled state. Returns the new state, or null if the source
 * is not found. Disabled sources stay in sources.json but contribute no items.
 */
export function setSourceEnabled(name: string, enabled: boolean): boolean | null {
  const config = loadSources();
  const source = config.sources.find(s => s.name === name);
  if (!source) return null;
  source.enabled = enabled;
  saveSources(config);
  return enabled;
}

/** True when the source is enabled (undefined enabled is treated as true). */
function isSourceEnabled(source: Source): boolean {
  return source.enabled !== false;
}

// ---------------------------------------------------------------------------
// Fetch and cache external sources
// ---------------------------------------------------------------------------

function getCacheDir(source: Source): string {
  return path.join(CACHE_DIR, assertSafePathSegment(source.name, 'source name'));
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
  const tempDir = `${cacheDir}.fetching-${process.pid}`;
  const host = source.type === 'bitbucket' ? 'bitbucket.org' : 'github.com';
  const cloneUrls = [`https://${host}/${source.repo}.git`, `git@${host}:${source.repo}.git`];
  const errors: string[] = [];

  // Clone into a temp dir, then atomically swap on success. Try HTTPS first,
  // fall back to SSH for private/SSH-only repos. If every URL fails, the
  // existing cache is preserved (no wipe before the new clone succeeds).
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  ensureDir(path.dirname(tempDir));

  for (const repoUrl of cloneUrls) {
    const result = spawnSync('git', ['clone', '--depth', '1', '--single-branch', repoUrl, tempDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });

    if (result.status === 0) {
      fs.writeFileSync(path.join(tempDir, '.fetched'), new Date().toISOString());
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      }
      fs.renameSync(tempDir, cacheDir);
      return;
    }

    const stderr = result.stderr?.toString().trim() || 'unknown error';
    errors.push(`${repoUrl}: ${stderr}`);
    // Clean the temp dir between attempts so SSH retries from a clean slate.
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  throw new Error(`Failed to fetch ${source.repo}. Tried HTTPS and SSH. Details: ${errors.join(' | ')}`);
}

/** Force-refresh one or all sources (re-clone from remote) */
/** Refresh one or all sources by re-cloning from remote. Returns per-source status. */
export function refreshSources(sourceName?: string): { name: string; ok: boolean; error?: string }[] {
  const config = loadSources();
  const targets = sourceName
    ? config.sources.filter(s => s.name === sourceName && isSourceEnabled(s))
    : config.sources.filter(s => (s.type === 'github' || s.type === 'bitbucket') && isSourceEnabled(s));

  const results: { name: string; ok: boolean; error?: string }[] = [];
  for (const source of targets) {
    try {
      fetchSource(source);
      results.push({ name: source.name, ok: true });
    } catch (e: unknown) {
      results.push({ name: source.name, ok: false, error: e instanceof Error ? e.message : String(e) });
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

/**
 * Dedupe catalog entries by resolved name, first-wins. Real repos (e.g.
 * awesome-copilot) ship multiple SKILL.md files with identical `name` in
 * frontmatter — keeping all of them produces duplicate React keys that break
 * the TUI's render reconciliation.
 */
function dedupeByName(entries: CatalogEntry[]): CatalogEntry[] {
  const byName = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    if (!byName.has(entry.name)) byName.set(entry.name, entry);
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function scanSourceSkills(source: Source): CatalogEntry[] {
  const cacheDir = getCacheDir(source);
  if (!fs.existsSync(cacheDir)) return [];

  return dedupeByName(findSkillDirs(cacheDir).map(skillDir => {
    const meta = parseFrontmatter(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'));
    return {
      name: meta.name || path.basename(skillDir),
      description: meta.description || '',
      hash: hashDir(skillDir),
      path: path.relative(cacheDir, skillDir),
      source: source.name,
    };
  }));
}

function scanSourceAgents(source: Source): CatalogEntry[] {
  const cacheDir = getCacheDir(source);
  if (!fs.existsSync(cacheDir)) return [];

  return dedupeByName(findAgentFiles(cacheDir).map(agentFile => {
    const meta = parseFrontmatter(fs.readFileSync(agentFile, 'utf8'));
    return {
      name: meta.name || path.basename(agentFile, '.agent.md'),
      description: meta.description || '',
      hash: hashFile(agentFile),
      path: path.relative(cacheDir, agentFile),
      source: source.name,
    };
  }));
}

function findBundleFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }

    const isBundlesDir = path.basename(current) === 'bundles';

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json') && isBundlesDir) {
        results.push(path.join(current, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.bundle.json')) {
        results.push(path.join(current, entry.name));
      } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        walk(path.join(current, entry.name));
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Extract `[name, serverConfig]` pairs from an MCP config file, handling all
 * three shapes seen in the wild:
 *
 *   1. Our custom single-server shape:
 *      { "name": "foo", "command": "...", "args": [...] }
 *
 *   2. Standard Claude wrapped shape:
 *      { "mcpServers": { "foo": { "command": "..." }, "bar": { "url": "..." } } }
 *
 *   3. Flat shape (used by many real plugins like Anthropic's firebase,
 *      github/copilot-plugins' workiq):
 *      { "foo": { "command": "..." } }
 */
export function extractMcpServers(config: unknown): Array<[string, Record<string, unknown>]> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  const obj = config as Record<string, unknown>;

  if (typeof obj.name === 'string' && (obj.command || obj.url)) {
    return [[obj.name, obj]];
  }
  if (obj.mcpServers && typeof obj.mcpServers === 'object') {
    return Object.entries(obj.mcpServers as Record<string, unknown>)
      .filter(([, v]) => v && typeof v === 'object')
      .map(([k, v]) => [k, v as Record<string, unknown>]);
  }
  return Object.entries(obj)
    .filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
    .map(([k, v]) => [k, v as Record<string, unknown>]);
}

/** Synthesize a readable description from an MCP server config when none is provided. */
function describeMcpServer(cfg: Record<string, unknown>): string {
  if (typeof cfg.description === 'string' && cfg.description) return cfg.description;
  if (typeof cfg.url === 'string') return `Streamable HTTP MCP server · ${cfg.url}`;
  if (typeof cfg.command === 'string') {
    const args = Array.isArray(cfg.args) ? ` ${(cfg.args as unknown[]).join(' ')}` : '';
    return `Stdio MCP server · ${cfg.command}${args}`.trim();
  }
  return '';
}

function scanSourceMcps(source: Source): CatalogEntry[] {
  const cacheDir = getCacheDir(source);
  if (!fs.existsSync(cacheDir)) return [];

  const entries: CatalogEntry[] = [];
  for (const mcpFile of findMcpFiles(cacheDir)) {
    try {
      const config = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
      const fileDescription = typeof config.description === 'string' ? config.description : '';
      const fileHash = hashFile(mcpFile);
      const relPath = path.relative(cacheDir, mcpFile);

      for (const [serverName, serverCfg] of extractMcpServers(config)) {
        entries.push({
          name: serverName,
          description: fileDescription || describeMcpServer(serverCfg),
          hash: fileHash,
          path: relPath,
          source: source.name,
        });
      }
    } catch { /* skip malformed JSON */ }
  }
  return dedupeByName(entries);
}

function scanSourceBundles(source: Source): CatalogEntry[] {
  const cacheDir = getCacheDir(source);
  if (!fs.existsSync(cacheDir)) return [];

  const entries: CatalogEntry[] = [];
  for (const bundleFile of findBundleFiles(cacheDir)) {
    try {
      const config = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));
      entries.push({
        name: config.name || path.basename(bundleFile).replace('.bundle.json', '').replace('.json', ''),
        description: config.description || '',
        hash: hashFile(bundleFile),
        path: path.relative(cacheDir, bundleFile),
        source: source.name,
      });
    } catch { /* skip malformed JSON */ }
  }
  return dedupeByName(entries);
}

// ---------------------------------------------------------------------------
// Public: external resources (skills, agents, MCPs, bundles)
// ---------------------------------------------------------------------------

export interface ExternalResources {
  skills: CatalogEntry[];
  agents: CatalogEntry[];
  mcps: CatalogEntry[];
  bundles: CatalogEntry[];
}

/** Build a unified catalog from discovered external resources. */
export function buildCatalog(resources: ExternalResources): { skills: CatalogEntry[]; agents: CatalogEntry[]; mcps: CatalogEntry[]; bundles: CatalogEntry[] } {
  return {
    skills: resources.skills,
    agents: resources.agents,
    mcps: resources.mcps,
    bundles: resources.bundles,
  };
}

/** Fetch all external sources and scan for resources. Optionally force a re-clone. */
export function fetchExternalResources(forceRefresh = false): ExternalResources {
  const config = loadSources();
  const result: ExternalResources = { skills: [], agents: [], mcps: [], bundles: [] };

  for (const source of config.sources) {
    if (source.type !== 'github' && source.type !== 'bitbucket') continue;
    if (!isSourceEnabled(source)) continue;

    try {
      if (forceRefresh || isCacheStale(source, config.cacheTTL)) {
        fetchSource(source);
      }
      result.skills.push(...scanSourceSkills(source));
      result.agents.push(...scanSourceAgents(source));
      result.mcps.push(...scanSourceMcps(source));
      result.bundles.push(...scanSourceBundles(source));
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
