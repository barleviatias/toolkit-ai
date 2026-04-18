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
import {
  installSkill,
  installAgent,
  installMcp,
  installBundle,
} from '../core/installer.js';
import { removeSkill, removeAgent, removeMcp, removeBundle } from '../core/remover.js';

interface CatalogTabProps {
  items: ItemData[];
  catalog: Catalog;
  onRefresh: () => void;
  onUpdateItem: (item: ItemData) => void;
  onUpdateAll: () => void;
}

export const CatalogTab: React.FC<CatalogTabProps> = ({
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

  const updateCount = useMemo(() => items.filter(i => i.hasUpdate).length, [items]);

  const { filtered, typeCounts, searchTotal: searchFilteredTotal } = useFilteredItems(items, query, typeFilter);

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

  const runInstall = useCallback((item: ItemData) => {
    const { type, name } = item;
    try {
      const opts = { force: false };
      if (type === 'skill')       installSkill(catalog, name, opts, () => {});
      else if (type === 'agent')  installAgent(catalog, name, opts, () => {});
      else if (type === 'mcp')    installMcp(catalog, name, opts, () => {});
      else if (type === 'bundle') installBundle(catalog, name, opts, () => {});
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

  const doInstall = useCallback((key: string) => {
    const item = filtered.find(i => i.key === key) || items.find(i => i.key === key);
    if (!item) { setMessage('Error: item not found'); return; }

    // Consent is required when the scanner flagged something risky OR when an
    // MCP will exec a local command on every agent session. We never block —
    // we make sure the user can see what's about to happen before saying yes.
    const isStdioMcp = item.type === 'mcp' && !!item.mcpCommand;
    const needsConsent = item.scanStatus === 'block' || item.scanStatus === 'warn' || isStdioMcp;

    if (needsConsent) {
      const lines: string[] = [];
      if (isStdioMcp) {
        const preview = [item.mcpCommand, ...(item.mcpArgs || [])].join(' ');
        lines.push(`Runs on every agent session: ${preview}`);
      }
      if (item.scanSummary) lines.push(item.scanSummary);
      if (item.type === 'mcp') lines.push('Writes to Claude, Codex, Cursor, and VSCode MCP configs.');

      const severityIcon = item.scanStatus === 'block' ? '\u2715 ' : item.scanStatus === 'warn' ? '\u26a0 ' : '';
      setConfirmAction({
        title: `${severityIcon}Install ${item.type} '${item.name}' from ${item.source}?`,
        items: lines,
        onConfirm: () => {
          setConfirmAction(null);
          runInstall(item);
        },
      });
      return;
    }

    runInstall(item);
  }, [items, filtered, runInstall]);

  const doRemove = useCallback((key: string) => {
    const { type, name } = parseKey(key);
    try {
      if (type === 'skill')       removeSkill(catalog, name, () => {});
      else if (type === 'agent')  removeAgent(catalog, name, () => {});
      else if (type === 'mcp')    removeMcp(catalog, name, () => {});
      else if (type === 'bundle') removeBundle(catalog, name, () => {});
      setMessage(`Removed ${type} ${name}`);
      onRefresh();
    } catch (e: unknown) {
      setMessage(`Error: ${e instanceof Error ? e.message : String(e)}`);
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
