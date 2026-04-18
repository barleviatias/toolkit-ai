
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

Manage AI skills, agents, MCPs, and bundles across Claude Code, Codex, Copilot, and Cursor — from any GitHub or Bitbucket source.

[![npm](https://img.shields.io/npm/v/toolkit-ai)](https://www.npmjs.com/package/toolkit-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## Table of Contents

- [Install](#install)
- [Resource Types](#resource-types)
  - [Skills](#skills)
  - [Agents](#agents)
  - [MCPs](#mcps)
  - [Bundles](#bundles)
- [Interactive TUI](#interactive-tui)
- [CLI Commands](#cli-commands)
- [External Sources](#external-sources)
- [Security](#security)
  - [What We Scan](#what-we-scan)
  - [Trust Model](#trust-model)
  - [Security Disclosure](#security-disclosure)
- [Create Your Own Resources](#create-your-own-resources)
- [How Storage Works](#how-storage-works)
- [Development](#development)

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
| `d` | Disable / re-enable source (keeps config, skips fetch) |
| `r` | Remove source entirely (with confirmation) |
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
toolkit source disable <name>      # Temporarily skip a source (stays in config)
toolkit source enable <name>       # Re-enable a disabled source
toolkit source remove <name>       # Remove a source entirely
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
toolkit scan skill suspicious-skill

# Install in CI — fail the pipeline if the scanner finds anything risky
toolkit skill suspicious-skill --strict
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

This tool is built for dev teams — the goal is **informed consent, not enforcement**. The scanner surfaces risky patterns so you can decide; it does not refuse to install on your behalf.

### The model: alert, never block

| Context | What happens when the scanner finds something |
|---------|-----------------------------------------------|
| **TUI install** | A confirmation dialog shows the findings + (for stdio MCPs) the full command that will run at every agent session. `y` to proceed, `n` to cancel. |
| **CLI install** | Findings are printed loudly in the output. The install proceeds — running the command is treated as consent. |
| **CLI with `--strict`** | Block-severity findings cause the install to exit with `blocked`. Use this in CI when you want a hard fail. |

Running `toolkit mcp foo` in a terminal means you typed the name and pressed Enter. We don't second-guess that. The TUI is where consent prompts live because the user is browsing and may not know what they clicked on.

### What we scan

**Skills & Agents** (text content analysis across `.md`/`.txt`/`.json`/`.yaml`/`.js`/`.ts`/`.html` plus executable scripts `.sh`/`.bash`/`.zsh`/`.fish`/`.py`/`.rb`/`.pl`/`.php`/`.ps1`/`.bat`/`.cmd`):

| Threat | Detection | Severity |
|--------|-----------|----------|
| Remote code execution | `curl \| bash/sh/python/ruby/node/perl/php/fish/ksh`, `wget \| …`, `fetch \| …` | Block |
| Inline interpreter exec | `python -c`, `perl -e`, `ruby -e`, `node -e`, `node -p`, `php -r`, `bash -c` | Block/Warn |
| Reverse shells | `nc -e`, `ncat --exec`, `socat … EXEC:`/`SYSTEM:`, `/dev/tcp/`, `/dev/udp/`, PowerShell `-enc`/`-e`/`-ec`, `IEX(New-Object Net.WebClient …)` | Block |
| Base64-decoded execution | `base64 -d \| bash/sh/python/…`, `$(echo … \| base64 -d)` | Block |
| Invisible prompt injection | Zero-width Unicode (U+200B, U+FEFF, etc.) and bidirectional override characters (U+202A–U+2069) | Block |
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
| Stdio MCP will execute a local command | Any MCP with a `command` field — surfaces the command + first args in the UI before install | Warn |
| Insecure protocol | HTTP instead of HTTPS | Warn |

The MCP scanner also runs every header value, env value, and arg through the same text-pattern rules — an `Authorization` header that smuggles a `curl \| bash` payload will surface.

### Running the scanner directly

```bash
toolkit scan                    # scan everything
toolkit scan skill <name>       # scan a specific skill
```

### Strict mode (CI)

```bash
toolkit skill <name> --strict   # exits non-zero if the scan finds a block-severity issue
toolkit update --strict         # same, for bulk updates
```

Use `--strict` in pipelines where you'd rather fail a build than install something flagged. Leave it off in day-to-day dev work.

### Trust model

- **Internal resources** (bundled with the toolkit): Scanned, but findings are downgraded from `block` to `warn`.
- **External resources** (from configured sources): Fully scanned. Warnings surface in both the TUI badge and the install log, but the install proceeds unless you pass `--strict`.
- The scanner runs automatically on every install and on every catalog render — results are cached by content hash so repeats are free.

### TUI indicators

- Items with blocking findings show a red **✕ blocked** badge (install will trigger a confirmation dialog, not a refusal)
- Items with warnings show a yellow **⚠** badge
- Stdio MCPs always show their command preview in the detail view before install
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

## Development

```bash
git clone https://github.com/barleviatias/toolkit-ai.git
cd toolkit-ai
npm install
npm run build    # Build → bin/ai-toolkit.mjs
npm run dev      # Build with watch
npm test         # Lint + validate catalog
npm link         # Link globally for testing
```

### Tech stack

- **React Ink** — terminal UI framework
- **tsup** — bundles into a single zero-dependency executable
- **TypeScript** — full type safety

---

## Roadmap

Post-launch plans live in [ROADMAP.md](ROADMAP.md) — UX polish (cold-start spinner, `?` help overlay), perf work (parallel git clones, atomic fetch), and test-coverage gaps.

## License

MIT
