import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const [, , tempHome] = process.argv;
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
const binDir = path.join(tempHome, 'bin');
fs.mkdirSync(binDir, { recursive: true });
process.env.PATH = binDir;
process.env.FAKE_HERDR_REGISTRY = path.join(tempHome, 'herdr.json');
fs.writeFileSync(path.join(binDir, 'herdr'), `#!${process.execPath}
const fs = require('fs');
const registry = process.env.FAKE_HERDR_REGISTRY;
const args = process.argv.slice(2);
const entries = fs.existsSync(registry) ? JSON.parse(fs.readFileSync(registry)) : [];
if (args[1] === 'list') console.log(JSON.stringify({result:{plugins:entries}}));
else if (args[1] === 'link') {
  const root = args[2];
  if (!fs.existsSync(root + '/built')) process.exit(2);
  fs.writeFileSync(registry, JSON.stringify([{plugin_id:'example.update', plugin_root:root, enabled:true}]));
} else if (args[1] === 'unlink') fs.writeFileSync(registry, '[]');
else process.exit(3);
`, { mode: 0o755 });

const buildDir = process.env.TEST_BUILD_DIR;

const { installExternalPlugin, installExternalHerdr } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'installer.js')).href);
const { updateAll } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'updater.js')).href);
const { readLock } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'lock.js')).href);

const noop = () => {};
const sourceName = 'plugin-update-src';
const pluginRel = 'plugins/updatable-plugin';
const herdrRel = 'plugins/updatable-herdr';
const cacheRoot = path.join(tempHome, '.toolkit', 'cache', sourceName);
const pluginDir = path.join(cacheRoot, pluginRel);
const herdrDir = path.join(cacheRoot, herdrRel);

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
fs.mkdirSync(herdrDir, { recursive: true });
fs.writeFileSync(path.join(herdrDir, 'herdr-plugin.toml'), `id = "example.update"
name = "Update fixture"
version = "1.0.0"
min_herdr_version = "0.8.2"
[[build]]
command = [${JSON.stringify(process.execPath)}, "build.cjs"]
`);
fs.writeFileSync(path.join(herdrDir, 'build.cjs'), "require('fs').writeFileSync('built', 'ready');");

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
  herdr: [{
    name: 'updatable-herdr',
    description: 'HerdR update regression fixture',
    source: sourceName,
    path: herdrRel,
    hash: 'herdr-hash-1',
  }],
};

installExternalPlugin(sourceName, 'updatable-plugin', pluginRel, 'plugin-hash-1', {}, noop);
installExternalHerdr(sourceName, 'updatable-herdr', herdrRel, 'herdr-hash-1', {}, noop);
const lockBefore = readLock();

catalog.plugins[0].hash = 'plugin-hash-2';
catalog.herdr[0].hash = 'herdr-hash-2';
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
  herdrBeforeHash: lockBefore.installed['herdr:updatable-herdr']?.hash,
  herdrAfterHash: lockAfter.installed['herdr:updatable-herdr']?.hash,
  herdrRegisteredRoot: JSON.parse(fs.readFileSync(process.env.FAKE_HERDR_REGISTRY))[0]?.plugin_root,
  herdrLockRoot: lockAfter.installed['herdr:updatable-herdr']?.herdr?.path,
  resultActions: results.map(r => ({ type: r.type, name: r.name, action: r.action })),
  itemHashes: lockAfter.installed['plugin:updatable-plugin']?.items || null,
  installedAt: lockAfter.installed['plugin:updatable-plugin']?.installedAt || null,
}));
