export interface CatalogEntry {
  name: string;
  description: string;
  hash: string;
  path: string;
  source: string;
  // Plugin-specific — only populated for plugin entries
  marketplace?: string;   // namespace from marketplace.json name, falls back to source name
  formats?: PluginFormats; // which native tool formats this plugin supports
  version?: string;       // from manifest, needed for Claude's versioned cache path
}

/** Which native plugin formats does a discovered plugin directory support? */
export interface PluginFormats {
  claude: boolean;   // has .claude-plugin/plugin.json
  codex: boolean;    // has .codex-plugin/plugin.json
  cursor: boolean;   // has .cursor-plugin/plugin.json
  copilot: boolean;  // has plugin.json at root OR .plugin/ OR .github/plugin/
}

export interface Catalog {
  skills: CatalogEntry[];
  agents: CatalogEntry[];
  mcps: CatalogEntry[];
  bundles: CatalogEntry[];
  plugins: CatalogEntry[];
}

export interface BundleConfig {
  name: string;
  description: string;
  version?: string;
  skills?: string[];
  agents?: string[];
  mcps?: string[];
  plugins?: string[];
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

/**
 * Plugin manifest — matches the real .claude-plugin/plugin.json schema used by
 * Claude Code, and is ~identical across Codex, Cursor, and Copilot. All fields
 * are optional; sub-resources (skills/, agents/, .mcp.json, hooks/hooks.json,
 * .lsp.json) are auto-discovered from conventional directories within the plugin.
 */
export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: { name: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  category?: string;
  // Optional custom component paths — override default auto-discovery
  skills?: string | string[];
  commands?: string | string[];
  agents?: string | string[];
  hooks?: string | string[] | Record<string, unknown>;
  mcpServers?: string | Record<string, McpServerEntry>;
  lspServers?: string | Record<string, unknown>;
  strict?: boolean;
}

/**
 * Marketplace manifest — matches the real .claude-plugin/marketplace.json schema
 * used by Anthropic's claude-plugins-official repo. Lists plugins contained in
 * a single repo. Used purely internally by the toolkit for plugin-ID namespacing
 * (plugin@marketplace).
 */
export interface MarketplaceManifest {
  name: string;
  description?: string;
  owner?: { name: string; email?: string };
  plugins: Array<{
    name: string;
    description?: string;
    version?: string;
    author?: { name: string; email?: string };
    source: string | { source: string; url?: string; sha?: string; path?: string; ref?: string };
    category?: string;
    homepage?: string;
    tags?: string[];
    keywords?: string[];
    strict?: boolean;
    // With strict:false, component declarations may live here instead of in plugin.json
    lspServers?: Record<string, unknown>;
    mcpServers?: Record<string, unknown>;
    skills?: string | string[];
    agents?: string | string[];
    commands?: string | string[];
    hooks?: string | string[] | Record<string, unknown>;
  }>;
}

export type ItemType = 'skill' | 'agent' | 'mcp' | 'bundle' | 'plugin';

export interface InstallResult {
  type: ItemType;
  name: string;
  action: 'installed' | 'updated' | 'skipped' | 'blocked';
}
