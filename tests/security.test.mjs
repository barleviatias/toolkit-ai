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

function runFixture(name, args = []) {
  const result = spawnSync(process.execPath, [path.join(FIXTURES_DIR, name), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      TEST_BUILD_DIR: BUILD_DIR,
    },
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Fixture ${name} failed`);
  }

  return JSON.parse(result.stdout);
}

test('Rejects unsafe source and install path segments, and scans MCP headers without command fields', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-security-'));
  const data = runFixture('security-paths.mjs', [tempHome]);

  assert.match(data.parseSourceError, /Unsafe source name/);
  assert.deepEqual(data.parsedBitbucketSsh, {
    name: 'awesome-copilot',
    type: 'bitbucket',
    repo: 'example-org/awesome-copilot',
  });
  assert.deepEqual(data.parsedBitbucketHttps, {
    name: 'awesome-copilot',
    type: 'bitbucket',
    repo: 'example-org/awesome-copilot',
  });
  assert.deepEqual(data.parsedGitHubWithDot, {
    name: 'repo.name',
    type: 'github',
    repo: 'org/repo.name',
  });
  assert.match(data.skillInstallError, /Unsafe skill name/);
  assert.match(data.agentInstallError, /Unsafe agent name/);
  assert.equal(data.scannerBlocked, true);
  assert.ok(data.scannerMessages.some(message => message.includes('curl piped to shell')));
});
