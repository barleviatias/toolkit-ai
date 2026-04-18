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
import { loadSources, addSource, removeSource, setSourceEnabled, parseSourceInput } from '../core/sources.js';
import { installSkill, installAgent, installMcp, installBundle } from '../core/installer.js';
import { removeSkill, removeAgent, removeMcp } from '../core/remover.js';
import { useMarkEscConsumed } from '../hooks/useEscContext.js';
import { useRunBusy } from '../hooks/useRunBusy.js';

const VERSION = process.env.TOOLKIT_VERSION || 'dev';

interface SourcesTabProps {
  allItems: ItemData[];
  catalog: Catalog;
  onRefresh: () => void;
  onRefreshSources: (forceRefresh?: boolean) => void;
}

export const SourcesTab: React.FC<SourcesTabProps> = ({
  allItems,
  catalog,
  onRefresh,
  onRefreshSources,
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
    // Block all input while a blocking op is running — prevents double-submit
    if (busy) return;

    if (mode === 'list') {
      if (ch === 'f') {
        runBusy('Refreshing all sources', () => {
          onRefreshSources(true);
          refresh();
          setMessage('Sources refreshed');
        });
      } else if (ch === 'a') {
        setMode('add');
        setInput('');
      } else if (ch === 'd' && config.sources.length > 0) {
        const source = config.sources[cursor];
        if (source) {
          const nextEnabled = source.enabled === false;
          const label = nextEnabled ? 'Enabling' : 'Disabling';
          runBusy(`${label} ${source.name}`, () => {
            setSourceEnabled(source.name, nextEnabled);
            onRefreshSources(true);
            refresh();
            setMessage(`${nextEnabled ? 'Enabled' : 'Disabled'} source: ${source.name}`);
          });
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
              removeSource(source.name);
              setMessage(`Removed source: ${source.name}`);
              setCursor(c => Math.max(0, c - 1));
              setConfirmAction(null);
              onRefreshSources(true);
              refresh();
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
        runBusy(`Cloning ${source.repo || source.name}`, () => {
          addSource(source);
          onRefreshSources(true);
          refresh();
          setMessage(`Added source: ${source.name} (${source.type}: ${source.repo})`);
          setInput('');
          setMode('list');
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

  const doInstall = useCallback((item: ItemData) => {
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
  }, [onRefresh]);

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

    for (const item of itemsToInstall) {
      doInstall(item);
    }
    setSelected(new Set());
  }, [sourceItems, doInstall]);

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
        {message && <Text color={message.startsWith('\u2715') ? 'red' : 'green'}>  {message}</Text>}
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
        <Text dimColor>  ·  ai-toolkit v{VERSION}</Text>
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
          return (
            <Box key={source.name} marginLeft={1}>
              <Text color={i === cursor ? 'cyan' : undefined}>
                {i === cursor ? '❯ ' : '  '}
              </Text>
              <Text color={TYPE_COLORS[source.type] || 'white'} bold dimColor={disabled}>{source.type.padEnd(10)}</Text>
              <Text bold={i === cursor} dimColor={disabled}>{source.name}</Text>
              <Text dimColor> · {source.repo || source.path} · {disabled ? 'disabled' : `${itemCount} items`}</Text>
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
        <Text color={message.startsWith('\u2715') ? 'red' : 'green'}>  {message}</Text>
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
