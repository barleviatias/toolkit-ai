import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const [, , tempHome] = process.argv;
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const buildDir = process.env.TEST_BUILD_DIR;

const { installExternalPlugin } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'installer.js')).href);
const { removePlugin } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'remover.js')).href);
const { readLock } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'lock.js')).href);
const noop = () => {};

// `manifestKind` selects which manifest layout the fixture writes. This lets
// the test cover both Claude Code (`.claude-plugin/plugin.json`) and the
// generic top-level (`plugin.json`) discovery paths through a single fixture.
const manifestKind = process.env.PLUGIN_MANIFEST_KIND || 'claude';

const sourceName = 'test-plugin-src';
const pluginRel = 'plugins/example-plugin';
const cacheRoot = path.join(tempHome, '.toolkit', 'cache', sourceName);
const pluginDir = path.join(cacheRoot, pluginRel);

fs.mkdirSync(path.join(pluginDir, 'skills', 'hello'), { recursive: true });
fs.mkdirSync(path.join(pluginDir, 'agents'), { recursive: true });
fs.mkdirSync(path.join(pluginDir, 'commands'), { recursive: true });
fs.mkdirSync(path.join(pluginDir, 'hooks'), { recursive: true });

const manifestPath = manifestKind === 'generic'
  ? path.join(pluginDir, 'plugin.json')
  : manifestKind === 'codex'
    ? path.join(pluginDir, '.codex-plugin', 'plugin.json')
  : path.join(pluginDir, '.claude-plugin', 'plugin.json');
fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify({
  name: 'example-plugin',
  description: 'A test plugin',
  version: '1.0.0',
  // Explicit agent path scope mirrors AMS: only the copilot adapter is
  // selected for install. The Claude-flavor file at agents/<name>.md MUST
  // be left out of both the install AND the Copilot plugin tree copy.
  agents: 'agents/adapters/copilot/',
}, null, 2));

fs.writeFileSync(path.join(pluginDir, 'skills', 'hello', 'SKILL.md'), `---
name: hello
description: Greet the user
---
Hello!
`);

// Claude-flavor variant at the canonical root. Manifest's `agents` field
// scopes installs to the copilot adapter, so this MUST NOT end up in the
// install OR in the Copilot plugin tree — otherwise Copilot's recursive
// scan of the plugin tree exposes the same agent twice.
fs.writeFileSync(path.join(pluginDir, 'agents', 'reviewer.md'), `---
name: reviewer
description: Claude-flavor variant — must not be installed or copied
---
Claude flavor.
`);

// Copilot-flavor variant. The manifest selects this one.
fs.mkdirSync(path.join(pluginDir, 'agents', 'adapters', 'copilot'), { recursive: true });
fs.writeFileSync(path.join(pluginDir, 'agents', 'adapters', 'copilot', 'reviewer.agent.md'), `---
name: reviewer
description: Reviews code
---
Review the changes.
`);

fs.writeFileSync(path.join(pluginDir, 'commands', 'deploy.md'), `---
description: Deploy the app
---
Deploy now.
`);

// Hooks file — installer must skip this and log a warning.
fs.writeFileSync(path.join(pluginDir, 'hooks', 'hooks.json'), JSON.stringify({
  hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo done' }] }] },
}, null, 2));

// Per-tool hook-config templates. The installer should swap
// hooks/configs/<tool>.hooks.json into hooks/hooks.json for that tool's
// install (overwriting the Claude flavor above) and substitute
// `__AMS_PLUGIN_ROOT__` with the install destDir. Claude's install must
// NOT be swapped: it keeps the canonical hooks.json above.
fs.mkdirSync(path.join(pluginDir, 'hooks', 'configs'), { recursive: true });
fs.writeFileSync(path.join(pluginDir, 'hooks', 'configs', 'copilot.hooks.json'),
  JSON.stringify({
    version: 1,
    _flavor: 'copilot',
    _pluginRoot: '__AMS_PLUGIN_ROOT__',
    hooks: {
      sessionStart: [
        { type: 'command', command: 'bash __AMS_PLUGIN_ROOT__/hooks/python-launcher.sh' },
      ],
    },
  }, null, 2));
fs.writeFileSync(path.join(pluginDir, 'hooks', 'configs', 'codex.hooks.json'),
  JSON.stringify({
    version: 1,
    _flavor: 'codex',
    _pluginRoot: '__AMS_PLUGIN_ROOT__',
    hooks: {
      sessionStart: [
        { type: 'command', command: 'bash __AMS_PLUGIN_ROOT__/hooks/python-launcher.sh' },
      ],
    },
  }, null, 2));

// Pre-create per-tool home dirs so target detection treats each as installed.
// Without these, `getWritableSkillTargets` etc. would return only the dirs
// matching whichever tool happens to be globally installed on the dev machine,
// making the test flaky and hiding cross-provider regressions.
for (const dir of [
  path.join(tempHome, '.claude'),
  path.join(tempHome, '.copilot'),
  path.join(tempHome, '.codex'),
  path.join(tempHome, '.agents'),       // Codex shared skills root
  path.join(tempHome, '.cursor'),
  path.join(tempHome, '.vscode'),
  path.join(tempHome, '.config', 'amp'), // Amp
]) {
  fs.mkdirSync(dir, { recursive: true });
}

const catalog = { skills: [], agents: [], mcps: [], bundles: [], commands: [], plugins: [] };

const results = installExternalPlugin(
  sourceName,
  'example-plugin',
  pluginRel,
  'plugin-hash-1',
  {},
  noop,
);

const lockAfterInstall = readLock();
const pluginEntry = lockAfterInstall.installed['plugin:example-plugin'];

// Each tool that has a native plugin manager gets the plugin tree via that
// manager (Claude: ~/.claude/plugins/cache/toolkit-ai/<name>/<version>/,
// Codex: ~/.codex/plugins/cache/toolkit-ai/<name>/<version>/,
// Copilot: ~/.copilot/installed-plugins/toolkit-ai/<name>/). User-level
// dirs (~/.claude/agents/, ~/.agents/skills/, ~/.copilot/agents/, etc.) MUST stay empty for
// those tools — otherwise the same agent appears twice in their UIs (once
// as "user", once under the plugin entry).
const copilotPluginTree = path.join(tempHome, '.copilot', 'installed-plugins', 'toolkit-ai', 'example-plugin');
const claudePluginTree  = path.join(tempHome, '.claude', 'plugins', 'cache', 'toolkit-ai', 'example-plugin', '1.0.0');
const codexPluginTree   = path.join(tempHome, '.codex', 'plugins', 'cache', 'toolkit-ai', 'example-plugin', '1.0.0');

const filesAfterInstall = {
  // Skill: lands in Amp's user dir (no plugin manager), in Claude's,
  // Codex's, and Copilot's plugin trees. NOT in Claude/Codex/Copilot user
  // dirs — those are excluded.
  skillClaudeUser:    fs.existsSync(path.join(tempHome, '.claude', 'skills', 'hello', 'SKILL.md')),
  skillClaudePlugin:  fs.existsSync(path.join(claudePluginTree, 'skills', 'hello', 'SKILL.md')),
  skillCopilotUser:   fs.existsSync(path.join(tempHome, '.copilot', 'skills', 'hello', 'SKILL.md')),
  skillCopilotPlugin: fs.existsSync(path.join(copilotPluginTree, 'skills', 'hello', 'SKILL.md')),
  skillCodexUser:     fs.existsSync(path.join(tempHome, '.agents', 'skills', 'hello', 'SKILL.md')),
  skillCodexPlugin:   fs.existsSync(path.join(codexPluginTree, 'skills', 'hello', 'SKILL.md')),
  skillCodex:   fs.existsSync(path.join(tempHome, '.agents', 'skills', 'hello', 'SKILL.md')),
  skillAmp:     fs.existsSync(path.join(tempHome, '.config', 'amp', 'skills', 'hello', 'SKILL.md')),
  agentClaudeUser:    fs.existsSync(path.join(tempHome, '.claude', 'agents', 'reviewer.agent.md')),
  agentClaudePlugin:  fs.existsSync(path.join(claudePluginTree, 'agents', 'reviewer.agent.md')),
  agentCopilotUser:   fs.existsSync(path.join(tempHome, '.copilot', 'agents', 'reviewer.agent.md')),
  agentCopilotPlugin: fs.existsSync(path.join(copilotPluginTree, 'agents', 'reviewer.agent.md')),
  agentCodexUser:     fs.existsSync(path.join(tempHome, '.codex', 'agents', 'reviewer.toml')),
  agentCodexPlugin:   fs.existsSync(path.join(codexPluginTree, 'agents', 'reviewer.agent.md')),
  agentCodex:    fs.existsSync(path.join(tempHome, '.codex', 'agents', 'reviewer.toml')),
  commandClaudeUser:   fs.existsSync(path.join(tempHome, '.claude', 'commands', 'deploy.md')),
  commandClaudePlugin: fs.existsSync(path.join(claudePluginTree, 'commands', 'deploy.md')),
  commandCursor: fs.existsSync(path.join(tempHome, '.cursor', 'commands', 'deploy.md')),
};

removePlugin(catalog, 'example-plugin', noop);

const lockAfterRemove = readLock();
const pluginAfter = lockAfterRemove.installed['plugin:example-plugin'];
const codexConfigAfterRemove = (() => {
  try { return fs.readFileSync(path.join(tempHome, '.codex', 'config.toml'), 'utf8'); }
  catch { return ''; }
})();

const filesAfterRemove = {
  anySkillSurvives:
    fs.existsSync(path.join(claudePluginTree, 'skills', 'hello', 'SKILL.md')) ||
    fs.existsSync(path.join(tempHome, '.claude', 'skills', 'hello', 'SKILL.md')) ||
    fs.existsSync(path.join(tempHome, '.copilot', 'skills', 'hello', 'SKILL.md')) ||
    fs.existsSync(path.join(tempHome, '.agents', 'skills', 'hello', 'SKILL.md')) ||
    fs.existsSync(path.join(codexPluginTree, 'skills', 'hello', 'SKILL.md')) ||
    fs.existsSync(path.join(tempHome, '.config', 'amp', 'skills', 'hello', 'SKILL.md')),
  anyAgentSurvives:
    fs.existsSync(path.join(tempHome, '.claude', 'agents', 'reviewer.agent.md')) ||
    fs.existsSync(path.join(tempHome, '.copilot', 'agents', 'reviewer.agent.md')) ||
    fs.existsSync(path.join(tempHome, '.codex', 'agents', 'reviewer.toml')) ||
    fs.existsSync(path.join(codexPluginTree, 'agents', 'reviewer.agent.md')) ||
    fs.existsSync(path.join(claudePluginTree, 'agents', 'reviewer.agent.md')),
  anyCommandSurvives:
    fs.existsSync(path.join(tempHome, '.claude', 'commands', 'deploy.md')) ||
    fs.existsSync(path.join(tempHome, '.cursor', 'commands', 'deploy.md')) ||
    fs.existsSync(path.join(claudePluginTree, 'commands', 'deploy.md')),
  codexConfigHasPlugin:
    codexConfigAfterRemove.includes('[plugins."example-plugin@toolkit-ai"]'),
};

// Migration cleanup: simulate a stale install left over from earlier toolkit
// versions that decompose-installed components into Copilot's user dirs.
// The next install must purge these so the plugin's components don't show
// up twice in Copilot's UI ("user" agent + plugin agent).
fs.mkdirSync(path.join(tempHome, '.copilot', 'agents'), { recursive: true });
fs.writeFileSync(path.join(tempHome, '.copilot', 'agents', 'reviewer.agent.md'),
  '---\nname: reviewer\ndescription: stale\n---\nstale.\n');
fs.mkdirSync(path.join(tempHome, '.copilot', 'skills', 'hello'), { recursive: true });
fs.writeFileSync(path.join(tempHome, '.copilot', 'skills', 'hello', 'SKILL.md'),
  '---\nname: hello\ndescription: stale\n---\nstale.\n');
const stalePresentBeforeReinstall = {
  staleAgent: fs.existsSync(path.join(tempHome, '.copilot', 'agents', 'reviewer.agent.md')),
  staleSkill: fs.existsSync(path.join(tempHome, '.copilot', 'skills', 'hello', 'SKILL.md')),
};

// Native Copilot plugin registration: when Copilot is detected, the
// plugin install also copies the tree to ~/.copilot/installed-plugins/
// and writes config.json + settings.json so Copilot's own UI shows it.
// We check the BEFORE-remove state by re-installing first then peeking.
const reinstallResults = installExternalPlugin(
  sourceName,
  'example-plugin',
  pluginRel,
  'plugin-hash-1',
  {},
  noop,
);

const stalePurgedAfterReinstall = {
  staleAgentGone: !fs.existsSync(path.join(tempHome, '.copilot', 'agents', 'reviewer.agent.md')),
  staleSkillGone: !fs.existsSync(path.join(tempHome, '.copilot', 'skills', 'hello', 'SKILL.md')),
};
const copilotConfig = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(tempHome, '.copilot', 'config.json'), 'utf8')); }
  catch { return null; }
})();
const codexConfig = (() => {
  try { return fs.readFileSync(path.join(tempHome, '.codex', 'config.toml'), 'utf8'); }
  catch { return ''; }
})();
const copilotSettings = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(tempHome, '.copilot', 'settings.json'), 'utf8')); }
  catch { return null; }
})();
const copilotPluginRoot = path.join(tempHome, '.copilot', 'installed-plugins', 'toolkit-ai', 'example-plugin');
const claudeInstalledJson = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(tempHome, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')); }
  catch { return null; }
})();
const claudeNative = {
  installedJsonHasPlugin: !!claudeInstalledJson?.plugins?.['example-plugin@toolkit-ai']?.[0],
  pluginTreeManifestExists:
    fs.existsSync(path.join(claudePluginTree, '.claude-plugin', 'plugin.json')) ||
    fs.existsSync(path.join(claudePluginTree, 'plugin.json')),
};
const codexNative = {
  configHasPlugin: codexConfig.includes('[plugins."example-plugin@toolkit-ai"]') &&
    codexConfig.includes('enabled = true'),
  configHasMarketplace: codexConfig.includes('[marketplaces.toolkit-ai]') &&
    codexConfig.includes('source_type = "local"'),
  cacheTreeExists:
    fs.existsSync(path.join(codexPluginTree, '.codex-plugin', 'plugin.json')),
  selectedAgentPresent: fs.existsSync(path.join(codexPluginTree, 'agents', 'reviewer.agent.md')),
  unselectedAgentVariantAbsent: !fs.existsSync(path.join(codexPluginTree, 'agents', 'reviewer.md')),
  adapterSubdirAbsent: !fs.existsSync(path.join(codexPluginTree, 'agents', 'adapters')),
};

const copilotNative = {
  configHasPlugin: !!(copilotConfig?.installedPlugins || []).find(p => p.name === 'example-plugin'),
  settingsEnabledHasPlugin: !!copilotSettings?.enabledPlugins?.['example-plugin@toolkit-ai'],
  // Manifest may live at .claude-plugin/plugin.json or plugin.json depending
  // on which fixture variant ran. Either presence proves the tree was copied.
  cacheTreeExists:
    fs.existsSync(path.join(copilotPluginRoot, '.claude-plugin', 'plugin.json')) ||
    fs.existsSync(path.join(copilotPluginRoot, 'plugin.json')),
  // Selected agent (copilot adapter) lives at the canonical path inside
  // the copied tree, NOT under a deep adapter subdir.
  selectedAgentPresent: fs.existsSync(path.join(copilotPluginRoot, 'agents', 'reviewer.agent.md')),
  // The Claude-flavor variant from agents/<name>.md must NOT have been
  // copied — otherwise Copilot's recursive plugin scan picks both files up
  // and surfaces "reviewer" twice in its UI.
  unselectedAgentVariantAbsent: !fs.existsSync(path.join(copilotPluginRoot, 'agents', 'reviewer.md')),
  // The original adapter subdir layout must NOT survive either.
  adapterSubdirAbsent: !fs.existsSync(path.join(copilotPluginRoot, 'agents', 'adapters')),
};

// Hooks-swap assertions. Claude install keeps the canonical hooks.json
// (PostToolUse marker survives); Copilot and Codex installs must have
// it overwritten with their flavor and `__AMS_PLUGIN_ROOT__` substituted
// with the install destDir.
const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
};
const claudeHooksFile  = readJson(path.join(claudePluginTree, 'hooks', 'hooks.json'));
const copilotHooksFile = readJson(path.join(copilotPluginRoot, 'hooks', 'hooks.json'));
const codexHooksFile   = readJson(path.join(codexPluginTree, 'hooks', 'hooks.json'));
const hooksSwap = {
  claudeUntouched: !!claudeHooksFile?.hooks?.PostToolUse,
  claudeNoPlaceholder: !JSON.stringify(claudeHooksFile ?? {}).includes('__AMS_PLUGIN_ROOT__'),
  copilotFlavor: copilotHooksFile?._flavor === 'copilot',
  copilotRootResolved: copilotHooksFile?._pluginRoot === copilotPluginRoot,
  copilotNoPlaceholder: !JSON.stringify(copilotHooksFile ?? {}).includes('__AMS_PLUGIN_ROOT__'),
  codexFlavor: codexHooksFile?._flavor === 'codex',
  codexRootResolved: codexHooksFile?._pluginRoot === codexPluginTree,
  codexNoPlaceholder: !JSON.stringify(codexHooksFile ?? {}).includes('__AMS_PLUGIN_ROOT__'),
};

process.stdout.write(JSON.stringify({
  installResultActions: results.map(r => ({ type: r.type, name: r.name, action: r.action })),
  pluginLockedItems: pluginEntry ? Object.keys(pluginEntry.items || {}).sort() : null,
  pluginLockHash: pluginEntry?.hash ?? null,
  filesAfterInstall,
  filesAfterRemove,
  hooksSwap,
  stalePresentBeforeReinstall,
  stalePurgedAfterReinstall,
  pluginEntryAfterRemove: pluginAfter ?? null,
  claudeNative,
  codexNative,
  copilotNative,
  reinstallActionCount: reinstallResults.length,
}));
