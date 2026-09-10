import fs from 'fs';
import path from 'path';
import type { Source } from '../types.js';
import type { ItemData } from '../components/ItemRow.js';
import type { ExternalResources } from './sources.js';
import { CONFIG_FILE } from './platform.js';

export const NATIVE_SOURCES = ['claude', 'codex', 'copilot'];
export const RESOURCE_TYPES = ['skills', 'agents', 'mcps', 'bundles', 'commands', 'plugins', 'herdr'] as const;
export const EMPTY_RESOURCES: ExternalResources = {
  skills: [], agents: [], mcps: [], bundles: [], commands: [], plugins: [], herdr: [], warnings: [],
};

export interface CatalogSnapshot {
  identity: string;
  resources: ExternalResources;
  items: ItemData[];
}

interface SnapshotFile {
  version: number;
  sources: Record<string, CatalogSnapshot>;
  targetLabels: string[];
}

const VERSION = 1;
const FILE = path.join(path.dirname(CONFIG_FILE), 'catalog-cache.json');

/** Identify the source location, so changing a repo or branch cannot reuse its old catalog. */
export function sourceIdentity(source: Source): string {
  return JSON.stringify([source.type, source.repo, source.branch, source.path, source.protocol]);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function validSnapshot(value: unknown): value is CatalogSnapshot {
  if (!record(value) || typeof value.identity !== 'string' || !record(value.resources) || !Array.isArray(value.items)) return false;
  const resources = value.resources;
  if (!RESOURCE_TYPES.every(type => Array.isArray(resources[type]) && resources[type].every((entry: unknown) =>
    record(entry) && ['name', 'description', 'source', 'path', 'hash'].every(key => typeof entry[key] === 'string'),
  ))) return false;
  if (!Array.isArray(resources.warnings) || !resources.warnings.every((w: unknown) =>
    record(w) && typeof w.name === 'string' && typeof w.message === 'string' && typeof w.usedCache === 'boolean',
  )) return false;
  return value.items.every((item: unknown) => {
    if (!record(item) || !['key', 'type', 'name', 'description', 'source'].every(key => typeof item[key] === 'string') || typeof item.installed !== 'boolean') return false;
    if (!['version', 'path', 'hash', 'scanSummary', 'lastUpdatedAt', 'mcpType', 'url', 'setupNote', 'mcpCommand'].every(key => item[key] === undefined || typeof item[key] === 'string')) return false;
    if (!['hasUpdate', 'trackedByLock'].every(key => item[key] === undefined || typeof item[key] === 'boolean')) return false;
    if (item.scanStatus !== undefined && !['ok', 'warn', 'block'].includes(String(item.scanStatus))) return false;
    if (!['targetLabels', 'installedTargetLabels', 'mcpArgs'].every(key => item[key] === undefined || strings(item[key]))) return false;
    if (item.targetStatus !== undefined && (!Array.isArray(item.targetStatus) || !item.targetStatus.every((s: unknown) => record(s) && typeof s.label === 'string' && typeof s.installed === 'boolean'))) return false;
    for (const key of ['bundleContents', 'pluginContents']) {
      const contents = item[key];
      if (contents !== undefined && (!record(contents) || !['skills', 'agents'].every(k => strings(contents[k])))) return false;
      if (record(contents) && (key === 'bundleContents' ? !strings(contents.mcps) : !strings(contents.commands) || typeof contents.mcps !== 'number' || typeof contents.hasHooks !== 'boolean')) return false;
    }
    return true;
  });
}

function readFile(): SnapshotFile {
  const empty: SnapshotFile = { version: VERSION, sources: {}, targetLabels: [] };
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!record(raw) || raw.version !== VERSION || !record(raw.sources) || !strings(raw.targetLabels)) return empty;
    return {
      version: VERSION,
      sources: Object.fromEntries(Object.entries(raw.sources).filter(([, value]) => validSnapshot(value))) as Record<string, CatalogSnapshot>,
      targetLabels: raw.targetLabels,
    };
  } catch { return empty; }
}

/** Read ready-to-display snapshots without walking source trees or provider registries. */
export function loadCatalogSnapshots(sources: Source[]): SnapshotFile {
  const cached = readFile();
  const identities = new Map(sources.filter(source => source.enabled !== false).map(source => [source.name, sourceIdentity(source)]));
  for (const [name, snapshot] of Object.entries(cached.sources)) {
    if (identities.get(name) !== snapshot.identity && !(NATIVE_SOURCES.includes(name) && snapshot.identity === `native:${name}`)) delete cached.sources[name];
  }
  return cached;
}

/** Save display snapshots atomically from the background worker; a cache failure is non-fatal. */
export function saveCatalogSnapshots(entries: Record<string, CatalogSnapshot>, targetLabels: string[]): void {
  try {
    const cached = readFile();
    for (const [name, snapshot] of Object.entries(entries)) {
      if (snapshot.resources.warnings.length === 0 || snapshot.items.length > 0) cached.sources[name] = snapshot;
    }
    cached.targetLabels = targetLabels;
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const temp = `${FILE}.tmp-${process.pid}`;
    fs.writeFileSync(temp, JSON.stringify(cached));
    fs.renameSync(temp, FILE);
  } catch { /* Cached display is optional; keep the previous snapshot on failure. */ }
}
