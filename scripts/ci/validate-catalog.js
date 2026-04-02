// scripts/ci/validate-catalog.js
// Validates a catalog schema and checks that all plugin/teams refs resolve.
// Fails (exit 1) on any error.

'use strict';

const fs   = require('fs');
const path = require('path');

const root        = path.join(__dirname, '..', '..');
const catalogPath = (() => {
  const idx = process.argv.indexOf('--catalog');
  return idx !== -1 && process.argv[idx + 1]
    ? path.resolve(process.argv[idx + 1])
    : path.join(root, 'catalog.generated.json');
})();
const catalogName = path.relative(root, catalogPath) || path.basename(catalogPath);
const catalog     = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

let errors = 0;

// ── Schema validation ────────────────────────────────────────────────────

function checkEntries(list, typeName, requiredFields) {
  if (!Array.isArray(list)) {
    console.error(`✗ ${catalogName}: "${typeName}" must be an array`);
    errors++;
    return;
  }
  for (const entry of list) {
    for (const field of requiredFields) {
      // Accept 'hash' or 'version' interchangeably during catalog migration
      if (field === 'hash') {
        const present = (entry.hash && String(entry.hash).trim() !== '') ||
                        (entry.version && String(entry.version).trim() !== '');
        if (!present) {
          console.error(`✗ ${catalogName} [${typeName}] "${entry.name || '(unnamed)'}": missing field "hash" (or "version")`);
          errors++;
        }
        continue;
      }
      if (!entry[field] || String(entry[field]).trim() === '') {
        console.error(`✗ ${catalogName} [${typeName}] "${entry.name || '(unnamed)'}": missing field "${field}"`);
        errors++;
      }
    }
  }
}

checkEntries(catalog.skills,  'skills',  ['name', 'description', 'hash', 'path']);
checkEntries(catalog.agents,  'agents',  ['name', 'description', 'hash', 'path']);
checkEntries(catalog.mcps,    'mcps',    ['name', 'description', 'hash', 'path']);
checkEntries(catalog.plugins, 'plugins', ['name', 'description', 'hash', 'path']);

// ── Build name sets ──────────────────────────────────────────────────────

const skillNames  = new Set((catalog.skills  || []).map(s => s.name));
const agentNames  = new Set((catalog.agents  || []).map(a => a.name));
const mcpNames    = new Set((catalog.mcps    || []).map(m => m.name));
const pluginNames = new Set((catalog.plugins || []).map(p => p.name));

// ── Validate plugin files ────────────────────────────────────────────────

for (const pluginEntry of (catalog.plugins || [])) {
  const pluginFile = path.join(root, pluginEntry.path);
  if (!fs.existsSync(pluginFile)) {
    console.error(`✗ ${catalogName} plugin "${pluginEntry.name}": file not found at ${pluginEntry.path}`);
    errors++;
    continue;
  }

  const p = JSON.parse(fs.readFileSync(pluginFile, 'utf8'));

  for (const s of (p.skills || [])) {
    if (!skillNames.has(s)) {
      console.error(`✗ plugins/${pluginEntry.name}.json: skill "${s}" not found in catalog`);
      errors++;
    }
  }
  for (const a of (p.agents || [])) {
    if (!agentNames.has(a)) {
      console.error(`✗ plugins/${pluginEntry.name}.json: agent "${a}" not found in catalog`);
      errors++;
    }
  }
  for (const m of (p.mcps || [])) {
    if (!mcpNames.has(m)) {
      console.error(`✗ plugins/${pluginEntry.name}.json: mcp "${m}" not found in catalog`);
      errors++;
    }
  }

  if (errors === 0) {
    console.log(`  ✓ plugin: ${pluginEntry.name}`);
  }
}

// ── Validate catalog paths exist on disk ────────────────────────────────

for (const s of (catalog.skills || [])) {
  if (!fs.existsSync(path.join(root, s.path, 'SKILL.md'))) {
    console.error(`✗ catalog skill "${s.name}": SKILL.md not found at ${s.path}/SKILL.md`);
    errors++;
  }
}
for (const a of (catalog.agents || [])) {
  if (!fs.existsSync(path.join(root, a.path))) {
    console.error(`✗ catalog agent "${a.name}": file not found at ${a.path}`);
    errors++;
  }
}

// ── Result ───────────────────────────────────────────────────────────────

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
} else {
  console.log('\nCatalog validation passed.');
}
