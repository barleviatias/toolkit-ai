import React from 'react';
import { Text, Box } from 'ink';

export interface ItemData {
  key: string;        // e.g. 'skill::internal::writing-skills'
  type: string;       // 'skill' | 'agent' | 'mcp' | 'bundle'
  name: string;
  description: string;
  source: string;     // 'internal' or external source name
  installed: boolean;
  hasUpdate?: boolean;
  path?: string;      // relative path within source (for external items)
  hash?: string;      // content hash (for external items)
  scanStatus?: 'ok' | 'warn' | 'block';
  scanSummary?: string; // short summary of findings
  // Bundle-specific
  bundleContents?: { skills: string[]; agents: string[]; mcps: string[] };
  // MCP-specific
  mcpType?: string;
  url?: string;
  setupNote?: string;
}

const TYPE_COLORS: Record<string, string> = {
  skill:  'magenta',
  agent:  'blue',
  mcp:    'yellow',
  bundle: 'cyan',
};

interface ItemRowProps {
  item: ItemData;
  isActive: boolean;
  isSelected: boolean;
}

export const ItemRow: React.FC<ItemRowProps> = ({ item, isActive, isSelected }) => {
  const cursor = isActive ? '❯ ' : '  ';
  const check = isSelected ? '● ' : '○ ';
  const checkColor = isSelected ? 'green' : 'gray';
  const typeColor = TYPE_COLORS[item.type] || 'white';

  return (
    <Box flexDirection="column" marginLeft={0}>
      <Box>
        <Text color={isActive ? 'cyan' : undefined}>{cursor}</Text>
        <Text color={checkColor}>{check}</Text>
        <Text color={typeColor} bold>{item.type.toUpperCase().padEnd(6)} </Text>
        <Text bold={isActive}>{item.name}</Text>
        <Text dimColor> · {item.source}</Text>
        {item.scanStatus === 'block' && <Text color="red"> ✕ blocked</Text>}
        {item.scanStatus === 'warn' && <Text color="yellow"> ⚠</Text>}
        {item.installed && <Text color="green"> · installed</Text>}
        {item.hasUpdate && <Text color="yellow"> · update available</Text>}
      </Box>
      <Box marginLeft={14}>
        <Text dimColor wrap="truncate">{item.description}</Text>
      </Box>
    </Box>
  );
};
