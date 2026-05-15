import fs from 'fs';
import type { LockFile, LockEntry, Catalog } from '../types.js';
import { LOCK_FILE } from './platform.js';
import { writeJsonAtomic } from './fs-helpers.js';
import { findBundle } from './catalog.js';

/** Read the lock file from disk, returning an empty lock if it doesn't exist. */
export function readLock(): LockFile {
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) as LockFile;
  } catch {
    return { installed: {} };
  }
}

/** Persist the lock file to disk with an updated timestamp. */
export function writeLock(lock: LockFile): void {
  lock.lastUpdated = new Date().toISOString();
  writeJsonAtomic(LOCK_FILE, lock);
}

/**
 * Check if an item is still referenced by another installed bundle/plugin
 * or exists as a direct-install entry. We treat installed plugins like
 * bundles for protection purposes — removing one shouldn't yank an item
 * still claimed by another. We only require a catalog match for bundles
 * (legacy guard); plugin parents are trusted from lock state.
 */
export function isItemProtected(
  itemKey: string,
  excludeParentKey: string | null,
  lock: LockFile,
  catalog: Catalog,
  checkDirectInstall = false,
): boolean {
  for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
    const isBundle = lockKey.startsWith('bundle:');
    const isPlugin = lockKey.startsWith('plugin:');
    if (!isBundle && !isPlugin) continue;
    if (lockKey === excludeParentKey) continue;
    if (!lockEntry.items?.[itemKey]) continue;
    if (isBundle && findBundle(catalog, lockKey.slice(7))) return true;
    if (isPlugin) return true;
  }
  return checkDirectInstall && !!lock.installed[itemKey];
}

/**
 * Record an item install in the lock file.
 * Batches by accepting and returning the lock object — caller controls when to write.
 *
 * If `parentKey` (e.g. `bundle:foo` or `plugin:foo`) is set, the item is recorded
 * under that parent's `items` map instead of as a top-level entry.
 */
export function recordInstall(
  lock: LockFile,
  itemKey: string,
  hash: string,
  parentKey?: string,
): void {
  const lockData: LockEntry = { hash, installedAt: new Date().toISOString() };
  if (parentKey) {
    if (!lock.installed[parentKey]) {
      lock.installed[parentKey] = { hash: '', installedAt: new Date().toISOString(), items: {} };
    }
    if (!lock.installed[parentKey].items) lock.installed[parentKey].items = {};
    lock.installed[parentKey].items[itemKey] = lockData;
  } else {
    lock.installed[itemKey] = lockData;
  }
}
