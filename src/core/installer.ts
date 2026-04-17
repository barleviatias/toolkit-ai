import fs from 'fs';
import path from 'path';
import type { Catalog, CatalogEntry, InstallResult, McpConfigFile, McpServerEntry } from '../types.js';
import {
  SKILL_TARGETS, AGENT_TARGETS,
  CODEX_AGENT_TARGET,
  LOCAL_MCP_CONFIG_FILES, GLOBAL_MCP_CONFIG_FILES,
  CACHE_DIR,
  getConfigFormat,
  writeCodexMcpServer,
  assertSafePathSegment,
} from './platform.js';
import { ensureDir, linkOrCopyDir, linkOrCopyFile } from './fs-helpers.js';
import {
  findSkill,
  findAgent,
  findMcp,
  findBundle,
  loadBundleConfig,
  loadMcpConfig,
  parseFrontmatter,
} from './catalog.js';
import { readLock, writeLock, recordInstall } from './lock.js';
import { fetchExternalResources, extractMcpServers } from './sources.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig, formatReport } from './scanner.js';

export interface InstallOptions {
  force?: boolean;
  bundleName?: string;
  verbose?: boolean;
}

export type LogFn = (msg: string) => void;

interface ExternalResourcesLike {
  skills: CatalogEntry[];
  agents: CatalogEntry[];
  mcps: CatalogEntry[];
  bundles: CatalogEntry[];
}

function renderCodexAgent(agentPath: string): { name: string; description: string; content: string } {
  const source = fs.readFileSync(agentPath, 'utf8');
  const meta = parseFrontmatter(source);
  const name = assertSafePathSegment(meta.name || path.basename(agentPath, '.agent.md'), 'agent name');
  const description = meta.description || '';
  const developerInstructions = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  const tomlMultiline = (value: string) => `"""\n${value.replace(/\r\n/g, '\n').replace(/"""/g, '\\"""')}\n"""`;
  const tomlString = (value: string) => JSON.stringify(value);

  return {
    name,
    description,
    content: [
      `name = ${tomlString(name)}`,
      `description = ${tomlString(description)}`,
      `developer_instructions = ${tomlMultiline(developerInstructions)}`,
      '',
    ].join('\n'),
  };
}

function toSharedMcpEntry(entry: McpServerEntry): McpServerEntry {
  return {
    type: entry.type,
    url: entry.url,
    command: entry.command,
    args: entry.args,
    env: entry.env,
    cwd: entry.cwd,
    bearerTokenEnvVar: entry.bearerTokenEnvVar,
    startupTimeoutSec: entry.startupTimeoutSec,
  };
}

function writeMcpToConfigs(
  mcpName: string,
  newEntry: McpServerEntry,
  opts: InstallOptions,
  log: LogFn,
): InstallResult['action'] {
  const localExisting = LOCAL_MCP_CONFIG_FILES.filter(f => fs.existsSync(f));
  const configsToWrite = [...localExisting, ...GLOBAL_MCP_CONFIG_FILES];

  let action: InstallResult['action'] = 'skipped';
  for (const configPath of configsToWrite) {
    if (GLOBAL_MCP_CONFIG_FILES.includes(configPath)) {
      ensureDir(path.dirname(configPath));
    }

    const format = getConfigFormat(configPath);
    if (format === 'codex-mcp') {
      const result = writeCodexMcpServer(configPath, mcpName, newEntry, opts.force);
      if (result === 'updated') {
        if (action !== 'installed') action = 'updated';
        log(`  [~] mcp ${mcpName} updated in ${configPath}`);
      } else if (result === 'installed') {
        action = 'installed';
        log(`  [+] mcp ${mcpName} registered in ${configPath}`);
      } else {
        log(`  [OK] mcp ${mcpName} (already registered in ${configPath})`);
      }
      continue;
    }

    let config: McpConfigFile;
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as McpConfigFile;
    } catch {
      if (GLOBAL_MCP_CONFIG_FILES.includes(configPath)) {
        config = {};
      } else {
        log(`  [!] Could not parse ${configPath}, skipping`);
        continue;
      }
    }

    const section = format === 'servers' ? 'servers' : 'mcpServers';
    if (!config[section]) config[section] = {};
    const sharedEntry = toSharedMcpEntry(newEntry);

    const existingEntry = config[section]![mcpName];
    if (existingEntry && !opts.force) {
      const same = JSON.stringify(existingEntry) === JSON.stringify(sharedEntry);
      if (same) {
        log(`  [OK] mcp ${mcpName} (already registered in ${configPath})`);
        continue;
      }
    }

    config[section]![mcpName] = sharedEntry;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    if (existingEntry) {
      if (action !== 'installed') action = 'updated';
      log(`  [~] mcp ${mcpName} updated in ${configPath}`);
    } else {
      action = 'installed';
      log(`  [+] mcp ${mcpName} registered in ${configPath}`);
    }
  }

  return action;
}

function initBundleLock(bundleName: string, bundleHash: string): void {
  const lock = readLock();
  lock.installed[`bundle:${bundleName}`] = {
    hash: bundleHash,
    installedAt: new Date().toISOString(),
    items: {},
  };
  writeLock(lock);
}

function installBundleEntry(
  catalog: Catalog,
  external: ExternalResourcesLike,
  sourceName: string,
  type: 'skill' | 'agent' | 'mcp',
  name: string,
  installOpts: InstallOptions,
  log: LogFn,
): InstallResult {
  const externalEntry =
    type === 'skill' ? external.skills.find(item => item.source === sourceName && item.name === name) :
    type === 'agent' ? external.agents.find(item => item.source === sourceName && item.name === name) :
    external.mcps.find(item => item.source === sourceName && item.name === name);

  if (externalEntry?.path && externalEntry.hash) {
    if (type === 'skill') {
      return installExternalSkill(sourceName, name, externalEntry.path, externalEntry.hash, installOpts, log);
    }
    if (type === 'agent') {
      return installExternalAgent(sourceName, name, externalEntry.path, externalEntry.hash, installOpts, log);
    }
    return installExternalMcp(sourceName, name, externalEntry.path, externalEntry.hash, installOpts, log);
  }

  if (type === 'skill') return installSkill(catalog, name, installOpts, log);
  if (type === 'agent') return installAgent(catalog, name, installOpts, log);
  return installMcp(catalog, name, installOpts, log);
}

// ---------------------------------------------------------------------------
// Install a skill
// ---------------------------------------------------------------------------

/** Install a skill by name from the catalog (looks up source, scans, copies to targets). */
export function installSkill(
  catalog: Catalog,
  name: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  const entry = findSkill(catalog, name);
  if (!entry) throw new Error(`Skill not found in catalog: ${name}`);
  return installExternalSkill(entry.source, name, entry.path, entry.hash, opts, log);
}

// ---------------------------------------------------------------------------
// Install a skill from an external source (cached repo)
// ---------------------------------------------------------------------------

/** Install a skill from an external source cache. Runs security scan before copying. */
export function installExternalSkill(
  sourceName: string,
  skillName: string,
  skillPath: string,
  hash: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  assertSafePathSegment(skillName, 'skill name');
  const src = path.join(CACHE_DIR, sourceName, skillPath);
  if (!fs.existsSync(src)) throw new Error(`External skill not found at: ${src}`);

  // Security scan (external sources always scanned)
  const report = scanSkillDir(src, skillName, sourceName);
  if (!report.passed && !opts.force) {
    log(formatReport(report));
    log(`      Skipped — use --force to override`);
    return { type: 'skill', name: skillName, action: 'blocked' };
  }
  if (report.findings.length > 0) log(formatReport(report));

  const lock = readLock();
  const itemKey = `skill:${skillName}`;

  const lockEntry = lock.installed[itemKey];
  const needsUpdate = lockEntry && lockEntry.hash !== hash;
  const shouldForce = opts.force || needsUpdate;

  let action: InstallResult['action'] = 'skipped';
  for (const dir of SKILL_TARGETS) {
    const dest = path.join(dir, skillName);
    // Always copy for external skills (source is a cache dir)
    const result = linkOrCopyDir(src, dest, shouldForce || false, true);
    if (result === 'updated') {
      log(`  [~] skill ${skillName} updated in ${dest}`);
      action = 'updated';
    } else if (result === 'installed') {
      log(`  [+] skill ${skillName} -> ${dest}`);
      action = 'installed';
    } else {
      log(`  [OK] skill ${skillName} (up to date)`);
    }
  }

  recordInstall(lock, itemKey, hash);
  writeLock(lock);
  return { type: 'skill', name: skillName, action };
}

// ---------------------------------------------------------------------------
// Install an external agent (from cached source)
// ---------------------------------------------------------------------------

/** Install an agent from an external source cache. Runs security scan before copying. */
export function installExternalAgent(
  sourceName: string,
  agentName: string,
  agentPath: string,
  hash: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  assertSafePathSegment(agentName, 'agent name');
  const src = path.join(CACHE_DIR, sourceName, agentPath);
  if (!fs.existsSync(src)) throw new Error(`External agent not found at: ${src}`);

  const report = scanAgentFile(src, agentName, sourceName);
  if (!report.passed && !opts.force) {
    log(formatReport(report));
    log(`      Skipped — use --force to override`);
    return { type: 'agent', name: agentName, action: 'blocked' };
  }
  if (report.findings.length > 0) log(formatReport(report));

  const lock = readLock();
  const itemKey = `agent:${agentName}`;
  const filename = path.basename(agentPath);
  const codexAgent = renderCodexAgent(src);

  const lockEntry = lock.installed[itemKey];
  const needsUpdate = lockEntry && lockEntry.hash !== hash;
  const shouldForce = opts.force || needsUpdate;

  let action: InstallResult['action'] = 'skipped';
  for (const dir of AGENT_TARGETS) {
    const dest = path.join(dir, filename);
    const result = linkOrCopyFile(src, dest, shouldForce || false, true);
    if (result === 'updated') {
      log(`  [~] agent ${agentName} updated in ${dest}`);
      action = 'updated';
    } else if (result === 'installed') {
      log(`  [+] agent ${agentName} -> ${dest}`);
      action = 'installed';
    } else {
      log(`  [OK] agent ${agentName} (up to date)`);
    }
  }

  const codexDest = path.join(CODEX_AGENT_TARGET, `${codexAgent.name}.toml`);
  ensureDir(path.dirname(codexDest));
  const codexExists = fs.existsSync(codexDest);
  if (!codexExists || shouldForce) {
    fs.writeFileSync(codexDest, codexAgent.content, 'utf8');
    if (codexExists) {
      if (action !== 'installed') action = 'updated';
      log(`  [~] agent ${agentName} updated in ${codexDest}`);
    } else {
      action = 'installed';
      log(`  [+] agent ${agentName} -> ${codexDest}`);
    }
  } else {
    log(`  [OK] agent ${agentName} (up to date)`);
  }

  recordInstall(lock, itemKey, hash);
  writeLock(lock);
  return { type: 'agent', name: agentName, action };
}

// ---------------------------------------------------------------------------
// Install an external MCP (from cached source)
// ---------------------------------------------------------------------------

/** Install an MCP from an external source cache. Writes config to all target files. */
export function installExternalMcp(
  sourceName: string,
  mcpName: string,
  mcpPath: string,
  hash: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  const src = path.join(CACHE_DIR, sourceName, mcpPath);
  if (!fs.existsSync(src)) throw new Error(`External MCP not found at: ${src}`);

  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(fs.readFileSync(src, 'utf8'));
  } catch {
    throw new Error(`Failed to parse MCP config: ${src}`);
  }

  // A single .mcp.json may declare many servers; pick the one matching mcpName.
  const server = extractMcpServers(rawConfig).find(([name]) => name === mcpName)?.[1];
  if (!server) {
    throw new Error(`MCP server "${mcpName}" not found in ${src}`);
  }

  const report = scanMcpConfig({
    name: mcpName,
    type: server.type as string | undefined,
    url: server.url as string | undefined,
    command: server.command as string | undefined,
    args: server.args as string[] | undefined,
    env: server.env as Record<string, string> | undefined,
    envVars: server.envVars as string[] | undefined,
    httpHeaders: server.httpHeaders as Record<string, string> | undefined,
    envHttpHeaders: server.envHttpHeaders as Record<string, string> | undefined,
  }, sourceName);
  if (!report.passed && !opts.force) {
    log(formatReport(report));
    log(`      Skipped — use --force to override`);
    return { type: 'mcp', name: mcpName, action: 'blocked' };
  }
  if (report.findings.length > 0) log(formatReport(report));

  const newEntry: McpServerEntry = {
    type: server.type as string | undefined,
    url: server.url as string | undefined,
    command: server.command as string | undefined,
    args: server.args as string[] | undefined,
    env: server.env as Record<string, string> | undefined,
    envVars: server.envVars as string[] | undefined,
    cwd: server.cwd as string | undefined,
    bearerTokenEnvVar: server.bearerTokenEnvVar as string | undefined,
    httpHeaders: server.httpHeaders as Record<string, string> | undefined,
    envHttpHeaders: server.envHttpHeaders as Record<string, string> | undefined,
    startupTimeoutSec: server.startupTimeoutSec as number | undefined,
    toolTimeoutSec: server.toolTimeoutSec as number | undefined,
    enabled: server.enabled as boolean | undefined,
    required: server.required as boolean | undefined,
    enabledTools: server.enabledTools as string[] | undefined,
    disabledTools: server.disabledTools as string[] | undefined,
  };
  const lock = readLock();
  const itemKey = `mcp:${mcpName}`;
  const action = writeMcpToConfigs(mcpName, newEntry, opts, log);

  recordInstall(lock, itemKey, hash);
  writeLock(lock);
  return { type: 'mcp', name: mcpName, action };
}

// ---------------------------------------------------------------------------
// Install an agent
// ---------------------------------------------------------------------------

/** Install an agent by name from the catalog. */
export function installAgent(
  catalog: Catalog,
  name: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  const entry = findAgent(catalog, name);
  if (!entry) throw new Error(`Agent not found in catalog: ${name}`);
  return installExternalAgent(entry.source, name, entry.path, entry.hash, opts, log);
}

// ---------------------------------------------------------------------------
// Install an MCP
// ---------------------------------------------------------------------------

/** Install an MCP server by name from the catalog. Delegates to installExternalMcp
 * which handles all three .mcp.json shapes (custom/wrapped/flat) uniformly. */
export function installMcp(
  catalog: Catalog,
  name: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  const entry = findMcp(catalog, name);
  if (!entry) throw new Error(`MCP not found in catalog: ${name}`);
  return installExternalMcp(entry.source, name, entry.path, entry.hash, opts, log);
}

// ---------------------------------------------------------------------------
// Install a bundle (collection of skills + agents + mcps)
// ---------------------------------------------------------------------------

/** Install all items in a bundle (skills + agents + MCPs) by name. */
export function installBundle(
  catalog: Catalog,
  name: string,
  opts: Omit<InstallOptions, 'bundleName'> = {},
  log: LogFn = console.log,
): InstallResult[] {
  const entry = findBundle(catalog, name);
  if (!entry) throw new Error(`Bundle not found in catalog: ${name}`);
  return installExternalBundle(catalog, entry.source, name, entry.path, entry.hash, opts, log);
}

/** Install a bundle from an external source cache, resolving each item from the catalog. */
export function installExternalBundle(
  catalog: Catalog,
  sourceName: string,
  bundleName: string,
  bundlePath: string,
  hash: string,
  opts: Omit<InstallOptions, 'bundleName'> = {},
  log: LogFn = console.log,
): InstallResult[] {
  const bundle = loadBundleConfig({ name: bundleName, description: '', hash, path: bundlePath, source: sourceName });
  const external = fetchExternalResources(false);

  log(`\nInstalling bundle: ${bundleName}`);
  initBundleLock(bundleName, hash);

  const results: InstallResult[] = [];
  const installOpts = { ...opts, bundleName: bundleName };

  for (const skillName of bundle.skills || []) {
    results.push(installBundleEntry(catalog, external, sourceName, 'skill', skillName, installOpts, log));
  }
  for (const agentName of bundle.agents || []) {
    results.push(installBundleEntry(catalog, external, sourceName, 'agent', agentName, installOpts, log));
  }
  for (const mcpName of bundle.mcps || []) {
    results.push(installBundleEntry(catalog, external, sourceName, 'mcp', mcpName, installOpts, log));
  }

  return results;
}
