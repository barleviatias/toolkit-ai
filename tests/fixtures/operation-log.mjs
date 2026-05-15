import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const [, , tempHome] = process.argv;
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const buildDir = process.env.TEST_BUILD_DIR;

const { withLogging, withMultiLogging, readRecentLog } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'logger.js')).href);

// Three operations: a successful single, a multi-result, and a thrown error.
withLogging({ action: 'install', type: 'skill', name: 'happy-skill', source: 'demo', providers: ['Claude Code', 'GitHub Copilot'] }, log => {
  log('  [+] skill happy-skill -> /fake/dest');
  return { type: 'skill', name: 'happy-skill', action: 'installed' };
});

withMultiLogging({ action: 'install-plugin', type: 'plugin', name: 'demo-plugin', source: 'demo', providers: ['Claude Code', 'Codex', 'GitHub Copilot'] }, log => {
  log('Installing plugin: demo-plugin');
  log('  [+] skill foo -> /a');
  log('  [+] agent bar -> /b');
  return [
    { type: 'skill', name: 'foo', action: 'installed' },
    { type: 'agent', name: 'bar', action: 'installed' },
  ];
});

let threw = false;
try {
  withLogging({ action: 'install', type: 'skill', name: 'broken-skill' }, () => {
    throw new Error('disk full');
  });
} catch { threw = true; }

const entries = readRecentLog(10);
const file = path.join(tempHome, '.toolkit', 'log.jsonl');
const fileExists = fs.existsSync(file);
const fileLines = fileExists ? fs.readFileSync(file, 'utf8').trim().split('\n').length : 0;

process.stdout.write(JSON.stringify({
  fileExists,
  fileLines,
  threw,
  entries: entries.map(e => ({
    action: e.action,
    type: e.type,
    name: e.name,
    source: e.source,
    providers: e.providers,
    result: e.result,
    lineCount: e.lines.length,
    error: e.error,
  })),
}));
