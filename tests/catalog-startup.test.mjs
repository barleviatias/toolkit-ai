import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('cached catalog paints first and stays responsive while source scans run off-thread', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-catalog-startup-'));
  try {
    const result = spawnSync(process.execPath, ['--import', path.resolve('tests/fixtures/catalog-slow-disk.mjs'), 'tests/fixtures/catalog-startup.mjs', tempHome], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome, TOOLKIT_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).passed, true);
  } finally { fs.rmSync(tempHome, { recursive: true, force: true }); }
});
