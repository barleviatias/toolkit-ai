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
  ].filter((value): value is string => value !== null).join(', ');
}

export const SettingsTab: React.FC = () => {
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
      setCursor(current => Math.min(rows.length - 1, current + 1));
    } else if (key.return || input === ' ') {
      updateActiveRow(1);
    } else if (input === '+' || input === '=') {
      updateActiveRow(1);
    } else if (input === '-') {
      updateActiveRow(-1);
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
        <Text bold>Providers ({installedTargets.length}/{targets.length})</Text>
        {targets.map(target => (
          <Box key={target.id} marginLeft={1}>
            <Text color={target.installed ? 'green' : 'gray'}>{target.installed ? '● ' : '○ '}</Text>
            <Text bold={target.installed}>{target.label.padEnd(18)}</Text>
            <Text dimColor>{capabilities(target)}</Text>
            {!target.installed && <Text dimColor> · not detected</Text>}
          </Box>
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Paths</Text>
        <Text dimColor>  Sources {compactPath(SOURCES_FILE)}</Text>
        <Text dimColor>  Cache   {compactPath(CACHE_DIR)}</Text>
      </Box>

      {message && (
        <Text color="green">  {message}</Text>
      )}

      <StatusBar hints="Enter cycle · +/- adjust · l link · c cache · p parallel · d defaults · r detect · Tab switch" />
    </Box>
  );
};
