import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = path.join(ROOT, '.test-dist');
const TEST_DIR = path.join(ROOT, 'tests');

function cleanup() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}

process.on('exit', cleanup);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

const compile = spawnSync('npx', ['tsc', '--outDir', BUILD_DIR], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

const testFiles = fs.readdirSync(TEST_DIR)
  .filter(name => name.endsWith('.test.mjs'))
  .map(name => path.join(TEST_DIR, name));

const run = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    TEST_BUILD_DIR: BUILD_DIR,
  },
});

cleanup();
process.exit(run.status ?? 1);
