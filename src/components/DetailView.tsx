import React from 'react';
import { Text, Box, useInput } from 'ink';
import type { ItemData } from './ItemRow.js';

interface DetailViewProps {
  item: ItemData;
  onBack: () => void;
  onInstall: (key: string) => void;
  onRemove: (key: string) => void;
  onUpdate?: (key: string) => void;
}

export const DetailView: React.FC<DetailViewProps> = ({
  item,
  onBack,
  onInstall,
  onRemove,
  onUpdate,
}) => {
  useInput((input, key) => {
    if (key.escape) {
      onBack();
    } else if (input === 'i' && !item.installed) {
      onInstall(item.key);
    } else if (input === 'r' && item.installed) {
      onRemove(item.key);
    } else if (input === 'u' && item.hasUpdate && onUpdate) {
      onUpdate(item.key);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Box gap={2}>
        <Text bold color="cyan">{item.name}</Text>
        <Text dimColor>({item.type})</Text>
        <Text dimColor>source: {item.source}</Text>
      </Box>

      <Box marginTop={1}>
        <Text>{item.description}</Text>
      </Box>

      {item.scanStatus === 'block' && (
        <Box marginTop={1} flexDirection="column">
          <Text color="red" bold>✕ Security scan blocked this item</Text>
          {item.scanSummary && <Text color="red">  {item.scanSummary}</Text>}
        </Box>
      )}
      {item.scanStatus === 'warn' && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" bold>⚠ Security warnings</Text>
          {item.scanSummary && <Text color="yellow">  {item.scanSummary}</Text>}
        </Box>
      )}

      {/* Bundle contents */}
      {item.bundleContents && (
        <Box marginTop={1} flexDirection="column">
          <Text bold dimColor>Contains:</Text>
          {(item.bundleContents.skills || []).map(s => (
            <Text key={s} color="magenta">  SKILL  {s}</Text>
          ))}
          {(item.bundleContents.agents || []).map(a => (
            <Text key={a} color="blue">  AGENT  {a}</Text>
          ))}
          {(item.bundleContents.mcps || []).map(m => (
            <Text key={m} color="yellow">  MCP    {m}</Text>
          ))}
        </Box>
      )}

      {/* MCP details */}
      {item.transport && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Transport: {item.transport}</Text>
          {item.url && <Text dimColor>URL: {item.url}</Text>}
          {item.setupNote && <Text color="cyan">{item.setupNote}</Text>}
        </Box>
      )}

      <Box marginTop={1} gap={2}>
        {item.installed ? (
          <>
            <Text color="green">● Installed</Text>
            <Text dimColor>  Press </Text>
            <Text color="red" bold>r</Text>
            <Text dimColor> to remove</Text>
          </>
        ) : (
          <>
            <Text dimColor>○ Not installed</Text>
            <Text dimColor>  Press </Text>
            <Text color="green" bold>i</Text>
            <Text dimColor> to install</Text>
          </>
        )}
      </Box>

      {item.hasUpdate && onUpdate && (
        <Box gap={2}>
          <Text color="yellow">~ Update available</Text>
          <Text dimColor>  Press </Text>
          <Text color="yellow" bold>u</Text>
          <Text dimColor> to update</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor italic>Esc to go back</Text>
      </Box>
    </Box>
  );
};
