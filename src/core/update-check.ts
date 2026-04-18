import fs from 'fs';
import path from 'path';
import { TOOLKIT_HOME } from './platform.js';
import { ensureDir } from './fs-helpers.js';

/**
 * Lightweight self-update checker. Fires a single non-blocking fetch against
 * the npm registry's `latest` dist-tag for toolkit-ai and caches the result
 * for 24h in ~/.toolkit/update-check.json. The TUI renders a banner and the
 * CLI prints a one-liner when a newer version exists — we never auto-apply
 * the upgrade because the right command depends on how the user installed
 * (npm -g, npx, link, local build). Set TOOLKIT_NO_UPDATE_CHECK=1 to skip.
 */

const PACKAGE_NAME = 'toolkit-ai';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CACHE_PATH = path.join(TOOLKIT_HOME, 'update-check.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 5000;

export interface UpdateInfo {
  current: string;
  latest: string | null;
  newer: boolean;
}

interface CacheShape {
  latest: string;
  checkedAt: number;
}

function readCache(): CacheShape | null {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as CacheShape;
  } catch {
    return null;
  }
}

function writeCache(cache: CacheShape): void {
  try {
    ensureDir(TOOLKIT_HOME);
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // Cache write is best-effort; a read-only home shouldn't break the tool.
  }
}

function parseVersion(v: string): [number, number, number] {
  const clean = v.replace(/^v/, '').split('-')[0]; // drop pre-release suffix
  const parts = clean.split('.').map(n => parseInt(n, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** True when `latest` is a higher semver than `current`. Pre-release tails ignored. */
export function isNewer(current: string, latest: string): boolean {
  const [c1, c2, c3] = parseVersion(current);
  const [l1, l2, l3] = parseVersion(latest);
  if (l1 !== c1) return l1 > c1;
  if (l2 !== c2) return l2 > c2;
  return l3 > c3;
}

function getCurrentVersion(): string {
  return process.env.TOOLKIT_VERSION || 'dev';
}

/**
 * Return cached update info without triggering a network call. Use this in
 * synchronous paths (headless commands exiting, initial TUI render) to show
 * the banner immediately without blocking on the registry.
 */
export function getCachedUpdateInfo(): UpdateInfo {
  const current = getCurrentVersion();
  if (process.env.TOOLKIT_NO_UPDATE_CHECK || current === 'dev') {
    return { current, latest: null, newer: false };
  }
  const cache = readCache();
  if (!cache) return { current, latest: null, newer: false };
  return { current, latest: cache.latest, newer: isNewer(current, cache.latest) };
}

/**
 * Fetch the latest version from the npm registry and update the cache. Returns
 * stale cache immediately if it's fresh (< 24h). Errors are swallowed — an
 * offline user shouldn't see a scary banner, and the registry going down is
 * not our problem.
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = getCurrentVersion();
  if (process.env.TOOLKIT_NO_UPDATE_CHECK || current === 'dev') {
    return { current, latest: null, newer: false };
  }

  const cache = readCache();
  if (cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
    return { current, latest: cache.latest, newer: isNewer(current, cache.latest) };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(REGISTRY_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return { current, latest: cache?.latest ?? null, newer: false };
    const body = (await res.json()) as { version?: string };
    const latest = typeof body.version === 'string' ? body.version : null;
    if (!latest) return { current, latest: cache?.latest ?? null, newer: false };
    writeCache({ latest, checkedAt: Date.now() });
    return { current, latest, newer: isNewer(current, latest) };
  } catch {
    return { current, latest: cache?.latest ?? null, newer: cache ? isNewer(current, cache.latest) : false };
  }
}

/** Format a one-line upgrade hint for CLI output. */
export function formatUpdateLine(info: UpdateInfo): string | null {
  if (!info.newer || !info.latest) return null;
  return `A newer toolkit-ai is available: ${info.current} -> ${info.latest}. Run \`npm install -g toolkit-ai@latest\` to upgrade.`;
}
