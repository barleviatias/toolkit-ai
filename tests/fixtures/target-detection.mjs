import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-targets-'));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
process.env.PATH = path.join(tempHome, 'empty-bin');
fs.mkdirSync(process.env.PATH, { recursive: true });

fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });
fs.mkdirSync(path.join(tempHome, '.codex'), { recursive: true });

const buildDir = process.env.TEST_BUILD_DIR;
const {
  detectToolInstallations,
  getWritableSkillTargets,
  getWritableAgentTargets,
  getWritableMcpConfigFiles,
} = await import(pathToFileURL(path.join(buildDir, 'core', 'platform.js')).href);

const tools = detectToolInstallations();

process.stdout.write(JSON.stringify({
  installedIds: tools.filter(tool => tool.installed).map(tool => tool.id).sort(),
  skillTargets: getWritableSkillTargets().map(target => path.relative(tempHome, target)).sort(),
  agentTargets: getWritableAgentTargets().map(target => path.relative(tempHome, target)).sort(),
  mcpTargets: getWritableMcpConfigFiles().map(target => path.relative(tempHome, target)).sort(),
}));

fs.rmSync(tempHome, { recursive: true, force: true });
