# AI Toolkit — Cheat Sheet

A package manager for AI coding assistants. Discovers, installs, and updates **skills, agents, MCP servers, slash commands, bundles, and plugins** from any GitHub/Bitbucket repo into the native on-disk format of Claude Code, Codex, Amp, GitHub Copilot, and Cursor.

> Package name: `toolkit-ai`. All examples use the short alias `toolkit`. Also available as `toolkit-ai` or `ai-toolkit`. From the repo: `node bin/ai-toolkit.mjs`.

---

## TL;DR

```bash
toolkit                          # launch the interactive TUI (browse + install + update)
toolkit list                     # list everything available across your sources
toolkit source refresh           # re-fetch all sources
toolkit skill <name>             # install a skill (into every detected AI tool)
toolkit check                    # what's outdated?
toolkit update                   # update all installed items
```

---

## The 6 resource types

| Type | What it is | How sources expose it |
|---|---|---|
| **skill** | A `SKILL.md` capability folder | any dir containing `SKILL.md` (recursive) |
| **agent** | A subagent persona | any `*.agent.md` file |
| **mcp** | An MCP server config | `*.json` in `mcps/`, or `*.mcp.json` anywhere |
| **command** | A slash-command prompt | discovered from sources |
| **bundle** | A curated set of the above | `*.json` in `bundles/`, or `*.bundle.json` |
| **plugin** | A native plugin tree (skills+agents+commands+hooks+MCPs) | `plugin.json` package |

---

## Install commands

```bash
toolkit skill <name>          # install a skill
toolkit agent <name>          # install an agent (incl. generated Codex agent)
toolkit mcp <name>            # register an MCP server
toolkit command <name>        # install a slash command / prompt
toolkit bundle <name>         # install a bundle (skills+agents+mcps together)
toolkit plugin <name>         # install a plugin natively in every provider
                                 #   with a plugin registry (Claude, Codex, Copilot),
                                 #   decomposed into per-user dirs elsewhere
                                 #   (Cursor, VS Code, Amp). Hooks ride along.
```

**Install flags**

```bash
--force        # reinstall even if the lock hash is unchanged
--strict       # FAIL install on a block-severity scan finding (use in CI).
               #   Auto-on when stdin isn't a TTY (curl | bash, CI).
--link         # symlink to the source cache for this run (overrides saved mode)
--verbose, -v  # detailed step-by-step logs
```

---

## Remove commands

```bash
toolkit remove skill   <name>
toolkit remove agent   <name>
toolkit remove mcp     <name>     # deregisters the server
toolkit remove command <name>
toolkit remove bundle  <name>
toolkit remove plugin  <name>     # also removes decomposed components
```

(No `<name>` after `remove` → drops into the TUI to pick interactively.)

---

## Updates

```bash
toolkit check                 # list outdated items (no changes made)
toolkit update                # update all installed items
toolkit update --force        # re-apply even if up to date
```

---

## Sources (where content comes from)

```bash
toolkit source add <repo>[#branch]    # add a source
toolkit source add <repo> -b <branch> # explicit branch flag
toolkit source add <repo> -n <alias>  # alias (keep 2 branches of one repo)
toolkit source list                   # list configured sources
toolkit source disable <name>         # keep config, skip fetching
toolkit source enable  <name>         # re-enable
toolkit source remove  <name>         # delete entirely
toolkit source refresh [name]         # force re-fetch (all, or one by name)
```

**Accepted `<repo>` forms**

```
owner/repo
owner/repo#branch
https://github.com/owner/repo[#branch]
https://bitbucket.org/owner/repo[#branch]
git@github.com:owner/repo.git[#branch]
```

---

## Discovery & diagnostics

```bash
toolkit list                  # full catalog: skills/agents/mcps/bundles/commands/plugins
toolkit targets               # detected AI tools + per-type capabilities (alias: doctor)
toolkit settings              # current settings + config/cache paths
toolkit --version
toolkit --help                # full usage
```

---

## Security scanner

Every external resource is statically scanned before install. **Informed consent, not enforcement** — the scanner surfaces risk, you decide (running the command *is* the consent). Use `--strict` to hard-fail in CI.

```bash
toolkit scan                  # scan everything available
toolkit scan skill <name>     # scan one skill
```

In the **TUI**, anything flagged `warn`/`block` (or any stdio MCP with a `command`) routes through a confirm dialog showing the findings + command preview before it installs.

---

## Settings

```bash
toolkit settings                          # show current settings
toolkit settings install-mode link        # symlink skills/agents to cache (default)
toolkit settings install-mode copy        # copy a stable snapshot instead
toolkit settings symlink on|off           # alias for link|copy
toolkit settings cache 24h                # source cache TTL (s/m/h/d)
toolkit settings concurrency 4            # parallel source-refresh workers
toolkit settings tools                    # list providers + on/off state
toolkit settings tool <id> on|off         # enable/disable a provider
```

Provider `<id>`: `claude`, `cursor`, `vscode`, `codex`, `copilot`, `amp`.

- **link** mode: source edits + refreshes propagate without reinstalling.
- **copy** mode: frozen snapshot, immune to source changes.

---

## Logs

```bash
toolkit logs                  # last 20 operations from ~/.toolkit/log.jsonl
toolkit logs 50               # last 50
toolkit logs -v               # dump captured per-line output
toolkit logs --name foo       # filter by item-name substring
toolkit logs --action install # filter by action
```

Actions: `install`, `remove`, `update`, `install-plugin`, `remove-plugin`, `install-bundle`, `refresh-source`.

---

## Scaffold a source repo

```bash
toolkit init [dir]            # starter pack: toolkit-usage skill + sample command + bundle
```

---

## Interactive TUI keys

Launch with `toolkit` (no args). Four tabs: **Catalog · Installed · Sources · Settings**.

| Key | Action |
|---|---|
| `Tab` | switch tab |
| type | search / filter the list |
| `↑ / ↓` | move cursor |
| `Enter` | open detail view |
| `Space` | toggle selection |
| `i` | install |
| `r` | remove |
| `u` | update |
| `1`–`4` | toggle type filter chips |
| `y / n` | confirm / cancel a destructive or flagged action |
| `Esc` | back / close modal |

---

## On-disk state

```
~/.toolkit/
  config.json      # installMode, cacheTTL, sourceConcurrency, disabledTools
  lock.json        # installed items + content hashes
  sources.json     # your custom sources (overrides bundled defaults)
  cache/           # shallow-cloned source repos
  log.jsonl        # operation log (toolkit logs)
```

**Where things install (global targets):**

- Skills → `~/.claude/skills/`, `~/.copilot/skills/`, `~/.agents/skills/`, `~/.config/amp/skills/`
- Agents → `~/.claude/agents/`, `~/.copilot/agents/`, generated `~/.codex/agents/*.toml`
- MCPs → `~/.claude/settings.json`, `~/.vscode/mcp.json`, `~/.cursor/mcp.json`, `~/.claude.json`, `~/.codex/config.toml`, `~/.config/amp/settings.json`

---

## Common recipes

```bash
# Set up from scratch
toolkit source add anthropics/skills
toolkit source refresh
toolkit list

# Install a skill everywhere, then verify which tools got it
toolkit skill code-review && toolkit targets

# CI-safe install (hard-fail on risky content)
toolkit plugin radware-ams --strict

# Track two branches of one repo
toolkit source add owner/repo -b main -n repo-main
toolkit source add owner/repo -b next -n repo-next

# Keep a frozen copy that won't change when the source updates
toolkit settings install-mode copy
toolkit skill my-skill

# See what changed recently
toolkit logs 30 --action install -v
```
