import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const [, , tempHome] = process.argv;
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
process.env.PATH = '';

const buildDir = process.env.TEST_BUILD_DIR;

const { installExternalPlugin } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'installer.js')).href);
const { updateAll } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'updater.js')).href);
const { readLock } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'lock.js')).href);

const noop = () => {};
const sourceName = 'plugin-update-src';
const pluginRel = 'plugins/updatable-plugin';
const cacheRoot = path.join(tempHome, '.toolkit', 'cache', sourceName);
const pluginDir = path.join(cacheRoot, pluginRel);

fs.mkdirSync(path.join(pluginDir, 'skills', 'hello'), { recursive: true });
fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
  name: 'updatable-plugin',
  description: 'Plugin update regression fixture',
  version: '1.0.0',
}, null, 2));
fs.writeFileSync(path.join(pluginDir, 'skills', 'hello', 'SKILL.md'), `---
name: hello
description: first
---
First.
`);

for (const dir of [
  path.join(tempHome, '.codex'),
  path.join(tempHome, '.agents'),
]) {
  fs.mkdirSync(dir, { recursive: true });
}

const catalog = {
  skills: [],
  agents: [],
  mcps: [],
  bundles: [],
  commands: [],
  plugins: [{
    name: 'updatable-plugin',
    description: 'Plugin update regression fixture',
    source: sourceName,
    path: pluginRel,
    hash: 'plugin-hash-1',
  }],
};

installExternalPlugin(sourceName, 'updatable-plugin', pluginRel, 'plugin-hash-1', {}, noop);
const lockBefore = readLock();

catalog.plugins[0].hash = 'plugin-hash-2';
fs.writeFileSync(path.join(pluginDir, 'skills', 'hello', 'SKILL.md'), `---
name: hello
description: second
---
Second.
`);

const results = updateAll(catalog, {}, noop);
const lockAfter = readLock();

process.stdout.write(JSON.stringify({
  beforeHash: lockBefore.installed['plugin:updatable-plugin']?.hash,
  afterHash: lockAfter.installed['plugin:updatable-plugin']?.hash,
  resultActions: results.map(r => ({ type: r.type, name: r.name, action: r.action })),
  itemHashes: lockAfter.installed['plugin:updatable-plugin']?.items || null,
  installedAt: lockAfter.installed['plugin:updatable-plugin']?.installedAt || null,
}));
