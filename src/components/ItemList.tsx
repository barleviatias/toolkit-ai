import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { ItemRow, type ItemData } from './ItemRow.js';

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
 * Track the terminal's row count and update on resize so the list can resize itself.
 * Reading process.stdout.rows at module load (as a default prop value) doesn't react
 * to SIGWINCH, which is exactly what the user reported: content taller than the
 * viewport pushes the header (logo, tabs) off-screen.
 */
function useStdoutRows(): number {
  const [rows, setRows] = useState<number>(process.stdout.rows || 24);
  useEffect(() => {
    const onResize = () => setRows(process.stdout.rows || 24);
    process.stdout.on('resize', onResize);
    return () => { process.stdout.off('resize', onResize); };
  }, []);
  return rows;
}

/**
 * Compute the maximum list items that fit given a terminal row count, reserving
 * enough space for all chrome (logo, tabs, search, type-filter, source header,
 * status bar, and margins). Conservative — we'd rather scroll inside a short
 * list than let the frame overflow the viewport and break Ink's rendering.
 *
 * Each ItemRow renders as 2 lines (title + description).
 *
 * Assumes the app auto-hides the logo on terminals < 30 rows; either way, a
 * conservative 20-row reservation keeps the chrome stable.
 */
function computeMaxVisible(rows: number): number {
  const CHROME_RESERVE = rows >= 30
    ? 20  // with logo: logo 8 + tabs 2 + search 2 + filters 2 + header 2 + status 2 + margin 2
    : 12; // no logo: tabs 2 + search 2 + filters 2 + header 2 + status 2 + margin 2
  const ROWS_PER_ITEM = 2;
  const available = Math.max(3, Math.floor((rows - CHROME_RESERVE) / ROWS_PER_ITEM));
  return Math.min(10, available);
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
  const terminalRows = useStdoutRows();
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
      const item = items[clampedCursor];
      if (item && !item.installed) onInstall(item);
    } else if (input === 'r' && onRemove) {
      const item = items[clampedCursor];
      if (item && item.installed) onRemove(item);
    } else if (input === 'u' && onUpdate) {
      const item = items[clampedCursor];
      if (item && item.hasUpdate) onUpdate(item);
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
