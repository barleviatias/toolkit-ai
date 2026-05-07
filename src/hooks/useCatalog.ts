import path from 'path';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { Catalog, CatalogEntry, Source } from '../types.js';
import { loadMcpConfig, loadBundleConfig } from '../core/catalog.js';
import {
  extractMcpServers,
  buildCatalog,
  scanCachedSource,
  fetchAndScanSource,
  hasCache,
  isStale,
  loadSources,
  type ExternalResources,
} from '../core/sources.js';
import { loadSettings } from '../core/settings.js';
import { readLock } from '../core/lock.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig } from '../core/scanner.js';
import { CACHE_DIR, getInstalledTargetLabelsForType, getWritableTargetLabelsForType } from '../core/platform.js';
import { makeKey } from '../core/item-key.js';
import { getInstalledState } from '../core/installed-state.js';
import type { ItemData } from '../components/ItemRow.js';

// Module-level cache for security scan results, keyed by "type:source:hash".
// Scan results only change when item content changes (new hash), so this is safe
// to persist across renders and avoids expensive filesystem I/O on every state change.
const scanCache = new Map<string, { scanStatus: 'ok' | 'warn' | 'block'; scanSummary?: string }>();

const EMPTY_EXTERNAL: ExternalResources = { skills: [], agents: [], mcps: [], bundles: [], warnings: [] };

export type SourceFetchStatus = 'idle' | 'fetching' | 'ready' | 'error';

function isEnabled(source: Source): boolean {
  return source.enabled !== false;
}

function mergePerSource(
  perSource: Map<string, ExternalResources>,
  sourceOrder: string[],
): ExternalResources {
  // Stable order: iterate sources by their config order (matches the Sources tab),
  // then keep the per-source dedupe ordering inside each. Without this, items
  // shift under the user's cursor when sources stream in out-of-order.
  const merged: ExternalResources = { skills: [], agents: [], mcps: [], bundles: [], warnings: [] };
  for (const name of sourceOrder) {
    const r = perSource.get(name);
    if (!r) continue;
    merged.skills.push(...r.skills);
    merged.agents.push(...r.agents);
    merged.mcps.push(...r.mcps);
    merged.bundles.push(...r.bundles);
    merged.warnings.push(...r.warnings);
  }
  return merged;
}

export function useCatalog() {
  // perSource: each source's current scan/fetch result. Streamed in as fetches
  // complete so the Catalog tab fills progressively instead of waiting on the
  // slowest source. sourceOrder mirrors the on-disk config order — used as the
  // stable iteration order for merging so cursor doesn't jump as items arrive.
  const [perSource, setPerSource] = useState<Map<string, ExternalResources>>(() => new Map());
  const [sourceOrder, setSourceOrder] = useState<string[]>(() =>
    loadSources().sources.filter(isEnabled).map(s => s.name),
  );
  const [sourceStatus, setSourceStatus] = useState<Map<string, SourceFetchStatus>>(() => new Map());
  const [lock, setLock] = useState(() => readLock());

  // Generation counter — refresh waves bump this; per-source resolvers check
  // it before writing state so stale results from a prior wave are dropped.
  const refreshGenRef = useRef(0);

  const external = useMemo(() => mergePerSource(perSource, sourceOrder), [perSource, sourceOrder]);
  const catalog: Catalog = useMemo(() => buildCatalog(external), [external]);
  const installedState = useMemo(() => getInstalledState(catalog, lock), [catalog, lock]);

  // Background fetch for one source. Updates state as it goes. Returns the
  // resources for callers that want to chain on completion.
  const fetchOneSource = useCallback(async (
    source: Source,
    forceRefresh: boolean,
    gen: number,
  ): Promise<ExternalResources> => {
    setSourceStatus(prev => new Map(prev).set(source.name, 'fetching'));
    const settings = loadSettings();
    let result: ExternalResources;
    try {
      result = await fetchAndScanSource(source, settings.cacheTTL, forceRefresh);
    } catch (e: unknown) {
      result = {
        skills: [], agents: [], mcps: [], bundles: [],
        warnings: [{
          name: source.name,
          message: e instanceof Error ? e.message : String(e),
          usedCache: false,
        }],
      };
    }
    if (gen !== refreshGenRef.current) return result;
    setPerSource(prev => new Map(prev).set(source.name, result));
    setSourceStatus(prev => new Map(prev).set(
      source.name,
      result.warnings.length > 0 ? 'error' : 'ready',
    ));
    return result;
  }, []);

  // First paint: scan whatever's already in cache (cheap, no network) so the
  // catalog appears immediately, then kick off background fetches for stale
  // sources. setTimeout(0) yields to Ink so the empty shell paints first.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      const config = loadSources();
      const settings = loadSettings();
      const enabled = config.sources.filter(isEnabled);
      const order = enabled.map(s => s.name);

      // Phase 1: synchronous cache scan, single state batch.
      const initialPerSource = new Map<string, ExternalResources>();
      const initialStatus = new Map<string, SourceFetchStatus>();
      for (const s of enabled) {
        if (hasCache(s)) {
          initialPerSource.set(s.name, scanCachedSource(s));
          initialStatus.set(s.name, isStale(s, settings.cacheTTL) ? 'fetching' : 'ready');
        } else {
          initialPerSource.set(s.name, EMPTY_EXTERNAL);
          initialStatus.set(s.name, 'fetching');
        }
      }
      setSourceOrder(order);
      setPerSource(initialPerSource);
      setSourceStatus(initialStatus);

      // Phase 2: background fetch for stale or uncached sources.
      const gen = ++refreshGenRef.current;
      const stale = enabled.filter(s => !hasCache(s) || isStale(s, settings.cacheTTL));
      void runWithConcurrency(stale, settings.sourceConcurrency, s => fetchOneSource(s, false, gen));
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  // fetchOneSource is stable (empty deps). Mount-only effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshLock = () => setLock(readLock());

  // Refresh all sources in the background. Does NOT clear current items —
  // each source's slot is replaced as its fetch completes, so the user keeps
  // seeing the existing catalog while new data streams in.
  const refreshExternal = useCallback(async (forceRefresh = false): Promise<ExternalResources> => {
    if (forceRefresh) scanCache.clear();
    const config = loadSources();
    const settings = loadSettings();
    const enabled = config.sources.filter(isEnabled);
    setSourceOrder(enabled.map(s => s.name));

    const gen = ++refreshGenRef.current;
    setSourceStatus(prev => {
      const next = new Map(prev);
      for (const s of enabled) next.set(s.name, 'fetching');
      return next;
    });

    // Aggregate per-source results as each promise resolves, then merge in
    // config order for a stable summary returned to the caller (toast count).
    const results = new Map<string, ExternalResources>();
    await runWithConcurrency(enabled, settings.sourceConcurrency, async (s) => {
      const r = await fetchOneSource(s, forceRefresh, gen);
      results.set(s.name, r);
    });
    return mergePerSource(results, enabled.map(s => s.name));
  }, [fetchOneSource]);

  // Refresh a single source in the background. Used by add-source (so the add
  // dialog returns to the list immediately) and by enable-toggle when the
  // source has no cache yet.
  const refreshSingleSource = useCallback(async (source: Source, forceRefresh: boolean): Promise<void> => {
    const gen = ++refreshGenRef.current;
    await fetchOneSource(source, forceRefresh, gen);
  }, [fetchOneSource]);

  // Drop a source from the catalog without touching disk or network. Used by
  // disable-toggle and remove-source so the UI reflects the change instantly.
  const forgetSource = useCallback((name: string): void => {
    setPerSource(prev => {
      if (!prev.has(name)) return prev;
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
    setSourceStatus(prev => {
      if (!prev.has(name)) return prev;
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
    setSourceOrder(prev => prev.filter(n => n !== name));
  }, []);

  // Add a freshly-enabled source to the in-memory state. If a cache exists
  // (e.g. enabling a previously-disabled source), scan it immediately so items
  // appear without a fetch round-trip. Re-derive sourceOrder from disk so the
  // re-enabled source returns to its original config position rather than
  // jumping to the end of the catalog.
  const adoptSource = useCallback((source: Source): void => {
    const enabledOrder = loadSources().sources.filter(isEnabled).map(s => s.name);
    setSourceOrder(enabledOrder);
    setPerSource(prev => {
      const next = new Map(prev);
      next.set(source.name, hasCache(source) ? scanCachedSource(source) : EMPTY_EXTERNAL);
      return next;
    });
    setSourceStatus(prev => new Map(prev).set(
      source.name,
      hasCache(source) && !isStale(source, loadSettings().cacheTTL) ? 'ready' : 'fetching',
    ));
  }, []);

  // Check if an item is installed (by lock-format key: "type:name")
  function isInstalled(lockKey: string): boolean {
    return installedState.installedKeys.has(lockKey);
  }

  // Get installed hash for an item (for update detection)
  function getInstalledHash(lockKey: string): string | null {
    if (installedState.recoveredKeys.has(lockKey)) return null;
    if (lock.installed[lockKey]) return lock.installed[lockKey].hash;
    for (const [k, v] of Object.entries(lock.installed)) {
      if (k.startsWith('bundle:') && v.items?.[lockKey]) return v.items[lockKey].hash;
    }
    return null;
  }

  // Build flat item list with security scan results and update detection
  const allItems: ItemData[] = useMemo(() => {
    const items: ItemData[] = [];
    const targetLabelsByType: Record<string, string[]> = {
      skill: getWritableTargetLabelsForType('skill'),
      agent: getWritableTargetLabelsForType('agent'),
      mcp: getWritableTargetLabelsForType('mcp'),
      bundle: getWritableTargetLabelsForType('bundle'),
    };

    function scanItem(type: string, entry: CatalogEntry): { scanStatus: 'ok' | 'warn' | 'block'; scanSummary?: string } {
      const cacheKey = `${type}:${entry.source}:${entry.hash}`;
      const cached = scanCache.get(cacheKey);
      if (cached) return cached;

      const src = entry.source;
      let result: { scanStatus: 'ok' | 'warn' | 'block'; scanSummary?: string };

      try {
        let report;
        if (type === 'skill') {
          const skillDir = path.join(CACHE_DIR, src, entry.path);
          report = scanSkillDir(skillDir, entry.name, src, { trusted: false });
        } else if (type === 'agent') {
          const agentPath = path.join(CACHE_DIR, src, entry.path);
          report = scanAgentFile(agentPath, entry.name, src, { trusted: false });
        } else if (type === 'mcp') {
          try {
            const rawConfig = loadMcpConfig(entry);
            const server = extractMcpServers(rawConfig).find(([n]) => n === entry.name)?.[1];
            if (server) {
              report = scanMcpConfig({
                name: entry.name,
                type: server.type as string | undefined,
                url: server.url as string | undefined,
                command: server.command as string | undefined,
                args: server.args as string[] | undefined,
                env: server.env as Record<string, string> | undefined,
                envVars: server.envVars as string[] | undefined,
                httpHeaders: server.httpHeaders as Record<string, string> | undefined,
                envHttpHeaders: server.envHttpHeaders as Record<string, string> | undefined,
              }, src);
            }
          } catch {
            // MCP config not loadable — treat as clean
          }
        }

        if (!report || report.findings.length === 0) {
          result = { scanStatus: 'ok' };
        } else {
          const hasBlock = report.findings.some(f => f.severity === 'block');
          const count = report.findings.length;
          const summary = report.findings.map(f => f.message).join('; ');
          result = {
            scanStatus: hasBlock ? 'block' : 'warn',
            scanSummary: `${count} issue${count > 1 ? 's' : ''}: ${summary}`,
          };
        }
      } catch {
        result = { scanStatus: 'ok' };
      }

      scanCache.set(cacheKey, result);
      return result;
    }

    function toItem(type: string, entry: CatalogEntry): ItemData {
      const src = entry.source;
      const uiKey = makeKey(type, src, entry.name);
      const lockKey = `${type}:${entry.name}`;
      const installed = isInstalled(lockKey);
      const installedHash = installed ? getInstalledHash(lockKey) : null;
      const hasUpdate = installed && installedHash !== null && installedHash !== entry.hash;
      const { scanStatus, scanSummary } = scanItem(type, entry);
      const installedTargetLabels = installed
        ? getInstalledTargetLabelsForType(type, entry.name, entry.path)
        : [];

      const item: ItemData = {
        key: uiKey,
        type,
        name: entry.name,
        description: entry.description,
        source: src,
        installed,
        hasUpdate,
        path: entry.path,
        hash: entry.hash,
        scanStatus,
        scanSummary,
        trackedByLock: !installedState.recoveredKeys.has(lockKey),
        targetLabels: targetLabelsByType[type] || [],
        installedTargetLabels,
      };

      // Enrich MCP items with server-level config details (type/url/setupNote + command preview for consent dialog)
      if (type === 'mcp') {
        try {
          const rawConfig = loadMcpConfig(entry);
          const server = extractMcpServers(rawConfig).find(([n]) => n === entry.name)?.[1];
          if (server) {
            item.mcpType = server.type as string | undefined;
            item.url = server.url as string | undefined;
            item.setupNote = (server.setupNote ?? (rawConfig as { setupNote?: string }).setupNote) as string | undefined;
            item.mcpCommand = server.command as string | undefined;
            item.mcpArgs = server.args as string[] | undefined;
          }
        } catch {
          // MCP config not loadable — skip enrichment
        }
      }

      // Enrich bundle items with contents
      if (type === 'bundle') {
        try {
          const bundleConfig = loadBundleConfig(entry);
          item.bundleContents = {
            skills: bundleConfig.skills || [],
            agents: bundleConfig.agents || [],
            mcps: bundleConfig.mcps || [],
          };
        } catch {
          // Bundle config not loadable — skip enrichment
        }
      }

      return item;
    }

    for (const s of catalog.skills) items.push(toItem('skill', s));
    for (const a of catalog.agents) items.push(toItem('agent', a));
    for (const m of catalog.mcps) items.push(toItem('mcp', m));
    for (const b of catalog.bundles) items.push(toItem('bundle', b));

    return items;
  }, [catalog, lock, installedState]);

  // Installed items for the Installed tab
  const installedItems: ItemData[] = useMemo(() => {
    return allItems.filter(i => i.installed);
  }, [allItems]);

  // True when at least one source is still fetching. Cosmetic — used for the
  // header banner only; tabs render their content regardless so the user can
  // browse cached items while a refresh runs.
  const loading = useMemo(() => {
    for (const status of sourceStatus.values()) if (status === 'fetching') return true;
    return false;
  }, [sourceStatus]);

  return {
    catalog,
    lock,
    allItems,
    installedItems,
    refreshLock,
    refreshExternal,
    refreshSingleSource,
    forgetSource,
    adoptSource,
    sourceStatus,
    loading,
    sourceWarnings: external.warnings,
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<unknown>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  if (workerCount === 0) return;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      await fn(items[i]);
    }
  }));
}
