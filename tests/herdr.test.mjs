import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';

test('HerdR install, dependency updates, failures, ownership and removal', {skip:process.platform==='win32'}, () => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-herdr-test-'));
  try {
    const result=spawnSync(process.execPath,['tests/fixtures/herdr-plugin.mjs',home],{encoding:'utf8',env:process.env});
    assert.equal(result.status,0,result.stderr||result.stdout);
    assert.equal(JSON.parse(result.stdout).passed,true);
  } finally { fs.rmSync(home,{recursive:true,force:true}); }
});
