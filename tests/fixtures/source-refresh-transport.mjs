import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-source-transport-'));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const fakeBin = path.join(tempHome, 'bin');
fs.mkdirSync(fakeBin, { recursive: true });
const fakeGit = path.join(fakeBin, process.platform === 'win32' ? 'git.cmd' : 'git');
const logFile = path.join(tempHome, 'git-log.jsonl');
fs.writeFileSync(fakeGit, [
  '#!/usr/bin/env node',
  'const fs = require("fs");',
  'const path = require("path");',
  'const logFile = process.env.FAKE_GIT_LOG;',
  'const mode = process.env.FAKE_GIT_MODE;',
  'fs.appendFileSync(logFile, JSON.stringify({ args: process.argv.slice(2) }) + "\\n");',
  'const dest = process.argv[process.argv.length - 1];',
  'if (mode === "success") {',
  '  setTimeout(() => {',
  '    fs.mkdirSync(path.join(dest, "skills", "dedupe-skill"), { recursive: true });',
  '    fs.writeFileSync(path.join(dest, "skills", "dedupe-skill", "SKILL.md"), "---\\nname: dedupe-skill\\ndescription: Dedupe skill\\n---\\n");',
  '    process.exit(0);',
  '  }, 100);',
  '} else {',
  '  console.error("simulated transport failure");',
  '  process.exit(1);',
  '}',
  '',
].join('\n'));
fs.chmodSync(fakeGit, 0o755);
process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH || ''}`;
process.env.FAKE_GIT_LOG = logFile;

const buildDir = process.env.TEST_BUILD_DIR;
const { saveSources, fetchExternalResources, fetchAndScanSource } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'sources.js')).href);

saveSources({
  cacheTTL: 0,
  sources: [{ name: 'https-only', type: 'github', repo: 'owner/repo', protocol: 'https' }],
});

process.env.FAKE_GIT_MODE = 'fail';
const failed = fetchExternalResources(true);
const httpsOnlyCalls = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));

fs.writeFileSync(logFile, '');
process.env.FAKE_GIT_MODE = 'success';
const source = { name: 'dedupe-src', type: 'github', repo: 'owner/repo', protocol: 'https' };
const [first, second] = await Promise.all([
  fetchAndScanSource(source, 0, true),
  fetchAndScanSource(source, 0, true),
]);
const dedupeCalls = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));

process.stdout.write(JSON.stringify({
  preferredHttpsCallCount: httpsOnlyCalls.length,
  preferredHttpsUrls: httpsOnlyCalls.map(call => call.args[call.args.length - 2]),
  httpsOnlyWarning: failed.warnings[0]?.message || '',
  dedupeCallCount: dedupeCalls.length,
  firstSkillNames: first.skills.map(skill => skill.name),
  secondSkillNames: second.skills.map(skill => skill.name),
}));

fs.rmSync(tempHome, { recursive: true, force: true });
