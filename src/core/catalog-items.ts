import path from 'path';
import type { Catalog, CatalogEntry, LockEntry, LockFile } from '../types.js';
import type { ItemData } from '../components/ItemRow.js';
import { loadMcpConfig, loadBundleConfig, readPluginContents } from './catalog.js';
import { isClaudePluginInstalled, isCodexPluginInstalled, isCopilotPluginInstalled } from './claude-plugins.js';
import { extractMcpServers } from './sources.js';
import { scanSkillDir, scanAgentFile, scanMcpConfig } from './scanner.js';
import { getInstalledTargetLabelsForType, getSourceRoot, getWritableTargetLabelsForType } from './platform.js';
import { makeKey } from './item-key.js';
import { getInstalledState } from './installed-state.js';
import { loadStartupCache, saveStartupCache, type PluginCacheEntry } from './startup-cache.js';

const { scan: scanCache, plugins: pluginContentsCache } = loadStartupCache();
let startupCacheDirty = false;

/** Build display items off the UI thread, including security and installed-state checks. */
export function buildCatalogItems(catalog: Catalog, lock: LockFile, forceScan = false): ItemData[] {
  if (forceScan) scanCache.clear();
  const installedState = getInstalledState(catalog, lock);
  // Check if an item is installed (by lock-format key: "type:name")
  function isInstalled(lockKey: string): boolean {
    return installedState.installedKeys.has(lockKey);
  }

  // Get installed lock entry for update detection and "last updated" UI.
  function getInstalledEntry(lockKey: string): LockEntry | null {
    if (installedState.recoveredKeys.has(lockKey)) return null;
    if (lock.installed[lockKey]) return lock.installed[lockKey];
    for (const [k, v] of Object.entries(lock.installed)) {
      if ((k.startsWith('bundle:') || k.startsWith('plugin:')) && v.items?.[lockKey]) return v.items[lockKey];
    }
    return null;
  }
  const items: ItemData[] = [];
  const targetLabelsByType: Record<string, string[]> = {
    skill: getWritableTargetLabelsForType('skill'),
    agent: getWritableTargetLabelsForType('agent'),
    mcp: getWritableTargetLabelsForType('mcp'),
    bundle: getWritableTargetLabelsForType('bundle'),
    command: getWritableTargetLabelsForType('command'),
    plugin: getWritableTargetLabelsForType('plugin'),
    herdr: [],
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
        const skillDir = path.join(getSourceRoot(src), entry.path);
        report = scanSkillDir(skillDir, entry.name, src, { trusted: false });
      } else if (type === 'agent') {
        const agentPath = path.join(getSourceRoot(src), entry.path);
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
    startupCacheDirty = true;
    return result;
  }

  function toItem(type: string, entry: CatalogEntry): ItemData {
    const src = entry.source;
    const uiKey = makeKey(type, src, entry.name);
    const lockKey = `${type}:${entry.name}`;
    const installed = isInstalled(lockKey);
    const installedEntry = installed ? getInstalledEntry(lockKey) : null;
    const installedHash = installedEntry?.hash ?? null;
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
      version: entry.version,
      source: src,
      installed,
      hasUpdate,
      path: entry.path,
      hash: entry.hash,
      scanStatus,
      scanSummary,
      trackedByLock: !installedState.recoveredKeys.has(lockKey),
      lastUpdatedAt: installedEntry?.installedAt,
      targetLabels: targetLabelsByType[type] || [],
      installedTargetLabels,
    };

    // Per-target install state — populated for every primitive so the UI
    // can render a green ✓ / gray ○ row per detected provider in DetailView.
    // Without this, the catalog can't distinguish "installed in Claude only"
    // from "installed everywhere" and the detail view says misleading things
    // like "Will install to: Claude Code" for an item already in Claude.
    const targets = targetLabelsByType[type] || [];
    const installedSet = new Set<string>(installedTargetLabels);

    if (type === 'plugin') {
      // Plugins are special: a plugin from a synthetic native source IS
      // installed in that tool natively (that's how we discovered it).
      // Toolkit-decomposed installs land as sub-items under plugin:<name>;
      // walk those and union per-component installed labels too.
      if (src === 'claude') installedSet.add('Claude Code');
      if (src === 'codex') installedSet.add('Codex');
      if (src === 'copilot') installedSet.add('GitHub Copilot');
      const pluginLockEntry = lock.installed[`plugin:${entry.name}`];
      if (pluginLockEntry?.items) {
        for (const subKey of Object.keys(pluginLockEntry.items)) {
          const [subType, subName] = subKey.split(':');
          for (const label of getInstalledTargetLabelsForType(subType, subName)) {
            installedSet.add(label);
          }
        }
      }
      // Native-registry checks. Plugins toolkit-ai installs natively in
      // Claude / Codex / Copilot don't decompose into ~/.claude/agents/, ~/.agents/skills/,
      // so the sub-item file-presence loop above won't see them. Read the
      // native plugin registries directly — they're the source of truth for
      // "is the plugin installed in this tool".
      if (isClaudePluginInstalled(entry.name)) installedSet.add('Claude Code');
      if (isCodexPluginInstalled(entry.name)) installedSet.add('Codex');
      if (isCopilotPluginInstalled(entry.name)) installedSet.add('GitHub Copilot');
    }

    if (targets.length > 0) {
      item.targetStatus = targets.map(label => ({
        label,
        installed: installedSet.has(label),
      }));
      // Refresh installedTargetLabels to match — picks up plugin-only labels
      // (e.g. "Claude Code" for claude-source plugins) the per-type helper
      // didn't know about.
      item.installedTargetLabels = item.targetStatus.filter(s => s.installed).map(s => s.label);
    }

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

    // Enrich plugin items with the components they install — cached by
    // source:hash so the streaming-startup memo reruns don't re-walk every
    // plugin tree (see pluginContentsCache). Unreadable plugins (native
    // synthetic sources) cache as null so they don't retry FS each rerun.
    if (type === 'plugin') {
      const pcKey = `${src}:${entry.hash}`;
      if (pluginContentsCache.has(pcKey)) {
        const cached = pluginContentsCache.get(pcKey);
        if (cached) item.pluginContents = cached;
      } else {
        let computed: PluginCacheEntry = null;
        try {
          const contents = readPluginContents(path.join(getSourceRoot(src), entry.path));
          computed = {
            skills: contents.skills.map(s => s.name),
            agents: contents.agents.map(a => a.name),
            commands: contents.commands.map(c => c.name),
            mcps: contents.mcpConfigs.length,
            hasHooks: contents.hasHooks,
          };
        } catch {
          computed = null; // not readable (native synthetic source)
        }
        pluginContentsCache.set(pcKey, computed);
        startupCacheDirty = true;
        if (computed) item.pluginContents = computed;
      }
    }

    return item;
  }

  for (const p of catalog.plugins) items.push(toItem('plugin', p));
  for (const h of catalog.herdr) items.push(toItem('herdr', h));
  for (const b of catalog.bundles) items.push(toItem('bundle', b));
  for (const s of catalog.skills) items.push(toItem('skill', s));
  for (const a of catalog.agents) items.push(toItem('agent', a));
  for (const m of catalog.mcps) items.push(toItem('mcp', m));
  for (const c of catalog.commands) items.push(toItem('command', c));

  if (startupCacheDirty) {
    saveStartupCache(scanCache, pluginContentsCache);
    startupCacheDirty = false;
  }
  return items;

}
