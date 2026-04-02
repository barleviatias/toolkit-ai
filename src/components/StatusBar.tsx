import React from 'react';
import { Text, Box } from 'ink';

interface StatusBarProps {
  hints?: string;
  selectedCount?: number;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  hints = 'type to search · Space to toggle · Enter to details · Tab to switch · Esc to back',
  selectedCount,
}) => (
  <Box marginTop={1} flexDirection="column">
    {selectedCount != null && selectedCount > 0 && (
      <Text color="green">  Selected: {selectedCount} item(s)</Text>
    )}
    <Text dimColor italic>  {hints}</Text>
  </Box>
);
