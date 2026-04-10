# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

A source-driven toolkit CLI with a React Ink TUI for managing AI skills, agents, and MCP connections across Claude Code, Codex, GitHub Copilot, and Cursor. All resources come from external GitHub/Bitbucket sources — no bundled content.

> **Important:** Keep [README.md](README.md) up to date with any changes to commands, setup, or usage.

## Quick Start

```bash
# Launch TUI (browse, install, remove, update — all in one place)
ai-toolkit

# Or run directly from repo
node bin/ai-toolkit.mjs

# Headless commands
node bin/ai-toolkit.mjs --list
node bin/ai-toolkit.mjs refresh
node bin/ai-toolkit.mjs --version
```

## Development

```bash
npm install              # install deps
npm run build            # build with tsup -> bin/ai-toolkit.mjs
npm run dev              # build with watch mode
npm test                 # typecheck + run 31 unit/integration tests
npm link                 # link globally for local testing
```

## Testing

Tests use Node.js built-in test runner (`node:test`). Test files live in `tests/*.test.mjs`, fixtures in `tests/fixtures/*.mjs`.

```bash
npm test                 # typecheck (tsc --noEmit) + compile + run all tests
```

The test runner (`tests/run.mjs`) compiles TypeScript to `.test-dist/`, then runs all `*.test.mjs` files. Fixtures import from the compiled build dir via `process.env.TEST_BUILD_DIR`.

**Adding tests:** Create a fixture in `tests/fixtures/` that outputs JSON to stdout, then add a test case in the appropriate `tests/*.test.mjs` that calls `runFixture()`.

**Current coverage (31 tests):** item-key, lock (read/write/protect/record), catalog (frontmatter/hash/find), fs-helpers (copy/link/remove), scanner (RCE/shells/size/IPs/URLs/format), codex config round-trip, install/recovery/removal, security paths.

## Architecture

### Build pipeline

TypeScript + React (Ink) -> tsup bundles everything into a single `bin/ai-toolkit.mjs` (ESM).
All runtime deps (ink, react) are bundled — consumers install zero dependencies.

- `tsup.config.ts` — build config (ESM, Node 20 target, shebang banner)
- `tsconfig.json` — TypeScript config (`strict: true`, ES2022, bundler resolution)
- `"prepare"` script auto-builds on `npm publish` and `npx` from git

### Source structure

```
src/
  index.tsx              # Entry point — routes to headless CLI or Ink TUI
  app.tsx                # Root Ink app with 3-tab layout (Catalog, Installed, Sources)
  types.ts               # Shared TypeScript interfaces
  core/
    platform.ts          # OS paths, targets, path validation, Codex TOML parsing
    fs-helpers.ts        # Symlink/copy/remove operations
    catalog.ts           # Frontmatter parser, hash helpers, catalog lookups
    lock.ts              # Lock file CRUD (~/.toolkit/lock.json)
    item-key.ts          # Structured key handling (makeKey/parseKey with :: delimiter)
    installer.ts         # Install for skill/agent/mcp/bundle + external resources
    remover.ts           # Remove with bundle protection logic
    updater.ts           # Update detection + bulk/selective update
    scanner.ts           # Security scanner for skills, agents, MCPs
    sources.ts           # External source fetch, cache, scan (GitHub/Bitbucket)
    installed-state.ts   # Filesystem discovery of installed items (lock recovery)
  components/
    TabBar.tsx           # Tab navigation header
    Logo.tsx             # ASCII art branding
    SearchInput.tsx      # Search box with count feedback
    ItemList.tsx         # Scrollable list with cursor, selection, action keys (i/r/u)
    ItemRow.tsx          # Single item display with type badge and metadata
    DetailView.tsx       # Modal detail view with install/remove/update actions
    TypeFilter.tsx       # Toggleable type filter chips (1-4 keys)
    ConfirmDialog.tsx    # Destructive action confirmation (y/n)
    StatusBar.tsx        # Footer with keyboard hints
  tabs/
    CatalogTab.tsx       # Unified browse + install + update
    InstalledTab.tsx     # Manage installed items with detail view and type filters
    SourcesTab.tsx       # Source management with per-source item browsing
  hooks/
    useCatalog.ts        # Central data hook — loads catalog + external resources + lock + scan cache
    useFilteredItems.ts  # Shared filter/search/count logic for item lists
  commands/
    headless.ts          # All --flag commands
    init.ts              # Scaffold a skill repo
```

### Resources

```
resources/
  sources.json             # Default external source repos (vercel-labs, anthropics)
  skills/                  # Empty — all content comes from sources
  agents/                  # Empty
  mcps/                    # Empty
  bundles/                 # Empty
```

### External source discovery

Sources are GitHub/Bitbucket repos. The toolkit discovers resources by convention:

- **Skills**: Any directory containing `SKILL.md` (recursive, stops at skill boundary)
- **Agents**: Any `*.agent.md` file (recursive)
- **MCPs**: Any `*.json` in `mcps/` directories, or `*.mcp.json` anywhere
- **Bundles**: Any `*.json` in `bundles/` directories, or `*.bundle.json` anywhere

### User state (~/.toolkit/)

```
~/.toolkit/
  lock.json              # Tracks installed items with content hashes
  sources.json           # User's custom sources (overrides bundled defaults)
  cache/                 # Shallow-cloned repos from external sources
```

### Install targets

- Skills: `~/.claude/skills/`, `~/.copilot/skills/`, `~/.agents/skills/`
- Agents: `~/.claude/agents/`, `~/.copilot/agents/`, generated Codex agents in `~/.codex/agents/*.toml`
- MCPs: `~/.claude/settings.json`, `~/.vscode/mcp.json`, `~/.cursor/mcp.json`, `~/.claude.json`, `~/.codex/config.toml`

### CI (GitHub Actions)

- **ci.yml** — runs on PRs: typecheck + tests on Node 20 and 22
- **publish.yml** — runs on push to main: tests + npm publish (skips if version already published)

## Content Conventions

- All names are lowercase-hyphenated (e.g., `test-driven-development`)
- Skills require `name` and `description` in YAML frontmatter
- Agents use `*.agent.md` naming with YAML frontmatter
- MCPs are JSON manifests that can describe either URL-based or command-based servers

## Code Quality Standards

- TypeScript `strict: true` — no `any` types, all errors caught as `unknown`
- All public core functions have JSDoc
- All catch blocks have type guards (`e instanceof Error`) or documented intent
- Security scanning runs with cached results (keyed by `type:source:hash`)
- Zero runtime dependencies — everything is bundled
