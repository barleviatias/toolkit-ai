# Design System Profile

## Styling Approach
styled-components v5 with styled-theming for light/dark mode switching.

## Token System

### Colors — Styled Tokens (themed, auto light/dark)
- Import path: `design-system/tokens/styledTokens`
- Exports: `textPrimary`, `textSecondary`, `textDisabled`, `textNegative`, `textWarning`, `textPositive`, `textEnhance`, `textOnAction`, `backgroundCard`, `backgroundScreen`, `backgroundNegative`, `backgroundWarning`, `backgroundPositive`, `backgroundInfo`, `backgroundNatural`, `borderDivider`, `rowDefault`, `rowHover`, `rowSelected`, `iconDefault`, `iconHover`, `buttonPrimaryBgDefault`, `chipInputDefault`, etc.

### Colors — Primitives (direct shade access)
- Import: `import { grayscale } from 'design-system/tokens/primitives/grayscale'`
- Available: grayscale, primaryBlue, skyBlue, seaGreen, indigoDye, orangePeel, yellow, truePurple, magenta, crimson, indigo, cyan, deepOrange, pink, brown, redSalsa

### Colors — Semantic (raw light/dark objects)
- `design-system/tokens/semantic/lightMode` — exports `lightModeTokens` with `.background`, `.text`, `.icon`, `.badgeSeverity`, `.chartColors`, etc.
- `design-system/tokens/semantic/darkMode` — same structure for dark mode
- Badge severity: `.badgeSeverity.critical`, `.high`, `.medium`, `.low`, `.info` each with `.bg` and `.text`

### Colors — Legacy Theme
- `design-system/theme/theme` — older exports: `backgroundColor`, `cardBackground`, `textColor`, `borderColor`, `hoverTableRow`, `selectedTableRow`
- `design-system/colors/index` — `blackAndWhite`, `darkMode`, `lightBlue`, `indigoDye`, `primaryBlue`, `blueGray`

### Typography
- Global consts: `import { TITLE_CARD, BODY_DEFAULT, BODY_HIGHLIGHT, TITLE_SUBTITLE, TITLE_TABLE_COLUMN, BODY_CAPTION, BODY_CAPTION_HIGHLIGHT, BORDER_RADIUS } from 'design-system/global-consts'`
- New textStyle: `import { textStyle } from 'design-system/tokens/typography/tokens'` — css snippets like `textStyle.titleCard`, `textStyle.bodyDefault`, `textStyle.bodyTableCell`

### Borders / Spacing
- `BORDER_RADIUS = '8px'` from global-consts
- `borderDivider` from styledTokens

## Style Pattern (from existing components)

```ts
// example .style.ts pattern
import styled from 'styled-components';
import { textPrimary, backgroundCard, borderDivider } from 'design-system/tokens/styledTokens';
import { TITLE_CARD, BODY_DEFAULT, BORDER_RADIUS } from 'design-system/global-consts';

export const Wrapper = styled.div`
  background: ${backgroundCard};
  border-radius: ${BORDER_RADIUS};
  color: ${textPrimary};
`;

export const Title = styled.div`
  ${TITLE_CARD}
  color: ${textPrimary};
`;

export const Body = styled.div`
  ${BODY_DEFAULT}
  color: ${textPrimary};
`;
```

## Component Pattern (from existing features)

```tsx
// example Component.tsx
import React from 'react';
import * as Styled from './ComponentName.styled';

interface ComponentNameProps {
  data: SomeType;
}

export const ComponentName = ({ data }: ComponentNameProps) => {
  return (
    <Styled.Wrapper>
      <Styled.Title>{data.title}</Styled.Title>
      <Styled.Body>{data.content}</Styled.Body>
    </Styled.Wrapper>
  );
};
```

## Available DS Components
- `design-system/components/WidgetContainer` — card with title header + content
- `design-system/components/Badge` — numeric badge
- `design-system/components/Button` — primary/outline/text buttons
- `design-system/components/Table` — react-table based, with column visibility, filters, footer
- `design-system/components/Tabs` / `TabsBar` — tab switching
- `design-system/components/DualTabs` — two-option toggle tabs
- `design-system/components/Pagination` — various pagination styles
- `design-system/components/Skeleton` — loading skeletons for charts
- `design-system/components/Tooltip` — tooltips
- `design-system/charts/BarChart` — Chart.js bar chart with legends, stacked support, dark mode
- `design-system/charts/BarChart/BarChartWithLegends` — bar chart + legend toggles

## Icons
- SVG icons as React components, typically in `icons/` subfolder or from design-system
- Pattern: `import SomeIcon from './icons/SomeIcon'`

## Import Convention
- Path aliases: `design-system/...` resolves to design-system folder
- Feature styles: `import * as Styled from './ComponentName.styled'`
- Named exports for components, `export default` for charts
- No barrel imports for tokens

## File Naming Convention
- `.styled.ts` (newer pattern in features)
- `.style.ts` (also common)
- `.types.ts` for types
- `.mock.ts` for mock data
- `.test.tsx` for tests

## Theme
- styled-theming `theme('mode', { light: ..., dark: ... })`
- ThemeProvider wraps the app with `{ mode: 'light' | 'dark' }`
