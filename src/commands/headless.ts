import path from 'path';
import type { Catalog, InstallResult } from '../types.js';
import { loadCatalog, loadMcpConfig } from '../core/catalog.js';
import { installSkill, installAgent, installMcp, installPlugin } from '../core/installer.js';
import { removeSkill, removeAgent, removeMcp, removePlugin } from '../core/remover.js';
import { checkForUpdates, updateAll } from '../core/updater.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig, formatReport } from '../core/scanner.js';

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const RESET     = '\x1b[0m';
const BOLD      = '\x1b[1m';
const DIM       = '\x1b[2m';
const GREEN     = '\x1b[32m';
const RED       = '\x1b[31m';
const YELLOW    = '\x1b[33m';

const GRAYS = [
  '\x1b[38;5;250m', '\x1b[38;5;248m', '\x1b[38;5;245m',
  '\x1b[38;5;243m', '\x1b[38;5;240m', '\x1b[38;5;238m',
];

const LOGO_LINES = [
  '████████╗ ██████╗  ██████╗ ██╗     ██╗  ██╗██╗████████╗',
  '╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██║ ██╔╝██║╚══██╔══╝',
  '   ██║   ██║   ██║██║   ██║██║     █████╔╝ ██║   ██║   ',
  '   ██║   ██║   ██║██║   ██║██║     ██╔═██╗ ██║   ██║   ',
  '   ██║   ╚██████╔╝╚██████╔╝███████╗██║  ██╗██║   ██║   ',
  '   ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝   ╚═╝   ',
];

function showLogo() {
  console.log();
  LOGO_LINES.forEach((line, i) => {
    process.stdout.write(`${GRAYS[i]}${line}${RESET}\n`);
  });
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function option(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

// ---------------------------------------------------------------------------
// Summary printer
// ---------------------------------------------------------------------------

function printSummary(results: InstallResult[]) {
  if (results.length === 0) return;
  const installed = results.filter(r => r.action === 'installed');
  const updated   = results.filter(r => r.action === 'updated');
  const skipped   = results.filter(r => r.action === 'skipped');
  const blocked   = results.filter(r => r.action === 'blocked');

  console.log();
  console.log(`${BOLD}${'─'.repeat(50)}${RESET}`);
  console.log(`${BOLD}  Summary${RESET}`);
  console.log(`${BOLD}${'─'.repeat(50)}${RESET}`);
  if (installed.length > 0) {
    console.log(`  ${GREEN}Installed (${installed.length}):${RESET}`);
    for (const r of installed) console.log(`    ${GREEN}+${RESET} ${r.type} ${BOLD}${r.name}${RESET}`);
  }
  if (updated.length > 0) {
    console.log(`  ${YELLOW}Updated (${updated.length}):${RESET}`);
    for (const r of updated) console.log(`    ${YELLOW}~${RESET} ${r.type} ${BOLD}${r.name}${RESET}`);
  }
  if (blocked.length > 0) {
    console.log(`  ${RED}Blocked (${blocked.length}):${RESET}`);
    for (const r of blocked) console.log(`    ${RED}✕${RESET} ${r.type} ${BOLD}${r.name}${RESET}`);
  }
  if (skipped.length > 0) {
    console.log(`  ${DIM}Up to date (${skipped.length}):${RESET}`);
    for (const r of skipped) console.log(`    ${DIM}- ${r.type} ${r.name}${RESET}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function listAll(catalog: Catalog) {
  showLogo();
  console.log();

  console.log(`${BOLD}=== Skills ===${RESET}`);
  for (const s of catalog.skills)
    console.log(`  ${s.name.padEnd(28)} ${DIM}${s.description}${RESET}`);

  console.log(`\n${BOLD}=== Agents ===${RESET}`);
  for (const a of catalog.agents)
    console.log(`  ${a.name.padEnd(28)} ${DIM}${a.description}${RESET}`);

  console.log(`\n${BOLD}=== MCPs ===${RESET}`);
  for (const m of catalog.mcps)
    console.log(`  ${m.name.padEnd(28)} ${DIM}${m.description}${RESET}`);

  console.log(`\n${BOLD}=== Plugins ===${RESET}`);
  for (const p of catalog.plugins)
    console.log(`  ${p.name.padEnd(28)} ${DIM}${p.description}${RESET}`);

  console.log();
}

function showBanner() {
  showLogo();
  console.log();
  console.log(`${DIM}AI Toolkit${RESET}`);
  console.log();
  console.log(`  ${DIM}$${RESET} npx toolkit-ai ${DIM}            Interactive TUI${RESET}`);
  console.log(`  ${DIM}$${RESET} npx toolkit-ai --list ${DIM}     List all available items${RESET}`);
  console.log(`  ${DIM}$${RESET} npx toolkit-ai --help ${DIM}     Full usage info${RESET}`);
  console.log();
}

function usage() {
  console.log(`
${BOLD}Usage:${RESET} ai-toolkit [command] [options]

${BOLD}Interactive:${RESET}
  ${DIM}(no args)${RESET}                       Launch TUI (browse, install, remove, update)

${BOLD}Scaffold:${RESET}
  init [dir]                        Create a boilerplate skill repo

${BOLD}Security:${RESET}
  scan                              Scan all available items for threats
  scan --skill <name>               Scan a specific skill

${BOLD}Updates:${RESET}
  update                          Update all installed items
  check                           Check for available updates
  --force                         Force reinstall (combine with any install)

${BOLD}Direct install:${RESET}
  --list                          List all available items
  --skill <name>                  Install a skill
  --agent <name>                  Install an agent
  --mcp <name>                    Register an MCP server
  --plugin <name>                 Install a plugin bundle

${BOLD}Direct remove:${RESET}
  remove --skill <name>           Remove a skill
  remove --agent <name>           Remove an agent
  remove --mcp <name>             Deregister an MCP server
  remove --plugin <name>          Remove a plugin bundle

${BOLD}Sources:${RESET}
  source add <owner/repo>         Add an external skill source
  source list                     List configured sources
  source remove <name>            Remove a source
  import <source>@<skill>         Import a skill from an external source

${BOLD}Flags:${RESET}
  --verbose, -v                   Print detailed logs
  --force                         Force reinstall even if up to date
  --version                       Show version
  --help, -h                      Show this help message
`);
}

function showCheck(catalog: Catalog) {
  showLogo();
  console.log();
  console.log(`${BOLD}Checking for updates...${RESET}\n`);

  const statuses = checkForUpdates(catalog);
  if (statuses.length === 0) {
    console.log(`  ${DIM}No items tracked. Install something first.${RESET}\n`);
    return;
  }

  let outdated = 0;
  for (const s of statuses) {
    if (s.status === 'not_in_catalog') {
      console.log(`  ${RED}[?]${RESET} ${s.type} ${BOLD}${s.name}${RESET} - no longer in catalog`);
    } else if (s.status === 'update_available') {
      const prefix = s.parent ? `plugin ${BOLD}${s.parent}${RESET} > ` : '';
      console.log(`  ${YELLOW}[~]${RESET} ${prefix}${s.type} ${BOLD}${s.name}${RESET} - ${YELLOW}update available${RESET}`);
      outdated++;
    } else {
      console.log(`  ${GREEN}[OK]${RESET} ${s.type} ${s.name} - up to date`);
    }
  }

  console.log();
  if (outdated > 0) {
    console.log(`${YELLOW}${outdated} item(s) can be updated.${RESET} Run ${BOLD}npx toolkit-ai update${RESET} to apply.\n`);
  } else {
    console.log(`${GREEN}Everything is up to date.${RESET}\n`);
  }
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function showScan(catalog: Catalog, toolkitDir: string, specificSkill?: string | null) {
  showLogo();
  console.log();
  console.log(`${BOLD}Security scan${RESET}\n`);

  let blockCount = 0;
  let warnCount = 0;

  if (specificSkill) {
    // Scan a specific skill
    const entry = catalog.skills.find(s => s.name === specificSkill);
    if (!entry) {
      console.log(`  ${RED}Skill not found: ${specificSkill}${RESET}\n`);
      return;
    }
    const src = path.join(toolkitDir, entry.path);
    const isInternal = !entry.source || entry.source === 'internal';
    const report = scanSkillDir(src, specificSkill, entry.source || 'internal', { trusted: isInternal });
    console.log(formatReport(report));
    blockCount += report.findings.filter(f => f.severity === 'block').length;
    warnCount += report.findings.filter(f => f.severity === 'warn').length;
  } else {
    // Scan everything
    for (const skill of catalog.skills) {
      const src = path.join(toolkitDir, skill.path);
      const isInternal = !skill.source || skill.source === 'internal';
      const report = scanSkillDir(src, skill.name, skill.source || 'internal', { trusted: isInternal });
      console.log(formatReport(report));
      blockCount += report.findings.filter(f => f.severity === 'block').length;
      warnCount += report.findings.filter(f => f.severity === 'warn').length;
    }

    for (const agent of catalog.agents) {
      const src = path.join(toolkitDir, agent.path);
      const isInternal = !agent.source || agent.source === 'internal';
      const report = scanAgentFile(src, agent.name, agent.source || 'internal', { trusted: isInternal });
      console.log(formatReport(report));
      blockCount += report.findings.filter(f => f.severity === 'block').length;
      warnCount += report.findings.filter(f => f.severity === 'warn').length;
    }

    for (const mcp of catalog.mcps) {
      const mcpConfig = loadMcpConfig(toolkitDir, mcp);
      const report = scanMcpConfig({ name: mcp.name, transport: mcpConfig.transport, url: mcpConfig.url }, mcp.source || 'internal');
      console.log(formatReport(report));
      blockCount += report.findings.filter(f => f.severity === 'block').length;
      warnCount += report.findings.filter(f => f.severity === 'warn').length;
    }
  }

  console.log();
  if (blockCount > 0) {
    console.log(`  ${RED}${blockCount} blocking issue(s)${RESET}, ${YELLOW}${warnCount} warning(s)${RESET}\n`);
  } else if (warnCount > 0) {
    console.log(`  ${GREEN}No blocking issues.${RESET} ${YELLOW}${warnCount} warning(s)${RESET}\n`);
  } else {
    console.log(`  ${GREEN}All clear — no issues found.${RESET}\n`);
  }
}

// ---------------------------------------------------------------------------
// Main headless dispatch
// ---------------------------------------------------------------------------

export function runHeadless(args: string[], toolkitDir: string): boolean {
  // --help / -h
  if (flag(args, '--help') || flag(args, '-h')) {
    usage();
    return true;
  }

  // --version
  if (flag(args, '--version')) {
    const version = process.env.TOOLKIT_VERSION || 'dev';
    console.log(`ai-toolkit v${version}`);
    return true;
  }

  const isForce = flag(args, '--force');
  const skillName  = option(args, '--skill');
  const agentName  = option(args, '--agent');
  const mcpName    = option(args, '--mcp');
  const pluginName = option(args, '--plugin');
  const isRemove   = flag(args, 'remove');
  const isList     = flag(args, '--list');
  const isCheck    = flag(args, '--check') || flag(args, 'check');
  const isUpdate   = flag(args, '--update') || flag(args, 'update');
  const isScan     = flag(args, 'scan');

  // Commands that need the catalog
  const needsCatalog = isList || isCheck || isUpdate || isRemove || isScan ||
    skillName || agentName || mcpName || pluginName;

  if (!needsCatalog) return false; // not a headless command

  const catalog = loadCatalog(toolkitDir);

  // Scan command
  if (isScan) {
    showScan(catalog, toolkitDir, skillName);
    return true;
  }

  if (isList) {
    listAll(catalog);
    return true;
  }

  if (isCheck) {
    showCheck(catalog);
    return true;
  }

  if (isUpdate) {
    showLogo();
    console.log();
    console.log(`${BOLD}Updating all installed items...${RESET}\n`);
    const results = updateAll(catalog, toolkitDir, { force: isForce });
    printSummary(results);
    return true;
  }

  // Direct remove
  if (isRemove) {
    if (skillName)       removeSkill(catalog, skillName);
    else if (agentName)  removeAgent(catalog, agentName);
    else if (mcpName)    removeMcp(catalog, mcpName);
    else if (pluginName) removePlugin(catalog, pluginName);
    else return false; // interactive remove -> TUI
    return true;
  }

  // Direct install
  const results: InstallResult[] = [];
  const opts = { force: isForce };
  if (skillName)       results.push(installSkill(catalog, toolkitDir, skillName, opts));
  else if (agentName)  results.push(installAgent(catalog, toolkitDir, agentName, opts));
  else if (mcpName)    results.push(installMcp(catalog, toolkitDir, mcpName, opts));
  else if (pluginName) results.push(...installPlugin(catalog, toolkitDir, pluginName, opts));

  if (results.length > 0) {
    printSummary(results);
    return true;
  }

  return false;
}

export function runBanner() {
  showBanner();
}
