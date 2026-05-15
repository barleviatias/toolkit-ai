import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-disabled-'));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
process.env.PATH = '';

const buildDir = process.env.TEST_BUILD_DIR;

const { updateSettings, loadSettings } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'settings.js')).href);
const {
  detectToolInstallations,
  getWritableSkillTargets,
  getWritableCommandTargets,
  getWritableMcpConfigFiles,
  getDisabledToolIds,
} = await import(pathToFileURL(path.join(buildDir, 'core', 'platform.js')).href);

// Mark Claude and Cursor as installed via indicator dirs/files. Cursor's local
// MCP config also exists so we can verify it gets filtered out when disabled.
fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });
fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
fs.writeFileSync(path.join(tempHome, '.claude', 'settings.json'), '{}');
fs.writeFileSync(path.join(tempHome, '.cursor', 'mcp.json'), '{}');

function snapshot() {
  const detected = detectToolInstallations()
    .filter(t => t.installed)
    .map(t => t.id)
    .sort();
  const skillTargets = getWritableSkillTargets().map(p => p.replace(tempHome, '~')).sort();
  const commandTargets = getWritableCommandTargets().map(t => t.dir.replace(tempHome, '~')).sort();
  const mcpTargets = getWritableMcpConfigFiles().map(p => p.replace(tempHome, '~')).sort();
  return { detected, skillTargets, commandTargets, mcpTargets, disabled: [...getDisabledToolIds()].sort() };
}

const before = snapshot();

// Disable Claude — Cursor should remain.
updateSettings({ disabledTools: ['claude'] });
const afterDisableClaude = snapshot();

// Disable both — nothing should be writable for claude/cursor types.
updateSettings({ disabledTools: ['claude', 'cursor'] });
const afterDisableBoth = snapshot();

// Re-enable everything.
updateSettings({ disabledTools: [] });
const afterReenable = snapshot();

// Persisted shape.
const persisted = loadSettings().disabledTools;

process.stdout.write(JSON.stringify({
  before,
  afterDisableClaude,
  afterDisableBoth,
  afterReenable,
  persisted,
}));

fs.rmSync(tempHome, { recursive: true, force: true });
