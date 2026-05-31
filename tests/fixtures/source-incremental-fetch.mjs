import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

// Fake home + fake `git` on PATH. The fake git creates a `.git` dir on clone so
// that a subsequent refresh sees an existing clone and takes the incremental
// path; fetch/reset are logged no-ops (the working tree is already populated).
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-incremental-'));
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
  'const args = process.argv.slice(2);',
  'fs.appendFileSync(logFile, JSON.stringify({ args }) + "\\n");',
  'if (args.includes("clone")) {',
  '  const dest = args[args.length - 1];',
  '  fs.mkdirSync(path.join(dest, ".git"), { recursive: true });',
  '  fs.mkdirSync(path.join(dest, "skills", "dedupe-skill"), { recursive: true });',
  '  fs.writeFileSync(path.join(dest, "skills", "dedupe-skill", "SKILL.md"), "---\\nname: dedupe-skill\\ndescription: Dedupe skill\\n---\\n");',
  '  process.exit(0);',
  '}',
  '// fetch / reset: no-op success (clone already populated the working tree)',
  'process.exit(0);',
  '',
].join('\n'));
fs.chmodSync(fakeGit, 0o755);
process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH || ''}`;
process.env.FAKE_GIT_LOG = logFile;

const buildDir = process.env.TEST_BUILD_DIR;
const { saveSources, fetchAndScanSource } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'sources.js')).href);

const source = { name: 'incremental-src', type: 'github', repo: 'owner/repo', protocol: 'https' };
saveSources({ cacheTTL: 0, sources: [source] });

const subcommand = a => (a[0] === '-C' ? a[2] : a[0]);

// First refresh: no clone yet → full clone (fake git lays down `.git`).
const first = await fetchAndScanSource(source, 0, true);
const firstCalls = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).args);

// Second refresh: clone exists → incremental fetch + reset, no re-clone.
fs.writeFileSync(logFile, '');
const second = await fetchAndScanSource(source, 0, true);
const secondCalls = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).args);

process.stdout.write(JSON.stringify({
  firstSubcommands: firstCalls.map(subcommand),
  secondSubcommands: secondCalls.map(subcommand),
  firstSkillNames: first.skills.map(skill => skill.name),
  secondSkillNames: second.skills.map(skill => skill.name),
}));

fs.rmSync(tempHome, { recursive: true, force: true });
