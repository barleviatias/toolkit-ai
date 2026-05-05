import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-settings-'));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const buildDir = process.env.TEST_BUILD_DIR;

const {
  DEFAULT_SETTINGS,
  formatDuration,
  loadSettings,
  saveSettings,
  updateSettings,
} = await import(pathToFileURL(path.join(buildDir, 'core', 'settings.js')).href);
const { CACHE_DIR } = await import(pathToFileURL(path.join(buildDir, 'core', 'platform.js')).href);
const { installExternalSkill } = await import(pathToFileURL(path.join(buildDir, 'core', 'installer.js')).href);

fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });

const initial = loadSettings();
const saved = saveSettings({ installMode: 'link', cacheTTL: 3600, sourceConcurrency: 2 });
const clamped = updateSettings({ cacheTTL: -1, sourceConcurrency: 99 });

const skillDir = path.join(CACHE_DIR, 'test-source', 'skills', 'linked-skill');
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: linked-skill
description: Linked skill
---

# Linked Skill
`);

const installResult = installExternalSkill(
  'test-source',
  'linked-skill',
  'skills/linked-skill',
  'hash-linked',
  {},
  () => {},
);
const skillDest = path.join(tempHome, '.claude', 'skills', 'linked-skill');
const linkedInstallIsSymlink = fs.lstatSync(skillDest).isSymbolicLink();

process.stdout.write(JSON.stringify({
  initial,
  saved,
  clamped,
  defaultCacheTTL: DEFAULT_SETTINGS.cacheTTL,
  duration: formatDuration(3600),
  zeroDuration: formatDuration(0),
  installAction: installResult.action,
  linkedInstallIsSymlink,
}));

fs.rmSync(tempHome, { recursive: true, force: true });
