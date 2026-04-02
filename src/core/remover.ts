import fs from 'fs';
import path from 'path';
import type { Catalog, LockFile } from '../types.js';
import { SKILL_TARGETS, AGENT_TARGETS, MCP_CONFIG_FILES, getConfigFormat } from './platform.js';
import { removeLink } from './fs-helpers.js';
import { findAgent, findPlugin } from './catalog.js';
import { readLock, writeLock, isItemProtected } from './lock.js';

export type LogFn = (msg: string) => void;

// ---------------------------------------------------------------------------
// Remove an item from the filesystem only (no lock changes)
// ---------------------------------------------------------------------------

function removeItemFromFilesystem(
  catalog: Catalog,
  itemKey: string,
  log: LogFn = console.log,
): void {
  const [type, name] = itemKey.split(':');

  if (type === 'skill') {
    let removed = false;
    for (const dir of SKILL_TARGETS) {
      const dest = path.join(dir, name);
      if (removeLink(dest)) { log(`  [-] skill ${name} removed from ${dir}`); removed = true; }
    }
    if (!removed) log(`  skill ${name} was not installed`);
  } else if (type === 'agent') {
    const entry = findAgent(catalog, name);
    const filename = entry ? path.basename(entry.path) : `${name}.agent.md`;
    let removed = false;
    for (const dir of AGENT_TARGETS) {
      const dest = path.join(dir, filename);
      if (removeLink(dest)) { log(`  [-] agent ${name} removed from ${dir}`); removed = true; }
    }
    if (!removed) log(`  agent ${name} was not installed`);
  } else if (type === 'mcp') {
    const existing = MCP_CONFIG_FILES.filter(f => fs.existsSync(f));
    let removed = false;
    for (const configPath of existing) {
      let config: Record<string, any>;
      try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { continue; }
      const section = getConfigFormat(configPath) === 'servers' ? 'servers' : 'mcpServers';
      if (config[section]?.[name]) {
        delete config[section][name];
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        log(`  [-] mcp ${name} removed from ${configPath}`);
        removed = true;
      }
    }
    if (!removed) log(`  mcp ${name} was not found in any config file`);
  }
}

// ---------------------------------------------------------------------------
// Public remove functions
// ---------------------------------------------------------------------------

export function removeSkill(catalog: Catalog, name: string, log?: LogFn): void {
  const lock = readLock();
  const itemKey = `skill:${name}`;
  if (!isItemProtected(itemKey, null, lock, catalog)) {
    removeItemFromFilesystem(catalog, itemKey, log);
  } else {
    (log || console.log)(`  [skip] skill ${name} still referenced by an installed plugin`);
  }
  delete lock.installed[itemKey];
  writeLock(lock);
}

export function removeAgent(catalog: Catalog, name: string, log?: LogFn): void {
  const lock = readLock();
  const itemKey = `agent:${name}`;
  if (!isItemProtected(itemKey, null, lock, catalog)) {
    removeItemFromFilesystem(catalog, itemKey, log);
  } else {
    (log || console.log)(`  [skip] agent ${name} still referenced by an installed plugin`);
  }
  delete lock.installed[itemKey];
  writeLock(lock);
}

export function removeMcp(catalog: Catalog, name: string, log?: LogFn): void {
  const lock = readLock();
  const itemKey = `mcp:${name}`;
  if (!isItemProtected(itemKey, null, lock, catalog)) {
    removeItemFromFilesystem(catalog, itemKey, log);
  } else {
    (log || console.log)(`  [skip] mcp ${name} still referenced by an installed plugin`);
  }
  delete lock.installed[itemKey];
  writeLock(lock);
}

export function removePlugin(catalog: Catalog, name: string, log: LogFn = console.log): void {
  log(`\nRemoving plugin: ${name}`);
  const lock = readLock();
  const pluginKey = `plugin:${name}`;
  const pluginEntry = lock.installed[pluginKey];
  if (!pluginEntry) {
    log(`  plugin ${name} was not installed`);
    return;
  }
  for (const itemKey of Object.keys(pluginEntry.items || {})) {
    if (isItemProtected(itemKey, pluginKey, lock, catalog, true)) {
      const [type, itemName] = itemKey.split(':');
      log(`  [skip] ${type} ${itemName} still referenced elsewhere`);
    } else {
      removeItemFromFilesystem(catalog, itemKey, log);
    }
  }
  delete lock.installed[pluginKey];
  writeLock(lock);
}
