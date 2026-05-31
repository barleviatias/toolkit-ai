import React from 'react';
import { Text, Box } from 'ink';
import { IS_DEV_BUILD, TOOLKIT_VERSION, TOOLKIT_BUILD_NUMBER } from '../core/platform.js';

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
      {'  '}toolkit-ai <Text dimColor>v{TOOLKIT_VERSION}</Text>
      {IS_DEV_BUILD && <Text color="yellow"> dev build{TOOLKIT_BUILD_NUMBER ? ` · ${TOOLKIT_BUILD_NUMBER}` : ''}</Text>}
    </Text>
  </Box>
);
