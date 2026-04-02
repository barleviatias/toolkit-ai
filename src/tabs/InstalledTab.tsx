import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { SearchInput } from '../components/SearchInput.js';
import { ItemList } from '../components/ItemList.js';
import { StatusBar } from '../components/StatusBar.js';
import type { ItemData } from '../components/ItemRow.js';
import type { Catalog } from '../types.js';
import { removeSkill, removeAgent, removeMcp, removePlugin } from '../core/remover.js';

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
  const [message, setMessage] = useState('');
  const [focus, setFocus] = useState<'list' | 'search'>('list');

  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(i => i.name.toLowerCase().includes(q));
  }, [items, query]);

  useInput((input, key) => {
    if (focus === 'search') {
      if (key.escape || key.downArrow) setFocus('list');
    } else {
      if (input === '/') setFocus('search');
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

  const handleSubmit = useCallback((keys: string[]) => {
    for (const key of keys) {
      const parts = key.split(':');
      const type = parts[0];
      const name = parts[parts.length - 1];
      try {
        if (type === 'skill')       removeSkill(catalog, name, () => {});
        else if (type === 'agent')  removeAgent(catalog, name, () => {});
        else if (type === 'mcp')    removeMcp(catalog, name, () => {});
        else if (type === 'plugin') removePlugin(catalog, name, () => {});
      } catch (e: any) {
        setMessage(`Error removing ${name}: ${e.message}`);
      }
    }
    setMessage(`Removed ${keys.length} item(s)`);
    setSelected(new Set());
    onRefresh();
  }, [catalog, onRefresh]);

  return (
    <Box flexDirection="column">
      <Text bold>Installed ({items.length})</Text>
      <SearchInput value={query} onChange={setQuery} isFocused={focus === 'search'} total={items.length} filtered={filtered.length} />
      <ItemList
        items={filtered}
        selected={selected}
        onToggle={handleToggle}
        onSubmit={handleSubmit}
        isFocused={focus === 'list'}
      />
      {message && <Text color="green">  {message}</Text>}
      <StatusBar
        hints="/ to search · Space to select · Enter to remove selected · Tab to switch · q to quit"
        selectedCount={selected.size}
      />
    </Box>
  );
};
