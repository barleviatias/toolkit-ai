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

// ===========================================================================
// item-key tests
// ===========================================================================

test('makeKey produces type::source::name format', () => {
  const data = runFixture('item-key.mjs');
  assert.equal(data.makeKeyBasic, 'skill::source::name');
});

test('parseKey splits :: delimited keys correctly', () => {
  const data = runFixture('item-key.mjs');
  assert.deepEqual(data.parseKeyNew, { type: 'skill', source: 'source', name: 'name' });
});

test('parseKey handles legacy single-colon keys with fallback source', () => {
  const data = runFixture('item-key.mjs');
  assert.deepEqual(data.parseKeyLegacy, { type: 'skill', source: 'legacy', name: 'name' });
});

// ===========================================================================
// lock-ops tests
// ===========================================================================

test('recordInstall adds a direct install entry with correct hash', () => {
  const data = runFixture('lock-ops.mjs');
  assert.equal(data.directInstallHasEntry, true);
  assert.equal(data.directInstallHash, 'abc123');
});

test('recordInstall with bundleName creates nested bundle entry', () => {
  const data = runFixture('lock-ops.mjs');
  assert.equal(data.bundleKeyCreated, true);
  assert.equal(data.bundleItemHash, 'def456');
});

test('isItemProtected returns true when item is in another bundle', () => {
  const data = runFixture('lock-ops.mjs');
  assert.equal(data.protectedInOtherBundle, true);
});

test('isItemProtected returns false when item is only in the excluded bundle', () => {
  const data = runFixture('lock-ops.mjs');
  assert.equal(data.notProtectedExcluded, false);
});

test('writeLock and readLock round-trip preserves data', () => {
  const data = runFixture('lock-ops.mjs');
  assert.equal(data.roundTripHash, 'xyz');
  assert.equal(data.hasLastUpdated, true);
});

// ===========================================================================
// catalog-helpers tests
// ===========================================================================

test('parseFrontmatter extracts key-value pairs from YAML block', () => {
  const data = runFixture('catalog-helpers.mjs');
  assert.equal(data.fmName, 'my-skill');
  assert.equal(data.fmDescription, 'A cool skill');
});

test('parseFrontmatter handles multiline values (| and >)', () => {
  const data = runFixture('catalog-helpers.mjs');
  assert.equal(data.fmSummary, 'This is a long description that spans');
  assert.equal(data.fmDetails, 'Line one Line two');
});

test('parseFrontmatter returns {} for content with no frontmatter', () => {
  const data = runFixture('catalog-helpers.mjs');
  assert.equal(data.fmEmpty, true);
});

test('hashFile returns consistent hash for same content', () => {
  const data = runFixture('catalog-helpers.mjs');
  assert.equal(data.hashFileConsistent, true);
  assert.equal(data.hashFileLength, 32);
});

test('hashDir returns consistent hash and is order-independent', () => {
  const data = runFixture('catalog-helpers.mjs');
  assert.equal(data.hashDirConsistent, true);
  assert.equal(data.hashDirLength, 32);
});

test('findSkill, findAgent, findMcp, findBundle return correct entries', () => {
  const data = runFixture('catalog-helpers.mjs');
  assert.equal(data.findSkillFound, true);
  assert.equal(data.findSkillMissing, true);
  assert.equal(data.findAgentFound, true);
  assert.equal(data.findMcpFound, true);
  assert.equal(data.findBundleFound, true);
});

// ===========================================================================
// fs-helpers-ops tests
// ===========================================================================

test('ensureDir creates nested directories', () => {
  const data = runFixture('fs-helpers-ops.mjs');
  assert.equal(data.ensureDirCreated, true);
});

test('copyDirRecursive copies files and subdirs', () => {
  const data = runFixture('fs-helpers-ops.mjs');
  assert.equal(data.copyRootFile, 'root content');
  assert.equal(data.copyNestedFile, 'nested content');
});

test('linkOrCopyFile installs a file, returns exists on second call without force', () => {
  const data = runFixture('fs-helpers-ops.mjs');
  assert.equal(data.linkFirstInstall, 'installed');
  assert.equal(data.linkFileExists, true);
  assert.equal(data.linkFileContent, 'file content');
  assert.equal(data.linkSecondExists, 'exists');
});

test('linkOrCopyFile returns updated with force=true', () => {
  const data = runFixture('fs-helpers-ops.mjs');
  assert.equal(data.linkForceUpdated, 'updated');
  assert.equal(data.linkForceContent, 'updated content');
});

test('removeLink removes a file and returns true, returns false for non-existent', () => {
  const data = runFixture('fs-helpers-ops.mjs');
  assert.equal(data.removeLinkTrue, true);
  assert.equal(data.removeLinkGone, true);
  assert.equal(data.removeLinkFalse, false);
});

// ===========================================================================
// scanner-patterns tests
// ===========================================================================

test('scanSkillDir blocks skills with curl|bash pattern', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.curlBlocked, true);
  assert.equal(data.curlHasCurlMessage, true);
});

test('scanSkillDir blocks reverse shell patterns', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.revShellBlocked, true);
  assert.equal(data.revShellHasMessage, true);
});

test('scanSkillDir warns on files exceeding 500KB size limit', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.largeFileWarned, true);
});

test('scanAgentFile blocks agent with suspicious patterns', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.agentBlocked, true);
  assert.equal(data.agentHasWgetMessage, true);
});

test('scanMcpConfig blocks private IP addresses', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.privateIpBlocked, true);
  assert.equal(data.privateIpMessage, true);
});

test('scanMcpConfig blocks file:// URLs', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.fileUrlBlocked, true);
  assert.equal(data.fileUrlMessage, true);
});

test('scanMcpConfig warns on HTTP (non-HTTPS) URLs but still passes', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.httpWarned, true);
  assert.equal(data.httpStillPasses, true);
});

test('formatReport returns [OK] for clean report', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.formatCleanContainsOK, true);
});

test('formatReport returns [BLOCKED] for failed report', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.formatBlockedContainsBLOCKED, true);
});

test('scanMcpConfig emits mcp-stdio-exec warn when command is set, with command preview', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.stdioExecWarned, true);
  assert.equal(data.stdioExecShowsCommand, true);
  assert.equal(data.stdioStillPasses, true, 'stdio warn alone should not block at scanner — install gates consent');
});

test('scanSkillDir blocks interpreter-pipe variants (python, ruby, node, perl)', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.curlPythonBlocked, true);
  assert.equal(data.curlRubyBlocked, true);
  assert.equal(data.curlNodeBlocked, true);
  assert.equal(data.wgetPerlBlocked, true);
});

test('scanSkillDir blocks reverse-shell variants (/dev/udp, ncat, socat)', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.devUdpBlocked, true);
  assert.equal(data.ncatBlocked, true);
  assert.equal(data.socatBlocked, true);
});

test('scanSkillDir blocks inline interpreter execution (python -c, node -e, perl -e)', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.pythonDashCBlocked, true);
  assert.equal(data.nodeDashEBlocked, true);
  assert.equal(data.perlDashEBlocked, true);
});

test('scanSkillDir blocks base64-decoded shell execution', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.base64ShellBlocked, true);
});

test('scanSkillDir scans .sh and .py files (not just markdown/text)', () => {
  const data = runFixture('scanner-patterns.mjs');
  assert.equal(data.shellScriptScanned, true, '.sh files must be scanned for RCE patterns');
  assert.equal(data.pythonScriptScanned, true, '.py files must be scanned for RCE patterns');
});

test('install is lenient by default (scanner findings warn, install proceeds) and blocks only with --strict', () => {
  const data = runFixture('install-strict-mode.mjs');
  assert.equal(data.lenient, 'installed', 'default install must proceed — running the command is consent');
  assert.equal(data.strict, 'blocked', 'strict mode must hard-fail on block-severity findings');
});
