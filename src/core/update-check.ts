import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
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
  /** Version we last tried to auto-install. Prevents re-spawning npm install on every launch. */
  lastAutoUpdateVersion?: string;
  lastAutoUpdateAt?: number;
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

// ---------------------------------------------------------------------------
// Install-mode detection + auto-apply
// ---------------------------------------------------------------------------

export type InstallMode =
  | 'global-npm' // installed via `npm install -g toolkit-ai` — safe to auto-update
  | 'local-npm'  // installed into a project's node_modules — don't touch
  | 'npx'        // ephemeral npx cache — npx already fetches latest
  | 'dev'        // running from the source repo (npm link or clone) — never clobber
  | 'unknown';

/**
 * Classify how this process was launched so we only auto-apply the upgrade in
 * situations where it's safe and meaningful. The heuristic is intentionally
 * conservative — if we're not confident it's a `npm -g` install, we return
 * 'unknown' and skip the spawn.
 */
export function detectInstallMode(scriptPath: string = process.argv[1] || ''): InstallMode {
  try {
    if (!scriptPath) return 'unknown';
    const real = fs.realpathSync(scriptPath);
    // npx caches live under paths like `<tmp>/_npx/<hash>/node_modules/...` or
    // `~/.npm/_npx/<hash>/node_modules/...`. Treat these as ephemeral.
    if (/[/\\]_npx[/\\]/.test(real) || /[/\\]npx-cache[/\\]/.test(real)) return 'npx';

    // Locate the `/node_modules/toolkit-ai/` segment. If it's not present, we're
    // either a dev build (repo source) or an unusual install.
    const marker = '/node_modules/';
    const idx = real.indexOf(marker);
    if (idx === -1) {
      const repoRoot = path.resolve(real, '..', '..');
      if (fs.existsSync(path.join(repoRoot, 'src', 'core'))) return 'dev';
      return 'unknown';
    }

    // Ancestor of node_modules: if it has a package.json naming something else,
    // we're a transitive dep inside a user project (local-npm). If no
    // package.json, we're under a global prefix like
    // `~/.nvm/versions/node/vXX/lib/node_modules/` — global-npm.
    const ancestor = real.slice(0, idx);
    const projectPkg = path.join(ancestor, 'package.json');
    if (!fs.existsSync(projectPkg)) return 'global-npm';
    try {
      const parsed = JSON.parse(fs.readFileSync(projectPkg, 'utf8')) as { name?: string };
      return parsed.name === PACKAGE_NAME ? 'dev' : 'local-npm';
    } catch {
      return 'local-npm';
    }
  } catch {
    return 'unknown';
  }
}

export type AutoUpdateResult =
  | 'spawned'            // npm install fired in background
  | 'skipped-off'        // TOOLKIT_AUTO_UPDATE=off
  | 'skipped-no-update'  // already on latest
  | 'skipped-mode'       // not a global install
  | 'skipped-recent'     // we already tried this version in the last 24h
  | 'skipped-dev';       // TOOLKIT_VERSION === 'dev'

/**
 * When we're confident we can safely upgrade this binary, spawn a detached
 * `npm install -g toolkit-ai@<latest>` and return immediately. The child keeps
 * running after the parent exits (detached + unref + stdio ignore). Next launch
 * picks up the new version. Tracks the attempt in the cache so we don't
 * hammer npm on every invocation if the install is slow or the user runs the
 * CLI repeatedly.
 */
export function maybeAutoUpdate(info: UpdateInfo): AutoUpdateResult {
  if (process.env.TOOLKIT_AUTO_UPDATE === 'off') return 'skipped-off';
  if (getCurrentVersion() === 'dev') return 'skipped-dev';
  if (!info.newer || !info.latest) return 'skipped-no-update';

  const mode = detectInstallMode();
  if (mode !== 'global-npm') return 'skipped-mode';

  const cache = readCache();
  if (cache?.lastAutoUpdateVersion === info.latest &&
      cache.lastAutoUpdateAt &&
      Date.now() - cache.lastAutoUpdateAt < CACHE_TTL_MS) {
    return 'skipped-recent';
  }

  try {
    const child = spawn('npm', ['install', '-g', `${PACKAGE_NAME}@latest`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    writeCache({
      latest: info.latest,
      checkedAt: cache?.checkedAt ?? Date.now(),
      lastAutoUpdateVersion: info.latest,
      lastAutoUpdateAt: Date.now(),
    });
    return 'spawned';
  } catch {
    return 'skipped-mode';
  }
}

/** True if an auto-update attempt has been recorded for this `latest` version
 *  within the last 24h. Lets the UI show "upgrading..." instead of the manual
 *  "run npm install" hint. */
export function autoUpdateInFlight(info: UpdateInfo): boolean {
  if (!info.latest) return false;
  const cache = readCache();
  if (!cache?.lastAutoUpdateAt || cache.lastAutoUpdateVersion !== info.latest) return false;
  return Date.now() - cache.lastAutoUpdateAt < CACHE_TTL_MS;
}

