import path from 'path';
import { useState, useMemo } from 'react';
import type { Catalog, CatalogEntry } from '../types.js';
import { loadCatalog, loadMcpConfig } from '../core/catalog.js';
import { readLock } from '../core/lock.js';
import { fetchExternalSkills } from '../core/sources.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig } from '../core/scanner.js';
import { CACHE_DIR } from '../core/platform.js';
import type { ItemData } from '../components/ItemRow.js';

export function useCatalog(toolkitDir: string) {
  const [catalog] = useState<Catalog>(() => loadCatalog(toolkitDir));
  const [externalSkills] = useState<CatalogEntry[]>(() => {
    try { return fetchExternalSkills(); } catch { return []; }
  });
  const [lock, setLock] = useState(() => readLock());

  const refreshLock = () => setLock(readLock());

  // Check if an item is installed (by lock-format key: "type:name")
  function isInstalled(lockKey: string): boolean {
    if (lock.installed[lockKey]) return true;
    for (const [k, v] of Object.entries(lock.installed)) {
      if (k.startsWith('plugin:') && v.items?.[lockKey]) return true;
    }
    return false;
  }

  // Build flat item list for the Browse tab (with security scan results)
  const allItems: ItemData[] = useMemo(() => {
    const items: ItemData[] = [];

    function scanItem(type: string, entry: CatalogEntry): { scanStatus: 'ok' | 'warn' | 'block'; scanSummary?: string } {
      const src = entry.source || 'internal';
      const isInternal = src === 'internal';
      const trusted = isInternal;

      try {
        let report;
        if (type === 'skill') {
          const skillDir = isInternal
            ? path.join(toolkitDir, entry.path)
            : path.join(CACHE_DIR, src, entry.path);
          report = scanSkillDir(skillDir, entry.name, src, { trusted });
        } else if (type === 'agent') {
          const agentPath = path.join(toolkitDir, entry.path);
          report = scanAgentFile(agentPath, entry.name, src, { trusted });
        } else if (type === 'mcp') {
          const mcpConfig = loadMcpConfig(toolkitDir, entry);
          report = scanMcpConfig({ name: entry.name, transport: mcpConfig.transport, url: mcpConfig.url }, src);
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
      const src = entry.source || 'internal';
      const uiKey = `${type}:${src}:${entry.name}`;
      const lockKey = `${type}:${entry.name}`;
      const { scanStatus, scanSummary } = scanItem(type, entry);
      return {
        key: uiKey,
        type,
        name: entry.name,
        description: entry.description,
        source: src,
        installed: isInstalled(lockKey),
        path: entry.path,
        hash: entry.hash,
        scanStatus,
        scanSummary,
      };
    }

    // Internal items
    for (const s of catalog.skills) items.push(toItem('skill', s));
    for (const a of catalog.agents) items.push(toItem('agent', a));
    for (const m of catalog.mcps)   items.push(toItem('mcp', m));
    for (const p of catalog.plugins) items.push(toItem('plugin', p));

    // External skills from configured sources
    for (const s of externalSkills) items.push(toItem('skill', s));

    return items;
  }, [catalog, externalSkills, lock]);

  // Installed items for the Installed tab
  const installedItems: ItemData[] = useMemo(() => {
    return allItems.filter(i => i.installed);
  }, [allItems]);

  // Update status items
  const updateItems: ItemData[] = useMemo(() => {
    const items: ItemData[] = [];
    for (const [lockKey, lockEntry] of Object.entries(lock.installed)) {
      if (lockKey.startsWith('plugin:')) {
        for (const [itemKey, itemEntry] of Object.entries(lockEntry.items || {})) {
          const [type, name] = itemKey.split(':');
          const catalogList = type === 'skill' ? catalog.skills :
                              type === 'agent' ? catalog.agents :
                              type === 'mcp'   ? catalog.mcps : [];
          const catalogItem = catalogList.find(e => e.name === name);
          if (catalogItem && catalogItem.hash !== itemEntry.hash) {
            items.push({
              key: `${itemKey}:update`,
              type,
              name,
              description: catalogItem.description,
              source: 'internal',
              installed: true,
              hasUpdate: true,
            });
          }
        }
      } else {
        const [type, name] = lockKey.split(':');
        const catalogList = type === 'skill' ? catalog.skills :
                            type === 'agent' ? catalog.agents :
                            type === 'mcp'   ? catalog.mcps : [];
        const catalogItem = catalogList.find(e => e.name === name);
        if (catalogItem && catalogItem.hash !== lockEntry.hash) {
          items.push({
            key: `${lockKey}:update`,
            type,
            name,
            description: catalogItem.description,
            source: 'internal',
            installed: true,
            hasUpdate: true,
          });
        }
      }
    }
    return items;
  }, [catalog, lock]);

  return { catalog, lock, allItems, installedItems, updateItems, refreshLock };
}
