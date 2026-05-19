import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-source-cache-'));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const fakeBin = path.join(tempHome, 'bin');
fs.mkdirSync(fakeBin, { recursive: true });
const fakeGit = path.join(fakeBin, 'git');
fs.writeFileSync(fakeGit, [
  '#!/usr/bin/env node',
  'console.error("simulated offline");',
  'process.exit(1);',
  '',
].join('\n'));
fs.chmodSync(fakeGit, 0o755);
process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH || ''}`;

const buildDir = process.env.TEST_BUILD_DIR;

const { saveSources, fetchExternalResources } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'sources.js')).href);

saveSources({
  cacheTTL: 0,
  sources: [{ name: 'cached-src', type: 'github', repo: 'owner/repo' }],
});

const cacheRoot = path.join(tempHome, '.toolkit', 'cache', 'cached-src');
const skillDir = path.join(cacheRoot, 'skills', 'cached-skill');
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(path.join(cacheRoot, '.fetched'), new Date(0).toISOString());
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: cached-skill
description: Cached skill
---

# Cached Skill
`);

const resources = fetchExternalResources(true);

// Refresh failure must also land in ~/.toolkit/log.jsonl. Without that, the
// TUI badge "! warning" is the only surface for the underlying git/HTTP
// error, which vanishes on the next refresh.
const logFile = path.join(tempHome, '.toolkit', 'log.jsonl');
const logLines = fs.existsSync(logFile)
  ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  : [];
const refreshLog = logLines.find(entry => entry.action === 'refresh-source' && entry.name === 'cached-src');

process.stdout.write(JSON.stringify({
  skillNames: resources.skills.map(skill => skill.name),
  warnings: resources.warnings.map(warning => ({
    name: warning.name,
    usedCache: warning.usedCache,
    hasOfflineMessage: warning.message.includes('simulated offline'),
  })),
  refreshLog: refreshLog
    ? {
      action: refreshLog.action,
      name: refreshLog.name,
      result: refreshLog.result,
      hasOfflineMessage: (refreshLog.error || '').includes('simulated offline'),
      lineHasOfflineMessage: (refreshLog.lines || []).some(line => line.includes('simulated offline')),
    }
    : null,
}));

fs.rmSync(tempHome, { recursive: true, force: true });
