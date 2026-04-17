import React, { useState, useCallback, useEffect, useRef, useMemo, createContext, useContext } from 'react';
import { render, Box, useInput, useApp } from 'ink';
import { TabBar, type TabId, type Tab } from './components/TabBar.js';
import { Logo } from './components/Logo.js';
import { useCatalog } from './hooks/useCatalog.js';
import { CatalogTab } from './tabs/CatalogTab.js';
import { InstalledTab } from './tabs/InstalledTab.js';
import { SourcesTab } from './tabs/SourcesTab.js';
import {
  installSkill,
  installAgent,
  installMcp,
  installBundle,
} from './core/installer.js';
import { updateAll } from './core/updater.js';
import type { ItemData } from './components/ItemRow.js';

interface AppProps {
  initialTab: TabId;
}

/**
 * Shared "Esc was consumed" ref. Child components (detail views, confirm
 * dialogs, search mode, add-source mode) set it during their Esc handler
 * so the app's Esc-to-exit handler knows NOT to exit when a subview just
 * closed. Ink's useInput fires all hooks synchronously with no bubble/
 * capture, so we coordinate via a shared ref and a microtask check.
 */
interface EscContextValue {
  markConsumed: () => void;
}
const EscContext = createContext<EscContextValue>({ markConsumed: () => {} });

/** Call this in a child's Esc handler right before doing the "go back" action. */
export function useMarkEscConsumed(): () => void {
  return useContext(EscContext).markConsumed;
}

const TAB_ORDER: TabId[] = ['catalog', 'installed', 'sources'];

/**
 * Track terminal dimensions and update on SIGWINCH. Used to constrain the
 * app's root Box to the viewport so Ink never renders past the bottom of the
 * terminal — which is what causes the "screen goes weird" behavior when
 * content would otherwise overflow the visible area.
 */
function useTerminalSize(): { rows: number; columns: number } {
  const [size, setSize] = useState(() => ({
    rows: process.stdout.rows || 24,
    columns: process.stdout.columns || 80,
  }));
  useEffect(() => {
    const onResize = () => setSize({
      rows: process.stdout.rows || 24,
      columns: process.stdout.columns || 80,
    });
    process.stdout.on('resize', onResize);
    return () => { process.stdout.off('resize', onResize); };
  }, []);
  return size;
}

const App: React.FC<AppProps> = ({ initialTab }) => {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const { exit } = useApp();
  const { rows: termRows } = useTerminalSize();
  const escConsumedRef = useRef(false);
  const escContextValue = useMemo<EscContextValue>(() => ({
    markConsumed: () => { escConsumedRef.current = true; },
  }), []);

  const {
    catalog,
    allItems,
    installedItems,
    refreshLock,
    refreshExternal,
  } = useCatalog();

  const updateCount = allItems.filter(i => i.hasUpdate).length;

  const tabs: Tab[] = [
    { id: 'catalog', label: updateCount > 0 ? `Catalog ~${updateCount}` : 'Catalog', badge: allItems.length },
    { id: 'installed', label: 'Installed', badge: installedItems.length },
    { id: 'sources', label: 'Sources' },
  ];

  const handleRefresh = useCallback(() => {
    refreshLock();
  }, [refreshLock]);

  const handleUpdateItem = useCallback((item: ItemData) => {
    const { type, name } = item;
    try {
      if (type === 'skill')      installSkill(catalog, name, { force: true }, () => {});
      else if (type === 'agent') installAgent(catalog, name, { force: true }, () => {});
      else if (type === 'mcp')   installMcp(catalog, name, { force: true }, () => {});
      else if (type === 'bundle') installBundle(catalog, name, { force: true }, () => {});
      refreshLock();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[toolkit] update failed for ${type} ${name}: ${msg}\n`);
    }
  }, [catalog, refreshLock]);

  const handleUpdateAll = useCallback(() => {
    updateAll(catalog, { force: true }, () => {});
    refreshLock();
  }, [catalog, refreshLock]);

  useInput((input, key) => {
    if (key.tab) {
      setActiveTab(current => {
        const idx = TAB_ORDER.indexOf(current);
        const next = key.shift
          ? (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length
          : (idx + 1) % TAB_ORDER.length;
        return TAB_ORDER[next];
      });
    }
    if (key.escape) {
      // Clear flag first, then let child Esc handlers (which fire in the same
      // synchronous useInput pass) set it via markConsumed if they handled the
      // key. Check in a microtask — if no child consumed, exit the app.
      escConsumedRef.current = false;
      queueMicrotask(() => {
        if (!escConsumedRef.current) exit();
        escConsumedRef.current = false;
      });
    }
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  // Hide the ASCII logo on small terminals (< 30 rows) so the list + chrome
  // always have enough room. This prevents the frame from overflowing the
  // viewport and breaking Ink's in-place diff rendering.
  const showLogo = termRows >= 30;

  // Full-screen layout: root Box takes the full terminal height, the inner
  // content Box flex-grows to fill. Do NOT use `overflow="hidden"` — in Ink
  // v6 it clips children without emitting clear-to-EOL, leaving stale
  // characters from the previous frame bleeding through. Instead, we rely on
  // strict content sizing (maxVisible in ItemList) to keep the frame within
  // the viewport.
  return (
    <EscContext.Provider value={escContextValue}>
    <Box flexDirection="column" height={termRows}>
      {showLogo && <Logo />}
      <TabBar tabs={tabs} activeTab={activeTab} />

      <Box flexDirection="column" flexGrow={1}>
        {activeTab === 'catalog' && (
          <CatalogTab
            items={allItems}
            catalog={catalog}
            onRefresh={handleRefresh}
            onUpdateItem={handleUpdateItem}
            onUpdateAll={handleUpdateAll}
          />
        )}
        {activeTab === 'installed' && (
          <InstalledTab
            items={installedItems}
            catalog={catalog}
            onRefresh={handleRefresh}
            onUpdateItem={handleUpdateItem}
            onUpdateAll={handleUpdateAll}
          />
        )}
        {activeTab === 'sources' && (
          <SourcesTab
            allItems={allItems}
            catalog={catalog}
            onRefresh={handleRefresh}
            onRefreshSources={refreshExternal}
          />
        )}
      </Box>
    </Box>
    </EscContext.Provider>
  );
};

export async function renderApp(_toolkitDir: string, initialTab: string = 'catalog') {
  const tab = TAB_ORDER.includes(initialTab as TabId) ? (initialTab as TabId) : 'catalog';

  // Enter the terminal's alternate screen buffer, clear it, and park the
  // cursor at the top. Clearing is important — Ghostty / iTerm can retain
  // previous alt-screen contents across invocations, and Ink's cursor-up
  // diff will paint on top of that garbage.
  const isTTY = !!process.stdout.isTTY;
  if (isTTY) {
    process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (isTTY) process.stdout.write('\x1b[?1049l');
    process.off('exit', cleanup);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };
  const onSignal = () => { cleanup(); process.exit(0); };

  process.once('exit', cleanup);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const { waitUntilExit } = render(<App initialTab={tab} />);
  try {
    await waitUntilExit();
  } finally {
    cleanup();
  }
}
