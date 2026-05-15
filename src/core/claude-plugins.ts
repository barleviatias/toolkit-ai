import fs from 'fs';
import path from 'path';
import type { CatalogEntry, PluginContents, PluginManifest } from '../types.js';
import { ensureDir, copyDirRecursive } from './fs-helpers.js';
import {
  CLAUDE_KNOWN_MARKETPLACES_JSON,
  CLAUDE_MARKETPLACES_DIR,
  CLAUDE_NATIVE_SOURCE,
  CLAUDE_PLUGIN_CACHE_DIR,
  CLAUDE_PLUGIN_INSTALLED_JSON,
  CLAUDE_SETTINGS_JSON,
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
 * toolkit can show them to the user and offer to decompose-install them
 * across every other detected provider (Codex/Copilot/Cursor/Amp/VS Code).
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
  if (!fs.existsSync(COPILOT_CONFIG_JSON)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(COPILOT_CONFIG_JSON, 'utf8')) as CopilotConfigFile;
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
        hash: manifest.version || hashDir(pluginDir),
        path: path.join('_direct', dirEntry.name),
        source: COPILOT_NATIVE_SOURCE,
      });
    }
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
function copyPluginTreeScoped(
  sourceDir: string,
  destDir: string,
  manifest: PluginManifest,
  contents: PluginContents,
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
    ensureDir(path.join(destDir, '.claude-plugin'));
    fs.writeFileSync(
      path.join(destDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify(canonicalManifest, null, 2),
    );
  }
  if (fs.existsSync(rootManifestPath)) {
    fs.writeFileSync(
      path.join(destDir, 'plugin.json'),
      JSON.stringify(canonicalManifest, null, 2),
    );
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

  for (const agent of contents.agents) {
    const dest = path.join(destDir, 'agents', path.basename(agent.absPath));
    ensureDir(path.dirname(dest));
    try { fs.copyFileSync(agent.absPath, dest); } catch { /* ignore */ }
  }

  for (const cmd of contents.commands) {
    const dest = path.join(destDir, 'commands', path.basename(cmd.absPath));
    ensureDir(path.dirname(dest));
    try { fs.copyFileSync(cmd.absPath, dest); } catch { /* ignore */ }
  }

  for (const mcp of contents.mcpConfigs) {
    const dest = path.join(destDir, mcp.relPath);
    ensureDir(path.dirname(dest));
    try { fs.copyFileSync(mcp.absPath, dest); } catch { /* ignore */ }
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
  try {
    configRaw = JSON.parse(fs.readFileSync(COPILOT_CONFIG_JSON, 'utf8')) as Record<string, unknown>;
    const list = Array.isArray(configRaw.installedPlugins) ? configRaw.installedPlugins as CopilotInstalledPlugin[] : [];
    existing = list.find(p => p.name === name) || null;
  } catch { /* config absent — we'll create it */ }

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
        copyPluginTreeScoped(sourcePluginDir, destDir, manifest, contents);
      } else {
        copyDirRecursive(sourcePluginDir, destDir);
      }
      result.copiedTo = destDir;
    }
  } catch { /* best-effort copy */ }

  // Update config.json — replace existing entry in place, or append.
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
    ensureDir(path.dirname(COPILOT_CONFIG_JSON));
    fs.writeFileSync(COPILOT_CONFIG_JSON, JSON.stringify(configRaw, null, 2));
    result.registeredInConfig = true;
  } catch { /* best-effort registry update */ }

  // Update settings.json — add to enabledPlugins under `<name>@<marketplace>`.
  try {
    let settings: { enabledPlugins?: Record<string, boolean> } & Record<string, unknown> = {};
    try { settings = JSON.parse(fs.readFileSync(COPILOT_SETTINGS_JSON, 'utf8')) as typeof settings; } catch { /* defaults */ }
    if (!settings.enabledPlugins) settings.enabledPlugins = {};
    const key = `${name}@${marketplace}`;
    if (!settings.enabledPlugins[key]) {
      settings.enabledPlugins[key] = true;
      ensureDir(path.dirname(COPILOT_SETTINGS_JSON));
      fs.writeFileSync(COPILOT_SETTINGS_JSON, JSON.stringify(settings, null, 2));
      result.enabledInSettings = true;
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
    const config = JSON.parse(fs.readFileSync(COPILOT_CONFIG_JSON, 'utf8')) as CopilotConfigFile & Record<string, unknown>;
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
      fs.writeFileSync(COPILOT_CONFIG_JSON, JSON.stringify(config, null, 2));
      result.removedFromConfig = true;
    }
  } catch { /* config absent or unreadable — nothing to do */ }

  // 2. settings.json — drop matching enabledPlugins keys.
  // Keys look like `<plugin-name>@<marketplace>` or sometimes bare `<name>`.
  try {
    const settings = JSON.parse(fs.readFileSync(COPILOT_SETTINGS_JSON, 'utf8')) as { enabledPlugins?: Record<string, boolean> } & Record<string, unknown>;
    if (settings.enabledPlugins && typeof settings.enabledPlugins === 'object') {
      const toRemove = Object.keys(settings.enabledPlugins).filter(k => k === name || k.startsWith(`${name}@`));
      for (const k of toRemove) delete settings.enabledPlugins[k];
      if (toRemove.length > 0) {
        fs.writeFileSync(COPILOT_SETTINGS_JSON, JSON.stringify(settings, null, 2));
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
        copyPluginTreeScoped(sourcePluginDir, destDir, manifest, contents);
      } else {
        copyDirRecursive(sourcePluginDir, destDir);
      }
      result.copiedTo = destDir;
    }
  } catch { /* best-effort copy */ }

  try {
    let raw: ClaudeInstalledPluginsFile = { version: 2, plugins: {} };
    try { raw = JSON.parse(fs.readFileSync(CLAUDE_PLUGIN_INSTALLED_JSON, 'utf8')) as ClaudeInstalledPluginsFile; } catch { /* defaults */ }
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
    ensureDir(path.dirname(CLAUDE_PLUGIN_INSTALLED_JSON));
    fs.writeFileSync(CLAUDE_PLUGIN_INSTALLED_JSON, JSON.stringify(raw, null, 2));
    result.registeredInInstalled = true;
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
  try {
    let settings: { enabledPlugins?: Record<string, boolean> } & Record<string, unknown> = {};
    try { settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_JSON, 'utf8')) as typeof settings; } catch { /* fresh */ }
    if (!settings.enabledPlugins || typeof settings.enabledPlugins !== 'object') settings.enabledPlugins = {};
    if (settings.enabledPlugins[key] !== true) {
      settings.enabledPlugins[key] = true;
      ensureDir(path.dirname(CLAUDE_SETTINGS_JSON));
      fs.writeFileSync(CLAUDE_SETTINGS_JSON, JSON.stringify(settings, null, 2));
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

  // Symlink the cache dir under the marketplace dir so the relative
  // `source: "./<plugin>"` resolves to the actual plugin contents.
  const pluginLink = path.join(marketplaceDir, pluginName);
  try {
    if (fs.existsSync(pluginLink) || fs.lstatSync(pluginLink, { throwIfNoEntry: false })) {
      fs.unlinkSync(pluginLink);
    }
  } catch { /* link may not exist or may be a real dir; ignore */ }
  try { fs.symlinkSync(cacheDir, pluginLink, 'dir'); } catch { /* fall back to copy below */ }

  // Read existing marketplace manifest (if any) and merge our plugin entry.
  type MarketplacePlugin = { name: string; source?: string; description?: string; version?: string };
  type MarketplaceManifest = { name?: string; description?: string; owner?: { name?: string }; plugins?: MarketplacePlugin[] };
  let manifest: MarketplaceManifest = {};
  try { manifest = JSON.parse(fs.readFileSync(marketplaceManifestPath, 'utf8')) as MarketplaceManifest; } catch { /* fresh manifest */ }
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
  fs.writeFileSync(marketplaceManifestPath, JSON.stringify(manifest, null, 2));

  // Register the marketplace in known_marketplaces.json.
  type KnownMarketplaces = Record<string, { source?: unknown; installLocation?: string; lastUpdated?: string }>;
  let known: KnownMarketplaces = {};
  try { known = JSON.parse(fs.readFileSync(CLAUDE_KNOWN_MARKETPLACES_JSON, 'utf8')) as KnownMarketplaces; } catch { /* fresh registry */ }
  known[TOOLKIT_MARKETPLACE] = {
    source: { source: 'directory', path: marketplaceDir },
    installLocation: marketplaceDir,
    lastUpdated: new Date().toISOString(),
  };
  ensureDir(path.dirname(CLAUDE_KNOWN_MARKETPLACES_JSON));
  fs.writeFileSync(CLAUDE_KNOWN_MARKETPLACES_JSON, JSON.stringify(known, null, 2));
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
  try { fs.unlinkSync(pluginLink); } catch { /* ignore */ }

  type MarketplacePlugin = { name: string };
  type MarketplaceManifest = { plugins?: MarketplacePlugin[] };
  let manifest: MarketplaceManifest = {};
  try { manifest = JSON.parse(fs.readFileSync(marketplaceManifestPath, 'utf8')) as MarketplaceManifest; } catch { return; }
  const remaining = (manifest.plugins || []).filter(p => p?.name !== pluginName);

  if (remaining.length === 0) {
    try { fs.rmSync(marketplaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try {
      type KnownMarketplaces = Record<string, unknown>;
      const known = JSON.parse(fs.readFileSync(CLAUDE_KNOWN_MARKETPLACES_JSON, 'utf8')) as KnownMarketplaces;
      if (TOOLKIT_MARKETPLACE in known) {
        delete known[TOOLKIT_MARKETPLACE];
        fs.writeFileSync(CLAUDE_KNOWN_MARKETPLACES_JSON, JSON.stringify(known, null, 2));
      }
    } catch { /* ignore */ }
    return;
  }

  manifest.plugins = remaining;
  try { fs.writeFileSync(marketplaceManifestPath, JSON.stringify(manifest, null, 2)); } catch { /* ignore */ }
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
    fs.writeFileSync(CLAUDE_PLUGIN_INSTALLED_JSON, JSON.stringify(raw, null, 2));
    result.removedFromInstalled = true;
  } catch { /* ignore */ }

  // Drop the plugin from the synthetic toolkit-ai marketplace so Claude
  // stops surfacing it after restart, and clean the marketplace registration
  // when no toolkit-managed plugins remain.
  try { unregisterToolkitMarketplaceForPlugin(name); } catch { /* best-effort */ }

  // Remove the enabledPlugins entry so a future re-install starts from a
  // clean state and `claude plugin list` no longer references a dangling key.
  try {
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_JSON, 'utf8')) as { enabledPlugins?: Record<string, boolean> } & Record<string, unknown>;
    if (settings.enabledPlugins && typeof settings.enabledPlugins === 'object') {
      const toRemove = Object.keys(settings.enabledPlugins).filter(k => k === name || k.startsWith(`${name}@`));
      for (const k of toRemove) delete settings.enabledPlugins[k];
      if (toRemove.length > 0) fs.writeFileSync(CLAUDE_SETTINGS_JSON, JSON.stringify(settings, null, 2));
    }
  } catch { /* best-effort cleanup */ }

  return result;
}
