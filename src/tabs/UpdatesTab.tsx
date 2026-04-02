import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { ItemList } from '../components/ItemList.js';
import { StatusBar } from '../components/StatusBar.js';
import type { ItemData } from '../components/ItemRow.js';
import type { Catalog } from '../types.js';
import { updateAll } from '../core/updater.js';

interface UpdatesTabProps {
  items: ItemData[];
  catalog: Catalog;
  toolkitDir: string;
  onRefresh: () => void;
}

export const UpdatesTab: React.FC<UpdatesTabProps> = ({
  items,
  catalog,
  toolkitDir,
  onRefresh,
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');

  const handleToggle = useCallback((key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useInput((input) => {
    if (input === 'u') {
      // Update all
      const results = updateAll(catalog, toolkitDir, { force: true }, () => {});
      const updated = results.filter(r => r.action === 'updated').length;
      setMessage(`Updated ${updated} item(s)`);
      onRefresh();
    }
  });

  const handleSubmit = useCallback((keys: string[]) => {
    // Update all when submitting
    const results = updateAll(catalog, toolkitDir, { force: true }, () => {});
    const updated = results.filter(r => r.action === 'updated').length;
    setMessage(`Updated ${updated} item(s)`);
    setSelected(new Set());
    onRefresh();
  }, [catalog, toolkitDir, onRefresh]);

  if (items.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Updates</Text>
        <Box marginY={1}>
          <Text color="green">  Everything is up to date.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Updates ({items.length} available)</Text>
      <ItemList
        items={items}
        selected={selected}
        onToggle={handleToggle}
        onSubmit={handleSubmit}
      />
      {message && <Text color="green">  {message}</Text>}
      <StatusBar hints="u to update all · Space to select · Enter to update selected · Tab to switch" />
    </Box>
  );
};
