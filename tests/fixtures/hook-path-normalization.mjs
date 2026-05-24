import fs from 'fs';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';

const buildDir = process.env.TEST_BUILD_DIR;
const { applyToolFlavoredHooks } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'claude-plugins.js')).href);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-hook-path-'));

// This is a legal POSIX directory name, but it contains Windows-style
// backslashes. The regression target is macOS/Linux CI: path.sep is `/`,
// so `destDir.split(path.sep).join('/')` alone would leave these backslashes
// intact and produce bash-hostile hook commands.
const pluginDir = path.join(tempRoot, 'C:\\Users\\Bar Levi\\AppData\\Local\\toolkit-ai\\radware-ams');
fs.mkdirSync(path.join(pluginDir, 'hooks', 'configs'), { recursive: true });
fs.writeFileSync(path.join(pluginDir, 'hooks', 'configs', 'copilot.hooks.json'), JSON.stringify({
  version: 1,
  root: '__AMS_PLUGIN_ROOT__',
  hooks: {
    sessionStart: [
      {
        type: 'command',
        command: 'bash "__AMS_PLUGIN_ROOT__/hooks/python-launcher.sh" "__AMS_PLUGIN_ROOT__/hooks/scripts/session_start.py"',
      },
    ],
  },
}, null, 2));

const applied = applyToolFlavoredHooks(pluginDir, 'copilot');
const rendered = JSON.parse(fs.readFileSync(path.join(pluginDir, 'hooks', 'hooks.json'), 'utf8'));

process.stdout.write(JSON.stringify({
  applied,
  root: rendered.root,
  command: rendered.hooks.sessionStart[0].command,
  noPlaceholder: !JSON.stringify(rendered).includes('__AMS_PLUGIN_ROOT__'),
  noBackslashes: !rendered.root.includes('\\') &&
    !rendered.hooks.sessionStart[0].command.includes('\\'),
  quotedLauncher: rendered.hooks.sessionStart[0].command.includes('bash "') &&
    rendered.hooks.sessionStart[0].command.includes('/hooks/python-launcher.sh" "'),
}));
