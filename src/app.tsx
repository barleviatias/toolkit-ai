import React, { useState, useCallback, useMemo } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { EscContext, useEscCoordinator } from './hooks/useEscContext.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { TabBar, type TabId, type Tab } from './components/TabBar.js';
import { Logo } from './components/Logo.js';
import { Spinner } from './components/Spinner.js';
import { useCatalog } from './hooks/useCatalog.js';
import { useUpdateCheck } from './hooks/useUpdateCheck.js';
import { CatalogTab } from './tabs/CatalogTab.js';
import { InstalledTab } from './tabs/InstalledTab.js';
import { SourcesTab } from './tabs/SourcesTab.js';
import { SettingsTab } from './tabs/SettingsTab.js';
import {
  installSkill,
  installAgent,
  installMcp,
  installBundle,
} from './core/installer.js';
import { updateAll } from './core/updater.js';
import { detectToolInstallations } from './core/platform.js';
import type { ItemData } from './components/ItemRow.js';

interface AppProps {
  initialTab: TabId;
}

const TAB_ORDER: TabId[] = ['catalog', 'installed', 'sources', 'settings'];

const App: React.FC<AppProps> = ({ initialTab }) => {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const { exit } = useApp();
  const { rows: termRows } = useTerminalSize();
  const esc = useEscCoordinator();
  const updateInfo = useUpdateCheck();
  const detectedTargets = useMemo(
    () => detectToolInstallations().filter(target => target.installed),
    [],
  );
  const targetLabels = detectedTargets.map(target => target.label);

  const {
    catalog,
    allItems,
    installedItems,
    refreshLock,
    refreshExternal,
    refreshSingleSource,
    forgetSource,
    adoptSource,
    sourceStatus,
    loading,
    sourceWarnings,
  } = useCatalog();

  const updateCount = allItems.filter(i => i.hasUpdate).length;

  const tabs: Tab[] = [
    { id: 'catalog', label: updateCount > 0 ? `Catalog ~${updateCount}` : 'Catalog', badge: allItems.length },
    { id: 'installed', label: 'Installed', badge: installedItems.length },
    { id: 'sources', label: 'Sources' },
    { id: 'settings', label: 'Settings' },
  ];

  const handleRefresh = useCallback(() => {
    refreshLock();
  }, [refreshLock]);

  const handleUpdateItem = useCallback((item: ItemData) => {
    const { type, name } = item;
    if (type === 'skill')       installSkill(catalog, name, { force: true }, () => {});
    else if (type === 'agent')  installAgent(catalog, name, { force: true }, () => {});
    else if (type === 'mcp')    installMcp(catalog, name, { force: true }, () => {});
    else if (type === 'bundle') installBundle(catalog, name, { force: true }, () => {});
    else throw new Error(`${type} ${name} cannot be updated`);
    refreshLock();
  }, [catalog, refreshLock]);

  const handleUpdateAll = useCallback(() => {
    updateAll(catalog, { force: false }, () => {});
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
    // Esc = go back if a subview handled it; otherwise exit the app.
    if (key.escape) esc.onEscape(exit);
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      // Ink's exit() only unmounts; if a git clone (or other spawned child) is
      // still running, the process stays alive and the terminal looks frozen.
      // Force-exit on the next tick so cleanup runs but we don't wait on
      // children that may be wedged on a credential prompt.
      setImmediate(() => process.exit(0));
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
    <EscContext.Provider value={esc.contextValue}>
    <Box flexDirection="column" height={termRows}>
      {showLogo && <Logo />}
      <TabBar tabs={tabs} activeTab={activeTab} />
      <Box marginLeft={2}>
        {targetLabels.length > 0 ? (
          <>
            <Text dimColor>Targets: </Text>
            <Text color="cyan">{targetLabels.join(', ')}</Text>
          </>
        ) : (
          <Text color="yellow">No target providers detected. Run `toolkit targets` for details.</Text>
        )}
      </Box>
      {updateInfo.newer && updateInfo.latest && (
        <Box marginLeft={2}>
          {updateInfo.autoUpdating ? (
            <>
              <Text color="cyan">↑ Upgrading to toolkit-ai {updateInfo.latest} in the background</Text>
              <Text dimColor>  (restart the CLI to pick it up)</Text>
            </>
          ) : (
            <>
              <Text color="yellow">↑ toolkit-ai {updateInfo.latest} available</Text>
              <Text dimColor>  (you are on {updateInfo.current} — run `npm install -g toolkit-ai@latest`)</Text>
            </>
          )}
        </Box>
      )}
      {sourceWarnings.length > 0 && (
        <Box marginLeft={2}>
          <Text color="yellow">! Source refresh warning</Text>
          <Text dimColor>  ({sourceWarnings.length} source{sourceWarnings.length > 1 ? 's' : ''}; cached data kept where available)</Text>
        </Box>
      )}

      {loading && allItems.length === 0 && activeTab !== 'settings' && (
        <Box marginLeft={2}>
          <Spinner label="Fetching sources from GitHub/Bitbucket..." />
        </Box>
      )}

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
            sourceStatus={sourceStatus}
            onRefresh={handleRefresh}
            onRefreshSources={refreshExternal}
            onRefreshSingleSource={refreshSingleSource}
            onForgetSource={forgetSource}
            onAdoptSource={adoptSource}
          />
        )}
        {activeTab === 'settings' && <SettingsTab />}
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
