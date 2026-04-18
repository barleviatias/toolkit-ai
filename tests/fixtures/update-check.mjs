import path from 'path';
import { pathToFileURL } from 'url';

const buildDir = process.env.TEST_BUILD_DIR;
const { isNewer, formatUpdateLine } = await import(
  pathToFileURL(path.join(buildDir, 'core', 'update-check.js')).href
);

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
};

process.stdout.write(JSON.stringify(results));
