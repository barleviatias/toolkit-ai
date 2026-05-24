import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import type { Source, SourcesConfig, CatalogEntry } from '../types.js';
import { SOURCES_FILE, CACHE_DIR, assertSafePathSegment } from './platform.js';
import { loadSettings } from './settings.js';
import { ensureDir } from './fs-helpers.js';
import { parseFrontmatter, hashDir, hashFile, loadPluginManifest, findPluginManifestPath } from './catalog.js';
import { logSourceRefresh } from './logger.js';

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
export function parseSourceInput(input: string, nameOverride?: string): Source {
  let normalized = input.trim();
  let repo: string;
  let type: Source['type'] = 'github';
  let branch: string | undefined;

  const hashIndex = normalized.indexOf('#');
  if (hashIndex >= 0) {
    branch = normalized.slice(hashIndex + 1).trim();
    normalized = normalized.slice(0, hashIndex).trim();
  }

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

  const name = nameOverride || repo.split('/').pop() || repo;
  assertSafePathSegment(name, 'source name');
  if (branch) {
    assertSafeGitRef(branch);
  }
  return { name, type, repo, ...(branch ? { branch } : {}) };
}

function assertSafeGitRef(ref: string): string {
  if (!ref || ref.length > 200) throw new Error(`Unsafe git ref: ${ref}`);
  if (ref.startsWith('-')) throw new Error(`Unsafe git ref: ${ref}`);
  if (ref.includes('..') || ref.includes('@{') || ref.includes('\\')) throw new Error(`Unsafe git ref: ${ref}`);
  if (ref.endsWith('/') || ref.endsWith('.') || ref.includes('//')) throw new Error(`Unsafe git ref: ${ref}`);
  if (!/^[A-Za-z0-9._/\-]+$/.test(ref)) throw new Error(`Unsafe git ref: ${ref}`);
  return ref;
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

/** Add an external source to the sources config. The next catalog refresh fetches it. */
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

// Force every git invocation to fail fast instead of prompting on /dev/tty.
// Without these, a private repo (or an SSH key with a passphrase) makes git
// open the controlling terminal directly to ask for credentials — invisible
// under Ink's alt-screen, the spawn hangs until the timeout fires.
//
// `accept-new` silently trusts hosts on first connect. Fine for a tool that
// already runs `git clone` on user-supplied URLs; matches what an interactive
// user would type. We spread `process.env` so SSH_AUTH_SOCK / PATH / HOME
// still flow through and working ssh-agent keys keep working.
const NON_INTERACTIVE_GIT_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'echo',
  SSH_ASKPASS: 'echo',
  SSH_ASKPASS_REQUIRE: 'never',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10',
};

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ...NON_INTERACTIVE_GIT_ENV };
}

const CLONE_TIMEOUT_MS = 25000;

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

  const cloneArgs = (repoUrl: string) => [
    'clone',
    '--depth',
    '1',
    '--single-branch',
    ...(source.branch ? ['--branch', assertSafeGitRef(source.branch)] : []),
    repoUrl,
    tempDir,
  ];

  for (const repoUrl of cloneUrls) {
    const result = spawnSync('git', cloneArgs(repoUrl), {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: CLONE_TIMEOUT_MS,
      env: gitEnv(),
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

function cloneSource(repoUrl: string, tempDir: string, branch?: string): Promise<{ ok: boolean; error: string }> {
  return new Promise(resolve => {
    const child = spawn('git', [
      'clone',
      '--depth',
      '1',
      '--single-branch',
      ...(branch ? ['--branch', assertSafeGitRef(branch)] : []),
      repoUrl,
      tempDir,
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: gitEnv(),
    });
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Belt-and-suspenders: if SIGTERM doesn't unblock git (rare, but happens
      // if it's wedged in a syscall), force-kill so the promise resolves and
      // the UI doesn't stay frozen.
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, 2000);
    }, CLONE_TIMEOUT_MS);

    child.stderr.on('data', chunk => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    child.on('close', code => {
      clearTimeout(timer);
      const error = Buffer.concat(stderr).toString('utf8').trim() || 'unknown error';
      resolve({ ok: code === 0, error: timedOut ? `timed out after ${CLONE_TIMEOUT_MS / 1000}s: ${error}` : error });
    });
  });
}

async function fetchSourceAsync(source: Source): Promise<void> {
  if (source.type !== 'github' && source.type !== 'bitbucket') return;

  const cacheDir = getCacheDir(source);
  const tempDir = `${cacheDir}.fetching-${process.pid}`;
  const host = source.type === 'bitbucket' ? 'bitbucket.org' : 'github.com';
  const cloneUrls = [`https://${host}/${source.repo}.git`, `git@${host}:${source.repo}.git`];
  const errors: string[] = [];

  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  ensureDir(path.dirname(tempDir));

  for (const repoUrl of cloneUrls) {
    const result = await cloneSource(repoUrl, tempDir, source.branch);
    if (result.ok) {
      fs.writeFileSync(path.join(tempDir, '.fetched'), new Date().toISOString());
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      }
      fs.renameSync(tempDir, cacheDir);
      return;
    }

    errors.push(`${repoUrl}: ${result.error}`);
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

/**
 * A directory is a plugin root if it contains a recognised plugin manifest
 * (Claude's `.claude-plugin/plugin.json` OR a top-level generic `plugin.json`).
 * Standalone scanners (skill/agent/command/mcp) skip past plugin roots so a
 * plugin's components don't double-list as both `plugin:foo` and a flat
 * `skill:bar`. Users install via the plugin entry; the decompose installer
 * handles the components at install time.
 */
function isPluginRoot(dir: string): boolean {
  return findPluginManifestPath(dir) !== null;
}

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
      const child = path.join(current, entry.name);
      if (isPluginRoot(child)) continue;
      walk(child);
    }
  }

  walk(dir);
  return results;
}

/** Recursively collect every file in `dir` (skipping SKIP_DIRS, dotfolders, and plugin roots) whose name ends with `suffix`. */
function walkFilesBySuffix(dir: string, suffix: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(suffix)) {
        results.push(path.join(current, entry.name));
      } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        const child = path.join(current, entry.name);
        if (isPluginRoot(child)) continue;
        walk(child);
      }
    }
  }

  walk(dir);
  return results;
}

const findAgentFiles = (dir: string): string[] => walkFilesBySuffix(dir, '.agent.md');

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
        const child = path.join(current, entry.name);
        if (isPluginRoot(child)) continue;
        walk(child);
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

const findCommandFiles = (dir: string): string[] => walkFilesBySuffix(dir, '.prompt.md');

function scanSourceCommands(source: Source): CatalogEntry[] {
  const cacheDir = getCacheDir(source);
  if (!fs.existsSync(cacheDir)) return [];

  return dedupeByName(findCommandFiles(cacheDir).map(commandFile => {
    const meta = parseFrontmatter(fs.readFileSync(commandFile, 'utf8'));
    return {
      name: meta.name || path.basename(commandFile, '.prompt.md'),
      description: meta.description || '',
      hash: hashFile(commandFile),
      path: path.relative(cacheDir, commandFile),
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
        const child = path.join(current, entry.name);
        if (isPluginRoot(child)) continue;
        walk(child);
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

/**
 * Find directories that declare a plugin (any of the supported manifest
 * shapes — see `isPluginRoot`). Doesn't recurse into a found plugin so
 * marketplace-style repos with one plugin per top-level subdir get one
 * catalog entry per plugin.
 */
function findPluginDirs(root: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }

    if (isPluginRoot(current)) {
      results.push(current);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(path.join(current, entry.name));
    }
  }

  walk(root);
  return results;
}

function scanSourcePlugins(source: Source): CatalogEntry[] {
  const cacheDir = getCacheDir(source);
  if (!fs.existsSync(cacheDir)) return [];

  const entries: CatalogEntry[] = [];
  for (const pluginDir of findPluginDirs(cacheDir)) {
    try {
      const manifest = loadPluginManifest(pluginDir);
      if (!manifest.name) continue;
      entries.push({
        name: manifest.name,
        description: manifest.description || '',
        hash: hashDir(pluginDir),
        path: path.relative(cacheDir, pluginDir),
        source: source.name,
      });
    } catch { /* malformed manifest; skip */ }
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
  commands: CatalogEntry[];
  plugins: CatalogEntry[];
  warnings: SourceLoadWarning[];
}

export interface SourceLoadWarning {
  name: string;
  message: string;
  usedCache: boolean;
}

/** Build a unified catalog from discovered external resources. */
export function buildCatalog(resources: ExternalResources): { skills: CatalogEntry[]; agents: CatalogEntry[]; mcps: CatalogEntry[]; bundles: CatalogEntry[]; commands: CatalogEntry[]; plugins: CatalogEntry[] } {
  return {
    skills: resources.skills,
    agents: resources.agents,
    mcps: resources.mcps,
    bundles: resources.bundles,
    commands: resources.commands,
    plugins: resources.plugins,
  };
}

/** Fetch all external sources and scan for resources. Optionally force a re-clone. Falls back to the existing cache when a refresh fails. */
export function fetchExternalResources(forceRefresh = false): ExternalResources {
  const config = loadSources();
  const settings = loadSettings();
  const result: ExternalResources = { skills: [], agents: [], mcps: [], bundles: [], commands: [], plugins: [], warnings: [] };

  for (const source of config.sources) {
    if (source.type !== 'github' && source.type !== 'bitbucket') continue;
    if (!isSourceEnabled(source)) continue;

    let fetchError: string | null = null;
    let usedCacheAfterFetchFailure = false;

    try {
      if (forceRefresh || isCacheStale(source, settings.cacheTTL)) {
        try {
          fetchSource(source);
        } catch (e: unknown) {
          fetchError = e instanceof Error ? e.message : String(e);
          usedCacheAfterFetchFailure = fs.existsSync(getCacheDir(source));
        }
      }

      result.skills.push(...scanSourceSkills(source));
      result.agents.push(...scanSourceAgents(source));
      result.mcps.push(...scanSourceMcps(source));
      result.bundles.push(...scanSourceBundles(source));
      result.commands.push(...scanSourceCommands(source));
    result.plugins.push(...scanSourcePlugins(source));

      if (fetchError) {
        result.warnings.push({
          name: source.name,
          message: fetchError,
          usedCache: usedCacheAfterFetchFailure,
        });
      }
    } catch (e: unknown) {
      const scanError = e instanceof Error ? e.message : String(e);
      result.warnings.push({
        name: source.name,
        message: fetchError ? `${fetchError}; cached scan failed: ${scanError}` : `Cached scan failed: ${scanError}`,
        usedCache: false,
      });
    }

    // Mirror loadSourceResourcesAsync: persist this source's refresh failure
    // to ~/.toolkit/log.jsonl. fetchExternalResources is the sync path
    // (CLI / tests), the async one above is the TUI path — both must log.
    const sourceWarning = result.warnings.find(w => w.name === source.name);
    if (sourceWarning) {
      logSourceRefresh({
        name: source.name,
        ok: false,
        usedCache: sourceWarning.usedCache,
        errorMsg: sourceWarning.message,
      });
    }
  }

  return result;
}

/**
 * Scan a single source's existing on-disk cache without touching the network.
 * Returns whatever skills/agents/mcps/bundles are already present locally so
 * the TUI can paint instantly on startup (or on enable-toggle) and refresh in
 * the background. If the cache is empty, returns empty arrays — caller decides
 * whether to fetch.
 */
export function scanCachedSource(source: Source): ExternalResources {
  const result: ExternalResources = { skills: [], agents: [], mcps: [], bundles: [], commands: [], plugins: [], warnings: [] };
  try {
    result.skills.push(...scanSourceSkills(source));
    result.agents.push(...scanSourceAgents(source));
    result.mcps.push(...scanSourceMcps(source));
    result.bundles.push(...scanSourceBundles(source));
    result.commands.push(...scanSourceCommands(source));
    result.plugins.push(...scanSourcePlugins(source));
  } catch (e: unknown) {
    result.warnings.push({
      name: source.name,
      message: `Cached scan failed: ${e instanceof Error ? e.message : String(e)}`,
      usedCache: false,
    });
  }
  return result;
}

/** True when this source has no on-disk cache yet (fresh add or wiped). */
export function hasCache(source: Source): boolean {
  return fs.existsSync(getCacheDir(source));
}

/** True when the cache is stale per TTL — caller decides whether to fetch. */
export function isStale(source: Source, ttl: number): boolean {
  return isCacheStale(source, ttl);
}

/**
 * Fetch a single source from the network (if stale or forced) and re-scan.
 * Used for per-source background refresh after the initial cache paint.
 */
export async function fetchAndScanSource(source: Source, ttl: number, forceRefresh: boolean): Promise<ExternalResources> {
  return loadSourceResourcesAsync(source, ttl, forceRefresh);
}

async function loadSourceResourcesAsync(source: Source, ttl: number, forceRefresh: boolean): Promise<ExternalResources> {
  const result: ExternalResources = { skills: [], agents: [], mcps: [], bundles: [], commands: [], plugins: [], warnings: [] };
  let fetchError: string | null = null;
  let usedCacheAfterFetchFailure = false;

  try {
    if (forceRefresh || isCacheStale(source, ttl)) {
      try {
        await fetchSourceAsync(source);
      } catch (e: unknown) {
        fetchError = e instanceof Error ? e.message : String(e);
        usedCacheAfterFetchFailure = fs.existsSync(getCacheDir(source));
      }
    }

    result.skills.push(...scanSourceSkills(source));
    result.agents.push(...scanSourceAgents(source));
    result.mcps.push(...scanSourceMcps(source));
    result.bundles.push(...scanSourceBundles(source));
    result.commands.push(...scanSourceCommands(source));
    result.plugins.push(...scanSourcePlugins(source));

    if (fetchError) {
      result.warnings.push({
        name: source.name,
        message: fetchError,
        usedCache: usedCacheAfterFetchFailure,
      });
    }
  } catch (e: unknown) {
    const scanError = e instanceof Error ? e.message : String(e);
    result.warnings.push({
      name: source.name,
      message: fetchError ? `${fetchError}; cached scan failed: ${scanError}` : `Cached scan failed: ${scanError}`,
      usedCache: false,
    });
  }

  // Persist failures to ~/.toolkit/log.jsonl so the user can see the actual
  // git/HTTP error after the TUI is dismissed. Success refreshes aren't
  // logged — the operation log is for outcomes worth investigating, and a
  // green refresh isn't one.
  const sourceWarning = result.warnings.find(w => w.name === source.name);
  if (sourceWarning) {
    logSourceRefresh({
      name: source.name,
      ok: false,
      usedCache: sourceWarning.usedCache,
      errorMsg: sourceWarning.message,
    });
  }

  return result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await fn(items[current]);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** Fetch and scan external sources concurrently for interactive UI refreshes. */
export async function fetchExternalResourcesAsync(forceRefresh = false): Promise<ExternalResources> {
  const config = loadSources();
  const settings = loadSettings();
  const result: ExternalResources = { skills: [], agents: [], mcps: [], bundles: [], commands: [], plugins: [], warnings: [] };
  const targets = config.sources.filter(source =>
    (source.type === 'github' || source.type === 'bitbucket') && isSourceEnabled(source)
  );

  const perSource = await mapWithConcurrency(
    targets,
    settings.sourceConcurrency,
    source => loadSourceResourcesAsync(source, settings.cacheTTL, forceRefresh),
  );
  for (const resources of perSource) {
    result.skills.push(...resources.skills);
    result.agents.push(...resources.agents);
    result.mcps.push(...resources.mcps);
    result.bundles.push(...resources.bundles);
    result.commands.push(...resources.commands);
    result.plugins.push(...resources.plugins);
    result.warnings.push(...resources.warnings);
  }

  return result;
}

/** @deprecated Use fetchExternalResources instead */
export function fetchExternalSkills(forceRefresh = false): CatalogEntry[] {
  return fetchExternalResources(forceRefresh).skills;
}
