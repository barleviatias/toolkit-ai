import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const [, , tempHome] = process.argv;
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const buildDir = process.env.TEST_BUILD_DIR;

const { scanCodexInstalledPlugins } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'claude-plugins.js')).href);
const { installExternalPlugin } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'installer.js')).href);
const { removePlugin } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'remover.js')).href);
const { readLock } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'lock.js')).href);
const noop = () => {};

const marketplace = 'demo-marketplace';
const pluginName = 'codex-installed-demo';
const version = '1.2.0';
const cachePath = path.join(tempHome, '.codex', 'plugins', 'cache', marketplace, pluginName, version);

fs.mkdirSync(path.join(cachePath, '.codex-plugin'), { recursive: true });
fs.mkdirSync(path.join(cachePath, 'skills', 'greet'), { recursive: true });
fs.mkdirSync(path.join(cachePath, 'agents'), { recursive: true });

fs.writeFileSync(path.join(cachePath, '.codex-plugin', 'plugin.json'), JSON.stringify({
  name: pluginName,
  description: 'A plugin Codex already installed',
  version,
}, null, 2));
fs.writeFileSync(path.join(cachePath, 'skills', 'greet', 'SKILL.md'),
  '---\nname: greet\ndescription: greet\n---\nhi.\n');
fs.writeFileSync(path.join(cachePath, 'agents', 'helper.md'),
  '---\nname: helper\ndescription: helper agent\n---\nhelp.\n');

fs.mkdirSync(path.join(tempHome, '.codex'), { recursive: true });
fs.writeFileSync(path.join(tempHome, '.codex', 'config.toml'), [
  `[marketplaces.${marketplace}]`,
  'source_type = "local"',
  `source = ${JSON.stringify(path.join(tempHome, '.codex', 'plugins', 'cache', marketplace))}`,
  '',
  `[plugins."${pluginName}@${marketplace}"]`,
  'enabled = true',
  '',
].join('\n'));

for (const dir of [
  path.join(tempHome, '.claude'),
  path.join(tempHome, '.copilot'),
  path.join(tempHome, '.codex'),
  path.join(tempHome, '.agents'),
  path.join(tempHome, '.cursor'),
  path.join(tempHome, '.vscode'),
  path.join(tempHome, '.config', 'amp'),
]) {
  fs.mkdirSync(dir, { recursive: true });
}

const discovered = scanCodexInstalledPlugins();
const found = discovered[0];
const installResults = found
  ? installExternalPlugin(found.source, found.name, found.path, found.hash, {}, noop)
  : [];

const lockAfterInstall = readLock();
const pluginEntry = lockAfterInstall.installed[`plugin:${pluginName}`];

const filesAfterInstall = {
  skillClaudeUser: fs.existsSync(path.join(tempHome, '.claude', 'skills', 'greet', 'SKILL.md')),
  skillCodexUser: fs.existsSync(path.join(tempHome, '.agents', 'skills', 'greet', 'SKILL.md')),
  skillCodexSourceCache: fs.existsSync(path.join(cachePath, 'skills', 'greet', 'SKILL.md')),
  skillCodexToolkitCache: fs.existsSync(path.join(tempHome, '.codex', 'plugins', 'cache', 'toolkit-ai', pluginName, version, 'skills', 'greet', 'SKILL.md')),
  skillCopilotUser: fs.existsSync(path.join(tempHome, '.copilot', 'skills', 'greet', 'SKILL.md')),
  skillAmp: fs.existsSync(path.join(tempHome, '.config', 'amp', 'skills', 'greet', 'SKILL.md')),
  agentClaudeUser: fs.existsSync(path.join(tempHome, '.claude', 'agents', 'helper.md')),
  agentCodexUser: fs.existsSync(path.join(tempHome, '.codex', 'agents', 'helper.toml')),
  agentCopilotUser: fs.existsSync(path.join(tempHome, '.copilot', 'agents', 'helper.md')),
};

removePlugin({ skills: [], agents: [], mcps: [], bundles: [], commands: [], plugins: [] }, pluginName, noop);

const configAfter = fs.readFileSync(path.join(tempHome, '.codex', 'config.toml'), 'utf8');

process.stdout.write(JSON.stringify({
  discovered: discovered.map(d => ({ name: d.name, source: d.source, description: d.description, path: d.path })),
  installResultActions: installResults.map(r => ({ type: r.type, name: r.name, action: r.action })),
  pluginLockedItems: pluginEntry ? Object.keys(pluginEntry.items || {}).sort() : null,
  filesAfterInstall,
  sourceCachePreservedAfterRemove: fs.existsSync(path.join(cachePath, '.codex-plugin', 'plugin.json')),
  sourceConfigPreservedAfterRemove: configAfter.includes(`[plugins."${pluginName}@${marketplace}"]`),
  toolkitConfigRemovedAfterRemove: !configAfter.includes(`[plugins."${pluginName}@toolkit-ai"]`),
  toolkitCacheRemovedAfterRemove: !fs.existsSync(path.join(tempHome, '.codex', 'plugins', 'cache', 'toolkit-ai', pluginName)),
}));
