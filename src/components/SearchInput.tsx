import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  isFocused: boolean;
  total?: number;
  filtered?: number;
}

export const SearchInput: React.FC<SearchInputProps> = ({ value, onChange, isFocused, total, filtered }) => (
  <Box borderStyle="round" borderColor={isFocused ? 'cyan' : 'gray'} paddingX={1}>
    <Text color="cyan">{isFocused ? '◆ ' : '◇ '}</Text>
    <TextInput
      value={value}
      onChange={onChange}
      placeholder="Search..."
      focus={isFocused}
    />
    {total != null && (
      <Text dimColor> ({filtered ?? total}/{total})</Text>
    )}
  </Box>
);
