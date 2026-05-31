import React from 'react';
import { Text, Box } from 'ink';

export interface ItemData {
  key: string;        // e.g. 'skill::anthropics::writing-skills'
  type: string;       // 'skill' | 'agent' | 'mcp' | 'bundle'
  name: string;
  description: string;
  version?: string;
  source: string;     // source name
  installed: boolean;
  hasUpdate?: boolean;
  path?: string;      // relative path within source
  hash?: string;      // content hash
  scanStatus?: 'ok' | 'warn' | 'block';
  scanSummary?: string; // short summary of findings
  trackedByLock?: boolean;
  lastUpdatedAt?: string;
  targetLabels?: string[];
  installedTargetLabels?: string[];
  /**
   * Per-detected-provider install state. When set, takes precedence over
   * `targetLabels` / `installedTargetLabels` in the DetailView so we render
   * each provider with a green ✓ (already installed there) or gray ○ (will
   * install). Currently populated for plugins, where a given item may be
   * partially installed across providers (e.g. native in Claude Code via
   * `/plugin install`, but not yet decomposed elsewhere).
   */
  targetStatus?: { label: string; installed: boolean }[];
  // Bundle-specific
  bundleContents?: { skills: string[]; agents: string[]; mcps: string[] };
  // Plugin-specific — the components a plugin install lays down
  pluginContents?: { skills: string[]; agents: string[]; commands: string[]; mcps: number; hasHooks: boolean };
  // MCP-specific
  mcpType?: string;
  url?: string;
  setupNote?: string;
  mcpCommand?: string;
  mcpArgs?: string[];
}

const TYPE_COLORS: Record<string, string> = {
  skill:   'magenta',
  agent:   'blue',
  mcp:     'yellow',
  bundle:  'cyan',
  command: 'green',
  plugin:  'red',
};

interface ItemRowProps {
  item: ItemData;
  isActive: boolean;
  isSelected: boolean;
}

function compactLabels(labels: string[] = []): string {
  if (labels.length <= 3) return labels.join(', ');
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3}`;
}

function formatDateTime(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const ItemRow: React.FC<ItemRowProps> = ({ item, isActive, isSelected }) => {
  const cursor = isActive ? '❯ ' : '  ';
  const check = isSelected ? '● ' : '○ ';
  const checkColor = isSelected ? 'green' : 'gray';
  const typeColor = TYPE_COLORS[item.type] || 'white';
  const lastUpdated = formatDateTime(item.lastUpdatedAt);

  return (
    <Box flexDirection="column" marginLeft={0}>
      <Box>
        <Text color={isActive ? 'cyan' : undefined}>{cursor}</Text>
        <Text color={checkColor}>{check}</Text>
        <Text color={typeColor} bold>{item.type.toUpperCase().padEnd(7)} </Text>
        <Text bold={isActive}>{item.name}</Text>
        {item.type === 'plugin' && item.version && (
          <Text dimColor> · v{item.version}</Text>
        )}
        <Text dimColor> · {item.source}</Text>
        {item.source === 'claude' && item.type === 'plugin' && (
          <Text color="cyan"> · via Claude</Text>
        )}
        {item.source === 'copilot' && item.type === 'plugin' && (
          <Text color="cyan"> · via Copilot</Text>
        )}
        {item.scanStatus === 'block' && <Text color="red"> ⚠ suspicious</Text>}
        {item.scanStatus === 'warn' && <Text color="yellow"> ⚠ notice</Text>}
        {(() => {
          // Partial install (e.g. plugin in Claude natively, not decomposed
          // elsewhere) — surface as "◐ partial" with the missing-provider count.
          const partial = !item.installed && item.targetStatus?.some(s => s.installed) && item.targetStatus?.some(s => !s.installed);
          if (partial) {
            const missing = item.targetStatus!.filter(s => !s.installed).length;
            return <Text color="cyan"> · ◐ partial ({missing} provider{missing > 1 ? 's' : ''} pending)</Text>;
          }
          return null;
        })()}
        {item.installed && (
          <Text color="green">{item.trackedByLock === false ? ' · detected on disk' : ' · installed'}</Text>
        )}
        {item.installed && lastUpdated && (
          <Text dimColor> · updated {lastUpdated}</Text>
        )}
        {item.installed && item.installedTargetLabels && item.installedTargetLabels.length > 0 && (
          <Text dimColor> · in {compactLabels(item.installedTargetLabels)}</Text>
        )}
        {!item.installed && !item.targetStatus?.some(s => s.installed) && item.targetLabels && item.targetLabels.length > 0 && (
          <Text dimColor> · targets {compactLabels(item.targetLabels)}</Text>
        )}
        {item.hasUpdate && <Text color="yellow"> · update available</Text>}
      </Box>
      <Box marginLeft={14}>
        <Text dimColor wrap="truncate">{item.description}</Text>
      </Box>
    </Box>
  );
};
