# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

A source-driven toolkit CLI with a React Ink TUI for managing AI skills, agents, and MCP connections across Claude Code, GitHub Copilot, and Cursor. All resources come from external GitHub/Bitbucket sources — no bundled content.

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
npm test                 # lint skills + validate catalog
npm link                 # link globally for local testing
```

## Architecture

### Build pipeline

TypeScript + React (Ink) -> tsup bundles everything into a single `bin/ai-toolkit.mjs` (ESM).
All runtime deps (ink, react) are bundled — consumers install zero dependencies.

- `tsup.config.ts` — build config
- `tsconfig.json` — TypeScript config
- `"prepare"` script auto-builds on `npm publish` and `npx` from git

### Source structure

```
src/
  index.tsx              # Entry point — routes to headless CLI or Ink TUI
  app.tsx                # Root Ink app with 3-tab layout (Catalog, Installed, Sources)
  types.ts               # Shared TypeScript interfaces
  core/
    platform.ts          # OS paths, targets, npx detection
    fs-helpers.ts        # Symlink/copy/remove operations
    catalog.ts           # Catalog generation, frontmatter parser, lookups
    lock.ts              # Lock file CRUD (~/.toolkit/lock.json)
    item-key.ts          # Structured key handling (makeKey/parseKey with :: delimiter)
    installer.ts         # Install for skill/agent/mcp/bundle + external resources
    remover.ts           # Remove with protection logic
    updater.ts           # Update detection + bulk/selective update
    scanner.ts           # Security scanner for skills, agents, MCPs
    sources.ts           # External source fetch, cache, scan (GitHub/Bitbucket)
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
    CatalogTab.tsx       # Unified browse + install + update (replaces old Browse/Plugins/Updates)
    InstalledTab.tsx     # Manage installed items with detail view and type filters
    SourcesTab.tsx       # Source management with per-source item browsing
  hooks/
    useCatalog.ts        # Central data hook — loads catalog + external resources + lock
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

- Skills: `~/.claude/skills/`, `~/.copilot/skills/`, `~/.agent/skills/`
- Agents: `~/.claude/agents/`, `~/.copilot/agents/`, `~/.agent/agents/`
- MCPs: `~/.claude/settings.json`, `~/.vscode/mcp.json`, `~/.cursor/mcp.json`, `~/.claude.json`

### CI checks (GitHub Actions)

- **lint-skills.yml** — validates YAML frontmatter in all SKILL.md files
- **validate-catalog.yml** — validates catalog schema and cross-references
- **publish.yml** — builds and publishes to GitHub Packages on merge to main

## Content Conventions

- All names are lowercase-hyphenated (e.g., `test-driven-development`)
- Skills require `name` and `description` in YAML frontmatter
- Agents use `*.agent.md` naming with YAML frontmatter
- MCPs are JSON with `name`, `description`, `type`, `url` fields
