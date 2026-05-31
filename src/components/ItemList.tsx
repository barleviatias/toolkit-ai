import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { ItemRow, type ItemData } from './ItemRow.js';
import { useTerminalRows } from '../hooks/useTerminalSize.js';

interface ItemListProps {
  items: ItemData[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onSubmit: (keys: string[]) => void;
  onDetail?: (item: ItemData) => void;
  onInstall?: (item: ItemData) => void;
  onRemove?: (item: ItemData) => void;
  onUpdate?: (item: ItemData) => void;
  isFocused: boolean;
  maxVisible?: number;
}

/**
 * Compute the maximum list items that fit given a terminal row count. Chrome
 * reservation covers logo, tabs, targets, the bordered search box (3 lines),
 * filters, the tab header, the message/busy line that sits below the list, the
 * status bar, and list margins — each ItemRow is 2 lines. Confirm dialogs and
 * the detail view are modal (they replace the list), so only the single message
 * line competes with it. The ceiling keeps the frame within the viewport even
 * when the optional update/source-warning banners appear.
 */
function computeMaxVisible(rows: number): number {
  const CHROME_RESERVE = rows >= 30
    ? 22  // with logo: logo 9 + tabs 2 + targets 1 + search 3 + filters 2 + header 1 + message 1 + status 2 + margin 1
    : 14; // no logo: tabs 2 + targets 1 + search 3 + filters 2 + header 1 + message 1 + status 2 + margin 2
  const ROWS_PER_ITEM = 2;
  const available = Math.max(3, Math.floor((rows - CHROME_RESERVE) / ROWS_PER_ITEM));
  return Math.min(18, available);
}

export const ItemList: React.FC<ItemListProps> = ({
  items,
  selected,
  onToggle,
  onSubmit,
  onDetail,
  onInstall,
  onRemove,
  onUpdate,
  isFocused,
  maxVisible: maxVisibleProp,
}) => {
  const terminalRows = useTerminalRows();
  const maxVisible = maxVisibleProp ?? computeMaxVisible(terminalRows);
  const [cursor, setCursor] = useState(0);

  // Clamp cursor when items change
  const clampedCursor = Math.min(cursor, Math.max(0, items.length - 1));
  if (clampedCursor !== cursor) setCursor(clampedCursor);

  // Calculate scroll window
  const scrollOffset = useMemo(() => {
    const half = Math.floor(maxVisible / 2);
    let start = clampedCursor - half;
    start = Math.max(0, start);
    start = Math.min(start, Math.max(0, items.length - maxVisible));
    return start;
  }, [clampedCursor, items.length, maxVisible]);

  const visibleItems = items.slice(scrollOffset, scrollOffset + maxVisible);
  const hiddenBefore = scrollOffset;
  const hiddenAfter = Math.max(0, items.length - scrollOffset - maxVisible);

  useInput((input, key) => {
    if (!isFocused || items.length === 0) return;

    if (key.upArrow) {
      setCursor(c => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor(c => Math.min(items.length - 1, c + 1));
    } else if (input === ' ') {
      const item = items[clampedCursor];
      if (item) onToggle(item.key);
    } else if (key.return) {
      if (selected.size > 0) {
        onSubmit(Array.from(selected));
      } else if (onDetail && items[clampedCursor]) {
        onDetail(items[clampedCursor]);
      }
    } else if (input === 'a') {
      // Proper toggle-all: if all visible selected, deselect all; otherwise select all
      const allSelected = items.every(i => selected.has(i.key));
      for (const item of items) {
        if (allSelected && selected.has(item.key)) onToggle(item.key);
        else if (!allSelected && !selected.has(item.key)) onToggle(item.key);
      }
    } else if (input === 'i' && onInstall) {
      // Always fire — parent decides whether the action applies and shows a
      // hint otherwise. Silent no-ops here make users think the TUI is broken.
      const item = items[clampedCursor];
      if (item) onInstall(item);
    } else if (input === 'r' && onRemove) {
      const item = items[clampedCursor];
      if (item) onRemove(item);
    } else if (input === 'u' && onUpdate) {
      const item = items[clampedCursor];
      if (item) onUpdate(item);
    }
  });

  if (items.length === 0) {
    return (
      <Box marginY={1}>
        <Text dimColor>  No matches found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      {hiddenBefore > 0 && (
        <Text dimColor>  ↑ {hiddenBefore} more</Text>
      )}
      {visibleItems.map((item, i) => (
        <ItemRow
          key={item.key}
          item={item}
          isActive={isFocused && scrollOffset + i === clampedCursor}
          isSelected={selected.has(item.key)}
        />
      ))}
      {hiddenAfter > 0 && (
        <Text dimColor>  ↓ {hiddenAfter} more</Text>
      )}
    </Box>
  );
};
