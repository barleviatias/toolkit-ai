import React from 'react';
import { Box, Text } from 'ink';

const TYPE_ORDER = ['skill', 'plugin', 'agent', 'mcp', 'bundle'] as const;

const TYPE_LABELS: Record<string, string> = {
  skill: 'Skills',
  plugin: 'Plugins',
  agent: 'Agents',
  mcp: 'MCPs',
  bundle: 'Bundles',
};

const TYPE_COLORS: Record<string, string> = {
  skill: 'magenta',
  plugin: 'green',
  agent: 'blue',
  mcp: 'yellow',
  bundle: 'cyan',
};

interface TypeFilterProps {
  counts: Record<string, number>;
  active: Set<string>;
  total: number;
}

export const TypeFilter: React.FC<TypeFilterProps> = ({ counts, active, total }) => {
  const allActive = active.size === 0;

  return (
    <Box gap={1} marginBottom={0}>
      <Text dimColor> </Text>
      <Text inverse={allActive} color={allActive ? undefined : 'gray'} bold={allActive}>
        {` All(${total}) `}
      </Text>
      {TYPE_ORDER.map((type, i) => {
        const isActive = active.has(type);
        const count = counts[type] || 0;
        const color = TYPE_COLORS[type];
        return (
          <Text
            key={type}
            inverse={isActive}
            color={isActive ? color : 'gray'}
            bold={isActive}
          >
            {` ${i + 1}:${TYPE_LABELS[type]}(${count}) `}
          </Text>
        );
      })}
    </Box>
  );
};
