import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { SearchInput } from '../components/SearchInput.js';
import { ItemList } from '../components/ItemList.js';
import { DetailView } from '../components/DetailView.js';
import { TypeFilter } from '../components/TypeFilter.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { StatusBar } from '../components/StatusBar.js';
import { parseKey } from '../core/item-key.js';
import { useFilteredItems } from '../hooks/useFilteredItems.js';
import type { ItemData } from '../components/ItemRow.js';
import type { Catalog } from '../types.js';
import { removeSkill, removeAgent, removeMcp, removeBundle, removePlugin } from '../core/remover.js';

interface InstalledTabProps {
  items: ItemData[];
  catalog: Catalog;
  onRefresh: () => void;
}

export const InstalledTab: React.FC<InstalledTabProps> = ({
  items,
  catalog,
  onRefresh,
}) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<ItemData | null>(null);
  const [message, setMessage] = useState('');
  const [focus, setFocus] = useState<'list' | 'search'>('list');
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<{ title: string; items: string[]; onConfirm: () => void } | null>(null);
  const recoveredCount = useMemo(() => items.filter(item => item.trackedByLock === false).length, [items]);

  const { filtered, typeCounts, searchTotal: searchFilteredTotal } = useFilteredItems(items, query, typeFilter);

  const toggleType = useCallback((type: string) => {
    setTypeFilter(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  useInput((input, key) => {
    if (detailItem || confirmAction) return;
    if (focus === 'search') {
      if (key.escape || key.downArrow) setFocus('list');
    } else {
      if (input === '/') setFocus('search');
      else if (input === '1') toggleType('skill');
      else if (input === '2') toggleType('plugin');
      else if (input === '3') toggleType('agent');
      else if (input === '4') toggleType('mcp');
      else if (input === '5') toggleType('bundle');
      else if (input === '0') setTypeFilter(new Set());
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

  const doRemove = useCallback((key: string) => {
    const { type, name } = parseKey(key);
    // For plugins, the remover needs `name@marketplace` — look up the item to get the marketplace
    const item = items.find(i => i.key === key);
    const pluginId = type === 'plugin' && item?.pluginContents?.marketplace
      ? `${name}@${item.pluginContents.marketplace}`
      : name;
    try {
      if (type === 'skill')       removeSkill(catalog, name, () => {});
      else if (type === 'agent')  removeAgent(catalog, name, () => {});
      else if (type === 'mcp')    removeMcp(catalog, name, () => {});
      else if (type === 'bundle') removeBundle(catalog, name, () => {});
      else if (type === 'plugin') removePlugin(catalog, pluginId, () => {});
    } catch (e: unknown) {
      setMessage(`Error removing ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [catalog, items]);

  const handleSubmit = useCallback((keys: string[]) => {
    const names = keys.map(k => {
      const { type, name } = parseKey(k);
      return `${type} ${name}`;
    });

    setConfirmAction({
      title: `Remove ${keys.length} item(s)?`,
      items: names,
      onConfirm: () => {
        for (const key of keys) {
          doRemove(key);
        }
        setMessage(`Removed ${keys.length} item(s)`);
        setSelected(new Set());
        setConfirmAction(null);
        onRefresh();
      },
    });
  }, [doRemove, onRefresh]);

  const handleRemoveFromDetail = useCallback((key: string) => {
    const { type, name } = parseKey(key);
    setConfirmAction({
      title: `Remove ${type} ${name}?`,
      items: [`${type} ${name}`],
      onConfirm: () => {
        doRemove(key);
        setMessage(`Removed ${type} ${name}`);
        setConfirmAction(null);
        setDetailItem(null);
        onRefresh();
      },
    });
  }, [doRemove, onRefresh]);

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

  // Detail view
  if (detailItem) {
    return (
      <DetailView
        item={detailItem}
        onBack={() => setDetailItem(null)}
        onInstall={() => {}} // No install from Installed tab
        onRemove={handleRemoveFromDetail}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Installed ({items.length})</Text>
      {recoveredCount > 0 && (
        <Text dimColor>
          {'  '}
          {recoveredCount} item{recoveredCount > 1 ? 's are' : ' is'} detected from disk because the lock file is missing or out of sync.
        </Text>
      )}
      <SearchInput
        value={query}
        onChange={setQuery}
        isFocused={focus === 'search'}
        total={items.length}
        filtered={filtered.length}
      />
      <TypeFilter counts={typeCounts} active={typeFilter} total={searchFilteredTotal} />
      <ItemList
        items={filtered}
        selected={selected}
        onToggle={handleToggle}
        onSubmit={handleSubmit}
        onDetail={setDetailItem}
        isFocused={focus === 'list'}
      />
      {message && <Text color="green">  {message}</Text>}
      <StatusBar
        hints="/ search · 1-5 filter · 0 all · Space select · Enter details · r remove selected · Tab switch"
        selectedCount={selected.size}
      />
    </Box>
  );
};
