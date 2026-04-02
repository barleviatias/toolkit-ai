import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import type { Catalog, CatalogEntry, PluginConfig, McpConfig } from '../types.js';

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
// Catalog loading
// ---------------------------------------------------------------------------

/**
 * Generate and load the catalog from disk.
 * If lazy=true, skips regeneration and just reads the existing file.
 */
export function loadCatalog(toolkitDir: string, lazy = false): Catalog {
  const catalogFile = path.join(toolkitDir, 'catalog.generated.json');
  const generateScript = path.join(toolkitDir, 'scripts', 'generate-catalog.js');

  if (!lazy && fs.existsSync(generateScript)) {
    const result = spawnSync(process.execPath, [generateScript, '--output', catalogFile], {
      cwd: toolkitDir,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    if (result.status !== 0) {
      throw new Error(`Catalog generation failed:\n${result.stderr}`);
    }
  }

  return JSON.parse(fs.readFileSync(catalogFile, 'utf8')) as Catalog;
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

export function findPlugin(catalog: Catalog, name: string): CatalogEntry | undefined {
  return catalog.plugins.find(p => p.name === name);
}

export function loadPluginConfig(toolkitDir: string, entry: CatalogEntry): PluginConfig {
  return JSON.parse(fs.readFileSync(path.join(toolkitDir, entry.path), 'utf8')) as PluginConfig;
}

export function loadMcpConfig(toolkitDir: string, entry: CatalogEntry): McpConfig {
  return JSON.parse(fs.readFileSync(path.join(toolkitDir, entry.path), 'utf8')) as McpConfig;
}
