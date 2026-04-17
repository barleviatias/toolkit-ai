import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type { Source, SourcesConfig, CatalogEntry } from '../types.js';
import { SOURCES_FILE, CACHE_DIR, assertSafePathSegment } from './platform.js';
import { ensureDir } from './fs-helpers.js';
import { parseFrontmatter, hashDir, hashFile, detectPluginFormats, loadPluginManifest, loadMarketplaceManifest, PLUGIN_MANIFEST_PATHS } from './catalog.js';

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
/** Refresh one or all sources by re-cloning from remote. Returns per-source status. */
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
 * Per-source scan cache, lifetime of one `fetchExternalResources` call. Avoids
 * loading marketplace.json 5 times per source (once per scanner: skills/agents/
 * mcps/bundles/plugins). Cleared at the start of each fetch.
 */
const scanCache: Map<string, { marketplacePluginDirs: Set<string>; loaded: ReturnType<typeof loadMarketplaceManifest> }> = new Map();

/**
 * Collect the set of plugin directories known from the source's marketplace manifest.
 * Used to stop standalone scanners (skills/agents/mcps/bundles) from descending into
 * marketplace-registered plugin dirs that don't have a local manifest file (strict:false).
 */
function getMarketplacePluginDirs(cacheDir: string): Set<string> {
  const cached = scanCache.get(cacheDir);
  if (cached) return cached.marketplacePluginDirs;

  const loaded = loadMarketplaceManifest(cacheDir);
  const dirs = new Set<string>();
  if (loaded && Array.isArray(loaded.manifest.plugins)) {
    for (const mpEntry of loaded.manifest.plugins) {
      if (typeof mpEntry.source !== 'string') continue;
      dirs.add(path.resolve(cacheDir, mpEntry.source));
    }
  }
  scanCache.set(cacheDir, { marketplacePluginDirs: dirs, loaded });
  return dirs;
}

/** Return the cached marketplace manifest load for a source (populates cache on miss). */
function getCachedMarketplace(cacheDir: string): ReturnType<typeof loadMarketplaceManifest> {
  if (!scanCache.has(cacheDir)) getMarketplacePluginDirs(cacheDir); // populates both fields
  return scanCache.get(cacheDir)?.loaded ?? null;
}

/** A dir is a plugin if it has a local manifest OR is marketplace-listed. */
function isPluginDirWithMarket(current: string, marketplacePluginDirs: Set<string>): boolean {
  if (marketplacePluginDirs.has(path.resolve(current))) return true;
  return isPluginDir(current);
}

function findSkillDirs(dir: string, marketplacePluginDirs: Set<string> = new Set()): string[] {
  const results: string[] = [];

  function walk(current: string) {
    // Skip plugin dirs — plugin-internal skills belong to the plugin, not as standalone
    if (isPluginDirWithMarket(current, marketplacePluginDirs)) return;

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

function findAgentFiles(dir: string, marketplacePluginDirs: Set<string> = new Set()): string[] {
  const results: string[] = [];

  function walk(current: string) {
    // Skip plugin dirs — plugin-internal agents belong to the plugin, not as standalone
    if (isPluginDirWithMarket(current, marketplacePluginDirs)) return;

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

function findMcpFiles(dir: string, marketplacePluginDirs: Set<string> = new Set()): string[] {
  const results: string[] = [];
  // Look for mcps/ directory with .json files, or *.mcp.json anywhere.
  // Skip plugin directories — their internal .mcp.json files belong to the plugin, not as standalone MCPs.
  function walk(current: string) {
    // If we've entered a plugin directory, stop — its .mcp.json is plugin-internal
    if (isPluginDirWithMarket(current, marketplacePluginDirs)) return;

    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }

    const isMcpsDir = path.basename(current) === 'mcps';

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json') && isMcpsDir) {
        results.push(path.join(current, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.mcp.json') && entry.name !== '.mcp.json') {
        // Require a meaningful name (foo.mcp.json), not the bare .mcp.json which is plugin-internal convention
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

  const marketplacePluginDirs = getMarketplacePluginDirs(cacheDir);
  const skillDirs = findSkillDirs(cacheDir, marketplacePluginDirs);
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

  const marketplacePluginDirs = getMarketplacePluginDirs(cacheDir);
  const agentFiles = findAgentFiles(cacheDir, marketplacePluginDirs);
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

function findBundleFiles(dir: string, marketplacePluginDirs: Set<string> = new Set()): string[] {
  const results: string[] = [];

  function walk(current: string) {
    // Skip plugin dirs — plugin-internal bundles belong to the plugin, not as standalone
    if (isPluginDirWithMarket(current, marketplacePluginDirs)) return;

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

function scanSourceMcps(source: Source): CatalogEntry[] {
  const cacheDir = getCacheDir(source);
  if (!fs.existsSync(cacheDir)) return [];

  const marketplacePluginDirs = getMarketplacePluginDirs(cacheDir);
  const mcpFiles = findMcpFiles(cacheDir, marketplacePluginDirs);
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

/**
 * Check if a directory contains any of the native plugin manifest files.
 * A directory is considered a plugin if it has at least one of:
 *   .claude-plugin/plugin.json, .codex-plugin/plugin.json, .cursor-plugin/plugin.json,
 *   .plugin/plugin.json, .github/plugin/plugin.json, or plugin.json at root.
 */
function isPluginDir(dir: string): boolean {
  for (const rel of PLUGIN_MANIFEST_PATHS) {
    if (fs.existsSync(path.join(dir, rel))) return true;
  }
  return false;
}

function findPluginDirs(rootDir: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }

    // If this dir itself is a plugin, add it and don't recurse (nested plugins unsupported)
    if (isPluginDir(current)) {
      results.push(current);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(path.join(current, entry.name));
    }
  }

  walk(rootDir);
  return results;
}

/**
 * Resolve a plugin entry inside a marketplace to its actual directory on disk.
 * The marketplace entry's `source` field can be:
 *   - a string like "./plugins/my-plugin" (relative to marketplace root)
 *   - an object (external git repo; not yet supported — skipped)
 */
function resolveMarketplacePluginPath(marketplaceRoot: string, entrySource: unknown): string | null {
  if (typeof entrySource === 'string') {
    return path.join(marketplaceRoot, entrySource);
  }
  // Object-form sources (github, url, git-subdir) would need cloning — skip for now
  return null;
}

/**
 * Scan a source for plugins. Produces CatalogEntry items from two sources:
 *   1. Marketplace-listed plugins (from `marketplace.json`) — preferred, gets marketplace name
 *   2. Standalone plugin directories — fallback for repos without a marketplace manifest
 *
 * Deduplicated by plugin directory path so a plugin listed in a marketplace isn't
 * double-counted if we also find it during standalone walking.
 */
function scanSourcePlugins(source: Source): CatalogEntry[] {
  const cacheDir = getCacheDir(source);
  if (!fs.existsSync(cacheDir)) return [];

  const entries: CatalogEntry[] = [];
  const seenPaths = new Set<string>();

  // 1. Try marketplace first — it gives us a real marketplace name and curated plugin list
  const loaded = getCachedMarketplace(cacheDir);
  if (loaded && Array.isArray(loaded.manifest.plugins)) {
    const { manifest: marketplace, impliedFormats } = loaded;
    for (const mpEntry of marketplace.plugins) {
      const pluginPath = resolveMarketplacePluginPath(cacheDir, mpEntry.source);
      if (!pluginPath || !fs.existsSync(pluginPath)) continue;
      if (seenPaths.has(pluginPath)) continue;
      seenPaths.add(pluginPath);

      // Start from detected formats (per-plugin-dir manifests), then force ALL of the
      // marketplace's implied formats to true. This handles:
      //   - strict:false plugins — the marketplace entry itself serves as the manifest
      //   - multi-target marketplaces — e.g., github/copilot-plugins ships both
      //     .claude-plugin/marketplace.json and .github/plugin/marketplace.json,
      //     meaning its plugins work for both Claude AND Copilot.
      const formats = detectPluginFormats(pluginPath);
      for (const f of impliedFormats) formats[f] = true;
      const manifest = loadPluginManifest(pluginPath);

      entries.push({
        name: mpEntry.name || manifest.name || path.basename(pluginPath),
        description: mpEntry.description || manifest.description || '',
        hash: hashDir(pluginPath),
        path: path.relative(cacheDir, pluginPath),
        source: source.name,
        marketplace: marketplace.name,
        formats,
        version: mpEntry.version || manifest.version,
      });
    }
  }

  // 2. Walk for standalone plugin directories (those with a local manifest but not listed in a marketplace)
  // Note: pluginDirs found here only include dirs with a LOCAL plugin.json — dirs referenced only
  // by marketplace manifests were already handled in step 1.
  const pluginDirs = findPluginDirs(cacheDir);
  for (const pluginDir of pluginDirs) {
    if (seenPaths.has(pluginDir)) continue;
    seenPaths.add(pluginDir);

    const formats = detectPluginFormats(pluginDir);
    const manifest = loadPluginManifest(pluginDir);

    entries.push({
      name: manifest.name || path.basename(pluginDir),
      description: manifest.description || '',
      hash: hashDir(pluginDir),
      path: path.relative(cacheDir, pluginDir),
      source: source.name,
      // No marketplace name available → fall back to source name for namespacing
      marketplace: loaded?.manifest.name || source.name,
      formats,
      version: manifest.version,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function scanSourceBundles(source: Source): CatalogEntry[] {
  const cacheDir = getCacheDir(source);
  if (!fs.existsSync(cacheDir)) return [];

  const marketplacePluginDirs = getMarketplacePluginDirs(cacheDir);
  const bundleFiles = findBundleFiles(cacheDir, marketplacePluginDirs);
  const entries: CatalogEntry[] = [];

  for (const bundleFile of bundleFiles) {
    try {
      const config = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));
      const fileName = path.basename(bundleFile).replace('.bundle.json', '').replace('.json', '');

      entries.push({
        name: config.name || fileName,
        description: config.description || '',
        hash: hashFile(bundleFile),
        path: path.relative(cacheDir, bundleFile),
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
// Public: external resources (skills, agents, MCPs, bundles)
// ---------------------------------------------------------------------------

export interface ExternalResources {
  skills: CatalogEntry[];
  agents: CatalogEntry[];
  mcps: CatalogEntry[];
  bundles: CatalogEntry[];
  plugins: CatalogEntry[];
}

/** Build a unified catalog from discovered external resources. */
export function buildCatalog(resources: ExternalResources): { skills: CatalogEntry[]; agents: CatalogEntry[]; mcps: CatalogEntry[]; bundles: CatalogEntry[]; plugins: CatalogEntry[] } {
  return {
    skills: resources.skills,
    agents: resources.agents,
    mcps: resources.mcps,
    bundles: resources.bundles,
    plugins: resources.plugins,
  };
}

/** Fetch all external sources and scan for resources. Optionally force a re-clone. */
export function fetchExternalResources(forceRefresh = false): ExternalResources {
  scanCache.clear(); // Reset per-source caches so marketplace.json is read fresh each refresh
  const config = loadSources();
  const result: ExternalResources = { skills: [], agents: [], mcps: [], bundles: [], plugins: [] };

  for (const source of config.sources) {
    if (source.type !== 'github' && source.type !== 'bitbucket') continue;

    try {
      if (forceRefresh || isCacheStale(source, config.cacheTTL)) {
        fetchSource(source);
      }
      result.skills.push(...scanSourceSkills(source));
      result.agents.push(...scanSourceAgents(source));
      result.mcps.push(...scanSourceMcps(source));
      result.bundles.push(...scanSourceBundles(source));
      result.plugins.push(...scanSourcePlugins(source));
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
