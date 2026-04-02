# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

A toolkit CLI with a React Ink TUI for distributing skills, agents, MCP connections, and plugin bundles to AI dev tools (Claude Code, GitHub Copilot, Cursor). Supports both internal resources and external skill sources from GitHub/Bitbucket repos.

> **Important:** Keep [README.md](README.md) up to date with any changes to commands, setup, or usage.

## Git Rules

- **NEVER push directly to `main`.** All changes go through a feature branch + pull request.
- Create a descriptive branch name (e.g., `feat/scanner-improvements`, `fix/false-positives`).
- Push the branch and open a PR. CI runs on PRs; merging to `main` triggers npm publish.

## Quick Start

```bash
# Launch TUI (browse, install, remove, update — all in one place)
ai-toolkit

# Or run directly from repo
node bin/ai-toolkit.mjs

# Headless commands
node bin/ai-toolkit.mjs --list
node bin/ai-toolkit.mjs --skill brainstorming
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
  app.tsx                # Root Ink app with tabbed layout
  types.ts               # Shared TypeScript interfaces
  core/
    platform.ts          # OS paths, targets, npx detection
    fs-helpers.ts        # Symlink/copy/remove operations
    catalog.ts           # Catalog generation, frontmatter parser, lookups
    lock.ts              # Lock file CRUD (~/.toolkit/lock.json)
    installer.ts         # Install for skill/agent/mcp/plugin + external skills
    remover.ts           # Remove with protection logic
    updater.ts           # Update detection + bulk update
    sources.ts           # External source fetch, cache, scan (GitHub/Bitbucket)
  components/            # React Ink UI components (Logo, TabBar, SearchInput, ItemList, etc.)
  tabs/                  # Tab views (Browse, Plugins, Installed, Sources, Updates)
  commands/
    headless.ts          # All --flag commands (backward compat)
```

### Resources

```
resources/
  skills/<name>/SKILL.md   # Skill with YAML frontmatter (name, description required)
  agents/<name>.agent.md   # Agent with YAML frontmatter
  mcps/<name>.json         # MCP config (transport, url, setupNote)
  plugins/<name>.json      # Plugin bundle referencing skills/agents/mcps by name
  sources.json             # Default external source repos
```

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
- **publish.yml** — builds and publishes to npm on merge to main

## Content Conventions

- All names are lowercase-hyphenated (e.g., `test-driven-development`)
- Skills require `name` and `description` in YAML frontmatter
- Plugins reference items by name — CI validates all references resolve

## Adding New Content

1. Create the content file in the appropriate `resources/` directory
2. If it belongs in a plugin, add the name to the plugin's JSON
3. Run `npm test` locally
4. Open a PR
