import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const [, , tempHome] = process.argv;
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const buildDir = process.env.TEST_BUILD_DIR;

const { scanClaudeInstalledPlugins } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'claude-plugins.js')).href);
const { installExternalPlugin } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'installer.js')).href);
const { removePlugin } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'remover.js')).href);
const { readLock } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'lock.js')).href);
const noop = () => {};

// Lay out a Claude Code plugin install: a plugin tree under
// ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/ + an
// installed_plugins.json that points at it. This is exactly the shape
// `/plugin install` produces.
const marketplace = 'official';
const pluginName = 'demo-plugin';
const version = '1.2.3';
const pluginDir = path.join(
  tempHome, '.claude', 'plugins', 'cache', marketplace, pluginName, version,
);
fs.mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true });
fs.mkdirSync(path.join(pluginDir, 'skills', 'greet'), { recursive: true });
fs.mkdirSync(path.join(pluginDir, 'agents'), { recursive: true });

fs.writeFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify({
  name: pluginName,
  description: 'A plugin Claude Code already installed',
  version,
}, null, 2));
fs.writeFileSync(path.join(pluginDir, 'skills', 'greet', 'SKILL.md'),
  '---\nname: greet\ndescription: greet\n---\nhi.\n');
fs.writeFileSync(path.join(pluginDir, 'agents', 'helper.md'),
  '---\nname: helper\ndescription: helper agent\n---\nhelp.\n');

fs.writeFileSync(
  path.join(tempHome, '.claude', 'plugins', 'installed_plugins.json'),
  JSON.stringify({
    version: 2,
    plugins: {
      [`${pluginName}@${marketplace}`]: [{
        scope: 'user',
        installPath: pluginDir,
        version,
        installedAt: '2026-05-14T00:00:00.000Z',
        lastUpdated: '2026-05-14T00:00:00.000Z',
        gitCommitSha: 'abc123def',
      }],
    },
  }, null, 2),
);

// Pre-create per-tool indicators so cross-provider routing is exercised.
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

const discovered = scanClaudeInstalledPlugins();

// Decompose-install the discovered plugin via the same external-install
// path the toolkit uses for every other plugin source.
const found = discovered[0];
const installResults = found
  ? installExternalPlugin(found.source, found.name, found.path, found.hash, {}, noop)
  : [];

const lockAfterInstall = readLock();
const pluginEntry = lockAfterInstall.installed[`plugin:${pluginName}`];

const filesAfterInstall = {
  // Source IS Claude's own plugin cache, so writing into ~/.claude/skills/
  // and ~/.claude/agents/ would surface every component twice in Claude's UI
  // (once under the plugin, once as a user customization). Must be skipped.
  skillClaudeUser:   fs.existsSync(path.join(tempHome, '.claude', 'skills', 'greet', 'SKILL.md')),
  // Copilot is also detected here, and the toolkit's plugin install registers
  // the plugin natively with Copilot in addition to copying. So Copilot's
  // user dirs are excluded too.
  skillCopilotUser:  fs.existsSync(path.join(tempHome, '.copilot', 'skills', 'greet', 'SKILL.md')),
  skillCodex:        fs.existsSync(path.join(tempHome, '.agents', 'skills', 'greet', 'SKILL.md')),
  skillAmp:          fs.existsSync(path.join(tempHome, '.config', 'amp', 'skills', 'greet', 'SKILL.md')),
  agentClaudeUser:   fs.existsSync(path.join(tempHome, '.claude', 'agents', 'helper.md')),
  agentCopilotUser:  fs.existsSync(path.join(tempHome, '.copilot', 'agents', 'helper.md')),
  agentCodex:        fs.existsSync(path.join(tempHome, '.codex', 'agents', 'helper.toml')),
};

removePlugin({ skills: [], agents: [], mcps: [], bundles: [], commands: [], plugins: [] }, pluginName, noop);

// Critical: removePlugin must NOT touch Claude Code's own plugin cache.
// Toolkit removes the decomposed copies it wrote, never the source plugin.
const claudeCachePreservedAfterRemove = fs.existsSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'));
const claudeInstalledJsonPreserved = fs.existsSync(
  path.join(tempHome, '.claude', 'plugins', 'installed_plugins.json'),
);

process.stdout.write(JSON.stringify({
  discovered: discovered.map(d => ({ name: d.name, source: d.source, description: d.description, path: d.path })),
  installResultActions: installResults.map(r => ({ type: r.type, name: r.name, action: r.action })),
  pluginLockedItems: pluginEntry ? Object.keys(pluginEntry.items || {}).sort() : null,
  filesAfterInstall,
  claudeCachePreservedAfterRemove,
  claudeInstalledJsonPreserved,
}));
