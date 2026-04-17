<div align="center">

```
████████╗ ██████╗  ██████╗ ██╗     ██╗  ██╗██╗████████╗
╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██║ ██╔╝██║╚══██╔══╝
   ██║   ██║   ██║██║   ██║██║     █████╔╝ ██║   ██║
   ██║   ██║   ██║██║   ██║██║     ██╔═██╗ ██║   ██║
   ██║   ╚██████╔╝╚██████╔╝███████╗██║  ██╗██║   ██║
   ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝   ╚═╝
```

# toolkit-ai

**A package manager for AI coding assistants — manage skills, agents, and MCP servers across Claude Code, Codex, GitHub Copilot, and Cursor from any GitHub repo.**

[![npm version](https://img.shields.io/npm/v/toolkit-ai.svg)](https://www.npmjs.com/package/toolkit-ai)
[![npm downloads](https://img.shields.io/npm/dm/toolkit-ai.svg)](https://www.npmjs.com/package/toolkit-ai)
[![GitHub stars](https://img.shields.io/github/stars/barleviatias/toolkit-ai.svg?style=social)](https://github.com/barleviatias/toolkit-ai)
[![CI](https://github.com/barleviatias/toolkit-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/barleviatias/toolkit-ai/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Install](#install) · [Quick Start](#quick-start) · [Resource Types](#resource-types) · [TUI](#interactive-tui) · [CLI](#cli-commands) · [Security](#security)

</div>

---

## Why toolkit-ai

If your team works across more than one AI coding assistant, you've hit this wall:

- Every tool keeps its own config (`~/.claude/`, `~/.cursor/`, `~/.codex/`, `~/.copilot/`)
- Skills, subagents, and MCP server configs live in different formats
- There's no shared catalog, no versioning, no security review step
- Shipping a skill to your team means a wiki page and a prayer

`toolkit-ai` treats your AI tooling like dependencies. Point it at GitHub repos, browse everything in one TUI, install across all four tools at once, and keep a lockfile with content hashes so you know when something changed.

```bash
npx toolkit-ai
```

### Features

- **One catalog, four tools** — skills, agents, and MCP servers installed into Claude Code, Codex, GitHub Copilot, and Cursor from a single command
- **Source-driven** — every resource comes from a GitHub or Bitbucket repo you control; no bundled content
- **Security scanner** — blocks curl-to-shell, reverse shells, invisible Unicode injection, SSRF, path traversal, and more before install
- **Interactive TUI** — React Ink browser, installer, and updater with search, filters, and multi-select
- **Content-hashed lockfile** — `toolkit check` shows exactly what's outdated; `toolkit update` applies changes
- **Zero runtime dependencies** — single bundled executable, runs on `npx` without a clone
- **TypeScript strict mode** — 31 unit + integration tests, typechecked on Node 20 + 22

---

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Resource Types](#resource-types)
  - [Skills](#skills) · [Agents](#agents) · [MCPs](#mcps) · [Bundles](#bundles)
- [Interactive TUI](#interactive-tui)
- [CLI Commands](#cli-commands)
- [External Sources](#external-sources)
- [Security](#security)
  - [What We Scan](#what-we-scan) · [Trust Model](#trust-model) · [Security Disclosure](#security-disclosure)
- [Create Your Own Resources](#create-your-own-resources)
- [How Storage Works](#how-storage-works)
- [Related Projects](#related-projects)
- [Development](#development)

---

## Quick Start

```bash
# 1. Launch the interactive browser
npx toolkit-ai

# 2. Or install something in one command
npx toolkit-ai source add vercel-labs/agent-skills
npx toolkit-ai skill brainstorming

# 3. Check what's installed and what needs updating
npx toolkit-ai list
npx toolkit-ai check
```

---

## Install

```bash
npx toolkit-ai            # run directly, no install
npm install -g toolkit-ai  # or install globally
toolkit                   # launch after global install
```

---

## Resource Types

The toolkit manages four types of resources that extend AI coding assistants.

### Skills

Markdown files that teach AI agents new capabilities, domain knowledge, or workflows. Each skill is a directory containing a `SKILL.md` with YAML frontmatter.

```
skills/
  api-design/
    SKILL.md          # Instructions for the AI agent
    references/       # Optional supplementary docs
```

**Example `SKILL.md`:**

```markdown
---
name: api-design
description: >
  REST API design conventions and best practices.
  Use when creating or reviewing API endpoints.
---

# API Design

## When to use

Apply these conventions when designing new endpoints or reviewing API PRs.

## Guidelines

- Use plural nouns for resource names (`/users`, not `/user`)
- Return 201 for successful creation, 204 for deletion
- Include pagination for list endpoints
```

**Installs to:** `~/.claude/skills/`, `~/.copilot/skills/`, `~/.agents/skills/`

### Agents

Specialized AI worker definitions with their own tool access, model preferences, and behavior. Agents run in isolated context and return a summary to the main conversation.

**Example `code-reviewer.agent.md`:**

```markdown
---
name: code-reviewer
description: >
  Reviews code changes for bugs, security issues, and style violations.
tools:
  - read
  - grep
  - glob
---

# Code Reviewer

You are a code review agent. Given a set of file changes, you:

1. Check for common bugs and edge cases
2. Flag security concerns (SQL injection, XSS, etc.)
3. Verify style consistency with the codebase
4. Suggest concrete improvements with code examples
```

**Installs to:** `~/.claude/agents/`, `~/.copilot/agents/`, plus generated Codex custom agents in `~/.codex/agents/*.toml`

### MCPs

Model Context Protocol server configurations. The toolkit reads these JSON files and registers the MCP server into each AI tool's config file. For Codex, it writes TOML under `~/.codex/config.toml`; for the other tools, it writes JSON config entries. The toolkit does **not** run the server itself.

**Example `supabase-mcp.json`:**

```json
{
  "name": "supabase-mcp",
  "description": "Connect to Supabase for database queries and auth",
  "type": "sse",
  "url": "https://mcp.supabase.com/v1/sse",
  "setupNote": "After install, restart your agent to authorize."
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Identifier — used as the key in target config files |
| `description` | Yes | Shown in the TUI catalog |
| `type` | No | Transport hint for tools that expect it |
| `url` | No | Streamable HTTP server URL |
| `command` | No | STDIO server command |
| `args` | No | Command arguments for STDIO servers |
| `env` | No | Environment variables for STDIO servers |
| `setupNote` | No | Shown to the user after install (e.g. "restart your agent") |

**What happens on install:** The toolkit writes MCP settings into each tool's native config format:

```
~/.claude/settings.json    → mcpServers.<name>
~/.cursor/mcp.json         → mcpServers.<name>
~/.vscode/mcp.json         → servers.<name>
~/.claude.json             → mcpServers.<name>
~/.codex/config.toml       → [mcp_servers.<name>]
```

Only config files that already exist locally are updated for editor-specific integrations. Global configs such as `~/.claude.json` and `~/.codex/config.toml` are created if missing.

### Bundles

Curated collections that reference skills, agents, and MCPs by name. Installing a bundle installs all referenced items together — think of it as a preset or starter pack.

**Example `fullstack-starter.bundle.json`:**

```json
{
  "name": "fullstack-starter",
  "description": "Essential skills and MCPs for full-stack development",
  "skills": ["api-design", "test-driven-development", "code-review"],
  "agents": ["code-reviewer"],
  "mcps": ["supabase-mcp", "playwright-mcp"]
}
```

**Behavior:**
- `toolkit bundle fullstack-starter` installs all 5 items
- `toolkit remove bundle fullstack-starter` removes all items from the bundle
- Items can still be installed/removed individually

---

## Interactive TUI

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
| `1`-`4` | Filter by type (Skills / Agents / MCPs / Bundles) |
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

---

## CLI Commands

```bash
# Install
toolkit skill <name>               # Install a skill
toolkit agent <name>               # Install an agent
toolkit mcp <name>                 # Register an MCP server
toolkit bundle <name>              # Install a bundle (all items at once)

# Remove
toolkit remove skill <name>        # Remove a skill
toolkit remove agent <name>        # Remove an agent
toolkit remove mcp <name>          # Deregister an MCP server
toolkit remove bundle <name>       # Remove a bundle

# Browse & update
toolkit list                       # List all available items
toolkit check                      # Check for available updates
toolkit update                     # Update all installed items

# Sources
toolkit source add <repo>          # Add an external source
toolkit source list                # List configured sources
toolkit source remove <name>       # Remove a source
toolkit refresh                    # Re-fetch all external sources

# Security
toolkit scan                       # Scan all available items
toolkit scan skill <name>          # Scan a specific skill

# Scaffold
toolkit init [dir]                 # Create a boilerplate skill repo

# Meta
toolkit --version                  # Show version
toolkit --help                     # Full usage info
```

**Examples:**

```bash
# Add a source and install a skill from it
toolkit source add vercel-labs/agent-skills
toolkit skill brainstorming

# Install an entire bundle
toolkit bundle fullstack-starter

# Check what's outdated and update everything
toolkit check
toolkit update

# Scan before installing something you don't trust
toolkit scan skill suspicious-skill --force
```

---

## External Sources

All content comes from external repos. The toolkit ships with no bundled resources — you add GitHub or Bitbucket repos as sources, and the toolkit discovers resources inside them.

```bash
# Add sources
toolkit source add owner/repo
toolkit source add https://github.com/owner/repo
toolkit source add https://bitbucket.org/owner/repo
toolkit source add git@github.com:owner/repo.git
```

### Discovery conventions

The toolkit scans source repos recursively and discovers resources by file naming conventions:

| Resource | Discovered by |
|----------|--------------|
| **Skills** | Any directory containing a `SKILL.md` file |
| **Agents** | Any `*.agent.md` file |
| **MCPs** | Any `*.json` in a `mcps/` directory, or `*.mcp.json` anywhere |
| **Bundles** | Any `*.json` in a `bundles/` directory, or `*.bundle.json` anywhere |

Directories named `node_modules`, `.git`, `dist`, `build`, `.next`, and `coverage` are automatically skipped.

### Caching

Sources are shallow-cloned (`--depth 1`) and cached at `~/.toolkit/cache/`. The cache refreshes automatically every 24 hours. Force a refresh with:

```bash
toolkit refresh                    # re-fetch all sources
toolkit source refresh my-source   # re-fetch a specific source
```

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

Override defaults by creating `~/.toolkit/sources.json`.

---

## Security

Every item from external sources is automatically scanned before installation. Items that fail the scan are **blocked** and cannot be installed without `--force`.

### What we scan

**Skills & Agents** (text content analysis):

| Threat | Detection | Severity |
|--------|-----------|----------|
| Remote code execution | `curl \| bash`, `wget \| sh` patterns | Block |
| Reverse shells | `nc -e`, `/dev/tcp/`, encoded PowerShell | Block |
| Invisible prompt injection | Zero-width Unicode characters (U+200B, U+FEFF, etc.) | Block |
| Text direction manipulation | Bidirectional override characters (U+202A–U+2069) | Block |
| Path traversal | Files that escape the skill directory via `../` | Block |
| Symlink escape | Symlinks pointing outside the skill directory | Block |
| Oversized files | Single file > 500KB | Warn |
| Oversized skill | Total directory > 10MB | Warn |
| Excessive file count | More than 200 files in a skill | Warn |
| Broken symlinks | Symlinks that point to non-existent targets | Warn |

**MCPs** (URL and config analysis):

| Threat | Detection | Severity |
|--------|-----------|----------|
| Dangerous protocols | `file://`, `data://` URLs | Block |
| Internal network access (SSRF) | URLs pointing to private IPs (10.x, 172.16-31.x, 192.168.x, 127.x, localhost) | Block |
| Command injection | Shell metacharacters in URL (`;`, `&`, `\|`, `` ` ``, `$`, `(`, `)`) | Block |
| Insecure protocol | HTTP instead of HTTPS | Warn |

### Trust model

- **Internal resources** (bundled with the toolkit): Scanned but findings are downgraded from `block` to `warn`. These are considered trusted.
- **External resources** (from configured sources): Fully scanned. Blocked items cannot be installed unless you pass `--force`.
- The scanner runs automatically on every install. You can also run it manually:

```bash
toolkit scan                    # scan everything
toolkit scan skill <name>      # scan a specific skill
```

### TUI indicators

- Items with blocking findings show a red **✕ blocked** badge
- Items with warnings show a yellow **⚠** badge
- Clean items show no badge

### Limitations

The scanner is a static analysis tool. It catches common attack patterns but is **not** a substitute for reviewing code from untrusted sources. It does not:

- Execute code in a sandbox
- Verify cryptographic signatures
- Check for supply chain attacks in dependencies
- Detect obfuscated or novel attack patterns

**Always review resources from unknown sources before installing.**

### Security Disclosure

If you discover a vulnerability in the toolkit or its scanner, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer or open a private security advisory at [github.com/barleviatias/toolkit-ai/security](https://github.com/barleviatias/toolkit-ai/security)
3. Include steps to reproduce and any relevant details
4. We aim to acknowledge reports within 48 hours

---

## Create Your Own Resources

Scaffold a boilerplate repo to publish your own skills, agents, MCPs, and bundles:

```bash
toolkit init my-skills
```

This creates:

```
my-skills/
  resources/
    skills/
      example-skill/SKILL.md
    agents/
      example-agent.agent.md
    mcps/
      example-mcp.json
    bundles/
      fullstack-starter.bundle.json
  README.md
  .gitignore
```

Push to GitHub, then anyone can add it as a source:

```bash
toolkit source add your-org/my-skills
```

---

## How Storage Works

```
~/.toolkit/
  lock.json              # Tracks installed items, content hashes, timestamps
  sources.json           # Your configured external sources
  cache/                 # Shallow-cloned repos from external sources
    vercel-labs/         #   cached clone of vercel-labs/agent-skills
    anthropics/          #   cached clone of anthropics/skills
```

Installed items are **copied or generated** into each tool's config directory:

```
~/.claude/
  skills/api-design/SKILL.md          # Installed skill
  agents/code-reviewer.agent.md       # Installed agent
  settings.json                       # MCP servers registered here

~/.copilot/
  skills/api-design/SKILL.md          # Same skill, mirrored
  agents/code-reviewer.agent.md

~/.agents/
  skills/api-design/SKILL.md          # Codex-discoverable shared skill

~/.codex/
  agents/code-reviewer.toml           # Generated Codex custom agent
  config.toml                         # MCP servers registered here

~/.cursor/mcp.json                    # MCP servers registered here
~/.vscode/mcp.json                    # MCP servers registered here
```

The **lock file** tracks every installed item with a content hash. When a resource changes upstream, `toolkit check` flags it as outdated and `toolkit update` applies the new version.

---

## Related Projects

Tools, specs, and ecosystems that `toolkit-ai` builds on or pairs with:

| Project | What it is |
|---------|------------|
| [anthropics/skills](https://github.com/anthropics/skills) | Official skill examples from Anthropic |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | Curated skill collection from Vercel Labs |
| [Claude Code](https://code.claude.com/docs) | Anthropic's agentic coding CLI |
| [OpenAI Codex CLI](https://developers.openai.com/codex/cli) | OpenAI's local coding agent |
| [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) | GitHub's agent-mode Copilot |
| [Cursor](https://cursor.com) | AI-first code editor |
| [Model Context Protocol](https://modelcontextprotocol.io) | The open spec for connecting AI models to tools |
| [vadimdemedes/ink](https://github.com/vadimdemedes/ink) | React for terminal UIs — the rendering engine |

### Contributing a skill, agent, or MCP

Scaffold your own source repo with `toolkit init` (see [Create Your Own Resources](#create-your-own-resources)). PRs to add new default sources are welcome — open an issue first to discuss curation criteria.

---

## Development

```bash
git clone https://github.com/barleviatias/toolkit-ai.git
cd toolkit-ai
npm install
npm run build    # Build → bin/ai-toolkit.mjs
npm run dev      # Build with watch
npm test         # Typecheck + 31 unit/integration tests
npm link         # Link globally for testing
```

### Tech stack

- [**React Ink**](https://github.com/vadimdemedes/ink) — terminal UI framework
- [**tsup**](https://tsup.egoist.dev/) — bundles into a single zero-dependency executable
- [**TypeScript**](https://www.typescriptlang.org/) strict mode — full type safety
- [**node:test**](https://nodejs.org/api/test.html) — built-in test runner, no framework dependency

See [`CLAUDE.md`](CLAUDE.md) for architecture notes and [`AGENTS.md`](AGENTS.md) for contributor guidelines.

---

## Keywords

ai · ai-toolkit · ai-agents · skills · agents · mcp · mcp-server · model-context-protocol · claude · claude-code · codex · copilot · cursor · cursor-ai · cli · tui · ink · developer-tools · plugin-manager · agent-framework · prompt-engineering · skill-management · typescript · package-manager · dotfiles

---

## License

[MIT](LICENSE) © Bar Levi Atias
