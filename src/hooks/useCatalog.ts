import path from 'path';
import { useState, useMemo, useEffect } from 'react';
import type { Catalog, CatalogEntry } from '../types.js';
import { loadMcpConfig, loadBundleConfig } from '../core/catalog.js';
import { extractMcpServers } from '../core/sources.js';
import { readLock } from '../core/lock.js';
import { fetchExternalResources, buildCatalog, type ExternalResources } from '../core/sources.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig } from '../core/scanner.js';
import { CACHE_DIR } from '../core/platform.js';
import { makeKey } from '../core/item-key.js';
import { getInstalledState } from '../core/installed-state.js';
import type { ItemData } from '../components/ItemRow.js';

// Module-level cache for security scan results, keyed by "type:source:hash".
// Scan results only change when item content changes (new hash), so this is safe
// to persist across renders and avoids expensive filesystem I/O on every state change.
const scanCache = new Map<string, { scanStatus: 'ok' | 'warn' | 'block'; scanSummary?: string }>();

function loadExternalState(forceRefresh = false): ExternalResources {
  try {
    return fetchExternalResources(forceRefresh);
  } catch {
    return { skills: [], agents: [], mcps: [], bundles: [] };
  }
}

const EMPTY_EXTERNAL: ExternalResources = { skills: [], agents: [], mcps: [], bundles: [] };

export function useCatalog() {
  // Start empty so Ink can render the shell + spinner on first paint. The
  // initial git clones are synchronous (spawnSync) and block for 5-30s on a
  // fresh install, so deferring them past first paint is essential UX.
  const [external, setExternal] = useState<ExternalResources>(EMPTY_EXTERNAL);
  const [loading, setLoading] = useState(true);
  const [lock, setLock] = useState(() => readLock());
  const catalog: Catalog = useMemo(() => buildCatalog(external), [external]);
  const installedState = useMemo(() => getInstalledState(catalog, lock), [catalog, lock]);

  useEffect(() => {
    // setTimeout(0) yields to Ink so the spinner renders before the clone blocks.
    const t = setTimeout(() => {
      setExternal(loadExternalState());
      setLoading(false);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const refreshLock = () => setLock(readLock());
  const refreshExternal = (forceRefresh = false) => {
    if (forceRefresh) scanCache.clear();
    setLoading(true);
    setTimeout(() => {
      setExternal(loadExternalState(forceRefresh));
      setLoading(false);
    }, 0);
  };

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

  return { catalog, lock, allItems, installedItems, refreshLock, refreshExternal, loading };
}
