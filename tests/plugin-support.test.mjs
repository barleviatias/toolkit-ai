import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_DIR = path.join(ROOT, 'tests', 'fixtures');
const BUILD_DIR = process.env.TEST_BUILD_DIR;

function runFixture(name, args = [], extraEnv = {}) {
  const result = spawnSync(process.execPath, [path.join(FIXTURES_DIR, name), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, TEST_BUILD_DIR: BUILD_DIR, ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Fixture ${name} failed`);
  }
  return JSON.parse(result.stdout);
}

function assertPluginRoundTrip(data) {
  // Components that still target standalone dirs install normally. The agent
  // is native-only in this fixture (Claude/Codex/Copilot all own it via
  // plugin trees), so the decomposed installer correctly reports skipped.
  const actions = Object.fromEntries(data.installResultActions.map(r => [`${r.type}:${r.name}`, r.action]));
  assert.equal(actions['skill:hello'], 'installed');
  assert.equal(actions['agent:reviewer'], 'skipped');
  assert.equal(actions['command:deploy'], 'installed');

  // Hooks were detected but never installed — no hooks-related result entry.
  assert.ok(!data.installResultActions.some(r => r.name === 'hooks'));

  // Lock recorded the plugin and nested its sub-items.
  assert.equal(data.pluginLockHash, 'plugin-hash-1');
  assert.deepEqual(data.pluginLockedItems, [
    'command:deploy',
    'skill:hello',
  ]);

  // Cross-provider routing. Each tool with a native plugin manager (Claude,
  // Codex, Copilot) gets the plugin via that manager — plugin tree under
  // ~/.<tool>/plugins/cache/ or ~/.<tool>/installed-plugins/. The matching
  // user dirs (~/.claude/agents/, ~/.agents/skills/, ~/.copilot/skills/, etc.) MUST stay empty,
  // otherwise Copilot's "Agent Customizations" UI (which scans both ~/.copilot/
  // AND ~/.claude/ for cross-tool compat) surfaces every item twice.
  assert.equal(data.filesAfterInstall.skillClaudeUser,  false, 'skill must NOT land in ~/.claude/skills/ (Claude plugin tree owns it)');
  assert.equal(data.filesAfterInstall.skillClaudePlugin, true, 'skill should be inside Claude plugin tree');
  assert.equal(data.filesAfterInstall.skillCopilotUser, false, 'skill must NOT land in ~/.copilot/skills/ (Copilot plugin tree owns it)');
  assert.equal(data.filesAfterInstall.skillCopilotPlugin, true, 'skill should be inside Copilot plugin tree');
  assert.equal(data.filesAfterInstall.skillCodexUser, false, 'skill must NOT land in ~/.agents/skills/ (Codex plugin tree owns it)');
  assert.equal(data.filesAfterInstall.skillCodexPlugin, true, 'skill should be inside Codex plugin tree');
  assert.equal(data.filesAfterInstall.skillAmp,     true, 'skill should install for Amp');
  assert.equal(data.filesAfterInstall.agentClaudeUser,  false, 'agent must NOT land in ~/.claude/agents/ (Claude plugin tree owns it)');
  assert.equal(data.filesAfterInstall.agentClaudePlugin, true, 'agent should be inside Claude plugin tree');
  assert.equal(data.filesAfterInstall.agentCopilotUser, false, 'agent must NOT land in ~/.copilot/agents/ (Copilot plugin tree owns it)');
  assert.equal(data.filesAfterInstall.agentCopilotPlugin, true, 'agent should be inside Copilot plugin tree');
  assert.equal(data.filesAfterInstall.agentCodexUser, false, 'agent must NOT land in ~/.codex/agents/ (Codex plugin tree owns it)');
  assert.equal(data.filesAfterInstall.agentCodexPlugin, true, 'agent should be inside Codex plugin tree');
  assert.equal(data.filesAfterInstall.commandClaudeUser, false, 'command must NOT land in ~/.claude/commands/ (Claude plugin tree owns it)');
  assert.equal(data.filesAfterInstall.commandClaudePlugin, true, 'command should be inside Claude plugin tree');
  assert.equal(data.filesAfterInstall.commandCodexPlugin, true, 'command should be inside Codex plugin tree');
  assert.equal(data.filesAfterInstall.commandCursor, true, 'command should install for Cursor');

  // After removePlugin: every decomposed file is cleaned, lock entry is gone.
  assert.equal(data.filesAfterRemove.anySkillSurvives, false);
  assert.equal(data.filesAfterRemove.anyAgentSurvives, false);
  assert.equal(data.filesAfterRemove.anyCommandSurvives, false);
  assert.equal(data.filesAfterRemove.codexConfigHasPlugin, false);
  assert.equal(data.pluginEntryAfterRemove, null);

  // Native Copilot registration: after re-install, Copilot's own state
  // shows the plugin (registry entry + enabled flag + cached tree). This
  // is what makes the plugin show up in Copilot's "Plugins" UI panel.
  assert.equal(data.copilotNative.configHasPlugin, true,
    'plugin must be registered in ~/.copilot/config.json installedPlugins[]');
  assert.equal(data.copilotNative.settingsEnabledHasPlugin, true,
    'plugin must be enabled in ~/.copilot/settings.json enabledPlugins');
  assert.equal(data.copilotNative.cacheTreeExists, true,
    'plugin tree must be copied to ~/.copilot/installed-plugins/toolkit-ai/<name>/');

  // Native Claude registration: parallel to Copilot. Lets Claude show the
  // plugin under "Plugins" without us touching ~/.claude/agents/.
  assert.equal(data.claudeNative.installedJsonHasPlugin, true,
    'plugin must be registered in ~/.claude/plugins/installed_plugins.json');
  assert.equal(data.claudeNative.pluginTreeManifestExists, true,
    'plugin tree must be copied to ~/.claude/plugins/cache/toolkit-ai/<name>/<version>/');
  assert.equal(data.codexNative.configHasPlugin, true,
    'plugin must be enabled in ~/.codex/config.toml');
  assert.equal(data.codexNative.configHasMarketplace, true,
    'toolkit-ai marketplace must be registered in ~/.codex/config.toml');
  assert.equal(data.codexNative.cacheTreeExists, true,
    'plugin tree must be copied to ~/.codex/plugins/cache/toolkit-ai/<name>/<version>/');
  assert.equal(data.codexNative.selectedAgentPresent, true,
    'manifest-selected agent must be in the Codex plugin tree at canonical path');
  assert.equal(data.codexNative.unselectedAgentVariantAbsent, true,
    'unselected agent variant must NOT be copied into Codex plugin tree');
  assert.equal(data.codexNative.adapterSubdirAbsent, true,
    'adapter subdir layout must not survive the scoped Codex copy');
  assert.equal(data.codexNative.commandFrontmatterSafe, true,
    'Codex plugin commands must drop AMS/Claude-only frontmatter keys while preserving description and argument-hint');
  assert.equal(data.copilotNative.selectedAgentPresent, true,
    'manifest-selected agent must be in the Copilot plugin tree at canonical path');
  assert.equal(data.copilotNative.unselectedAgentVariantAbsent, true,
    'unselected agent variant must NOT be copied — Copilot scans recursively and would surface a duplicate');
  assert.equal(data.copilotNative.adapterSubdirAbsent, true,
    'adapter subdir layout must not survive the scoped copy');

  // Migration cleanup: stale user-level files left by earlier toolkit
  // versions are purged on reinstall so they stop duplicating the plugin
  // tree's copies in Copilot's UI.
  assert.equal(data.stalePresentBeforeReinstall.staleAgent, true);
  assert.equal(data.stalePresentBeforeReinstall.staleSkill, true);
  assert.equal(data.stalePurgedAfterReinstall.staleAgentGone, true,
    'reinstall must purge ~/.copilot/agents/<name>.md left by pre-exclusion installs');
  assert.equal(data.stalePurgedAfterReinstall.staleSkillGone, true,
    'reinstall must purge ~/.copilot/skills/<name>/ left by pre-exclusion installs');

  // Root-level files inside skills/ (e.g. AMS's .ams-stack-index) must be
  // copied verbatim into every plugin install tree — the pre-fix loop
  // only iterated skill folders and silently dropped these.
  assert.equal(data.skillsRoot.claudeHasIndex, true,
    'skills/.ams-stack-index must land in the Claude plugin tree');
  assert.equal(data.skillsRoot.copilotHasIndex, true,
    'skills/.ams-stack-index must land in the Copilot plugin tree');
  assert.equal(data.skillsRoot.codexHasIndex, true,
    'skills/.ams-stack-index must land in the Codex plugin tree');

  // Per-tool hooks.json swap. A plugin can ship hooks/configs/<tool>.hooks.json
  // alongside the canonical hooks/hooks.json (Claude flavor). The installer
  // overwrites the canonical file with the tool-flavored template at
  // install time and substitutes `__AMS_PLUGIN_ROOT__` with the install destDir.
  // Claude's install must NOT be swapped — it keeps the canonical file.
  assert.equal(data.hooksSwap.claudeUntouched, true,
    'Claude install must keep the canonical hooks/hooks.json (no swap)');
  assert.equal(data.hooksSwap.claudeNoPlaceholder, true,
    '__AMS_PLUGIN_ROOT__ must not leak into the Claude install');
  assert.equal(data.hooksSwap.copilotFlavor, true,
    'Copilot install must use hooks/configs/copilot.hooks.json content');
  assert.equal(data.hooksSwap.copilotRootResolved, true,
    'Copilot install must substitute __AMS_PLUGIN_ROOT__ with its destDir');
  assert.equal(data.hooksSwap.copilotNoPlaceholder, true,
    'no __AMS_PLUGIN_ROOT__ placeholders should remain in Copilot hooks.json');
  assert.equal(data.hooksSwap.codexFlavor, true,
    'Codex install must use hooks/configs/codex.hooks.json content');
  assert.equal(data.hooksSwap.codexRootResolved, true,
    'Codex install must substitute __AMS_PLUGIN_ROOT__ with its destDir');
  assert.equal(data.hooksSwap.codexNoPlaceholder, true,
    'no __AMS_PLUGIN_ROOT__ placeholders should remain in Codex hooks.json');
}

test('Operation log captures install/multi-install/error in JSONL with full line capture', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-log-'));
  const data = runFixture('operation-log.mjs', [tempHome], {
    HOME: tempHome,
    USERPROFILE: tempHome,
  });

  assert.equal(data.fileExists, true, '~/.toolkit/log.jsonl should be created');
  assert.equal(data.fileLines, 3, 'three operations -> three JSONL lines');
  assert.equal(data.threw, true, 'errored op should re-throw after logging');

  // All three records present, in order, with captured lines and the
  // expected result + source.
  assert.equal(data.entries.length, 3);

  const [single, multi, errored] = data.entries;

  assert.equal(single.action, 'install');
  assert.equal(single.name, 'happy-skill');
  assert.equal(single.source, 'demo');
  assert.equal(single.result, 'installed');
  assert.equal(single.lineCount, 1);
  assert.equal(single.error, undefined);
  // Provider labels are persisted on the entry so `toolkit logs` can show
  // which AI tools the operation actually targeted (Claude Code, Codex, etc.).
  assert.deepEqual(single.providers, ['Claude Code', 'GitHub Copilot']);

  assert.equal(multi.action, 'install-plugin');
  assert.equal(multi.name, 'demo-plugin');
  // withMultiLogging summarizes counts: "installed:2" for two installed sub-items.
  assert.equal(multi.result, 'installed:2');
  assert.equal(multi.lineCount, 3);
  assert.deepEqual(multi.providers, ['Claude Code', 'Codex', 'GitHub Copilot']);

  assert.equal(errored.action, 'install');
  assert.equal(errored.name, 'broken-skill');
  assert.equal(errored.result, 'errored');
  assert.equal(errored.error, 'disk full');
  // Even on error path, providers (when supplied) should still be on the entry.
  assert.equal(errored.providers, undefined);
});

test('Tool-flavored hooks normalize Windows-style plugin roots for bash commands', () => {
  const data = runFixture('hook-path-normalization.mjs');

  assert.equal(data.applied, true, 'hook flavor template should be applied');
  assert.equal(data.noPlaceholder, true, 'placeholder should be fully substituted');
  assert.equal(data.noBackslashes, true,
    'rendered hooks.json must not contain Windows backslashes in bash command paths');
  assert.equal(data.quotedLauncher, true,
    'rendered hook command should keep quoted launcher and script paths');
});

test('Plugin install (Claude .claude-plugin manifest) decomposes across every detected provider and round-trips on remove', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-plugin-claude-'));
  const data = runFixture('install-remove-plugin.mjs', [tempHome], {
    HOME: tempHome,
    USERPROFILE: tempHome,
    PLUGIN_MANIFEST_KIND: 'claude',
  });
  assertPluginRoundTrip(data);
});

test('Plugin install (generic top-level plugin.json manifest) is discovered, installed, and removed identically', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-plugin-generic-'));
  const data = runFixture('install-remove-plugin.mjs', [tempHome], {
    HOME: tempHome,
    USERPROFILE: tempHome,
    PLUGIN_MANIFEST_KIND: 'generic',
  });
  assertPluginRoundTrip(data);
});

test('Plugin install (Codex .codex-plugin manifest) is discovered, installed, and removed identically', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-plugin-codex-'));
  const data = runFixture('install-remove-plugin.mjs', [tempHome], {
    HOME: tempHome,
    USERPROFILE: tempHome,
    PLUGIN_MANIFEST_KIND: 'codex',
  });
  assertPluginRoundTrip(data);
});

test('Plugin updateAll refreshes stale plugin parent lock hash', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-plugin-update-'));
  const data = runFixture('plugin-update.mjs', [tempHome], {
    HOME: tempHome,
    USERPROFILE: tempHome,
  });

  assert.equal(data.beforeHash, 'plugin-hash-1');
  assert.equal(data.afterHash, 'plugin-hash-2');
  assert.ok(data.installedAt, 'updated plugin lock entry should retain a last-write timestamp');
  assert.ok(data.resultActions.some(r => r.type === 'skill' && r.name === 'hello'));
  assert.deepEqual(data.itemHashes, {}, 'native-only Codex plugin update should not create decomposed sub-item lock entries');
});

test('Manifest path overrides drive recursive discovery for cross-tool plugins (AMS-shaped layout)', async () => {
  const { default: fs } = await import('fs');
  const { default: path } = await import('path');
  const { pathToFileURL } = await import('url');

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-plugin-ams-'));
  const pluginDir = path.join(tempHome, 'src', 'ams-shaped');

  // Build a plugin layout that mirrors AMS:
  //  - manifest declares explicit nested skill roots and a per-tool agent root
  //  - skills are 2-3 levels deep under the declared roots
  //  - agents live under agents/adapters/<tool>/
  //  - commands use *.prompt.md
  fs.mkdirSync(path.join(pluginDir, 'skills', 'universal', 'skill-a'), { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'skills', 'stack', 'backend', 'skill-b'), { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'agents', 'adapters', 'copilot'), { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'commands'), { recursive: true });

  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
    name: 'ams-shaped',
    description: 'A cross-tool plugin with manifest-declared paths',
    skills: ['skills/universal/', 'skills/stack/backend/'],
    agents: 'agents/adapters/copilot/',
  }, null, 2));
  fs.writeFileSync(path.join(pluginDir, 'skills', 'universal', 'skill-a', 'SKILL.md'),
    '---\nname: skill-a\ndescription: a\n---\nA.\n');
  fs.writeFileSync(path.join(pluginDir, 'skills', 'stack', 'backend', 'skill-b', 'SKILL.md'),
    '---\nname: skill-b\ndescription: b\n---\nB.\n');
  fs.writeFileSync(path.join(pluginDir, 'agents', 'adapters', 'copilot', 'analyst.agent.md'),
    '---\nname: analyst\ndescription: analyst\n---\nA.\n');
  fs.writeFileSync(path.join(pluginDir, 'commands', 'plan.prompt.md'),
    '---\ndescription: plan\n---\nplan.\n');

  // Skill files at the conventional `skills/<name>/SKILL.md` layout that the
  // manifest does NOT declare — these should be IGNORED. Authors who declare
  // explicit roots opt out of the default-discovery behavior.
  fs.mkdirSync(path.join(pluginDir, 'skills', 'should-be-ignored'), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'skills', 'should-be-ignored', 'SKILL.md'),
    '---\nname: should-be-ignored\ndescription: x\n---\n');

  const { readPluginContents } = await import(pathToFileURL(
    path.join(process.env.TEST_BUILD_DIR, 'core', 'catalog.js'),
  ).href);
  const contents = readPluginContents(pluginDir);

  const skillNames = contents.skills.map(s => s.name).sort();
  const agentNames = contents.agents.map(a => a.name).sort();
  const commandNames = contents.commands.map(c => c.name).sort();

  // Both nested skills found via the declared roots; the unrelated
  // skills/should-be-ignored/ skill is correctly skipped.
  assert.deepEqual(skillNames, ['skill-a', 'skill-b']);
  assert.deepEqual(agentNames, ['analyst']);
  assert.deepEqual(commandNames, ['plan']);

  fs.rmSync(tempHome, { recursive: true, force: true });
});

test('Plugins already installed by GitHub Copilot CLI: discover via config.json, mirror, and full native uninstall on remove', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-plugin-copilot-installed-'));
  const data = runFixture('copilot-installed-plugins.mjs', [tempHome], {
    HOME: tempHome,
    USERPROFILE: tempHome,
  });

  // Discovery: scanCopilotInstalledPlugins() reads config.json's installedPlugins[]
  // and resolves cache_path relative to ~/.copilot/installed-plugins/.
  assert.equal(data.discovered.length, 1);
  assert.equal(data.discovered[0].name, 'copilot-installed-demo');
  assert.equal(data.discovered[0].source, 'copilot');
  assert.equal(data.discovered[0].description, 'A plugin Copilot CLI already installed');
  assert.equal(data.discovered[0].version, '0.5.0');
  assert.equal(data.discovered[0].path, path.join('demo-marketplace', 'copilot-installed-demo'));

  // Install: mirror into every detected provider, using native plugin
  // registries where available and decomposed copies only for fallbacks.
  const actions = Object.fromEntries(data.installResultActions.map(r => [`${r.type}:${r.name}`, r.action]));
  assert.equal(actions['skill:greet'], 'installed');
  assert.equal(actions['agent:helper'], 'skipped');
  assert.deepEqual(data.pluginLockedItems, ['skill:greet']);
  // Claude detected → registers natively, so ~/.claude/skills/ stays empty
  // and the plugin tree under ~/.claude/plugins/cache/ is the canonical
  // surface. Same logic that excludes Copilot from per-user decompose now
  // also excludes Claude.
  assert.equal(data.filesAfterInstall.skillClaude,  false);
  // Source is Copilot's own plugin cache — decomposing into ~/.copilot/skills/
  // would create a duplicate of the agent already exposed by Copilot's plugin
  // system. Must be skipped.
  assert.equal(data.filesAfterInstall.skillCopilotUser, false);
  assert.equal(data.filesAfterInstall.skillCodex,   false);
  assert.equal(data.filesAfterInstall.skillAmp,     true);
  assert.equal(data.filesAfterInstall.agentClaude,  false);
  assert.equal(data.filesAfterInstall.agentCopilotUser, false);
  assert.equal(data.filesAfterInstall.agentCodex,   false);

  // Native uninstall: removePlugin also cleans Copilot's own state so the
  // plugin disappears from Copilot's UI in one shot.
  assert.equal(data.configHasPluginAfterRemove, false,
    'plugin entry must be dropped from ~/.copilot/config.json installedPlugins[]');
  assert.equal(data.settingsHasPluginAfterRemove, false,
    'plugin must be dropped from ~/.copilot/settings.json enabledPlugins');
  assert.equal(data.unrelatedSettingPreserved, true,
    'unrelated settings keys must be preserved when editing settings.json');
  assert.equal(data.copilotCacheDirGone, true,
    'plugin cache dir must be removed');
  assert.equal(data.marketplaceDirGone, true,
    'empty marketplace parent dir must be cleaned up');
  // Don't auto-remove the installed-plugins root itself — Copilot owns it.
  assert.equal(data.copilotInstalledPluginsRootPreserved, true,
    '~/.copilot/installed-plugins/ root must be preserved');
});

test('Plugins already installed by Codex surface in the catalog and mirror-install across providers', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-plugin-codex-installed-'));
  const data = runFixture('codex-installed-plugins.mjs', [tempHome], {
    HOME: tempHome,
    USERPROFILE: tempHome,
  });

  assert.equal(data.discovered.length, 1);
  assert.equal(data.discovered[0].name, 'codex-installed-demo');
  assert.equal(data.discovered[0].source, 'codex');
  assert.equal(data.discovered[0].description, 'A plugin Codex already installed');
  assert.equal(data.discovered[0].version, '1.2.0');
  assert.equal(data.discovered[0].path, path.join('demo-marketplace', 'codex-installed-demo', '1.2.0'));

  const actions = Object.fromEntries(data.installResultActions.map(r => [`${r.type}:${r.name}`, r.action]));
  assert.equal(actions['skill:greet'], 'installed');
  assert.equal(actions['agent:helper'], 'skipped');
  assert.deepEqual(data.pluginLockedItems, ['skill:greet']);

  assert.equal(data.filesAfterInstall.skillClaudeUser, false);
  assert.equal(data.filesAfterInstall.skillCodexUser, false);
  assert.equal(data.filesAfterInstall.skillCodexSourceCache, true);
  assert.equal(data.filesAfterInstall.skillCodexToolkitCache, true);
  assert.equal(data.filesAfterInstall.skillCopilotUser, false);
  assert.equal(data.filesAfterInstall.skillAmp, true);
  assert.equal(data.filesAfterInstall.agentClaudeUser, false);
  assert.equal(data.filesAfterInstall.agentCodexUser, false);
  assert.equal(data.filesAfterInstall.agentCopilotUser, false);

  assert.equal(data.sourceCachePreservedAfterRemove, true,
    'removePlugin must not delete the original Codex marketplace cache');
  assert.equal(data.sourceConfigPreservedAfterRemove, true,
    'removePlugin must not delete the original Codex marketplace config entry');
  assert.equal(data.toolkitConfigRemovedAfterRemove, true,
    'removePlugin must remove the toolkit-ai Codex plugin config entry');
  assert.equal(data.toolkitCacheRemovedAfterRemove, true,
    'removePlugin must remove the toolkit-ai Codex cache copy');
});

test('Plugins already installed by Claude Code surface in the catalog and mirror across providers', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-plugin-claude-installed-'));
  const data = runFixture('claude-installed-plugins.mjs', [tempHome], {
    HOME: tempHome,
    USERPROFILE: tempHome,
  });

  // Discovery: scanClaudeInstalledPlugins() reads installed_plugins.json
  // and surfaces the plugin under the synthetic `claude` source.
  assert.equal(data.discovered.length, 1);
  assert.equal(data.discovered[0].name, 'demo-plugin');
  assert.equal(data.discovered[0].source, 'claude');
  assert.equal(data.discovered[0].description, 'A plugin Claude Code already installed');
  assert.equal(data.discovered[0].version, '1.2.3');
  // Path is stored relative to ~/.claude/plugins/cache so getSourceRoot resolves it.
  assert.equal(data.discovered[0].path, path.join('official', 'demo-plugin', '1.2.3'));

  // Install: each component lands in every detected provider EXCEPT the ones
  // that already have it via a native plugin registry. Source is Claude's own
  // plugin cache → Claude excluded. Codex/Copilot detected → also excluded
  // because the toolkit registers the plugin natively with them too. Amp has
  // no plugin system, so the components decompose normally.
  const actions = Object.fromEntries(data.installResultActions.map(r => [`${r.type}:${r.name}`, r.action]));
  assert.equal(actions['skill:greet'], 'installed');
  assert.equal(actions['agent:helper'], 'skipped');
  assert.deepEqual(data.pluginLockedItems, ['skill:greet']);
  assert.equal(data.filesAfterInstall.skillClaudeUser,  false, 'skill must NOT land in ~/.claude/skills/ — Claude already exposes it via its plugin cache');
  assert.equal(data.filesAfterInstall.skillCopilotUser, false);
  assert.equal(data.filesAfterInstall.skillCodex,   false);
  assert.equal(data.filesAfterInstall.skillAmp,     true);
  assert.equal(data.filesAfterInstall.agentClaudeUser,  false, 'agent must NOT land in ~/.claude/agents/ — Claude already exposes it via its plugin cache');
  assert.equal(data.filesAfterInstall.agentCopilotUser, false);
  assert.equal(data.filesAfterInstall.agentCodex,   false);

  // Critical safety check: removePlugin must NEVER delete files from
  // Claude Code's own plugin cache or its installed_plugins.json registry.
  // The toolkit only owns the fallback copies and native plugin mirrors it wrote.
  assert.equal(data.claudeCachePreservedAfterRemove, true,
    'toolkit removePlugin must not touch ~/.claude/plugins/cache');
  assert.equal(data.claudeInstalledJsonPreserved, true,
    'toolkit removePlugin must not touch installed_plugins.json');
});
