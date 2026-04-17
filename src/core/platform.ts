import fs from 'fs';
import path from 'path';
import os from 'os';
import type { McpServerEntry } from '../types.js';

export const HOME = os.homedir();

export const SKILL_TARGETS = [
  path.join(HOME, '.claude', 'skills'),
  path.join(HOME, '.copilot', 'skills'),
  path.join(HOME, '.agents', 'skills'),
];

export const AGENT_TARGETS = [
  path.join(HOME, '.claude', 'agents'),
  path.join(HOME, '.copilot', 'agents'),
];

export const CODEX_AGENT_TARGET = path.join(HOME, '.codex', 'agents');

// Claude Code plugin paths (verified observable on disk)
export const CLAUDE_SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json');
export const CLAUDE_PLUGIN_CACHE = path.join(HOME, '.claude', 'plugins', 'cache');
export const CLAUDE_INSTALLED_PLUGINS = path.join(HOME, '.claude', 'plugins', 'installed_plugins.json');
export const CLAUDE_KNOWN_MARKETPLACES = path.join(HOME, '.claude', 'plugins', 'known_marketplaces.json');
export const CLAUDE_MARKETPLACES_DIR = path.join(HOME, '.claude', 'plugins', 'marketplaces');

// Codex plugin paths (registry format per docs; install path is best-effort)
export const CODEX_CONFIG_TOML = path.join(HOME, '.codex', 'config.toml');
export const CODEX_PLUGINS_DIR = path.join(HOME, '.codex', 'plugins');

// Copilot CLI plugin paths (verified observable on disk)
export const COPILOT_CONFIG_PATH = path.join(HOME, '.copilot', 'config.json');
export const COPILOT_INSTALLED_PLUGINS_DIR = path.join(HOME, '.copilot', 'installed-plugins');

// Cursor plugin paths (filesystem-only, no documented registry)
export const CURSOR_PLUGINS_DIR = path.join(HOME, '.cursor', 'plugins');

// MCP config file paths
// Local: only written to if the file already exists (tool must be installed)
// Global: always written to, created if missing
const LOCAL_MCP_CONFIGS = [
  path.join(HOME, '.claude', 'settings.json'),
  path.join(HOME, '.vscode', 'mcp.json'),
  path.join(HOME, '.cursor', 'mcp.json'),
];

const GLOBAL_MCP_CONFIGS_ALL: { path: string; platform: NodeJS.Platform[] }[] = [
  { path: path.join(HOME, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json'), platform: ['win32'] },
  { path: path.join(HOME, 'AppData', 'Local', 'github-copilot', 'intellij', 'mcp.json'), platform: ['win32'] },
  { path: path.join(HOME, '.claude.json'), platform: ['darwin', 'linux', 'win32'] },
  { path: path.join(HOME, '.codex', 'config.toml'), platform: ['darwin', 'linux', 'win32'] },
];

// Filter global configs to current platform
export const GLOBAL_MCP_CONFIG_FILES = GLOBAL_MCP_CONFIGS_ALL
  .filter(c => c.platform.includes(process.platform))
  .map(c => c.path);

export const LOCAL_MCP_CONFIG_FILES = LOCAL_MCP_CONFIGS;
export const MCP_CONFIG_FILES = [...LOCAL_MCP_CONFIG_FILES, ...GLOBAL_MCP_CONFIG_FILES];

// ~/.toolkit/ — user-level config, state, and cache for the toolkit
export const TOOLKIT_HOME = path.join(HOME, '.toolkit');
export const LOCK_FILE = path.join(TOOLKIT_HOME, 'lock.json');
export const SOURCES_FILE = path.join(TOOLKIT_HOME, 'sources.json');
export const CACHE_DIR = path.join(TOOLKIT_HOME, 'cache');

/** Validate that a string is safe to use as a single path segment (no traversal, no slashes). */
export function assertSafePathSegment(value: string, label = 'path segment'): string {
  if (!value || value === '.' || value === '..') {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  if (path.isAbsolute(value) || /[\\/]/.test(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return value;
}

/** Determine the MCP config format for a given config file path. */
export function getConfigFormat(configPath: string): 'servers' | 'mcpServers' | 'codex-mcp' {
  if (configPath.endsWith(path.join('.codex', 'config.toml'))) return 'codex-mcp';
  const isVsCode = configPath.includes('.vscode') ||
    (configPath.includes('AppData') && configPath.includes('Code'));
  const isIntelliJ = configPath.includes('intellij');
  return (isVsCode || isIntelliJ) ? 'servers' : 'mcpServers';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`;
}

function sortRecord(record?: Record<string, string>): Record<string, string> | undefined {
  if (!record || Object.keys(record).length === 0) return undefined;
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
}

function normalizeCodexMcpEntry(entry: McpServerEntry): McpServerEntry {
  return {
    url: entry.url,
    command: entry.command,
    args: entry.args ? [...entry.args] : undefined,
    env: sortRecord(entry.env),
    envVars: entry.envVars ? [...entry.envVars] : undefined,
    cwd: entry.cwd,
    bearerTokenEnvVar: entry.bearerTokenEnvVar,
    httpHeaders: sortRecord(entry.httpHeaders),
    envHttpHeaders: sortRecord(entry.envHttpHeaders),
    startupTimeoutSec: entry.startupTimeoutSec,
    toolTimeoutSec: entry.toolTimeoutSec,
    enabled: entry.enabled,
    required: entry.required,
    enabledTools: entry.enabledTools ? [...entry.enabledTools] : undefined,
    disabledTools: entry.disabledTools ? [...entry.disabledTools] : undefined,
  };
}

function getCodexSectionPatterns(name: string): { main: RegExp; owned: RegExp } {
  const bare = escapeRegex(name);
  const quoted = escapeRegex(JSON.stringify(name));
  return {
    main: new RegExp(`^\\[mcp_servers\\.(?:${bare}|${quoted})\\]\\s*$`),
    owned: new RegExp(`^\\[mcp_servers\\.(?:${bare}|${quoted})(?:\\..+)?\\]\\s*$`),
  };
}

function findCodexSectionBounds(text: string, name: string): { start: number; end: number } | null {
  const lines = text.split(/\r?\n/);
  const { main, owned } = getCodexSectionPatterns(name);

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (main.test(lines[i].trim())) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('[')) continue;
    if (owned.test(trimmed)) continue;
    end = i;
    break;
  }

  return { start, end };
}

function parseTomlValue(raw: string): string | number | boolean | string[] {
  const value = raw.trim();
  if (value.startsWith('"')) return JSON.parse(value) as string;
  if (value.startsWith('[')) return JSON.parse(value) as string[];
  if (value === 'true') return true;
  if (value === 'false') return false;
  return Number(value);
}

/** Parse a `[mcp_servers.<name>]` section from Codex TOML config into an MCP entry. */
export function parseCodexMcpSection(text: string, name: string): McpServerEntry | null {
  const bounds = findCodexSectionBounds(text, name);
  if (!bounds) return null;

  const lines = text.split(/\r?\n/).slice(bounds.start, bounds.end);
  const config: McpServerEntry = {};
  let section: 'main' | 'env' | 'http_headers' | 'env_http_headers' = 'main';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[')) {
      if (trimmed.endsWith('.env]')) section = 'env';
      else if (trimmed.endsWith('.http_headers]')) section = 'http_headers';
      else if (trimmed.endsWith('.env_http_headers]')) section = 'env_http_headers';
      else section = 'main';
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!match) continue;

    const key = match[1];
    const value = parseTomlValue(match[2]);

    if (section === 'env') {
      if (!config.env) config.env = {};
      config.env[key] = String(value);
      continue;
    }
    if (section === 'http_headers') {
      if (!config.httpHeaders) config.httpHeaders = {};
      config.httpHeaders[key] = String(value);
      continue;
    }
    if (section === 'env_http_headers') {
      if (!config.envHttpHeaders) config.envHttpHeaders = {};
      config.envHttpHeaders[key] = String(value);
      continue;
    }

    if (key === 'url' && typeof value === 'string') config.url = value;
    else if (key === 'command' && typeof value === 'string') config.command = value;
    else if (key === 'cwd' && typeof value === 'string') config.cwd = value;
    else if (key === 'bearer_token_env_var' && typeof value === 'string') config.bearerTokenEnvVar = value;
    else if (key === 'startup_timeout_sec' && typeof value === 'number') config.startupTimeoutSec = value;
    else if (key === 'tool_timeout_sec' && typeof value === 'number') config.toolTimeoutSec = value;
    else if (key === 'enabled' && typeof value === 'boolean') config.enabled = value;
    else if (key === 'required' && typeof value === 'boolean') config.required = value;
    else if (key === 'args' && Array.isArray(value)) config.args = value;
    else if (key === 'env_vars' && Array.isArray(value)) config.envVars = value;
    else if (key === 'enabled_tools' && Array.isArray(value)) config.enabledTools = value;
    else if (key === 'disabled_tools' && Array.isArray(value)) config.disabledTools = value;
  }

  return normalizeCodexMcpEntry(config);
}

/** Write (or update) an MCP server entry into a Codex TOML config file. */
export function writeCodexMcpServer(
  configPath: string,
  name: string,
  entry: McpServerEntry,
  force = false,
): 'installed' | 'updated' | 'skipped' {
  const existingText = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const normalizedEntry = normalizeCodexMcpEntry(entry);
  const existingConfig = parseCodexMcpSection(existingText, name);
  const same = existingConfig && JSON.stringify(existingConfig) === JSON.stringify(normalizedEntry);

  if (same && !force) return 'skipped';

  const sectionKey = tomlKey(name);
  const lines = [`[mcp_servers.${sectionKey}]`];
  if (normalizedEntry.url) lines.push(`url = ${tomlString(normalizedEntry.url)}`);
  if (normalizedEntry.command) lines.push(`command = ${tomlString(normalizedEntry.command)}`);
  if (normalizedEntry.args?.length) lines.push(`args = ${tomlStringArray(normalizedEntry.args)}`);
  if (normalizedEntry.envVars?.length) lines.push(`env_vars = ${tomlStringArray(normalizedEntry.envVars)}`);
  if (normalizedEntry.cwd) lines.push(`cwd = ${tomlString(normalizedEntry.cwd)}`);
  if (normalizedEntry.bearerTokenEnvVar) lines.push(`bearer_token_env_var = ${tomlString(normalizedEntry.bearerTokenEnvVar)}`);
  if (typeof normalizedEntry.startupTimeoutSec === 'number') lines.push(`startup_timeout_sec = ${normalizedEntry.startupTimeoutSec}`);
  if (typeof normalizedEntry.toolTimeoutSec === 'number') lines.push(`tool_timeout_sec = ${normalizedEntry.toolTimeoutSec}`);
  if (typeof normalizedEntry.enabled === 'boolean') lines.push(`enabled = ${normalizedEntry.enabled}`);
  if (typeof normalizedEntry.required === 'boolean') lines.push(`required = ${normalizedEntry.required}`);
  if (normalizedEntry.enabledTools?.length) lines.push(`enabled_tools = ${tomlStringArray(normalizedEntry.enabledTools)}`);
  if (normalizedEntry.disabledTools?.length) lines.push(`disabled_tools = ${tomlStringArray(normalizedEntry.disabledTools)}`);
  if (normalizedEntry.env && Object.keys(normalizedEntry.env).length > 0) {
    lines.push('');
    lines.push(`[mcp_servers.${sectionKey}.env]`);
    for (const key of Object.keys(normalizedEntry.env).sort()) lines.push(`${key} = ${tomlString(normalizedEntry.env[key])}`);
  }
  if (normalizedEntry.httpHeaders && Object.keys(normalizedEntry.httpHeaders).length > 0) {
    lines.push('');
    lines.push(`[mcp_servers.${sectionKey}.http_headers]`);
    for (const key of Object.keys(normalizedEntry.httpHeaders).sort()) lines.push(`${tomlKey(key)} = ${tomlString(normalizedEntry.httpHeaders[key])}`);
  }
  if (normalizedEntry.envHttpHeaders && Object.keys(normalizedEntry.envHttpHeaders).length > 0) {
    lines.push('');
    lines.push(`[mcp_servers.${sectionKey}.env_http_headers]`);
    for (const key of Object.keys(normalizedEntry.envHttpHeaders).sort()) lines.push(`${tomlKey(key)} = ${tomlString(normalizedEntry.envHttpHeaders[key])}`);
  }
  const sectionText = `${lines.join('\n')}\n`;

  const bounds = findCodexSectionBounds(existingText, name);
  let nextText: string;
  if (!bounds) {
    nextText = existingText.trimEnd()
      ? `${existingText.trimEnd()}\n\n${sectionText}`
      : sectionText;
    fs.writeFileSync(configPath, nextText);
    return 'installed';
  }

  const currentLines = existingText.split(/\r?\n/);
  const replacement = sectionText.trimEnd().split('\n');
  currentLines.splice(bounds.start, bounds.end - bounds.start, ...replacement);
  nextText = `${currentLines.join('\n').trimEnd()}\n`;
  fs.writeFileSync(configPath, nextText);
  return 'updated';
}

/** Remove an MCP server section from Codex TOML config text. Returns modified text or null if not found. */
export function removeCodexMcpServer(text: string, name: string): string | null {
  const bounds = findCodexSectionBounds(text, name);
  if (!bounds) return null;

  const lines = text.split(/\r?\n/);
  lines.splice(bounds.start, bounds.end - bounds.start);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// Plugin registry writers — one per native tool format
// All match the real observed formats, not an invention.
// ---------------------------------------------------------------------------

/** Compose a Claude/Codex/Copilot-style plugin ID: `plugin@marketplace`. */
export function pluginId(pluginName: string, marketplace: string): string {
  return `${pluginName}@${marketplace}`;
}

// --- Claude Code registry writers ---

interface ClaudeSettings {
  enabledPlugins?: Record<string, boolean>;
  [key: string]: unknown;
}

interface ClaudeInstalledPluginEntry {
  scope: 'user' | 'project' | 'local' | 'managed';
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
  gitCommitSha?: string;
}

interface ClaudeInstalledPluginsFile {
  version: number;
  plugins: Record<string, ClaudeInstalledPluginEntry[]>;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/** Register a plugin install in ~/.claude/plugins/installed_plugins.json using the real observed schema. */
export function registerClaudeInstalledPlugin(params: {
  marketplace: string;
  pluginName: string;
  version: string;
  installPath: string;
  gitCommitSha?: string;
}): void {
  const file = readJsonFile<ClaudeInstalledPluginsFile>(CLAUDE_INSTALLED_PLUGINS, { version: 2, plugins: {} });
  if (!file.plugins) file.plugins = {};
  const id = pluginId(params.pluginName, params.marketplace);
  const now = new Date().toISOString();
  const entry: ClaudeInstalledPluginEntry = {
    scope: 'user',
    installPath: params.installPath,
    version: params.version,
    installedAt: file.plugins[id]?.[0]?.installedAt || now,
    lastUpdated: now,
    ...(params.gitCommitSha ? { gitCommitSha: params.gitCommitSha } : {}),
  };
  file.plugins[id] = [entry];
  writeJsonFile(CLAUDE_INSTALLED_PLUGINS, file);
}

/** Remove a plugin from ~/.claude/plugins/installed_plugins.json. */
export function deregisterClaudeInstalledPlugin(marketplace: string, pluginName: string): void {
  const file = readJsonFile<ClaudeInstalledPluginsFile>(CLAUDE_INSTALLED_PLUGINS, { version: 2, plugins: {} });
  if (!file.plugins) return;
  const id = pluginId(pluginName, marketplace);
  if (id in file.plugins) {
    delete file.plugins[id];
    writeJsonFile(CLAUDE_INSTALLED_PLUGINS, file);
  }
}

/** Set enabledPlugins["name@mkt"] = true in ~/.claude/settings.json. */
export function enableClaudePlugin(marketplace: string, pluginName: string): void {
  const settings = readJsonFile<ClaudeSettings>(CLAUDE_SETTINGS_PATH, {});
  if (!settings.enabledPlugins) settings.enabledPlugins = {};
  settings.enabledPlugins[pluginId(pluginName, marketplace)] = true;
  writeJsonFile(CLAUDE_SETTINGS_PATH, settings);
}

/** Remove enabledPlugins["name@mkt"] from ~/.claude/settings.json. */
export function disableClaudePlugin(marketplace: string, pluginName: string): void {
  const settings = readJsonFile<ClaudeSettings>(CLAUDE_SETTINGS_PATH, {});
  if (!settings.enabledPlugins) return;
  const id = pluginId(pluginName, marketplace);
  if (id in settings.enabledPlugins) {
    delete settings.enabledPlugins[id];
    writeJsonFile(CLAUDE_SETTINGS_PATH, settings);
  }
}

// --- Codex registry writer (TOML) ---

/**
 * Write [plugins."name@marketplace"] section with `enabled = true/false` into ~/.codex/config.toml.
 * Uses the same string-manipulation pattern as writeCodexMcpServer for consistency.
 */
export function registerCodexPlugin(marketplace: string, pluginName: string, enabled: boolean): void {
  const id = pluginId(pluginName, marketplace);
  const sectionHeader = `[plugins.${tomlKey(id)}]`;
  const sectionBody = `enabled = ${enabled}`;

  let existingText = '';
  try { existingText = fs.readFileSync(CODEX_CONFIG_TOML, 'utf8'); } catch { /* file may not exist yet */ }

  const lines = existingText.split(/\r?\n/);
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === sectionHeader) { startIdx = i; break; }
  }

  if (startIdx === -1) {
    const next = existingText.trimEnd()
      ? `${existingText.trimEnd()}\n\n${sectionHeader}\n${sectionBody}\n`
      : `${sectionHeader}\n${sectionBody}\n`;
    const dir = path.dirname(CODEX_CONFIG_TOML);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CODEX_CONFIG_TOML, next);
    return;
  }

  // Body assumed single-line (`enabled = ...`); extend here if Codex adds more fields later
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('[')) { endIdx = i; break; }
  }
  lines.splice(startIdx, endIdx - startIdx, sectionHeader, sectionBody);
  fs.writeFileSync(CODEX_CONFIG_TOML, lines.join('\n').trimEnd() + '\n');
}

/** Remove [plugins."name@marketplace"] section from ~/.codex/config.toml. */
export function deregisterCodexPlugin(marketplace: string, pluginName: string): void {
  let text: string;
  try { text = fs.readFileSync(CODEX_CONFIG_TOML, 'utf8'); } catch { return; }

  const id = pluginId(pluginName, marketplace);
  const sectionHeader = `[plugins.${tomlKey(id)}]`;
  const lines = text.split(/\r?\n/);
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === sectionHeader) { startIdx = i; break; }
  }
  if (startIdx === -1) return;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('[')) { endIdx = i; break; }
  }
  lines.splice(startIdx, endIdx - startIdx);
  fs.writeFileSync(CODEX_CONFIG_TOML, lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
}

// --- Copilot registry writer (JSON) ---

interface CopilotInstalledPluginEntry {
  name: string;
  marketplace: string;
  version: string;
  installed_at: string;
  enabled: boolean;
  cache_path: string;
}

interface CopilotConfig {
  installed_plugins?: CopilotInstalledPluginEntry[];
  [key: string]: unknown;
}

/** Add an entry to installed_plugins[] in ~/.copilot/config.json using the real observed schema. */
export function registerCopilotPlugin(params: {
  marketplace: string;
  pluginName: string;
  version: string;
  cachePath: string;
}): void {
  const config = readJsonFile<CopilotConfig>(COPILOT_CONFIG_PATH, {});
  if (!config.installed_plugins) config.installed_plugins = [];
  const existing = config.installed_plugins.findIndex(
    p => p.name === params.pluginName && p.marketplace === params.marketplace,
  );
  const entry: CopilotInstalledPluginEntry = {
    name: params.pluginName,
    marketplace: params.marketplace,
    version: params.version,
    installed_at: new Date().toISOString(),
    enabled: true,
    cache_path: params.cachePath,
  };
  if (existing >= 0) {
    config.installed_plugins[existing] = entry;
  } else {
    config.installed_plugins.push(entry);
  }
  writeJsonFile(COPILOT_CONFIG_PATH, config);
}

/** Remove a plugin entry from installed_plugins[] in ~/.copilot/config.json. */
export function deregisterCopilotPlugin(marketplace: string, pluginName: string): void {
  const config = readJsonFile<CopilotConfig>(COPILOT_CONFIG_PATH, {});
  if (!config.installed_plugins) return;
  const before = config.installed_plugins.length;
  config.installed_plugins = config.installed_plugins.filter(
    p => !(p.name === pluginName && p.marketplace === marketplace),
  );
  if (config.installed_plugins.length < before) {
    writeJsonFile(COPILOT_CONFIG_PATH, config);
  }
}

