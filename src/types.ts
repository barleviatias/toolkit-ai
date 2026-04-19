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
}

export interface BundleConfig {
  name: string;
  description: string;
  version?: string;
  skills?: string[];
  agents?: string[];
  mcps?: string[];
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

export type ItemType = 'skill' | 'agent' | 'mcp' | 'bundle';

export interface InstallResult {
  type: ItemType;
  name: string;
  action: 'installed' | 'updated' | 'skipped' | 'blocked';
}
