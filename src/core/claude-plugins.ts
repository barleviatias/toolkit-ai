import fs from 'fs';
import path from 'path';
import type { CatalogEntry, PluginContents, PluginManifest } from '../types.js';
import { ensureDir, copyDirRecursive, writeJsonAtomic, readJsonOrNull, readJsoncOrNull } from './fs-helpers.js';
import {
  CLAUDE_KNOWN_MARKETPLACES_JSON,
  CLAUDE_MARKETPLACES_DIR,
  CLAUDE_NATIVE_SOURCE,
  CLAUDE_PLUGIN_CACHE_DIR,
  CLAUDE_PLUGIN_INSTALLED_JSON,
  CLAUDE_SETTINGS_JSON,
  CODEX_CONFIG_TOML,
  CODEX_NATIVE_SOURCE,
  CODEX_PLUGIN_CACHE_DIR,
  COPILOT_CONFIG_JSON,
  COPILOT_NATIVE_SOURCE,
  COPILOT_PLUGINS_ROOT,
  COPILOT_PLUGIN_INSTALL_DIR,
  COPILOT_SETTINGS_JSON,
} from './platform.js';
import { hashDir, loadPluginManifest } from './catalog.js';

/** Resolve symlinks; if the path doesn't exist yet, return it unchanged. */
function realpath(p: string): string {
  try { return fs.realpathSync(p); } catch { return p; }
}

/**
 * True when `~/.claude/plugins/installed_plugins.json` lists a plugin matching
 * `<name>@*` with an `installPath` that still exists on disk. Used by the
 * catalog UI to report per-target install status for plugins that toolkit-ai
 * installed via the native registry (no decomposed files under
 * `~/.claude/agents/` etc. — file-presence checks would miss those).
 */
export function isClaudePluginInstalled(name: string): boolean {
  if (!fs.existsSync(CLAUDE_PLUGIN_INSTALLED_JSON)) return false;
  let raw: ClaudeInstalledPluginsFile;
  try {
    raw = JSON.parse(fs.readFileSync(CLAUDE_PLUGIN_INSTALLED_JSON, 'utf8')) as ClaudeInstalledPluginsFile;
  } catch {
    return false;
  }
  const plugins = raw.plugins || {};
  for (const key of Object.keys(plugins)) {
    if (key.split('@')[0] !== name) continue;
    const install = plugins[key]?.[0];
    if (install?.installPath && fs.existsSync(install.installPath)) return true;
  }
  return false;
}

/**
 * True when `~/.copilot/config.json` `installedPlugins[]` has an entry whose
 * `name === <name>` and `cache_path` still exists. Mirrors
 * `isClaudePluginInstalled` for the Copilot side.
 */
export function isCopilotPluginInstalled(name: string): boolean {
  for (const entry of readCopilotInstalledPlugins()) {
    if (entry.name !== name) continue;
    if (entry.cache_path && fs.existsSync(entry.cache_path)) return true;
  }
  return false;
}

/** True when ~/.codex/config.toml enables `<name>@*` and its cache tree exists. */
export function isCodexPluginInstalled(name: string): boolean {
  for (const entry of readCodexInstalledPlugins()) {
    if (entry.name !== name || entry.enabled !== true) continue;
    if (entry.cachePath && fs.existsSync(entry.cachePath)) return true;
  }
  return false;
}

interface ClaudeInstallEntry {
  scope?: string;
  installPath?: string;
  version?: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;
}

interface ClaudeInstalledPluginsFile {
  version?: number;
  plugins?: Record<string, ClaudeInstallEntry[]>;
}

/**
 * Surface plugins that Claude Code installed via `/plugin install` so the
 * toolkit can show them to the user and mirror them across every other
 * detected provider (Codex/Copilot/Cursor/Amp/VS Code).
 *
 * Source of truth: `~/.claude/plugins/installed_plugins.json` lists every
 * installed plugin keyed `<plugin>@<marketplace>` with the absolute
 * `installPath` of the version-pinned cache dir. Each entry's path itself
 * carries a real plugin manifest, so we let the existing plugin readers do
 * the work — just pointing them at Claude's cache instead of toolkit's.
 *
 * Returned entries use `source: 'claude'` and a `path` relative to
 * `CLAUDE_PLUGIN_CACHE_DIR` so the existing installer (which calls
 * `getSourceRoot(source)`) resolves them transparently.
 */
export function scanClaudeInstalledPlugins(): CatalogEntry[] {
  if (!fs.existsSync(CLAUDE_PLUGIN_INSTALLED_JSON)) return [];

  let raw: ClaudeInstalledPluginsFile;
  try {
    raw = JSON.parse(fs.readFileSync(CLAUDE_PLUGIN_INSTALLED_JSON, 'utf8')) as ClaudeInstalledPluginsFile;
  } catch {
    return [];
  }

  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();

  for (const [key, installs] of Object.entries(raw.plugins || {})) {
    const install = Array.isArray(installs) ? installs[0] : null;
    if (!install?.installPath || !fs.existsSync(install.installPath)) continue;

    let manifest;
    try {
      manifest = loadPluginManifest(install.installPath);
    } catch {
      continue;
    }

    // Plugin keys look like `<plugin>@<marketplace>`. The plugin name we
    // surface in the catalog is the un-namespaced part — that's what the
    // user types into `toolkit plugin <name>`.
    const name = manifest.name || key.split('@')[0];
    if (!name || seen.has(name)) continue;
    seen.add(name);

    // Resolve a path relative to CLAUDE_PLUGIN_CACHE_DIR so the existing
    // installer (`path.join(getSourceRoot('claude'), entry.path)`) lands on
    // the right directory. realpath-resolve both sides first — Claude's
    // installPath is the absolute string written at install time, but the
    // cache dir or HOME could be a symlink (test harnesses do this), so a
    // raw `path.relative` would emit `..`-only paths and we'd skip valid
    // plugins.
    const realCacheDir = realpath(CLAUDE_PLUGIN_CACHE_DIR);
    const realInstallPath = realpath(install.installPath);
    let relPath = path.relative(realCacheDir, realInstallPath);
    if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
      // Plugin lives outside the conventional cache dir (custom scope).
      // Skip rather than produce a broken install — `path.join(cacheRoot, '/abs')`
      // doesn't override the root, it concatenates and breaks.
      continue;
    }

    entries.push({
      name,
      description: manifest.description || '',
      version: install.version || manifest.version,
      hash: install.gitCommitSha || install.version || hashDir(install.installPath),
      path: relPath,
      source: CLAUDE_NATIVE_SOURCE,
    });
  }

  return entries;
}

interface CopilotInstalledPlugin {
  name?: string;
  marketplace?: string;
  version?: string;
  installed_at?: string;
  enabled?: boolean;
  cache_path?: string;
}

interface CopilotConfigFile {
  installedPlugins?: CopilotInstalledPlugin[];
}

/**
 * Read Copilot CLI's `~/.copilot/config.json` `installedPlugins[]` array.
 * This is the authoritative list of what Copilot considers installed,
 * covering both direct installs (`_direct/<id>`) and marketplace installs
 * (`<marketplace>/<plugin>`). Returns an empty array if the file is missing
 * or malformed.
 */
function readCopilotInstalledPlugins(): CopilotInstalledPlugin[] {
  try {
    // Copilot CLI ships `~/.copilot/config.json` with `//` header comments,
    // so strict JSON.parse would throw and silently hide every install. Use
    // the JSONC-tolerant reader so the comment header doesn't blank the
    // registry view.
    const raw = readJsoncOrNull<CopilotConfigFile>(COPILOT_CONFIG_JSON);
    if (!raw) return [];
    return Array.isArray(raw.installedPlugins) ? raw.installedPlugins : [];
  } catch {
    return [];
  }
}

/**
 * Surface plugins that GitHub Copilot CLI installed via `copilot plugin install`
 * (or the IDE equivalent). Mirrors `scanClaudeInstalledPlugins` for Copilot.
 *
 * Discovery is config-first: `~/.copilot/config.json` lists every installed
 * plugin with its `cache_path`. We use that as the source of truth so both
 * direct (`_direct/<id>`) and marketplace (`<marketplace>/<plugin>`) installs
 * are picked up. Falls back to walking `_direct/` only if config.json is
 * missing (fresh install with no registry yet).
 *
 * Returned entries use `source: 'copilot'` and a `path` relative to
 * `COPILOT_PLUGINS_ROOT` so the existing installer (which calls
 * `getSourceRoot(source)`) resolves them transparently.
 */
export function scanCopilotInstalledPlugins(): CatalogEntry[] {
  const results: CatalogEntry[] = [];
  const seen = new Set<string>();
  const registry = readCopilotInstalledPlugins();

  // Primary: config.json registry entries.
  for (const entry of registry) {
    if (!entry.cache_path || !fs.existsSync(entry.cache_path)) continue;
    let manifest;
    try { manifest = loadPluginManifest(entry.cache_path); } catch { continue; }
    const name = manifest.name || entry.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const realRoot = realpath(COPILOT_PLUGINS_ROOT);
    const realCachePath = realpath(entry.cache_path);
    let relPath = path.relative(realRoot, realCachePath);
    if (relPath.startsWith('..') || path.isAbsolute(relPath)) continue;

    results.push({
      name,
      description: manifest.description || '',
      version: entry.version || manifest.version,
      hash: entry.version || manifest.version || hashDir(entry.cache_path),
      path: relPath,
      source: COPILOT_NATIVE_SOURCE,
    });
  }

  // Fallback: walk _direct/ for plugins not in (or with no) config.json.
  if (fs.existsSync(COPILOT_PLUGIN_INSTALL_DIR)) {
    let dirEntries: fs.Dirent[];
    try { dirEntries = fs.readdirSync(COPILOT_PLUGIN_INSTALL_DIR, { withFileTypes: true }); } catch { dirEntries = []; }
    for (const dirEntry of dirEntries) {
      if (!dirEntry.isDirectory() || dirEntry.name.startsWith('.')) continue;
      const pluginDir = path.join(COPILOT_PLUGIN_INSTALL_DIR, dirEntry.name);
      let manifest;
      try { manifest = loadPluginManifest(pluginDir); } catch { continue; }
      const name = manifest.name;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      results.push({
        name,
        description: manifest.description || '',
        version: manifest.version,
        hash: manifest.version || hashDir(pluginDir),
        path: path.join('_direct', dirEntry.name),
        source: COPILOT_NATIVE_SOURCE,
      });
    }
  }

  return results;
}

interface CodexInstalledPlugin {
  name: string;
  marketplace: string;
  enabled: boolean;
  cachePath: string | null;
}

function readTomlTableBlocks(raw: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const lines = raw.split(/\r?\n/);
  let current: string | null = null;
  let body: string[] = [];

  const flush = (): void => {
    if (current) blocks.set(current, body.join('\n'));
    current = null;
    body = [];
  };

  for (const line of lines) {
    const match = line.match(/^\[([^\]]+)\]\s*$/);
    if (match) {
      flush();
      current = match[1];
      body = [];
    } else if (current) {
      body.push(line);
    }
  }
  flush();
  return blocks;
}

function codexPluginCachePath(name: string, marketplace: string): string | null {
  const pluginRoot = path.join(CODEX_PLUGIN_CACHE_DIR, marketplace, name);
  if (!fs.existsSync(pluginRoot)) return null;
  try {
    const versions = fs.readdirSync(pluginRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
      .sort();
    if (versions.length === 0) return null;
    return path.join(pluginRoot, versions[versions.length - 1]);
  } catch {
    return null;
  }
}

function readCodexInstalledPlugins(): CodexInstalledPlugin[] {
  if (!fs.existsSync(CODEX_CONFIG_TOML)) return [];
  let raw: string;
  try { raw = fs.readFileSync(CODEX_CONFIG_TOML, 'utf8'); } catch { return []; }

  const blocks = readTomlTableBlocks(raw);
  const results: CodexInstalledPlugin[] = [];
  for (const [header, body] of blocks) {
    const match = header.match(/^plugins\."([^"@]+)@([^"]+)"$/);
    if (!match) continue;
    const [, name, marketplace] = match;
    const enabled = /^\s*enabled\s*=\s*true\s*$/m.test(body);
    results.push({
      name,
      marketplace,
      enabled,
      cachePath: codexPluginCachePath(name, marketplace),
    });
  }
  return results;
}

/**
 * Surface plugins installed through Codex's native plugin config so toolkit
 * can discover them and, if requested, mirror/decompose them for other tools.
 */
export function scanCodexInstalledPlugins(): CatalogEntry[] {
  const results: CatalogEntry[] = [];
  const seen = new Set<string>();

  for (const entry of readCodexInstalledPlugins()) {
    if (!entry.enabled || !entry.cachePath || !fs.existsSync(entry.cachePath)) continue;
    let manifest;
    try { manifest = loadPluginManifest(entry.cachePath); } catch { continue; }
    const name = manifest.name || entry.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const realRoot = realpath(CODEX_PLUGIN_CACHE_DIR);
    const realCachePath = realpath(entry.cachePath);
    const relPath = path.relative(realRoot, realCachePath);
    if (relPath.startsWith('..') || path.isAbsolute(relPath)) continue;

    results.push({
      name,
      description: manifest.description || '',
      version: manifest.version,
      hash: manifest.version || hashDir(entry.cachePath),
      path: relPath,
      source: CODEX_NATIVE_SOURCE,
    });
  }

  return results;
}

/**
 * Uninstall a plugin from Copilot CLI's native plugin state — drop the
 * registry entry from `config.json`, remove enabledPlugins keys from
 * `settings.json`, and delete the plugin's cache_path directory (and the
 * marketplace dir above it if it ends up empty). Returns a summary the
 * caller can log so the user sees what was touched.
 *
 * Why this exists: when the user runs `toolkit remove plugin <name>` on a
 * plugin that came from Copilot's native install, the toolkit-decomposed
 * copies get cleaned but Copilot's own UI still shows the plugin as
 * installed. This closes that gap so one toolkit command fully uninstalls.
 *
 * Safe by design: each step is independently best-effort and never throws —
 * if Copilot rewrites config.json mid-flight, the worst case is a stale
 * registry entry that the user can clean by re-running.
 */
export interface CopilotUninstallResult {
  removedFromConfig: boolean;
  removedFromSettings: string[];
  removedCachePath: string | null;
  removedMarketplaceDir: string | null;
}

/** Mirror of Copilot's marketplace key for plugins toolkit-ai installed. */
const TOOLKIT_MARKETPLACE = 'toolkit-ai';

export interface CopilotInstallResult {
  /** New entry written to ~/.copilot/config.json's installedPlugins[]. */
  registeredInConfig: boolean;
  /** Updated existing entry instead of adding (replaces same-name entry). */
  replacedExistingConfig: boolean;
  /** Key added to ~/.copilot/settings.json enabledPlugins. */
  enabledInSettings: boolean;
  /** Plugin tree copied to this absolute dir, or null if it was already there. */
  copiedTo: string | null;
}

/**
 * Register a plugin with Copilot CLI's native plugin manager so it shows up
 * in Copilot's "Plugins" UI and the user can manage it from there too.
 *
 * Mirror of `uninstallCopilotPlugin`: copies the plugin tree to
 * `~/.copilot/installed-plugins/<marketplace>/<name>/`, adds an entry to
 * `~/.copilot/config.json` `installedPlugins[]`, and adds the matching key
 * to `~/.copilot/settings.json` `enabledPlugins`.
 *
 * Idempotency: if Copilot already lists a plugin with this name (any
 * marketplace), we update the existing entry's `cache_path` and version in
 * place rather than creating a duplicate. The plugin tree is rewritten so
 * Copilot picks up the latest content.
 *
 * Best-effort: each step is independently try/catch'd. If config.json or
 * settings.json is locked or malformed we skip the affected step rather
 * than abort the whole install.
 */
/**
 * Build a clean Copilot-facing plugin tree from the manifest's selected
 * components. Output layout is canonical (`agents/`, `skills/<name>/`,
 * `commands/`) so Copilot's recursive plugin scanner sees exactly one copy
 * of each component, regardless of how the source organized its tree.
 *
 * The manifest is rewritten with path overrides stripped — the destination
 * uses default locations, so any `agents: "agents/adapters/copilot/"`-style
 * declarations would point at empty dirs and confuse downstream tooling.
 */
type PluginTreeFlavor = 'claude' | 'codex' | 'copilot';

function renderCodexCommandFile(sourceText: string): string {
  const match = sourceText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return sourceText;

  const allowed = new Set(['description', 'argument-hint']);
  const kept = match[1]
    .split(/\r?\n/)
    .filter(line => {
      const key = line.match(/^\s*([A-Za-z0-9_-]+)\s*:/)?.[1];
      return key ? allowed.has(key) : false;
    });
  const body = sourceText.slice(match[0].length);
  return kept.length > 0 ? `---\n${kept.join('\n')}\n---\n\n${body}` : body;
}

function copyPluginTreeScoped(
  sourceDir: string,
  destDir: string,
  manifest: PluginManifest,
  contents: PluginContents,
  flavor: PluginTreeFlavor,
): void {
  ensureDir(destDir);

  // Manifest with path overrides stripped — components live at canonical
  // locations in the copied tree, so the source-side overrides no longer apply.
  const canonicalManifest: Record<string, unknown> = { ...manifest };
  delete canonicalManifest.agents;
  delete canonicalManifest.skills;
  delete canonicalManifest.commands;
  delete canonicalManifest.mcps;

  const claudeManifestPath = path.join(sourceDir, '.claude-plugin', 'plugin.json');
  const rootManifestPath = path.join(sourceDir, 'plugin.json');
  if (fs.existsSync(claudeManifestPath)) {
    writeJsonAtomic(path.join(destDir, '.claude-plugin', 'plugin.json'), canonicalManifest);
  }
  // Codex's native loader expects a .codex-plugin manifest. Always emit one
  // for scoped plugin copies so Claude-shaped and generic plugins can be
  // registered natively with Codex without preserving source-only path
  // overrides that no longer exist in the canonical destination layout.
  writeJsonAtomic(path.join(destDir, '.codex-plugin', 'plugin.json'), canonicalManifest);
  if (fs.existsSync(rootManifestPath)) {
    writeJsonAtomic(path.join(destDir, 'plugin.json'), canonicalManifest);
  }
  if (!fs.existsSync(rootManifestPath) && !fs.existsSync(claudeManifestPath)) {
    writeJsonAtomic(path.join(destDir, 'plugin.json'), canonicalManifest);
  }

  // Best-effort copy of common plugin metadata files at the root.
  for (const file of ['README.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    const src = path.join(sourceDir, file);
    if (fs.existsSync(src)) {
      try { fs.copyFileSync(src, path.join(destDir, file)); } catch { /* ignore */ }
    }
  }

  for (const skill of contents.skills) {
    const dest = path.join(destDir, 'skills', skill.name);
    ensureDir(path.dirname(dest));
    copyDirRecursive(skill.absPath, dest);
  }

  // Root-level files inside skills/ (e.g. .ams-stack-index) aren't enumerated
  // as skills but the plugin may rely on them at runtime. Copy them verbatim.
  const srcSkillsDir = path.join(sourceDir, 'skills');
  if (fs.existsSync(srcSkillsDir)) {
    for (const entry of fs.readdirSync(srcSkillsDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        const src = path.join(srcSkillsDir, entry.name);
        const dst = path.join(destDir, 'skills', entry.name);
        ensureDir(path.dirname(dst));
        try { fs.copyFileSync(src, dst); } catch { /* ignore */ }
      }
    }
  }

  for (const agent of contents.agents) {
    const dest = path.join(destDir, 'agents', path.basename(agent.absPath));
    ensureDir(path.dirname(dest));
    try { fs.copyFileSync(agent.absPath, dest); } catch { /* ignore */ }
  }

  for (const cmd of contents.commands) {
    const dest = path.join(destDir, 'commands', path.basename(cmd.absPath));
    ensureDir(path.dirname(dest));
    try {
      if (flavor === 'codex') {
        fs.writeFileSync(dest, renderCodexCommandFile(fs.readFileSync(cmd.absPath, 'utf8')), 'utf8');
      } else {
        fs.copyFileSync(cmd.absPath, dest);
      }
    } catch { /* ignore */ }
  }

  for (const mcp of contents.mcpConfigs) {
    const dest = path.join(destDir, mcp.relPath);
    ensureDir(path.dirname(dest));
    try { fs.copyFileSync(mcp.absPath, dest); } catch { /* ignore */ }
  }

  // Hooks. The toolkit refuses to write hooks into the user's
  // ~/.claude/settings.json (no scanner coverage on the command strings yet),
  // but a Claude/Copilot **plugin** install is different: the hook entries
  // live inside the plugin's own tree, Claude scopes them to the plugin
  // lifecycle, and they're trivial to revert by removing the plugin. Copy
  // the hooks dir verbatim so `hooks/hooks.json` (and any scripts it
  // references) ride along with the plugin install.
  const hooksDir = path.join(sourceDir, 'hooks');
  if (fs.existsSync(hooksDir)) {
    try { copyDirRecursive(hooksDir, path.join(destDir, 'hooks')); } catch { /* ignore */ }
  }
}

/**
 * Tool-flavor hooks.json swap. A plugin can ship multiple hook configs
 * and let the installer pick the right one per tool, since Claude /
 * Copilot / Codex disagree on event names, env vars, and matcher shape.
 *
 * Convention: if `<destDir>/hooks/configs/<tool>.hooks.json` exists, its
 * contents (with `__AMS_PLUGIN_ROOT__` replaced by `destDir`) overwrite
 * `<destDir>/hooks/hooks.json` for that tool's install. The Claude flavor
 * stays as the default `hooks/hooks.json` shipped by the plugin and is
 * what Claude itself picks up — no swap needed there.
 *
 * Best-effort: returns silently on any I/O error so a malformed template
 * never blocks an otherwise valid plugin install.
 */
export function applyToolFlavoredHooks(destDir: string, tool: 'copilot' | 'codex'): boolean {
  try {
    const template = path.join(destDir, 'hooks', 'configs', `${tool}.hooks.json`);
    if (!fs.existsSync(template)) return false;
    const raw = fs.readFileSync(template, 'utf8');
    // Hook commands run under bash on every platform (Git Bash on Windows).
    // path.join returns native separators, so on Windows destDir has
    // backslashes; substituting them verbatim into a bash command string
    // can collide with bash escape sequences ($, `, ", \). Normalize to
    // POSIX-style forward slashes — bash on Windows handles forward
    // slashes everywhere, and no-op on macOS/Linux where sep is already /.
    const posixDest = destDir.replace(/\\/g, '/').split(path.sep).join('/');
    const rendered = raw.split('__AMS_PLUGIN_ROOT__').join(posixDest);
    const target = path.join(destDir, 'hooks', 'hooks.json');
    fs.writeFileSync(target, rendered, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function installCopilotPlugin(
  name: string,
  sourcePluginDir: string,
  manifest: PluginManifest,
  contents?: PluginContents,
): CopilotInstallResult {
  const result: CopilotInstallResult = {
    registeredInConfig: false,
    replacedExistingConfig: false,
    enabledInSettings: false,
    copiedTo: null,
  };

  // Look up an existing registry entry first so we can preserve marketplace
  // and reuse the user's chosen cache_path (don't relocate plugins Copilot
  // CLI installed at a specific path).
  let existing: CopilotInstalledPlugin | null = null;
  let configRaw: Record<string, unknown> = {};
  let configWritable = true;
  try {
    const parsed = readJsoncOrNull<Record<string, unknown>>(COPILOT_CONFIG_JSON);
    if (parsed !== null) {
      configRaw = parsed;
      const list = Array.isArray(configRaw.installedPlugins) ? configRaw.installedPlugins as CopilotInstalledPlugin[] : [];
      existing = list.find(p => p.name === name) || null;
    }
  } catch {
    // File exists but is malformed -- refuse to overwrite. Default-to-empty
    // here would clobber whatever the user / Copilot is mid-write on.
    configWritable = false;
  }

  const marketplace = existing?.marketplace || TOOLKIT_MARKETPLACE;
  const destDir = existing?.cache_path || path.join(COPILOT_PLUGINS_ROOT, marketplace, name);

  // Copy the plugin tree if the destination differs from the source. When
  // toolkit's install came from `copilot` source, sourcePluginDir already
  // equals destDir and copying would be a no-op self-copy — skip.
  //
  // When PluginContents is provided we do a SCOPED copy: only the components
  // the manifest selected (e.g. `agents: "agents/adapters/copilot/"`),
  // written at canonical locations under the destination. A wholesale copy
  // would also drop the unselected variants — e.g. AMS ships agents at both
  // `agents/<name>.md` (Claude flavor) and `agents/adapters/copilot/<name>.agent.md`,
  // and Copilot's plugin scanner walks the tree recursively, so both end up
  // in Copilot's UI as duplicates.
  try {
    if (path.resolve(sourcePluginDir) !== path.resolve(destDir)) {
      ensureDir(path.dirname(destDir));
      if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
      if (contents) {
        copyPluginTreeScoped(sourcePluginDir, destDir, manifest, contents, 'copilot');
      } else {
        copyDirRecursive(sourcePluginDir, destDir);
      }
      result.copiedTo = destDir;
    }
  } catch { /* best-effort copy */ }

  // Swap in the Copilot-flavor hooks.json if the plugin ships one.
  // Copilot's event names and command schema differ from Claude's, so
  // the canonical `hooks/hooks.json` (Claude flavor) doesn't run as-is.
  applyToolFlavoredHooks(destDir, 'copilot');

  // Update config.json — replace existing entry in place, or append.
  // Skip entirely when the read failed because the file was malformed:
  // writing an empty configRaw would erase every other Copilot setting.
  if (configWritable) {
    try {
      const installedAt = new Date().toISOString();
      const newEntry: CopilotInstalledPlugin = {
        name,
        marketplace,
        version: manifest.version || existing?.version || '0.0.0',
        installed_at: existing?.installed_at || installedAt,
        enabled: true,
        cache_path: destDir,
      };
      const list = Array.isArray(configRaw.installedPlugins) ? configRaw.installedPlugins as CopilotInstalledPlugin[] : [];
      const idx = list.findIndex(p => p.name === name);
      if (idx >= 0) {
        list[idx] = newEntry;
        result.replacedExistingConfig = true;
      } else {
        list.push(newEntry);
      }
      configRaw.installedPlugins = list;
      writeJsonAtomic(COPILOT_CONFIG_JSON, configRaw);
      result.registeredInConfig = true;
    } catch { /* best-effort registry update */ }
  }

  // Update settings.json — add to enabledPlugins under `<name>@<marketplace>`.
  // As with config.json above: if the existing file is malformed, refuse to
  // overwrite. Default-to-empty would wipe every other setting the user has.
  try {
    let settings: ({ enabledPlugins?: Record<string, boolean> } & Record<string, unknown>) = {};
    let writable = true;
    try {
      // Copilot's settings.json is JSONC-tolerant on Copilot's side; mirror
      // that here so a comment-prefixed file doesn't fail the read.
      const parsed = readJsoncOrNull<typeof settings>(COPILOT_SETTINGS_JSON);
      if (parsed !== null) settings = parsed;
    } catch { writable = false; }
    if (writable) {
      if (!settings.enabledPlugins) settings.enabledPlugins = {};
      const key = `${name}@${marketplace}`;
      if (!settings.enabledPlugins[key]) {
        settings.enabledPlugins[key] = true;
        writeJsonAtomic(COPILOT_SETTINGS_JSON, settings);
        result.enabledInSettings = true;
      }
    }
  } catch { /* best-effort settings update */ }

  return result;
}

export function uninstallCopilotPlugin(name: string): CopilotUninstallResult {
  const result: CopilotUninstallResult = {
    removedFromConfig: false,
    removedFromSettings: [],
    removedCachePath: null,
    removedMarketplaceDir: null,
  };

  // 1. config.json — drop from installedPlugins[] and capture cache_path.
  let cachePath: string | null = null;
  try {
    // JSONC-tolerant read: Copilot ships its own `//` comment header.
    const config = readJsoncOrNull<CopilotConfigFile & Record<string, unknown>>(COPILOT_CONFIG_JSON);
    if (!config) throw new Error('config absent or unreadable');
    const plugins = Array.isArray(config.installedPlugins) ? config.installedPlugins : [];
    const survivors = plugins.filter(p => {
      if (p.name === name) {
        if (p.cache_path && !cachePath) cachePath = p.cache_path;
        return false;
      }
      return true;
    });
    if (survivors.length !== plugins.length) {
      config.installedPlugins = survivors;
      writeJsonAtomic(COPILOT_CONFIG_JSON, config);
      result.removedFromConfig = true;
    }
  } catch { /* config absent or unreadable — nothing to do */ }

  // 2. settings.json — drop matching enabledPlugins keys.
  // Keys look like `<plugin-name>@<marketplace>` or sometimes bare `<name>`.
  try {
    const settings = readJsoncOrNull<{ enabledPlugins?: Record<string, boolean> } & Record<string, unknown>>(COPILOT_SETTINGS_JSON);
    if (settings && settings.enabledPlugins && typeof settings.enabledPlugins === 'object') {
      const toRemove = Object.keys(settings.enabledPlugins).filter(k => k === name || k.startsWith(`${name}@`));
      for (const k of toRemove) delete settings.enabledPlugins[k];
      if (toRemove.length > 0) {
        writeJsonAtomic(COPILOT_SETTINGS_JSON, settings);
        result.removedFromSettings = toRemove;
      }
    }
  } catch { /* settings absent or unreadable */ }

  // 3. Delete the cache dir and the empty marketplace parent.
  if (cachePath && fs.existsSync(cachePath)) {
    try {
      fs.rmSync(cachePath, { recursive: true, force: true });
      result.removedCachePath = cachePath;
      const parent = path.dirname(cachePath);
      // Only auto-clean the marketplace parent if it's now empty AND it
      // lives inside ~/.copilot/installed-plugins (don't recurse upward).
      if (parent.startsWith(COPILOT_PLUGINS_ROOT) && parent !== COPILOT_PLUGINS_ROOT) {
        try {
          if (fs.readdirSync(parent).length === 0) {
            fs.rmdirSync(parent);
            result.removedMarketplaceDir = parent;
          }
        } catch { /* parent not empty or already gone */ }
      }
    } catch { /* ignore — best-effort cleanup */ }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Native Codex plugin install / uninstall
// ---------------------------------------------------------------------------

export interface CodexInstallResult {
  /** Plugin tree copied to this absolute dir, or null if it was already there. */
  copiedTo: string | null;
  /** [marketplaces.toolkit-ai] was written or refreshed in ~/.codex/config.toml. */
  registeredMarketplace: boolean;
  /** [plugins."<name>@toolkit-ai"] enabled=true was written in ~/.codex/config.toml. */
  enabledInConfig: boolean;
}

export interface CodexUninstallResult {
  removedFromConfig: boolean;
  removedCachePath: string | null;
  removedMarketplaceDir: string | null;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function removeTomlTable(raw: string, tableName: string): { text: string; removed: boolean } {
  const lines = raw.split(/\r?\n/);
  const next: string[] = [];
  let removed = false;
  let skipping = false;
  const header = `[${tableName}]`;

  for (const line of lines) {
    if (line.trim() === header) {
      removed = true;
      skipping = true;
      continue;
    }
    if (skipping && /^\[[^\]]+\]\s*$/.test(line)) {
      skipping = false;
    }
    if (!skipping) next.push(line);
  }

  return { text: next.join('\n').replace(/\n{3,}$/g, '\n\n'), removed };
}

function upsertTomlTable(raw: string, tableName: string, body: string[]): { text: string; replaced: boolean } {
  const without = removeTomlTable(raw, tableName);
  const prefix = without.text.trimEnd();
  const block = [`[${tableName}]`, ...body].join('\n');
  return {
    text: `${prefix ? `${prefix}\n\n` : ''}${block}\n`,
    replaced: without.removed,
  };
}

function updateCodexConfigForPlugin(name: string, version: string): { marketplace: boolean; plugin: boolean } {
  let raw = '';
  try {
    if (fs.existsSync(CODEX_CONFIG_TOML)) raw = fs.readFileSync(CODEX_CONFIG_TOML, 'utf8');
  } catch {
    return { marketplace: false, plugin: false };
  }

  const marketplaceDir = path.join(CODEX_PLUGIN_CACHE_DIR, TOOLKIT_MARKETPLACE);
  const marketplace = upsertTomlTable(raw, `marketplaces.${TOOLKIT_MARKETPLACE}`, [
    'source_type = "local"',
    `source = ${tomlString(marketplaceDir)}`,
    `last_updated = ${tomlString(new Date().toISOString())}`,
  ]);
  const plugin = upsertTomlTable(marketplace.text, `plugins."${name}@${TOOLKIT_MARKETPLACE}"`, [
    'enabled = true',
    `version = ${tomlString(version)}`,
  ]);

  try {
    ensureDir(path.dirname(CODEX_CONFIG_TOML));
    fs.writeFileSync(CODEX_CONFIG_TOML, plugin.text, 'utf8');
    return { marketplace: true, plugin: true };
  } catch {
    return { marketplace: false, plugin: false };
  }
}

export function installCodexPlugin(
  name: string,
  sourcePluginDir: string,
  manifest: PluginManifest,
  contents?: PluginContents,
): CodexInstallResult {
  const result: CodexInstallResult = {
    copiedTo: null,
    registeredMarketplace: false,
    enabledInConfig: false,
  };

  const version = manifest.version || '0.0.0';
  const destDir = path.join(CODEX_PLUGIN_CACHE_DIR, TOOLKIT_MARKETPLACE, name, version);

  try {
    if (path.resolve(sourcePluginDir) !== path.resolve(destDir)) {
      ensureDir(path.dirname(destDir));
      if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
      if (contents) {
        copyPluginTreeScoped(sourcePluginDir, destDir, manifest, contents, 'codex');
      } else {
        copyDirRecursive(sourcePluginDir, destDir);
      }
      result.copiedTo = destDir;
    }
  } catch { /* best-effort copy */ }

  // Swap in the Codex-flavor hooks.json if the plugin ships one. No
  // public spec yet for Codex hook events, so plugins that need a Codex
  // variant ship hooks/configs/codex.hooks.json explicitly; without one,
  // Codex falls back to the canonical Claude-flavor hooks.json.
  applyToolFlavoredHooks(destDir, 'codex');

  const config = updateCodexConfigForPlugin(name, version);
  result.registeredMarketplace = config.marketplace;
  result.enabledInConfig = config.plugin;

  return result;
}

export function uninstallCodexPlugin(name: string): CodexUninstallResult {
  const result: CodexUninstallResult = {
    removedFromConfig: false,
    removedCachePath: null,
    removedMarketplaceDir: null,
  };

  try {
    if (fs.existsSync(CODEX_CONFIG_TOML)) {
      const raw = fs.readFileSync(CODEX_CONFIG_TOML, 'utf8');
      const plugin = removeTomlTable(raw, `plugins."${name}@${TOOLKIT_MARKETPLACE}"`);
      if (plugin.removed) {
        const next = plugin.text.includes(`@${TOOLKIT_MARKETPLACE}"]`)
          ? plugin.text
          : removeTomlTable(plugin.text, `marketplaces.${TOOLKIT_MARKETPLACE}`).text;
        fs.writeFileSync(CODEX_CONFIG_TOML, next, 'utf8');
        result.removedFromConfig = true;
      }
    }
  } catch { /* leave config untouched on malformed/unwritable files */ }

  const pluginRoot = path.join(CODEX_PLUGIN_CACHE_DIR, TOOLKIT_MARKETPLACE, name);
  if (fs.existsSync(pluginRoot)) {
    try {
      fs.rmSync(pluginRoot, { recursive: true, force: true });
      result.removedCachePath = pluginRoot;
      const marketplaceRoot = path.dirname(pluginRoot);
      try {
        if (fs.readdirSync(marketplaceRoot).length === 0) {
          fs.rmdirSync(marketplaceRoot);
          result.removedMarketplaceDir = marketplaceRoot;
        }
      } catch { /* not empty */ }
    } catch { /* best-effort cleanup */ }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Native Claude Code plugin install / uninstall
// ---------------------------------------------------------------------------

export interface ClaudeInstallResult {
  /** New entry added to ~/.claude/plugins/installed_plugins.json. */
  registeredInInstalled: boolean;
  /** Replaced an existing entry instead of appending. */
  replacedExistingInstalled: boolean;
  /** Plugin tree copied to this absolute dir, or null if it was already there. */
  copiedTo: string | null;
}

export interface ClaudeUninstallResult {
  removedFromInstalled: boolean;
  removedCachePath: string | null;
}

/**
 * Register a plugin with Claude Code's native plugin manager so Claude
 * surfaces it under "Plugins" without us having to also decompose into
 * ~/.claude/skills/ and ~/.claude/agents/. Mirror of `installCopilotPlugin`.
 *
 * Why this matters for duplicates: Copilot's "Agent Customizations" UI
 * reads from ~/.claude/agents/ for cross-tool compatibility. If we
 * decomposed there AND copied the plugin tree into Copilot's
 * installed-plugins dir, every agent would show up twice in Copilot's UI.
 * Going native on Claude lets us skip ~/.claude/agents/ entirely while
 * keeping the plugin visible in Claude itself.
 *
 * Trade-off accepted: editing installed_plugins.json from outside Claude's
 * `/plugin` command bypasses the marketplace/signature flow Claude expects.
 * This is fine for toolkit-managed plugins because we own the source and
 * already scanned it; it would not be appropriate for third-party content
 * we haven't vetted.
 */
export function installClaudePlugin(
  name: string,
  sourcePluginDir: string,
  manifest: PluginManifest,
  contents?: PluginContents,
): ClaudeInstallResult {
  const result: ClaudeInstallResult = {
    registeredInInstalled: false,
    replacedExistingInstalled: false,
    copiedTo: null,
  };

  const version = manifest.version || '0.0.0';
  const key = `${name}@${TOOLKIT_MARKETPLACE}`;
  const destDir = path.join(CLAUDE_PLUGIN_CACHE_DIR, TOOLKIT_MARKETPLACE, name, version);

  try {
    if (path.resolve(sourcePluginDir) !== path.resolve(destDir)) {
      ensureDir(path.dirname(destDir));
      if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
      if (contents) {
        copyPluginTreeScoped(sourcePluginDir, destDir, manifest, contents, 'claude');
      } else {
        copyDirRecursive(sourcePluginDir, destDir);
      }
      result.copiedTo = destDir;
    }
  } catch { /* best-effort copy */ }

  // Update installed_plugins.json. Refuse to overwrite if the existing file
  // is malformed -- default-to-empty would wipe every other plugin Claude
  // installed natively.
  try {
    let raw: ClaudeInstalledPluginsFile = { version: 2, plugins: {} };
    let writable = true;
    try {
      const parsed = readJsonOrNull<ClaudeInstalledPluginsFile>(CLAUDE_PLUGIN_INSTALLED_JSON);
      if (parsed !== null) raw = parsed;
    } catch { writable = false; }
    if (writable) {
      if (!raw.plugins) raw.plugins = {};
      const now = new Date().toISOString();
      const existing = raw.plugins[key]?.[0];
      const entry: ClaudeInstallEntry = {
        scope: existing?.scope || 'user',
        installPath: destDir,
        version,
        installedAt: existing?.installedAt || now,
        lastUpdated: now,
      };
      if (existing?.gitCommitSha) entry.gitCommitSha = existing.gitCommitSha;
      if (raw.plugins[key]) result.replacedExistingInstalled = true;
      raw.plugins[key] = [entry];
      writeJsonAtomic(CLAUDE_PLUGIN_INSTALLED_JSON, raw);
      result.registeredInInstalled = true;
    }
  } catch { /* best-effort registry update */ }

  // Claude only loads plugins whose marketplace is registered in
  // known_marketplaces.json AND whose marketplace directory holds a
  // matching .claude-plugin/marketplace.json. Without these, the
  // installed_plugins.json entry above is recognized in the registry
  // but commands / agents / skills never load at runtime. Mirror the
  // shape Claude expects when the user installs from a real marketplace.
  try {
    registerToolkitMarketplaceForPlugin(name, version, manifest.description, destDir);
  } catch { /* best-effort marketplace wiring */ }

  // Claude treats plugins as disabled-by-default until the user's
  // settings.json `enabledPlugins` map flips them on. Without this,
  // `claude plugin list` shows the plugin as `✘ disabled` and none of
  // its commands / agents / skills load. Mirror what `claude plugin
  // enable <name>@<marketplace>` writes.
  // settings.json::enabledPlugins. Same refuse-on-malformed pattern -- this
  // file holds every user setting Claude has, and a corrupt-then-clobber
  // would silently wipe them all.
  try {
    let settings: { enabledPlugins?: Record<string, boolean> } & Record<string, unknown> = {};
    let writable = true;
    try {
      const parsed = readJsonOrNull<typeof settings>(CLAUDE_SETTINGS_JSON);
      if (parsed !== null) settings = parsed;
    } catch { writable = false; }
    if (writable) {
      if (!settings.enabledPlugins || typeof settings.enabledPlugins !== 'object') settings.enabledPlugins = {};
      if (settings.enabledPlugins[key] !== true) {
        settings.enabledPlugins[key] = true;
        writeJsonAtomic(CLAUDE_SETTINGS_JSON, settings);
      }
    }
  } catch { /* best-effort settings update */ }

  return result;
}

/**
 * Ensure the synthetic `toolkit-ai` marketplace is registered in Claude's
 * known_marketplaces.json and has a `marketplace.json` listing the plugin.
 * Idempotent — re-registering the same plugin updates the existing entry.
 */
function registerToolkitMarketplaceForPlugin(
  pluginName: string,
  version: string,
  description: string | undefined,
  cacheDir: string,
): void {
  const marketplaceDir = path.join(CLAUDE_MARKETPLACES_DIR, TOOLKIT_MARKETPLACE);
  const marketplaceManifestPath = path.join(marketplaceDir, '.claude-plugin', 'marketplace.json');
  ensureDir(path.dirname(marketplaceManifestPath));

  // Point `<marketplace>/<plugin>` at the plugin cache so the relative
  // `source: "./<plugin>"` in marketplace.json resolves. Symlink is the
  // happy path. Windows without Developer Mode (or admin) refuses
  // symlinkSync, so fall back to a real recursive copy. If a stale real
  // directory occupies the path, rm it before retrying.
  const pluginLink = path.join(marketplaceDir, pluginName);
  const replaceWithSymlink = (): boolean => {
    try { fs.symlinkSync(cacheDir, pluginLink, 'dir'); return true; } catch { return false; }
  };
  try {
    const stat = fs.lstatSync(pluginLink, { throwIfNoEntry: false });
    if (stat) {
      if (stat.isSymbolicLink() || stat.isFile()) fs.unlinkSync(pluginLink);
      else if (stat.isDirectory()) fs.rmSync(pluginLink, { recursive: true, force: true });
    }
  } catch { /* nothing to clear */ }
  if (!replaceWithSymlink()) {
    // Windows non-dev-mode path: copy the cache tree under the marketplace
    // dir so Claude's relative-`source` lookup still finds the plugin.
    try { copyDirRecursive(cacheDir, pluginLink); } catch { /* best-effort */ }
  }

  // Read existing marketplace manifest (if any) and merge our plugin entry.
  // Refuse to overwrite a malformed existing manifest -- another plugin's
  // entry in there would be lost.
  type MarketplacePlugin = { name: string; source?: string; description?: string; version?: string };
  type MarketplaceManifest = { name?: string; description?: string; owner?: { name?: string }; plugins?: MarketplacePlugin[] };
  let manifest: MarketplaceManifest = {};
  let manifestWritable = true;
  try {
    const parsed = readJsonOrNull<MarketplaceManifest>(marketplaceManifestPath);
    if (parsed !== null) manifest = parsed;
  } catch { manifestWritable = false; }
  if (manifestWritable) {
    manifest.name = TOOLKIT_MARKETPLACE;
    manifest.description = manifest.description || 'Synthetic marketplace for plugins installed via the toolkit-ai CLI.';
    manifest.owner = manifest.owner || { name: 'toolkit-ai' };
    const plugins: MarketplacePlugin[] = Array.isArray(manifest.plugins) ? manifest.plugins : [];
    const idx = plugins.findIndex(p => p?.name === pluginName);
    const pluginEntry: MarketplacePlugin = {
      name: pluginName,
      source: `./${pluginName}`,
      description,
      version,
    };
    if (idx >= 0) plugins[idx] = pluginEntry;
    else plugins.push(pluginEntry);
    manifest.plugins = plugins;
    writeJsonAtomic(marketplaceManifestPath, manifest);
  }

  // Register the marketplace in known_marketplaces.json. Same refuse-on-
  // malformed pattern -- losing other marketplace entries would render
  // every other toolkit-installed plugin unloadable.
  type KnownMarketplaces = Record<string, { source?: unknown; installLocation?: string; lastUpdated?: string }>;
  let known: KnownMarketplaces = {};
  let knownWritable = true;
  try {
    const parsed = readJsonOrNull<KnownMarketplaces>(CLAUDE_KNOWN_MARKETPLACES_JSON);
    if (parsed !== null) known = parsed;
  } catch { knownWritable = false; }
  if (!knownWritable) return;
  known[TOOLKIT_MARKETPLACE] = {
    source: { source: 'directory', path: marketplaceDir },
    installLocation: marketplaceDir,
    lastUpdated: new Date().toISOString(),
  };
  writeJsonAtomic(CLAUDE_KNOWN_MARKETPLACES_JSON, known);
}

/**
 * Drop a plugin from the synthetic toolkit-ai marketplace. Removes the
 * symlink and the manifest entry. If the marketplace ends up with no
 * plugins, also removes the marketplace dir and the entry in
 * known_marketplaces.json so we leave no orphan registrations.
 */
function unregisterToolkitMarketplaceForPlugin(pluginName: string): void {
  const marketplaceDir = path.join(CLAUDE_MARKETPLACES_DIR, TOOLKIT_MARKETPLACE);
  const marketplaceManifestPath = path.join(marketplaceDir, '.claude-plugin', 'marketplace.json');
  const pluginLink = path.join(marketplaceDir, pluginName);

  // Remove the `<marketplace>/<plugin>` entry. If install fell back to a
  // recursive copy (Windows non-dev-mode), this is a real directory; if
  // the happy path took, it's a symlink. Handle both.
  try {
    const stat = fs.lstatSync(pluginLink, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink() || stat?.isFile()) fs.unlinkSync(pluginLink);
    else if (stat?.isDirectory()) fs.rmSync(pluginLink, { recursive: true, force: true });
  } catch { /* nothing to clear */ }

  type MarketplacePlugin = { name: string };
  type MarketplaceManifest = { plugins?: MarketplacePlugin[] };
  let manifest: MarketplaceManifest = {};
  try {
    const parsed = readJsonOrNull<MarketplaceManifest>(marketplaceManifestPath);
    if (parsed === null) return;
    manifest = parsed;
  } catch {
    // Refuse to touch a corrupt marketplace.json on uninstall too -- the
    // user can hand-repair; we won't overwrite.
    return;
  }
  const remaining = (manifest.plugins || []).filter(p => p?.name !== pluginName);

  if (remaining.length === 0) {
    try { fs.rmSync(marketplaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try {
      type KnownMarketplaces = Record<string, unknown>;
      const known = readJsonOrNull<KnownMarketplaces>(CLAUDE_KNOWN_MARKETPLACES_JSON);
      if (known && TOOLKIT_MARKETPLACE in known) {
        delete known[TOOLKIT_MARKETPLACE];
        writeJsonAtomic(CLAUDE_KNOWN_MARKETPLACES_JSON, known);
      }
    } catch { /* ignore -- malformed; leave the entry rather than wipe */ }
    return;
  }

  manifest.plugins = remaining;
  try { writeJsonAtomic(marketplaceManifestPath, manifest); } catch { /* ignore */ }
}

/**
 * Reverse of `installClaudePlugin`. Drops every entry whose key matches
 * `<name>@*` from `installed_plugins.json` and removes their cache dirs.
 * Only touches plugins under our own marketplace (`toolkit-ai`) — plugins
 * the user installed with `/plugin install` from real marketplaces are
 * left alone.
 */
export function uninstallClaudePlugin(name: string): ClaudeUninstallResult {
  const result: ClaudeUninstallResult = {
    removedFromInstalled: false,
    removedCachePath: null,
  };

  let raw: ClaudeInstalledPluginsFile;
  try {
    raw = JSON.parse(fs.readFileSync(CLAUDE_PLUGIN_INSTALLED_JSON, 'utf8')) as ClaudeInstalledPluginsFile;
  } catch {
    return result;
  }
  if (!raw.plugins) return result;

  const keysToRemove = Object.keys(raw.plugins).filter(k => {
    if (k !== `${name}@${TOOLKIT_MARKETPLACE}`) return false;
    const installPath = raw.plugins?.[k]?.[0]?.installPath;
    // Belt-and-suspenders: only delete entries whose installPath sits inside
    // our marketplace cache subtree, never anything Claude installed itself.
    return !installPath || installPath.startsWith(path.join(CLAUDE_PLUGIN_CACHE_DIR, TOOLKIT_MARKETPLACE) + path.sep);
  });
  if (keysToRemove.length === 0) return result;

  for (const k of keysToRemove) {
    const installPath = raw.plugins[k]?.[0]?.installPath;
    if (installPath && fs.existsSync(installPath)) {
      try {
        fs.rmSync(installPath, { recursive: true, force: true });
        if (!result.removedCachePath) result.removedCachePath = installPath;
        // Clean the empty version-parent and marketplace-parent dirs, but
        // never the marketplace root itself.
        for (const parent of [path.dirname(installPath), path.dirname(path.dirname(installPath))]) {
          const ourMarketplaceRoot = path.join(CLAUDE_PLUGIN_CACHE_DIR, TOOLKIT_MARKETPLACE);
          if (parent === ourMarketplaceRoot) break;
          try {
            if (fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
          } catch { /* not empty */ }
        }
      } catch { /* ignore */ }
    }
    delete raw.plugins[k];
  }
  try {
    writeJsonAtomic(CLAUDE_PLUGIN_INSTALLED_JSON, raw);
    result.removedFromInstalled = true;
  } catch { /* ignore */ }

  // Drop the plugin from the synthetic toolkit-ai marketplace so Claude
  // stops surfacing it after restart, and clean the marketplace registration
  // when no toolkit-managed plugins remain.
  try { unregisterToolkitMarketplaceForPlugin(name); } catch { /* best-effort */ }

  // Remove the enabledPlugins entry so a future re-install starts from a
  // clean state and `claude plugin list` no longer references a dangling key.
  // Refuse to touch a malformed settings.json -- we'd rather leave a stale
  // key than wipe every other Claude setting.
  try {
    const settings = readJsonOrNull<{ enabledPlugins?: Record<string, boolean> } & Record<string, unknown>>(CLAUDE_SETTINGS_JSON);
    if (settings && settings.enabledPlugins && typeof settings.enabledPlugins === 'object') {
      const toRemove = Object.keys(settings.enabledPlugins).filter(k => k === name || k.startsWith(`${name}@`));
      for (const k of toRemove) delete settings.enabledPlugins[k];
      if (toRemove.length > 0) writeJsonAtomic(CLAUDE_SETTINGS_JSON, settings);
    }
  } catch { /* malformed -- leave intact */ }

  return result;
}
