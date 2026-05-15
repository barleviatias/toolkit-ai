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
  installCommand,
  installPlugin,
} from '../core/installer.js';
import { removeSkill, removeAgent, removeMcp, removeBundle, removeCommand, removePlugin } from '../core/remover.js';
import { withLogging, withMultiLogging } from '../core/logger.js';
import { getWritableTargetLabelsForType } from '../core/platform.js';
import { needsConsent, buildConsentPrompt, resolveBundleChildren } from './install-consent.js';
import { useMarkEscConsumed } from '../hooks/useEscContext.js';
import { useRunBusy } from '../hooks/useRunBusy.js';

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
  const [busy, setBusy] = useState<string | null>(null);

  const updateCount = useMemo(() => items.filter(i => i.hasUpdate).length, [items]);

  const { filtered, typeCounts, searchTotal: searchFilteredTotal } = useFilteredItems(items, query, typeFilter);
  const markEscConsumed = useMarkEscConsumed();
  const runBusy = useRunBusy(setBusy, setMessage);

  // Focus switching + global keys
  useInput((input, key) => {
    if (detailItem || confirmAction) return;
    if (busy) return;
    if (focus === 'search') {
      if (key.escape || key.downArrow) {
        if (key.escape) markEscConsumed();
        setFocus('list');
      }
    } else {
      if (input === '/') setFocus('search');
      else if (input === '1') toggleType('plugin');
      else if (input === '2') toggleType('bundle');
      else if (input === '3') toggleType('skill');
      else if (input === '4') toggleType('agent');
      else if (input === '5') toggleType('mcp');
      else if (input === '6') toggleType('command');
      else if (input === '0') setTypeFilter(new Set());
      else if (input === 'U') {
        if (updateCount === 0) {
          setMessage('No updates available');
          return;
        }
        runBusy(`Updating ${updateCount} item(s)`, () => {
          onUpdateAll();
          setMessage(`Updated ${updateCount} item(s)`);
        });
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
    const { type, name, source } = item;
    try {
      const opts = { force: false };
      // Each branch wraps the underlying install in withLogging so the
      // operation is recorded in ~/.toolkit/log.jsonl. The log captures
      // every line the installer would otherwise emit, so `toolkit logs`
      // can replay TUI installs as if they were headless.
      const providers = getWritableTargetLabelsForType(type);
      if (type === 'skill') {
        withLogging({ action: 'install', type, name, source, providers }, log => installSkill(catalog, name, opts, log));
      } else if (type === 'agent') {
        withLogging({ action: 'install', type, name, source, providers }, log => installAgent(catalog, name, opts, log));
      } else if (type === 'mcp') {
        withLogging({ action: 'install', type, name, source, providers }, log => installMcp(catalog, name, opts, log));
      } else if (type === 'command') {
        withLogging({ action: 'install', type, name, source, providers }, log => installCommand(catalog, name, opts, log));
      } else if (type === 'bundle') {
        withMultiLogging({ action: 'install-bundle', type, name, source, providers }, log => installBundle(catalog, name, opts, log));
      } else if (type === 'plugin') {
        withMultiLogging({ action: 'install-plugin', type, name, source, providers }, log => installPlugin(catalog, name, opts, log));
      } else {
        setMessage(`Error: ${type} ${name} cannot be installed`);
        return;
      }
      setMessage(`Installed ${type} ${name}`);
      onRefresh();
    } catch (e: unknown) {
      setMessage(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [catalog, onRefresh]);

  const installWithBusy = useCallback((item: ItemData) => {
    runBusy(`Installing ${item.type} ${item.name}`, () => runInstall(item));
  }, [runBusy, runInstall]);

  const doInstall = useCallback((key: string) => {
    const item = filtered.find(i => i.key === key) || items.find(i => i.key === key);
    if (!item) { setMessage('Error: item not found'); return; }

    // Block install only when fully installed (all detected providers have
    // it) and there's no pending update. A partial install — e.g. a skill in
    // Claude but not in Codex/Copilot, or a plugin in Claude via /plugin
    // install but not yet decomposed — should be re-installable to fill the
    // gaps. The underlying per-component installers are idempotent on
    // byte-equal targets so this is safe.
    const fullyInstalled = item.installed && (
      !item.targetStatus || item.targetStatus.every(s => s.installed)
    );
    if (fullyInstalled && !item.hasUpdate) {
      setMessage(`Already installed everywhere — press r to remove or u to update`);
      return;
    }

    // Consent fires for block-severity findings or anything that will exec on
    // the host (stdio MCPs, and bundles that transitively include any of the
    // above). Warn-only findings surface via the row badge + DetailView; we
    // don't pop a modal for those or users reflex-press y.
    const children = resolveBundleChildren(item, items);
    if (needsConsent(item, children)) {
      const prompt = buildConsentPrompt(item, children);
      setConfirmAction({
        title: prompt.title,
        items: prompt.lines,
        onConfirm: () => {
          setConfirmAction(null);
          installWithBusy(item);
        },
      });
      return;
    }

    installWithBusy(item);
  }, [items, filtered, installWithBusy]);

  const doRemove = useCallback((key: string) => {
    const { type, name } = parseKey(key);
    try {
      const removed = (fn: (log: (msg: string) => void) => void) =>
        withLogging(
          { action: 'remove', type, name, providers: getWritableTargetLabelsForType(type) },
          log => { fn(log); return { action: 'removed' }; },
        );
      if (type === 'skill')        removed(log => removeSkill(catalog, name, log));
      else if (type === 'agent')   removed(log => removeAgent(catalog, name, log));
      else if (type === 'mcp')     removed(log => removeMcp(catalog, name, log));
      else if (type === 'bundle')  removed(log => removeBundle(catalog, name, log));
      else if (type === 'command') removed(log => removeCommand(catalog, name, log));
      else if (type === 'plugin')  removed(log => removePlugin(catalog, name, log));
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
    if (!item.installed) {
      setMessage(`Not installed — press i to install`);
      return;
    }
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
    if (!item.hasUpdate) {
      setMessage(`No update available for ${item.type} ${item.name}`);
      return;
    }
    runBusy(`Updating ${item.type} ${item.name}`, () => {
      onUpdateItem(item);
      setMessage(`Updated ${item.type} ${item.name}`);
    });
  }, [onUpdateItem, runBusy]);

  const handleSubmit = useCallback((keys: string[]) => {
    const itemsToInstall = keys
      .map(key => items.find(item => item.key === key))
      .filter((item): item is ItemData => !!item && (!item.installed || item.hasUpdate === true));

    if (itemsToInstall.length === 0) {
      setSelected(new Set());
      setMessage('No selected items need installation');
      return;
    }

    const consentItem = itemsToInstall.find(item => needsConsent(item, resolveBundleChildren(item, items)));
    if (consentItem) {
      setMessage(`Install ${consentItem.type} ${consentItem.name} individually to review its safety prompt`);
      return;
    }

    runBusy(`Installing ${itemsToInstall.length} item(s)`, () => {
      for (const item of itemsToInstall) runInstall(item);
      setMessage(`Installed ${itemsToInstall.length} item(s)`);
    });
    setSelected(new Set());
  }, [items, runBusy, runInstall]);

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
    setDetailItem(null);
    runBusy(`Updating ${item.type} ${item.name}`, () => {
      onUpdateItem(item);
      setMessage(`Updated ${item.type} ${item.name}`);
    });
  }, [items, onUpdateItem, runBusy]);

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
        isFocused={focus === 'list' && !busy}
      />
      {busy && (
        <Text color="yellow">  ⟳ {busy}...<Text dimColor>  (please wait)</Text></Text>
      )}
      {!busy && message && (
        <Text color={message.startsWith('\u2715') || message.startsWith('Error') ? 'red' : 'green'}>  {message}</Text>
      )}
      <StatusBar
        selectedCount={selected.size}
        hints={
          busy
            ? 'Working...'
            : '/ search · 1-6 filter · 0 all · Space select · Enter details · i install · r remove · u update · U all · Tab switch'
        }
      />
    </Box>
  );
};
