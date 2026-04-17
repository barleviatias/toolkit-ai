import fs from 'fs';
import path from 'path';
import type { Catalog, CatalogEntry, InstallResult, McpConfigFile, McpServerEntry, PluginFormats } from '../types.js';
import {
  SKILL_TARGETS, AGENT_TARGETS,
  CODEX_AGENT_TARGET,
  LOCAL_MCP_CONFIG_FILES, GLOBAL_MCP_CONFIG_FILES,
  CACHE_DIR,
  getConfigFormat,
  writeCodexMcpServer,
  assertSafePathSegment,
  // Plugin registry writers (real native formats)
  CLAUDE_PLUGIN_CACHE, CODEX_PLUGINS_DIR, COPILOT_INSTALLED_PLUGINS_DIR, CURSOR_PLUGINS_DIR,
  registerClaudeInstalledPlugin, enableClaudePlugin,
  registerCodexPlugin,
  registerCopilotPlugin,
  pluginId,
} from './platform.js';
import { ensureDir, linkOrCopyDir, linkOrCopyFile } from './fs-helpers.js';
import {
  findSkill,
  findAgent,
  findMcp,
  findBundle,
  findPlugin,
  loadBundleConfig,
  loadMcpConfig,
  loadPluginManifest,
  detectPluginFormats,
  parseFrontmatter,
} from './catalog.js';
import { readLock, writeLock, recordInstall } from './lock.js';
import { fetchExternalResources } from './sources.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig, scanPluginDir, formatReport } from './scanner.js';

export interface InstallOptions {
  force?: boolean;
  bundleName?: string;
  verbose?: boolean;
  /**
   * Override which native tool targets a plugin installs into, regardless of
   * what its manifests declare. Useful when a user wants to force a Claude-format
   * plugin into Copilot (most formats are cross-compatible in practice).
   * Example: ['claude', 'copilot'] or ['claude', 'codex', 'copilot', 'cursor']
   */
  targets?: Array<'claude' | 'codex' | 'copilot' | 'cursor'>;
}

export type LogFn = (msg: string) => void;

interface ExternalResourcesLike {
  skills: CatalogEntry[];
  agents: CatalogEntry[];
  mcps: CatalogEntry[];
  bundles: CatalogEntry[];
  plugins: CatalogEntry[];
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
  type: 'skill' | 'agent' | 'mcp' | 'plugin',
  name: string,
  installOpts: InstallOptions,
  log: LogFn,
): InstallResult {
  const externalEntry =
    type === 'skill' ? external.skills.find(item => item.source === sourceName && item.name === name) :
    type === 'agent' ? external.agents.find(item => item.source === sourceName && item.name === name) :
    type === 'plugin' ? external.plugins.find(item => item.source === sourceName && item.name === name) :
    external.mcps.find(item => item.source === sourceName && item.name === name);

  if (externalEntry?.path && externalEntry.hash) {
    if (type === 'skill') {
      return installExternalSkill(sourceName, name, externalEntry.path, externalEntry.hash, installOpts, log);
    }
    if (type === 'agent') {
      return installExternalAgent(sourceName, name, externalEntry.path, externalEntry.hash, installOpts, log);
    }
    if (type === 'plugin') {
      return installExternalPluginEntry(externalEntry, installOpts, log);
    }
    return installExternalMcp(sourceName, name, externalEntry.path, externalEntry.hash, installOpts, log);
  }

  if (type === 'skill') return installSkill(catalog, name, installOpts, log);
  if (type === 'agent') return installAgent(catalog, name, installOpts, log);
  if (type === 'plugin') return installPlugin(catalog, name, installOpts, log);
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

  let mcpConfig;
  try {
    mcpConfig = JSON.parse(fs.readFileSync(src, 'utf8'));
  } catch {
    throw new Error(`Failed to parse MCP config: ${src}`);
  }

  const report = scanMcpConfig({
    name: mcpName,
    type: mcpConfig.type,
    url: mcpConfig.url,
    command: mcpConfig.command,
    args: mcpConfig.args,
    env: mcpConfig.env,
    envVars: mcpConfig.envVars,
    httpHeaders: mcpConfig.httpHeaders,
    envHttpHeaders: mcpConfig.envHttpHeaders,
  }, sourceName);
  if (!report.passed && !opts.force) {
    log(formatReport(report));
    log(`      Skipped — use --force to override`);
    return { type: 'mcp', name: mcpName, action: 'blocked' };
  }
  if (report.findings.length > 0) log(formatReport(report));

  const newEntry = {
    type: mcpConfig.type,
    url: mcpConfig.url,
    command: mcpConfig.command,
    args: mcpConfig.args,
    env: mcpConfig.env,
    envVars: mcpConfig.envVars,
    cwd: mcpConfig.cwd,
    bearerTokenEnvVar: mcpConfig.bearerTokenEnvVar,
    httpHeaders: mcpConfig.httpHeaders,
    envHttpHeaders: mcpConfig.envHttpHeaders,
    startupTimeoutSec: mcpConfig.startupTimeoutSec,
    toolTimeoutSec: mcpConfig.toolTimeoutSec,
    enabled: mcpConfig.enabled,
    required: mcpConfig.required,
    enabledTools: mcpConfig.enabledTools,
    disabledTools: mcpConfig.disabledTools,
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

/** Install an MCP server by name from the catalog. */
export function installMcp(
  catalog: Catalog,
  name: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  const entry = findMcp(catalog, name);
  if (!entry) throw new Error(`MCP not found in catalog: ${name}`);

  const mcpConfig = loadMcpConfig(entry);

  const report = scanMcpConfig({
    name,
    type: mcpConfig.type,
    url: mcpConfig.url,
    command: mcpConfig.command,
    args: mcpConfig.args,
    env: mcpConfig.env,
    envVars: mcpConfig.envVars,
    httpHeaders: mcpConfig.httpHeaders,
    envHttpHeaders: mcpConfig.envHttpHeaders,
  }, entry.source);
  if (!report.passed && !opts.force) {
    log(formatReport(report));
    log(`      Skipped — use --force to override`);
    return { type: 'mcp', name, action: 'blocked' };
  }
  if (report.findings.length > 0) log(formatReport(report));

  const newEntry = {
    type: mcpConfig.type,
    url: mcpConfig.url,
    command: mcpConfig.command,
    args: mcpConfig.args,
    env: mcpConfig.env,
    envVars: mcpConfig.envVars,
    cwd: mcpConfig.cwd,
    bearerTokenEnvVar: mcpConfig.bearerTokenEnvVar,
    httpHeaders: mcpConfig.httpHeaders,
    envHttpHeaders: mcpConfig.envHttpHeaders,
    startupTimeoutSec: mcpConfig.startupTimeoutSec,
    toolTimeoutSec: mcpConfig.toolTimeoutSec,
    enabled: mcpConfig.enabled,
    required: mcpConfig.required,
    enabledTools: mcpConfig.enabledTools,
    disabledTools: mcpConfig.disabledTools,
  };
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
  for (const pluginName of bundle.plugins || []) {
    results.push(installBundleEntry(catalog, external, sourceName, 'plugin', pluginName, installOpts, log));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Install a plugin — speaks each tool's native format
// ---------------------------------------------------------------------------

/** Install a plugin by name from the catalog. */
export function installPlugin(
  catalog: Catalog,
  name: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  const entry = findPlugin(catalog, name);
  if (!entry) throw new Error(`Plugin not found in catalog: ${name}`);
  return installExternalPluginEntry(entry, opts, log);
}

/**
 * Install a plugin from an external source cache using the catalog entry.
 * This is the preferred signature since it carries marketplace + formats + version.
 */
export function installExternalPluginEntry(
  entry: CatalogEntry,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  return installExternalPlugin(
    entry.source,
    entry.name,
    entry.path,
    entry.hash,
    opts,
    log,
    {
      marketplace: entry.marketplace,
      formats: entry.formats,
      version: entry.version,
    },
  );
}

interface PluginInstallContext {
  marketplace?: string;
  formats?: PluginFormats;
  version?: string;
}

/**
 * Install a plugin from an external source cache. Detects which native tool
 * formats the plugin supports and copies/registers into each one using that
 * tool's real on-disk format. Skips tools whose format isn't present.
 */
export function installExternalPlugin(
  sourceName: string,
  pluginName: string,
  pluginPath: string,
  hash: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
  ctx: PluginInstallContext = {},
): InstallResult {
  assertSafePathSegment(pluginName, 'plugin name');
  const src = path.join(CACHE_DIR, sourceName, pluginPath);
  if (!fs.existsSync(src)) throw new Error(`External plugin not found at: ${src}`);

  const report = scanPluginDir(src, pluginName, sourceName);
  if (!report.passed && !opts.force) {
    log(formatReport(report));
    log(`      Skipped — use --force to override`);
    return { type: 'plugin', name: pluginName, action: 'blocked' };
  }
  if (report.findings.length > 0) log(formatReport(report));

  const marketplace = ctx.marketplace || sourceName;
  const manifest = loadPluginManifest(src);
  const version = ctx.version || manifest.version || 'unknown';
  const formats = { ...(ctx.formats || detectPluginFormats(src)) };
  if (opts.targets && opts.targets.length > 0) {
    // --target flag replaces detected formats entirely
    formats.claude = opts.targets.includes('claude');
    formats.codex = opts.targets.includes('codex');
    formats.copilot = opts.targets.includes('copilot');
    formats.cursor = opts.targets.includes('cursor');
  }

  const lock = readLock();
  const itemKey = `plugin:${pluginName}@${marketplace}`;
  const lockEntry = lock.installed[itemKey];
  const needsUpdate = lockEntry && lockEntry.hash !== hash;
  const shouldForce = opts.force || needsUpdate || false;

  const installedTo: string[] = [];
  if (formats.claude) {
    installPluginToClaude(src, pluginName, marketplace, version, shouldForce, log);
    installedTo.push('Claude');
  }
  if (formats.codex) {
    installPluginToCodex(src, pluginName, marketplace, shouldForce, log);
    installedTo.push('Codex');
  }
  if (formats.copilot) {
    installPluginToCopilot(src, pluginName, marketplace, version, shouldForce, log);
    installedTo.push('Copilot');
  }
  if (formats.cursor) {
    installPluginToCursor(src, pluginName, shouldForce, log);
    installedTo.push('Cursor');
  }

  if (installedTo.length === 0) {
    log(`  [!] plugin ${pluginName} has no recognized native manifest — skipped`);
    return { type: 'plugin', name: pluginName, action: 'skipped' };
  }

  log(`  [+] plugin ${pluginName}@${marketplace} installed to: ${installedTo.join(', ')}`);

  recordInstall(lock, itemKey, hash, opts.bundleName);
  writeLock(lock);
  return { type: 'plugin', name: pluginName, action: lockEntry ? 'updated' : 'installed' };
}

// --- Per-tool installers (private) ---

function installPluginToClaude(
  src: string,
  pluginName: string,
  marketplace: string,
  version: string,
  force: boolean,
  log: LogFn,
): void {
  // Matches Claude's observed cache layout: ~/.claude/plugins/cache/<mkt>/<plugin>/<version>/
  const dest = path.join(CLAUDE_PLUGIN_CACHE, marketplace, pluginName, version);
  ensureDir(path.dirname(dest));
  linkOrCopyDir(src, dest, force, true);

  registerClaudeInstalledPlugin({
    marketplace,
    pluginName,
    version,
    installPath: dest,
  });
  enableClaudePlugin(marketplace, pluginName);
  log(`  [+] Claude: ${pluginId(pluginName, marketplace)} -> ${dest}`);
}

function installPluginToCodex(
  src: string,
  pluginName: string,
  marketplace: string,
  force: boolean,
  log: LogFn,
): void {
  // Codex install path per docs: ~/.codex/plugins/<mkt>/<plugin>/
  const dest = path.join(CODEX_PLUGINS_DIR, marketplace, pluginName);
  ensureDir(path.dirname(dest));
  linkOrCopyDir(src, dest, force, true);

  registerCodexPlugin(marketplace, pluginName, true);
  log(`  [+] Codex: ${pluginId(pluginName, marketplace)} -> ${dest}`);
}

function installPluginToCopilot(
  src: string,
  pluginName: string,
  marketplace: string,
  version: string,
  force: boolean,
  log: LogFn,
): void {
  // Copilot observed layout: ~/.copilot/installed-plugins/<mkt>/<plugin>/ (no version subdir)
  const dest = path.join(COPILOT_INSTALLED_PLUGINS_DIR, marketplace, pluginName);
  ensureDir(path.dirname(dest));
  linkOrCopyDir(src, dest, force, true);

  registerCopilotPlugin({
    marketplace,
    pluginName,
    version,
    cachePath: dest,
  });
  log(`  [+] Copilot: ${pluginId(pluginName, marketplace)} -> ${dest}`);
}

function installPluginToCursor(
  src: string,
  pluginName: string,
  force: boolean,
  log: LogFn,
): void {
  // Cursor: filesystem only (no documented registry). ~/.cursor/plugins/<name>/
  const dest = path.join(CURSOR_PLUGINS_DIR, pluginName);
  ensureDir(path.dirname(dest));
  linkOrCopyDir(src, dest, force, true);
  log(`  [+] Cursor: ${pluginName} -> ${dest}`);
}
