export interface CatalogEntry {
  name: string;
  description: string;
  hash: string;
  path: string;
  source: string;
}

export interface Catalog {
  skills: CatalogEntry[];
  agents: CatalogEntry[];
  mcps: CatalogEntry[];
  bundles: CatalogEntry[];
  commands: CatalogEntry[];
  plugins: CatalogEntry[];
}

/**
 * Subset of `.claude-plugin/plugin.json` we use. We only read fields the
 * decompose installer needs; unknown fields are ignored so we stay forward-
 * compatible with future Claude Code plugin manifest additions.
 *
 * The `skills`/`agents`/`commands`/`mcps` fields are non-Claude extensions:
 * cross-tool plugin packages (e.g. AMS) declare explicit content roots when
 * their layout doesn't follow Claude's `skills/<name>/SKILL.md` convention
 * (e.g. nested under `skills/universal/`, `agents/adapters/copilot/`). When
 * present, the toolkit walks those roots recursively; when absent, it falls
 * back to Claude's conventional layout. Each field accepts a single path or
 * an array of paths, all relative to the plugin root.
 */
export interface PluginManifest {
  name: string;
  description?: string;
  version?: string;
  author?: { name?: string } | string;
  skills?: string | string[];
  agents?: string | string[];
  commands?: string | string[];
  mcps?: string | string[];
}

/** Concrete components discovered inside a plugin directory (post-manifest parse). */
export interface PluginContents {
  skills: { name: string; absPath: string; relPath: string }[];
  agents: { name: string; absPath: string; relPath: string }[];
  commands: { name: string; absPath: string; relPath: string }[];
  mcpConfigs: { absPath: string; relPath: string }[];
  hasHooks: boolean;
}

export interface BundleConfig {
  name: string;
  description: string;
  version?: string;
  skills?: string[];
  agents?: string[];
  mcps?: string[];
  commands?: string[];
}

export interface McpConfig {
  name: string;
  description: string;
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  envVars?: string[];
  cwd?: string;
  bearerTokenEnvVar?: string;
  httpHeaders?: Record<string, string>;
  envHttpHeaders?: Record<string, string>;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
  enabled?: boolean;
  required?: boolean;
  enabledTools?: string[];
  disabledTools?: string[];
  setupNote?: string;
  docsUrl?: string;
}

export interface McpServerEntry {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  envVars?: string[];
  cwd?: string;
  bearerTokenEnvVar?: string;
  httpHeaders?: Record<string, string>;
  envHttpHeaders?: Record<string, string>;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
  enabled?: boolean;
  required?: boolean;
  enabledTools?: string[];
  disabledTools?: string[];
}

export interface McpConfigFile {
  mcpServers?: Record<string, McpServerEntry>;
  servers?: Record<string, McpServerEntry>;
  'amp.mcpServers'?: Record<string, McpServerEntry>;
}

export interface LockEntry {
  hash: string;
  installedAt: string;
  items?: Record<string, LockEntry>;
}

export interface LockFile {
  installed: Record<string, LockEntry>;
  lastUpdated?: string;
}

export interface Source {
  name: string;
  type: 'github' | 'bitbucket' | 'local';
  repo?: string; // 'owner/repo' for github/bitbucket
  path?: string; // local path
  /**
   * Disabled sources stay in sources.json but are skipped during fetch and
   * contribute no items to the catalog. Undefined is treated as enabled.
   */
  enabled?: boolean;
}

export interface SourcesConfig {
  sources: Source[];
  cacheTTL: number; // seconds
}

export type ItemType = 'skill' | 'agent' | 'mcp' | 'bundle' | 'command' | 'plugin';

export interface InstallResult {
  type: ItemType;
  name: string;
  action: 'installed' | 'updated' | 'skipped' | 'blocked';
}
