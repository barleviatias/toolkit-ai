# Roadmap

toolkit-ai is becoming the local package manager and control plane for AI coding assistants: one place to discover, review, install, update, and repair skills, agents, MCP servers, and team conventions across the tools developers already use.

This roadmap is intentionally ambitious but buildable. It is not a release promise; it is a shared direction for product ideas, engineering work, and the kind of developer experience we want to make feel obvious.

## Recently shipped

- **Dev build visibility.** Local development builds show a visible `dev build` tag so testing never looks like production by accident.
- **Settings tab and CLI config.** Users can control install mode, source cache duration, parallel source refreshes, and see config/cache paths from one place.
- **Smarter source loading.** Source fetches run concurrently, fall back to cached data when refresh fails, and surface warnings instead of silently breaking the catalog.
- **Symlink install mode.** Skills and agents can be copied for stability or symlinked to the source cache for faster local iteration.
- **Detected target providers.** Installs now target detected tools instead of blindly writing everywhere.
- **Target visibility.** The TUI shows which provider targets exist and where each item will install or is already installed.

## Next milestone: global consumer rules, hooks, and prompts

- **Global consumer rules.** Support installing user-level guidance per consumer, not per repository, in each tool's native global settings shape.
- **Claude hooks support.** Treat global Claude Code hooks as a higher-risk resource type because they execute commands. They need explicit preview, scanner coverage, consent, and strict-mode behavior before install.
- **Slash commands and prompt templates.** Install reusable prompts/slash commands as a first-class resource type (Claude Code prompts, Cursor commands, GitHub Copilot/VS Code prompt files) so a single source can publish a command once and render the right shape for each consumer.
- **Rule adapters.** Let a single source package declare intent once, then render per-consumer global outputs for Cursor, VS Code/GitHub Copilot, Claude Code, and future providers.
- **Provider controls.** Add settings for which consumers receive global rules, hooks, and prompts, separate from skills, agents, and MCPs.
- **Investigation track.** Document each provider's global storage format, merge behavior, overwrite policy, uninstall recovery, and compatibility differences before implementing writes.

## Near term

- **Help overlay.** Add a `?` overlay with tab-specific keyboard shortcuts, replacing crowded one-line status hints.
- **Clearer install and update feedback.** Make install, update, skip, warning, and no-op states obvious in both TUI and CLI logs.
- **Per-source refresh progress.** Show which source is cloning, cached, stale, refreshed, skipped, or failing.
- **Provider label cleanup.** Distinguish `GitHub Copilot files`, `VS Code MCP`, and `Cursor MCP` so users understand the difference between an AI provider and an editor host.
- **Stronger update coverage.** Add focused tests for `updateAll`, bundle sub-item updates, removed catalog items, bundle remove/protection behavior, and lock/filesystem drift recovery.
- **No-npm installer.** Ship a `curl | sh` script for macOS/Linux and a PowerShell one-liner for Windows that fetches a self-contained binary (Node embedded via `pkg` or Bun `--compile`) from GitHub releases, so users without Node or npm can install the toolkit.

## Next big bets

- **Provider matrix.** Let users enable or disable install targets per provider and resource type, with a clear preview of what each target supports.
- **Install preview and diff.** Before writing files, show the exact paths and MCP config entries that will change.
- **Doctor and repair.** Diagnose and repair drift between the lock file, installed files, symlinks, and MCP config entries.
- **Incremental source refresh.** Prefer `git fetch`/reset over full re-clone when refreshing an existing cache.
- **Team profiles.** Support named team setups that bundle sources, settings, target preferences, and recommended installs.

## Dreams

- **Curated marketplace.** A browsable directory of trusted sources, skills, agents, MCPs, and bundles with quality signals.
- **Trusted source tiers.** Signed sources, verified publishers, and source trust policies that reduce repeated consent friction without hiding risk.
- **Portable team config.** Export/import a complete toolkit setup so a repo or team can onboard in one command.
- **Local health dashboard.** Show installed inventory, update status, warnings, stale caches, broken symlinks, and provider readiness.
- **Compatibility scoring.** Explain which agents, skills, or MCPs are best suited for Claude Code, Codex, Amp, Copilot, Cursor, and VS Code.
- **One-command repo onboarding.** Detect a project's recommended assistant setup and offer to install it locally with reviewable changes.
- **Workspace brain.** Keep skills, agents, MCPs, repo conventions, and team knowledge synchronized across assistants without trapping users in one tool.

## Principles

- **Local-first.** The user's machine and files remain the source of truth.
- **Transparent writes.** Every install should make it clear what will be written and where.
- **Alert, never block by default.** Surface risk clearly, while reserving hard failure for explicit strict/CI modes.
- **Source-driven.** Content comes from user-configured sources, not hidden bundled resources.
- **Reversible state.** Installs, updates, removals, and repairs should be understandable and undoable.
