import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { SearchInput } from '../components/SearchInput.js';
import { StatusBar } from '../components/StatusBar.js';
import type { Catalog, PluginConfig } from '../types.js';
import type { LockFile } from '../types.js';
import { loadPluginConfig } from '../core/catalog.js';
import { installPlugin } from '../core/installer.js';
import { removePlugin } from '../core/remover.js';

interface PluginsTabProps {
  catalog: Catalog;
  lock: LockFile;
  toolkitDir: string;
  onRefresh: () => void;
}

export const PluginsTab: React.FC<PluginsTabProps> = ({
  catalog,
  lock,
  toolkitDir,
  onRefresh,
}) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [focus, setFocus] = useState<'list' | 'search'>('list');

  const plugins = useMemo(() => {
    return catalog.plugins.map(entry => {
      const config = loadPluginConfig(toolkitDir, entry);
      const installed = !!lock.installed[`plugin:${entry.name}`];
      return { entry, config, installed };
    });
  }, [catalog, lock, toolkitDir]);

  const filtered = useMemo(() => {
    if (!query) return plugins;
    const q = query.toLowerCase();
    return plugins.filter(
      p => p.entry.name.toLowerCase().includes(q) ||
           p.entry.description.toLowerCase().includes(q)
    );
  }, [plugins, query]);

  const clampedCursor = Math.min(cursor, Math.max(0, filtered.length - 1));
  if (clampedCursor !== cursor) setCursor(clampedCursor);

  useInput((input, key) => {
    if (focus === 'search') {
      if (key.escape || key.downArrow) setFocus('list');
      return;
    }
    if (input === '/') { setFocus('search'); return; }
    if (filtered.length === 0) return;

    if (key.upArrow) {
      setCursor(c => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor(c => Math.min(filtered.length - 1, c + 1));
    } else if (key.return) {
      // Toggle expand
      const p = filtered[clampedCursor];
      if (p) {
        setExpanded(prev => {
          const next = new Set(prev);
          if (next.has(p.entry.name)) next.delete(p.entry.name);
          else next.add(p.entry.name);
          return next;
        });
      }
    } else if (input === 'i') {
      // Install
      const p = filtered[clampedCursor];
      if (p && !p.installed) {
        try {
          installPlugin(catalog, toolkitDir, p.entry.name, { force: false }, () => {});
          setMessage(`Installed plugin: ${p.entry.name}`);
          onRefresh();
        } catch (e: any) {
          setMessage(`Error: ${e.message}`);
        }
      }
    } else if (input === 'r') {
      // Remove
      const p = filtered[clampedCursor];
      if (p && p.installed) {
        try {
          removePlugin(catalog, p.entry.name, () => {});
          setMessage(`Removed plugin: ${p.entry.name}`);
          onRefresh();
        } catch (e: any) {
          setMessage(`Error: ${e.message}`);
        }
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Plugins ({catalog.plugins.length})</Text>
      <SearchInput value={query} onChange={setQuery} isFocused={focus === 'search'} total={plugins.length} filtered={filtered.length} />

      <Box flexDirection="column" marginY={1}>
        {filtered.length === 0 && (
          <Text dimColor>  No plugins found</Text>
        )}
        {filtered.map((p, i) => {
          const isActive = focus === 'list' && i === clampedCursor;
          const isExpanded = expanded.has(p.entry.name);
          return (
            <Box key={p.entry.name} flexDirection="column">
              <Box>
                <Text color={isActive ? 'cyan' : undefined}>{isActive ? '❯ ' : '  '}</Text>
                <Text color="cyan" bold>PLUGIN </Text>
                <Text bold={isActive}>{p.entry.name}</Text>
                {p.installed
                  ? <Text color="green"> · installed</Text>
                  : <Text dimColor> · not installed</Text>
                }
                <Text dimColor> · {(p.config.skills?.length || 0)}s {(p.config.agents?.length || 0)}a {(p.config.mcps?.length || 0)}m</Text>
                <Text dimColor>{isExpanded ? ' ▾' : ' ▸'}</Text>
              </Box>
              <Box marginLeft={14}>
                <Text dimColor>{p.entry.description}</Text>
              </Box>
              {isExpanded && (
                <Box flexDirection="column" marginLeft={8} marginBottom={1}>
                  {(p.config.skills || []).map(s => (
                    <Text key={s} color="magenta">  SKILL  {s}</Text>
                  ))}
                  {(p.config.agents || []).map(a => (
                    <Text key={a} color="blue">  AGENT  {a}</Text>
                  ))}
                  {(p.config.mcps || []).map(m => (
                    <Text key={m} color="yellow">  MCP    {m}</Text>
                  ))}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {message && <Text color="green">  {message}</Text>}
      <StatusBar hints="/ to search · Enter to expand · i to install · r to remove · Tab to switch · q to quit" />
    </Box>
  );
};
