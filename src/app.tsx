import React, { useState, useCallback } from 'react';
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

const TAB_ORDER: TabId[] = ['catalog', 'installed', 'sources'];

const App: React.FC<AppProps> = ({ initialTab }) => {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const { exit } = useApp();

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
    } catch {}
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
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Logo />
      <TabBar tabs={tabs} activeTab={activeTab} />

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
  );
};

export async function renderApp(toolkitDir: string, initialTab: string = 'catalog') {
  const tab = TAB_ORDER.includes(initialTab as TabId) ? (initialTab as TabId) : 'catalog';
  void toolkitDir;
  const { waitUntilExit } = render(<App initialTab={tab} />);
  await waitUntilExit();
}
