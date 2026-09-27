import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';

const [, , home] = process.argv;
process.env.HOME = home;
process.env.USERPROFILE = home;
const source = path.join(home, 'source');
fs.mkdirSync(source);
fs.writeFileSync(path.join(source, 'herdr-plugin.toml'), 'id = "example.buddy"\nversion = "1.0.0"\n');
// Exercise real filesystem operations with a simulated HerdR CLI on every OS.
// Windows returns the same extended-length namespace as HerdR's canonicalization.
const reportedPath = root => process.platform === 'win32'
  ? path.win32.toNamespacedPath(root) : root + '/.';
let entry;
let failAfterLink = false;
let failUnlink = false;
let linkedPath;
const calls = [];
childProcess.spawnSync = (bin, args) => {
  assert.equal(bin, 'herdr');
  calls.push(args);
  const result = { status: 0, stdout: '', stderr: '' };
  if (args[1] === 'list') {
    result.stdout = JSON.stringify({ result: { plugins: entry ? [entry] : [] } });
  } else if (args[1] === 'link') {
    linkedPath = args[2];
    assert.equal(fs.existsSync(path.join(linkedPath, 'herdr-plugin.toml')), true);
    entry = { plugin_id: 'example.buddy', plugin_root: reportedPath(linkedPath), enabled: args.includes('--enabled') };
    if (failAfterLink) {
      failAfterLink = false;
      result.status = 1;
      result.stderr = 'simulated failure after registration';
    }
  } else if (args[1] === 'unlink') {
    if (failUnlink) { result.status = 1; result.stderr = 'simulated unlink failure'; }
    else entry = undefined;
  } else assert.fail(`Unexpected HerdR command: ${args}`);
  return result;
};
syncBuiltinESMExports();
const load = name => import(pathToFileURL(path.resolve(process.env.TEST_BUILD_DIR, 'core', name + '.js')).href);
const { installHerdrPlugin, removeHerdrPlugin } = await load('herdr-plugins');
const { readLock, writeLock } = await load('lock');
const { sameHerdrPath } = await load('herdr-paths');
const { getSourceRoot } = await load('platform');
fs.mkdirSync(getSourceRoot('unused'), { recursive: true });
const logs = [];
const log = line => logs.push(line);
const install = (hash = 'first') => installHerdrPlugin('buddy', source, hash, 'unused', {}, log);
const saved = () => readLock().installed['herdr:buddy'];

// Equivalent paths must pass verification and ownership checks on repeat install.
assert.equal(install().action, 'installed');
const first = saved();
assert.equal(fs.existsSync(first.herdr.path), true);
assert.equal(sameHerdrPath(entry.plugin_root, first.herdr.path), true);
assert.equal(install().action, 'skipped');

// A failed update restores the old registration, including its disabled state.
entry.enabled = false;
failAfterLink = true;
const beforeUpdate = calls.length;
assert.throws(() => install('changed'), /simulated failure after registration/);
const failedUpdatePath = calls.slice(beforeUpdate).find(args => args[1] === 'link')[2];
assert.equal(fs.existsSync(failedUpdatePath), false);
assert.equal(fs.existsSync(first.herdr.path), true);
assert.equal(sameHerdrPath(entry.plugin_root, first.herdr.path), true);
assert.equal(entry.enabled, false);
assert.deepEqual(saved(), first);

assert.equal(install('changed').action, 'updated');
const second = saved();
assert.notEqual(second.herdr.path, first.herdr.path);
assert.equal(entry.enabled, false);

// Existing external registrations and lockless registrations stay protected.
const ours = entry;
entry = { ...ours, plugin_root: path.join(home, 'foreign') };
assert.throws(() => install(), /outside this toolkit install/);
assert.throws(() => removeHerdrPlugin('buddy', second.herdr, log), /points elsewhere/);
assert.equal(fs.existsSync(second.herdr.path), true);
entry = ours;
writeLock({ installed: {} });
assert.throws(() => install(), /outside this toolkit install/);
writeLock({ installed: { 'herdr:buddy': second } });

// Removal accepts an equivalent registered path and an extended-path lock entry.
removeHerdrPlugin('buddy', { ...second.herdr, path: entry.plugin_root }, log);
assert.equal(entry, undefined);
assert.equal(fs.existsSync(second.herdr.path), false);
writeLock({ installed: {} });

// Failed first install must unlink before deleting files, despite path spelling.
failAfterLink = true;
assert.throws(() => install(), /simulated failure after registration/);
assert.equal(entry, undefined);
assert.equal(fs.existsSync(linkedPath), false);
assert.equal(saved(), undefined);

// If unlink fails, preserve files still referenced by HerdR for explicit recovery.
failAfterLink = true;
failUnlink = true;
assert.throws(() => install(), /simulated failure after registration/);
assert.equal(fs.existsSync(linkedPath), true);
assert.equal(sameHerdrPath(entry.plugin_root, linkedPath), true);
assert.equal(saved(), undefined);
assert.equal(logs.some(line => line.includes('retained files')), true);
console.log(JSON.stringify({ passed: true }));
