import fs from 'fs';
import path from 'path';
import type { Catalog, CatalogEntry, InstallResult, LockFile } from '../types.js';
import {
  SKILL_TARGETS, AGENT_TARGETS,
  LOCAL_MCP_CONFIG_FILES, GLOBAL_MCP_CONFIG_FILES, MCP_CONFIG_FILES,
  CACHE_DIR,
  getConfigFormat, isNpxRun,
} from './platform.js';
import { ensureDir, linkOrCopyDir, linkOrCopyFile, copyDirRecursive } from './fs-helpers.js';
import { findSkill, findAgent, findMcp, findBundle, loadBundleConfig, loadMcpConfig } from './catalog.js';
import { readLock, writeLock, recordInstall } from './lock.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig, formatReport, type ScanOptions } from './scanner.js';

export interface InstallOptions {
  force?: boolean;
  bundleName?: string;
  verbose?: boolean;
}

export type LogFn = (msg: string) => void;

// ---------------------------------------------------------------------------
// Install a skill
// ---------------------------------------------------------------------------

export function installSkill(
  catalog: Catalog,
  toolkitDir: string,
  name: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  const entry = findSkill(catalog, name);
  if (!entry) throw new Error(`Skill not found in catalog: ${name}`);
  const src = path.join(toolkitDir, entry.path);

  // Security scan (internal content is trusted — blocks downgraded to warnings)
  const isInternal = !entry.source || entry.source === 'internal';
  const report = scanSkillDir(src, name, entry.source || 'internal', { trusted: isInternal });
  if (!report.passed && !opts.force) {
    log(formatReport(report));
    log(`      Skipped — use --force to override`);
    return { type: 'skill', name, action: 'blocked' };
  }
  if (report.findings.length > 0) log(formatReport(report));

  const forceCopy = isNpxRun(toolkitDir);
  const currentHash = entry.hash;
  const lock = readLock();
  const itemKey = `skill:${name}`;

  const lockEntry = opts.bundleName
    ? lock.installed[`bundle:${opts.bundleName}`]?.items?.[itemKey]
    : lock.installed[itemKey];
  const needsUpdate = lockEntry && lockEntry.hash !== currentHash;
  const shouldForce = opts.force || needsUpdate;

  let action: InstallResult['action'] = 'skipped';
  for (const dir of SKILL_TARGETS) {
    const dest = path.join(dir, name);
    const result = linkOrCopyDir(src, dest, shouldForce || false, forceCopy);
    if (result === 'updated') {
      log(`  [~] skill ${name} updated in ${dest}`);
      action = 'updated';
    } else if (result === 'installed') {
      log(`  [+] skill ${name} -> ${dest}`);
      action = 'installed';
    } else {
      log(`  [OK] skill ${name} (up to date)`);
    }
  }

  recordInstall(lock, itemKey, currentHash, opts.bundleName);
  writeLock(lock);
  return { type: 'skill', name, action };
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

  const localExisting = LOCAL_MCP_CONFIG_FILES.filter(f => fs.existsSync(f));
  const configsToWrite = [...localExisting, ...GLOBAL_MCP_CONFIG_FILES];

  let action: InstallResult['action'] = 'skipped';
  for (const configPath of configsToWrite) {
    if (GLOBAL_MCP_CONFIG_FILES.includes(configPath)) {
      ensureDir(path.dirname(configPath));
    }

    let config: Record<string, any>;
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      if (GLOBAL_MCP_CONFIG_FILES.includes(configPath)) {
        config = {};
      } else {
        continue;
      }
    }

    const format = getConfigFormat(configPath);
    const section = format === 'servers' ? 'servers' : 'mcpServers';
    if (!config[section]) config[section] = {};

    config[section][mcpName] = newEntry;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    log(`  [+] mcp ${mcpName} -> ${configPath}`);
    action = 'installed';
  }

  recordInstall(lock, itemKey, hash);
  writeLock(lock);
  return { type: 'mcp', name: mcpName, action };
}

// ---------------------------------------------------------------------------
// Install an agent
// ---------------------------------------------------------------------------

export function installAgent(
  catalog: Catalog,
  toolkitDir: string,
  name: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  const entry = findAgent(catalog, name);
  if (!entry) throw new Error(`Agent not found in catalog: ${name}`);
  const src = path.join(toolkitDir, entry.path);

  // Security scan (internal content is trusted)
  const isInternal = !entry.source || entry.source === 'internal';
  const report = scanAgentFile(src, name, entry.source || 'internal', { trusted: isInternal });
  if (!report.passed && !opts.force) {
    log(formatReport(report));
    log(`      Skipped — use --force to override`);
    return { type: 'agent', name, action: 'blocked' };
  }
  if (report.findings.length > 0) log(formatReport(report));

  const filename = path.basename(entry.path);
  const forceCopy = isNpxRun(toolkitDir);
  const currentHash = entry.hash;
  const lock = readLock();
  const itemKey = `agent:${name}`;

  const lockEntry = opts.bundleName
    ? lock.installed[`bundle:${opts.bundleName}`]?.items?.[itemKey]
    : lock.installed[itemKey];
  const needsUpdate = lockEntry && lockEntry.hash !== currentHash;
  const shouldForce = opts.force || needsUpdate;

  let action: InstallResult['action'] = 'skipped';
  for (const dir of AGENT_TARGETS) {
    const dest = path.join(dir, filename);
    const result = linkOrCopyFile(src, dest, shouldForce || false, forceCopy);
    if (result === 'updated') {
      log(`  [~] agent ${name} updated in ${dest}`);
      action = 'updated';
    } else if (result === 'installed') {
      log(`  [+] agent ${name} -> ${dest}`);
      action = 'installed';
    } else {
      log(`  [OK] agent ${name} (up to date)`);
    }
  }

  recordInstall(lock, itemKey, currentHash, opts.bundleName);
  writeLock(lock);
  return { type: 'agent', name, action };
}

// ---------------------------------------------------------------------------
// Install an MCP
// ---------------------------------------------------------------------------

export function installMcp(
  catalog: Catalog,
  toolkitDir: string,
  name: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  const entry = findMcp(catalog, name);
  if (!entry) throw new Error(`MCP not found in catalog: ${name}`);

  const mcpConfig = loadMcpConfig(toolkitDir, entry);

  // Security scan
  const report = scanMcpConfig({ name, type: mcpConfig.type, url: mcpConfig.url }, entry.source || 'internal');
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

  const localExisting = LOCAL_MCP_CONFIG_FILES.filter(f => fs.existsSync(f));
  const configsToWrite = [...localExisting, ...GLOBAL_MCP_CONFIG_FILES];

  let action: InstallResult['action'] = 'skipped';
  for (const configPath of configsToWrite) {
    if (GLOBAL_MCP_CONFIG_FILES.includes(configPath)) {
      ensureDir(path.dirname(configPath));
    }

    let config: Record<string, any>;
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
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
    const existingEntry = config[section][name];

    if (existingEntry && !opts.force) {
      const same = existingEntry.type === newEntry.type && existingEntry.url === newEntry.url;
      if (same) {
        log(`  [OK] mcp ${name} (already registered in ${configPath})`);
        continue;
      }
    }

    config[section][name] = newEntry;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    if (existingEntry) {
      if (action !== 'installed') action = 'updated';
      log(`  [~] mcp ${name} updated in ${configPath}`);
    } else {
      action = 'installed';
      log(`  [+] mcp ${name} registered in ${configPath}`);
    }
    if (mcpConfig.setupNote) log(`      ${mcpConfig.setupNote}`);
  }

  recordInstall(lock, itemKey, currentHash, opts.bundleName);
  writeLock(lock);
  return { type: 'mcp', name, action };
}

// ---------------------------------------------------------------------------
// Install a bundle (collection of skills + agents + mcps)
// ---------------------------------------------------------------------------

export function installBundle(
  catalog: Catalog,
  toolkitDir: string,
  name: string,
  opts: Omit<InstallOptions, 'bundleName'> = {},
  log: LogFn = console.log,
): InstallResult[] {
  const entry = findBundle(catalog, name);
  if (!entry) throw new Error(`Bundle not found in catalog: ${name}`);
  const bundle = loadBundleConfig(toolkitDir, entry);

  log(`\nInstalling bundle: ${name}`);

  // Initialize bundle lock entry
  const lock = readLock();
  lock.installed[`bundle:${name}`] = { hash: entry.hash, installedAt: new Date().toISOString(), items: {} };
  writeLock(lock);

  const results: InstallResult[] = [];
  const installOpts = { ...opts, bundleName: name };

  for (const s of bundle.skills || []) {
    results.push(installSkill(catalog, toolkitDir, s, installOpts, log));
  }
  for (const a of bundle.agents || []) {
    results.push(installAgent(catalog, toolkitDir, a, installOpts, log));
  }
  for (const m of bundle.mcps || []) {
    results.push(installMcp(catalog, toolkitDir, m, installOpts, log));
  }

  return results;
}
