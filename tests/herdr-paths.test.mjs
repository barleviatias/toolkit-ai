import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const [fixture, title] of [
  ['herdr-paths', 'HerdR compares Windows drive and UNC namespaces without accepting foreign paths'],
  ['herdr-registration', 'HerdR equivalent registrations survive install, update, rollback and removal'],
]) {
  test(title, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-herdr-paths-'));
    try {
      const result = spawnSync(process.execPath, [`tests/fixtures/${fixture}.mjs`, home], {
        encoding: 'utf8', env: process.env,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(JSON.parse(result.stdout).passed, true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
}
