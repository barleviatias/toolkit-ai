import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const [, , tempHome] = process.argv;
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const buildDir = process.env.TEST_BUILD_DIR;

const { scanCopilotInstalledPlugins } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'claude-plugins.js')).href);
const { installExternalPlugin } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'installer.js')).href);
const { removePlugin } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'remover.js')).href);
const { readLock } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'lock.js')).href);
const noop = () => {};

// Stub Copilot CLI's plugin install state. We exercise the marketplace
// install layout (the more common one) — `~/.copilot/installed-plugins/<marketplace>/<plugin>/`
// listed in `~/.copilot/config.json`'s installedPlugins[]. The toolkit
// reads that registry as the authoritative source of truth.
const marketplace = 'demo-marketplace';
const pluginName = 'copilot-installed-demo';
const cachePath = path.join(tempHome, '.copilot', 'installed-plugins', marketplace, pluginName);
fs.mkdirSync(path.join(cachePath, 'skills', 'greet'), { recursive: true });
fs.mkdirSync(path.join(cachePath, 'agents'), { recursive: true });

fs.writeFileSync(path.join(cachePath, 'plugin.json'), JSON.stringify({
  name: pluginName,
  description: 'A plugin Copilot CLI already installed',
  version: '0.5.0',
}, null, 2));
fs.writeFileSync(path.join(cachePath, 'skills', 'greet', 'SKILL.md'),
  '---\nname: greet\ndescription: greet\n---\nhi.\n');
fs.writeFileSync(path.join(cachePath, 'agents', 'helper.md'),
  '---\nname: helper\ndescription: helper agent\n---\nhelp.\n');

// Authoritative registry — config.json with installedPlugins[].
// Match Copilot CLI's real format: `//` header comments on top, then JSON.
// Strict JSON.parse rejects this; only the JSONC-tolerant reader recovers
// the registry. This is a regression target — the symptom on Bar's machine
// was that obsidian had been installed long ago and `radware-ams` later, but
// the comment header made every toolkit-ai read return `[]`, so the
// plugins-tab UI mis-reported Copilot as "will install".
fs.writeFileSync(path.join(tempHome, '.copilot', 'config.json'),
  '// User settings belong in settings.json.\n' +
  '// This file is managed automatically.\n' +
  JSON.stringify({
    firstLaunchAt: '2026-05-05T10:54:04.148Z',
    installedPlugins: [{
      name: pluginName,
      marketplace,
      version: '0.5.0',
      installed_at: '2026-05-14T12:58:44.986Z',
      enabled: true,
      cache_path: cachePath,
    }],
  }, null, 2));

// settings.json with the plugin enabled. Toolkit's uninstaller should drop
// the matching key on remove. Also prefix with a `//` header to lock in
// JSONC tolerance on this read path too.
fs.writeFileSync(path.join(tempHome, '.copilot', 'settings.json'),
  '// settings — JSONC-tolerant.\n' +
  JSON.stringify({
    enabledPlugins: { [`${pluginName}@${marketplace}`]: true },
    unrelated: 'preserved',
  }, null, 2));

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

const discovered = scanCopilotInstalledPlugins();

const found = discovered[0];
const installResults = found
  ? installExternalPlugin(found.source, found.name, found.path, found.hash, {}, noop)
  : [];

const lockAfterInstall = readLock();
const pluginEntry = lockAfterInstall.installed[`plugin:${pluginName}`];

const filesAfterInstall = {
  skillClaude:  fs.existsSync(path.join(tempHome, '.claude', 'skills', 'greet', 'SKILL.md')),
  // Source IS Copilot's native plugin cache, so decompose into ~/.copilot/skills/
  // would create the same file twice (cache + user dir) and surface the agent
  // twice in Copilot's UI. Must be skipped.
  skillCopilotUser: fs.existsSync(path.join(tempHome, '.copilot', 'skills', 'greet', 'SKILL.md')),
  skillCodex:   fs.existsSync(path.join(tempHome, '.agents', 'skills', 'greet', 'SKILL.md')),
  skillAmp:     fs.existsSync(path.join(tempHome, '.config', 'amp', 'skills', 'greet', 'SKILL.md')),
  agentClaude:  fs.existsSync(path.join(tempHome, '.claude', 'agents', 'helper.md')),
  agentCopilotUser: fs.existsSync(path.join(tempHome, '.copilot', 'agents', 'helper.md')),
  agentCodex:   fs.existsSync(path.join(tempHome, '.codex', 'agents', 'helper.toml')),
};

removePlugin({ skills: [], agents: [], mcps: [], bundles: [], commands: [], plugins: [] }, pluginName, noop);

// Native cleanup: removePlugin must also clean Copilot's own state so the
// plugin disappears from Copilot's UI. Toolkit becomes a one-shot uninstall.
const configAfter = JSON.parse(fs.readFileSync(path.join(tempHome, '.copilot', 'config.json'), 'utf8'));
const settingsAfter = JSON.parse(fs.readFileSync(path.join(tempHome, '.copilot', 'settings.json'), 'utf8'));

process.stdout.write(JSON.stringify({
  discovered: discovered.map(d => ({ name: d.name, source: d.source, description: d.description, version: d.version, path: d.path })),
  installResultActions: installResults.map(r => ({ type: r.type, name: r.name, action: r.action })),
  pluginLockedItems: pluginEntry ? Object.keys(pluginEntry.items || {}).sort() : null,
  filesAfterInstall,
  configHasPluginAfterRemove: (configAfter.installedPlugins || []).some(p => p.name === pluginName),
  settingsHasPluginAfterRemove: !!(settingsAfter.enabledPlugins && settingsAfter.enabledPlugins[`${pluginName}@${marketplace}`]),
  unrelatedSettingPreserved: settingsAfter.unrelated === 'preserved',
  copilotCacheDirGone: !fs.existsSync(cachePath),
  marketplaceDirGone: !fs.existsSync(path.dirname(cachePath)),
  copilotInstalledPluginsRootPreserved: fs.existsSync(path.join(tempHome, '.copilot', 'installed-plugins')),
}));
