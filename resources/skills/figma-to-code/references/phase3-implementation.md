# Phase 3: Generate Code from Discovered Patterns

## Before You Start

**Load the cached profile** from `/memories/repo/design-system-profile.md`. This file contains real code patterns discovered from the project in Phase 0. Use those patterns — not generic templates.

**Load past decisions** from `/memories/repo/past-decisions.md`. Check if similar components were built before — reuse the same state management and data fetching patterns for consistency.

If no cached profile exists, **stop and run Phase 0 first**.

## Order of Creation

1. Types -> 2. Mock data -> 3. Styles -> 4. Hooks (if needed) -> 5. Context (if needed) -> 6. Component -> 7. Utils (if needed)

## 1. Types File

Define the data shape first. Use the project's type conventions (interfaces vs types, naming patterns) as found in the cached profile.

- Export all types as named exports
- Props interface should be named `{ComponentName}Props`
- Keep types minimal — only what the component needs
- Include types for all states: loading, error, empty, populated
- If data comes from an API, type the response shape separately from the UI props

## 2. Mock Data File

Create realistic data covering edge cases:

- **Happy path** — typical data the component will display
- **Overflow** — long text that might break layout
- **Empty state** — empty arrays, null/undefined values
- **Single item** — minimum data to render
- **Loading state** — if the component has a loading skeleton
- **Error state** — if the component shows error UI

Mock data must match the types exactly. Export as named constants. Each mock variant should be individually importable (e.g., `mockDataHappy`, `mockDataEmpty`, `mockDataOverflow`).

## 3. Styles File

**Follow the exact style pattern from the cached profile.** This means:

- Use the same token import paths discovered in Phase 0
- Use the same technique for consuming tokens (e.g., `styled-theming` functions, CSS variables, Tailwind classes)
- Use the same typography application method (e.g., css mixins, utility classes, theme props)
- Match the file naming convention (`.styled.ts` vs `.style.ts`)

**Rules:**

- Every color value must come from a semantic token
- Every font style must come from a typography token/mixin
- Every border/divider color must come from a token
- If a Figma value has no matching token, flag it — do not hardcode
- Spacing and border-radius: use tokens if the project has them, otherwise use the same px values found in existing components

## 4. Hooks File (if needed)

Create custom hooks when the plan calls for feature-level logic:

- **Data fetching hook** — wraps the project's existing fetching pattern (e.g., `useFetch`, `useQuery`). Never use raw `useEffect` for data fetching if the project has a fetching hook.
- **State management hook** — encapsulates filter/sort/selection state if the component is interactive
- **Derived data hook** — computes transformed data from raw API responses

Rules:
- Hooks are the bridge between data and UI — they own side effects and state logic
- The component file should call hooks and pass results to styled components
- Keep hooks focused — one responsibility per hook
- Reuse existing project hooks before creating new ones (check the DS profile's "Available custom hooks" list)

## 5. Context File (if needed)

Create a feature context only when the plan specifies shared state across multiple sub-components:

- Provide sensible defaults
- Export both the Provider and a `useFeatureContext` hook
- Keep the context shape minimal — only what sub-components actually need to share
- Do NOT use context for state that only one component reads

## 6. Component File

Pure rendering only:

- NO API calls — data comes from hooks or props
- NO data transforms or business logic — use utils or hooks
- NO inline styles when the project uses a styling system
- Import directly from specific files — follow the import conventions from the cached profile
- Use named exports (not default exports, unless the project convention requires it)
- Wire up hooks at the top of the component, pass results down via props or styled component props
- Handle all UI states: loading, error, empty, populated

## 7. Utils File (if needed)

For data transformations, formatters, computed values:

- Pure functions only, no side effects
- Import types from the types file
- Keep transformations separate from rendering logic
- These should be independently testable
