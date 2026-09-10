import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { PassThrough } from 'node:stream';
import React from 'react';
import { render, Text, useInput } from 'ink';

const tempHome = process.argv[2];
const stateDir = path.join(tempHome, '.toolkit');
const source = { name: 'demo', type: 'github', repo: 'owner/repo' };
const sourceDir = path.join(stateDir, 'cache', source.name);
const skillDir = path.join(sourceDir, 'example');
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(path.join(sourceDir, '.fetched'), 'fresh');
fs.writeFileSync(path.join(stateDir, 'sources.json'), JSON.stringify({ sources: [source], cacheTTL: 86400 }));
const writeSkill = description => fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: example\ndescription: ${description}\n---\n# Example\n`);
writeSkill('cached description');
const load = file => import(pathToFileURL(path.join(process.env.TEST_BUILD_DIR, file)).href);
const { loadCatalogSnapshots, saveCatalogSnapshots, sourceIdentity, EMPTY_RESOURCES } = await load('core/catalog-snapshot.js');
const { createCatalogWorker } = await load('core/catalog-worker.js');
const { useCatalog } = await load('hooks/useCatalog.js');
assert.deepEqual(loadCatalogSnapshots([source]).sources, {});

let background = createCatalogWorker();
const seeded = await background.request({ kind: 'source', source, forceRefresh: false });
background.stop();
assert.equal(seeded.snapshots.demo.items[0].description, 'cached description');
assert.equal(loadCatalogSnapshots([source]).sources.demo.items.length, 1);
assert.equal(loadCatalogSnapshots([{ ...source, enabled: false }]).sources.demo, undefined);
assert.equal(loadCatalogSnapshots([{ ...source, branch: 'other' }]).sources.demo, undefined);
assert.equal(loadCatalogSnapshots([{ ...source, repo: 'other/repo' }]).sources.demo, undefined);

// A repeat launch must display the saved metadata before a slow disk scan finishes.
writeSkill('fresh description');
process.env.TOOLKIT_TEST_SLOW_PATH = sourceDir;
process.env.TOOLKIT_TEST_DISK_MARKER = path.join(stateDir, 'slow-scan-started');
const frames = [];
let latest;
let typed = '';
const stdin = new PassThrough();
stdin.isTTY = true;
stdin.setRawMode = () => {};
stdin.ref = () => {};
stdin.unref = () => {};
const stdout = new PassThrough();
stdout.columns = 120;
stdout.rows = 30;
stdout.on('data', () => {});
const stderr = new PassThrough();
stderr.on('data', () => {});
function Probe() {
  latest = useCatalog();
  useInput(input => { typed += input; });
  frames.push({ loading: latest.initialLoading, description: latest.allItems[0]?.description });
  return React.createElement(Text, null, latest.allItems[0]?.description ?? 'empty');
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'catalog did not settle');
    await delay(10);
  }
}

// Source walks on the main thread would throw: cached display and refresh must both survive.
const readdir = fs.readdirSync;
fs.readdirSync = function (dir, ...args) {
  if (String(dir).startsWith(sourceDir)) throw new Error('source scan on UI thread');
  return readdir.call(this, dir, ...args);
};
let app = render(React.createElement(Probe), { stdin, stdout, stderr, patchConsole: false, exitOnCtrlC: false });
await until(() => frames.length > 0);
assert.deepEqual(frames[0], { loading: false, description: 'cached description' });
await until(() => fs.existsSync(process.env.TOOLKIT_TEST_DISK_MARKER));
stdin.write('x');
await until(() => typed === 'x');
assert.equal(latest.loading, true, 'input should be processed while the slow worker is busy');
assert.equal(latest.allItems[0].description, 'cached description');
await until(() => !latest.loading);
assert.equal(latest.allItems[0].description, 'fresh description');
assert.ok(frames.every(frame => !frame.loading), 'warm startup must never show initial loading');

// Install/remove refresh rechecks the live lock without walking files on the UI thread.
fs.writeFileSync(path.join(stateDir, 'lock.json'), JSON.stringify({ installed: {
  'skill:example': { hash: latest.allItems[0].hash, installedAt: new Date().toISOString() },
} }));
latest.refreshLock();
await until(() => latest.installedItems.length === 1);
assert.equal(latest.installedItems[0].hasUpdate, false);

// Disabling during an in-flight refresh must not resurrect a removed source.
const refresh = latest.refreshSingleSource(source, false);
latest.forgetSource(source.name);
await refresh;
await delay(20);
assert.equal(latest.allItems.length, 0);
assert.equal(latest.sourceStatus.has(source.name), false);
app.unmount();
fs.readdirSync = readdir;

// Offline refresh retains the previous catalog and returns an explicit cache warning.
const priorPath = process.env.PATH;
process.env.PATH = path.join(tempHome, 'no-executables');
background = createCatalogWorker();
const offline = await background.request({ kind: 'source', source, forceRefresh: true });
background.stop();
process.env.PATH = priorPath;
assert.equal(offline.snapshots.demo.items[0].description, 'fresh description');
assert.equal(offline.snapshots.demo.resources.warnings[0].usedCache, true);

// Snapshot schema failures and first-run empty state degrade safely.
const cacheFile = path.join(stateDir, 'catalog-cache.json');
for (const contents of ['bad json', JSON.stringify({ version: 999, sources: seeded.snapshots, targetLabels: [] }), JSON.stringify({ version: 1, sources: { demo: { identity: sourceIdentity(source), resources: {}, items: [] } }, targetLabels: [] })]) {
  fs.writeFileSync(cacheFile, contents);
  assert.equal(loadCatalogSnapshots([source]).sources.demo, undefined);
}
frames.length = 0;
app = render(React.createElement(Probe), { stdin, stdout, stderr, patchConsole: false, exitOnCtrlC: false });
await until(() => frames.length > 0);
assert.equal(frames[0].loading, true, 'cold startup should show initial loading');
await until(() => !latest.loading);
assert.equal(latest.allItems[0].description, 'fresh description');
app.unmount();

// Even an intentionally empty cached catalog is a completed initialization.
saveCatalogSnapshots({ demo: { identity: sourceIdentity(source), resources: EMPTY_RESOURCES, items: [] } }, []);
frames.length = 0;
app = render(React.createElement(Probe), { stdin, stdout, stderr, patchConsole: false, exitOnCtrlC: false });
await until(() => frames.length > 0);
assert.equal(frames[0].loading, false);
app.unmount();

// Worker shutdown rejects pending requests instead of keeping the terminal alive.
background = createCatalogWorker();
const pending = background.request({ kind: 'source', source, forceRefresh: false });
background.stop();
await assert.rejects(pending, /stopped/);
await delay(50);
process.stdout.write(JSON.stringify({ passed: true }));
