import type { Catalog, InstallResult } from '../types.js';
import { findSkill, findAgent, findMcp, findPlugin } from './catalog.js';
import { readLock, writeLock, isItemProtected } from './lock.js';
import { installSkill, installAgent, installMcp, installPlugin, type LogFn } from './installer.js';
import { removeLink } from './fs-helpers.js';

// ---------------------------------------------------------------------------
// Check for updates (dry run)
// ---------------------------------------------------------------------------

export interface UpdateStatus {
  key: string;
  type: string;
  name: string;
  status: 'up_to_date' | 'update_available' | 'not_in_catalog';
  parent?: string; // plugin name if sub-item
}

export function checkForUpdates(catalog: Catalog): UpdateStatus[] {
  const lock = readLock();
  const results: UpdateStatus[] = [];

  // Pass 1: plugins
  for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
    if (!lockKey.startsWith('plugin:')) continue;
    const name = lockKey.slice(7);
    const catalogEntry = findPlugin(catalog, name);

    if (!catalogEntry) {
      results.push({ key: lockKey, type: 'plugin', name, status: 'not_in_catalog' });
      continue;
    }

    if (catalogEntry.hash !== lockEntry.hash) {
      results.push({ key: lockKey, type: 'plugin', name, status: 'update_available' });
      continue;
    }

    // Check sub-items
    let pluginUpToDate = true;
    for (const [itemKey, itemEntry] of Object.entries(lockEntry.items || {})) {
      const [type, itemName] = itemKey.split(':');
      const catalogItem =
        type === 'skill' ? findSkill(catalog, itemName) :
        type === 'agent' ? findAgent(catalog, itemName) :
        type === 'mcp'   ? findMcp(catalog, itemName)   : null;

      if (!catalogItem || catalogItem.hash !== itemEntry.hash) {
        results.push({ key: itemKey, type, name: itemName, status: 'update_available', parent: name });
        pluginUpToDate = false;
      }
    }
    if (pluginUpToDate) {
      results.push({ key: lockKey, type: 'plugin', name, status: 'up_to_date' });
    }
  }

  // Pass 2: direct installs
  for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
    if (lockKey.startsWith('plugin:')) continue;
    const [type, name] = lockKey.split(':');
    const catalogEntry =
      type === 'skill' ? findSkill(catalog, name) :
      type === 'agent' ? findAgent(catalog, name) :
      type === 'mcp'   ? findMcp(catalog, name)   : null;

    if (!catalogEntry) {
      results.push({ key: lockKey, type, name, status: 'not_in_catalog' });
    } else if (catalogEntry.hash !== lockEntry.hash) {
      results.push({ key: lockKey, type, name, status: 'update_available' });
    } else {
      results.push({ key: lockKey, type, name, status: 'up_to_date' });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Update all installed items
// ---------------------------------------------------------------------------

export function updateAll(
  catalog: Catalog,
  toolkitDir: string,
  opts: { force?: boolean } = {},
  log: LogFn = console.log,
): InstallResult[] {
  const lock = readLock();
  const results: InstallResult[] = [];

  // Pass 1: plugins
  for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
    if (!lockKey.startsWith('plugin:')) continue;
    const name = lockKey.slice(7);
    const catalogEntry = findPlugin(catalog, name);

    if (!catalogEntry) {
      log(`  [!] plugin ${name} no longer in catalog, uninstalling`);
      const currentLock = readLock();
      for (const itemKey of Object.keys(lockEntry.items || {})) {
        if (!isItemProtected(itemKey, lockKey, currentLock, catalog, true)) {
          // Remove from filesystem
          const [type, itemName] = itemKey.split(':');
          log(`  [-] ${type} ${itemName} removed`);
        }
      }
      const l = readLock(); delete l.installed[lockKey]; writeLock(l);
      continue;
    }

    if (opts.force || catalogEntry.hash !== lockEntry.hash) {
      results.push(...installPlugin(catalog, toolkitDir, name, { force: true }, log));
      continue;
    }

    // Check sub-items
    let allUpToDate = true;
    for (const [itemKey, itemEntry] of Object.entries(lockEntry.items || {})) {
      const [type, itemName] = itemKey.split(':');
      const catalogItem =
        type === 'skill' ? findSkill(catalog, itemName) :
        type === 'agent' ? findAgent(catalog, itemName) :
        type === 'mcp'   ? findMcp(catalog, itemName)   : null;

      if (!catalogItem) {
        const currentLock = readLock();
        if (!isItemProtected(itemKey, lockKey, currentLock, catalog, true)) {
          log(`  [-] ${type} ${itemName} removed (no longer in catalog)`);
        }
        const l = readLock(); delete l.installed[lockKey].items![itemKey]; writeLock(l);
        allUpToDate = false;
        continue;
      }
      if (catalogItem.hash !== itemEntry.hash) {
        const installOpts = { force: true, pluginName: name };
        if (type === 'skill')      results.push(installSkill(catalog, toolkitDir, itemName, installOpts, log));
        else if (type === 'agent') results.push(installAgent(catalog, toolkitDir, itemName, installOpts, log));
        else if (type === 'mcp')   results.push(installMcp(catalog, toolkitDir, itemName, installOpts, log));
        allUpToDate = false;
      }
    }
    if (allUpToDate) log(`  [OK] plugin ${name} (up to date)`);
  }

  // Pass 2: direct installs
  for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
    if (lockKey.startsWith('plugin:')) continue;
    const [type, name] = lockKey.split(':');
    const catalogEntry =
      type === 'skill' ? findSkill(catalog, name) :
      type === 'agent' ? findAgent(catalog, name) :
      type === 'mcp'   ? findMcp(catalog, name)   : null;

    if (!catalogEntry) {
      log(`  [!] ${type} ${name} no longer in catalog, removing`);
      const currentLock = readLock();
      if (!isItemProtected(lockKey, null, currentLock, catalog, true)) {
        log(`  [-] ${type} ${name} removed`);
      }
      const l = readLock(); delete l.installed[lockKey]; writeLock(l);
      continue;
    }
    if (!opts.force && catalogEntry.hash === lockEntry.hash) {
      log(`  [OK] ${type} ${name} (up to date)`);
      continue;
    }
    if (type === 'skill')      results.push(installSkill(catalog, toolkitDir, name, { force: true }, log));
    else if (type === 'agent') results.push(installAgent(catalog, toolkitDir, name, { force: true }, log));
    else if (type === 'mcp')   results.push(installMcp(catalog, toolkitDir, name, { force: true }, log));
  }

  return results;
}
