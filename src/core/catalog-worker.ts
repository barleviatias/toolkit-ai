import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { Source } from '../types.js';
import type { CatalogSnapshot } from './catalog-snapshot.js';

declare const __TOOLKIT_BUNDLED__: boolean;

type CatalogJob =
  | { kind: 'source'; source: Source; forceRefresh: boolean }
  | { kind: 'native' }
  | { kind: 'prepare'; snapshots: Record<string, CatalogSnapshot> };

export interface CatalogWorkerResult {
  snapshots: Record<string, CatalogSnapshot>;
  targetLabels: string[];
}

interface Request { id: number; job: CatalogJob }
interface Response { id: number; result?: CatalogWorkerResult; error?: string; progress?: boolean }

/** Run filesystem-heavy catalog work outside Ink's event loop, in the same published executable. */
export function createCatalogWorker() {
  const entry = typeof __TOOLKIT_BUNDLED__ !== 'undefined' && __TOOLKIT_BUNDLED__
    ? new URL(import.meta.url)
    : new URL('./catalog-worker.js', import.meta.url);
  const worker = new Worker(entry, { workerData: { toolkitCatalog: true }, stdout: true, stderr: true });
  worker.stdout.resume();
  worker.stderr.resume();
  let nextId = 0;
  let stopped = false;
  const pending = new Map<number, {
    resolve: (result: CatalogWorkerResult) => void;
    reject: (error: Error) => void;
    progress?: (result: CatalogWorkerResult) => void;
  }>();
  const fail = (error: Error) => {
    stopped = true;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  worker.on('error', fail);
  worker.on('exit', code => fail(new Error(`Catalog worker exited (${code})`)));
  worker.on('message', (message: Response) => {
    const request = pending.get(message.id);
    if (!request) return;
    if (message.progress && message.result) {
      request.progress?.(message.result);
      return;
    }
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else if (message.result) request.resolve(message.result);
    else request.reject(new Error('Empty catalog worker response'));
  });
  return {
    request(job: CatalogJob, progress?: (result: CatalogWorkerResult) => void): Promise<CatalogWorkerResult> {
      if (stopped) return Promise.reject(new Error('Catalog worker is unavailable'));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, progress });
        worker.postMessage({ id, job } satisfies Request);
      });
    },
    stop(): void {
      fail(new Error('Catalog worker stopped'));
      void worker.terminate();
    },
  };
}

async function serve() {
  const { buildCatalogItems } = await import('./catalog-items.js');
  const { buildCatalog, scanCachedSource, fetchAndScanSource, hasCache, isStale } = await import('./sources.js');
  const { loadCatalogSnapshots, saveCatalogSnapshots, sourceIdentity, EMPTY_RESOURCES } = await import('./catalog-snapshot.js');
  const { scanClaudeInstalledPlugins, scanCodexInstalledPlugins, scanCopilotInstalledPlugins } = await import('./claude-plugins.js');
  const { loadSettings } = await import('./settings.js');
  const { readLock } = await import('./lock.js');
  const { detectToolInstallations } = await import('./platform.js');

  const prepare = (snapshots: Record<string, CatalogSnapshot>, forceScan = false): CatalogWorkerResult => {
    const lock = readLock();
    for (const snapshot of Object.values(snapshots)) {
      snapshot.items = buildCatalogItems(buildCatalog(snapshot.resources), lock, forceScan);
    }
    const targetLabels = detectToolInstallations().filter(target => target.installed).map(target => target.label);
    saveCatalogSnapshots(snapshots, targetLabels);
    return { snapshots, targetLabels };
  };

  parentPort!.on('message', async ({ id, job }: Request) => {
    try {
      let result: CatalogWorkerResult;
      if (job.kind === 'prepare') {
        result = prepare(job.snapshots);
      } else if (job.kind === 'native') {
        result = prepare(Object.fromEntries(([
          ['claude', scanClaudeInstalledPlugins()],
          ['codex', scanCodexInstalledPlugins()],
          ['copilot', scanCopilotInstalledPlugins()],
        ] as const).map(([name, plugins]) => [name, {
          identity: `native:${name}`,
          resources: { ...EMPTY_RESOURCES, plugins }, items: [],
        }])));
      } else {
        const { source, forceRefresh } = job;
        const identity = sourceIdentity(source);
        const settings = loadSettings();
        const cached = loadCatalogSnapshots([source]).sources[source.name];
        // On migration/first launch, show local clone data before waiting for a remote.
        if (!cached && hasCache(source) && !forceRefresh) {
          const local = prepare({ [source.name]: { identity, resources: scanCachedSource(source), items: [] } });
          if (!isStale(source, settings.cacheTTL)) {
            parentPort!.postMessage({ id, result: local } satisfies Response);
            return;
          }
          parentPort!.postMessage({ id, result: local, progress: true } satisfies Response);
        }
        let resources = await fetchAndScanSource(source, settings.cacheTTL, forceRefresh);
        // A failed fetch/scan must not replace the last usable snapshot with an empty catalog.
        if (resources.warnings.length > 0 && cached) {
          resources = { ...cached.resources, warnings: resources.warnings.map(w => ({ ...w, usedCache: true })) };
        }
        result = prepare({ [source.name]: { identity, resources, items: [] } }, forceRefresh);
      }
      parentPort!.postMessage({ id, result } satisfies Response);
    } catch (error: unknown) {
      parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) } satisfies Response);
    }
  });
}

if (!isMainThread && workerData?.toolkitCatalog === true) {
  void serve().catch(error => { throw error; });
}
