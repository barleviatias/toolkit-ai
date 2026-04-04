import fs from 'fs';
import path from 'path';
import type { Catalog, CatalogEntry, InstallResult, McpConfigFile } from '../types.js';
import {
  SKILL_TARGETS, AGENT_TARGETS,
  LOCAL_MCP_CONFIG_FILES, GLOBAL_MCP_CONFIG_FILES,
  CACHE_DIR,
  getConfigFormat,
} from './platform.js';
import { ensureDir, linkOrCopyDir, linkOrCopyFile } from './fs-helpers.js';
import {
  findSkill,
  findAgent,
  findMcp,
  findBundle,
  loadBundleConfig,
  loadMcpConfig,
} from './catalog.js';
import { readLock, writeLock, recordInstall } from './lock.js';
import { fetchExternalResources } from './sources.js';
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

function writeMcpToConfigs(
  mcpName: string,
  newEntry: { type: string; url: string },
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

    const format = getConfigFormat(configPath);
    const section = format === 'servers' ? 'servers' : 'mcpServers';
    if (!config[section]) config[section] = {};

    const existingEntry = config[section]![mcpName];
    if (existingEntry && !opts.force) {
      const same = existingEntry.type === newEntry.type && existingEntry.url === newEntry.url;
      if (same) {
        log(`  [OK] mcp ${mcpName} (already registered in ${configPath})`);
        continue;
      }
    }

    config[section]![mcpName] = newEntry;
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

export function installExternalSkill(
  sourceName: string,
  skillName: string,
  skillPath: string,
  hash: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
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

export function installExternalAgent(
  sourceName: string,
  agentName: string,
  agentPath: string,
  hash: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
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

  recordInstall(lock, itemKey, hash);
  writeLock(lock);
  return { type: 'agent', name: agentName, action };
}

// ---------------------------------------------------------------------------
// Install an external MCP (from cached source)
// ---------------------------------------------------------------------------

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

  let mcpConfig;
  try {
    mcpConfig = JSON.parse(fs.readFileSync(src, 'utf8'));
  } catch {
    throw new Error(`Failed to parse MCP config: ${src}`);
  }

  const report = scanMcpConfig({ name: mcpName, type: mcpConfig.type, url: mcpConfig.url }, sourceName);
  if (!report.passed && !opts.force) {
    log(formatReport(report));
    log(`      Skipped — use --force to override`);
    return { type: 'mcp', name: mcpName, action: 'blocked' };
  }
  if (report.findings.length > 0) log(formatReport(report));

  const newEntry = { type: mcpConfig.type, url: mcpConfig.url };
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

export function installMcp(
  catalog: Catalog,
  name: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  const entry = findMcp(catalog, name);
  if (!entry) throw new Error(`MCP not found in catalog: ${name}`);

  const mcpConfig = loadMcpConfig(entry);

  const report = scanMcpConfig({ name, type: mcpConfig.type, url: mcpConfig.url }, entry.source);
  if (!report.passed && !opts.force) {
    log(formatReport(report));
    log(`      Skipped — use --force to override`);
    return { type: 'mcp', name, action: 'blocked' };
  }
  if (report.findings.length > 0) log(formatReport(report));

  const newEntry = { type: mcpConfig.type, url: mcpConfig.url };
  const currentHash = entry.hash;
  const lock = readLock();
  const itemKey = `mcp:${name}`;
  const action = writeMcpToConfigs(name, newEntry, opts, log);
  if (mcpConfig.setupNote && action !== 'skipped') log(`      ${mcpConfig.setupNote}`);

  recordInstall(lock, itemKey, currentHash, opts.bundleName);
  writeLock(lock);
  return { type: 'mcp', name, action };
}

// ---------------------------------------------------------------------------
// Install a bundle (collection of skills + agents + mcps)
// ---------------------------------------------------------------------------

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
