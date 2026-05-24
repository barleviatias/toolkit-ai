import path from 'path';
import type { Catalog, InstallResult } from '../types.js';
import { loadMcpConfig } from '../core/catalog.js';
import { installSkill, installAgent, installMcp, installBundle, installCommand, installPlugin } from '../core/installer.js';
import { removeSkill, removeAgent, removeMcp, removeBundle, removeCommand, removePlugin } from '../core/remover.js';
import { fetchExternalResources, buildCatalog } from '../core/sources.js';
import { scanClaudeInstalledPlugins, scanCodexInstalledPlugins, scanCopilotInstalledPlugins } from '../core/claude-plugins.js';
import { withLogging, withMultiLogging, readRecentLog, type LogEntry } from '../core/logger.js';
import { checkForUpdates, updateAll } from '../core/updater.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig, formatReport } from '../core/scanner.js';
import { parseSourceInput, addSource, removeSource, loadSources, refreshSources, setSourceEnabled } from '../core/sources.js';
import { CACHE_DIR, CONFIG_FILE, TOOLKIT_VERSION_LABEL, KNOWN_TOOL_IDS, detectToolInstallations, getDisabledToolIds, getWritableTargetLabelsForType, type ToolId } from '../core/platform.js';
import { formatDuration, loadSettings, updateSettings } from '../core/settings.js';
import { RESET, BOLD, DIM, GREEN, RED, YELLOW } from '../core/ansi.js';

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
// Logs renderer helpers
// ---------------------------------------------------------------------------

interface LogSummary {
  nativeInstalls: string[];        // e.g. ["plugin radware-ams → Claude (native)", ...]
  skipReasons: [string, number][]; // counted by reason, descending
  hasFailure: boolean;             // any captured line looks like an error
}

const SKIP_LINE = /^\s*\[skip\]\s+(?:\w+)\s+[\w@.\-/]+:\s*(.+?)\s*$/;
const NATIVE_LINE = /^\s*\[\+\]\s+plugin\s+(\S+)\s+(?:->|→)\s+\S+\s+\((Claude|Codex|Copilot)\s+native\s+install\)/i;
const ERROR_LIKE = /\b(error|failed|fatal|cannot|denied|refused)\b/i;

function summarizeLogEntry(e: LogEntry): LogSummary {
  const nativeInstalls: string[] = [];
  const reasonCounts = new Map<string, number>();
  let hasFailure = false;

  for (const line of e.lines ?? []) {
    const native = line.match(NATIVE_LINE);
    if (native) {
      nativeInstalls.push(`plugin ${native[1]} → ${native[2]} (native)`);
      continue;
    }
    const skip = line.match(SKIP_LINE);
    if (skip) {
      reasonCounts.set(skip[1], (reasonCounts.get(skip[1]) ?? 0) + 1);
      continue;
    }
    if (ERROR_LIKE.test(line) && !line.includes('[skip]')) hasFailure = true;
  }

  if (e.result === 'errored' || e.result.startsWith('failed')) hasFailure = true;

  const skipReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]);
  return { nativeInstalls, skipReasons, hasFailure };
}

function colorizeResult(result: string, hasFailure: boolean): string {
  if (hasFailure || result === 'errored' || result.startsWith('failed')) {
    return `${RED}${result}${RESET}`;
  }
  if (result.startsWith('install') || result.includes('installed') || result === 'ok' || result === 'removed' || result === 'updated') {
    return `${GREEN}${result}${RESET}`;
  }
  return `${YELLOW}${result}${RESET}`;
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
    // Group by type so a plugin install that skipped 16 skills + 4 agents +
    // 5 commands reads as three condensed rows instead of 25 near-identical
    // lines. The per-item names are still available on the (already printed)
    // install stream and in ~/.toolkit/log.jsonl for anyone who wants them.
    const skippedByType = new Map<string, string[]>();
    for (const r of skipped) {
      const bucket = skippedByType.get(r.type) ?? [];
      bucket.push(r.name);
      skippedByType.set(r.type, bucket);
    }
    console.log(`  ${DIM}Up to date (${skipped.length}):${RESET}`);
    for (const [type, names] of skippedByType) {
      if (names.length <= 3) {
        for (const name of names) console.log(`    ${DIM}- ${type} ${name}${RESET}`);
      } else {
        console.log(`    ${DIM}- ${names.length} ${type}s (${names.slice(0, 2).join(', ')}, …)${RESET}`);
      }
    }
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

  console.log(`\n${BOLD}=== Bundles ===${RESET}`);
  for (const b of catalog.bundles)
    console.log(`  ${b.name.padEnd(28)} ${DIM}${b.description}${RESET}`);

  console.log(`\n${BOLD}=== Commands ===${RESET}`);
  for (const c of catalog.commands)
    console.log(`  ${c.name.padEnd(28)} ${DIM}${c.description}${RESET}`);

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
  console.log(`  ${DIM}$${RESET} toolkit-ai ${DIM}            Interactive TUI${RESET}`);
  console.log(`  ${DIM}$${RESET} toolkit-ai --list ${DIM}     List all available items${RESET}`);
  console.log(`  ${DIM}$${RESET} toolkit-ai --help ${DIM}     Full usage info${RESET}`);
  console.log();
}

function showTargets() {
  showLogo();
  console.log();
  console.log(`${BOLD}Detected target apps${RESET}\n`);

  const disabled = getDisabledToolIds();
  for (const tool of detectToolInstallations()) {
    const detectedNote = tool.installed ? `${GREEN}installed${RESET}` : `${DIM}not detected${RESET}`;
    const userNote = disabled.has(tool.id) ? `${YELLOW} · user-disabled${RESET}` : '';
    const capabilities = [
      tool.supportsSkills ? 'skills' : null,
      tool.supportsAgents ? 'agents' : null,
      tool.supportsMcps ? 'MCPs' : null,
      tool.supportsCommands ? 'commands' : null,
    ].filter((value): value is string => value !== null).join(', ');

    console.log(`  ${tool.label.padEnd(16)} ${detectedNote}${userNote} ${DIM}${capabilities}${RESET}`);
    if (tool.installed) {
      for (const reason of tool.reasons) console.log(`    ${DIM}- ${reason}${RESET}`);
    }
  }

  console.log();
}

function parseDurationInput(input: string): number | null {
  const match = input.trim().match(/^(\d+)([smhd])?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const unit = (match[2] || 's').toLowerCase();
  if (unit === 'd') return amount * 24 * 60 * 60;
  if (unit === 'h') return amount * 60 * 60;
  if (unit === 'm') return amount * 60;
  return amount;
}

function showSettings() {
  const settings = loadSettings();
  showLogo();
  console.log();
  console.log(`${BOLD}Settings${RESET}\n`);
  console.log(`  Install mode        ${BOLD}${settings.installMode}${RESET}`);
  console.log(`  Source cache TTL    ${BOLD}${formatDuration(settings.cacheTTL)}${RESET} ${DIM}(${settings.cacheTTL}s)${RESET}`);
  console.log(`  Source concurrency  ${BOLD}${settings.sourceConcurrency}${RESET}`);
  const disabled = settings.disabledTools.length > 0 ? settings.disabledTools.join(', ') : `${DIM}none${RESET}`;
  console.log(`  Disabled providers  ${BOLD}${disabled}${RESET}`);
  console.log();
  console.log(`  ${DIM}Config: ${CONFIG_FILE}${RESET}`);
  console.log(`  ${DIM}Cache:  ${CACHE_DIR}${RESET}`);
  console.log();
}

function showProviderToggles() {
  const disabled = getDisabledToolIds();
  showLogo();
  console.log();
  console.log(`${BOLD}Providers${RESET} ${DIM}(toolkit settings tool <id> on|off)${RESET}\n`);
  for (const tool of detectToolInstallations()) {
    const detected = tool.installed ? `${GREEN}detected${RESET}` : `${DIM}not detected${RESET}`;
    const userState = disabled.has(tool.id)
      ? `${YELLOW}disabled${RESET}`
      : tool.installed ? `${GREEN}enabled${RESET}` : `${DIM}—${RESET}`;
    console.log(`  ${tool.id.padEnd(8)} ${tool.label.padEnd(16)} ${detected.padEnd(22)} ${userState}`);
  }
  console.log();
}

function setProviderEnabled(id: ToolId, enabled: boolean): void {
  const known = new Set<string>(KNOWN_TOOL_IDS);
  if (!known.has(id)) {
    console.log(`  ${RED}[!]${RESET} Unknown provider: ${BOLD}${id}${RESET}. Known: ${KNOWN_TOOL_IDS.join(', ')}`);
    return;
  }
  const current = new Set(loadSettings().disabledTools);
  if (enabled) current.delete(id); else current.add(id);
  const next = updateSettings({ disabledTools: Array.from(current).sort() as ToolId[] });
  const state = next.disabledTools.includes(id) ? `${YELLOW}disabled${RESET}` : `${GREEN}enabled${RESET}`;
  console.log(`  ${GREEN}[OK]${RESET} Provider ${BOLD}${id}${RESET} is now ${state}.`);
}

function runSettingsCommand(args: string[]): boolean {
  if (args.length === 0 || args[0] === 'show') {
    showSettings();
    return true;
  }

  if ((args[0] === 'install-mode' || args[0] === 'mode') && (args[1] === 'copy' || args[1] === 'link')) {
    const settings = updateSettings({ installMode: args[1] });
    console.log(`  ${GREEN}[OK]${RESET} Install mode set to ${BOLD}${settings.installMode}${RESET}`);
    return true;
  }

  if (args[0] === 'symlink' && (args[1] === 'on' || args[1] === 'off')) {
    const settings = updateSettings({ installMode: args[1] === 'on' ? 'link' : 'copy' });
    console.log(`  ${GREEN}[OK]${RESET} Install mode set to ${BOLD}${settings.installMode}${RESET}`);
    return true;
  }

  if ((args[0] === 'cache' || args[0] === 'cache-ttl') && args[1]) {
    const cacheTTL = parseDurationInput(args[1]);
    if (cacheTTL !== null) {
      const settings = updateSettings({ cacheTTL });
      console.log(`  ${GREEN}[OK]${RESET} Cache duration set to ${BOLD}${formatDuration(settings.cacheTTL)}${RESET}`);
      return true;
    }
  }

  if ((args[0] === 'concurrency' || args[0] === 'parallel') && args[1]) {
    const sourceConcurrency = Number(args[1]);
    if (Number.isFinite(sourceConcurrency)) {
      const settings = updateSettings({ sourceConcurrency });
      console.log(`  ${GREEN}[OK]${RESET} Source concurrency set to ${BOLD}${settings.sourceConcurrency}${RESET}`);
      return true;
    }
  }

  if (args[0] === 'tools' || args[0] === 'providers') {
    showProviderToggles();
    return true;
  }

  if ((args[0] === 'tool' || args[0] === 'provider') && args[1] && (args[2] === 'on' || args[2] === 'off')) {
    setProviderEnabled(args[1] as ToolId, args[2] === 'on');
    return true;
  }

  console.log(`Usage: ai-toolkit settings [show|install-mode copy|install-mode link|symlink on|symlink off|cache 24h|concurrency 4|tools|tool <id> on|tool <id> off]`);
  return true;
}

function usage() {
  console.log(`
${BOLD}Usage:${RESET} ai-toolkit [command] [options]

${BOLD}Interactive:${RESET}
  ${DIM}(no args)${RESET}                       Launch TUI (browse, install, remove, update)

${BOLD}Scaffold:${RESET}
  init [dir]                        Scaffold a starter toolkit pack (toolkit-usage skill + sample command + bundle)

${BOLD}Security:${RESET}
  scan                              Scan all available items for threats
  scan skill <name>                 Scan a specific skill

${BOLD}Updates:${RESET}
  update                          Update all installed items
  check                           Check for available updates

${BOLD}Logs:${RESET}
  logs [N] [-v] [--name <s>] [--action <a>]
                                  Show recent operations from ~/.toolkit/log.jsonl. N (default 20) caps the output;
                                  -v / --verbose dumps captured per-line output. --name filters by substring of the
                                  item name; --action filters by action (install, remove, update, install-plugin,
                                  remove-plugin, install-bundle, refresh-source).

${BOLD}Install:${RESET}
  list                            List all available items
  targets                         Show detected AI tool install targets
  settings                        Show toolkit settings
  skill <name>                    Install a skill
  agent <name>                    Install an agent
  mcp <name>                      Register an MCP server
  bundle <name>                   Install a bundle
  command <name>                  Install a slash command (prompt)
  plugin <name>                   Install a plugin natively in every detected provider that has a plugin registry (Claude, Codex, Copilot) and decompose into per-user dirs elsewhere (Cursor, VS Code, Amp). Hooks ride along with the plugin tree.

${BOLD}Remove:${RESET}
  remove skill <name>             Remove a skill
  remove agent <name>             Remove an agent
  remove mcp <name>               Deregister an MCP server
  remove bundle <name>            Remove a bundle
  remove command <name>           Remove a slash command
  remove plugin <name>            Remove a plugin (and its decomposed components)

${BOLD}Sources:${RESET}
  source add <repo>[#branch]      Add an external skill source
  source list                     List configured sources
  source disable <name>           Disable a source (keeps config, skips fetch)
  source enable <name>            Re-enable a previously disabled source
  source remove <name>            Remove a source entirely
  source refresh [name]           Force re-fetch sources (all or by name)

  ${DIM}Accepts: owner/repo, owner/repo#branch,
          https://github.com/owner/repo[#branch],
          https://bitbucket.org/owner/repo[#branch],
          git@github.com:owner/repo.git[#branch]
          Use --name <alias> to keep multiple branches of the same repo${RESET}

${BOLD}Settings:${RESET}
  settings install-mode copy      Copy skills/agents when installing
  settings install-mode link      Symlink skills/agents to the source cache
  settings cache 24h              Set source cache duration
  settings concurrency 4          Set parallel source refresh workers
  settings tools                  List providers and per-provider on/off state
  settings tool <id> on|off       Enable or disable a provider (claude, cursor, vscode, codex, copilot, amp)

${BOLD}Flags:${RESET}
  --verbose, -v                   Print detailed logs
  --force                         Force reinstall even if up to date
  --strict                        Fail the install when the security scanner
                                  flags a block-severity issue. Off by default
                                  — running the command is treated as consent.
                                  Use in CI to hard-fail on risky content.
  --link                          Symlink skills/agents to the source cache
                                  for this run, overriding saved settings.
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
    console.log(`${YELLOW}${outdated} item(s) can be updated.${RESET} Run ${BOLD}toolkit-ai update${RESET} to apply.\n`);
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
      const report = scanMcpConfig({
        name: mcp.name,
        type: mcpConfig.type,
        url: mcpConfig.url,
        command: mcpConfig.command,
        args: mcpConfig.args,
        env: mcpConfig.env,
        envVars: mcpConfig.envVars,
        httpHeaders: mcpConfig.httpHeaders,
        envHttpHeaders: mcpConfig.envHttpHeaders,
      }, mcp.source);
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
    const branchFlag = args.findIndex(arg => arg === '--branch' || arg === '-b');
    const nameFlag = args.findIndex(arg => arg === '--name' || arg === '-n');
    const source = parseSourceInput(
      branchFlag >= 0 && args[branchFlag + 1]
        ? `${args[1]}#${args[branchFlag + 1]}`
        : args[1],
      nameFlag >= 0 ? args[nameFlag + 1] : undefined,
    );
    addSource(source);
    const branch = source.branch ? `#${source.branch}` : '';
    console.log(`  ${GREEN}[+]${RESET} Added source ${BOLD}${source.name}${RESET} (${source.type}: ${source.repo}${branch})`);
    return true;
  }

  if (sub === 'list') {
    const config = loadSources();
    if (config.sources.length === 0) {
      console.log(`  ${DIM}No sources configured.${RESET}`);
    } else {
      console.log(`\n${BOLD}Sources${RESET}\n`);
      for (const s of config.sources) {
        const state = s.enabled === false ? `  ${DIM}[disabled]${RESET}` : '';
        const ref = s.branch ? `#${s.branch}` : '';
        console.log(`  ${BOLD}${s.name.padEnd(20)}${RESET} ${DIM}${s.type}${RESET}  ${s.repo || s.path || ''}${ref}${state}`);
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

  if ((sub === 'disable' || sub === 'enable') && args[1]) {
    const enabled = sub === 'enable';
    const result = setSourceEnabled(args[1], enabled);
    if (result === null) {
      console.log(`  ${RED}[!]${RESET} Source ${BOLD}${args[1]}${RESET} not found.`);
    } else {
      console.log(`  ${GREEN}[OK]${RESET} ${enabled ? 'Enabled' : 'Disabled'} source ${BOLD}${args[1]}${RESET}`);
    }
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

  console.log(`Usage: ai-toolkit source <add|list|remove|disable|enable|refresh> [args]`);
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
    console.log(`ai-toolkit v${TOOLKIT_VERSION_LABEL}`);
    return true;
  }

  // Source commands (don't need catalog)
  if (args[0] === 'source') {
    return runSourceCommand(args.slice(1));
  }

  if (args[0] === 'settings' || args[0] === 'config') {
    return runSettingsCommand(args.slice(1));
  }

  if (args[0] === 'logs' || args[0] === 'log') {
    const verbose = flag(args, '--verbose') || flag(args, '-v');
    const nameFilter = option(args, '--name');
    const actionFilter = option(args, '--action');
    const countArg = Number(args.find(a => /^\d+$/.test(a)));
    const count = Number.isFinite(countArg) && countArg > 0 ? countArg : 20;
    // When a filter narrows the result, pull a larger window first so we
    // still surface up to `count` matching entries (otherwise --name foo
    // with foo missing from the last 20 entries returns nothing).
    const fetchCount = (nameFilter || actionFilter) ? Math.max(count * 10, 200) : count;
    const allEntries = readRecentLog(fetchCount);
    const filtered = allEntries.filter(e => {
      if (nameFilter && !e.name.toLowerCase().includes(nameFilter.toLowerCase())) return false;
      if (actionFilter && e.action !== actionFilter) return false;
      return true;
    });
    const entries = filtered.slice(-count);
    if (allEntries.length === 0) {
      console.log(`${DIM}No log entries yet — install or remove something first.${RESET}`);
      return true;
    }
    if (entries.length === 0) {
      const criteria = [
        nameFilter ? `name~"${nameFilter}"` : null,
        actionFilter ? `action="${actionFilter}"` : null,
      ].filter(Boolean).join(', ');
      console.log(`${DIM}No log entries match ${criteria}. Scanned ${allEntries.length} recent operation(s).${RESET}`);
      return true;
    }
    const filterNote = (nameFilter || actionFilter) ? ` filtered ${filtered.length}/${allEntries.length}` : '';
    console.log(`${BOLD}Last ${entries.length} operation${entries.length === 1 ? '' : 's'}${RESET} ${DIM}(~/.toolkit/log.jsonl${filterNote}${verbose ? '' : '; pass -v for captured output'})${RESET}\n`);
    for (const e of entries) {
      // Render the entry's ISO/UTC timestamp in the user's local timezone.
      // Previously we stripped the `T` and the `Z` from the raw ISO string,
      // which made UTC look like local time and silently lied by the user's
      // UTC offset (e.g. UTC+3 turned 12:48 local into 09:48 in the log).
      const dt = new Date(e.ts);
      const pad = (n: number) => String(n).padStart(2, '0');
      const time = Number.isNaN(dt.getTime())
        ? e.ts.replace('T', ' ').replace(/\..*$/, '')
        : `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
      const summary = summarizeLogEntry(e);
      const colored = colorizeResult(e.result, summary.hasFailure);
      const head = e.type ? `${e.action} ${e.type} ${BOLD}${e.name}${RESET}` : `${e.action} ${BOLD}${e.name}${RESET}`;
      const src = e.source ? ` ${DIM}· ${e.source}${RESET}` : '';
      const providers = e.providers && e.providers.length > 0
        ? ` ${DIM}· ${e.providers.join(', ')}${RESET}`
        : '';
      console.log(`${DIM}${time}${RESET}  ${head}${src}${providers}  → ${colored}`);

      // Native install lines (e.g. plugin installed in Claude/Codex/Copilot)
      // surface alongside the summary so the user doesn't think a plugin with
      // a "skipped:25" result count did nothing — the tree itself landed.
      for (const native of summary.nativeInstalls) {
        console.log(`  ${GREEN}↳${RESET} ${native}`);
      }

      // Per-reason skip breakdown — the most common "why" the user wonders about.
      // Counts collapse duplicate reasons across many sub-items into one line.
      for (const [reason, count] of summary.skipReasons) {
        console.log(`  ${DIM}skipped ${count}${RESET} ${YELLOW}${reason}${RESET}`);
      }

      // Source-refresh failures: print the captured git/HTTP message and
      // skip the redundant `error:` line below (same text).
      const isRefresh = e.action === 'refresh-source';
      if (isRefresh && e.lines && e.lines.length > 0) {
        for (const raw of e.lines) {
          for (const line of raw.split(/\r?\n/)) {
            if (line.trim()) console.log(`  ${RED}${line.trim()}${RESET}`);
          }
        }
      } else if (e.error) {
        console.log(`  ${RED}error:${RESET} ${e.error}`);
      }

      // Verbose: dump every captured line. For refresh entries the lines are
      // already shown above in red, so skip — otherwise this is the place to
      // see install/remove step-by-step output.
      if (verbose && !isRefresh && e.lines && e.lines.length > 0) {
        for (const line of e.lines) console.log(`    ${DIM}${line}${RESET}`);
      }
    }
    console.log();
    return true;
  }

  const isForce = flag(args, '--force');
  // Auto-strict when no human is driving the terminal. `curl ... | bash` and CI
  // runs have stdin piped (not a TTY), so treat them as "I can't ask the user"
  // and default to hard-fail on block-severity findings. Explicit --strict still
  // overrides; explicit --force doesn't disable strict (force = ignore lock hash).
  const isStrict = flag(args, '--strict') || !process.stdin.isTTY;
  const isRemove   = flag(args, 'remove');
  const isList     = flag(args, '--list') || flag(args, 'list');
  const isCheck    = flag(args, '--check') || flag(args, 'check');
  const isUpdate   = flag(args, '--update') || flag(args, 'update');
  const isScan     = flag(args, 'scan');
  const isRefresh  = flag(args, 'refresh') || flag(args, '--refresh');
  const isTargets  = flag(args, 'targets') || flag(args, 'doctor');
  const isLink     = flag(args, '--link');

  if (isTargets) {
    showTargets();
    return true;
  }

  // Subcommand style: toolkit skill <name> / toolkit remove skill <name>
  // Also supports legacy --flag style for backwards compat
  const subArgs = isRemove ? args.slice(args.indexOf('remove') + 1) : args;
  const skillName   = option(subArgs, '--skill')   || (subArgs[0] === 'skill'   && subArgs[1] ? subArgs[1] : null);
  const agentName   = option(subArgs, '--agent')   || (subArgs[0] === 'agent'   && subArgs[1] ? subArgs[1] : null);
  const mcpName     = option(subArgs, '--mcp')     || (subArgs[0] === 'mcp'     && subArgs[1] ? subArgs[1] : null);
  const bundleName  = option(subArgs, '--bundle')  || (subArgs[0] === 'bundle'  && subArgs[1] ? subArgs[1] : null);
  const commandName = option(subArgs, '--command') || (subArgs[0] === 'command' && subArgs[1] ? subArgs[1] : null);
  const pluginName  = option(subArgs, '--plugin')  || (subArgs[0] === 'plugin'  && subArgs[1] ? subArgs[1] : null);

  // Source refresh — re-fetch all external sources
  if (isRefresh) {
    const sources = loadSources();
    console.log(`${BOLD}Refreshing ${sources.sources.length} source(s)...${RESET}\n`);
    const resources = fetchExternalResources(true);
    console.log(`  ${GREEN}Done.${RESET} Found ${resources.skills.length} skills, ${resources.agents.length} agents, ${resources.mcps.length} MCPs, ${resources.bundles.length} bundles, ${resources.commands.length} commands, ${resources.plugins.length} plugins`);
    for (const warning of resources.warnings) {
      const cacheNote = warning.usedCache ? ' (using cached data)' : '';
      console.log(`  ${YELLOW}[!]${RESET} ${warning.name}${cacheNote}: ${warning.message}`);
    }
    console.log();
    return true;
  }

  // Commands that need the catalog
  const needsCatalog = isList || isCheck || isUpdate || isRemove || isScan ||
    skillName || agentName || mcpName || bundleName || commandName || pluginName;

  if (!needsCatalog) return false; // not a headless command

  // Build the catalog from configured sources, then merge in plugins that
  // Claude Code (`/plugin install`), Codex, or GitHub Copilot CLI
  // (`copilot plugin install`) already installed natively, so headless commands see them
  // too. Configured-source plugins win the dedupe (added first); among
  // synthetic sources, Claude wins over Codex/Copilot for the same plugin name
  // (arbitrary tie-break — they're identical content).
  const externalResources = fetchExternalResources(false);
  const seenPluginNames = new Set(externalResources.plugins.map(p => p.name));
  for (const p of [...scanClaudeInstalledPlugins(), ...scanCodexInstalledPlugins(), ...scanCopilotInstalledPlugins()]) {
    if (!seenPluginNames.has(p.name)) {
      externalResources.plugins.push(p);
      seenPluginNames.add(p.name);
    }
  }
  const catalog = buildCatalog(externalResources);

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
    const opts: { force: boolean; strict: boolean; link?: boolean } = { force: isForce, strict: isStrict };
    if (isLink) opts.link = true;
    const results = updateAll(catalog, opts);
    printSummary(results);
    return true;
  }

  // Direct remove. Each remove path captures its log lines into ~/.toolkit/log.jsonl
  // via withLogging so the user can `toolkit logs` later to see what happened.
  if (isRemove) {
    const removed = (type: string, name: string, fn: (log: (msg: string) => void) => void) =>
      withLogging(
        { action: 'remove', type, name, providers: getWritableTargetLabelsForType(type) },
        log => { fn(log); return { action: 'removed' }; },
        console.log,
      );

    if (skillName)        removed('skill', skillName,    log => removeSkill(catalog, skillName!, log));
    else if (agentName)   removed('agent', agentName,    log => removeAgent(catalog, agentName!, log));
    else if (mcpName)     removed('mcp', mcpName,        log => removeMcp(catalog, mcpName!, log));
    else if (bundleName)  removed('bundle', bundleName,  log => removeBundle(catalog, bundleName!, log));
    else if (commandName) removed('command', commandName,log => removeCommand(catalog, commandName!, log));
    else if (pluginName)  removed('plugin', pluginName,  log => removePlugin(catalog, pluginName!, log));
    else return false; // interactive remove -> TUI
    return true;
  }

  // Direct install
  const results: InstallResult[] = [];
  const opts: { force: boolean; strict: boolean; link?: boolean } = { force: isForce, strict: isStrict };
  if (isLink) opts.link = true;

  if (skillName) {
    results.push(withLogging(
      { action: 'install', type: 'skill', name: skillName, providers: getWritableTargetLabelsForType('skill') },
      log => installSkill(catalog, skillName!, opts, log), console.log));
  } else if (agentName) {
    results.push(withLogging(
      { action: 'install', type: 'agent', name: agentName, providers: getWritableTargetLabelsForType('agent') },
      log => installAgent(catalog, agentName!, opts, log), console.log));
  } else if (mcpName) {
    results.push(withLogging(
      { action: 'install', type: 'mcp', name: mcpName, providers: getWritableTargetLabelsForType('mcp') },
      log => installMcp(catalog, mcpName!, opts, log), console.log));
  } else if (commandName) {
    results.push(withLogging(
      { action: 'install', type: 'command', name: commandName, providers: getWritableTargetLabelsForType('command') },
      log => installCommand(catalog, commandName!, opts, log), console.log));
  } else if (bundleName) {
    results.push(...withMultiLogging(
      { action: 'install-bundle', type: 'bundle', name: bundleName, providers: getWritableTargetLabelsForType('bundle') },
      log => installBundle(catalog, bundleName!, opts, log), console.log));
  } else if (pluginName) {
    results.push(...withMultiLogging(
      { action: 'install-plugin', type: 'plugin', name: pluginName, providers: getWritableTargetLabelsForType('plugin') },
      log => installPlugin(catalog, pluginName!, opts, log), console.log));
  }

  if (results.length > 0) {
    printSummary(results);
    return true;
  }

  return false;
}

export function runBanner() {
  showBanner();
}
