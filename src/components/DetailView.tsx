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

      {item.pluginContents && (
        <Box marginTop={1} flexDirection="column">
          {item.pluginContents.marketplace && (
            <Text dimColor>  Marketplace: {item.pluginContents.marketplace}</Text>
          )}
          {item.pluginContents.version && (
            <Text dimColor>  Version: {item.pluginContents.version}</Text>
          )}
          {item.pluginContents.author && (
            <Text dimColor>  Author: {item.pluginContents.author}</Text>
          )}
          {item.pluginContents.category && (
            <Text dimColor>  Category: {item.pluginContents.category}</Text>
          )}

          {item.pluginContents.formats && (
            <Box marginTop={1} gap={1}>
              <Text dimColor>Targets:</Text>
              <Text color={item.pluginContents.formats.claude ? 'green' : 'gray'}>
                {item.pluginContents.formats.claude ? '[✓ Claude]' : '[· Claude]'}
              </Text>
              <Text color={item.pluginContents.formats.codex ? 'green' : 'gray'}>
                {item.pluginContents.formats.codex ? '[✓ Codex]' : '[· Codex]'}
              </Text>
              <Text color={item.pluginContents.formats.copilot ? 'green' : 'gray'}>
                {item.pluginContents.formats.copilot ? '[✓ Copilot]' : '[· Copilot]'}
              </Text>
              <Text color={item.pluginContents.formats.cursor ? 'green' : 'gray'}>
                {item.pluginContents.formats.cursor ? '[✓ Cursor]' : '[· Cursor]'}
              </Text>
            </Box>
          )}

          {(() => {
            const pc = item.pluginContents;
            const total =
              (pc.skills?.length || 0) +
              (pc.commands?.length || 0) +
              (pc.agents?.length || 0) +
              (pc.mcps?.length || 0) +
              (pc.hooks?.length || 0) +
              (pc.lspServers?.length || 0);
            if (total === 0) return null;
            return (
              <Box marginTop={1} flexDirection="column">
                <Text bold>{item.installed ? 'Installed components:' : 'Will install:'}</Text>
                {(pc.skills || []).map(s => (
                  <Text key={`s-${s}`} color="magenta">  SKILL    {s}</Text>
                ))}
                {(pc.commands || []).map(c => (
                  <Text key={`c-${c}`} color="magentaBright">  COMMAND  /{c}</Text>
                ))}
                {(pc.agents || []).map(a => (
                  <Text key={`a-${a}`} color="blue">  AGENT    {a}</Text>
                ))}
                {(pc.mcps || []).map(m => (
                  <Text key={`m-${m}`} color="yellow">  MCP      {m}</Text>
                ))}
                {(pc.lspServers || []).map(l => (
                  <Text key={`l-${l}`} color="redBright">  LSP      {l}</Text>
                ))}
                {(pc.hooks || []).map(h => (
                  <Text key={`h-${h}`} color="cyan">  HOOK     {h}</Text>
                ))}
              </Box>
            );
          })()}
        </Box>
      )}

      {item.mcpType && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Type: {item.mcpType}</Text>
          {item.url && <Text dimColor>URL: {item.url}</Text>}
          {item.setupNote && <Text color="cyan">{item.setupNote}</Text>}
        </Box>
      )}

      <Box marginTop={1} gap={2}>
        {item.installed ? (
          <>
            <Text color="green">{item.trackedByLock === false ? '● Detected on disk' : '● Installed'}</Text>
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

      {item.installed && item.trackedByLock === false && (
        <Box>
          <Text dimColor>This item exists in the target app folders, but the lock file does not currently track it.</Text>
        </Box>
      )}

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
