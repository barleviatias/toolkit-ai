import path from 'path';
import os from 'os';

export const HOME = os.homedir();

export const SKILL_TARGETS = [
  path.join(HOME, '.claude', 'skills'),
  path.join(HOME, '.copilot', 'skills'),
  path.join(HOME, '.agent', 'skills'),
];

export const AGENT_TARGETS = [
  path.join(HOME, '.claude', 'agents'),
  path.join(HOME, '.copilot', 'agents'),
  path.join(HOME, '.agent', 'agents'),
];

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

// Legacy path — migrate if exists
export const LEGACY_LOCK_FILE = path.join(HOME, '.rdwr', '.ai-toolkit-lock.json');

export function getConfigFormat(configPath: string): 'servers' | 'mcpServers' {
  const isVsCode = configPath.includes('.vscode') ||
    (configPath.includes('AppData') && configPath.includes('Code'));
  const isIntelliJ = configPath.includes('intellij');
  return (isVsCode || isIntelliJ) ? 'servers' : 'mcpServers';
}

/** Detect if running via npx (symlinks would break) */
export function isNpxRun(toolkitDir: string): boolean {
  return toolkitDir.includes('_npx') ||
    toolkitDir.includes('npm-cache') ||
    toolkitDir.includes('.pnpm') ||
    toolkitDir.includes('.yarn');
}
