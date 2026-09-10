import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { Catalog, Source } from '../types.js';
import { buildCatalog, loadSources, type ExternalResources } from '../core/sources.js';
import { loadSettings } from '../core/settings.js';
import { readLock } from '../core/lock.js';
import { CLAUDE_NATIVE_SOURCE, CODEX_NATIVE_SOURCE, COPILOT_NATIVE_SOURCE } from '../core/platform.js';
import { makeKey } from '../core/item-key.js';
import { createCatalogWorker, type CatalogWorkerResult } from '../core/catalog-worker.js';
import { loadCatalogSnapshots, NATIVE_SOURCES, EMPTY_RESOURCES } from '../core/catalog-snapshot.js';
import type { ItemData } from '../components/ItemRow.js';

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
  //
  // Plugin dedupe only collapses a plugin's *natively-installed twin* (the
  // synthetic claude/codex/copilot sources, iterated last) against a configured
  // source that already provides the same plugin name. Two configured sources
  // that both carry a plugin — e.g. two branches of one repo, `ai_resources`
  // and `ai_resources-bar` — each keep their entry, exactly like skills/agents,
  // so the user can see and pick a specific branch.
  const NATIVE_PLUGIN_SOURCES = new Set<string>([CLAUDE_NATIVE_SOURCE, CODEX_NATIVE_SOURCE, COPILOT_NATIVE_SOURCE]);
  const merged: ExternalResources = { skills: [], agents: [], mcps: [], bundles: [], commands: [], plugins: [], herdr: [], warnings: [] };
  const configuredPluginNames = new Set<string>();
  const seenNativePluginNames = new Set<string>();
  for (const name of sourceOrder) {
    const r = perSource.get(name);
    if (!r) continue;
    merged.skills.push(...r.skills);
    merged.agents.push(...r.agents);
    merged.mcps.push(...r.mcps);
    merged.bundles.push(...r.bundles);
    merged.commands.push(...r.commands);
    merged.herdr.push(...r.herdr);
    const isNative = NATIVE_PLUGIN_SOURCES.has(name);
    for (const p of r.plugins) {
      if (isNative) {
        // Skip the native twin when a configured source already provides this
        // plugin name; also dedupe natives among themselves (a plugin installed
        // in both Claude and Codex lists once).
        if (configuredPluginNames.has(p.name) || seenNativePluginNames.has(p.name)) continue;
        seenNativePluginNames.add(p.name);
      } else {
        configuredPluginNames.add(p.name);
      }
      merged.plugins.push(p);
    }
    merged.warnings.push(...r.warnings);
  }
  return merged;
}
export function useCatalog() {
  // First paint reads one display snapshot; no directory walks, hashes or provider probes.
  const [initial] = useState(() => {
    const sources = loadSources().sources.filter(isEnabled);
    return { sources, cached: loadCatalogSnapshots(sources) };
  });
  const [snapshots, setSnapshots] = useState(initial.cached.sources);
  const snapshotsRef = useRef(snapshots);
  const [sourceOrder, setSourceOrder] = useState(() => [...initial.sources.map(s => s.name), ...NATIVE_SOURCES]);
  const [sourceStatus, setSourceStatus] = useState<Map<string, SourceFetchStatus>>(() =>
    new Map(initial.sources.map(s => [s.name, 'fetching'])),
  );
  const [targetLabels, setTargetLabels] = useState(initial.cached.targetLabels);
  const [nativeLoading, setNativeLoading] = useState(true);
  const [lock, setLock] = useState(readLock);
  const [failures, setFailures] = useState<Record<string, ExternalResources['warnings'][number]>>({});
  const workerRef = useRef<ReturnType<typeof createCatalogWorker> | null>(null);
  const mounted = useRef(true);
  // Per-source revisions let independent refreshes finish without cancelling each other.
  const revisions = useRef(new Map<string, number>());
  const nextRevision = (name: string) => {
    const revision = (revisions.current.get(name) ?? 0) + 1;
    revisions.current.set(name, revision);
    return revision;
  };
  const worker = () => workerRef.current ?? (workerRef.current = createCatalogWorker());

  const accept = useCallback((result: CatalogWorkerResult) => {
    snapshotsRef.current = { ...snapshotsRef.current, ...result.snapshots };
    setSnapshots(snapshotsRef.current);
    setTargetLabels(result.targetLabels);
  }, []);

  const external = useMemo(() => mergePerSource(
    new Map(Object.entries(snapshots).map(([name, snapshot]) => [name, snapshot.resources])),
    sourceOrder,
  ), [snapshots, sourceOrder]);
  const catalog: Catalog = useMemo(() => buildCatalog(external), [external]);
  const allItems = useMemo(() => {
    const items = new Map(Object.values(snapshots).flatMap(snapshot => snapshot.items).map(item => [item.key, item]));
    const ordered: ItemData[] = [];
    for (const [type, entries] of [
      ['plugin', catalog.plugins], ['herdr', catalog.herdr], ['bundle', catalog.bundles],
      ['skill', catalog.skills], ['agent', catalog.agents], ['mcp', catalog.mcps], ['command', catalog.commands],
    ] as const) {
      for (const entry of entries) {
        const item = items.get(makeKey(type, entry.source, entry.name));
        if (item) ordered.push(item);
      }
    }
    return ordered;
  }, [catalog, snapshots]);

  const fetchOneSource = useCallback(async (source: Source, forceRefresh: boolean): Promise<ExternalResources> => {
    if (!mounted.current) return EMPTY_RESOURCES;
    const revision = nextRevision(source.name);
    const current = () => mounted.current && revisions.current.get(source.name) === revision;
    setSourceStatus(prev => new Map(prev).set(source.name, 'fetching'));
    setFailures(prev => { const next = { ...prev }; delete next[source.name]; return next; });
    try {
      const result = await worker().request({ kind: 'source', source, forceRefresh }, progress => {
        if (current()) accept(progress);
      });
      const resources = result.snapshots[source.name].resources;
      if (current()) {
        accept(result);
        setSourceStatus(prev => new Map(prev).set(source.name, resources.warnings.length > 0 ? 'error' : 'ready'));
      }
      return resources;
    } catch (error: unknown) {
      const previous = snapshotsRef.current[source.name];
      const warning = { name: source.name, message: error instanceof Error ? error.message : String(error), usedCache: !!previous };
      if (current()) {
        setSourceStatus(prev => new Map(prev).set(source.name, 'error'));
        setFailures(prev => ({ ...prev, [source.name]: warning }));
      }
      return { ...(previous?.resources ?? EMPTY_RESOURCES), warnings: [warning] };
    }
  }, [accept]);

  const refreshNative = useCallback(async () => {
    const revision = nextRevision('native');
    setNativeLoading(true);
    try {
      const result = await worker().request({ kind: 'native' });
      if (mounted.current && revisions.current.get('native') === revision) accept(result);
      return result;
    } catch (error: unknown) {
      if (mounted.current) setFailures(prev => ({ ...prev, native: {
        name: 'native', message: error instanceof Error ? error.message : String(error),
        usedCache: NATIVE_SOURCES.some(name => !!snapshotsRef.current[name]),
      } }));
      return null;
    } finally {
      if (mounted.current && revisions.current.get('native') === revision) setNativeLoading(false);
    }
  }, [accept]);

  useEffect(() => {
    mounted.current = true;
    // Let Ink paint first. All expensive work then runs on the worker thread.
    const timer = setTimeout(() => {
      void runWithConcurrency(initial.sources, loadSettings().sourceConcurrency, source => fetchOneSource(source, false));
      void refreshNative();
    }, 0);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      workerRef.current?.stop();
      workerRef.current = null;
    };
  }, [initial, fetchOneSource, refreshNative]);

  const refreshLock = useCallback(() => {
    setLock(readLock());
    const current = snapshotsRef.current;
    void worker().request({ kind: 'prepare', snapshots: current }).then(result => {
      if (!mounted.current) return;
      // New source data wins over an installed-state refresh of an older snapshot.
      result.snapshots = Object.fromEntries(Object.entries(result.snapshots).filter(
        ([name]) => snapshotsRef.current[name] === current[name],
      ));
      accept(result);
    }).catch((error: unknown) => {
      if (mounted.current) setFailures(prev => ({ ...prev, installed: {
        name: 'installed', message: error instanceof Error ? error.message : String(error), usedCache: true,
      } }));
    });
  }, [accept]);

  const refreshExternal = useCallback(async (forceRefresh = false): Promise<ExternalResources> => {
    const enabled = loadSources().sources.filter(isEnabled);
    const order = [...enabled.map(s => s.name), ...NATIVE_SOURCES];
    setSourceOrder(order);
    setFailures({});
    const results = new Map<string, ExternalResources>();
    const native = refreshNative();
    await runWithConcurrency(enabled, loadSettings().sourceConcurrency, async source => {
      results.set(source.name, await fetchOneSource(source, forceRefresh));
    });
    const nativeResult = await native;
    for (const [name, snapshot] of Object.entries(nativeResult?.snapshots ?? {})) results.set(name, snapshot.resources);
    return mergePerSource(results, order);
  }, [fetchOneSource, refreshNative]);

  const refreshSingleSource = useCallback(async (source: Source, forceRefresh: boolean): Promise<void> => {
    await fetchOneSource(source, forceRefresh);
  }, [fetchOneSource]);

  const forgetSource = useCallback((name: string): void => {
    nextRevision(name);
    const next = { ...snapshotsRef.current };
    delete next[name];
    snapshotsRef.current = next;
    setSnapshots(next);
    setSourceStatus(prev => { const next = new Map(prev); next.delete(name); return next; });
    setFailures(prev => { const next = { ...prev }; delete next[name]; return next; });
    setSourceOrder(prev => prev.filter(n => n !== name));
  }, []);

  const adoptSource = useCallback((source: Source): void => {
    const enabled = loadSources().sources.filter(isEnabled);
    setSourceOrder([...enabled.map(s => s.name), ...NATIVE_SOURCES]);
    const cached = loadCatalogSnapshots([source]).sources[source.name];
    if (cached) {
      snapshotsRef.current = { ...snapshotsRef.current, [source.name]: cached };
      setSnapshots(snapshotsRef.current);
    }
    // SourcesTab requests a background scan immediately after adopting.
    setSourceStatus(prev => new Map(prev).set(source.name, 'fetching'));
  }, []);

  const installedItems = useMemo(() => allItems.filter(item => item.installed), [allItems]);
  const loading = nativeLoading || Array.from(sourceStatus.values()).some(status => status === 'fetching');
  const initialLoading = Object.keys(initial.cached.sources).length === 0 && allItems.length === 0 && loading;

  return {
    catalog, lock, allItems, installedItems, targetLabels, refreshLock, refreshExternal,
    refreshSingleSource, forgetSource, adoptSource, sourceStatus, loading, initialLoading,
    sourceWarnings: [...external.warnings, ...Object.values(failures)],
  };
}

async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) await fn(items[nextIndex++]);
  }));
}
