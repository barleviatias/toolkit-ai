import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { ItemList } from '../components/ItemList.js';
import { DetailView } from '../components/DetailView.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { StatusBar } from '../components/StatusBar.js';
import { parseKey } from '../core/item-key.js';
import type { ItemData } from '../components/ItemRow.js';
import type { SourcesConfig, Catalog } from '../types.js';
import { loadSources, addSource, removeSource, setSourceEnabled, parseSourceInput, type ExternalResources } from '../core/sources.js';
import type { Source } from '../types.js';
import { installSkill, installAgent, installMcp, installBundle } from '../core/installer.js';
import { removeSkill, removeAgent, removeMcp } from '../core/remover.js';
import { useMarkEscConsumed } from '../hooks/useEscContext.js';
import { useRunBusy } from '../hooks/useRunBusy.js';
import type { SourceFetchStatus } from '../hooks/useCatalog.js';
import { needsConsent, buildConsentPrompt, resolveBundleChildren } from './install-consent.js';

import { IS_DEV_BUILD, TOOLKIT_VERSION, CACHE_DIR } from '../core/platform.js';
import fs from 'fs';
import path from 'path';

interface SourcesTabProps {
  allItems: ItemData[];
  catalog: Catalog;
  sourceStatus: Map<string, SourceFetchStatus>;
  onRefresh: () => void;
  onRefreshSources: (forceRefresh?: boolean) => Promise<ExternalResources>;
  onRefreshSingleSource: (source: Source, forceRefresh: boolean) => Promise<void>;
  onForgetSource: (name: string) => void;
  onAdoptSource: (source: Source) => void;
}

function countResources(resources: ExternalResources): number {
  return resources.skills.length + resources.agents.length + resources.mcps.length + resources.bundles.length;
}

function formatRefreshMessage(resources: ExternalResources, label: string): string {
  const total = countResources(resources);
  if (resources.warnings.length === 0) {
    return `${label} (${total} item${total === 1 ? '' : 's'})`;
  }
  const cached = resources.warnings.filter(warning => warning.usedCache).length;
  const cacheNote = cached > 0 ? `${cached} kept cached data` : 'some sources unavailable';
  return `${label} with ${resources.warnings.length} warning${resources.warnings.length === 1 ? '' : 's'} (${cacheNote})`;
}

export const SourcesTab: React.FC<SourcesTabProps> = ({
  allItems,
  catalog,
  sourceStatus,
  onRefresh,
  onRefreshSources,
  onRefreshSingleSource,
  onForgetSource,
  onAdoptSource,
}) => {
  const [config, setConfig] = useState<SourcesConfig>(() => loadSources());
  const [mode, setMode] = useState<'list' | 'add' | 'browse'>('list');
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('');
  const [cursor, setCursor] = useState(0);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<ItemData | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ title: string; items: string[]; onConfirm: () => void } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const markEscConsumed = useMarkEscConsumed();
  const runBusy = useRunBusy(setBusy, setMessage);

  const refresh = useCallback(() => {
    setConfig(loadSources());
    onRefresh();
  }, [onRefresh]);

  // Items from the active source
  const sourceItems = useMemo(() => {
    if (!activeSource) return [];
    return allItems.filter(i => i.source === activeSource);
  }, [allItems, activeSource]);

  useInput((ch, key) => {
    if (detailItem || confirmAction) return;
    // `busy` only gates synchronous install/remove flows. Fetches now run in
    // the background via the per-source streaming hooks, so the user can keep
    // browsing, toggling, and quitting while clones are in flight.
    if (busy) return;

    if (mode === 'list') {
      if (ch === 'f') {
        // Background refresh: don't block input, don't wipe the catalog.
        // Per-source status badges show progress; existing items stay visible.
        setMessage('Refreshing sources in background…');
        void onRefreshSources(true).then(resources => {
          refresh();
          setMessage(formatRefreshMessage(resources, 'Sources refreshed'));
        });
      } else if (ch === 'a') {
        setMode('add');
        setInput('');
      } else if (ch === 'd' && config.sources.length > 0) {
        const source = config.sources[cursor];
        if (source) {
          const nextEnabled = source.enabled === false;
          // Instant toggle: persist to disk + flip in-memory state. Only fetch
          // if enabling and we don't have usable cache yet.
          setSourceEnabled(source.name, nextEnabled);
          refresh();
          if (nextEnabled) {
            onAdoptSource({ ...source, enabled: true });
            // No cache → kick off a background fetch so the source's items
            // appear when ready. Cache present → already showing, nothing to do.
            const cachePath = path.join(CACHE_DIR, source.name);
            if (!fs.existsSync(cachePath)) {
              void onRefreshSingleSource({ ...source, enabled: true }, false);
            }
            setMessage(`Enabled source: ${source.name}`);
          } else {
            onForgetSource(source.name);
            setMessage(`Disabled source: ${source.name}`);
          }
        }
      } else if (ch === 'r' && config.sources.length > 0) {
        const source = config.sources[cursor];
        if (source) {
          setConfirmAction({
            title: `Remove source '${source.name}'?`,
            items: [
              `${source.type}: ${source.repo || source.path}`,
              'Deletes the source config and its cache. Installed items stay put.',
            ],
            onConfirm: () => {
              setConfirmAction(null);
              removeSource(source.name);
              onForgetSource(source.name);
              refresh();
              setCursor(c => Math.max(0, c - 1));
              setMessage(`Removed source: ${source.name}`);
            },
          });
        }
      } else if (key.upArrow) {
        setCursor(c => Math.max(0, c - 1));
      } else if (key.downArrow) {
        setCursor(c => Math.min(config.sources.length - 1, c + 1));
      } else if (key.return && config.sources.length > 0) {
        const source = config.sources[cursor];
        if (source) {
          setActiveSource(source.name);
          setMode('browse');
          setSelected(new Set());
        }
      }
    } else if (mode === 'add') {
      if (key.escape) {
        markEscConsumed();
        setMode('list');
      } else if (key.return && input.trim()) {
        const source = parseSourceInput(input.trim());
        // Non-blocking add: persist + return to list immediately. The new
        // source row shows "⟳ fetching" via sourceStatus while the clone runs.
        addSource(source);
        onAdoptSource(source);
        refresh();
        setMessage(`Added source: ${source.name} — fetching in background…`);
        setInput('');
        setMode('list');
        void onRefreshSingleSource(source, false).then(() => {
          setMessage(`Source ready: ${source.name}`);
        });
      }
    } else if (mode === 'browse') {
      if (key.escape) {
        markEscConsumed();
        setMode('list');
        setActiveSource(null);
        setSelected(new Set());
      }
    }
  });

  const handleToggle = useCallback((key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const runInstall = useCallback((item: ItemData) => {
    const { type, name } = item;
    try {
      if (type === 'skill') installSkill(catalog, name, { force: false }, () => {});
      else if (type === 'agent') installAgent(catalog, name, { force: false }, () => {});
      else if (type === 'mcp') installMcp(catalog, name, { force: false }, () => {});
      else if (type === 'bundle') installBundle(catalog, name, { force: false }, () => {});
      else {
        setMessage(`Error: ${type} ${name} cannot be installed`);
        return;
      }
      setMessage(`Installed ${type} ${name}`);
      onRefresh();
    } catch (e: unknown) {
      setMessage(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [catalog, onRefresh]);

  const doInstall = useCallback((item: ItemData) => {
    // Route through the same consent dialog as CatalogTab so a user browsing
    // a source can't accidentally install an stdio MCP without seeing the
    // command that will run on every agent session.
    const children = resolveBundleChildren(item, allItems);
    if (needsConsent(item, children)) {
      const prompt = buildConsentPrompt(item, children);
      setConfirmAction({
        title: prompt.title,
        items: prompt.lines,
        onConfirm: () => {
          setConfirmAction(null);
          runInstall(item);
        },
      });
      return;
    }
    runInstall(item);
  }, [allItems, runInstall]);

  const doRemove = useCallback((item: ItemData) => {
    const { type, name } = parseKey(item.key);
    setConfirmAction({
      title: `Remove ${type} ${name}?`,
      items: [`${type} ${name}`],
      onConfirm: () => {
        try {
          if (type === 'skill')       removeSkill(catalog, name, () => {});
          else if (type === 'agent')  removeAgent(catalog, name, () => {});
          else if (type === 'mcp')    removeMcp(catalog, name, () => {});
          setMessage(`Removed ${type} ${name}`);
          onRefresh();
        } catch (e: unknown) {
          setMessage(`Error: ${e instanceof Error ? e.message : String(e)}`);
        }
        setConfirmAction(null);
      },
    });
  }, [catalog, onRefresh]);

  const handleSubmit = useCallback((keys: string[]) => {
    const itemsToInstall = keys
      .map(k => sourceItems.find(i => i.key === k))
      .filter((i): i is ItemData => !!i && !i.installed);

    if (itemsToInstall.length === 0) {
      setSelected(new Set());
      setMessage('No selected items need installation');
      return;
    }

    const consentItem = itemsToInstall.find(item => needsConsent(item, resolveBundleChildren(item, allItems)));
    if (consentItem) {
      setMessage(`Install ${consentItem.type} ${consentItem.name} individually to review its safety prompt`);
      return;
    }

    runBusy(`Installing ${itemsToInstall.length} item(s)`, () => {
      for (const item of itemsToInstall) runInstall(item);
      setMessage(`Installed ${itemsToInstall.length} item(s)`);
    });
    setSelected(new Set());
  }, [sourceItems, allItems, runBusy, runInstall]);

  const TYPE_COLORS: Record<string, string> = {
    github: 'white',
    bitbucket: 'blue',
    local: 'yellow',
  };

  // Confirm dialog
  if (confirmAction) {
    return (
      <ConfirmDialog
        title={confirmAction.title}
        items={confirmAction.items}
        onConfirm={confirmAction.onConfirm}
        onCancel={() => setConfirmAction(null)}
      />
    );
  }

  // Detail view for source items
  if (detailItem) {
    return (
      <DetailView
        item={detailItem}
        onBack={() => setDetailItem(null)}
        onInstall={(key) => {
          const item = sourceItems.find(i => i.key === key);
          if (item) doInstall(item);
          setDetailItem(null);
        }}
        onRemove={(key) => {
          const item = sourceItems.find(i => i.key === key);
          if (item) doRemove(item);
          setDetailItem(null);
        }}
      />
    );
  }

  // Browse items from a source
  if (mode === 'browse' && activeSource) {
    const installedCount = sourceItems.filter(i => i.installed).length;

    return (
      <Box flexDirection="column">
        <Text bold>
          Source: <Text color="cyan">{activeSource}</Text>
          <Text dimColor> · {sourceItems.length} item{sourceItems.length !== 1 ? 's' : ''} · {installedCount} installed</Text>
        </Text>
        <ItemList
          items={sourceItems}
          selected={selected}
          onToggle={handleToggle}
          onSubmit={handleSubmit}
          onDetail={setDetailItem}
          onInstall={(item) => doInstall(item)}
          onRemove={(item) => doRemove(item)}
          isFocused={true}
        />
        {message && <Text color={message.startsWith('\u2715') || message.startsWith('Error') ? 'red' : 'green'}>  {message}</Text>}
        <StatusBar
          selectedCount={selected.size}
          hints="Esc back · Space select · Enter details · i install · r remove · Tab switch"
        />
      </Box>
    );
  }

  // Source list
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>Sources ({config.sources.length})</Text>
        <Text dimColor>  ·  ai-toolkit v{TOOLKIT_VERSION}</Text>
        {IS_DEV_BUILD && <Text color="yellow"> dev build</Text>}
      </Box>

      {config.sources.length === 0 && mode === 'list' && (
        <Box marginY={1}>
          <Text dimColor>  No sources configured. Press </Text>
          <Text bold color="cyan">a</Text>
          <Text dimColor> to add one.</Text>
        </Box>
      )}

      <Box flexDirection="column" marginY={1}>
        {config.sources.map((source, i) => {
          const itemCount = allItems.filter(item => item.source === source.name).length;
          const disabled = source.enabled === false;
          const status = sourceStatus.get(source.name);
          return (
            <Box key={source.name} marginLeft={1}>
              <Text color={i === cursor ? 'cyan' : undefined}>
                {i === cursor ? '❯ ' : '  '}
              </Text>
              <Text color={TYPE_COLORS[source.type] || 'white'} bold dimColor={disabled}>{source.type.padEnd(10)}</Text>
              <Text bold={i === cursor} dimColor={disabled}>{source.name}</Text>
              <Text dimColor> · {source.repo || source.path} · {disabled ? 'disabled' : `${itemCount} items`}</Text>
              {!disabled && status === 'fetching' && <Text color="yellow"> · ⟳ fetching</Text>}
              {!disabled && status === 'error' && <Text color="red"> · ! warning</Text>}
            </Box>
          );
        })}
      </Box>

      {mode === 'add' && (
        <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text dimColor>Paste a URL or owner/repo:</Text>
          <Text dimColor>  https://github.com/owner/repo</Text>
          <Text dimColor>  https://bitbucket.org/owner/repo</Text>
          <Text dimColor>  owner/repo</Text>
          <Box marginTop={1}>
            <Text color="cyan">{'> '}</Text>
            <TextInput value={input} onChange={setInput} />
          </Box>
        </Box>
      )}

      {busy && (
        <Text color="yellow">  ⟳ {busy}...<Text dimColor>  (blocking, please wait)</Text></Text>
      )}
      {!busy && message && (
        <Text color={message.startsWith('\u2715') || message.startsWith('Error') ? 'red' : 'green'}>  {message}</Text>
      )}

      <StatusBar hints={
        busy
          ? 'Working…'
          : mode === 'add'
            ? 'Enter to confirm · Esc to cancel'
            : 'Enter browse · a add · d disable/enable · r remove · f refresh · Tab switch · q quit'
      } />
    </Box>
  );
};
