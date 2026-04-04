/**
 * Structured key handling for catalog items.
 * Uses `::` delimiter to avoid collisions with item names/sources.
 */

export interface ParsedKey {
  type: string;
  source: string;
  name: string;
}

export function makeKey(type: string, source: string, name: string): string {
  return `${type}::${source}::${name}`;
}

export function parseKey(key: string): ParsedKey {
  const parts = key.split('::');
  if (parts.length === 3) {
    return { type: parts[0], source: parts[1], name: parts[2] };
  }
  // Fallback for legacy single-colon keys (type:name)
  const colonParts = key.split(':');
  return {
    type: colonParts[0],
    source: 'legacy',
    name: colonParts[colonParts.length - 1],
  };
}
