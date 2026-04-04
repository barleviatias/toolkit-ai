import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Catalog, CatalogEntry, BundleConfig, McpConfig } from '../types.js';
import { CACHE_DIR } from './platform.js';

// ---------------------------------------------------------------------------
// Frontmatter parser (YAML --- blocks, zero deps)
// ---------------------------------------------------------------------------

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

export function hashFile(filePath: string): string {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

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

export function findSkill(catalog: Catalog, name: string): CatalogEntry | undefined {
  return catalog.skills.find(s => s.name === name);
}

export function findAgent(catalog: Catalog, name: string): CatalogEntry | undefined {
  return catalog.agents.find(a => a.name === name);
}

export function findMcp(catalog: Catalog, name: string): CatalogEntry | undefined {
  return catalog.mcps.find(m => m.name === name);
}

export function findBundle(catalog: Catalog, name: string): CatalogEntry | undefined {
  return catalog.bundles.find(p => p.name === name);
}

export function loadBundleConfig(entry: CatalogEntry): BundleConfig {
  return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, entry.source, entry.path), 'utf8')) as BundleConfig;
}

export function loadMcpConfig(entry: CatalogEntry): McpConfig {
  return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, entry.source, entry.path), 'utf8')) as McpConfig;
}
