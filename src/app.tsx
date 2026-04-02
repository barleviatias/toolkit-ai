import React, { useState, useCallback } from 'react';
import { render, Box, useInput, useApp } from 'ink';
import { TabBar, type TabId, type Tab } from './components/TabBar.js';
import { Logo } from './components/Logo.js';
import { useCatalog } from './hooks/useCatalog.js';
import { BrowseTab } from './tabs/BrowseTab.js';
import { InstalledTab } from './tabs/InstalledTab.js';
import { PluginsTab } from './tabs/PluginsTab.js';
import { UpdatesTab } from './tabs/UpdatesTab.js';
import { SourcesTab } from './tabs/SourcesTab.js';

interface AppProps {
  toolkitDir: string;
  initialTab: TabId;
}

const TAB_ORDER: TabId[] = ['browse', 'plugins', 'installed', 'sources', 'updates'];

const App: React.FC<AppProps> = ({ toolkitDir, initialTab }) => {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const { exit } = useApp();

  const {
    catalog,
    lock,
    allItems,
    installedItems,
    updateItems,
    refreshLock,
  } = useCatalog(toolkitDir);

  const tabs: Tab[] = [
    { id: 'browse', label: 'Browse', badge: allItems.length },
    { id: 'plugins', label: 'Plugins', badge: catalog.plugins.length },
    { id: 'installed', label: 'Installed', badge: installedItems.length },
    { id: 'sources', label: 'Sources' },
    { id: 'updates', label: 'Updates', badge: updateItems.length },
  ];

  const handleRefresh = useCallback(() => {
    refreshLock();
  }, [refreshLock]);

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

      {activeTab === 'browse' && (
        <BrowseTab
          items={allItems}
          catalog={catalog}
          toolkitDir={toolkitDir}
          onRefresh={handleRefresh}
        />
      )}
      {activeTab === 'plugins' && (
        <PluginsTab
          catalog={catalog}
          lock={lock}
          toolkitDir={toolkitDir}
          onRefresh={handleRefresh}
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
        <SourcesTab onRefresh={handleRefresh} />
      )}
      {activeTab === 'updates' && (
        <UpdatesTab
          items={updateItems}
          catalog={catalog}
          toolkitDir={toolkitDir}
          onRefresh={handleRefresh}
        />
      )}
    </Box>
  );
};

export async function renderApp(toolkitDir: string, initialTab: string = 'browse') {
  const tab = TAB_ORDER.includes(initialTab as TabId) ? (initialTab as TabId) : 'browse';
  const { waitUntilExit } = render(<App toolkitDir={toolkitDir} initialTab={tab} />);
  await waitUntilExit();
}
