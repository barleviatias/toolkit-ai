import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { SearchInput } from '../components/SearchInput.js';
import { ItemList } from '../components/ItemList.js';
import { DetailView } from '../components/DetailView.js';
import { TypeFilter } from '../components/TypeFilter.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { StatusBar } from '../components/StatusBar.js';
import { parseKey } from '../core/item-key.js';
import type { ItemData } from '../components/ItemRow.js';
import type { Catalog } from '../types.js';
import {
  installSkill,
  installAgent,
  installMcp,
  installBundle,
  installExternalSkill,
  installExternalAgent,
  installExternalMcp,
  installExternalBundle,
} from '../core/installer.js';
import { removeSkill, removeAgent, removeMcp, removeBundle } from '../core/remover.js';

interface CatalogTabProps {
  items: ItemData[];
  catalog: Catalog;
  toolkitDir: string;
  onRefresh: () => void;
  onUpdateItem: (item: ItemData) => void;
  onUpdateAll: () => void;
}

export const CatalogTab: React.FC<CatalogTabProps> = ({
  items,
  catalog,
  toolkitDir,
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

  const updateCount = useMemo(() => items.filter(i => i.hasUpdate).length, [items]);

  const filtered = useMemo(() => {
    let result = items;
    if (typeFilter.size > 0) {
      result = result.filter(i => typeFilter.has(i.type));
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        i => i.name.toLowerCase().includes(q) ||
             i.description.toLowerCase().includes(q) ||
             i.type.toLowerCase().includes(q)
      );
    }
    return result;
  }, [items, query, typeFilter]);

  const typeCounts = useMemo(() => {
    const searchFiltered = query
      ? items.filter(i => {
          const q = query.toLowerCase();
          return i.name.toLowerCase().includes(q) ||
                 i.description.toLowerCase().includes(q) ||
                 i.type.toLowerCase().includes(q);
        })
      : items;
    const counts: Record<string, number> = {};
    for (const item of searchFiltered) {
      counts[item.type] = (counts[item.type] || 0) + 1;
    }
    return counts;
  }, [items, query]);

  const searchFilteredTotal = useMemo(() => {
    if (!query) return items.length;
    const q = query.toLowerCase();
    return items.filter(
      i => i.name.toLowerCase().includes(q) ||
           i.description.toLowerCase().includes(q) ||
           i.type.toLowerCase().includes(q)
    ).length;
  }, [items, query]);

  // Focus switching + global keys
  useInput((input, key) => {
    if (detailItem || confirmAction) return;
    if (focus === 'search') {
      if (key.escape || key.downArrow) setFocus('list');
    } else {
      if (input === '/') setFocus('search');
      else if (input === '1') toggleType('skill');
      else if (input === '2') toggleType('agent');
      else if (input === '3') toggleType('mcp');
      else if (input === '4') toggleType('bundle');
      else if (input === '0') setTypeFilter(new Set());
      else if (input === 'U') {
        onUpdateAll();
        setMessage('Updated all items');
        onRefresh();
      }
    }
  });

  const toggleType = useCallback((type: string) => {
    setTypeFilter(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

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
    if (!item) { setMessage('Error: item not found'); return; }

    if (item.scanStatus === 'block') {
      setMessage(`\u2715 Blocked: ${item.scanSummary || 'Security issues detected'}`);
      return;
    }

    const { type, name, source } = item;
    try {
      if (source !== 'internal' && item.path && item.hash) {
        if (type === 'skill')      installExternalSkill(source, name, item.path, item.hash, { force: false }, () => {});
        else if (type === 'agent') installExternalAgent(source, name, item.path, item.hash, { force: false }, () => {});
        else if (type === 'mcp')   installExternalMcp(source, name, item.path, item.hash, { force: false }, () => {});
        else if (type === 'bundle') installExternalBundle(catalog, toolkitDir, source, name, item.path, item.hash, { force: false }, () => {});
      } else if (type === 'skill')  installSkill(catalog, toolkitDir, name, { force: false }, () => {});
      else if (type === 'agent')    installAgent(catalog, toolkitDir, name, { force: false }, () => {});
      else if (type === 'mcp')      installMcp(catalog, toolkitDir, name, { force: false }, () => {});
      else if (type === 'bundle')   installBundle(catalog, toolkitDir, name, { force: false }, () => {});
      else {
        setMessage(`Error: ${type} ${name} cannot be installed`);
        return;
      }
      setMessage(`Installed ${type} ${name}`);
      onRefresh();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
  }, [catalog, toolkitDir, items, filtered, onRefresh]);

  const doRemove = useCallback((key: string) => {
    const { type, name } = parseKey(key);
    try {
      if (type === 'skill')       removeSkill(catalog, name, () => {});
      else if (type === 'agent')  removeAgent(catalog, name, () => {});
      else if (type === 'mcp')    removeMcp(catalog, name, () => {});
      else if (type === 'bundle') removeBundle(catalog, name, () => {});
      setMessage(`Removed ${type} ${name}`);
      onRefresh();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
  }, [catalog, onRefresh]);

  // ItemList action callbacks (i/r/u on cursor item)
  const handleInstallItem = useCallback((item: ItemData) => {
    doInstall(item.key);
  }, [doInstall]);

  const handleRemoveItem = useCallback((item: ItemData) => {
    const { type, name } = parseKey(item.key);
    setConfirmAction({
      title: `Remove ${type} ${name}?`,
      items: [`${type} ${name}`],
      onConfirm: () => {
        doRemove(item.key);
        setConfirmAction(null);
      },
    });
  }, [doRemove]);

  const handleUpdateItem = useCallback((item: ItemData) => {
    onUpdateItem(item);
    setMessage(`Updated ${item.type} ${item.name}`);
    onRefresh();
  }, [onUpdateItem, onRefresh]);

  const handleSubmit = useCallback((keys: string[]) => {
    for (const key of keys) {
      doInstall(key);
    }
    setSelected(new Set());
  }, [doInstall]);

  const handleRemoveFromDetail = useCallback((key: string) => {
    const { type, name } = parseKey(key);
    setConfirmAction({
      title: `Remove ${type} ${name}?`,
      items: [`${type} ${name}`],
      onConfirm: () => {
        doRemove(key);
        setConfirmAction(null);
        setDetailItem(null);
      },
    });
  }, [doRemove]);

  const handleUpdateFromDetail = useCallback((key: string) => {
    const item = items.find(i => i.key === key);
    if (!item) return;
    onUpdateItem(item);
    setMessage(`Updated ${item.type} ${item.name}`);
    onRefresh();
    setDetailItem(null);
  }, [items, onUpdateItem, onRefresh]);

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
        onInstall={(key) => { doInstall(key); setDetailItem(null); }}
        onRemove={handleRemoveFromDetail}
        onUpdate={detailItem.hasUpdate ? handleUpdateFromDetail : undefined}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        Catalog ({filtered.length}/{items.length})
        {updateCount > 0 && <Text color="yellow"> · {updateCount} update{updateCount > 1 ? 's' : ''}</Text>}
      </Text>
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
        onInstall={handleInstallItem}
        onRemove={handleRemoveItem}
        onUpdate={handleUpdateItem}
        isFocused={focus === 'list'}
      />
      {message && <Text color={message.startsWith('\u2715') ? 'red' : 'green'}>  {message}</Text>}
      <StatusBar
        selectedCount={selected.size}
        hints="/ search · 1-4 filter · 0 all · Space select · Enter details · i install · r remove · u update · U all · Tab switch"
      />
    </Box>
  );
};
