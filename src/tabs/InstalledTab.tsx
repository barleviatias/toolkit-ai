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
import { removeSkill, removeAgent, removeMcp, removeBundle } from '../core/remover.js';
import { useMarkEscConsumed } from '../app.js';

interface InstalledTabProps {
  items: ItemData[];
  catalog: Catalog;
  onRefresh: () => void;
  onUpdateItem: (item: ItemData) => void;
  onUpdateAll: () => void;
}

export const InstalledTab: React.FC<InstalledTabProps> = ({
  items,
  catalog,
  onRefresh,
  onUpdateItem,
  onUpdateAll,
}) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<ItemData | null>(null);
  const [message, setMessage] = useState('');
  const [focus, setFocus] = useState<'list' | 'search'>('list');
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<{ title: string; items: string[]; onConfirm: () => void } | null>(null);
  // Blocking update operations (install*/updateAll) get a busy indicator — see SourcesTab for pattern
  const [busy, setBusy] = useState<string | null>(null);
  const recoveredCount = useMemo(() => items.filter(item => item.trackedByLock === false).length, [items]);
  const updateCount = useMemo(() => items.filter(item => item.hasUpdate).length, [items]);

  const markEscConsumed = useMarkEscConsumed();

  const runBusy = useCallback((label: string, fn: () => void) => {
    setBusy(label);
    setMessage('');
    setTimeout(() => {
      try {
        fn();
      } catch (e: unknown) {
        setMessage(`\u2715 ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(null);
      }
    }, 16);
  }, []);

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
    if (busy) return; // input blocked while update is running
    if (focus === 'search') {
      if (key.escape || key.downArrow) {
        if (key.escape) markEscConsumed();
        setFocus('list');
      }
    } else {
      if (input === '/') setFocus('search');
      else if (input === '1') toggleType('skill');
      else if (input === '2') toggleType('agent');
      else if (input === '3') toggleType('mcp');
      else if (input === '4') toggleType('bundle');
      else if (input === '0') setTypeFilter(new Set());
      else if (input === 'U' && updateCount > 0) {
        runBusy(`Updating ${updateCount} item(s)`, () => {
          onUpdateAll();
          onRefresh();
          setMessage(`Updated ${updateCount} item(s)`);
        });
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

  const doRemove = useCallback((key: string) => {
    const { type, name } = parseKey(key);
    try {
      if (type === 'skill')       removeSkill(catalog, name, () => {});
      else if (type === 'agent')  removeAgent(catalog, name, () => {});
      else if (type === 'mcp')    removeMcp(catalog, name, () => {});
      else if (type === 'bundle') removeBundle(catalog, name, () => {});
    } catch (e: unknown) {
      setMessage(`Error removing ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [catalog]);

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

  const handleUpdateFromList = useCallback((item: ItemData) => {
    runBusy(`Updating ${item.type} ${item.name}`, () => {
      onUpdateItem(item);
      onRefresh();
      setMessage(`Updated ${item.type} ${item.name}`);
    });
  }, [onUpdateItem, onRefresh, runBusy]);

  const handleUpdateFromDetail = useCallback((key: string) => {
    const item = items.find(i => i.key === key);
    if (!item) return;
    runBusy(`Updating ${item.type} ${item.name}`, () => {
      onUpdateItem(item);
      onRefresh();
      setMessage(`Updated ${item.type} ${item.name}`);
      setDetailItem(null);
    });
  }, [items, onUpdateItem, onRefresh, runBusy]);

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
        onUpdate={detailItem.hasUpdate ? handleUpdateFromDetail : undefined}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>Installed ({items.length})</Text>
        {updateCount > 0 && (
          <Text color="yellow" bold>{'  '}· {updateCount} update{updateCount > 1 ? 's' : ''} available</Text>
        )}
      </Box>
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
        onUpdate={handleUpdateFromList}
        isFocused={focus === 'list'}
      />
      {busy && (
        <Box>
          <Text color="yellow">  ⟳ {busy}...</Text>
          <Text dimColor>  (please wait)</Text>
        </Box>
      )}
      {!busy && message && (
        <Text color={message.startsWith('\u2715') ? 'red' : 'green'}>  {message}</Text>
      )}
      <StatusBar
        hints={
          busy
            ? 'Working…'
            : updateCount > 0
              ? '/ search · 1-4 filter · 0 all · Space select · Enter details · u update · U all · r remove · Tab switch'
              : '/ search · 1-4 filter · 0 all · Space select · Enter details · r remove · Tab switch'
        }
        selectedCount={selected.size}
      />
    </Box>
  );
};
