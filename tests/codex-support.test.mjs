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

test('Codex MCP config round-trip is idempotent and preserves supported fields', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-config-'));
  const data = runFixture('codex-config-roundtrip.mjs', [tempDir]);

  assert.equal(data.firstWrite, 'installed');
  assert.equal(data.secondWrite, 'skipped');
  assert.deepEqual(data.parsed, {
    url: 'https://example.test/mcp',
    bearerTokenEnvVar: 'EXAMPLE_TOKEN',
    httpHeaders: { 'X-Region': 'eu-west-1' },
    envHttpHeaders: { Authorization: 'EXAMPLE_AUTH' },
    startupTimeoutSec: 20,
    toolTimeoutSec: 45,
    enabled: true,
    required: false,
    enabledTools: ['open', 'search'],
    disabledTools: ['delete'],
  });
  assert.equal(data.removed, true);
  assert.equal(data.afterRemove, null);
});

test('Install, recovery, idempotency, and removal work for Codex plus legacy targets', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-home-'));
  const data = runFixture('install-remove-recover.mjs', [tempHome], {
    HOME: tempHome,
    USERPROFILE: tempHome,
  });

  assert.equal(data.installResults.skill, 'installed');
  assert.equal(data.installResults.agent, 'installed');
  assert.equal(data.installResults.mcp, 'installed');
  assert.equal(data.secondMcpInstall, 'skipped');

  assert.equal(data.files.skillInstalled, true);
  assert.equal(data.files.agentInstalledClaude, true);
  assert.equal(data.files.agentInstalledCopilot, true);
  assert.equal(data.files.agentInstalledCodex, true);
  assert.match(data.files.codexAgentContent, /developer_instructions = """/);

  assert.equal(data.mcpTargets.claudeHasCommand, true);
  assert.equal(data.mcpTargets.cursorHasCommand, true);
  assert.equal(data.mcpTargets.vscodeHasCommand, true);
  assert.equal(data.mcpTargets.globalClaudeHasCommand, true);
  assert.equal(data.mcpTargets.claudeHasCodexOnlyFields, false);
  assert.equal(data.mcpTargets.cursorHasCodexOnlyFields, false);
  assert.equal(data.mcpTargets.vscodeHasCodexOnlyFields, false);
  assert.deepEqual(data.mcpTargets.codexParsed, {
    command: 'npx',
    args: ['-y', '@example/mcp'],
    env: { API_KEY: 'secret' },
    envVars: ['PATH'],
    cwd: 'C:/repo',
    startupTimeoutSec: 12,
    toolTimeoutSec: 34,
    enabled: true,
    required: true,
    enabledTools: ['open'],
    disabledTools: ['delete'],
  });

  assert.deepEqual(
    [...data.recoveredKeys].sort(),
    ['agent:example-agent', 'mcp:example-mcp', 'skill:example-skill'],
  );

  assert.equal(data.afterRemove.skillInstalled, false);
  assert.equal(data.afterRemove.agentInstalledClaude, false);
  assert.equal(data.afterRemove.agentInstalledCopilot, false);
  assert.equal(data.afterRemove.agentInstalledCodex, false);
  assert.equal(data.afterRemove.codexMcpPresent, false);
  assert.equal(data.afterRemove.claudeMcpPresent, false);
  assert.equal(data.afterRemove.cursorMcpPresent, false);
  assert.equal(data.afterRemove.vscodeMcpPresent, false);
  assert.equal(data.afterRemove.globalClaudeMcpPresent, false);
});
