import fs from 'fs';
import path from 'path';
import { ensureDir } from './fs-helpers.js';
import { CONFIG_FILE, SOURCES_FILE, KNOWN_TOOL_IDS, type ToolId } from './platform.js';

export type InstallMode = 'copy' | 'link';

export interface ToolkitSettings {
  installMode: InstallMode;
  cacheTTL: number;
  sourceConcurrency: number;
  /**
   * Provider opt-out list. Tools listed here are skipped during install even
   * if their target dirs/binaries are detected. Empty (the default) means
   * "write to every detected tool" — preserves the previous behaviour.
   */
  disabledTools: ToolId[];
}

export const DEFAULT_SETTINGS: ToolkitSettings = {
  installMode: 'link',
  cacheTTL: 24 * 60 * 60,
  sourceConcurrency: 4,
  disabledTools: [],
};

const MIN_CACHE_TTL = 0;
const MAX_CACHE_TTL = 30 * 24 * 60 * 60;
const MIN_SOURCE_CONCURRENCY = 1;
const MAX_SOURCE_CONCURRENCY = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function readLegacyCacheTTL(): number | null {
  try {
    const raw = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')) as unknown;
    if (!isRecord(raw)) return null;
    return clampInteger(raw.cacheTTL, DEFAULT_SETTINGS.cacheTTL, MIN_CACHE_TTL, MAX_CACHE_TTL);
  } catch {
    return null;
  }
}

function normalizeInstallMode(value: unknown, fallback: InstallMode): InstallMode {
  return value === 'link' || value === 'copy' ? value : fallback;
}

function normalizeDisabledTools(value: unknown, fallback: ToolId[]): ToolId[] {
  if (!Array.isArray(value)) return fallback;
  const known = new Set<string>(KNOWN_TOOL_IDS);
  const seen = new Set<ToolId>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    if (!known.has(entry)) continue;
    seen.add(entry as ToolId);
  }
  return Array.from(seen).sort();
}

function settingsFallback(): ToolkitSettings {
  return {
    ...DEFAULT_SETTINGS,
    cacheTTL: readLegacyCacheTTL() ?? DEFAULT_SETTINGS.cacheTTL,
  };
}

/** Normalize untrusted settings JSON into the supported settings shape. */
export function normalizeSettings(raw: unknown, fallback: ToolkitSettings = DEFAULT_SETTINGS): ToolkitSettings {
  if (!isRecord(raw)) return fallback;

  const legacyLinkInstall = typeof raw.linkInstall === 'boolean' ? raw.linkInstall : null;
  const installModeValue = raw.installMode ?? (legacyLinkInstall === true ? 'link' : legacyLinkInstall === false ? 'copy' : undefined);

  return {
    installMode: normalizeInstallMode(installModeValue, fallback.installMode),
    cacheTTL: clampInteger(raw.cacheTTL, fallback.cacheTTL, MIN_CACHE_TTL, MAX_CACHE_TTL),
    sourceConcurrency: clampInteger(
      raw.sourceConcurrency,
      fallback.sourceConcurrency,
      MIN_SOURCE_CONCURRENCY,
      MAX_SOURCE_CONCURRENCY,
    ),
    disabledTools: normalizeDisabledTools(raw.disabledTools, fallback.disabledTools),
  };
}

/** Load persisted toolkit settings, falling back to defaults and legacy sources cache TTL. */
export function loadSettings(): ToolkitSettings {
  const fallback = settingsFallback();
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as unknown, fallback);
  } catch {
    return fallback;
  }
}

/** Persist toolkit settings after normalizing bounds and enum values. */
export function saveSettings(settings: ToolkitSettings): ToolkitSettings {
  const normalized = normalizeSettings(settings, DEFAULT_SETTINGS);
  ensureDir(path.dirname(CONFIG_FILE));
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(normalized, null, 2));
  return normalized;
}

/** Merge and persist a partial settings update. */
export function updateSettings(patch: Partial<ToolkitSettings>): ToolkitSettings {
  return saveSettings({ ...loadSettings(), ...patch });
}

/** True when installs should symlink to the source cache by default. */
export function shouldInstallWithSymlink(linkOverride?: boolean): boolean {
  return linkOverride ?? loadSettings().installMode === 'link';
}

/** Format a settings duration in compact human-readable units. */
export function formatDuration(seconds: number): string {
  if (seconds === 0) return 'always';
  if (seconds % 86400 === 0) {
    const days = seconds / 86400;
    return `${days}d`;
  }
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours}h`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes}m`;
  }
  return `${seconds}s`;
}
