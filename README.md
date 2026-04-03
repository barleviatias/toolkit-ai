
<div align="center">

```
████████╗ ██████╗  ██████╗ ██╗     ██╗  ██╗██╗████████╗
╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██║ ██╔╝██║╚══██╔══╝
   ██║   ██║   ██║██║   ██║██║     █████╔╝ ██║   ██║
   ██║   ██║   ██║██║   ██║██║     ██╔═██╗ ██║   ██║
   ██║   ╚██████╔╝╚██████╔╝███████╗██║  ██╗██║   ██║
   ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝   ╚═╝
```

**toolkit-ai**

Manage AI skills, agents, and MCPs across Claude Code, Copilot, and Cursor — from any GitHub or Bitbucket source.

[![npm](https://img.shields.io/npm/v/toolkit-ai)](https://www.npmjs.com/package/toolkit-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## Install

```bash
npx toolkit-ai            # run directly, no install
npm install -g toolkit-ai  # or install globally
toolkit                   # launch after global install
```

## What It Does

A source-driven CLI with an interactive TUI that lets you browse, install, and manage AI development resources from GitHub and Bitbucket repos — all in one place.

| Resource | What it is | Installs to |
|----------|-----------|-------------|
| **Skills** | Markdown instructions that teach AI agents new capabilities | `~/.claude/skills/` `~/.copilot/skills/` |
| **Agents** | Specialized agent definitions with tool access | `~/.claude/agents/` `~/.copilot/agents/` |
| **MCPs** | Model Context Protocol server connections | `settings.json` / `mcp.json` |

All resources come from configured external sources (GitHub/Bitbucket repos). No bundled content — you control what gets installed.

## TUI

Run `toolkit` with no arguments to launch the interactive interface:

```
toolkit
```

| Tab | What you do |
|-----|-------------|
| **Catalog** | Browse, search, filter, install, update all resources from all sources |
| **Installed** | View, inspect, and remove installed items |
| **Sources** | Add/remove repos, browse items per source, refresh caches |

### Keyboard shortcuts

**Global:** `Tab` switch tabs · `q` quit

**Catalog & Installed:**
| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate |
| `/` | Search |
| `1`-`4` | Filter by type (Skills / Agents / MCPs / Plugins) |
| `0` | Reset filter to All |
| `Space` | Toggle selection |
| `Enter` | Detail view (or submit if items selected) |
| `a` | Select / deselect all |
| `i` | Install current item |
| `r` | Remove current item (with confirmation) |
| `u` | Update current item |
| `U` | Update all |

**Sources:**
| Key | Action |
|-----|--------|
| `Enter` | Browse items from selected source |
| `a` | Add a new source |
| `d` | Delete selected source |
| `f` | Refresh all sources (re-fetch repos) |

## CLI

```bash
toolkit --list                     # List all available items
toolkit --skill <name>             # Install a skill
toolkit --agent <name>             # Install an agent
toolkit --mcp <name>               # Register an MCP server
toolkit remove --skill <name>      # Remove a skill
toolkit check                      # Check for updates
toolkit update                     # Update all installed items
toolkit refresh                    # Re-fetch all external sources
toolkit scan                       # Security scan all items
toolkit init [dir]                 # Scaffold a new skill repo
```

## External Sources

All content comes from external repos. Add any GitHub or Bitbucket repo as a source:

```bash
# In the TUI: Sources tab → press 'a'
# Or via CLI:
toolkit source add owner/repo
toolkit source add https://github.com/owner/repo
```

The toolkit discovers resources in source repos by convention:

| Resource | Discovered by |
|----------|--------------|
| **Skills** | Any directory containing a `SKILL.md` file (recursive) |
| **Agents** | Any `*.agent.md` file (recursive) |
| **MCPs** | Any `*.json` in a `mcps/` directory, or `*.mcp.json` anywhere |

Sources are shallow-cloned and cached for 24 hours at `~/.toolkit/cache/`. Press `f` in the Sources tab or run `toolkit refresh` to force a re-fetch.

### Default sources

The toolkit ships with two default sources:

```json
{
  "sources": [
    { "name": "vercel-labs", "type": "github", "repo": "vercel-labs/agent-skills" },
    { "name": "anthropics", "type": "github", "repo": "anthropics/skills" }
  ]
}
```

## Security Scanner

Every item is automatically scanned before installation.

```bash
# Via TUI: Sources tab, press 'a'
# Via CLI:
ai-toolkit source add owner/repo
ai-toolkit source add https://github.com/owner/repo
ai-toolkit source add https://bitbucket.org/owner/repo
ai-toolkit source add git@github.com:owner/repo.git
ai-toolkit source list
ai-toolkit source remove <name>
```

External repos are **shallow-cloned** (`--depth 1`) and cached locally. The cache refreshes automatically every 24 hours, or on demand from the TUI.

## How Storage Works

```
~/.toolkit/
  lock.json              # Tracks what's installed, content hashes, timestamps
  sources.json           # Your configured external sources (overrides defaults)
  cache/                 # Shallow-cloned repos from external sources
    vercel-labs/         #   └─ cached clone of vercel-labs/agent-skills
    anthropics/          #   └─ cached clone of anthropics/skills
```

**Installed items** are copied (not linked) to the target tool's config directory:

```
~/.claude/
  skills/brainstorming/SKILL.md       # Installed skill
  agents/code-reviewer.agent.md       # Installed agent
  settings.json                       # MCP servers registered here

~/.copilot/
  skills/brainstorming/SKILL.md       # Same skill, mirrored
  agents/code-reviewer.agent.md

~/.cursor/mcp.json                    # MCP servers registered here
~/.vscode/mcp.json                    # MCP servers registered here
```

The **lock file** (`lock.json`) tracks every installed item with a content hash so the toolkit can detect updates — if a skill changes upstream, `ai-toolkit check` will flag it.

## Create Your Own Skills

Scaffold a boilerplate repo to publish your own resources:

```bash
toolkit init my-skills
```

This creates a repo structure that the toolkit can discover:

```
my-skills/
  skills/
    example-skill/SKILL.md
  agents/
    example-agent.agent.md
  mcps/
    example-mcp.json
  README.md
```

Push to GitHub, then share:

```bash
toolkit source add your-org/my-skills
```

## Development

```bash
git clone https://github.com/barleviatias/toolkit-ai.git
cd toolkit-ai
npm install
npm run build    # Build → bin/ai-toolkit.mjs
npm run dev      # Build with watch
npm test         # Lint skills + validate catalog
npm link         # Link globally for testing
```

## Tech Stack

- **React Ink** — terminal UI framework
- **tsup** — bundles into a single zero-dependency executable
- **TypeScript** — full type safety

## License

MIT
