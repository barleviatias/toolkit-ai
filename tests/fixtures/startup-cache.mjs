import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-startup-cache-'));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const buildDir = process.env.TEST_BUILD_DIR;
const { loadStartupCache, saveStartupCache } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'startup-cache.js')).href);

// Missing file → empty maps.
const empty = loadStartupCache();
const emptyOk = empty.scan.size === 0 && empty.plugins.size === 0;

// Save then reload round-trips, including a null plugin entry (unreadable source).
const scan = new Map([
  ['skill:src:h1', { scanStatus: 'warn', scanSummary: '1 issue' }],
  ['agent:src:h2', { scanStatus: 'ok' }],
]);
const plugins = new Map([
  ['src:hp', { skills: ['a', 'b'], agents: ['c'], commands: [], mcps: 2, hasHooks: true }],
  ['claude:hx', null],
]);
saveStartupCache(scan, plugins);
const loaded = loadStartupCache();
const roundTrip =
  loaded.scan.size === 2 &&
  loaded.scan.get('skill:src:h1').scanStatus === 'warn' &&
  loaded.plugins.size === 2 &&
  loaded.plugins.get('src:hp').skills.length === 2 &&
  loaded.plugins.get('claude:hx') === null;

// Version mismatch → empty (forces a re-scan rather than trusting an old format).
const cacheFile = path.join(tempHome, '.toolkit', 'scan-cache.json');
fs.writeFileSync(cacheFile, JSON.stringify({ version: 999, scan: { x: { scanStatus: 'ok' } }, plugins: {} }));
const mismatchOk = loadStartupCache().scan.size === 0;

// Corrupt JSON → empty (best-effort; never throws).
fs.writeFileSync(cacheFile, 'not json{');
const corrupt = loadStartupCache();
const corruptOk = corrupt.scan.size === 0 && corrupt.plugins.size === 0;

process.stdout.write(JSON.stringify({ emptyOk, roundTrip, mismatchOk, corruptOk }));

fs.rmSync(tempHome, { recursive: true, force: true });
