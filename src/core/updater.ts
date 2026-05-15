import type { Catalog, InstallResult } from '../types.js';
import { findBundle, findEntry } from './catalog.js';
import { readLock, writeLock, isItemProtected } from './lock.js';
import { installSkill, installAgent, installMcp, installBundle, installCommand, installPlugin, type LogFn } from './installer.js';
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

/** Compare installed item hashes against catalog to detect available updates. */
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
      const catalogItem = findEntry(catalog, type, itemName);

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
    const catalogEntry = findEntry(catalog, type, name);

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

/** Force-reinstall a specific list of items. */
export function updateSelected(
  catalog: Catalog,
  items: Array<{ type: string; name: string }>,
  log: LogFn = console.log,
): InstallResult[] {
  const results: InstallResult[] = [];
  for (const { type, name } of items) {
    try {
      if (type === 'skill')        results.push(installSkill(catalog, name, { force: true }, log));
      else if (type === 'agent')   results.push(installAgent(catalog, name, { force: true }, log));
      else if (type === 'mcp')     results.push(installMcp(catalog, name, { force: true }, log));
      else if (type === 'command') results.push(installCommand(catalog, name, { force: true }, log));
      else if (type === 'plugin')  results.push(...installPlugin(catalog, name, { force: true }, log));
    } catch (e: unknown) {
      log(`  [!] Failed to update ${type} ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Update all installed items
// ---------------------------------------------------------------------------

/** Update all installed items that have newer versions in the catalog. */
export function updateAll(
  catalog: Catalog,
  opts: { force?: boolean; strict?: boolean; link?: boolean } = {},
  log: LogFn = console.log,
): InstallResult[] {
  const lock = readLock();
  const results: InstallResult[] = [];
  const strict = opts.strict;

  // Pass 1: bundles
  for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
    if (!lockKey.startsWith('bundle:')) continue;
    const name = lockKey.slice(7);
    const catalogEntry = findBundle(catalog, name);

    if (!catalogEntry) {
      log(`  [!] bundle ${name} no longer in catalog, uninstalling`);
      const l = readLock();
      for (const itemKey of Object.keys(lockEntry.items || {})) {
        if (!isItemProtected(itemKey, lockKey, l, catalog, true)) {
          removeItemFromFilesystem(catalog, itemKey, log);
        }
      }
      delete l.installed[lockKey];
      writeLock(l);
      continue;
    }

    if (opts.force || catalogEntry.hash !== lockEntry.hash) {
      results.push(...installBundle(catalog, name, { force: true, strict, link: opts.link }, log));
      continue;
    }

    // Check sub-items
    let allUpToDate = true;
    for (const [itemKey, itemEntry] of Object.entries(lockEntry.items || {})) {
      const [type, itemName] = itemKey.split(':');
      const catalogItem = findEntry(catalog, type, itemName);

      if (!catalogItem) {
        const l = readLock();
        if (!isItemProtected(itemKey, lockKey, l, catalog, true)) {
          removeItemFromFilesystem(catalog, itemKey, log);
        }
        const items = l.installed[lockKey].items;
        if (items) delete items[itemKey];
        writeLock(l);
        allUpToDate = false;
        continue;
      }
      if (catalogItem.hash !== itemEntry.hash) {
        const installOpts = { force: true, bundleName: name, strict, link: opts.link };
        if (type === 'skill')        results.push(installSkill(catalog, itemName, installOpts, log));
        else if (type === 'agent')   results.push(installAgent(catalog, itemName, installOpts, log));
        else if (type === 'mcp')     results.push(installMcp(catalog, itemName, installOpts, log));
        else if (type === 'command') results.push(installCommand(catalog, itemName, installOpts, log));
        allUpToDate = false;
      }
    }
    if (allUpToDate) log(`  [OK] bundle ${name} (up to date)`);
  }

  // Pass 2: direct installs
  for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
    if (lockKey.startsWith('bundle:')) continue;
    const [type, name] = lockKey.split(':');
    const catalogEntry = findEntry(catalog, type, name);

    if (!catalogEntry) {
      log(`  [!] ${type} ${name} no longer in catalog, removing`);
      const l = readLock();
      if (!isItemProtected(lockKey, null, l, catalog, false)) {
        removeItemFromFilesystem(catalog, lockKey, log);
      }
      delete l.installed[lockKey];
      writeLock(l);
      continue;
    }
    if (!opts.force && catalogEntry.hash === lockEntry.hash) {
      log(`  [OK] ${type} ${name} (up to date)`);
      continue;
    }
    if (type === 'skill')        results.push(installSkill(catalog, name, { force: true, strict, link: opts.link }, log));
    else if (type === 'agent')   results.push(installAgent(catalog, name, { force: true, strict, link: opts.link }, log));
    else if (type === 'mcp')     results.push(installMcp(catalog, name, { force: true, strict }, log));
    else if (type === 'command') results.push(installCommand(catalog, name, { force: true, strict, link: opts.link }, log));
    else if (type === 'plugin')  results.push(...installPlugin(catalog, name, { force: true, strict, link: opts.link }, log));
  }

  return results;
}
