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
import { findSkill, findAgent, findMcp, findPlugin, loadPluginConfig, loadMcpConfig } from './catalog.js';
import { readLock, writeLock, recordInstall } from './lock.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig, formatReport, type ScanOptions } from './scanner.js';

export interface InstallOptions {
  force?: boolean;
  pluginName?: string;
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

  const lockEntry = opts.pluginName
    ? lock.installed[`plugin:${opts.pluginName}`]?.items?.[itemKey]
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

  recordInstall(lock, itemKey, currentHash, opts.pluginName);
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

  const lockEntry = opts.pluginName
    ? lock.installed[`plugin:${opts.pluginName}`]?.items?.[itemKey]
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

  recordInstall(lock, itemKey, currentHash, opts.pluginName);
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
  const report = scanMcpConfig({ name, transport: mcpConfig.transport, url: mcpConfig.url }, entry.source || 'internal');
  if (!report.passed && !opts.force) {
    log(formatReport(report));
    log(`      Skipped — use --force to override`);
    return { type: 'mcp', name, action: 'blocked' };
  }
  if (report.findings.length > 0) log(formatReport(report));

  const newEntry = { type: mcpConfig.transport, url: mcpConfig.url };
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

  recordInstall(lock, itemKey, currentHash, opts.pluginName);
  writeLock(lock);
  return { type: 'mcp', name, action };
}

// ---------------------------------------------------------------------------
// Install a plugin (bundle of skills + agents + mcps)
// ---------------------------------------------------------------------------

export function installPlugin(
  catalog: Catalog,
  toolkitDir: string,
  name: string,
  opts: Omit<InstallOptions, 'pluginName'> = {},
  log: LogFn = console.log,
): InstallResult[] {
  const entry = findPlugin(catalog, name);
  if (!entry) throw new Error(`Plugin not found in catalog: ${name}`);
  const plugin = loadPluginConfig(toolkitDir, entry);

  log(`\nInstalling plugin: ${name}`);

  // Initialize plugin lock entry
  const lock = readLock();
  lock.installed[`plugin:${name}`] = { hash: entry.hash, installedAt: new Date().toISOString(), items: {} };
  writeLock(lock);

  const results: InstallResult[] = [];
  const installOpts = { ...opts, pluginName: name };

  for (const s of plugin.skills || []) {
    results.push(installSkill(catalog, toolkitDir, s, installOpts, log));
  }
  for (const a of plugin.agents || []) {
    results.push(installAgent(catalog, toolkitDir, a, installOpts, log));
  }
  for (const m of plugin.mcps || []) {
    results.push(installMcp(catalog, toolkitDir, m, installOpts, log));
  }

  return results;
}
