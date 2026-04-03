import React from 'react';
import { Text, Box } from 'ink';

export type TabId = 'catalog' | 'installed' | 'sources';

export interface Tab {
  id: TabId;
  label: string;
  badge?: number;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: TabId;
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeTab }) => (
  <Box gap={2} marginBottom={1}>
    {tabs.map(tab => {
      const isActive = tab.id === activeTab;
      const label = tab.badge != null && tab.badge > 0
        ? `${tab.label} (${tab.badge})`
        : tab.label;

      return (
        <Text
          key={tab.id}
          bold={isActive}
          inverse={isActive}
          color={isActive ? undefined : 'gray'}
        >
          {` ${label} `}
        </Text>
      );
    })}
  </Box>
);
