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
    env: {
      ...process.env,
      TEST_BUILD_DIR: BUILD_DIR,
      ...extraEnv,
    },
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Fixture ${name} failed`);
  }

  return JSON.parse(result.stdout);
}

test('Command install writes verbatim to Claude/Cursor and a transformed prompt to VS Code', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-command-home-'));
  const data = runFixture('install-remove-command.mjs', [tempHome], {
    HOME: tempHome,
    USERPROFILE: tempHome,
  });

  assert.equal(data.installResults.first, 'installed');
  assert.equal(data.installResults.second, 'skipped');
  assert.equal(data.installResults.forced, 'updated');

  assert.equal(data.installed.claudeExists, true);
  assert.equal(data.installed.cursorExists, true);
  assert.equal(data.installed.vscodeExists, true);

  assert.equal(data.claudeIsVerbatim, true);
  assert.equal(data.cursorIsVerbatim, true);

  assert.equal(data.vscodeFrontmatterMode, true);
  assert.equal(data.vscodeDescriptionJsonStringified, true);
  assert.equal(data.vscodeNoPhaseField, true);
  assert.equal(data.vscodeBodyHasInputVariable, true);
  assert.equal(data.vscodeBodyHasNoArgumentsLiteral, true);

  assert.deepEqual([...data.recoveredKeys].sort(), ['command:demo']);

  assert.equal(data.afterRemove.claudeExists, false);
  assert.equal(data.afterRemove.cursorExists, false);
  assert.equal(data.afterRemove.vscodeExists, false);
});
