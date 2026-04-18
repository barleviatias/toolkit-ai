import type { ItemData } from '../components/ItemRow.js';

export interface ConsentPrompt {
  title: string;
  lines: string[];
}

/**
 * Should installing this item ask the user first? Consent is required when:
 * - scanner matched a dangerous pattern (red ⚠ suspicious, `scanStatus === 'block'`)
 * - the MCP will execute a local command on every agent session (any stdio MCP)
 * - installing a bundle that contains any of the above transitively
 *
 * Warn-only findings ('notice' yellow badge) deliberately do NOT trigger a modal —
 * they're informational (oversized file, HTTP not HTTPS, etc.) and the badge + the
 * DetailView show them. Popping a dialog for every `warn` trains users to press `y`
 * reflexively and defeats the consent UX on the truly risky cases.
 */
export function needsConsent(item: ItemData, bundleItems: ItemData[] = []): boolean {
  if (isItemRisky(item)) return true;
  if (item.type === 'bundle' && bundleItems.some(isItemRisky)) return true;
  return false;
}

function isItemRisky(item: ItemData): boolean {
  if (item.scanStatus === 'block') return true;
  if (item.type === 'mcp' && !!item.mcpCommand) return true;
  return false;
}

/**
 * Build a pre-install preview for the ConfirmDialog: what will run on the host
 * and what side-effects the toolkit will apply. `bundleItems` lets a bundle
 * dialog surface every risky sub-item in one screen so the user doesn't have to
 * read and click through N dialogs.
 */
export function buildConsentPrompt(item: ItemData, bundleItems: ItemData[] = []): ConsentPrompt {
  const lines: string[] = [];

  if (item.type === 'bundle') {
    const riskyChildren = bundleItems.filter(isItemRisky);
    if (riskyChildren.length > 0) {
      lines.push(`This bundle will install ${bundleItems.length} item(s), including:`);
      for (const child of riskyChildren) {
        if (child.type === 'mcp' && child.mcpCommand) {
          const preview = truncatePreview([child.mcpCommand, ...(child.mcpArgs || [])].join(' '));
          lines.push(`  • ${child.name}: runs "${preview}" on every agent session`);
        } else if (child.scanStatus === 'block') {
          lines.push(`  • ${child.name}: ${child.scanSummary || 'scanner flagged suspicious patterns'}`);
        }
      }
    }
    const severityIcon = riskyChildren.length > 0 ? '\u26a0 ' : '';
    return {
      title: `${severityIcon}Install bundle '${item.name}' from ${item.source}?`,
      lines,
    };
  }

  if (item.type === 'mcp' && item.mcpCommand) {
    const preview = truncatePreview([item.mcpCommand, ...(item.mcpArgs || [])].join(' '));
    lines.push(`Runs on every agent session: ${preview}`);
  }
  if (item.scanStatus === 'block' && item.scanSummary) {
    lines.push(item.scanSummary);
  }
  if (item.type === 'mcp') {
    lines.push('Writes to Claude, Codex, Cursor, and VSCode MCP configs.');
  }

  const severityIcon = item.scanStatus === 'block' || (item.type === 'mcp' && !!item.mcpCommand) ? '\u26a0 ' : '';
  return {
    title: `${severityIcon}Install ${item.type} '${item.name}' from ${item.source}?`,
    lines,
  };
}

function truncatePreview(s: string): string {
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}

/** Resolve the items a bundle would install. Needed so the consent prompt can
 *  enumerate risky sub-items before we commit to installBundle. */
export function resolveBundleChildren(bundle: ItemData, allItems: ItemData[]): ItemData[] {
  if (bundle.type !== 'bundle' || !bundle.bundleContents) return [];
  const { skills = [], agents = [], mcps = [] } = bundle.bundleContents;
  const children: ItemData[] = [];
  for (const name of skills) {
    const found = allItems.find(i => i.type === 'skill' && i.name === name && i.source === bundle.source);
    if (found) children.push(found);
  }
  for (const name of agents) {
    const found = allItems.find(i => i.type === 'agent' && i.name === name && i.source === bundle.source);
    if (found) children.push(found);
  }
  for (const name of mcps) {
    const found = allItems.find(i => i.type === 'mcp' && i.name === name && i.source === bundle.source);
    if (found) children.push(found);
  }
  return children;
}
