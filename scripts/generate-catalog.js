#!/usr/bin/env node
// scripts/generate-catalog.js
// Scans the resources/ directory and generates catalog.generated.json.
// Metadata is read directly from each resource file.
// Each entry gets a `hash` field (MD5) instead of a version:
//   - skills    → MD5 of all files in the skill directory (sorted by relative path)
//   - agents    → MD5 of the single .agent.md file
//   - mcps      → MD5 of the single .json file
//   - plugins   → MD5 of the single .json file
//
// Usage:  node scripts/generate-catalog.js [--output <path>]

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT        = path.join(__dirname, '..');
const OUTPUT_FILE = (() => {
  const idx = process.argv.indexOf('--output');
  return idx !== -1 && process.argv[idx + 1]
    ? path.resolve(process.argv[idx + 1])
    : path.join(ROOT, 'catalog.generated.json');
})();

// ---------------------------------------------------------------------------
// MD5 helpers
// ---------------------------------------------------------------------------

function hashFile(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

function hashDir(dirPath) {
  const h = crypto.createHash('md5');
  const files = [];
  (function walk(dir, prefix) {
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
// Frontmatter parser (YAML --- blocks)
// ---------------------------------------------------------------------------

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const block = match[1];
  const meta = {};
  const lines = block.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\w[\w-]*):\s*(.*)/);
    if (!m) continue;
    const key   = m[1];
    const value = m[2].trim();

    if (value === '>' || value === '|') {
      // Folded / literal block scalar — collect indented continuation lines
      const chunks = [];
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
// Scanners
// ---------------------------------------------------------------------------

function scanSkills() {
  const dir = path.join(ROOT, 'resources', 'skills');
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const skillDir = path.join(dir, name);
    if (!fs.statSync(skillDir).isDirectory()) continue;
    const skillMd = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) {
      console.warn(`[warn] skills/${name}: no SKILL.md found, skipping`);
      continue;
    }
    const meta = parseFrontmatter(fs.readFileSync(skillMd, 'utf8'));
    const entryName = meta.name || name;
    entries.push({
      name:        entryName,
      description: meta.description || '',
      hash:        hashDir(skillDir),
      path:        `resources/skills/${name}`,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function scanAgents() {
  const dir = path.join(ROOT, 'resources', 'agents');
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.agent.md')) continue;
    const filePath = path.join(dir, file);
    const meta = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
    const entryName = meta.name || file.replace('.agent.md', '');
    entries.push({
      name:        entryName,
      description: meta.description || '',
      hash:        hashFile(filePath),
      path:        `resources/agents/${file}`,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function scanMcps() {
  const dir = path.join(ROOT, 'resources', 'mcps');
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(dir, file);
    let config;
    try {
      config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.warn(`[warn] mcps/${file}: parse error – ${e.message}, skipping`);
      continue;
    }
    const entryName = config.name || file.replace('.json', '');
    entries.push({
      name:        entryName,
      description: config.description || '',
      hash:        hashFile(filePath),
      path:        `resources/mcps/${file}`,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function scanPlugins() {
  const dir = path.join(ROOT, 'resources', 'plugins');
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(dir, file);
    let config;
    try {
      config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.warn(`[warn] plugins/${file}: parse error – ${e.message}, skipping`);
      continue;
    }
    const entryName = config.name || file.replace('.json', '');
    entries.push({
      name:        entryName,
      description: config.description || '',
      hash:        hashFile(filePath),
      path:        `resources/plugins/${file}`,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

const catalog = {
  skills:  scanSkills(),
  agents:  scanAgents(),
  mcps:    scanMcps(),
  plugins: scanPlugins(),
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(catalog, null, 2) + '\n');

console.log(`Generated ${OUTPUT_FILE}`);
console.log(`  skills:  ${catalog.skills.length}`);
console.log(`  agents:  ${catalog.agents.length}`);
console.log(`  mcps:    ${catalog.mcps.length}`);
console.log(`  plugins: ${catalog.plugins.length}`);
