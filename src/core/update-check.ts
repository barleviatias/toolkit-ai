import fs from 'fs';
import path from 'path';
import { TOOLKIT_HOME, TOOLKIT_VERSION, UPDATE_CHECK_FILE } from './platform.js';
import { ensureDir } from './fs-helpers.js';

/**
 * Update notification: check the npm registry for a newer toolkit-ai and show
 * a clear command to run. We intentionally do not self-update; global npm
 * permissions, nvm layouts, Windows shells, and corporate npm config make
 * silent background updates unreliable and hard to explain.
 *
 * Opt out with TOOLKIT_NO_UPDATE_CHECK=1. CI environments are auto-detected
 * and skipped.
 */

/** Matches the de-facto CI signals every mainstream CLI (gh, npm, turbo,
 *  update-notifier) checks. Skipping here prevents banner spam in build logs
 *  and prevents accidental `npm install -g` spawns on ephemeral runners. */
function isCI(): boolean {
  const env = process.env;
  return !!(
    env.CI ||
    env.CONTINUOUS_INTEGRATION ||
    env.BUILD_NUMBER ||
    env.GITHUB_ACTIONS ||
    env.GITLAB_CI ||
    env.CIRCLECI ||
    env.TRAVIS ||
    env.CODEBUILD_BUILD_ID ||
    env.BUILDKITE ||
    env.NETLIFY ||
    env.VERCEL ||
    env.CODESPACES
  );
}

function shouldSkipCheck(): boolean {
  return !!process.env.TOOLKIT_NO_UPDATE_CHECK || TOOLKIT_VERSION === 'dev' || isCI();
}

const PACKAGE_NAME = 'toolkit-ai';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h. Note: unit mismatch with
                                          // SourcesConfig.cacheTTL which is seconds.
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

// Module-level memo so multiple callers within a single process (the startup
// check, the hook's initial state, the headless exit print) don't each read +
// parse the file. `undefined` means "not yet loaded"; `null` means "loaded, no
// file existed". Invalidated on every writeCache.
let cachedShape: CacheShape | null | undefined;

function readCache(): CacheShape | null {
  if (cachedShape !== undefined) return cachedShape;
  try {
    cachedShape = JSON.parse(fs.readFileSync(UPDATE_CHECK_FILE, 'utf8')) as CacheShape;
  } catch {
    cachedShape = null;
  }
  return cachedShape;
}

function writeCache(cache: CacheShape): void {
  cachedShape = cache;
  try {
    ensureDir(TOOLKIT_HOME);
    fs.writeFileSync(UPDATE_CHECK_FILE, JSON.stringify(cache, null, 2));
  } catch {
    // Best-effort; a read-only home shouldn't break the tool.
  }
}

function parseVersion(v: string): [number, number, number] {
  const clean = v.replace(/^v/, '').split('-')[0]; // strip pre-release tail
  const parts = clean.split('.').map(n => parseInt(n, 10));
  // NaN || 0 yields 0 — we intentionally swallow garbage versions rather than
  // throwing; the worst case is `isNewer` returns false and the banner hides.
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function isNewer(current: string, latest: string): boolean {
  const [c1, c2, c3] = parseVersion(current);
  const [l1, l2, l3] = parseVersion(latest);
  if (l1 !== c1) return l1 > c1;
  if (l2 !== c2) return l2 > c2;
  return l3 > c3;
}

/** Sync cache read. Use for first TUI paint and CLI exit line — no network. */
export function getCachedUpdateInfo(): UpdateInfo {
  if (shouldSkipCheck()) {
    return { current: TOOLKIT_VERSION, latest: null, newer: false };
  }
  const cache = readCache();
  if (!cache) return { current: TOOLKIT_VERSION, latest: null, newer: false };
  return { current: TOOLKIT_VERSION, latest: cache.latest, newer: isNewer(TOOLKIT_VERSION, cache.latest) };
}

/** Async registry check with 24h cache. Errors are swallowed so offline users
 *  don't see spurious banners. */
export async function checkForUpdate(): Promise<UpdateInfo> {
  if (shouldSkipCheck()) {
    return { current: TOOLKIT_VERSION, latest: null, newer: false };
  }

  const cache = readCache();
  if (cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
    return { current: TOOLKIT_VERSION, latest: cache.latest, newer: isNewer(TOOLKIT_VERSION, cache.latest) };
  }

  try {
    const res = await fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return { current: TOOLKIT_VERSION, latest: cache?.latest ?? null, newer: false };
    const body = (await res.json()) as { version?: string };
    const latest = typeof body.version === 'string' ? body.version : null;
    if (!latest) return { current: TOOLKIT_VERSION, latest: cache?.latest ?? null, newer: false };
    writeCache({
      ...cache,
      latest,
      checkedAt: Date.now(),
    });
    return { current: TOOLKIT_VERSION, latest, newer: isNewer(TOOLKIT_VERSION, latest) };
  } catch {
    return {
      current: TOOLKIT_VERSION,
      latest: cache?.latest ?? null,
      newer: cache ? isNewer(TOOLKIT_VERSION, cache.latest) : false,
    };
  }
}

export function formatUpdateLine(info: UpdateInfo): string | null {
  if (!info.newer || !info.latest) return null;
  return `Update available: toolkit-ai ${info.current} -> ${info.latest}. Run: npm install -g toolkit-ai@latest`;
}

// ---------------------------------------------------------------------------
// Install-mode detection
// ---------------------------------------------------------------------------

export type InstallMode =
  | 'global-npm' // installed via `npm install -g toolkit-ai`
  | 'local-npm'  // inside a project's node_modules — don't touch
  | 'npx'        // ephemeral npx cache — npx already fetches latest
  | 'dev'        // repo source (npm link or clone) — never clobber
  | 'unknown';

// Memo: the script path doesn't change within a process. No invalidation — if
// you're relinking binaries while the CLI is running you have bigger problems.
let memoMode: InstallMode | undefined;
let memoKey: string | undefined;

export function detectInstallMode(scriptPath: string = process.argv[1] || ''): InstallMode {
  if (memoMode !== undefined && memoKey === scriptPath) return memoMode;
  memoKey = scriptPath;
  memoMode = detect(scriptPath);
  return memoMode;
}

function detect(scriptPath: string): InstallMode {
  try {
    if (!scriptPath) return 'unknown';
    const real = fs.realpathSync(scriptPath);
    if (/[/\\]_npx[/\\]/.test(real) || /[/\\]npx-cache[/\\]/.test(real)) return 'npx';

    const idx = real.indexOf('/node_modules/');
    if (idx === -1) {
      const repoRoot = path.resolve(real, '..', '..');
      return fs.existsSync(path.join(repoRoot, 'src', 'core')) ? 'dev' : 'unknown';
    }

    // Parent of node_modules: if its package.json names us, we're a dev
    // checkout; if it names something else, we're a project-local dep; if
    // there's no package.json, we're under a global prefix like
    // `~/.nvm/versions/node/vXX/lib/node_modules/`.
    const projectPkgPath = path.join(real.slice(0, idx), 'package.json');
    try {
      const parsed = JSON.parse(fs.readFileSync(projectPkgPath, 'utf8')) as { name?: string };
      return parsed.name === PACKAGE_NAME ? 'dev' : 'local-npm';
    } catch {
      // No package.json or unreadable: global install.
      return 'global-npm';
    }
  } catch {
    return 'unknown';
  }
}
