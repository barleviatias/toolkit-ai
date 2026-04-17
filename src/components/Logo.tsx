import React from 'react';
import { Text, Box } from 'ink';

const RED    = '#d42027';
const GREEN  = '#00a651';
const YELLOW = '#f7941d';
const GRAY_L = '#b3b3b3';
const GRAY_D = '#808080';

const LOGO_LINES = [
  '████████╗ ██████╗  ██████╗ ██╗     ██╗  ██╗██╗████████╗',
  '╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██║ ██╔╝██║╚══██╔══╝',
  '   ██║   ██║   ██║██║   ██║██║     █████╔╝ ██║   ██║   ',
  '   ██║   ██║   ██║██║   ██║██║     ██╔═██╗ ██║   ██║   ',
  '   ██║   ╚██████╔╝╚██████╔╝███████╗██║  ██╗██║   ██║   ',
  '   ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝   ╚═╝   ',
];

const GRAYS = ['#bcbcbc', '#a8a8a8', '#8a8a8a', '#767676', '#585858', '#444444'];

const VERSION = process.env.TOOLKIT_VERSION || 'dev';

/**
 * In-flight debug marker bumped on every TUI fix attempt so the user can
 * confirm they're running the latest build at a glance. Remove before
 * bumping the real npm version and shipping.
 */
const BUILD_TAG = 'tui-fix-8';

export const Logo: React.FC = () => (
  <Box flexDirection="column" alignItems="center" marginBottom={1}>
    <Box>

      <Box flexDirection="column">
        {LOGO_LINES.map((line, i) => (
          <Text key={i} color={GRAYS[i]}>{line}</Text>
        ))}
      </Box>
    </Box>
    <Text bold color={GRAY_D}>
      {'  '}toolkit-ai <Text dimColor>v{VERSION}</Text>
      {BUILD_TAG && <Text color="yellow"> · {BUILD_TAG}</Text>}
    </Text>
  </Box>
);
