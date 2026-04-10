import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const buildDir = process.env.TEST_BUILD_DIR;

const { parseFrontmatter, hashFile, hashDir, findSkill, findAgent, findMcp, findBundle } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'catalog.js')).href);

const results = {};
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-catalog-test-'));

try {
  // --- parseFrontmatter: basic key-value ---
  const basicFm = parseFrontmatter(`---
name: my-skill
description: A cool skill
---

# Content`);
  results.fmName = basicFm.name;
  results.fmDescription = basicFm.description;

  // --- parseFrontmatter: multiline values (| and >) ---
  const multilineFm = parseFrontmatter(`---
name: multi
summary: >
  This is a long
  description that spans
details: |
  Line one
  Line two
---

# Body`);
  results.fmSummary = multilineFm.summary;
  results.fmDetails = multilineFm.details;

  // --- parseFrontmatter: no frontmatter ---
  const noFm = parseFrontmatter('# Just a heading\nSome text');
  results.fmEmpty = Object.keys(noFm).length === 0;

  // --- hashFile: consistent hash ---
  const testFilePath = path.join(tempDir, 'hashtest.txt');
  fs.writeFileSync(testFilePath, 'hello world');
  const hash1 = hashFile(testFilePath);
  const hash2 = hashFile(testFilePath);
  results.hashFileConsistent = hash1 === hash2;
  results.hashFileLength = hash1.length; // md5 hex = 32 chars

  // --- hashDir: consistent and order-independent ---
  const dirA = path.join(tempDir, 'dir-a');
  fs.mkdirSync(dirA, { recursive: true });
  fs.writeFileSync(path.join(dirA, 'b.txt'), 'beta');
  fs.writeFileSync(path.join(dirA, 'a.txt'), 'alpha');

  const dirB = path.join(tempDir, 'dir-b');
  fs.mkdirSync(dirB, { recursive: true });
  // Write in opposite order
  fs.writeFileSync(path.join(dirB, 'a.txt'), 'alpha');
  fs.writeFileSync(path.join(dirB, 'b.txt'), 'beta');

  const dirHash1 = hashDir(dirA);
  const dirHash2 = hashDir(dirB);
  results.hashDirConsistent = dirHash1 === dirHash2;
  results.hashDirLength = dirHash1.length;

  // --- find* helpers ---
  const catalog = {
    skills: [{ name: 'sk1', description: 'd', hash: 'h', path: 'p', source: 's' }],
    agents: [{ name: 'ag1', description: 'd', hash: 'h', path: 'p', source: 's' }],
    mcps: [{ name: 'mc1', description: 'd', hash: 'h', path: 'p', source: 's' }],
    bundles: [{ name: 'bu1', description: 'd', hash: 'h', path: 'p', source: 's' }],
  };
  results.findSkillFound = findSkill(catalog, 'sk1')?.name === 'sk1';
  results.findSkillMissing = findSkill(catalog, 'nope') === undefined;
  results.findAgentFound = findAgent(catalog, 'ag1')?.name === 'ag1';
  results.findMcpFound = findMcp(catalog, 'mc1')?.name === 'mc1';
  results.findBundleFound = findBundle(catalog, 'bu1')?.name === 'bu1';
} catch (err) {
  results.error = err instanceof Error ? err.message : String(err);
}

// Cleanup
fs.rmSync(tempDir, { recursive: true, force: true });

process.stdout.write(JSON.stringify(results));
