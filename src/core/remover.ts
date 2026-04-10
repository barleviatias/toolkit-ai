import fs from 'fs';
import path from 'path';
import type { Catalog, LockFile } from '../types.js';
import { SKILL_TARGETS, AGENT_TARGETS, CODEX_AGENT_TARGET, MCP_CONFIG_FILES, getConfigFormat, removeCodexMcpServer, assertSafePathSegment } from './platform.js';
import { removeLink } from './fs-helpers.js';
import { findAgent, findBundle } from './catalog.js';
import { readLock, writeLock, isItemProtected } from './lock.js';

export type LogFn = (msg: string) => void;

// ---------------------------------------------------------------------------
// Remove an item from the filesystem only (no lock changes)
// ---------------------------------------------------------------------------

/** Remove an item's files from all install targets and deregister from MCP configs. */
export function removeItemFromFilesystem(
  catalog: Catalog,
  itemKey: string,
  log: LogFn = console.log,
): void {
  const [type, name] = itemKey.split(':');

  if (type === 'skill') {
    assertSafePathSegment(name, 'skill name');
    let removed = false;
    for (const dir of SKILL_TARGETS) {
      const dest = path.join(dir, name);
      if (removeLink(dest)) { log(`  [-] skill ${name} removed from ${dir}`); removed = true; }
    }
    if (!removed) log(`  skill ${name} was not installed`);
  } else if (type === 'agent') {
    assertSafePathSegment(name, 'agent name');
    const entry = findAgent(catalog, name);
    const filename = entry ? path.basename(entry.path) : `${name}.agent.md`;
    let removed = false;
    for (const dir of AGENT_TARGETS) {
      const dest = path.join(dir, filename);
      if (removeLink(dest)) { log(`  [-] agent ${name} removed from ${dir}`); removed = true; }
    }
    const codexDest = path.join(CODEX_AGENT_TARGET, `${name}.toml`);
    if (removeLink(codexDest)) { log(`  [-] agent ${name} removed from ${CODEX_AGENT_TARGET}`); removed = true; }
    if (!removed) log(`  agent ${name} was not installed`);
  } else if (type === 'mcp') {
    const existing = MCP_CONFIG_FILES.filter(f => fs.existsSync(f));
    let removed = false;
    for (const configPath of existing) {
      if (getConfigFormat(configPath) === 'codex-mcp') {
        const raw = fs.readFileSync(configPath, 'utf8');
        const next = removeCodexMcpServer(raw, name);
        if (next !== null) {
          fs.writeFileSync(configPath, next);
          log(`  [-] mcp ${name} removed from ${configPath}`);
          removed = true;
        }
        continue;
      }

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

/** Remove a skill by name, cleaning up all install targets and the lock file. */
export function removeSkill(catalog: Catalog, name: string, log?: LogFn): void {
  const lock = readLock();
  const itemKey = `skill:${name}`;
  if (!isItemProtected(itemKey, null, lock, catalog)) {
    removeItemFromFilesystem(catalog, itemKey, log);
  } else {
    (log || console.log)(`  [skip] skill ${name} still referenced by an installed bundle`);
  }
  delete lock.installed[itemKey];
  writeLock(lock);
}

/** Remove an agent by name, cleaning up all install targets and the lock file. */
export function removeAgent(catalog: Catalog, name: string, log?: LogFn): void {
  const lock = readLock();
  const itemKey = `agent:${name}`;
  if (!isItemProtected(itemKey, null, lock, catalog)) {
    removeItemFromFilesystem(catalog, itemKey, log);
  } else {
    (log || console.log)(`  [skip] agent ${name} still referenced by an installed bundle`);
  }
  delete lock.installed[itemKey];
  writeLock(lock);
}

/** Remove an MCP by name, deregistering from all config files and the lock. */
export function removeMcp(catalog: Catalog, name: string, log?: LogFn): void {
  const lock = readLock();
  const itemKey = `mcp:${name}`;
  if (!isItemProtected(itemKey, null, lock, catalog)) {
    removeItemFromFilesystem(catalog, itemKey, log);
  } else {
    (log || console.log)(`  [skip] mcp ${name} still referenced by an installed bundle`);
  }
  delete lock.installed[itemKey];
  writeLock(lock);
}

/** Remove a bundle and all its items (unless protected by another bundle). */
export function removeBundle(catalog: Catalog, name: string, log: LogFn = console.log): void {
  log(`\nRemoving bundle: ${name}`);
  const lock = readLock();
  const bundleKey = `bundle:${name}`;
  const bundleEntry = lock.installed[bundleKey];
  if (!bundleEntry) {
    log(`  bundle ${name} was not installed`);
    return;
  }
  for (const itemKey of Object.keys(bundleEntry.items || {})) {
    if (isItemProtected(itemKey, bundleKey, lock, catalog, true)) {
      const [type, itemName] = itemKey.split(':');
      log(`  [skip] ${type} ${itemName} still referenced elsewhere`);
    } else {
      removeItemFromFilesystem(catalog, itemKey, log);
    }
  }
  delete lock.installed[bundleKey];
  writeLock(lock);
}
