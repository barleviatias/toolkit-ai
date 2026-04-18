import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useMarkEscConsumed } from '../hooks/useEscContext.js';

interface ConfirmDialogProps {
  title: string;
  items: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  items,
  onConfirm,
  onCancel,
}) => {
  const markEscConsumed = useMarkEscConsumed();
  useInput((input, key) => {
    if (input === 'y' || key.return) {
      onConfirm();
    } else if (input === 'n' || key.escape) {
      if (key.escape) markEscConsumed();
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1}>
      <Text bold color="yellow">{title}</Text>
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        {items.slice(0, 10).map((item, i) => (
          <Text key={i} dimColor>{'- '}{item}</Text>
        ))}
        {items.length > 10 && (
          <Text dimColor>  ...and {items.length - 10} more</Text>
        )}
      </Box>
      <Box marginTop={1} gap={3}>
        <Text><Text color="green" bold>y</Text><Text dimColor> confirm</Text></Text>
        <Text><Text color="red" bold>n</Text><Text dimColor> cancel</Text></Text>
      </Box>
    </Box>
  );
};
