import fs from 'fs';
import path from 'path';
import { LOG_FILE, TOOLKIT_HOME } from './platform.js';
import { ensureDir } from './fs-helpers.js';

/**
 * Append-only operation log at ~/.toolkit/log.jsonl. Each line is one JSON
 * record. Use case: the user looks at a TUI install summary, dismisses it,
 * then later wants to know "what did the toolkit actually do last week" —
 * tail this file.
 *
 * Why JSONL not a structured DB: zero deps, easy `tail -f`, easy `jq` for
 * the user, no migration story. The file grows unbounded; we don't rotate
 * automatically yet — the user can `truncate` it themselves.
 */

export type LogAction = 'install' | 'remove' | 'update' | 'install-plugin' | 'remove-plugin' | 'install-bundle' | 'refresh-source';

export interface LogEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** Verb describing what the toolkit was asked to do. */
  action: LogAction;
  /** Item type when applicable (skill / agent / mcp / command / plugin / bundle). */
  type?: string;
  /** Item name. */
  name: string;
  /** Source the item came from (synthetic `claude`/`copilot` or a configured source). */
  source?: string;
  /**
   * Provider labels the operation targeted (Claude Code, Codex, GitHub Copilot,
   * Cursor, VS Code, Amp). For installs, the writable targets at the time of
   * the operation. For removes, the targets we attempted to clean. Lets the
   * user see at a glance which AI tools were actually affected.
   */
  providers?: string[];
  /** Final action recorded ('installed' | 'updated' | 'skipped' | 'blocked' | 'removed'). */
  result: string;
  /** Captured stdout/stderr lines from the operation, for grep-ability. */
  lines: string[];
  /** Error message when the operation threw. */
  error?: string;
}

interface LogMeta {
  action: LogAction;
  type?: string;
  name: string;
  source?: string;
  providers?: string[];
}

function appendLine(record: LogEntry): void {
  try {
    ensureDir(TOOLKIT_HOME);
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch { /* logging is best-effort — never throw from the log path */ }
}

/**
 * Capture-and-log helper. Wraps an operation that emits log lines via the
 * existing LogFn callback pattern, captures every line, and writes one
 * JSONL record at the end with the final result.
 *
 * Use it like:
 *   const result = withLogging({ action: 'install', type: 'skill', name }, log => installSkill(catalog, name, opts, log));
 */
export function withLogging<T extends { action: string }>(
  meta: LogMeta,
  fn: (log: (msg: string) => void) => T,
  upstreamLog: (msg: string) => void = () => {},
): T {
  const captured: string[] = [];
  const dual = (msg: string) => {
    captured.push(msg);
    upstreamLog(msg);
  };
  try {
    const result = fn(dual);
    appendLine({
      ts: new Date().toISOString(),
      action: meta.action,
      type: meta.type,
      name: meta.name,
      source: meta.source,
      providers: meta.providers,
      result: result.action,
      lines: captured,
    });
    return result;
  } catch (e: unknown) {
    appendLine({
      ts: new Date().toISOString(),
      action: meta.action,
      type: meta.type,
      name: meta.name,
      source: meta.source,
      providers: meta.providers,
      result: 'errored',
      lines: captured,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * Variant for operations that return InstallResult[] (bundle / plugin
 * decompose). Emits one log record summarising the parent operation plus
 * per-sub-item results inline. Generic on the array element so callers
 * preserve their own InstallResult typing.
 */
export function withMultiLogging<R extends { type: string; name: string; action: string }>(
  meta: LogMeta,
  fn: (log: (msg: string) => void) => R[],
  upstreamLog: (msg: string) => void = () => {},
): R[] {
  const captured: string[] = [];
  const dual = (msg: string) => {
    captured.push(msg);
    upstreamLog(msg);
  };
  try {
    const results = fn(dual);
    const counts = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.action] = (acc[r.action] || 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ') || 'noop';
    appendLine({
      ts: new Date().toISOString(),
      action: meta.action,
      type: meta.type,
      name: meta.name,
      source: meta.source,
      providers: meta.providers,
      result: summary,
      lines: captured,
    });
    return results;
  } catch (e: unknown) {
    appendLine({
      ts: new Date().toISOString(),
      action: meta.action,
      type: meta.type,
      name: meta.name,
      source: meta.source,
      providers: meta.providers,
      result: 'errored',
      lines: captured,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * One-shot record for a background source refresh — captures the fetch/scan
 * outcome so `toolkit logs` reveals why a source shows the `! warning` badge.
 * `withLogging` doesn't fit here: refresh has no LogFn callback and the
 * caller (useCatalog) doesn't own a captured-lines stream.
 *
 * - `ok=true, errorMsg undefined` → refresh succeeded (rare to log, but cheap
 *   to keep on by default for audit; callers can skip on success if noise).
 * - `ok=false, usedCache=true` → fetch failed, fell back to cached scan
 *   (the "cached data kept where available" case).
 * - `ok=false, usedCache=false` → fetch failed AND no cache to fall back to.
 */
export function logSourceRefresh(args: {
  name: string;
  ok: boolean;
  usedCache: boolean;
  errorMsg?: string;
}): void {
  appendLine({
    ts: new Date().toISOString(),
    action: 'refresh-source',
    name: args.name,
    result: args.ok ? 'ok' : (args.usedCache ? 'failed-used-cache' : 'failed'),
    lines: args.errorMsg ? [args.errorMsg] : [],
    error: args.ok ? undefined : args.errorMsg,
  });
}

/** Read the last `count` log records from disk, oldest-first. */
export function readRecentLog(count = 50): LogEntry[] {
  if (!fs.existsSync(LOG_FILE)) return [];
  let raw: string;
  try { raw = fs.readFileSync(LOG_FILE, 'utf8'); } catch { return []; }
  const lines = raw.split('\n').filter(Boolean);
  const tail = lines.slice(-Math.max(1, count));
  const out: LogEntry[] = [];
  for (const line of tail) {
    try { out.push(JSON.parse(line) as LogEntry); } catch { /* skip malformed */ }
  }
  return out;
}
