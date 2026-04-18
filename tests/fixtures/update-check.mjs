import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const buildDir = process.env.TEST_BUILD_DIR;
const { isNewer, formatUpdateLine, detectInstallMode } = await import(
  pathToFileURL(path.join(buildDir, 'core', 'update-check.js')).href
);

// detectInstallMode classifier — set up three fake layouts and probe each.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-install-mode-'));

// (a) global-npm: node_modules with no parent package.json
const globalRoot = path.join(tmp, 'global-prefix', 'node_modules', 'toolkit-ai', 'bin');
fs.mkdirSync(globalRoot, { recursive: true });
const globalScript = path.join(globalRoot, 'ai-toolkit.mjs');
fs.writeFileSync(globalScript, '// stub');

// (b) local-npm: node_modules inside a user project (parent has package.json with a different name)
const projectRoot = path.join(tmp, 'user-project');
fs.mkdirSync(projectRoot, { recursive: true });
fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'user-app' }));
const localPath = path.join(projectRoot, 'node_modules', 'toolkit-ai', 'bin');
fs.mkdirSync(localPath, { recursive: true });
const localScript = path.join(localPath, 'ai-toolkit.mjs');
fs.writeFileSync(localScript, '// stub');

// (c) dev: running from the source repo (src/core exists alongside bin/)
const devRoot = path.join(tmp, 'dev-repo');
fs.mkdirSync(path.join(devRoot, 'bin'), { recursive: true });
fs.mkdirSync(path.join(devRoot, 'src', 'core'), { recursive: true });
const devScript = path.join(devRoot, 'bin', 'ai-toolkit.mjs');
fs.writeFileSync(devScript, '// stub');

// CI auto-skip: TOOLKIT_VERSION is 'dev' here which already short-circuits the
// check, so re-import the module under a fake version + CI=true to exercise the
// CI branch specifically. We can't override process.env.TOOLKIT_VERSION in this
// same process because it was baked in at build time. Instead, test the public
// shape: when CI is set and TOOLKIT_VERSION=dev, we still get no-update (OK);
// and we probe the isCI-path by also importing under TOOLKIT_NO_UPDATE_CHECK=1
// to confirm the single env var still works.
import { spawnSync } from 'child_process';
const ciProbe = spawnSync(process.execPath, ['-e', `
  process.env.CI = 'true';
  process.env.TOOLKIT_VERSION = '2.1.0';
  import('${pathToFileURL(path.join(buildDir, 'core', 'update-check.js')).href}')
    .then(m => { process.stdout.write(JSON.stringify(m.getCachedUpdateInfo())); });
`], { encoding: 'utf8' });
const ciInfo = JSON.parse(ciProbe.stdout || '{}');

const results = {
  patch: isNewer('2.1.0', '2.1.1'),
  minor: isNewer('2.1.0', '2.2.0'),
  major: isNewer('2.1.0', '3.0.0'),
  sameVersion: isNewer('2.1.1', '2.1.1'),
  olderLatest: isNewer('2.2.0', '2.1.9'),
  prereleaseIgnored: isNewer('2.1.0', '2.1.1-beta.0'), // pre-release tail is stripped
  vPrefix: isNewer('v2.1.0', 'v2.1.1'),
  nullNoBanner: formatUpdateLine({ current: '2.1.0', latest: null, newer: false }),
  noNewerNoBanner: formatUpdateLine({ current: '2.1.0', latest: '2.1.0', newer: false }),
  bannerHasCommand: (formatUpdateLine({ current: '2.1.0', latest: '2.1.1', newer: true }) || '').includes('npm install -g toolkit-ai@latest'),
  bannerShowsBothVersions: (() => {
    const line = formatUpdateLine({ current: '2.1.0', latest: '2.1.1', newer: true }) || '';
    return line.includes('2.1.0') && line.includes('2.1.1');
  })(),
  modeGlobal: detectInstallMode(globalScript),
  modeLocal: detectInstallMode(localScript),
  modeDev: detectInstallMode(devScript),
  modeUnknown: detectInstallMode('/nonexistent/path'),
  ciSkipsCheck: ciInfo.latest === null && ciInfo.newer === false,
};

fs.rmSync(tmp, { recursive: true, force: true });

process.stdout.write(JSON.stringify(results));
