import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Catalog, CatalogEntry, BundleConfig, McpConfig } from '../types.js';
import { CACHE_DIR } from './platform.js';

// ---------------------------------------------------------------------------
// Frontmatter parser (YAML --- blocks, zero deps)
// ---------------------------------------------------------------------------

const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Strip a leading YAML frontmatter block, returning the body. */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_BLOCK, '');
}

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

const TYPE_TO_BUCKET: Record<string, keyof Catalog> = {
  skill: 'skills',
  agent: 'agents',
  mcp: 'mcps',
  bundle: 'bundles',
  command: 'commands',
};

/** Find an entry in the catalog by item type and name. Returns undefined for unknown types. */
export function findEntry(catalog: Catalog, type: string, name: string): CatalogEntry | undefined {
  const bucket = TYPE_TO_BUCKET[type];
  if (!bucket) return undefined;
  return (catalog[bucket] as CatalogEntry[]).find(entry => entry.name === name);
}

export function findSkill(catalog: Catalog, name: string): CatalogEntry | undefined {
  return findEntry(catalog, 'skill', name);
}

export function findAgent(catalog: Catalog, name: string): CatalogEntry | undefined {
  return findEntry(catalog, 'agent', name);
}

export function findMcp(catalog: Catalog, name: string): CatalogEntry | undefined {
  return findEntry(catalog, 'mcp', name);
}

export function findBundle(catalog: Catalog, name: string): CatalogEntry | undefined {
  return findEntry(catalog, 'bundle', name);
}

export function findCommand(catalog: Catalog, name: string): CatalogEntry | undefined {
  return findEntry(catalog, 'command', name);
}

/** Load and parse a bundle's JSON config from the source cache. */
export function loadBundleConfig(entry: CatalogEntry): BundleConfig {
  return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, entry.source, entry.path), 'utf8')) as BundleConfig;
}

/** Load and parse an MCP's JSON config from the source cache. */
export function loadMcpConfig(entry: CatalogEntry): McpConfig {
  return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, entry.source, entry.path), 'utf8')) as McpConfig;
}
