import fs from 'fs';
import path from 'path';
import { useState, useMemo } from 'react';
import type { Catalog, CatalogEntry, MarketplaceManifest } from '../types.js';

type MarketplaceEntry = MarketplaceManifest['plugins'][number];
import { loadMcpConfig, loadBundleConfig, loadPluginManifest, loadMarketplaceManifest, detectPluginFormats } from '../core/catalog.js';
import { readLock } from '../core/lock.js';
import { fetchExternalResources, buildCatalog, type ExternalResources } from '../core/sources.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig, scanPluginDir } from '../core/scanner.js';
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
    return { skills: [], agents: [], mcps: [], bundles: [], plugins: [] } as ExternalResources;
  }
}

export function useCatalog() {
  const [external, setExternal] = useState<ExternalResources>(() => loadExternalState());
  const [lock, setLock] = useState(() => readLock());
  const catalog: Catalog = useMemo(() => buildCatalog(external), [external]);
  const installedState = useMemo(() => getInstalledState(catalog, lock), [catalog, lock]);

  const refreshLock = () => setLock(readLock());
  const refreshExternal = (forceRefresh = false) => {
    if (forceRefresh) scanCache.clear();
    setExternal(loadExternalState(forceRefresh));
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

    // Per-source caches, lifetime of this memo. Avoids reloading marketplace.json
    // per plugin entry and linear-scanning its plugins array on each lookup.
    const marketplaceCache = new Map<string, ReturnType<typeof loadMarketplaceManifest>>();
    const marketplaceEntriesBySourceName = new Map<string, Map<string, MarketplaceEntry>>();
    const getMarketplaceEntry = (sourceCacheDir: string, pluginName: string): MarketplaceEntry | undefined => {
      let byName = marketplaceEntriesBySourceName.get(sourceCacheDir);
      if (!byName) {
        let loaded = marketplaceCache.get(sourceCacheDir);
        if (loaded === undefined) {
          loaded = loadMarketplaceManifest(sourceCacheDir);
          marketplaceCache.set(sourceCacheDir, loaded);
        }
        byName = new Map<string, MarketplaceEntry>();
        if (loaded && Array.isArray(loaded.manifest.plugins)) {
          for (const p of loaded.manifest.plugins) {
            if (p && typeof p.name === 'string') byName.set(p.name, p as MarketplaceEntry);
          }
        }
        marketplaceEntriesBySourceName.set(sourceCacheDir, byName);
      }
      return byName.get(pluginName);
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
            const mcpConfig = loadMcpConfig(entry);
            report = scanMcpConfig({ name: entry.name, type: mcpConfig.type, url: mcpConfig.url }, src);
          } catch {
            // MCP config not loadable — treat as clean
          }
        } else if (type === 'plugin') {
          const pluginDir = path.join(CACHE_DIR, src, entry.path);
          report = scanPluginDir(pluginDir, entry.name, src, { trusted: false });
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
      // Plugins use marketplace-qualified lock keys: `plugin:name@marketplace`
      const lockKey = type === 'plugin' && entry.marketplace
        ? `${type}:${entry.name}@${entry.marketplace}`
        : `${type}:${entry.name}`;
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

      // Enrich MCP items with config details
      if (type === 'mcp') {
        try {
          const mcpConfig = loadMcpConfig(entry);
          item.mcpType = mcpConfig.type;
          item.url = mcpConfig.url;
          item.setupNote = mcpConfig.setupNote;
        } catch {
          // MCP config not loadable — skip enrichment
        }
      }

      // Enrich plugin items: merge plugin.json + marketplace.json entry + filesystem auto-discovery
      if (type === 'plugin') {
        try {
          const pluginDir = path.join(CACHE_DIR, entry.source, entry.path);
          const sourceCacheDir = path.join(CACHE_DIR, entry.source);
          const manifest = loadPluginManifest(pluginDir);
          const formats = entry.formats || detectPluginFormats(pluginDir);

          // Strict:false plugins (like typescript-lsp) have their component declarations
          // in the marketplace entry rather than their own plugin.json. Look it up.
          const mpEntry = getMarketplaceEntry(sourceCacheDir, entry.name);

          // --- Filesystem auto-discovery ---
          const skillsDir = path.join(pluginDir, 'skills');
          const agentsDir = path.join(pluginDir, 'agents');
          const commandsDir = path.join(pluginDir, 'commands');
          const hooksFile = path.join(pluginDir, 'hooks', 'hooks.json');
          const mcpFile = path.join(pluginDir, '.mcp.json');
          const lspFile = path.join(pluginDir, '.lsp.json');

          const fsSkills = fs.existsSync(skillsDir)
            ? fs.readdirSync(skillsDir).filter(f => fs.existsSync(path.join(skillsDir, f, 'SKILL.md')))
            : [];
          const fsCommands = fs.existsSync(commandsDir)
            ? fs.readdirSync(commandsDir).filter((f: string) => f.endsWith('.md')).map((f: string) => f.replace('.md', ''))
            : [];
          const fsAgents = fs.existsSync(agentsDir)
            ? fs.readdirSync(agentsDir).filter((f: string) => f.endsWith('.md') || f.endsWith('.agent.md')).map((f: string) => f.replace('.agent.md', '').replace('.md', ''))
            : [];

          let fsMcps: string[] = [];
          if (fs.existsSync(mcpFile)) {
            try {
              const mcpConfig = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
              // Support both shapes: wrapped { "mcpServers": {...} } and flat { "server-name": {...} }
              // Claude's docs use the wrapped shape, but many real plugins (e.g. firebase) use flat.
              if (mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object') {
                fsMcps = Object.keys(mcpConfig.mcpServers);
              } else {
                // Flat shape: top-level keys are server names (each maps to a config object)
                fsMcps = Object.keys(mcpConfig).filter(k =>
                  typeof mcpConfig[k] === 'object' && mcpConfig[k] !== null
                );
              }
            } catch { /* ignore malformed */ }
          }

          let fsLsp: string[] = [];
          if (fs.existsSync(lspFile)) {
            try {
              const lspConfig = JSON.parse(fs.readFileSync(lspFile, 'utf8'));
              fsLsp = Object.keys(lspConfig);
            } catch { /* ignore malformed */ }
          }

          const fsHooks = fs.existsSync(hooksFile) ? ['hooks.json'] : [];

          // --- Manifest declarations (plugin.json lspServers/mcpServers when inline) ---
          const manifestLsp = typeof manifest.lspServers === 'object' && manifest.lspServers
            ? Object.keys(manifest.lspServers as Record<string, unknown>)
            : [];
          const manifestMcps = typeof manifest.mcpServers === 'object' && manifest.mcpServers
            ? Object.keys(manifest.mcpServers as Record<string, unknown>)
            : [];
          const manifestHooks = typeof manifest.hooks === 'object' && manifest.hooks && !Array.isArray(manifest.hooks)
            ? Object.keys(manifest.hooks as Record<string, unknown>)
            : [];

          // --- Marketplace entry declarations (strict:false plugins) ---
          const mpLsp = mpEntry?.lspServers && typeof mpEntry.lspServers === 'object'
            ? Object.keys(mpEntry.lspServers as Record<string, unknown>)
            : [];
          const mpMcps = mpEntry?.mcpServers && typeof mpEntry.mcpServers === 'object'
            ? Object.keys(mpEntry.mcpServers as Record<string, unknown>)
            : [];
          const mpHooks = mpEntry?.hooks && typeof mpEntry.hooks === 'object' && !Array.isArray(mpEntry.hooks)
            ? Object.keys(mpEntry.hooks as Record<string, unknown>)
            : [];

          // Dedupe unions
          const uniq = (arr: string[]) => Array.from(new Set(arr));
          const skills = uniq(fsSkills);
          const commands = uniq(fsCommands);
          const agents = uniq(fsAgents);
          const mcps = uniq([...fsMcps, ...manifestMcps, ...mpMcps]);
          const lspServers = uniq([...fsLsp, ...manifestLsp, ...mpLsp]);
          const hooks = uniq([...fsHooks, ...manifestHooks, ...mpHooks]);

          item.pluginContents = {
            skills,
            commands,
            agents,
            mcps,
            hooks,
            lspServers,
            version: mpEntry?.version || manifest.version || entry.version,
            author: mpEntry?.author?.name || manifest.author?.name,
            marketplace: entry.marketplace,
            category: mpEntry?.category || manifest.category,
            formats,
          };
        } catch {
          // Plugin enrichment failed — non-fatal, just skip
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

    // Order: skills, plugins, agents, mcps, bundles
    for (const s of catalog.skills) items.push(toItem('skill', s));
    for (const p of catalog.plugins) items.push(toItem('plugin', p));
    for (const a of catalog.agents) items.push(toItem('agent', a));
    for (const m of catalog.mcps) items.push(toItem('mcp', m));
    for (const b of catalog.bundles) items.push(toItem('bundle', b));

    return items;
  }, [catalog, lock, installedState]);

  // Installed items for the Installed tab
  const installedItems: ItemData[] = useMemo(() => {
    return allItems.filter(i => i.installed);
  }, [allItems]);

  return { catalog, lock, allItems, installedItems, refreshLock, refreshExternal };
}
