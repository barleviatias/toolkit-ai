import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const [, , tempHome] = process.argv;
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const buildDir = process.env.TEST_BUILD_DIR;

const { installExternalCommand } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'installer.js')).href);
const { removeCommand } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'remover.js')).href);
const { getInstalledState } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'installed-state.js')).href);
const noop = () => {};

const sourceName = 'testsrc';
const cacheRoot = path.join(tempHome, '.toolkit', 'cache', sourceName, 'commands');
const commandFile = path.join(cacheRoot, 'demo.prompt.md');

fs.mkdirSync(cacheRoot, { recursive: true });

// Description has a colon and quote that must survive the VS Code transform.
fs.writeFileSync(commandFile, `---
name: demo
description: "Run the demo: a quick sanity check"
argument-hint: "<topic | empty>"
phase: analysis
persona: analyst
---

You are the Analyst.

Topic: $ARGUMENTS
`);

// Mark Claude, Cursor, and VS Code (Code flavor) as installed by creating their
// indicator dirs/files. Without these, the installer skips writes for that tool.
fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });
fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
fs.mkdirSync(path.join(tempHome, '.vscode'), { recursive: true });

// Pre-create the VS Code prompts dir so the platform helper has a place to
// write. ensureDir() inside writeCommandToTarget would also create it, but
// we keep the test deterministic across platforms by setting up Darwin's path
// explicitly when running on Darwin.
const vscodePromptDirs = (() => {
  const flavors = ['Code', 'Code - Insiders'];
  const bases = [];
  if (process.platform === 'darwin') bases.push(path.join(tempHome, 'Library', 'Application Support'));
  else if (process.platform === 'win32') bases.push(process.env.APPDATA || path.join(tempHome, 'AppData', 'Roaming'));
  else bases.push(path.join(tempHome, '.config'));
  return bases.flatMap(base => flavors.map(f => path.join(base, f, 'User', 'prompts')));
})();

const catalog = {
  skills: [],
  agents: [],
  mcps: [],
  bundles: [],
  commands: [{
    name: 'demo',
    description: 'Run the demo: a quick sanity check',
    hash: 'cmd-hash-1',
    path: 'commands/demo.prompt.md',
    source: sourceName,
  }],
};

// Install once, then re-install (idempotent), then force-update with a new hash.
const firstInstall = installExternalCommand(sourceName, 'demo', 'commands/demo.prompt.md', 'cmd-hash-1', { link: false }, noop).action;
const secondInstall = installExternalCommand(sourceName, 'demo', 'commands/demo.prompt.md', 'cmd-hash-1', { link: false }, noop).action;
const forcedInstall = installExternalCommand(sourceName, 'demo', 'commands/demo.prompt.md', 'cmd-hash-2', { link: false }, noop).action;

const claudeDest = path.join(tempHome, '.claude', 'commands', 'demo.md');
const cursorDest = path.join(tempHome, '.cursor', 'commands', 'demo.md');
const vscodeDest = path.join(vscodePromptDirs[0], 'demo.prompt.md');

const claudeContent = fs.existsSync(claudeDest) ? fs.readFileSync(claudeDest, 'utf8') : null;
const cursorContent = fs.existsSync(cursorDest) ? fs.readFileSync(cursorDest, 'utf8') : null;
const vscodeContent = fs.existsSync(vscodeDest) ? fs.readFileSync(vscodeDest, 'utf8') : null;

const recoveredKeys = [...getInstalledState(catalog, { installed: {} }).recoveredKeys];

const result = {
  installResults: {
    first: firstInstall,
    second: secondInstall,
    forced: forcedInstall,
  },
  installed: {
    claudeExists: fs.existsSync(claudeDest),
    cursorExists: fs.existsSync(cursorDest),
    vscodeExists: fs.existsSync(vscodeDest),
  },
  // Verbatim destinations preserve the original frontmatter and body byte-for-byte.
  claudeIsVerbatim: claudeContent && claudeContent.includes('phase: analysis') && claudeContent.includes('$ARGUMENTS'),
  cursorIsVerbatim: cursorContent && cursorContent.includes('phase: analysis') && cursorContent.includes('$ARGUMENTS'),
  // VS Code prompt: frontmatter trimmed to mode/description, body uses input variable.
  vscodeFrontmatterMode: vscodeContent && /^---\nmode: agent\n/.test(vscodeContent),
  vscodeDescriptionJsonStringified: vscodeContent && vscodeContent.includes('description: "Run the demo: a quick sanity check"'),
  vscodeNoPhaseField: vscodeContent && !vscodeContent.includes('phase: analysis'),
  vscodeBodyHasInputVariable: vscodeContent && vscodeContent.includes('${input:topic:<topic | empty>}'),
  vscodeBodyHasNoArgumentsLiteral: vscodeContent && !vscodeContent.includes('$ARGUMENTS'),
  recoveredKeys,
};

removeCommand(catalog, 'demo', noop);

result.afterRemove = {
  claudeExists: fs.existsSync(claudeDest),
  cursorExists: fs.existsSync(cursorDest),
  vscodeExists: fs.existsSync(vscodeDest),
};

process.stdout.write(JSON.stringify(result));
