import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const buildDir = process.env.TEST_BUILD_DIR;

// Create a temp home so TOOLKIT_HOME / LOCK_FILE resolve inside it.
// We must set HOME/USERPROFILE BEFORE importing lock.ts (which imports platform.ts
// at module level and uses os.homedir()).
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-lock-test-'));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

// Dynamic import after overriding HOME so platform.ts picks up the temp dir
const { recordInstall, isItemProtected, readLock, writeLock } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'lock.js')).href);
const { findBundle } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'catalog.js')).href);

const results = {};

try {
  // --- recordInstall: direct install ---
  const lock1 = { installed: {} };
  recordInstall(lock1, 'skill::src::my-skill', 'abc123');
  results.directInstallHasEntry = !!lock1.installed['skill::src::my-skill'];
  results.directInstallHash = lock1.installed['skill::src::my-skill']?.hash;

  // --- recordInstall: bundle install ---
  const lock2 = { installed: {} };
  recordInstall(lock2, 'skill::src::bundled-skill', 'def456', 'my-bundle');
  results.bundleKeyCreated = !!lock2.installed['bundle:my-bundle'];
  results.bundleItemHash = lock2.installed['bundle:my-bundle']?.items?.['skill::src::bundled-skill']?.hash;

  // --- isItemProtected: item in another bundle ---
  // Create a catalog with a bundle entry so findBundle resolves
  const catalog = {
    skills: [],
    agents: [],
    mcps: [],
    bundles: [{ name: 'bundle-a', description: '', hash: '', path: '', source: 'src' }],
  };

  const lock3 = { installed: {} };
  recordInstall(lock3, 'skill::src::shared-skill', 'aaa', 'bundle-a');
  recordInstall(lock3, 'skill::src::shared-skill', 'bbb', 'bundle-b');

  // Excluding bundle-b, the item is still in bundle-a (which exists in catalog) -> protected
  results.protectedInOtherBundle = isItemProtected(
    'skill::src::shared-skill', 'bundle:bundle-b', lock3, catalog,
  );

  // Excluding bundle-a (the only one in catalog), bundle-b is not in catalog -> not protected
  results.notProtectedExcluded = isItemProtected(
    'skill::src::shared-skill', 'bundle:bundle-a', lock3, catalog,
  );

  // --- writeLock / readLock round-trip ---
  const lock4 = { installed: {} };
  recordInstall(lock4, 'mcp::src::test-mcp', 'xyz');
  writeLock(lock4);
  const reloaded = readLock();
  results.roundTripHash = reloaded.installed['mcp::src::test-mcp']?.hash;
  results.hasLastUpdated = typeof reloaded.lastUpdated === 'string';
} catch (err) {
  results.error = err instanceof Error ? err.message : String(err);
}

// Cleanup
fs.rmSync(tempHome, { recursive: true, force: true });

process.stdout.write(JSON.stringify(results));
