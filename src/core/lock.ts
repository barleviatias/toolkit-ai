import fs from 'fs';
import path from 'path';
import type { LockFile, LockEntry, Catalog } from '../types.js';
import { LOCK_FILE, LEGACY_LOCK_FILE } from './platform.js';
import { ensureDir } from './fs-helpers.js';
import { findPlugin } from './catalog.js';

export function readLock(): LockFile {
  // Try new location first
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) as LockFile;
  } catch {
    // Migrate from legacy location if it exists
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_LOCK_FILE, 'utf8')) as LockFile;
      writeLock(legacy); // save to new location
      return legacy;
    } catch {
      return { installed: {} };
    }
  }
}

export function writeLock(lock: LockFile): void {
  ensureDir(path.dirname(LOCK_FILE));
  lock.lastUpdated = new Date().toISOString();
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2));
}

/**
 * Check if an item is still referenced by another installed plugin
 * or exists as a direct-install entry.
 */
export function isItemProtected(
  itemKey: string,
  excludePluginKey: string | null,
  lock: LockFile,
  catalog: Catalog,
  checkDirectInstall = false,
): boolean {
  for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
    if (!lockKey.startsWith('plugin:')) continue;
    if (lockKey === excludePluginKey) continue;
    if (!lockEntry.items?.[itemKey]) continue;
    if (findPlugin(catalog, lockKey.slice(7))) return true;
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
  pluginName?: string,
): void {
  const lockData: LockEntry = { hash, installedAt: new Date().toISOString() };
  if (pluginName) {
    const pluginKey = `plugin:${pluginName}`;
    if (!lock.installed[pluginKey]) {
      lock.installed[pluginKey] = { hash: '', installedAt: new Date().toISOString(), items: {} };
    }
    if (!lock.installed[pluginKey].items) lock.installed[pluginKey].items = {};
    lock.installed[pluginKey].items[itemKey] = lockData;
  } else {
    lock.installed[itemKey] = lockData;
  }
}
