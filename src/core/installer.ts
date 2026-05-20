import fs from 'fs';
import path from 'path';
import type { Catalog, CatalogEntry, InstallResult, McpConfigFile, McpServerEntry, PluginContents } from '../types.js';
import {
  CODEX_AGENT_TARGET,
  CLAUDE_NATIVE_SOURCE,
  CODEX_NATIVE_SOURCE,
  COPILOT_NATIVE_SOURCE,
  getConfigFormat,
  getSourceRoot,
  getToolTargets,
  getWritableAgentTargets,
  getWritableCommandTargets,
  getWritableMcpConfigFiles,
  getWritableSkillTargets,
  isToolSelected,
  labelForTool,
  writeCodexMcpServer,
  assertSafePathSegment,
  type CommandTarget,
  type ToolId,
} from './platform.js';
import { installClaudePlugin, installCodexPlugin, installCopilotPlugin } from './claude-plugins.js';
import { ensureDir, linkOrCopyDir, linkOrCopyFile } from './fs-helpers.js';
import { shouldInstallWithSymlink } from './settings.js';
import {
  findSkill,
  findAgent,
  findMcp,
  findBundle,
  findCommand,
  findPlugin,
  loadBundleConfig,
  loadMcpConfig,
  loadPluginManifest,
  readPluginContents,
  parseFrontmatter,
  stripFrontmatter,
  hashFile,
  hashDir,
} from './catalog.js';
import { readLock, writeLock, recordInstall } from './lock.js';
import { fetchExternalResources, extractMcpServers } from './sources.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig, scanCommandFile, formatReport } from './scanner.js';

export interface InstallOptions {
  force?: boolean;
  bundleName?: string;
  /**
   * Lock parent key for sub-installs (e.g. `plugin:my-plugin`). When set, the
   * `recordInstall` call nests the item under this parent in the lock instead
   * of writing a top-level entry. Used by the plugin installer to track
   * decomposed components for clean removal.
   */
  parentKey?: string;
  verbose?: boolean;
  /**
   * Opt-in hard-fail mode for CI and automation. When true, any scan finding
   * with 'block' severity aborts the install with action: 'blocked'. When
   * false (the default) we always proceed — warnings surface through the log
   * callback and the caller decides whether to show them to the user. The TUI
   * adds its own consent dialog on top; headless users who typed the command
   * are treated as having already consented.
   */
  strict?: boolean;
  /** Override the saved install mode. True symlinks resources; false copies bytes. */
  link?: boolean;
  /**
   * Tool IDs to exclude from per-component decompose targets. Set by the
   * plugin installer for tools that own a native plugin registry (Claude
   * Code, GitHub Copilot) so the user-level skill/agent/command dirs aren't
   * also written — otherwise the same item shows up twice in the host UI
   * (once as a user-level customization, once under the plugin entry).
   */
  excludeTools?: Set<ToolId>;
}

export type LogFn = (msg: string) => void;

/**
 * Build the "why" suffix for a no-target skip. If the install is running under
 * a plugin decompose (excludeTools is non-empty), the user-level dirs for
 * those tools are intentionally suppressed because the plugin tree already
 * exposes the item — so a bare "no supported target apps detected" misleads
 * the user into thinking nothing happened. Spell it out instead.
 */
function explainNoTargets(excludeTools?: Set<ToolId>): string {
  if (excludeTools && excludeTools.size > 0) {
    const labels = [...excludeTools].map(labelForTool).sort();
    return `plugin tree owns it in ${labels.join(', ')} (decomposed copy suppressed to avoid duplicate)`;
  }
  return 'no supported target apps detected';
}

interface ExternalResourcesLike {
  skills: CatalogEntry[];
  agents: CatalogEntry[];
  mcps: CatalogEntry[];
  bundles: CatalogEntry[];
  commands: CatalogEntry[];
}

function renderCodexAgent(agentPath: string): { name: string; description: string; content: string } {
  const source = fs.readFileSync(agentPath, 'utf8');
  const meta = parseFrontmatter(source);
  const name = assertSafePathSegment(meta.name || path.basename(agentPath, '.agent.md'), 'agent name');
  const description = meta.description || '';
  const developerInstructions = stripFrontmatter(source).trim();
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
): { action: InstallResult['action']; targetCount: number } {
  const configsToWrite = getWritableMcpConfigFiles(opts.excludeTools);
  if (configsToWrite.length === 0) {
    log(`  [skip] mcp ${mcpName}: ${explainNoTargets(opts.excludeTools)}`);
    return { action: 'skipped', targetCount: 0 };
  }

  let action: InstallResult['action'] = 'skipped';
  for (const configPath of configsToWrite) {
    const existedBefore = fs.existsSync(configPath);
    ensureDir(path.dirname(configPath));

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
      if (existedBefore) {
        log(`  [!] Could not parse ${configPath}, skipping`);
        continue;
      }
      config = {};
    }

    // Amp uses "amp.mcpServers" as a dotted key in its settings.json
    const section = format === 'amp-mcp' ? 'amp.mcpServers'
      : format === 'servers' ? 'servers'
      : 'mcpServers';
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

  return { action, targetCount: configsToWrite.length };
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
  type: 'skill' | 'agent' | 'mcp' | 'command',
  name: string,
  installOpts: InstallOptions,
  log: LogFn,
): InstallResult {
  const externalEntry =
    type === 'skill' ? external.skills.find(item => item.source === sourceName && item.name === name) :
    type === 'agent' ? external.agents.find(item => item.source === sourceName && item.name === name) :
    type === 'command' ? external.commands.find(item => item.source === sourceName && item.name === name) :
    external.mcps.find(item => item.source === sourceName && item.name === name);

  if (externalEntry?.path && externalEntry.hash) {
    if (type === 'skill') {
      return installExternalSkill(sourceName, name, externalEntry.path, externalEntry.hash, installOpts, log);
    }
    if (type === 'agent') {
      return installExternalAgent(sourceName, name, externalEntry.path, externalEntry.hash, installOpts, log);
    }
    if (type === 'command') {
      return installExternalCommand(sourceName, name, externalEntry.path, externalEntry.hash, installOpts, log);
    }
    return installExternalMcp(sourceName, name, externalEntry.path, externalEntry.hash, installOpts, log);
  }

  if (type === 'skill') return installSkill(catalog, name, installOpts, log);
  if (type === 'agent') return installAgent(catalog, name, installOpts, log);
  if (type === 'command') return installCommand(catalog, name, installOpts, log);
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
  const src = path.join(getSourceRoot(sourceName), skillPath);
  if (!fs.existsSync(src)) throw new Error(`External skill not found at: ${src}`);

  // Security scan (external sources always scanned)
  const report = scanSkillDir(src, skillName, sourceName);
  if (!report.passed && opts.strict) {
    log(formatReport(report));
    log(`      Blocked by --strict. Remove the flag to proceed at your own risk.`);
    return { type: 'skill', name: skillName, action: 'blocked' };
  }
  if (report.findings.length > 0) log(formatReport(report));

  const lock = readLock();
  const itemKey = `skill:${skillName}`;

  const lockEntry = lock.installed[itemKey];
  const needsUpdate = lockEntry && lockEntry.hash !== hash;
  const shouldForce = opts.force || needsUpdate;

  const targets = getWritableSkillTargets(opts.excludeTools);
  if (targets.length === 0) {
    log(`  [skip] skill ${skillName}: ${explainNoTargets(opts.excludeTools)}`);
    return { type: 'skill', name: skillName, action: 'skipped' };
  }

  const useSymlink = shouldInstallWithSymlink(opts.link);
  let action: InstallResult['action'] = 'skipped';
  for (const dir of targets) {
    const dest = path.join(dir, skillName);
    const result = linkOrCopyDir(src, dest, shouldForce || false, !useSymlink);
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

  recordInstall(lock, itemKey, hash, opts.parentKey);
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
  const src = path.join(getSourceRoot(sourceName), agentPath);
  if (!fs.existsSync(src)) throw new Error(`External agent not found at: ${src}`);

  const report = scanAgentFile(src, agentName, sourceName);
  if (!report.passed && opts.strict) {
    log(formatReport(report));
    log(`      Blocked by --strict. Remove the flag to proceed at your own risk.`);
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

  const agentTargets = getWritableAgentTargets(opts.excludeTools);
  const fileTargets = agentTargets.filter(dir => dir !== CODEX_AGENT_TARGET);
  const shouldWriteCodex = agentTargets.includes(CODEX_AGENT_TARGET);
  if (fileTargets.length === 0 && !shouldWriteCodex) {
    log(`  [skip] agent ${agentName}: ${explainNoTargets(opts.excludeTools)}`);
    return { type: 'agent', name: agentName, action: 'skipped' };
  }

  const useSymlink = shouldInstallWithSymlink(opts.link);
  let action: InstallResult['action'] = 'skipped';
  for (const dir of fileTargets) {
    const dest = path.join(dir, filename);
    const result = linkOrCopyFile(src, dest, shouldForce || false, !useSymlink);
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

  if (shouldWriteCodex) {
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
  }

  recordInstall(lock, itemKey, hash, opts.parentKey);
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
  // mcpName becomes a JSON key and a TOML section name — validate defensively
  // even though the catalog path already sanitizes at parse time. An attacker
  // can't reach this code without writing to sources.json, but cheap insurance.
  assertSafePathSegment(mcpName, 'mcp name');
  const src = path.join(getSourceRoot(sourceName), mcpPath);
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
  if (!report.passed && opts.strict) {
    log(formatReport(report));
    log(`      Blocked by --strict. Remove the flag to proceed at your own risk.`);
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
  const { action, targetCount } = writeMcpToConfigs(mcpName, newEntry, opts, log);
  if (targetCount === 0) return { type: 'mcp', name: mcpName, action };

  recordInstall(lock, itemKey, hash, opts.parentKey);
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
// Install a command (slash prompt) — verbatim for Claude/Cursor, transformed
// for VS Code's *.prompt.md user prompts
// ---------------------------------------------------------------------------

/**
 * Render a `*.prompt.md` source as a VS Code user prompt: rewrite frontmatter
 * to `{mode: agent, description: ...}` (description JSON-stringified to safely
 * carry colons and quotes), and substitute `$ARGUMENTS` with `${input:topic:<hint>}`
 * when an argument-hint is set.
 */
function renderVsCodePrompt(source: string): string {
  const meta = parseFrontmatter(source);
  const description = meta.description || '';
  const hint = meta['argument-hint'] || '';

  const body = stripFrontmatter(source);

  const useHint = hint && hint !== '<empty>';
  const transformedBody = useHint
    ? body.replace(/\$ARGUMENTS/g, `\${input:topic:${hint}}`)
    : body;

  const frontmatter = [
    '---',
    'mode: agent',
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
  ].join('\n');

  return frontmatter + transformedBody;
}

/**
 * Write or update a single command file in one target. Returns the action
 * the caller should report. Hashing is done on the source file, so a
 * transformed VS Code prompt that diffs from the source still tracks
 * correctly via the lock.
 */
function writeCommandToTarget(
  target: CommandTarget,
  src: string,
  commandName: string,
  shouldForce: boolean,
  useSymlink: boolean,
  log: LogFn,
): InstallResult['action'] {
  const filename = target.format === 'vscode-prompt' ? `${commandName}.prompt.md` : `${commandName}.md`;
  const dest = path.join(target.dir, filename);

  if (target.format === 'verbatim') {
    const result = linkOrCopyFile(src, dest, shouldForce, !useSymlink);
    if (result === 'updated') {
      log(`  [~] command ${commandName} updated in ${dest}`);
      return 'updated';
    }
    if (result === 'installed') {
      log(`  [+] command ${commandName} -> ${dest}`);
      return 'installed';
    }
    log(`  [OK] command ${commandName} (up to date)`);
    return 'skipped';
  }

  // vscode-prompt: write transformed bytes; idempotent on byte-equal.
  const sourceText = fs.readFileSync(src, 'utf8');
  const rendered = renderVsCodePrompt(sourceText);
  ensureDir(target.dir);
  let existing: string | null;
  try {
    existing = fs.readFileSync(dest, 'utf8');
  } catch {
    existing = null;
  }
  if (existing !== null && !shouldForce && existing === rendered) {
    log(`  [OK] command ${commandName} (up to date)`);
    return 'skipped';
  }
  fs.writeFileSync(dest, rendered, 'utf8');
  if (existing !== null) {
    log(`  [~] command ${commandName} updated in ${dest}`);
    return 'updated';
  }
  log(`  [+] command ${commandName} -> ${dest}`);
  return 'installed';
}

/** Install a command by name from the catalog. */
export function installCommand(
  catalog: Catalog,
  name: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  const entry = findCommand(catalog, name);
  if (!entry) throw new Error(`Command not found in catalog: ${name}`);
  return installExternalCommand(entry.source, name, entry.path, entry.hash, opts, log);
}

/** Install a command from an external source cache. Writes verbatim to Claude/Cursor and a transformed prompt to VS Code. */
export function installExternalCommand(
  sourceName: string,
  commandName: string,
  commandPath: string,
  hash: string,
  opts: InstallOptions = {},
  log: LogFn = console.log,
): InstallResult {
  assertSafePathSegment(commandName, 'command name');
  const src = path.join(getSourceRoot(sourceName), commandPath);
  if (!fs.existsSync(src)) throw new Error(`External command not found at: ${src}`);

  const report = scanCommandFile(src, commandName, sourceName);
  if (!report.passed && opts.strict) {
    log(formatReport(report));
    log(`      Blocked by --strict. Remove the flag to proceed at your own risk.`);
    return { type: 'command', name: commandName, action: 'blocked' };
  }
  if (report.findings.length > 0) log(formatReport(report));

  const lock = readLock();
  const itemKey = `command:${commandName}`;

  const lockEntry = lock.installed[itemKey];
  const needsUpdate = lockEntry && lockEntry.hash !== hash;
  const shouldForce = opts.force || needsUpdate || false;

  const targets = getWritableCommandTargets(opts.excludeTools);
  if (targets.length === 0) {
    log(`  [skip] command ${commandName}: ${explainNoTargets(opts.excludeTools)}`);
    return { type: 'command', name: commandName, action: 'skipped' };
  }

  const useSymlink = shouldInstallWithSymlink(opts.link);
  let action: InstallResult['action'] = 'skipped';
  for (const target of targets) {
    const result = writeCommandToTarget(target, src, commandName, shouldForce, useSymlink, log);
    if (result === 'installed') action = 'installed';
    else if (result === 'updated' && action !== 'installed') action = 'updated';
  }

  recordInstall(lock, itemKey, hash, opts.parentKey);
  writeLock(lock);
  return { type: 'command', name: commandName, action };
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
  for (const commandName of bundle.commands || []) {
    results.push(installBundleEntry(catalog, external, sourceName, 'command', commandName, installOpts, log));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Install a Claude Code plugin (decompose into native components per tool)
// ---------------------------------------------------------------------------

/**
 * Pre-create a `plugin:<name>` lock entry with empty `items` so sub-installs
 * can nest under it via `recordInstall(..., parentKey)`. Mirrors `initBundleLock`.
 */
/**
 * Remove any per-user files in excluded tools' dirs that match the plugin's
 * components. Cleans up duplicates left over from earlier toolkit versions
 * that decompose-installed into every detected tool — including ones that
 * now own the plugin via a native registry.
 *
 * Best-effort: missing files are normal (most components were never
 * decomposed there in the first place); only surfaces removals via log.
 */
function purgeExcludedToolFiles(
  pluginName: string,
  contents: PluginContents,
  excludeTools: ReadonlySet<ToolId>,
  log: LogFn,
): void {
  if (excludeTools.size === 0) return;
  for (const toolId of excludeTools) {
    const targets = getToolTargets(toolId);
    for (const skill of contents.skills) {
      if (!targets.skillDir) continue;
      const dest = path.join(targets.skillDir, skill.name);
      if (fs.existsSync(dest)) {
        try {
          fs.rmSync(dest, { recursive: true, force: true });
          log(`  [-] plugin ${pluginName}: cleaned stale ${toolId} skill at ${dest}`);
        } catch { /* best-effort */ }
      }
    }
    for (const agent of contents.agents) {
      if (!targets.agentDir) continue;
      // Plugins ship agents either as `<name>.agent.md` or plain `<name>.md`;
      // older toolkit installs may have written either filename, so try both.
      for (const filename of [path.basename(agent.absPath), `${agent.name}.agent.md`, `${agent.name}.md`]) {
        const dest = path.join(targets.agentDir, filename);
        if (fs.existsSync(dest)) {
          try {
            fs.unlinkSync(dest);
            log(`  [-] plugin ${pluginName}: cleaned stale ${toolId} agent at ${dest}`);
          } catch { /* best-effort */ }
        }
      }
    }
    for (const command of contents.commands) {
      for (const target of targets.commandTargets) {
        const filename = target.format === 'vscode-prompt' ? `${command.name}.prompt.md` : `${command.name}.md`;
        const dest = path.join(target.dir, filename);
        if (fs.existsSync(dest)) {
          try {
            fs.unlinkSync(dest);
            log(`  [-] plugin ${pluginName}: cleaned stale ${toolId} command at ${dest}`);
          } catch { /* best-effort */ }
        }
      }
    }
  }
}

function initPluginLock(pluginName: string, pluginHash: string): void {
  const lock = readLock();
  lock.installed[`plugin:${pluginName}`] = {
    hash: pluginHash,
    installedAt: new Date().toISOString(),
    items: {},
  };
  writeLock(lock);
}

/** Install a plugin by name from the catalog (looks up source, decomposes, installs each component). */
export function installPlugin(
  catalog: Catalog,
  name: string,
  opts: Omit<InstallOptions, 'parentKey'> = {},
  log: LogFn = console.log,
): InstallResult[] {
  const entry = findPlugin(catalog, name);
  if (!entry) throw new Error(`Plugin not found in catalog: ${name}`);
  return installExternalPlugin(entry.source, name, entry.path, entry.hash, opts, log);
}

/**
 * Install a plugin from an external source cache. The plugin manifest may be
 * either Claude Code's `.claude-plugin/plugin.json` or a generic top-level
 * `plugin.json`. Decomposes the plugin into its components (skills, agents,
 * commands, MCP servers) and installs each into every detected provider's
 * native on-disk format via the existing per-type installers, recording all
 * items under a single `plugin:<name>` lock entry so removal is atomic.
 *
 * Hooks (`hooks/hooks.json`) are detected and **refused** — they execute
 * arbitrary commands and have no scanner coverage yet. The plugin still
 * installs its safe components; the user is told a hooks file was skipped.
 */
export function installExternalPlugin(
  sourceName: string,
  pluginName: string,
  pluginPath: string,
  hash: string,
  opts: Omit<InstallOptions, 'parentKey'> = {},
  log: LogFn = console.log,
): InstallResult[] {
  assertSafePathSegment(pluginName, 'plugin name');
  const pluginDir = path.join(getSourceRoot(sourceName), pluginPath);
  if (!fs.existsSync(pluginDir)) throw new Error(`External plugin not found at: ${pluginDir}`);

  // Read manifest just to fail fast on a malformed plugin.
  loadPluginManifest(pluginDir);
  const contents = readPluginContents(pluginDir);

  log(`\nInstalling plugin: ${pluginName}`);
  initPluginLock(pluginName, hash);

  // Tools that already get this plugin via their own native plugin registry
  // must not also receive the decomposed components in their per-user
  // skill/agent/command dirs — otherwise the host UI shows each item twice
  // (once as a user customization, once under the plugin entry).
  //
  // Two trigger conditions:
  //   - synthetic source: the plugin already lives in that tool's native
  //     plugin cache (claude / copilot), and is discovered from there.
  //   - copilot is selected: `installCopilotPlugin` below copies the tree
  //     into Copilot's installed-plugins dir and registers it in config.
  const excludeTools = new Set<ToolId>(opts.excludeTools);
  if (sourceName === CLAUDE_NATIVE_SOURCE || isToolSelected('claude')) excludeTools.add('claude');
  if (sourceName === CODEX_NATIVE_SOURCE || isToolSelected('codex')) excludeTools.add('codex');
  if (sourceName === COPILOT_NATIVE_SOURCE || isToolSelected('copilot')) excludeTools.add('copilot');

  // Migration cleanup. Earlier toolkit versions decompose-installed plugin
  // components into every detected tool's user dirs (~/.copilot/agents/,
  // ~/.claude/agents/, etc.). Now those dirs are excluded for Claude/Copilot,
  // but stale files from the old behavior remain on disk and surface as
  // "User" duplicates next to the plugin's own copy in the host UI. Sweep
  // them up before installing fresh.
  purgeExcludedToolFiles(pluginName, contents, excludeTools, log);

  const parentKey = `plugin:${pluginName}`;
  const subOpts: InstallOptions = { ...opts, parentKey, excludeTools };
  const results: InstallResult[] = [];

  // Plugin installs typically skip every decomposed sub-item (the plugin tree
  // owns them) with the same reason text. Echoing 25 near-identical `[skip]`
  // lines to stdout drowns out the actual install activity, so collapse them
  // here: intercept per-item skip messages, count them by type + reason, and
  // emit one summary line per unique reason at the end. Non-skip lines pass
  // through unchanged.
  const skipBuckets = new Map<string, Map<string, number>>();
  const skipPattern = /^\s*\[skip\]\s+(\w+)\s+[\w@.\-/]+:\s*(.+?)\s*$/;
  const collapsingLog: LogFn = (msg: string) => {
    const m = msg.match(skipPattern);
    if (!m) {
      log(msg);
      return;
    }
    const [, type, reason] = m;
    let typeCounts = skipBuckets.get(reason);
    if (!typeCounts) { typeCounts = new Map(); skipBuckets.set(reason, typeCounts); }
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  };

  for (const skill of contents.skills) {
    const skillRel = path.relative(getSourceRoot(sourceName), skill.absPath);
    const skillHash = hashDir(skill.absPath);
    results.push(installExternalSkill(sourceName, skill.name, skillRel, skillHash, subOpts, collapsingLog));
  }

  for (const agent of contents.agents) {
    const agentRel = path.relative(getSourceRoot(sourceName), agent.absPath);
    const agentHash = hashFile(agent.absPath);
    results.push(installExternalAgent(sourceName, agent.name, agentRel, agentHash, subOpts, collapsingLog));
  }

  for (const command of contents.commands) {
    const commandRel = path.relative(getSourceRoot(sourceName), command.absPath);
    const commandHash = hashFile(command.absPath);
    results.push(installExternalCommand(sourceName, command.name, commandRel, commandHash, subOpts, collapsingLog));
  }

  for (const mcpFile of contents.mcpConfigs) {
    const mcpRel = path.relative(getSourceRoot(sourceName), mcpFile.absPath);
    const mcpHash = hashFile(mcpFile.absPath);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(mcpFile.absPath, 'utf8'));
    } catch {
      log(`  [!] plugin ${pluginName}: malformed MCP config at ${mcpRel}, skipping`);
      continue;
    }
    for (const [serverName] of extractMcpServers(raw)) {
      try {
        results.push(installExternalMcp(sourceName, serverName, mcpRel, mcpHash, subOpts, collapsingLog));
      } catch (e: unknown) {
        log(`  [!] plugin ${pluginName}: mcp ${serverName} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Flush the accumulated per-item skip lines as one summary line per reason.
  // Plural-aware so "1 skill" vs "16 skills" reads naturally.
  for (const [reason, typeCounts] of skipBuckets) {
    const parts = [...typeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => `${n} ${type}${n > 1 ? 's' : ''}`);
    log(`  [skip] ${parts.join(', ')}: ${reason}`);
  }

  if (contents.hasHooks) {
    // Hooks ride along with the plugin tree (copied by copyPluginTreeScoped
    // into the native plugin caches). They are scoped to the plugin's
    // lifecycle and disappear when the plugin is removed, so the security
    // posture is "remove-the-plugin-to-revert" rather than the more
    // dangerous "edit the user's settings.json directly."
    log(`  [+] plugin ${pluginName}: hooks/hooks.json detected — included in plugin tree (active under the plugin's own scope).`);
  }

  // Native Copilot registration. Decomposed-install lands the components
  // in ~/.copilot/skills/ and ~/.copilot/agents/ where Copilot picks them
  // up, but Copilot's own "Plugins" UI reads its plugin registry. Without
  // this step, the plugin shows up everywhere except Copilot's plugin
  // panel. Mirror of `uninstallCopilotPlugin` which runs on remove.
  if (isToolSelected('copilot')) {
    try {
      const manifest = loadPluginManifest(pluginDir);
      const native = installCopilotPlugin(pluginName, pluginDir, manifest, contents);
      if (native.copiedTo) {
        log(`  [+] plugin ${pluginName} -> ${native.copiedTo} (Copilot native install)`);
      }
      if (native.registeredInConfig) {
        log(`  [${native.replacedExistingConfig ? '~' : '+'}] plugin ${pluginName} ${native.replacedExistingConfig ? 'updated in' : 'registered in'} Copilot config`);
      }
      if (native.enabledInSettings) {
        log(`  [+] plugin ${pluginName} enabled in Copilot settings`);
      }
    } catch (e: unknown) {
      log(`  [!] plugin ${pluginName}: Copilot native registration failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Native Codex registration. Codex loads plugins from
  // ~/.codex/plugins/cache/<marketplace>/<name>/<version>/ and enables them
  // through ~/.codex/config.toml. Going native keeps plugin-scoped resources
  // out of the standalone ~/.agents and ~/.codex/agents dirs.
  if (isToolSelected('codex')) {
    try {
      const manifest = loadPluginManifest(pluginDir);
      const native = installCodexPlugin(pluginName, pluginDir, manifest, contents);
      if (native.copiedTo) {
        log(`  [+] plugin ${pluginName} -> ${native.copiedTo} (Codex native install)`);
      }
      if (native.registeredMarketplace) {
        log(`  [+] plugin ${pluginName} registered Codex toolkit-ai marketplace`);
      }
      if (native.enabledInConfig) {
        log(`  [+] plugin ${pluginName} enabled in Codex config`);
      }
    } catch (e: unknown) {
      log(`  [!] plugin ${pluginName}: Codex native registration failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Native Claude registration. Same motivation as Copilot above: Claude's
  // own UI surfaces installed plugins through ~/.claude/plugins/installed_plugins.json,
  // and Copilot's "Agent Customizations" UI reads ~/.claude/agents/ for
  // cross-tool compat. Going native on both prevents the same agent
  // appearing twice (once as a "user" customization in Copilot, once
  // under the plugin entry).
  if (isToolSelected('claude')) {
    try {
      const manifest = loadPluginManifest(pluginDir);
      const native = installClaudePlugin(pluginName, pluginDir, manifest, contents);
      if (native.copiedTo) {
        log(`  [+] plugin ${pluginName} -> ${native.copiedTo} (Claude native install)`);
      }
      if (native.registeredInInstalled) {
        log(`  [${native.replacedExistingInstalled ? '~' : '+'}] plugin ${pluginName} ${native.replacedExistingInstalled ? 'updated in' : 'registered in'} Claude installed_plugins.json`);
      }
    } catch (e: unknown) {
      log(`  [!] plugin ${pluginName}: Claude native registration failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return results;
}
