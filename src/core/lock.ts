import fs from 'fs';
import path from 'path';
import type { LockFile, LockEntry, Catalog } from '../types.js';
import { LOCK_FILE, LEGACY_LOCK_FILE } from './platform.js';
import { ensureDir } from './fs-helpers.js';
import { findBundle } from './catalog.js';

function migrateLockKeys(lock: LockFile): boolean {
  let changed = false;
  for (const [key, value] of Object.entries(lock.installed)) {
    if (key.startsWith('plugin:')) {
      const newKey = 'bundle:' + key.slice(7);
      lock.installed[newKey] = value;
      delete lock.installed[key];
      changed = true;
    }
  }
  return changed;
}

export function readLock(): LockFile {
  // Try new location first
  let lock: LockFile;
  try {
    lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) as LockFile;
  } catch {
    // Migrate from legacy ~/.rdwr/ if it exists
    try {
      lock = JSON.parse(fs.readFileSync(LEGACY_LOCK_FILE, 'utf8')) as LockFile;
      writeLock(lock); // save to new location
    } catch {
      return { installed: {} };
    }
  }
  // Migrate plugin: keys to bundle:
  if (migrateLockKeys(lock)) writeLock(lock);
  return lock;
}

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
