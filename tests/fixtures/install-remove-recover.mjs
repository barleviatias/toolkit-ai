import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const [, , tempHome] = process.argv;
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const buildDir = process.env.TEST_BUILD_DIR;

const { installExternalSkill, installExternalAgent, installExternalMcp } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'installer.js')).href);
const { removeSkill, removeAgent, removeMcp } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'remover.js')).href);
const { getInstalledState } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'installed-state.js')).href);
const { parseCodexMcpSection } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'platform.js')).href);
const noop = () => {};

const sourceName = 'testsrc';
const cacheRoot = path.join(tempHome, '.toolkit', 'cache', sourceName, 'resources');
const skillDir = path.join(cacheRoot, 'skills', 'example-skill');
const agentFile = path.join(cacheRoot, 'agents', 'example-agent.agent.md');
const mcpFile = path.join(cacheRoot, 'mcps', 'example-mcp.json');

fs.mkdirSync(skillDir, { recursive: true });
fs.mkdirSync(path.dirname(agentFile), { recursive: true });
fs.mkdirSync(path.dirname(mcpFile), { recursive: true });

fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: example-skill
description: Example skill
---

# Example Skill
`);

fs.writeFileSync(agentFile, `---
name: example-agent
description: Example agent
---

# Example Agent

Do useful work.
`);

fs.writeFileSync(mcpFile, JSON.stringify({
  name: 'example-mcp',
  description: 'Example MCP',
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@example/mcp'],
  env: { API_KEY: 'secret' },
  envVars: ['PATH'],
  cwd: 'C:/repo',
  startupTimeoutSec: 12,
  toolTimeoutSec: 34,
  enabled: true,
  required: true,
  enabledTools: ['open'],
  disabledTools: ['delete'],
}, null, 2));

for (const configPath of [
  path.join(tempHome, '.claude', 'settings.json'),
  path.join(tempHome, '.cursor', 'mcp.json'),
  path.join(tempHome, '.vscode', 'mcp.json'),
]) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, '{}');
}

const catalog = {
  skills: [{
    name: 'example-skill',
    description: 'Example skill',
    hash: 'skill-hash',
    path: 'resources/skills/example-skill',
    source: sourceName,
  }],
  agents: [{
    name: 'example-agent',
    description: 'Example agent',
    hash: 'agent-hash',
    path: 'resources/agents/example-agent.agent.md',
    source: sourceName,
  }],
  mcps: [{
    name: 'example-mcp',
    description: 'Example MCP',
    hash: 'mcp-hash',
    path: 'resources/mcps/example-mcp.json',
    source: sourceName,
  }],
  bundles: [],
};

const skillResult = installExternalSkill(sourceName, 'example-skill', 'resources/skills/example-skill', 'skill-hash', {}, noop);
const agentResult = installExternalAgent(sourceName, 'example-agent', 'resources/agents/example-agent.agent.md', 'agent-hash', {}, noop);
const mcpResult = installExternalMcp(sourceName, 'example-mcp', 'resources/mcps/example-mcp.json', 'mcp-hash', {}, noop);
const secondMcpInstall = installExternalMcp(sourceName, 'example-mcp', 'resources/mcps/example-mcp.json', 'mcp-hash', {}, noop).action;

const claudeSettingsPath = path.join(tempHome, '.claude', 'settings.json');
const cursorConfigPath = path.join(tempHome, '.cursor', 'mcp.json');
const vscodeConfigPath = path.join(tempHome, '.vscode', 'mcp.json');
const globalClaudePath = path.join(tempHome, '.claude.json');
const codexConfigPath = path.join(tempHome, '.codex', 'config.toml');
const codexAgentPath = path.join(tempHome, '.codex', 'agents', 'example-agent.toml');

const claudeSettings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
const cursorConfig = JSON.parse(fs.readFileSync(cursorConfigPath, 'utf8'));
const vscodeConfig = JSON.parse(fs.readFileSync(vscodeConfigPath, 'utf8'));
const globalClaudeConfig = JSON.parse(fs.readFileSync(globalClaudePath, 'utf8'));
const codexParsed = parseCodexMcpSection(fs.readFileSync(codexConfigPath, 'utf8'), 'example-mcp');
const recoveredKeys = [...getInstalledState(catalog, { installed: {} }).recoveredKeys];

const result = {
  installResults: {
    skill: skillResult.action,
    agent: agentResult.action,
    mcp: mcpResult.action,
  },
  secondMcpInstall,
  files: {
    skillInstalled: fs.existsSync(path.join(tempHome, '.agents', 'skills', 'example-skill', 'SKILL.md')),
    agentInstalledClaude: fs.existsSync(path.join(tempHome, '.claude', 'agents', 'example-agent.agent.md')),
    agentInstalledCopilot: fs.existsSync(path.join(tempHome, '.copilot', 'agents', 'example-agent.agent.md')),
    agentInstalledCodex: fs.existsSync(codexAgentPath),
    codexAgentContent: fs.readFileSync(codexAgentPath, 'utf8'),
  },
  mcpTargets: {
    claudeHasCommand: claudeSettings.mcpServers?.['example-mcp']?.command === 'npx',
    cursorHasCommand: cursorConfig.mcpServers?.['example-mcp']?.command === 'npx',
    vscodeHasCommand: vscodeConfig.servers?.['example-mcp']?.command === 'npx',
    globalClaudeHasCommand: globalClaudeConfig.mcpServers?.['example-mcp']?.command === 'npx',
    claudeHasCodexOnlyFields: 'enabledTools' in (claudeSettings.mcpServers?.['example-mcp'] || {}) ||
      'disabledTools' in (claudeSettings.mcpServers?.['example-mcp'] || {}) ||
      'toolTimeoutSec' in (claudeSettings.mcpServers?.['example-mcp'] || {}),
    cursorHasCodexOnlyFields: 'enabledTools' in (cursorConfig.mcpServers?.['example-mcp'] || {}) ||
      'disabledTools' in (cursorConfig.mcpServers?.['example-mcp'] || {}) ||
      'toolTimeoutSec' in (cursorConfig.mcpServers?.['example-mcp'] || {}),
    vscodeHasCodexOnlyFields: 'enabledTools' in (vscodeConfig.servers?.['example-mcp'] || {}) ||
      'disabledTools' in (vscodeConfig.servers?.['example-mcp'] || {}) ||
      'toolTimeoutSec' in (vscodeConfig.servers?.['example-mcp'] || {}),
    codexParsed,
  },
  recoveredKeys,
};

removeSkill(catalog, 'example-skill', noop);
removeAgent(catalog, 'example-agent', noop);
removeMcp(catalog, 'example-mcp', noop);

result.afterRemove = {
  skillInstalled: fs.existsSync(path.join(tempHome, '.agents', 'skills', 'example-skill', 'SKILL.md')),
  agentInstalledClaude: fs.existsSync(path.join(tempHome, '.claude', 'agents', 'example-agent.agent.md')),
  agentInstalledCopilot: fs.existsSync(path.join(tempHome, '.copilot', 'agents', 'example-agent.agent.md')),
  agentInstalledCodex: fs.existsSync(codexAgentPath),
  codexMcpPresent: !!parseCodexMcpSection(fs.readFileSync(codexConfigPath, 'utf8'), 'example-mcp'),
  claudeMcpPresent: !!JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8')).mcpServers?.['example-mcp'],
  cursorMcpPresent: !!JSON.parse(fs.readFileSync(cursorConfigPath, 'utf8')).mcpServers?.['example-mcp'],
  vscodeMcpPresent: !!JSON.parse(fs.readFileSync(vscodeConfigPath, 'utf8')).servers?.['example-mcp'],
  globalClaudeMcpPresent: !!JSON.parse(fs.readFileSync(globalClaudePath, 'utf8')).mcpServers?.['example-mcp'],
};

process.stdout.write(JSON.stringify(result));
