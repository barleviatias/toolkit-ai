import fs from 'fs';
import path from 'path';
import os from 'os';
import type { McpServerEntry } from '../types.js';

export const HOME = os.homedir();

const CLAUDE_HOME = path.join(HOME, '.claude');
const CLAUDE_GLOBAL_CONFIG = path.join(HOME, '.claude.json');
const COPILOT_HOME = path.join(HOME, '.copilot');
const CODEX_HOME = path.join(HOME, '.codex');
const SHARED_AGENTS_HOME = path.join(HOME, '.agents');
const AMP_HOME = path.join(HOME, '.config', 'amp');
const CURSOR_HOME = path.join(HOME, '.cursor');
const VSCODE_HOME = path.join(HOME, '.vscode');

const CLAUDE_SKILL_TARGET = path.join(CLAUDE_HOME, 'skills');
const COPILOT_SKILL_TARGET = path.join(COPILOT_HOME, 'skills');
const CODEX_SKILL_TARGET = path.join(SHARED_AGENTS_HOME, 'skills');
const AMP_SKILL_TARGET = path.join(AMP_HOME, 'skills');

const CLAUDE_AGENT_TARGET = path.join(CLAUDE_HOME, 'agents');
const COPILOT_AGENT_TARGET = path.join(COPILOT_HOME, 'agents');

const CLAUDE_COMMAND_TARGET = path.join(CLAUDE_HOME, 'commands');
const CURSOR_COMMAND_TARGET = path.join(CURSOR_HOME, 'commands');

/**
 * VS Code (and Insiders) reads user-level prompts from a per-flavor user
 * directory under the OS-specific config path. Each flavor + base contributes
 * one writable target.
 */
function vscodePromptDirs(): string[] {
  const flavors = ['Code', 'Code - Insiders'];
  const bases: string[] = [];
  if (process.platform === 'darwin') {
    bases.push(path.join(HOME, 'Library', 'Application Support'));
  } else if (process.platform === 'win32') {
    if (process.env.APPDATA) bases.push(process.env.APPDATA);
  } else {
    bases.push(path.join(HOME, '.config'));
  }
  return bases.flatMap(base => flavors.map(f => path.join(base, f, 'User', 'prompts')));
}

const VSCODE_PROMPT_TARGETS = vscodePromptDirs();

export type CommandFormat = 'verbatim' | 'vscode-prompt';

export interface CommandTarget {
  dir: string;
  format: CommandFormat;
}

export const SKILL_TARGETS = [
  CLAUDE_SKILL_TARGET,
  COPILOT_SKILL_TARGET,
  CODEX_SKILL_TARGET,
  AMP_SKILL_TARGET,
];

export const AGENT_TARGETS = [
  CLAUDE_AGENT_TARGET,
  COPILOT_AGENT_TARGET,
];

export const CODEX_AGENT_TARGET = path.join(CODEX_HOME, 'agents');

export type ToolId = 'claude' | 'codex' | 'copilot' | 'amp' | 'cursor' | 'vscode';

/** Stable list of tool IDs the toolkit knows how to target. */
export const KNOWN_TOOL_IDS: readonly ToolId[] = ['claude', 'codex', 'copilot', 'amp', 'cursor', 'vscode'];

interface McpConfigTarget {
  path: string;
  platform: NodeJS.Platform[];
  tool: ToolId;
  createIfDetected: boolean;
}

// MCP config file paths, tagged by tool so per-provider opt-outs apply
// uniformly to local and global writes.
//   Local  (createIfDetected=false): write only if the file already exists.
//   Global (createIfDetected=true):  write to existing OR create if the tool is detected.
const LOCAL_MCP_CONFIGS_ALL: McpConfigTarget[] = [
  { path: path.join(CLAUDE_HOME, 'settings.json'), platform: ['darwin', 'linux', 'win32'], tool: 'claude', createIfDetected: false },
  { path: path.join(VSCODE_HOME, 'mcp.json'),      platform: ['darwin', 'linux', 'win32'], tool: 'vscode', createIfDetected: false },
  { path: path.join(CURSOR_HOME, 'mcp.json'),      platform: ['darwin', 'linux', 'win32'], tool: 'cursor', createIfDetected: false },
];

const GLOBAL_MCP_CONFIGS_ALL: McpConfigTarget[] = [
  { path: path.join(HOME, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json'), platform: ['win32'], tool: 'vscode', createIfDetected: true },
  { path: path.join(HOME, 'AppData', 'Local', 'github-copilot', 'intellij', 'mcp.json'), platform: ['win32'], tool: 'copilot', createIfDetected: true },
  { path: CLAUDE_GLOBAL_CONFIG, platform: ['darwin', 'linux', 'win32'], tool: 'claude', createIfDetected: true },
  { path: path.join(CODEX_HOME, 'config.toml'), platform: ['darwin', 'linux', 'win32'], tool: 'codex', createIfDetected: true },
  { path: path.join(AMP_HOME, 'settings.json'), platform: ['darwin', 'linux', 'win32'], tool: 'amp', createIfDetected: true },
];

// Filter global configs to current platform
export const GLOBAL_MCP_CONFIG_FILES = GLOBAL_MCP_CONFIGS_ALL
  .filter(c => c.platform.includes(process.platform))
  .map(c => c.path);

export const LOCAL_MCP_CONFIG_FILES = LOCAL_MCP_CONFIGS_ALL.map(c => c.path);
export const MCP_CONFIG_FILES = [...LOCAL_MCP_CONFIG_FILES, ...GLOBAL_MCP_CONFIG_FILES];

export interface ToolInstallation {
  id: ToolId;
  label: string;
  installed: boolean;
  reasons: string[];
  supportsSkills: boolean;
  supportsAgents: boolean;
  supportsMcps: boolean;
  supportsCommands: boolean;
}

interface ToolDefinition {
  id: ToolId;
  label: string;
  command?: string;
  indicators: string[];
  skillTarget?: string;
  agentTarget?: string;
  mcpConfigTargets: string[];
  commandTargets?: CommandTarget[];
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    indicators: [CLAUDE_HOME, CLAUDE_GLOBAL_CONFIG],
    skillTarget: CLAUDE_SKILL_TARGET,
    agentTarget: CLAUDE_AGENT_TARGET,
    mcpConfigTargets: [path.join(CLAUDE_HOME, 'settings.json'), CLAUDE_GLOBAL_CONFIG],
    commandTargets: [{ dir: CLAUDE_COMMAND_TARGET, format: 'verbatim' }],
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    indicators: [CODEX_HOME, SHARED_AGENTS_HOME],
    skillTarget: CODEX_SKILL_TARGET,
    agentTarget: CODEX_AGENT_TARGET,
    mcpConfigTargets: [path.join(CODEX_HOME, 'config.toml')],
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    indicators: [COPILOT_HOME, path.join(HOME, 'AppData', 'Local', 'github-copilot')],
    skillTarget: COPILOT_SKILL_TARGET,
    agentTarget: COPILOT_AGENT_TARGET,
    mcpConfigTargets: [path.join(HOME, 'AppData', 'Local', 'github-copilot', 'intellij', 'mcp.json')],
  },
  {
    id: 'amp',
    label: 'Amp',
    command: 'amp',
    indicators: [AMP_HOME],
    skillTarget: AMP_SKILL_TARGET,
    mcpConfigTargets: [path.join(AMP_HOME, 'settings.json')],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    command: 'cursor',
    indicators: [CURSOR_HOME, path.join(CURSOR_HOME, 'mcp.json')],
    mcpConfigTargets: [path.join(CURSOR_HOME, 'mcp.json')],
    commandTargets: [{ dir: CURSOR_COMMAND_TARGET, format: 'verbatim' }],
  },
  {
    id: 'vscode',
    label: 'VS Code',
    command: 'code',
    indicators: [
      VSCODE_HOME,
      path.join(VSCODE_HOME, 'mcp.json'),
      path.join(HOME, 'AppData', 'Roaming', 'Code'),
      // VS Code (and Insiders) write user settings/prompts to platform-specific
      // dirs even on machines that never created ~/.vscode (e.g. Insiders-only
      // setups). The parent dir of any prompt target is enough signal.
      ...VSCODE_PROMPT_TARGETS.map(dir => path.dirname(dir)),
    ],
    mcpConfigTargets: [path.join(VSCODE_HOME, 'mcp.json'), path.join(HOME, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json')],
    commandTargets: VSCODE_PROMPT_TARGETS.map(dir => ({ dir, format: 'vscode-prompt' as CommandFormat })),
  },
];

function pathExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandExists(command: string): boolean {
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext.toLowerCase()}`);
      const upperCandidate = path.join(dir, `${command}${ext.toUpperCase()}`);
      if (isExecutable(candidate) || isExecutable(upperCandidate)) return true;
    }
  }
  return false;
}

function reasonsForTool(definition: ToolDefinition): string[] {
  const reasons = definition.indicators
    .filter(pathExists)
    .map(indicator => `found ${indicator}`);

  if (definition.command && commandExists(definition.command)) {
    reasons.push(`found ${definition.command} on PATH`);
  }

  return reasons;
}

/** Detect supported AI tools installed for the current user. */
export function detectToolInstallations(): ToolInstallation[] {
  return TOOL_DEFINITIONS.map(definition => {
    const reasons = reasonsForTool(definition);
    return {
      id: definition.id,
      label: definition.label,
      installed: reasons.length > 0,
      reasons,
      supportsSkills: !!definition.skillTarget,
      supportsAgents: !!definition.agentTarget,
      supportsMcps: definition.mcpConfigTargets.length > 0,
      supportsCommands: !!definition.commandTargets && definition.commandTargets.length > 0,
    };
  });
}

function detectedToolIds(): Set<ToolId> {
  return new Set(detectToolInstallations().filter(tool => tool.installed).map(tool => tool.id));
}

// Read disabledTools straight off disk to avoid a cycle with settings.ts
// (which already imports CONFIG_FILE/KNOWN_TOOL_IDS from this module).
// Cached by config.json mtime so repeated calls during one render don't
// re-parse — useCatalog's allItems memo and getInstalledState's per-command
// loop would otherwise hit the file N+ times.
let disabledToolsCache: { mtimeMs: number; ids: Set<ToolId> } | null = null;

function disabledToolIds(): Set<ToolId> {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(CONFIG_FILE).mtimeMs;
  } catch {
    disabledToolsCache = null;
    return new Set();
  }
  if (disabledToolsCache && disabledToolsCache.mtimeMs === mtimeMs) {
    return disabledToolsCache.ids;
  }
  let ids: Set<ToolId>;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as unknown;
    const list = (raw as { disabledTools?: unknown } | null)?.disabledTools;
    const known = new Set<string>(KNOWN_TOOL_IDS);
    ids = Array.isArray(list)
      ? new Set(list.filter((id): id is ToolId => typeof id === 'string' && known.has(id)))
      : new Set();
  } catch {
    ids = new Set();
  }
  disabledToolsCache = { mtimeMs, ids };
  return ids;
}

/** Read the user's per-provider opt-out list (UI surfaces a "disabled" badge from this). */
export function getDisabledToolIds(): Set<ToolId> {
  return disabledToolIds();
}

/** Detected tools minus the user's per-provider opt-outs. */
function selectedToolIds(): Set<ToolId> {
  const detected = detectedToolIds();
  const disabled = disabledToolIds();
  if (disabled.size === 0) return detected;
  return new Set([...detected].filter(id => !disabled.has(id)));
}

/** Return skill install directories for tools detected and not opted out. */
export function getWritableSkillTargets(): string[] {
  const selected = selectedToolIds();
  return TOOL_DEFINITIONS
    .filter(tool => tool.skillTarget && selected.has(tool.id))
    .map(tool => tool.skillTarget as string);
}

/** Return agent install directories for tools detected and not opted out. */
export function getWritableAgentTargets(): string[] {
  const selected = selectedToolIds();
  return TOOL_DEFINITIONS
    .filter(tool => tool.agentTarget && selected.has(tool.id))
    .map(tool => tool.agentTarget as string);
}

/** Return command install targets for tools detected and not opted out. */
export function getWritableCommandTargets(): CommandTarget[] {
  const selected = selectedToolIds();
  return TOOL_DEFINITIONS
    .filter(tool => tool.commandTargets && tool.commandTargets.length > 0 && selected.has(tool.id))
    .flatMap(tool => tool.commandTargets as CommandTarget[]);
}

/** Return MCP config files that should be updated, scoped to detected and not-opted-out tools. */
export function getWritableMcpConfigFiles(): string[] {
  const selected = selectedToolIds();
  const localExisting = LOCAL_MCP_CONFIGS_ALL
    .filter(target => target.platform.includes(process.platform))
    .filter(target => selected.has(target.tool))
    .filter(target => pathExists(target.path))
    .map(target => target.path);
  const globalWritable = GLOBAL_MCP_CONFIGS_ALL
    .filter(target => target.platform.includes(process.platform))
    .filter(target => selected.has(target.tool))
    .filter(target => pathExists(target.path) || target.createIfDetected)
    .map(target => target.path);

  return Array.from(new Set([...localExisting, ...globalWritable]));
}

function supportsItemType(tool: ToolInstallation, type: string): boolean {
  if (type === 'skill') return tool.supportsSkills;
  if (type === 'agent') return tool.supportsAgents;
  if (type === 'mcp') return tool.supportsMcps;
  if (type === 'command') return tool.supportsCommands;
  if (type === 'bundle') return tool.supportsSkills || tool.supportsAgents || tool.supportsMcps || tool.supportsCommands;
  return false;
}

/** Return labels for detected, not-opted-out target apps that can receive this item type. */
export function getWritableTargetLabelsForType(type: string): string[] {
  const disabled = disabledToolIds();
  return detectToolInstallations()
    .filter(tool => tool.installed && !disabled.has(tool.id) && supportsItemType(tool, type))
    .map(tool => tool.label);
}

function hasMcpInConfig(configPath: string, mcpName: string): boolean {
  if (!pathExists(configPath)) return false;
  if (getConfigFormat(configPath) === 'codex-mcp') {
    return !!parseCodexMcpSection(fs.readFileSync(configPath, 'utf8'), mcpName);
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const format = getConfigFormat(configPath);
    const sectionName = format === 'amp-mcp' ? 'amp.mcpServers' : format === 'servers' ? 'servers' : 'mcpServers';
    const section = config[sectionName];
    return !!section && typeof section === 'object' && !Array.isArray(section) &&
      mcpName in (section as Record<string, unknown>);
  } catch {
    return false;
  }
}

/** Return labels for target apps where this specific item currently exists. */
export function getInstalledTargetLabelsForType(type: string, name: string, itemPath = ''): string[] {
  if (type === 'skill') {
    return TOOL_DEFINITIONS
      .filter(tool => tool.skillTarget && pathExists(path.join(tool.skillTarget, name)))
      .map(tool => tool.label);
  }

  if (type === 'agent') {
    const filename = itemPath ? path.basename(itemPath) : `${name}.agent.md`;
    return TOOL_DEFINITIONS
      .filter(tool => {
        if (!tool.agentTarget) return false;
        if (tool.agentTarget === CODEX_AGENT_TARGET) return pathExists(path.join(CODEX_AGENT_TARGET, `${name}.toml`));
        return pathExists(path.join(tool.agentTarget, filename));
      })
      .map(tool => tool.label);
  }

  if (type === 'mcp') {
    return TOOL_DEFINITIONS
      .filter(tool => tool.mcpConfigTargets.some(configPath => hasMcpInConfig(configPath, name)))
      .map(tool => tool.label);
  }

  if (type === 'command') {
    return TOOL_DEFINITIONS
      .filter(tool => tool.commandTargets?.some(target => {
        const filename = target.format === 'vscode-prompt' ? `${name}.prompt.md` : `${name}.md`;
        return pathExists(path.join(target.dir, filename));
      }))
      .map(tool => tool.label);
  }

  return [];
}

// ~/.toolkit/ — user-level config, state, and cache for the toolkit
export const TOOLKIT_HOME = path.join(HOME, '.toolkit');
export const CONFIG_FILE = path.join(TOOLKIT_HOME, 'config.json');
export const LOCK_FILE = path.join(TOOLKIT_HOME, 'lock.json');
export const SOURCES_FILE = path.join(TOOLKIT_HOME, 'sources.json');
export const UPDATE_CHECK_FILE = path.join(TOOLKIT_HOME, 'update-check.json');
export const CACHE_DIR = path.join(TOOLKIT_HOME, 'cache');

/** Version baked in at build time by tsup's `define` (see tsup.config.ts).
 *  Falls back to 'dev' when running from the unbuilt source tree. */
export const TOOLKIT_VERSION = process.env.TOOLKIT_VERSION || 'dev';
export const TOOLKIT_BUILD_CHANNEL = process.env.TOOLKIT_BUILD_CHANNEL || 'dev';
export const IS_DEV_BUILD = TOOLKIT_VERSION === 'dev' || TOOLKIT_BUILD_CHANNEL === 'dev';
export const TOOLKIT_VERSION_LABEL = `${TOOLKIT_VERSION}${IS_DEV_BUILD ? ' dev build' : ''}`;

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
export function getConfigFormat(configPath: string): 'servers' | 'mcpServers' | 'codex-mcp' | 'amp-mcp' {
  if (configPath.endsWith(path.join('.codex', 'config.toml'))) return 'codex-mcp';
  if (configPath.endsWith(path.join('.config', 'amp', 'settings.json'))) return 'amp-mcp';
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
