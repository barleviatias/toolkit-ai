import path from 'path';
import { useState, useMemo } from 'react';
import type { Catalog, CatalogEntry } from '../types.js';
import { loadMcpConfig, loadBundleConfig } from '../core/catalog.js';
import { readLock } from '../core/lock.js';
import { fetchExternalResources, buildCatalog, type ExternalResources } from '../core/sources.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig } from '../core/scanner.js';
import { CACHE_DIR } from '../core/platform.js';
import { makeKey } from '../core/item-key.js';
import type { ItemData } from '../components/ItemRow.js';

function loadExternalState(forceRefresh = false): ExternalResources {
  try {
    return fetchExternalResources(forceRefresh);
  } catch {
    return { skills: [], agents: [], mcps: [], bundles: [] };
  }
}

export function useCatalog() {
  const [external, setExternal] = useState<ExternalResources>(() => loadExternalState());
  const [lock, setLock] = useState(() => readLock());
  const catalog: Catalog = useMemo(() => buildCatalog(external), [external]);

  const refreshLock = () => setLock(readLock());
  const refreshExternal = (forceRefresh = false) => setExternal(loadExternalState(forceRefresh));

  // Check if an item is installed (by lock-format key: "type:name")
  function isInstalled(lockKey: string): boolean {
    if (lock.installed[lockKey]) return true;
    for (const [k, v] of Object.entries(lock.installed)) {
      if (k.startsWith('bundle:') && v.items?.[lockKey]) return true;
    }
    return false;
  }

  // Get installed hash for an item (for update detection)
  function getInstalledHash(lockKey: string): string | null {
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
      const src = entry.source;

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
            const mcpConfig = loadMcpConfig(entry);
            report = scanMcpConfig({ name: entry.name, type: mcpConfig.type, url: mcpConfig.url }, src);
          } catch {}
        }

        if (!report || report.findings.length === 0) return { scanStatus: 'ok' };
        const hasBlock = report.findings.some(f => f.severity === 'block');
        const count = report.findings.length;
        const summary = report.findings.map(f => f.message).join('; ');
        return {
          scanStatus: hasBlock ? 'block' : 'warn',
          scanSummary: `${count} issue${count > 1 ? 's' : ''}: ${summary}`,
        };
      } catch {
        return { scanStatus: 'ok' };
      }
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
      };

      // Enrich MCP items with config details
      if (type === 'mcp') {
        try {
          const mcpConfig = loadMcpConfig(entry);
          item.mcpType = mcpConfig.type;
          item.url = mcpConfig.url;
          item.setupNote = mcpConfig.setupNote;
        } catch {}
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
        } catch {}
      }

      return item;
    }

    for (const s of catalog.skills) items.push(toItem('skill', s));
    for (const a of catalog.agents) items.push(toItem('agent', a));
    for (const m of catalog.mcps) items.push(toItem('mcp', m));
    for (const b of catalog.bundles) items.push(toItem('bundle', b));

    return items;
  }, [catalog, lock]);

  // Installed items for the Installed tab
  const installedItems: ItemData[] = useMemo(() => {
    return allItems.filter(i => i.installed);
  }, [allItems]);

  return { catalog, lock, allItems, installedItems, refreshLock, refreshExternal };
}
