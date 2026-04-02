import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { StatusBar } from '../components/StatusBar.js';
import type { SourcesConfig } from '../types.js';
import { loadSources, addSource, removeSource, parseSourceInput } from '../core/sources.js';

const VERSION = process.env.TOOLKIT_VERSION || 'dev';

interface SourcesTabProps {
  onRefresh: () => void;
}

export const SourcesTab: React.FC<SourcesTabProps> = ({ onRefresh }) => {
  const [config, setConfig] = useState<SourcesConfig>(() => loadSources());
  const [mode, setMode] = useState<'list' | 'add'>('list');
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('');
  const [cursor, setCursor] = useState(0);

  const refresh = useCallback(() => {
    setConfig(loadSources());
    onRefresh();
  }, [onRefresh]);

  useInput((ch, key) => {
    if (mode === 'list') {
      if (ch === 'a') {
        setMode('add');
        setInput('');
      } else if (ch === 'd' && config.sources.length > 0) {
        const source = config.sources[cursor];
        if (source) {
          removeSource(source.name);
          setMessage(`Removed source: ${source.name}`);
          setCursor(c => Math.max(0, c - 1));
          refresh();
        }
      } else if (key.upArrow) {
        setCursor(c => Math.max(0, c - 1));
      } else if (key.downArrow) {
        setCursor(c => Math.min(config.sources.length - 1, c + 1));
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
        refresh();
      }
    }
  });

  const TYPE_COLORS: Record<string, string> = {
    github: 'white',
    bitbucket: 'blue',
    local: 'yellow',
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>Sources ({config.sources.length})</Text>
        <Text dimColor>  ·  ai-toolkit v{VERSION}</Text>
      </Box>

      {config.sources.length === 0 && mode === 'list' && (
        <Box marginY={1}>
          <Text dimColor>  No external sources configured. Press </Text>
          <Text bold color="cyan">a</Text>
          <Text dimColor> to add one.</Text>
        </Box>
      )}

      <Box flexDirection="column" marginY={1}>
        {config.sources.map((source, i) => (
          <Box key={source.name} marginLeft={1}>
            <Text color={i === cursor ? 'cyan' : undefined}>
              {i === cursor ? '❯ ' : '  '}
            </Text>
            <Text color={TYPE_COLORS[source.type] || 'white'} bold>{source.type.padEnd(10)}</Text>
            <Text bold={i === cursor}>{source.name}</Text>
            <Text dimColor> · {source.repo || source.path}</Text>
          </Box>
        ))}
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
          : 'a to add source · d to delete · Tab to switch · q to quit'
      } />
    </Box>
  );
};
