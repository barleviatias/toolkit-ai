import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Catalog, CatalogEntry, BundleConfig, McpConfig, PluginContents, PluginManifest } from '../types.js';
import { getSourceRoot } from './platform.js';

// ---------------------------------------------------------------------------
// Frontmatter parser (YAML --- blocks, zero deps)
// ---------------------------------------------------------------------------

const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Strip a leading YAML frontmatter block, returning the body. */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_BLOCK, '');
}

/** Parse YAML frontmatter from a `---` delimited block. Returns key-value pairs. */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const block = match[1];
  const meta: Record<string, string> = {};
  const lines = block.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\w[\w-]*):\s*(.*)/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();

    if (value === '>' || value === '|') {
      const chunks: string[] = [];
      while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) {
        chunks.push(lines[++i].trim());
      }
      meta[key] = chunks.join(' ');
    } else {
      meta[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return meta;
}

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------

/** Compute MD5 hash of a single file's contents. */
export function hashFile(filePath: string): string {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

// Dirs that are dev-state, not plugin content. We skip them when hashing or
// scanning so e.g. a plugin author's local `.claude/worktrees/` (git worktrees
// full of broken symlinks) doesn't crash hashDir or pollute the content hash.
const HASH_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', 'worktrees']);

/**
 * Compute a deterministic MD5 hash over all files in a directory (sorted by
 * relative path). Skips symlinks, special files, and known dev-state dirs so
 * the hash is robust to local-only clutter inside a plugin source tree.
 */
export function hashDir(dirPath: string): string {
  const h = crypto.createHash('md5');
  const files: { rel: string; abs: string }[] = [];
  (function walk(dir: string, prefix: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (HASH_SKIP_DIRS.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.isFile()) files.push({ rel, abs: path.join(dir, entry.name) });
      // Symlinks, sockets, FIFOs, etc. are dev-state clutter — skip silently.
    }
  })(dirPath, '');
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  for (const f of files) {
    try { h.update(f.rel); h.update(fs.readFileSync(f.abs)); } catch { /* unreadable file — skip rather than crash */ }
  }
  return h.digest('hex');
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const TYPE_TO_BUCKET: Record<string, keyof Catalog> = {
  skill: 'skills',
  agent: 'agents',
  mcp: 'mcps',
  bundle: 'bundles',
  command: 'commands',
  plugin: 'plugins',
};

/** Find an entry in the catalog by item type and name. Returns undefined for unknown types. */
export function findEntry(catalog: Catalog, type: string, name: string): CatalogEntry | undefined {
  const bucket = TYPE_TO_BUCKET[type];
  if (!bucket) return undefined;
  return (catalog[bucket] as CatalogEntry[]).find(entry => entry.name === name);
}

export function findSkill(catalog: Catalog, name: string): CatalogEntry | undefined {
  return findEntry(catalog, 'skill', name);
}

export function findAgent(catalog: Catalog, name: string): CatalogEntry | undefined {
  return findEntry(catalog, 'agent', name);
}

export function findMcp(catalog: Catalog, name: string): CatalogEntry | undefined {
  return findEntry(catalog, 'mcp', name);
}

export function findBundle(catalog: Catalog, name: string): CatalogEntry | undefined {
  return findEntry(catalog, 'bundle', name);
}

export function findCommand(catalog: Catalog, name: string): CatalogEntry | undefined {
  return findEntry(catalog, 'command', name);
}

export function findPlugin(catalog: Catalog, name: string): CatalogEntry | undefined {
  return findEntry(catalog, 'plugin', name);
}

/**
 * Resolve which manifest file declares a plugin in the given directory.
 * Plugins are an emerging cross-provider concept; the toolkit accepts both
 * widely-adopted shapes:
 *
 *   1. `.claude-plugin/plugin.json` — Claude Code's official plugin format
 *   2. `plugin.json` at the plugin root — generic shape used by ad-hoc and
 *      cross-tool plugin packages (some Codex/Copilot/community formats)
 *
 * Returns the absolute manifest path if either exists, else null.
 */
export function findPluginManifestPath(pluginDir: string): string | null {
  const claudePath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  if (fs.existsSync(claudePath)) return claudePath;
  const rootPath = path.join(pluginDir, 'plugin.json');
  if (fs.existsSync(rootPath)) return rootPath;
  return null;
}

/** Load and parse the plugin manifest from an absolute path. Throws if no manifest is found. */
export function loadPluginManifest(pluginDir: string): PluginManifest {
  const manifestPath = findPluginManifestPath(pluginDir);
  if (!manifestPath) throw new Error(`No plugin manifest found in ${pluginDir}`);
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PluginManifest;
}

const PLUGIN_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

function listDir(dir: string): fs.Dirent[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

/** Coerce a manifest field that may be string | string[] | undefined into a path array. */
function toPathArray(field: string | string[] | undefined): string[] {
  if (!field) return [];
  return Array.isArray(field) ? field : [field];
}

/**
 * Recursively find every directory under `root` that contains a SKILL.md
 * (treats the SKILL.md's parent as the skill root and stops descending).
 * Plugins like AMS nest skills under `skills/universal/`, `skills/stack-specific/<stack>/`,
 * etc. — the conventional Claude layout (direct children of `skills/`) is
 * a subset of what this finds.
 */
function findSkillDirsRecursive(root: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(root)) return results;

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }

    if (entries.some(e => e.isFile() && e.name === 'SKILL.md')) {
      results.push(current);
      return; // don't descend into a skill dir
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || PLUGIN_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(path.join(current, entry.name));
    }
  }
  walk(root);
  return results;
}

/** Recursively find files under `root` whose name ends with any of the given suffixes. */
function findFilesRecursive(root: string, suffixes: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(root)) return results;

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (entry.isFile() && suffixes.some(s => entry.name.endsWith(s))) {
        results.push(path.join(current, entry.name));
      } else if (entry.isDirectory() && !PLUGIN_SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        walk(path.join(current, entry.name));
      }
    }
  }
  walk(root);
  return results;
}

/**
 * Walk a plugin directory and enumerate its installable components.
 *
 * Discovery rules per type:
 *   - **Skills** — any `<dir>/SKILL.md`, recursively under each declared
 *     skill root (or `skills/` by default). AMS-style nesting like
 *     `skills/universal/foo/SKILL.md` is supported.
 *   - **Agents** — any `*.agent.md` or `*.md` file under each declared
 *     agent root (or `agents/` by default), recursively. Per-tool adapters
 *     like `agents/adapters/copilot/foo.agent.md` get picked up.
 *   - **Commands** — any `*.prompt.md` or `*.md` file under each declared
 *     command root (or `commands/` by default), recursively.
 *   - **MCPs** — `.mcp.json` files at any declared mcp root or at the plugin
 *     root (the conventional Claude location).
 *
 * `plugin.json` may declare explicit roots via `skills`, `agents`, `commands`,
 * `mcps` (string | string[]). When present, only those roots are scanned.
 * When absent, the conventional dirs are scanned. This lets non-Claude-shaped
 * plugin packages (AMS, mixed-tool packages) be authoritative about their
 * layout without forcing them into Claude's directory conventions.
 *
 * Hooks are detected but never installed (they execute commands and have no
 * scanner coverage yet — surfaced via `hasHooks` so the installer can refuse
 * them).
 */
export function readPluginContents(pluginDir: string): PluginContents {
  const contents: PluginContents = {
    skills: [],
    agents: [],
    commands: [],
    mcpConfigs: [],
    hasHooks: false,
  };

  // Try to read manifest path overrides; on any error fall back to defaults.
  let manifest: { skills?: string | string[]; agents?: string | string[]; commands?: string | string[]; mcps?: string | string[] };
  try { manifest = loadPluginManifest(pluginDir); } catch { manifest = {}; }

  const skillRoots = toPathArray(manifest.skills).length > 0
    ? toPathArray(manifest.skills)
    : ['skills'];
  const agentRoots = toPathArray(manifest.agents).length > 0
    ? toPathArray(manifest.agents)
    : ['agents'];
  const commandRoots = toPathArray(manifest.commands).length > 0
    ? toPathArray(manifest.commands)
    : ['commands'];

  // Skills: dedupe by skill dir name (last segment) to keep React keys
  // stable when the same skill ships under multiple declared roots.
  const seenSkill = new Set<string>();
  for (const root of skillRoots) {
    for (const skillDir of findSkillDirsRecursive(path.join(pluginDir, root))) {
      const name = path.basename(skillDir);
      if (seenSkill.has(name)) continue;
      seenSkill.add(name);
      contents.skills.push({ name, absPath: skillDir, relPath: path.relative(pluginDir, skillDir) });
    }
  }

  const seenAgent = new Set<string>();
  for (const root of agentRoots) {
    for (const file of findFilesRecursive(path.join(pluginDir, root), ['.agent.md', '.md'])) {
      const base = path.basename(file).replace(/\.agent\.md$|\.md$/, '');
      if (seenAgent.has(base)) continue;
      seenAgent.add(base);
      contents.agents.push({ name: base, absPath: file, relPath: path.relative(pluginDir, file) });
    }
  }

  const seenCommand = new Set<string>();
  for (const root of commandRoots) {
    for (const file of findFilesRecursive(path.join(pluginDir, root), ['.prompt.md', '.md'])) {
      const base = path.basename(file).replace(/\.prompt\.md$|\.md$/, '');
      if (seenCommand.has(base)) continue;
      seenCommand.add(base);
      contents.commands.push({ name: base, absPath: file, relPath: path.relative(pluginDir, file) });
    }
  }

  // MCPs: declared roots if present, plus the conventional `.mcp.json` at
  // the plugin root (Claude's standard location).
  const mcpRoots = toPathArray(manifest.mcps);
  const seenMcp = new Set<string>();
  for (const root of mcpRoots) {
    for (const file of findFilesRecursive(path.join(pluginDir, root), ['.mcp.json', '.json'])) {
      if (seenMcp.has(file)) continue;
      seenMcp.add(file);
      contents.mcpConfigs.push({ absPath: file, relPath: path.relative(pluginDir, file) });
    }
  }
  const rootMcp = path.join(pluginDir, '.mcp.json');
  if (fs.existsSync(rootMcp) && !seenMcp.has(rootMcp)) {
    contents.mcpConfigs.push({ absPath: rootMcp, relPath: '.mcp.json' });
  }

  contents.hasHooks = fs.existsSync(path.join(pluginDir, 'hooks', 'hooks.json'));

  return contents;
}

/** Load and parse a bundle's JSON config from the source cache. */
export function loadBundleConfig(entry: CatalogEntry): BundleConfig {
  return JSON.parse(fs.readFileSync(path.join(getSourceRoot(entry.source), entry.path), 'utf8')) as BundleConfig;
}

/** Load and parse an MCP's JSON config from the source cache. */
export function loadMcpConfig(entry: CatalogEntry): McpConfig {
  return JSON.parse(fs.readFileSync(path.join(getSourceRoot(entry.source), entry.path), 'utf8')) as McpConfig;
}
