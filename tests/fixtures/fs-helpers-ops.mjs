import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const buildDir = process.env.TEST_BUILD_DIR;

const { ensureDir, copyDirRecursive, linkOrCopyFile, removeLink } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'fs-helpers.js')).href);

const results = {};
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-fs-test-'));

try {
  // --- ensureDir: creates nested directories ---
  const nestedDir = path.join(tempDir, 'a', 'b', 'c');
  ensureDir(nestedDir);
  results.ensureDirCreated = fs.existsSync(nestedDir) && fs.statSync(nestedDir).isDirectory();

  // --- copyDirRecursive: copies files and subdirs ---
  const srcDir = path.join(tempDir, 'copy-src');
  const destDir = path.join(tempDir, 'copy-dest');
  fs.mkdirSync(path.join(srcDir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'root.txt'), 'root content');
  fs.writeFileSync(path.join(srcDir, 'sub', 'nested.txt'), 'nested content');

  copyDirRecursive(srcDir, destDir);
  results.copyRootFile = fs.readFileSync(path.join(destDir, 'root.txt'), 'utf8');
  results.copyNestedFile = fs.readFileSync(path.join(destDir, 'sub', 'nested.txt'), 'utf8');

  // --- linkOrCopyFile: installs a file ---
  const srcFile = path.join(tempDir, 'source.txt');
  const destFile = path.join(tempDir, 'installed', 'dest.txt');
  fs.writeFileSync(srcFile, 'file content');

  const firstResult = linkOrCopyFile(srcFile, destFile, false, true);
  results.linkFirstInstall = firstResult;
  results.linkFileExists = fs.existsSync(destFile);
  results.linkFileContent = fs.readFileSync(destFile, 'utf8');

  // --- linkOrCopyFile: returns 'exists' on second call without force ---
  const secondResult = linkOrCopyFile(srcFile, destFile, false, true);
  results.linkSecondExists = secondResult;

  // --- linkOrCopyFile: returns 'updated' with force=true ---
  fs.writeFileSync(srcFile, 'updated content');
  const forceResult = linkOrCopyFile(srcFile, destFile, true, true);
  results.linkForceUpdated = forceResult;
  results.linkForceContent = fs.readFileSync(destFile, 'utf8');

  // --- removeLink: removes a file and returns true ---
  const removeTarget = path.join(tempDir, 'to-remove.txt');
  fs.writeFileSync(removeTarget, 'bye');
  const removeResult = removeLink(removeTarget);
  results.removeLinkTrue = removeResult;
  results.removeLinkGone = !fs.existsSync(removeTarget);

  // --- removeLink: returns false for non-existent ---
  const removeNonExistent = removeLink(path.join(tempDir, 'does-not-exist.txt'));
  results.removeLinkFalse = removeNonExistent;
} catch (err) {
  results.error = err instanceof Error ? err.message : String(err);
}

// Cleanup
fs.rmSync(tempDir, { recursive: true, force: true });

process.stdout.write(JSON.stringify(results));
