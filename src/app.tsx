import React, { useState, useCallback } from 'react';
import { render, Box, useInput, useApp } from 'ink';
import { TabBar, type TabId, type Tab } from './components/TabBar.js';
import { Logo } from './components/Logo.js';
import { useCatalog } from './hooks/useCatalog.js';
import { CatalogTab } from './tabs/CatalogTab.js';
import { InstalledTab } from './tabs/InstalledTab.js';
import { SourcesTab } from './tabs/SourcesTab.js';
import { installSkill, installAgent, installMcp, installExternalSkill, installExternalAgent, installExternalMcp } from './core/installer.js';
import { updateAll } from './core/updater.js';
import type { ItemData } from './components/ItemRow.js';

interface AppProps {
  toolkitDir: string;
  initialTab: TabId;
}

const TAB_ORDER: TabId[] = ['catalog', 'installed', 'sources'];

const App: React.FC<AppProps> = ({ toolkitDir, initialTab }) => {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const { exit } = useApp();

  const {
    catalog,
    allItems,
    installedItems,
    refreshLock,
  } = useCatalog(toolkitDir);

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
    const { type, name, source } = item;
    try {
      if (source !== 'internal' && item.path && item.hash) {
        // External resource — reinstall from cache
        if (type === 'skill')      installExternalSkill(source, name, item.path, item.hash, { force: true }, () => {});
        else if (type === 'agent') installExternalAgent(source, name, item.path, item.hash, { force: true }, () => {});
        else if (type === 'mcp')   installExternalMcp(source, name, item.path, item.hash, { force: true }, () => {});
      } else {
        if (type === 'skill')      installSkill(catalog, toolkitDir, name, { force: true }, () => {});
        else if (type === 'agent') installAgent(catalog, toolkitDir, name, { force: true }, () => {});
        else if (type === 'mcp')   installMcp(catalog, toolkitDir, name, { force: true }, () => {});
      }
      refreshLock();
    } catch {}
  }, [catalog, toolkitDir, refreshLock]);

  const handleUpdateAll = useCallback(() => {
    updateAll(catalog, toolkitDir, { force: true }, () => {});
    refreshLock();
  }, [catalog, toolkitDir, refreshLock]);

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
          toolkitDir={toolkitDir}
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
          toolkitDir={toolkitDir}
          onRefresh={handleRefresh}
        />
      )}
    </Box>
  );
};

export async function renderApp(toolkitDir: string, initialTab: string = 'catalog') {
  const tab = TAB_ORDER.includes(initialTab as TabId) ? (initialTab as TabId) : 'catalog';
  const { waitUntilExit } = render(<App toolkitDir={toolkitDir} initialTab={tab} />);
  await waitUntilExit();
}
