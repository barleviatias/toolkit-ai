import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { SearchInput } from '../components/SearchInput.js';
import { ItemList } from '../components/ItemList.js';
import { DetailView } from '../components/DetailView.js';
import { StatusBar } from '../components/StatusBar.js';
import type { ItemData } from '../components/ItemRow.js';
import type { Catalog } from '../types.js';
import { installSkill, installAgent, installMcp, installPlugin, installExternalSkill } from '../core/installer.js';
import { removeSkill, removeAgent, removeMcp, removePlugin } from '../core/remover.js';

interface BrowseTabProps {
  items: ItemData[];
  catalog: Catalog;
  toolkitDir: string;
  onRefresh: () => void;
}

export const BrowseTab: React.FC<BrowseTabProps> = ({
  items,
  catalog,
  toolkitDir,
  onRefresh,
}) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<ItemData | null>(null);
  const [message, setMessage] = useState('');
  const [focus, setFocus] = useState<'list' | 'search'>('list');

  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      i => i.name.toLowerCase().includes(q) ||
           i.description.toLowerCase().includes(q) ||
           i.type.toLowerCase().includes(q)
    );
  }, [items, query]);

  // Focus switching: / to search, Escape to list
  useInput((input, key) => {
    if (detailItem) return;
    if (focus === 'search') {
      if (key.escape || key.downArrow) {
        setFocus('list');
      }
    } else {
      if (input === '/') {
        setFocus('search');
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

  const doInstall = useCallback((key: string) => {
    const item = filtered.find(i => i.key === key) || items.find(i => i.key === key);
    if (!item) { setMessage(`Error: item not found`); return; }

    // Block install if scanner flagged it
    if (item.scanStatus === 'block') {
      setMessage(`✕ Blocked: ${item.scanSummary || 'Security issues detected'}`);
      return;
    }

    const { type, name, source } = item;
    try {
      if (source !== 'internal' && type === 'skill' && item.path && item.hash) {
        // External skill — install from cache
        installExternalSkill(source, name, item.path, item.hash, { force: false }, () => {});
      } else if (type === 'skill')  installSkill(catalog, toolkitDir, name, { force: false }, () => {});
      else if (type === 'agent')    installAgent(catalog, toolkitDir, name, { force: false }, () => {});
      else if (type === 'mcp')      installMcp(catalog, toolkitDir, name, { force: false }, () => {});
      else if (type === 'plugin')   installPlugin(catalog, toolkitDir, name, { force: false }, () => {});
      setMessage(`Installed ${type} ${name}`);
      onRefresh();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
  }, [catalog, toolkitDir, items, filtered, onRefresh]);

  const doRemove = useCallback((key: string) => {
    const parts = key.split(':');
    const type = parts[0];
    const name = parts[parts.length - 1];
    try {
      if (type === 'skill')       removeSkill(catalog, name, () => {});
      else if (type === 'agent')  removeAgent(catalog, name, () => {});
      else if (type === 'mcp')    removeMcp(catalog, name, () => {});
      else if (type === 'plugin') removePlugin(catalog, name, () => {});
      setMessage(`Removed ${type} ${name}`);
      onRefresh();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
  }, [catalog, onRefresh]);

  const handleSubmit = useCallback((keys: string[]) => {
    for (const key of keys) {
      doInstall(key);
    }
    setSelected(new Set());
  }, [doInstall]);

  if (detailItem) {
    return (
      <DetailView
        item={detailItem}
        onBack={() => setDetailItem(null)}
        onInstall={(key) => { doInstall(key); setDetailItem(null); }}
        onRemove={(key) => { doRemove(key); setDetailItem(null); }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Browse ({filtered.length}/{items.length})</Text>
      <SearchInput
        value={query}
        onChange={setQuery}
        isFocused={focus === 'search'}
        total={items.length}
        filtered={filtered.length}
      />
      <ItemList
        items={filtered}
        selected={selected}
        onToggle={handleToggle}
        onSubmit={handleSubmit}
        onDetail={setDetailItem}
        isFocused={focus === 'list'}
      />
      {message && <Text color={message.startsWith('✕') ? 'red' : 'green'}>  {message}</Text>}
      <StatusBar
        selectedCount={selected.size}
        hints="/ to search · Esc to list · Space to toggle · Enter for details · Tab to switch · q to quit"
      />
    </Box>
  );
};
