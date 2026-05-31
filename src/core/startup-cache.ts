import fs from 'fs';
import path from 'path';
import { CONFIG_FILE } from './platform.js';
import { ensureDir } from './fs-helpers.js';

/**
 * Cross-process cache for the TUI's startup scans, persisted to
 * `~/.toolkit/scan-cache.json`. The security scanner reads every skill / agent /
 * MCP file and the plugin-contents reader walks every plugin tree — work that is
 * cheap on macOS but slow on Windows (NTFS + Defender scanning each read). Both
 * are keyed by content hash, so a result only changes when the content does.
 * Without persistence every launch starts with an empty in-memory cache and
 * re-reads everything; with it, an unchanged catalog reads one small JSON file
 * instead of ~dozens of source files.
 *
 * Best-effort: any read/write error degrades to an empty cache and a live scan,
 * never a failure. New or changed content (new hash) is always scanned, so the
 * scan-before-show security model is preserved.
 */

export type ScanCacheEntry = { scanStatus: 'ok' | 'warn' | 'block'; scanSummary?: string };
export type PluginCacheEntry =
  | { skills: string[]; agents: string[]; commands: string[]; mcps: number; hasHooks: boolean }
  | null;

interface PersistedStartupCache {
  version: number;
  scan: Record<string, ScanCacheEntry>;
  plugins: Record<string, PluginCacheEntry>;
}

const CACHE_VERSION = 1;
const CACHE_FILE = path.join(path.dirname(CONFIG_FILE), 'scan-cache.json');

/** Load the persisted scan + plugin-contents caches. Returns empty maps on any error or version mismatch. */
export function loadStartupCache(): { scan: Map<string, ScanCacheEntry>; plugins: Map<string, PluginCacheEntry> } {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as PersistedStartupCache;
    if (!raw || raw.version !== CACHE_VERSION) {
      return { scan: new Map(), plugins: new Map() };
    }
    return {
      scan: new Map(Object.entries(raw.scan ?? {})),
      plugins: new Map(Object.entries(raw.plugins ?? {})),
    };
  } catch {
    return { scan: new Map(), plugins: new Map() };
  }
}

/** Persist the scan + plugin-contents caches atomically. Best-effort — never throws. */
export function saveStartupCache(
  scan: Map<string, ScanCacheEntry>,
  plugins: Map<string, PluginCacheEntry>,
): void {
  try {
    const data: PersistedStartupCache = {
      version: CACHE_VERSION,
      scan: Object.fromEntries(scan),
      plugins: Object.fromEntries(plugins),
    };
    ensureDir(path.dirname(CACHE_FILE));
    const tmp = `${CACHE_FILE}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, CACHE_FILE);
  } catch {
    // Cache is an optimization; failing to persist must never break the UI.
  }
}
