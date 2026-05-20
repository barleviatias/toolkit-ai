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

**A package manager for AI coding assistants — manage skills, agents, and MCP servers across Claude Code, Codex, Amp, GitHub Copilot, and Cursor from any GitHub repo.**

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

- Every tool keeps its own config (`~/.claude/`, `~/.cursor/`, `~/.codex/`, `~/.copilot/`, `~/.config/amp/`)
- Skills, subagents, and MCP server configs live in different formats
- There's no shared catalog, no versioning, no security review step
- Shipping a skill to your team means a wiki page and a prayer

`toolkit-ai` treats your AI tooling like dependencies. Point it at GitHub repos, browse everything in one TUI, install across all five tools at once, and keep a lockfile with content hashes so you know when something changed.

```bash
npx toolkit-ai
```

### Features

- **One catalog, five tools** — skills, agents, and MCP servers installed into Claude Code, Codex, Amp, GitHub Copilot, and Cursor from a single command
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
# Recommended — install once, get the short `toolkit` command,
# and self-updates in the background on every launch.
npm install -g toolkit-ai
toolkit                    # launch the TUI
toolkit --help             # CLI reference

# One-off use (never installs anything globally)
npx toolkit-ai
```

### Without npm

Don't have npm (or just don't want to use it)? Pipe the installer instead.
It downloads the bundled `.mjs` from GitHub Releases and drops it in
`~/.local/bin` (or `/usr/local/bin`). Node 20+ on PATH is the only requirement.

```bash
curl -fsSL https://raw.githubusercontent.com/barleviatias/toolkit-ai/main/install.sh | bash
```

Pin a specific version or override the install dir:

```bash
AI_TOOLKIT_VERSION=v2.1.6 curl -fsSL .../install.sh | bash
AI_TOOLKIT_BIN_DIR=~/bin   curl -fsSL .../install.sh | bash
```

**Auto-updates:** when launched from a global npm install, toolkit-ai checks the
npm registry once per 24h and, if a newer version exists, silently runs
`npm install -g toolkit-ai@latest` in the background. The upgrade takes effect
on the next launch. Never runs when installed via `npx`, `npm link`, or a local
clone. Auto-skipped on CI (`CI=true`, `GITHUB_ACTIONS`, `CODESPACES`, etc.) and
when stderr isn't a TTY. Opt out with `TOOLKIT_AUTO_UPDATE=off` (or
`TOOLKIT_NO_UPDATE_CHECK=1` to disable the check entirely).

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

**Installs to detected targets:** `~/.claude/skills/`, `~/.copilot/skills/`, `~/.agents/skills/` (Codex), `~/.config/amp/skills/`

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

**Installs to detected targets:** `~/.claude/agents/`, `~/.copilot/agents/`, plus generated Codex custom agents in `~/.codex/agents/*.toml`

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

Only config files that already exist locally are updated for editor-specific integrations. Global configs such as `~/.claude.json` and `~/.codex/config.toml` are created only when that target app is detected. Run `toolkit targets` to see what the toolkit will write to.

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

### Plugins

Plugins are bundled packages of skills, agents, commands, and MCP servers,
discovered as a first-class resource type and installed across **every detected
provider** — Claude Code, Codex, GitHub Copilot, Cursor, VS Code, and Amp.

**Discovery — manifest formats accepted:**

- `.claude-plugin/plugin.json` — Claude Code's official plugin layout
- `.codex-plugin/plugin.json` — Codex's native plugin layout
- `plugin.json` at the plugin root — generic / cross-tool plugin packages
- **Plugins already installed by Claude Code's `/plugin install`** — read from
  `~/.claude/plugins/installed_plugins.json` and surfaced under the synthetic
  `claude` source. No source configuration needed; they appear automatically
  in `--list` and the TUI catalog. Run `toolkit plugin <name>` on one to
  decompose-install it across every other detected provider so the same
  plugin works in Codex/Copilot/Cursor/Amp/VS Code too. Toolkit never writes
  to Claude's plugin state — `remove plugin` only removes the decomposed copies.
- **Plugins already installed by Codex** — read from `~/.codex/config.toml`
  `[plugins."<name>@<marketplace>"]` entries plus
  `~/.codex/plugins/cache/<marketplace>/<name>/<version>/`, then surfaced
  under the synthetic `codex` source. Run `toolkit plugin <name>` to mirror
  it across the other detected providers.
- **Plugins already installed by GitHub Copilot CLI's `copilot plugin install`** —
  discovered by walking `~/.copilot/installed-plugins/_direct/` (the per-plugin
  install root the Copilot CLI populates) and surfaced under the synthetic
  `copilot` source. Same flow as the Claude case: appear automatically in
  `--list`, run `toolkit plugin <name>` to decompose-install across every
  other detected provider. Toolkit never writes back to Copilot's installed-
  plugins tree — `remove plugin` only removes the decomposed copies.

**Manifest path overrides — for plugins that don't fit Claude's layout:**

Most Claude plugins put skills directly under `skills/<name>/SKILL.md` and
agents directly under `agents/<name>.md`. Cross-tool plugin packages (AMS,
Radware bundles, anything with per-tool adapters) often nest these — e.g.
`skills/universal/foo/SKILL.md`, `skills/stack-specific/backend-java/foo/SKILL.md`,
`agents/adapters/copilot/reviewer.agent.md`.

The `plugin.json` manifest may declare explicit content roots so the toolkit
walks the right places:

```json
{
  "name": "radware-ams",
  "skills": [
    "skills/universal/",
    "skills/stack-specific/backend-java/",
    "skills/stack-specific/frontend-react/"
  ],
  "agents": "agents/adapters/copilot/",
  "commands": "commands/",
  "mcps": "mcps/"
}
```

Each field accepts a string or an array of strings, all relative to the
plugin root. The toolkit walks each declared root recursively for
`SKILL.md` / `*.agent.md` / `*.md` / `*.prompt.md` / `*.mcp.json`, then
decompose-installs across every detected provider exactly as it does for
Claude-shaped plugins. When fields are absent, the conventional dirs
(`skills/`, `agents/`, `commands/`, root `.mcp.json`) are scanned instead.

**Install — what happens to each component:**

Installing a plugin **decomposes** it and writes each component into the
native on-disk format every detected provider already reads:

- `skills/<name>/SKILL.md` → `~/.claude/skills/`, `~/.copilot/skills/`, `~/.agents/skills/` (Codex), `~/.config/amp/skills/`
- `agents/<name>.md` → `~/.claude/agents/`, `~/.copilot/agents/`, and a generated `~/.codex/agents/<name>.toml` for Codex
- `commands/<name>.md` → `~/.claude/commands/`, `~/.cursor/commands/` (verbatim), and a transformed `*.prompt.md` for VS Code / Insiders
- `.mcp.json` → registered as MCP servers in every detected MCP-aware config (`.claude/settings.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.codex/config.toml`, `.config/amp/settings.json`, etc.)

The result is that the same plugin works in every assistant the user has
installed, in each one's own native shape — no provider-specific plugin
machinery required on the consumer side.

**Native Copilot plugin registration**: when GitHub Copilot CLI is detected,
plugin install also writes a real entry to Copilot's plugin manager — copies
the plugin tree to `~/.copilot/installed-plugins/toolkit-ai/<name>/`, adds
to `~/.copilot/config.json` `installedPlugins[]`, enables it in
`~/.copilot/settings.json`. This makes the plugin show up in Copilot's
"Plugins" UI panel, not just as decomposed skills/agents on disk.
`toolkit remove plugin` mirrors this — drops the registry entry, disables
in settings, removes the cache dir.

**Native Codex plugin registration**: when Codex is detected, plugin install
also writes a real Codex plugin install — copies the scoped plugin tree to
`~/.codex/plugins/cache/toolkit-ai/<name>/<version>/`, registers a local
`toolkit-ai` marketplace in `~/.codex/config.toml`, and enables
`[plugins."<name>@toolkit-ai"]`. Codex then loads the plugin from its own
plugin system instead of only seeing decomposed standalone skills/agents.
`toolkit remove plugin` removes the config entry and cache tree.

**Hooks (`hooks/hooks.json`).** Toolkit refuses to merge a plugin's hooks
into the user's `~/.claude/settings.json` (those commands run on every tool
call across every repo and the security scanner doesn't cover them yet),
but a plugin-tree hooks file is a different story: each tool's plugin
manager loads `hooks/hooks.json` from inside the plugin's own install dir
and scopes the hooks to that plugin's lifecycle. The toolkit copies the
`hooks/` directory verbatim along with the rest of the plugin tree, so any
`hooks/hooks.json` the plugin ships rides along to Claude / Copilot / Codex
plugin installs.

**Per-tool hooks.json swap.** Claude, Copilot, and Codex disagree on hook
schema — Claude uses PascalCase events and `${CLAUDE_PLUGIN_ROOT}`, Copilot
uses camelCase events with no documented plugin-root env var, Codex's hook
spec is not public. A plugin can ship multiple hook configs and let the
installer pick the right one per tool. The canonical
`hooks/hooks.json` is treated as the Claude flavor; if the plugin also
ships `hooks/configs/copilot.hooks.json` or `hooks/configs/codex.hooks.json`,
the installer for that tool reads the matching template, substitutes the
literal string `__AMS_PLUGIN_ROOT__` with the install destination directory,
and writes the result over `hooks/hooks.json` inside that tool's install.
Claude's install is never swapped — it keeps the canonical file.

```
plugin/
├─ hooks/
│  ├─ hooks.json                    ← canonical (Claude flavor)
│  └─ configs/
│     ├─ copilot.hooks.json         ← swapped in for Copilot install
│     └─ codex.hooks.json           ← swapped in for Codex install
```

This sidesteps the missing plugin-root env var problem on Copilot and Codex:
since the templates carry absolute paths after substitution, the hook
commands resolve correctly without any runtime variable expansion.

### Operation log

Every install / remove / update is appended to `~/.toolkit/log.jsonl` as one
JSON record per line — captures the action, item, source, result, and the
full log lines the operation emitted. Tail the last N entries with:

```bash
toolkit logs            # last 20
toolkit logs 50         # last 50
```

Each entry survives across sessions, so you can answer "what did the toolkit
actually do last week" without keeping the TUI summary toast on screen.

> **Coexistence with Claude Code's `/plugin install`:** the toolkit installs
> components into each provider's standalone directories (`~/.claude/skills/`,
> `~/.claude/agents/`, etc.). Claude Code's own `/plugin install` writes to
> `~/.claude/plugins/cache/<marketplace>/<name>/<version>/` and tracks state
> in `~/.claude/plugins/installed_plugins.json`. The two paths don't conflict
> — but if you install the same plugin via both, Claude will see two copies of
> each skill (the namespaced plugin form and the bare standalone form).

```bash
toolkit plugin feature-dev          # decompose-install a plugin across all detected providers
toolkit remove plugin feature-dev   # remove the plugin and every component
```

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
| `1`-`6` | Filter by type (Skills / Agents / MCPs / Bundles / Commands / Plugins) |
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
toolkit plugin <name>              # Install a plugin (decomposed across every detected provider)

# Remove
toolkit remove skill <name>        # Remove a skill
toolkit remove agent <name>        # Remove an agent
toolkit remove mcp <name>          # Deregister an MCP server
toolkit remove bundle <name>       # Remove a bundle

# Browse & update
toolkit list                       # List all available items
toolkit targets                    # Show detected install targets
toolkit settings                   # Show install/cache settings
toolkit check                      # Check for available updates
toolkit update                     # Update all installed items

# Sources
toolkit source add <repo>          # Add an external source
toolkit source list                # List configured sources
toolkit source disable <name>      # Temporarily skip a source (stays in config)
toolkit source enable <name>       # Re-enable a disabled source
toolkit source remove <name>       # Remove a source entirely
toolkit refresh                    # Re-fetch all external sources

# Settings
toolkit settings install-mode copy # Install skills/agents as file copies
toolkit settings install-mode link # Install skills/agents as symlinks
toolkit settings cache 24h         # Refresh stale source cache after 24h
toolkit settings cache 0           # Always check sources on launch/refresh
toolkit settings concurrency 4     # Fetch up to 4 sources in parallel

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

# Symlink a skill/agent to the source cache instead of copying it
toolkit skill brainstorming --link

# Make symlink installs the default for future TUI and CLI installs
toolkit settings install-mode link
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

### Settings

The TUI includes a **Settings** tab for install mode, source cache duration, parallel source refreshes, detected providers, and the config/cache paths. The same values are stored in `~/.toolkit/config.json` and used by headless CLI commands.

- `installMode: "link"` (default) symlinks skills/agents to the source cache, so refreshes and local source edits propagate without reinstalling.
- `installMode: "copy"` installs stable snapshots of skills/agents instead — useful when you want installed content frozen at install time, independent of source-cache refreshes.
- `cacheTTL` controls how long source clones are considered fresh before the next launch or refresh fetches updates.
- `cacheTTL: 0` always checks remote sources.
- `sourceConcurrency` controls how many source repos fetch in parallel.

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

~/.config/amp/
  skills/api-design/SKILL.md          # Amp-discoverable skill
  settings.json                       # MCP servers registered here (amp.mcpServers)

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
npm run build:dev # Local build with a visible "dev build" tag
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

## Roadmap

Post-launch plans live in [ROADMAP.md](ROADMAP.md) — UX polish (cold-start spinner, `?` help overlay), perf work (parallel git clones, atomic fetch), and test-coverage gaps.

## License

[MIT](LICENSE) © Bar Levi Atias
