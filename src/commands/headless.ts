import path from 'path';
import type { Catalog, InstallResult } from '../types.js';
import { loadMcpConfig } from '../core/catalog.js';
import { installSkill, installAgent, installMcp, installBundle, installPlugin } from '../core/installer.js';
import { removeSkill, removeAgent, removeMcp, removeBundle, removePlugin } from '../core/remover.js';
import { fetchExternalResources, buildCatalog } from '../core/sources.js';
import { checkForUpdates, updateAll } from '../core/updater.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig, scanPluginDir, formatReport } from '../core/scanner.js';
import { parseSourceInput, addSource, removeSource, loadSources, refreshSources } from '../core/sources.js';
import { CACHE_DIR } from '../core/platform.js';

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

  console.log(`\n${BOLD}=== Plugins ===${RESET}`);
  for (const p of catalog.plugins)
    console.log(`  ${p.name.padEnd(28)} ${DIM}${p.description}${RESET}`);

  console.log(`\n${BOLD}=== Agents ===${RESET}`);
  for (const a of catalog.agents)
    console.log(`  ${a.name.padEnd(28)} ${DIM}${a.description}${RESET}`);

  console.log(`\n${BOLD}=== MCPs ===${RESET}`);
  for (const m of catalog.mcps)
    console.log(`  ${m.name.padEnd(28)} ${DIM}${m.description}${RESET}`);

  console.log(`\n${BOLD}=== Bundles ===${RESET}`);
  for (const b of catalog.bundles)
    console.log(`  ${b.name.padEnd(28)} ${DIM}${b.description}${RESET}`);

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
  scan skill <name>                 Scan a specific skill

${BOLD}Updates:${RESET}
  update                          Update all installed items
  check                           Check for available updates

${BOLD}Install:${RESET}
  list                            List all available items
  skill <name>                    Install a skill
  agent <name>                    Install an agent
  mcp <name>                      Register an MCP server
  bundle <name>                   Install a bundle
  plugin <name>                   Install a plugin

${BOLD}Remove:${RESET}
  remove skill <name>             Remove a skill
  remove agent <name>             Remove an agent
  remove mcp <name>               Deregister an MCP server
  remove bundle <name>            Remove a bundle
  remove plugin <name>            Remove a plugin

${BOLD}Sources:${RESET}
  source add <repo>               Add an external skill source
  source list                     List configured sources
  source remove <name>            Remove a source
  source refresh [name]           Force re-fetch sources (all or by name)

  ${DIM}Accepts: owner/repo, https://github.com/owner/repo,
          https://bitbucket.org/owner/repo, git@github.com:owner/repo.git${RESET}

${BOLD}Flags:${RESET}
  --verbose, -v                   Print detailed logs
  --force                         Force reinstall even if up to date
  --target <list>                 For plugin install: override native targets.
                                  Comma-separated from: claude, codex, copilot, cursor
                                  e.g. --target claude,copilot
  --all-targets, --all            For plugin install: install to Claude, Codex, Copilot, Cursor
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
      const prefix = s.parent ? `bundle ${BOLD}${s.parent}${RESET} > ` : '';
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

function showScan(catalog: Catalog, specificSkill?: string | null) {
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
    const src = path.join(CACHE_DIR, entry.source, entry.path);
    const report = scanSkillDir(src, specificSkill, entry.source, { trusted: false });
    console.log(formatReport(report));
    blockCount += report.findings.filter(f => f.severity === 'block').length;
    warnCount += report.findings.filter(f => f.severity === 'warn').length;
  } else {
    // Scan everything
    for (const skill of catalog.skills) {
      const src = path.join(CACHE_DIR, skill.source, skill.path);
      const report = scanSkillDir(src, skill.name, skill.source, { trusted: false });
      console.log(formatReport(report));
      blockCount += report.findings.filter(f => f.severity === 'block').length;
      warnCount += report.findings.filter(f => f.severity === 'warn').length;
    }

    for (const agent of catalog.agents) {
      const src = path.join(CACHE_DIR, agent.source, agent.path);
      const report = scanAgentFile(src, agent.name, agent.source, { trusted: false });
      console.log(formatReport(report));
      blockCount += report.findings.filter(f => f.severity === 'block').length;
      warnCount += report.findings.filter(f => f.severity === 'warn').length;
    }

    for (const mcp of catalog.mcps) {
      const mcpConfig = loadMcpConfig(mcp);
      const report = scanMcpConfig({ name: mcp.name, type: mcpConfig.type, url: mcpConfig.url }, mcp.source);
      console.log(formatReport(report));
      blockCount += report.findings.filter(f => f.severity === 'block').length;
      warnCount += report.findings.filter(f => f.severity === 'warn').length;
    }

    for (const plugin of catalog.plugins) {
      const src = path.join(CACHE_DIR, plugin.source, plugin.path);
      const report = scanPluginDir(src, plugin.name, plugin.source, { trusted: false });
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
// Source management
// ---------------------------------------------------------------------------

function runSourceCommand(args: string[]): boolean {
  const sub = args[0];

  if (sub === 'add' && args[1]) {
    const source = parseSourceInput(args[1]);
    addSource(source);
    console.log(`  ${GREEN}[+]${RESET} Added source ${BOLD}${source.name}${RESET} (${source.type}: ${source.repo})`);
    return true;
  }

  if (sub === 'list') {
    const config = loadSources();
    if (config.sources.length === 0) {
      console.log(`  ${DIM}No sources configured.${RESET}`);
    } else {
      console.log(`\n${BOLD}Sources${RESET}\n`);
      for (const s of config.sources) {
        console.log(`  ${BOLD}${s.name.padEnd(20)}${RESET} ${DIM}${s.type}${RESET}  ${s.repo || s.path || ''}`);
      }
      console.log();
    }
    return true;
  }

  if (sub === 'remove' && args[1]) {
    removeSource(args[1]);
    console.log(`  ${RED}[-]${RESET} Removed source ${BOLD}${args[1]}${RESET}`);
    return true;
  }

  if (sub === 'refresh') {
    const target = args[1] || undefined;
    console.log(`\n${BOLD}Refreshing ${target || 'all'} sources...${RESET}\n`);
    const results = refreshSources(target);
    for (const r of results) {
      if (r.ok) {
        console.log(`  ${GREEN}[OK]${RESET} ${r.name}`);
      } else {
        console.log(`  ${RED}[!]${RESET}  ${r.name} — ${r.error}`);
      }
    }
    if (results.length === 0) {
      console.log(`  ${DIM}No sources to refresh.${RESET}`);
    }
    console.log();
    return true;
  }

  console.log(`Usage: ai-toolkit source <add|list|remove|refresh> [args]`);
  return true;
}

// ---------------------------------------------------------------------------
// Main headless dispatch
// ---------------------------------------------------------------------------

export function runHeadless(args: string[], _toolkitDir: string): boolean {
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

  // Source commands (don't need catalog)
  if (args[0] === 'source') {
    return runSourceCommand(args.slice(1));
  }

  const isForce = flag(args, '--force');
  const isAllTargets = flag(args, '--all-targets') || flag(args, '--all');
  const targetOption = option(args, '--target') || option(args, '--targets');
  // Parse target list: "--target claude,copilot" or "--all-targets"
  const VALID_TARGETS = ['claude', 'codex', 'copilot', 'cursor'] as const;
  type TargetName = typeof VALID_TARGETS[number];
  const targets: TargetName[] | undefined = isAllTargets
    ? [...VALID_TARGETS]
    : targetOption
      ? targetOption.split(',').map(s => s.trim().toLowerCase()).filter((t): t is TargetName => (VALID_TARGETS as readonly string[]).includes(t))
      : undefined;
  const isRemove   = flag(args, 'remove');
  const isList     = flag(args, '--list') || flag(args, 'list');
  const isCheck    = flag(args, '--check') || flag(args, 'check');
  const isUpdate   = flag(args, '--update') || flag(args, 'update');
  const isScan     = flag(args, 'scan');
  const isRefresh  = flag(args, 'refresh') || flag(args, '--refresh');

  // Subcommand style: toolkit skill <name> / toolkit remove skill <name>
  // Also supports legacy --flag style for backwards compat
  const subArgs = isRemove ? args.slice(args.indexOf('remove') + 1) : args;
  const skillName  = option(subArgs, '--skill')  || (subArgs[0] === 'skill'  && subArgs[1] ? subArgs[1] : null);
  const agentName  = option(subArgs, '--agent')  || (subArgs[0] === 'agent'  && subArgs[1] ? subArgs[1] : null);
  const mcpName    = option(subArgs, '--mcp')    || (subArgs[0] === 'mcp'    && subArgs[1] ? subArgs[1] : null);
  const bundleName = option(subArgs, '--bundle') || (subArgs[0] === 'bundle' && subArgs[1] ? subArgs[1] : null);
  const pluginName = option(subArgs, '--plugin') || (subArgs[0] === 'plugin' && subArgs[1] ? subArgs[1] : null);

  // Source refresh — re-fetch all external sources
  if (isRefresh) {
    const sources = loadSources();
    console.log(`${BOLD}Refreshing ${sources.sources.length} source(s)...${RESET}\n`);
    const resources = fetchExternalResources(true);
    console.log(`  ${GREEN}Done.${RESET} Found ${resources.skills.length} skills, ${resources.agents.length} agents, ${resources.mcps.length} MCPs, ${resources.plugins.length} plugins\n`);
    return true;
  }

  // Commands that need the catalog
  const needsCatalog = isList || isCheck || isUpdate || isRemove || isScan ||
    skillName || agentName || mcpName || bundleName || pluginName;

  if (!needsCatalog) return false; // not a headless command

  const catalog = buildCatalog(fetchExternalResources(false));

  // Scan command: toolkit scan skill <name>
  if (isScan) {
    const scanSkillName = skillName || (args[1] === 'skill' && args[2] ? args[2] : null);
    showScan(catalog, scanSkillName);
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
    const results = updateAll(catalog, { force: isForce });
    printSummary(results);
    return true;
  }

  // Direct remove
  if (isRemove) {
    if (skillName)       removeSkill(catalog, skillName);
    else if (agentName)  removeAgent(catalog, agentName);
    else if (mcpName)    removeMcp(catalog, mcpName);
    else if (bundleName) removeBundle(catalog, bundleName);
    else if (pluginName) removePlugin(catalog, pluginName);
    else return false; // interactive remove -> TUI
    return true;
  }

  // Direct install
  const results: InstallResult[] = [];
  const opts = { force: isForce, ...(targets ? { targets } : {}) };
  if (skillName)       results.push(installSkill(catalog, skillName, opts));
  else if (agentName)  results.push(installAgent(catalog, agentName, opts));
  else if (mcpName)    results.push(installMcp(catalog, mcpName, opts));
  else if (bundleName) results.push(...installBundle(catalog, bundleName, opts));
  else if (pluginName) results.push(installPlugin(catalog, pluginName, opts));

  if (results.length > 0) {
    printSummary(results);
    return true;
  }

  return false;
}

export function runBanner() {
  showBanner();
}
