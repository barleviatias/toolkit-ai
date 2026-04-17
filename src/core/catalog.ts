import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Catalog, CatalogEntry, BundleConfig, McpConfig, PluginManifest, MarketplaceManifest, PluginFormats } from '../types.js';
import { CACHE_DIR } from './platform.js';

// ---------------------------------------------------------------------------
// Frontmatter parser (YAML --- blocks, zero deps)
// ---------------------------------------------------------------------------

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

/** Compute a deterministic MD5 hash over all files in a directory (sorted by relative path). */
export function hashDir(dirPath: string): string {
  const h = crypto.createHash('md5');
  const files: { rel: string; abs: string }[] = [];
  (function walk(dir: string, prefix: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else files.push({ rel, abs: path.join(dir, entry.name) });
    }
  })(dirPath, '');
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  for (const f of files) { h.update(f.rel); h.update(fs.readFileSync(f.abs)); }
  return h.digest('hex');
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Find a skill entry by name in the catalog. */
export function findSkill(catalog: Catalog, name: string): CatalogEntry | undefined {
  return catalog.skills.find(s => s.name === name);
}

/** Find an agent entry by name in the catalog. */
export function findAgent(catalog: Catalog, name: string): CatalogEntry | undefined {
  return catalog.agents.find(a => a.name === name);
}

/** Find an MCP entry by name in the catalog. */
export function findMcp(catalog: Catalog, name: string): CatalogEntry | undefined {
  return catalog.mcps.find(m => m.name === name);
}

/** Find a bundle entry by name in the catalog. */
export function findBundle(catalog: Catalog, name: string): CatalogEntry | undefined {
  return catalog.bundles.find(p => p.name === name);
}

/** Load and parse a bundle's JSON config from the source cache. */
export function loadBundleConfig(entry: CatalogEntry): BundleConfig {
  return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, entry.source, entry.path), 'utf8')) as BundleConfig;
}

/** Load and parse an MCP's JSON config from the source cache. */
export function loadMcpConfig(entry: CatalogEntry): McpConfig {
  return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, entry.source, entry.path), 'utf8')) as McpConfig;
}

/** Find a plugin entry by name. Accepts either "name" or "name@marketplace". */
export function findPlugin(catalog: Catalog, name: string): CatalogEntry | undefined {
  // Exact match first (includes @marketplace when provided)
  const exact = catalog.plugins.find(p => {
    const id = p.marketplace ? `${p.name}@${p.marketplace}` : p.name;
    return id === name || p.name === name;
  });
  return exact;
}

// ---------------------------------------------------------------------------
// Plugin manifest discovery + loading (native format paths)
// ---------------------------------------------------------------------------

/** Candidate manifest paths, in priority order. */
export const PLUGIN_MANIFEST_PATHS = [
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  '.plugin/plugin.json',
  '.github/plugin/plugin.json',
  'plugin.json',
] as const;

/** Candidate marketplace manifest paths, in priority order. */
export const MARKETPLACE_MANIFEST_PATHS = [
  '.claude-plugin/marketplace.json',
  '.github/plugin/marketplace.json',
  '.codex-plugin/marketplace.json',
  '.cursor-plugin/marketplace.json',
] as const;

/**
 * Detect which native tool formats a plugin directory supports based on which
 * manifest files are present. A plugin can support multiple formats at once.
 */
export function detectPluginFormats(pluginDir: string): PluginFormats {
  const has = (rel: string) => fs.existsSync(path.join(pluginDir, rel));
  return {
    claude: has('.claude-plugin/plugin.json'),
    codex: has('.codex-plugin/plugin.json'),
    cursor: has('.cursor-plugin/plugin.json'),
    copilot: has('plugin.json') || has('.plugin/plugin.json') || has('.github/plugin/plugin.json'),
  };
}

/**
 * Load the plugin manifest from whichever native location exists, preferring
 * Claude's format (most complete schema). Returns a minimal manifest with just
 * the directory basename as name if no manifest file is found.
 */
export function loadPluginManifest(pluginDir: string): PluginManifest {
  for (const relPath of PLUGIN_MANIFEST_PATHS) {
    const fullPath = path.join(pluginDir, relPath);
    if (fs.existsSync(fullPath)) {
      try {
        return JSON.parse(fs.readFileSync(fullPath, 'utf8')) as PluginManifest;
      } catch {
        // Malformed — try next location
      }
    }
  }
  // No manifest found — return stub with dir basename as name (valid per Claude docs)
  return { name: path.basename(pluginDir) };
}

/** A loaded marketplace manifest with all native tool formats it implies. */
export interface LoadedMarketplace {
  manifest: MarketplaceManifest;
  /** All native tool formats this marketplace implies (all sibling marketplace.json files found) */
  impliedFormats: Array<keyof PluginFormats>;
}

/**
 * Find and load a marketplace manifest from a source's cached repo root.
 * Returns null if no marketplace.json exists in any known location.
 *
 * A repo may contain multiple sibling marketplace manifests (e.g.
 * github/copilot-plugins has both .claude-plugin/marketplace.json AND
 * .github/plugin/marketplace.json). We collect ALL implied formats so the
 * plugins light up for every tool that marketplace targets.
 */
export function loadMarketplaceManifest(sourceCacheDir: string): LoadedMarketplace | null {
  let manifest: MarketplaceManifest | null = null;
  const impliedFormats: Array<keyof PluginFormats> = [];

  for (const relPath of MARKETPLACE_MANIFEST_PATHS) {
    const fullPath = path.join(sourceCacheDir, relPath);
    if (!fs.existsSync(fullPath)) continue;

    // Any present manifest contributes its implied tool format
    const implied: keyof PluginFormats =
      relPath.startsWith('.claude-plugin') ? 'claude' :
      relPath.startsWith('.codex-plugin') ? 'codex' :
      relPath.startsWith('.cursor-plugin') ? 'cursor' :
      'copilot'; // .github/plugin/
    if (!impliedFormats.includes(implied)) impliedFormats.push(implied);

    // Load the first valid manifest as the source-of-truth for plugin list
    if (!manifest) {
      try {
        manifest = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as MarketplaceManifest;
      } catch {
        // Malformed — try next location
      }
    }
  }

  if (!manifest) return null;
  return { manifest, impliedFormats };
}
