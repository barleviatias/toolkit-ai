export interface CatalogEntry {
  name: string;
  description: string;
  hash: string;
  path: string;
  source?: string; // 'internal' or external source name
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
  type: string;
  url: string;
  setupNote?: string;
  docsUrl?: string;
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
