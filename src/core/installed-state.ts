import fs from 'fs';
import path from 'path';
import type { Catalog, LockFile } from '../types.js';
import { AGENT_TARGETS, CODEX_AGENT_TARGET, MCP_CONFIG_FILES, SKILL_TARGETS, getConfigFormat } from './platform.js';
import { parseCodexMcpSection } from './codex-config.js';

export interface InstalledState {
  installedKeys: Set<string>;
  recoveredKeys: Set<string>;
}

function addLockEntries(lock: LockFile, installedKeys: Set<string>): void {
  for (const [key, entry] of Object.entries(lock.installed)) {
    if (key.startsWith('bundle:')) {
      for (const itemKey of Object.keys(entry.items || {})) {
        installedKeys.add(itemKey);
      }
      continue;
    }
    installedKeys.add(key);
  }
}

function hasInstalledSkill(skillName: string): boolean {
  return SKILL_TARGETS.some(dir => fs.existsSync(path.join(dir, skillName)));
}

function hasInstalledAgent(agentName: string, agentPath: string): boolean {
  const filename = path.basename(agentPath);
  return AGENT_TARGETS.some(dir => fs.existsSync(path.join(dir, filename))) ||
    fs.existsSync(path.join(CODEX_AGENT_TARGET, `${agentName}.toml`));
}

function hasInstalledMcp(mcpName: string): boolean {
  for (const configPath of MCP_CONFIG_FILES) {
    if (!fs.existsSync(configPath)) continue;
    if (getConfigFormat(configPath) === 'codex-mcp') {
      const text = fs.readFileSync(configPath, 'utf8');
      if (parseCodexMcpSection(text, mcpName)) return true;
      continue;
    }
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, any>;
      const section = getConfigFormat(configPath) === 'servers' ? 'servers' : 'mcpServers';
      if (config[section]?.[mcpName]) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function getInstalledState(catalog: Catalog, lock: LockFile): InstalledState {
  const installedKeys = new Set<string>();
  addLockEntries(lock, installedKeys);

  const recoveredKeys = new Set<string>();

  for (const skill of catalog.skills) {
    const key = `skill:${skill.name}`;
    if (!installedKeys.has(key) && hasInstalledSkill(skill.name)) {
      installedKeys.add(key);
      recoveredKeys.add(key);
    }
  }

  for (const agent of catalog.agents) {
    const key = `agent:${agent.name}`;
    if (!installedKeys.has(key) && hasInstalledAgent(agent.name, agent.path)) {
      installedKeys.add(key);
      recoveredKeys.add(key);
    }
  }

  for (const mcp of catalog.mcps) {
    const key = `mcp:${mcp.name}`;
    if (!installedKeys.has(key) && hasInstalledMcp(mcp.name)) {
      installedKeys.add(key);
      recoveredKeys.add(key);
    }
  }

  return { installedKeys, recoveredKeys };
}
