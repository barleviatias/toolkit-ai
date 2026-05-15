import React, { useCallback, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { StatusBar } from '../components/StatusBar.js';
import {
  DEFAULT_SETTINGS,
  formatDuration,
  loadSettings,
  updateSettings,
  type ToolkitSettings,
} from '../core/settings.js';
import {
  CACHE_DIR,
  CONFIG_FILE,
  HOME,
  SOURCES_FILE,
  detectToolInstallations,
  type ToolId,
  type ToolInstallation,
} from '../core/platform.js';

type SettingsRowId = 'installMode' | 'cacheTTL' | 'sourceConcurrency';

interface SettingsRow {
  id: SettingsRowId;
  label: string;
  value: string;
  detail: string;
}

const CACHE_TTL_OPTIONS = [
  0,
  15 * 60,
  60 * 60,
  6 * 60 * 60,
  24 * 60 * 60,
  3 * 24 * 60 * 60,
  7 * 24 * 60 * 60,
  30 * 24 * 60 * 60,
];

const CONCURRENCY_OPTIONS = [1, 2, 4, 6, 8];

function compactPath(filePath: string): string {
  return filePath.startsWith(HOME) ? `~${filePath.slice(HOME.length)}` : filePath;
}

function cycleNumber(options: number[], current: number, direction: 1 | -1): number {
  const exact = options.indexOf(current);
  const nearest = exact >= 0
    ? exact
    : options.reduce((best, value, index) =>
      Math.abs(value - current) < Math.abs(options[best] - current) ? index : best
    , 0);
  return options[(nearest + direction + options.length) % options.length];
}

function capabilities(tool: ToolInstallation): string {
  return [
    tool.supportsSkills ? 'skills' : null,
    tool.supportsAgents ? 'agents' : null,
    tool.supportsMcps ? 'MCPs' : null,
    tool.supportsCommands ? 'commands' : null,
  ].filter((value): value is string => value !== null).join(', ');
}

interface SettingsTabProps {
  /**
   * Notify the parent that provider opt-outs (or any setting that affects
   * which targets a primitive can install to) just changed. The parent uses
   * this to invalidate downstream memos: the catalog's per-item targetLabels
   * read disabledToolIds, and the header's detected-targets chip set has its
   * own memo. Without this signal both stay stale and the user sees a still-
   * disabled provider listed under "will install".
   */
  onProvidersChanged?: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({ onProvidersChanged }) => {
  const [settings, setSettings] = useState<ToolkitSettings>(() => loadSettings());
  const [targets, setTargets] = useState<ToolInstallation[]>(() => detectToolInstallations());
  const [cursor, setCursor] = useState(0);
  const [message, setMessage] = useState('');

  const rows = useMemo<SettingsRow[]>(() => [
    {
      id: 'installMode',
      label: 'Install mode',
      value: settings.installMode === 'link' ? 'symlink' : 'copy',
      detail: settings.installMode === 'link' ? 'live links into source cache' : 'stable file copies',
    },
    {
      id: 'cacheTTL',
      label: 'Cache duration',
      value: formatDuration(settings.cacheTTL),
      detail: settings.cacheTTL === 0 ? 'fetch sources every launch' : 'stale sources fetch again after this age',
    },
    {
      id: 'sourceConcurrency',
      label: 'Parallel fetches',
      value: String(settings.sourceConcurrency),
      detail: 'source refresh workers',
    },
  ], [settings]);

  const installedTargets = useMemo(() => targets.filter(target => target.installed), [targets]);
  const disabledSet = useMemo(() => new Set(settings.disabledTools), [settings.disabledTools]);
  // Cursor walks settings rows first, then provider rows. Index range:
  //   [0, rows.length)                                  → settings rows
  //   [rows.length, rows.length + targets.length)       → provider rows
  const totalSelectable = rows.length + targets.length;
  const providerIndex = cursor - rows.length;
  const activeProvider: ToolInstallation | null = providerIndex >= 0 ? targets[providerIndex] ?? null : null;

  const toggleProvider = useCallback((tool: ToolInstallation) => {
    const current = new Set(settings.disabledTools);
    if (current.has(tool.id)) current.delete(tool.id); else current.add(tool.id);
    const next = updateSettings({ disabledTools: Array.from(current).sort() as ToolId[] });
    setSettings(next);
    const state = next.disabledTools.includes(tool.id) ? 'disabled' : 'enabled';
    setMessage(`${tool.label} is now ${state}`);
    onProvidersChanged?.();
  }, [settings.disabledTools, onProvidersChanged]);

  const persist = useCallback((patch: Partial<ToolkitSettings>, nextMessage: string) => {
    const next = updateSettings(patch);
    setSettings(next);
    setMessage(nextMessage);
  }, []);

  const updateActiveRow = useCallback((direction: 1 | -1 = 1) => {
    const row = rows[cursor];
    if (!row) return;

    if (row.id === 'installMode') {
      const nextMode = settings.installMode === 'link' ? 'copy' : 'link';
      persist({ installMode: nextMode }, `Install mode set to ${nextMode === 'link' ? 'symlink' : 'copy'}`);
      return;
    }

    if (row.id === 'cacheTTL') {
      const nextTTL = cycleNumber(CACHE_TTL_OPTIONS, settings.cacheTTL, direction);
      persist({ cacheTTL: nextTTL }, `Cache duration set to ${formatDuration(nextTTL)}`);
      return;
    }

    const nextConcurrency = cycleNumber(CONCURRENCY_OPTIONS, settings.sourceConcurrency, direction);
    persist({ sourceConcurrency: nextConcurrency }, `Parallel fetches set to ${nextConcurrency}`);
  }, [cursor, persist, rows, settings]);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor(current => Math.max(0, current - 1));
    } else if (key.downArrow) {
      setCursor(current => Math.min(totalSelectable - 1, current + 1));
    } else if (key.return || input === ' ') {
      if (activeProvider) toggleProvider(activeProvider);
      else updateActiveRow(1);
    } else if (input === '+' || input === '=') {
      if (activeProvider) toggleProvider(activeProvider);
      else updateActiveRow(1);
    } else if (input === '-') {
      if (activeProvider) toggleProvider(activeProvider);
      else updateActiveRow(-1);
    } else if (input === 'l') {
      const nextMode = settings.installMode === 'link' ? 'copy' : 'link';
      persist({ installMode: nextMode }, `Install mode set to ${nextMode === 'link' ? 'symlink' : 'copy'}`);
    } else if (input === 'c') {
      const nextTTL = cycleNumber(CACHE_TTL_OPTIONS, settings.cacheTTL, 1);
      persist({ cacheTTL: nextTTL }, `Cache duration set to ${formatDuration(nextTTL)}`);
    } else if (input === 'p') {
      const nextConcurrency = cycleNumber(CONCURRENCY_OPTIONS, settings.sourceConcurrency, 1);
      persist({ sourceConcurrency: nextConcurrency }, `Parallel fetches set to ${nextConcurrency}`);
    } else if (input === 'd') {
      const next = updateSettings(DEFAULT_SETTINGS);
      setSettings(next);
      setMessage('Settings reset to defaults');
    } else if (input === 'r') {
      setTargets(detectToolInstallations());
      setMessage('Target providers re-detected');
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>Settings</Text>
        <Text dimColor>  ·  saved in {compactPath(CONFIG_FILE)}</Text>
      </Box>

      <Box flexDirection="column" marginY={1}>
        {rows.map((row, index) => (
          <Box key={row.id} marginLeft={1}>
            <Text color={index === cursor ? 'cyan' : undefined}>{index === cursor ? '❯ ' : '  '}</Text>
            <Text bold={index === cursor}>{row.label.padEnd(18)}</Text>
            <Text color="cyan">{row.value.padEnd(9)}</Text>
            <Text dimColor> · {row.detail}</Text>
          </Box>
        ))}
      </Box>

      <Box flexDirection="column">
        <Text bold>Providers ({installedTargets.length - settings.disabledTools.filter(id => installedTargets.some(t => t.id === id)).length}/{installedTargets.length} active)</Text>
        {targets.map((target, index) => {
          const rowIndex = rows.length + index;
          const isActive = cursor === rowIndex;
          const isDisabledByUser = disabledSet.has(target.id);
          const dot = isDisabledByUser ? '○ ' : target.installed ? '● ' : '○ ';
          const dotColor = isDisabledByUser ? 'yellow' : target.installed ? 'green' : 'gray';
          return (
            <Box key={target.id} marginLeft={1}>
              <Text color={isActive ? 'cyan' : undefined}>{isActive ? '❯ ' : '  '}</Text>
              <Text color={dotColor}>{dot}</Text>
              <Text bold={isActive || (target.installed && !isDisabledByUser)}>{target.label.padEnd(18)}</Text>
              <Text dimColor>{capabilities(target)}</Text>
              {!target.installed && <Text dimColor> · not detected</Text>}
              {target.installed && isDisabledByUser && <Text color="yellow"> · disabled</Text>}
            </Box>
          );
        })}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Paths</Text>
        <Text dimColor>  Sources {compactPath(SOURCES_FILE)}</Text>
        <Text dimColor>  Cache   {compactPath(CACHE_DIR)}</Text>
      </Box>

      {message && (
        <Text color="green">  {message}</Text>
      )}

      <StatusBar hints="↑/↓ move · Enter/Space toggle · l link · c cache · p parallel · d defaults · r detect · Tab switch" />
    </Box>
  );
};
