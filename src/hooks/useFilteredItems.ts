import { useMemo } from 'react';
import type { ItemData } from '../components/ItemRow.js';

/** Match an item against a search query (name, description, or type). */
function matchesQuery(item: ItemData, query: string): boolean {
  const q = query.toLowerCase();
  return (
    item.name.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q) ||
    item.type.toLowerCase().includes(q)
  );
}

/** Filter items by search query and optional type filter set. */
export function filterItems(items: ItemData[], query: string, typeFilter: Set<string>): ItemData[] {
  let result = items;
  if (typeFilter.size > 0) {
    result = result.filter(i => typeFilter.has(i.type));
  }
  if (query) {
    result = result.filter(i => matchesQuery(i, query));
  }
  return result;
}

/** Count items per type, optionally narrowed by search query. */
export function countByType(items: ItemData[], query: string): Record<string, number> {
  const filtered = query ? items.filter(i => matchesQuery(i, query)) : items;
  const counts: Record<string, number> = {};
  for (const item of filtered) {
    counts[item.type] = (counts[item.type] || 0) + 1;
  }
  return counts;
}

/** Count total items matching a search query. */
export function countSearchMatches(items: ItemData[], query: string): number {
  if (!query) return items.length;
  return items.filter(i => matchesQuery(i, query)).length;
}

/**
 * Hook that returns filtered items, type counts, and search total.
 * Centralizes the filter/search logic shared across Catalog and Installed tabs.
 */
export function useFilteredItems(items: ItemData[], query: string, typeFilter: Set<string>) {
  const filtered = useMemo(() => filterItems(items, query, typeFilter), [items, query, typeFilter]);
  const typeCounts = useMemo(() => countByType(items, query), [items, query]);
  const searchTotal = useMemo(() => countSearchMatches(items, query), [items, query]);
  return { filtered, typeCounts, searchTotal };
}
