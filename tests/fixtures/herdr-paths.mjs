import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { relativeHerdrPath, sameHerdrPath } = await import(pathToFileURL(
  path.resolve(process.env.TEST_BUILD_DIR, 'core/herdr-paths.js'),
).href);
const root = String.raw`C:\Users\IdoBar\.toolkit\herdr\herdr-ams`;
const installed = root + String.raw`\install-bzDwyC\herdr-ams`;
const extended = String.raw`\\?\C:\Users\IdoBar\.toolkit\herdr\herdr-ams\install-bzDwyC\herdr-ams`;
assert.equal(sameHerdrPath(installed, extended, 'win32'), true);
assert.equal(sameHerdrPath(extended, installed, 'win32'), true);
assert.equal(sameHerdrPath(installed.replaceAll('\\', '/'), extended, 'win32'), true);
assert.equal(sameHerdrPath(installed.toLowerCase(), extended, 'win32'), true);
assert.equal(relativeHerdrPath(root, extended, 'win32'), String.raw`install-bzDwyC\herdr-ams`);
assert.equal(sameHerdrPath(String.raw`\\server\share\buddy`, String.raw`\\?\UNC\server\share\buddy`, 'win32'), true);
assert.equal(relativeHerdrPath(String.raw`\\server\share`, String.raw`\\?\UNC\server\share\buddy`, 'win32'), 'buddy');
assert.equal(sameHerdrPath(installed, installed.replace('install-bzDwyC', 'install-other'), 'win32'), false);
assert.equal(sameHerdrPath(installed, installed.replace('C:', 'D:'), 'win32'), false);
assert.equal(sameHerdrPath(String.raw`\\server\share\buddy`, String.raw`\\other\share\buddy`, 'win32'), false);
assert.equal(relativeHerdrPath(root, root + String.raw`\..\foreign`, 'win32'), String.raw`..\foreign`);
assert.equal(relativeHerdrPath(root, root + '-foreign', 'win32'), String.raw`..\herdr-ams-foreign`);
assert.equal(sameHerdrPath(undefined, undefined, 'win32'), true);
assert.equal(sameHerdrPath(undefined, installed, 'win32'), false);
assert.equal(sameHerdrPath(installed, undefined, 'win32'), false);
assert.equal(sameHerdrPath('/tmp/Buddy', '/tmp/buddy', 'linux'), false);
assert.equal(sameHerdrPath('/tmp/buddy/.', '/tmp/buddy', 'linux'), true);
console.log(JSON.stringify({ passed: true }));
