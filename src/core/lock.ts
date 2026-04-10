import fs from 'fs';
import path from 'path';
import type { LockFile, LockEntry, Catalog } from '../types.js';
import { LOCK_FILE } from './platform.js';
import { ensureDir } from './fs-helpers.js';
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
  ensureDir(path.dirname(LOCK_FILE));
  lock.lastUpdated = new Date().toISOString();
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2));
}

/**
 * Check if an item is still referenced by another installed bundle
 * or exists as a direct-install entry.
 */
export function isItemProtected(
  itemKey: string,
  excludeBundleKey: string | null,
  lock: LockFile,
  catalog: Catalog,
  checkDirectInstall = false,
): boolean {
  for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
    if (!lockKey.startsWith('bundle:')) continue;
    if (lockKey === excludeBundleKey) continue;
    if (!lockEntry.items?.[itemKey]) continue;
    if (findBundle(catalog, lockKey.slice(7))) return true;
  }
  return checkDirectInstall && !!lock.installed[itemKey];
}

/**
 * Record an item install in the lock file.
 * Batches by accepting and returning the lock object — caller controls when to write.
 */
export function recordInstall(
  lock: LockFile,
  itemKey: string,
  hash: string,
  bundleName?: string,
): void {
  const lockData: LockEntry = { hash, installedAt: new Date().toISOString() };
  if (bundleName) {
    const bundleKey = `bundle:${bundleName}`;
    if (!lock.installed[bundleKey]) {
      lock.installed[bundleKey] = { hash: '', installedAt: new Date().toISOString(), items: {} };
    }
    if (!lock.installed[bundleKey].items) lock.installed[bundleKey].items = {};
    lock.installed[bundleKey].items[itemKey] = lockData;
  } else {
    lock.installed[itemKey] = lockData;
  }
}
