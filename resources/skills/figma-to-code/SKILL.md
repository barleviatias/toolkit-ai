---
name: figma-to-code
description: 'Use when implementing UI from Figma designs, design handoff, converting mockups/prototypes to code, or translating visual layouts into pixel-perfect components'
---

# Figma to Code

Transform Figma designs into production-ready UI components. Discovers the project's design system, maps Figma specs to discovered tokens/components, reasons about state management and scalability, and generates well-structured code with proper separation of concerns and mock data for immediate rendering.

## Agent Compatibility

This skill works with both **VS Code Copilot** and **Claude Code**.

**Detect your environment:** If you have `vscode_askQuestions`, you are in Copilot. If you have `AskUserQuestion`, you are in Claude Code.

### Figma MCP Tools

| Action | Copilot | Claude Code |
|--------|---------|-------------|
| Screenshot | `mcp_figma_get_screenshot` | `mcp__claude_ai_Figma__get_screenshot` |
| Design context | `mcp_figma_get_design_context` | `mcp__claude_ai_Figma__get_design_context` |
| Metadata | `mcp_figma_get_metadata` | `mcp__claude_ai_Figma__get_metadata` |
| Variables | `mcp_figma_get_variable_defs` | `mcp__claude_ai_Figma__get_variable_defs` |
| Code Connect map | `mcp_figma_get_code_connect_map` | `mcp__claude_ai_Figma__get_code_connect_map` |

### Asking the User Questions

| Agent | Tool | Notes |
|-------|------|-------|
| Copilot | `vscode_askQuestions` | Batch up to 4 questions per call with header, options, freeform input |
| Claude Code | `AskUserQuestion` | Batch up to 4 questions per call with header, options (2-4), multiSelect flag |

### Browser Automation (Phase 4)

| Action | Copilot (Playwright) | Claude Code (Chrome DevTools) |
|--------|---------------------|-------------------------------|
| Navigate | `mcp_playwright_browser_navigate` | `mcp__chrome-devtools__navigate_page` |
| Screenshot | `mcp_playwright_browser_take_screenshot` | `mcp__chrome-devtools__take_screenshot` |
| Click | `mcp_playwright_browser_click` | `mcp__chrome-devtools__click` |
| Fill input | `mcp_playwright_browser_fill_form` | `mcp__chrome-devtools__fill_form` |
| Wait | `mcp_playwright_browser_wait_for` | `mcp__chrome-devtools__wait_for` |
| DOM snapshot | `mcp_playwright_browser_snapshot` | `mcp__chrome-devtools__take_snapshot` |
| Resize | `mcp_playwright_browser_resize` | `mcp__chrome-devtools__resize_page` |
| Close | `mcp_playwright_browser_close` | `mcp__chrome-devtools__close_page` |

## Prerequisites

- **Figma MCP** — required for design extraction
- **Browser MCP** (optional, Phase 4) — for visual verification

If Figma MCP is unavailable, ask the user to provide design specs manually (screenshots, color values, spacing, typography).

## Critical Rules

> **HUMAN IN THE LOOP — NON-NEGOTIABLE**
> Every decision that is not 100% clear from the design or codebase MUST be asked to the user. NEVER assume, guess, or pick a default silently. This includes: data source, route paths, component reuse vs build-new, naming, chart library, state management approach, file structure, and scalability trade-offs.
> Do NOT embed unanswered questions in plan text — resolve them interactively first.

> **ITERATIVE AGREEMENT — KEEP ASKING**
> Do NOT present a plan after a single round of questions. After each round of answers, evaluate whether you have full clarity. If new ambiguities surface from the answers, ask again. Repeat until YOU are confident the plan is complete and unambiguous. Only then present the plan for approval. If the user rejects or modifies the plan, incorporate feedback and re-present — do not proceed until explicit approval.

1. **File extensions must match the project** — if `.js`, generate `.js`. If `.tsx`, generate `.tsx`. If unclear, ask.
2. **NEVER skip DS discovery** — always run Phase 0 (or load cached profile). No exceptions.
3. **Always use the ask tool for decisions** — never dump questions as markdown text. Batch up to 4 questions per call, each with a header, concrete options (with recommended default), and freeform input. Wait for answers. If more than 4 questions, make multiple calls.
4. **No hardcoded values** — every hex color, font size, and spacing value must map to a discovered token.
5. **Think about state and scale** — every component lives in a system. Before generating code, reason about where data comes from, how state is managed, what happens at scale, and how this fits the existing architecture.

## Workflow

### Phase 0: Context & Design System Discovery

**MANDATORY** — Before touching Figma, understand the codebase AND recall past decisions.

#### Step 1: Load Memory

Check these locations for past context (paths relative to skill directory):

- `/memories/repo/design-system-profile.md` — cached DS profile
- `/memories/repo/past-decisions.md` — decisions made in previous figma-to-code sessions
- `/memories/repo/component-registry.md` — components previously generated by this skill

If the DS profile exists and is recent, load it and skip DS discovery (Step 2). Still check past decisions — they inform state management and pattern choices.

If past decisions exist, review them. They contain:
- State management patterns chosen for this project (Redux vs Zustand vs Context vs hooks)
- Data fetching patterns (useFetch, SWR, RTK Query, manual)
- Naming conventions agreed upon
- Component composition patterns preferred by the user
- Any "never do X" or "always do Y" rules

#### Step 2: Discover Design System (if no cached profile)

| Search For | Indicates |
|------------|-----------|
| `styled-components`, `@emotion` in `package.json` | CSS-in-JS |
| `tailwind.config.*` | Tailwind CSS |
| `*.module.css`, `*.module.scss` | CSS/SCSS Modules |
| `sass`, `less` in `package.json` | Preprocessors |
| `vanilla-extract` in `package.json` | Vanilla Extract |

**Find tokens:** `**/tokens/**`, `**/theme/**`, `**/colors.*`, `**/typography.*`, `**/spacing.*`

**Inventory components:**
- Check `package.json` for UI libraries (`@mui/*`, `@chakra-ui/*`, `antd`, etc.)
- Search `**/components/**/*.{tsx,jsx}` for reusable components
- Use the Code Connect map tool if available
- Check `*.stories.*` for documented components

**Detect conventions:** Read project instructions (`copilot-instructions.md`, `CLAUDE.md`), `tsconfig.json` paths, webpack/vite aliases. Note path aliases, barrel vs direct imports, named vs default exports.

**Study existing code:** Find 2-3 well-written components and record how styles, tokens, structure, naming, and exports work. This is the most important step — patterns found here dictate code generation.

#### Step 3: Discover State Management Landscape

Before you can make good state decisions for new components, understand what the project already uses:

- **Search for state libraries**: Redux (`createStore`, `configureStore`, `useSelector`, `useDispatch`), Zustand (`create`, `useStore`), MobX, Recoil, Jotai, Context API (`createContext`, `useContext`)
- **Map the hierarchy**: What state lives where? Global store vs feature-level vs component-local?
- **Identify data fetching patterns**: `useFetch`, `useQuery`, `useSWR`, RTK Query, raw `useEffect` + fetch, service layer calls
- **Find existing hooks**: Custom hooks in `hooks/` or `Hooks/` directories — these are reuse candidates
- **Note the project's preference hierarchy**: (e.g., "hooks > Context > Zustand > Redux" if documented in CLAUDE.md)

Record findings in the DS profile under a `## State Management` section.

#### Step 4: Cache the Profile

Save ALL findings to `/memories/repo/design-system-profile.md`:

```markdown
# Design System Profile

## Styling Approach
[e.g., styled-components v5 with styled-theming for dark/light mode]

## Token System
### Colors
- Semantic tokens: [import path] — list available tokens
- Primitive colors: [import path]
### Typography
- Mixins: [import path] — available styles
### Borders / Spacing
- [import paths and tokens]

## State Management
- **Global state**: [Redux / Zustand / other — with store location]
- **Data fetching**: [useFetch / useQuery / service layer — with import paths]
- **Preference hierarchy**: [hooks > Context > Zustand > Redux, or whatever the project uses]
- **Available custom hooks**: [list relevant hooks with import paths]

## Style Pattern (from real component)
[Paste actual .style.ts showing correct token usage]

## Component Pattern (from real component)
[Paste actual component showing correct structure]

## Available DS Components
[List with import paths]

## Icons
[Import path pattern]

## Import Convention
[barrel vs direct, named vs default, path aliases]

## File Naming Convention
[.style.ts, .types.ts, .test.ts, etc.]

## Theme
[dark/light mechanism]
```

The cached profile must include **real code snippets** — not generic templates.

### Phase 1: Analyze the Design

1. **Get screenshot** — see what you're building
2. **Get design context** — extract layout, spacing, colors, typography, border radius, shadows, states, interactions

Map every extracted value to a discovered token.

While analyzing, start thinking about:
- What data does this component need? Static config or dynamic API data?
- How many items could this list/table/grid show? 10? 1000? Infinite scroll?
- Are there interactive states (selected, expanded, filtered, sorted)?
- Does this need to communicate with other components on the page?
- Is there a loading state? Error state? Empty state?

### Phase 2: Iterative Alignment — Keep Asking Until Agreed

**STOP. Do not write code yet. Do not present a plan yet.**

This phase is a conversation loop. You will ask questions, get answers, evaluate if you have full clarity, and ask more questions if needed. Only when everything is resolved do you build and present the plan.

#### Round 1: Core Architecture Questions

Start with the highest-impact decisions. These determine everything downstream:

**State & Data:**
- Where does the data come from? (mock only / existing API endpoint / new endpoint needed)
- Where should state live? (component-local / feature context / global store)
  - Consider the state hierarchy from the DS profile
  - If the component needs to share state with siblings, recommend Context or store
  - If it's self-contained, recommend local state
- How should data be fetched? (use project's existing hook/pattern — name it specifically)
- What happens at scale? (pagination / virtual scrolling / lazy loading)

**Component Identity:**
- Where does this component live? (new feature folder / extend existing feature / standalone)
- Which existing DS components can be reused? (list specific ones you found)
- What's the route path? (if it's a page-level component)

**Interaction & UX:**
- What are all the interactive states? (hover, selected, expanded, disabled, loading, error, empty)
- Are there filters, sorting, or search? Where does that state live?
- Does this connect to other components on the page? (shared filters, selection context, etc.)

Ask up to 4 questions per call. Wait for answers.

#### Round 2+: Follow-Up Based on Answers

After each round of answers, evaluate:

- Did any answer create new ambiguity? (e.g., user said "use existing API" — which endpoint? what's the response shape?)
- Did any answer conflict with the DS profile or project conventions? (e.g., user wants Redux but project prefers Zustand)
- Are there edge cases the user hasn't considered? (e.g., empty state, error handling, responsive behavior)
- Is the state management approach fully clear? (where state lives, how it flows, what triggers updates)

If YES to any of these, ask another round. Keep going until you can answer every question in the plan template below without guessing.

**Signs you're ready to present the plan:**
- You know exactly which files to create and what goes in each
- You know where every piece of state lives and how it flows
- You know which existing components/hooks/utils to reuse
- You know what the mock data shape looks like
- You have zero open questions

#### Present the Plan

Only when fully aligned, present a structured plan for approval:

| Section | Purpose |
|---------|---------|
| **DS Components to Reuse** | Table: Figma element -> DS component -> import path |
| **Token Mappings** | Table: Figma value -> semantic token -> import |
| **State Management** | Where state lives, data flow, fetching approach, scale strategy |
| **Missing (Needs Creation)** | Table: element -> why missing -> proposed approach |
| **Decisions Made** | Summary of all user answers from questioning rounds |
| **File Structure** | Every file to create with its responsibility |

**State Management section must answer:**
- What state does this feature own?
- Where does it live? (local / context / store)
- How is data fetched? (which hook/service)
- What triggers re-renders?
- How does it scale? (pagination, virtualization, debouncing)
- What are the loading/error/empty states?

**File separation rules:**

| File | Contains | Rules |
|------|----------|-------|
| `ComponentName.tsx` | Pure UI rendering, props, event wiring | NO API calls, NO data transforms, NO business logic |
| `ComponentName.styled.ts` | All style definitions | Only styling code |
| `ComponentName.types.ts` | Props interface, internal types, enums | Shared across feature files |
| `ComponentName.utils.ts` | Data transformations, formatters | Pure functions, no side effects |
| `ComponentName.mock.ts` | Mock data for dev and testing | Matches types, covers edge cases |
| `ComponentName.constants.ts` | Static config, magic strings | Only if needed |
| `ComponentName.hooks.ts` | Custom hooks for this feature | Data fetching, state logic, side effects |
| `context/FeatureContext.tsx` | Feature-level shared state | Only if multiple components share state |

Adapt file extensions and naming to project conventions.

**Feature folder structure:**

```
FeatureName/
  FeatureName.tsx              -- Main component, layout orchestration
  FeatureName.styled.ts        -- All styled-components for the feature
  FeatureName.types.ts         -- All shared types/interfaces
  FeatureName.mock.ts          -- Mock data (happy path + edge cases)
  FeatureName.utils.ts         -- Data transformations (if needed)
  FeatureName.hooks.ts         -- Custom hooks (if needed)
  FeatureName.constants.ts     -- Static config (if needed)
  context/                     -- Feature context (if shared state needed)
    FeatureContext.tsx
  components/                  -- Sub-components (flat, no nested folders)
    SubComponentA.tsx
    SubComponentB.tsx
```

**Gate: Do not proceed to Phase 3 until user explicitly approves the plan. If they have feedback, incorporate it, re-present, and ask again.**

### Phase 3: Generate Code with Mock Data

See [implementation reference](./references/phase3-implementation.md) for the generation procedure.

Key principles:

- **Load the cached profile** — use real code patterns as your template
- Types first -> mock data -> styles -> hooks -> component
- Mock data must include happy path + edge cases (empty, overflow, single item)
- Styles must follow the exact token usage pattern from Phase 0
- Component is pure UI — receives data via props
- State management code goes in hooks or context, never in component files
- Data fetching uses the project's existing patterns (e.g., useFetch, not raw useEffect)

### Phase 4: Visual Verification (Optional)

Requires Browser MCP and a running dev server. See [verification reference](./references/phase4-verification.md) for the full procedure.

Summary:

1. Ask user for app URL, credentials, and target route (read `.env` for hints)
2. Navigate and authenticate if needed
3. Resize viewport to match Figma frame dimensions
4. Capture implementation screenshot + Figma screenshot
5. Present structured comparison report with actionable fix suggestions referencing DS tokens

### Phase 5: Save Decisions to Memory

After implementation is complete, update memory files:

**`/memories/repo/past-decisions.md`** — append decisions made in this session:
```markdown
## [Feature Name] — [Date]
- State management: [what was chosen and why]
- Data fetching: [pattern used]
- Key reuse decisions: [which DS components, hooks, utils were reused]
- User preferences expressed: [any "do this" / "don't do that" feedback]
```

**`/memories/repo/component-registry.md`** — register the new component:
```markdown
## [ComponentName]
- Path: [file path]
- Purpose: [one line]
- State: [local / context / store]
- Reuses: [list of DS components and hooks used]
```

This memory feeds into Phase 0 of future sessions, creating a virtuous cycle.

## Anti-Patterns

| Avoid | Do Instead |
|-------|------------|
| Jumping straight to code after Figma | Question loop -> plan -> approval -> then implement |
| Asking once and assuming alignment | Keep asking until zero ambiguity remains |
| Hardcoded hex/rgb colors | Map to semantic tokens |
| Hardcoded px font sizes | Use typography scale tokens |
| Recreating existing components | Search codebase first, extend if needed |
| Business logic in component files | Extract to utils, hooks, or service layer |
| Components that fetch their own data | Pass data via props, fetch in parent/hook |
| `useEffect` for data fetching | Use project's data fetching hooks (useFetch, etc.) |
| State management without reasoning | Explicitly decide where state lives and why |
| Ignoring scale (rendering 1000 items) | Ask about data volume, add virtualization/pagination |
| No mock data | Always create `.mock.ts` with realistic data |
| Mixing styles with logic | Separate `.styled.ts` file |
| Inline types in component file | Separate `.types.ts` file |
| Ignoring project import conventions | Discover and follow existing patterns |
| Forgetting to save decisions | Always update past-decisions.md after implementation |

## Completion Checklist

- [ ] Memory loaded (past decisions, component registry, DS profile)
- [ ] DS discovery done (or loaded from cached profile)
- [ ] Figma design context extracted
- [ ] State management approach decided with user (where state lives, data flow, scale)
- [ ] All ambiguities resolved via iterative questioning — zero open questions
- [ ] Implementation plan approved by user before coding
- [ ] All colors/typography/spacing mapped to semantic tokens
- [ ] Existing components and hooks reused where possible
- [ ] Project import conventions followed
- [ ] Files separated: component, styles, types, hooks, utils, mock
- [ ] Component is pure UI — no business logic
- [ ] Data fetching uses project patterns, not raw useEffect
- [ ] Mock data covers happy path + edge cases
- [ ] Supports project theming (if applicable)
- [ ] Visual verification run (if Browser MCP available)
- [ ] Decisions saved to memory for future sessions
