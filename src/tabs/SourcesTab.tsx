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
import { loadSources, addSource, removeSource, parseSourceInput } from '../core/sources.js';
import { installExternalSkill, installExternalAgent, installExternalMcp, installExternalBundle } from '../core/installer.js';
import { removeSkill, removeAgent, removeMcp } from '../core/remover.js';

const VERSION = process.env.TOOLKIT_VERSION || 'dev';

interface SourcesTabProps {
  allItems: ItemData[];
  catalog: Catalog;
  toolkitDir: string;
  onRefresh: () => void;
  onRefreshSources: (forceRefresh?: boolean) => void;
}

export const SourcesTab: React.FC<SourcesTabProps> = ({
  allItems,
  catalog,
  toolkitDir,
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

    if (mode === 'list') {
      if (ch === 'f') {
        setMessage('Refreshing sources...');
        try {
          onRefreshSources(true);
          setMessage('Sources refreshed');
          refresh();
        } catch (e: any) {
          setMessage(`Error: ${e.message}`);
        }
      } else if (ch === 'a') {
        setMode('add');
        setInput('');
      } else if (ch === 'd' && config.sources.length > 0) {
        const source = config.sources[cursor];
        if (source) {
          removeSource(source.name);
          setMessage(`Removed source: ${source.name}`);
          setCursor(c => Math.max(0, c - 1));
          onRefreshSources(true);
          refresh();
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
        setMode('list');
      } else if (key.return && input.trim()) {
        const source = parseSourceInput(input.trim());
        addSource(source);
        setMessage(`Added source: ${source.name} (${source.type}: ${source.repo})`);
        setInput('');
        setMode('list');
        onRefreshSources(true);
        refresh();
      }
    } else if (mode === 'browse') {
      if (key.escape) {
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
    if (item.scanStatus === 'block') {
      setMessage(`\u2715 Blocked: ${item.scanSummary || 'Security issues detected'}`);
      return;
    }
    const { type, name, source } = item;
    try {
      if (item.path && item.hash) {
        if (type === 'skill')      installExternalSkill(source, name, item.path, item.hash, { force: false }, () => {});
        else if (type === 'agent') installExternalAgent(source, name, item.path, item.hash, { force: false }, () => {});
        else if (type === 'mcp')   installExternalMcp(source, name, item.path, item.hash, { force: false }, () => {});
        else if (type === 'bundle') installExternalBundle(catalog, toolkitDir, source, name, item.path, item.hash, { force: false }, () => {});
        else {
          setMessage(`Error: ${type} ${name} cannot be installed`);
          return;
        }
      }
      setMessage(`Installed ${type} ${name}`);
      onRefresh();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
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
        } catch (e: any) {
          setMessage(`Error: ${e.message}`);
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
          return (
            <Box key={source.name} marginLeft={1}>
              <Text color={i === cursor ? 'cyan' : undefined}>
                {i === cursor ? '❯ ' : '  '}
              </Text>
              <Text color={TYPE_COLORS[source.type] || 'white'} bold>{source.type.padEnd(10)}</Text>
              <Text bold={i === cursor}>{source.name}</Text>
              <Text dimColor> · {source.repo || source.path} · {itemCount} items</Text>
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

      {message && <Text color="green">  {message}</Text>}

      <StatusBar hints={
        mode === 'add'
          ? 'Enter to confirm · Esc to cancel'
          : 'Enter browse · a add · d delete · f refresh sources · Tab switch · q quit'
      } />
    </Box>
  );
};
