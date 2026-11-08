import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-dot-agents-'));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const cacheRoot = path.join(tempHome, '.toolkit', 'cache', 'cto-common');
for (const relativePath of ['.agents/skills/code-review', '.unrelated/skills/hidden']) {
  const dir = path.join(cacheRoot, relativePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${path.basename(dir)}\ndescription: Example\n---\n`);
}

const modulePath = path.join(process.env.TEST_BUILD_DIR, 'core', 'sources.js');
const { scanCachedSource } = await import(pathToFileURL(modulePath).href);
const resources = scanCachedSource({ name: 'cto-common', type: 'bitbucket', repo: 'rdwrcloud/cto-common' });
process.stdout.write(JSON.stringify(resources.skills.map(({ name, path }) => ({ name, path }))));
fs.rmSync(tempHome, { recursive: true, force: true });
