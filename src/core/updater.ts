import type { Catalog, InstallResult } from '../types.js';
import { findSkill, findAgent, findMcp, findBundle } from './catalog.js';
import { readLock, writeLock, isItemProtected } from './lock.js';
import { installSkill, installAgent, installMcp, installBundle, type LogFn } from './installer.js';
import { removeItemFromFilesystem } from './remover.js';

// ---------------------------------------------------------------------------
// Check for updates (dry run)
// ---------------------------------------------------------------------------

export interface UpdateStatus {
  key: string;
  type: string;
  name: string;
  status: 'up_to_date' | 'update_available' | 'not_in_catalog';
  parent?: string; // bundle name if sub-item
}

export function checkForUpdates(catalog: Catalog): UpdateStatus[] {
  const lock = readLock();
  const results: UpdateStatus[] = [];

  // Pass 1: bundles
  for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
    if (!lockKey.startsWith('bundle:')) continue;
    const name = lockKey.slice(7);
    const catalogEntry = findBundle(catalog, name);

    if (!catalogEntry) {
      results.push({ key: lockKey, type: 'bundle', name, status: 'not_in_catalog' });
      continue;
    }

    if (catalogEntry.hash !== lockEntry.hash) {
      results.push({ key: lockKey, type: 'bundle', name, status: 'update_available' });
      continue;
    }

    // Check sub-items
    let bundleUpToDate = true;
    for (const [itemKey, itemEntry] of Object.entries(lockEntry.items || {})) {
      const [type, itemName] = itemKey.split(':');
      const catalogItem =
        type === 'skill' ? findSkill(catalog, itemName) :
        type === 'agent' ? findAgent(catalog, itemName) :
        type === 'mcp'   ? findMcp(catalog, itemName)   : null;

      if (!catalogItem || catalogItem.hash !== itemEntry.hash) {
        results.push({ key: itemKey, type, name: itemName, status: 'update_available', parent: name });
        bundleUpToDate = false;
      }
    }
    if (bundleUpToDate) {
      results.push({ key: lockKey, type: 'bundle', name, status: 'up_to_date' });
    }
  }

  // Pass 2: direct installs
  for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
    if (lockKey.startsWith('bundle:')) continue;
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
// Update specific items by type:name
// ---------------------------------------------------------------------------

export function updateSelected(
  catalog: Catalog,
  toolkitDir: string,
  items: Array<{ type: string; name: string }>,
  log: LogFn = console.log,
): InstallResult[] {
  const results: InstallResult[] = [];
  for (const { type, name } of items) {
    try {
      if (type === 'skill')      results.push(installSkill(catalog, toolkitDir, name, { force: true }, log));
      else if (type === 'agent') results.push(installAgent(catalog, toolkitDir, name, { force: true }, log));
      else if (type === 'mcp')   results.push(installMcp(catalog, toolkitDir, name, { force: true }, log));
    } catch (e: any) {
      log(`  [!] Failed to update ${type} ${name}: ${e.message}`);
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

  // Pass 1: bundles
  for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
    if (!lockKey.startsWith('bundle:')) continue;
    const name = lockKey.slice(7);
    const catalogEntry = findBundle(catalog, name);

    if (!catalogEntry) {
      log(`  [!] bundle ${name} no longer in catalog, uninstalling`);
      const currentLock = readLock();
      for (const itemKey of Object.keys(lockEntry.items || {})) {
        if (!isItemProtected(itemKey, lockKey, currentLock, catalog, true)) {
          removeItemFromFilesystem(catalog, itemKey, log);
        }
      }
      const l = readLock(); delete l.installed[lockKey]; writeLock(l);
      continue;
    }

    if (opts.force || catalogEntry.hash !== lockEntry.hash) {
      results.push(...installBundle(catalog, toolkitDir, name, { force: true }, log));
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
          removeItemFromFilesystem(catalog, itemKey, log);
        }
        const l = readLock(); delete l.installed[lockKey].items![itemKey]; writeLock(l);
        allUpToDate = false;
        continue;
      }
      if (catalogItem.hash !== itemEntry.hash) {
        const installOpts = { force: true, bundleName: name };
        if (type === 'skill')      results.push(installSkill(catalog, toolkitDir, itemName, installOpts, log));
        else if (type === 'agent') results.push(installAgent(catalog, toolkitDir, itemName, installOpts, log));
        else if (type === 'mcp')   results.push(installMcp(catalog, toolkitDir, itemName, installOpts, log));
        allUpToDate = false;
      }
    }
    if (allUpToDate) log(`  [OK] bundle ${name} (up to date)`);
  }

  // Pass 2: direct installs
  for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
    if (lockKey.startsWith('bundle:')) continue;
    const [type, name] = lockKey.split(':');
    const catalogEntry =
      type === 'skill' ? findSkill(catalog, name) :
      type === 'agent' ? findAgent(catalog, name) :
      type === 'mcp'   ? findMcp(catalog, name)   : null;

    if (!catalogEntry) {
      log(`  [!] ${type} ${name} no longer in catalog, removing`);
      const currentLock = readLock();
      if (!isItemProtected(lockKey, null, currentLock, catalog, false)) {
        removeItemFromFilesystem(catalog, lockKey, log);
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
