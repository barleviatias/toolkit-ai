# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Security
- Scanner catches more RCE patterns: interpreter-pipe variants (`curl | python/ruby/node/perl/php/fish/ksh`), `/dev/udp` reverse shells, `ncat --exec`, `socat EXEC:`/`SYSTEM:`, inline `python -c` / `node -e` / `ruby -e` / `perl -e` / `php -r`, base64-decoded execution, PowerShell short-flag encoded commands, `IEX(New-Object Net.WebClient)`.
- Scanner now reads executable scripts (`.sh`, `.bash`, `.zsh`, `.fish`, `.py`, `.rb`, `.pl`, `.php`, `.ps1`, `.bat`, `.cmd`). Previously these files were copied into `~/.claude/skills/` etc. without being scanned.
- `scanMcpConfig` emits a `mcp-stdio-exec` warn-level finding whenever an MCP has a `command` field, with the command + first args in the message. Makes exec intent visible in every UI surface.
- Catalog pre-scan in the TUI and `toolkit scan` now pass the full MCP config (`command`, `args`, `env`, `httpHeaders`, `envHttpHeaders`) through the scanner. Previously only `url` and `type` were scanned — stdio MCPs with dangerous commands or headers appeared clean.

### Changed
- **Install policy is now "alert, never block".** Scanner findings surface via the log callback and the TUI consent dialog, but the install proceeds by default — running the command is treated as consent. This fits the dev-team target audience better than hard refusals.
- New CLI flag `--strict` opts in to hard-fail on block-severity scan findings. Intended for CI. `InstallOptions.strict` on the programmatic API.
- The `--force` flag now only means "force reinstall" (bypass hash check); it no longer bypasses the scanner.
- TUI `CatalogTab.doInstall` now routes **any** item with scanner warnings/blocks OR any stdio MCP through `ConfirmDialog` showing the findings and (for MCPs) the command that will run. `y` proceeds, `n` cancels.
- TUI now respects `action: 'blocked'` from install results and surfaces the message instead of falsely reporting success.

### Tests
- 37 → 38 tests. New coverage: interpreter-pipe variants, reverse-shell variants, inline interpreter exec, base64-decoded exec, `.sh`/`.py` script scanning, `mcp-stdio-exec` finding, strict-mode install gate.

## [2.0.7] - 2026-04-10

### Added
- Security hardening: centralized path validation with `assertSafePathSegment()`
- `SECURITY.md` with responsible disclosure policy
- `LICENSE` file (MIT)
- `CODE_OF_CONDUCT.md`
- PR validation CI workflow (Node 20/22 matrix)
- Scan result caching in TUI for improved performance

### Fixed
- All `catch (e: any)` replaced with `catch (e: unknown)` + type guards
- Empty catch blocks now log to stderr or have documented intent
- Package.json metadata (author, homepage, bugs)

## [2.0.6] - 2026-03-28

### Added
- Codex agent support (MCP config in TOML format)
- Codex agent target (`~/.codex/agents/*.toml`)
- Installed item recovery from disk when lock file is missing

### Fixed
- Lock handling for external bundle installs
- Stale self-dependency in lockfile

## [2.0.4] - 2026-03-25

### Changed
- Renamed MCP `transport` to `type` to match actual config format
- Renamed `plugin` to `bundle` throughout

### Fixed
- MCP section documentation accuracy

## [2.0.1] - 2026-03-22

### Added
- Bundle support (install groups of skills + agents + MCPs)
- Bundle discovery from external sources

## [2.0.0] - 2026-03-20

### Changed
- Complete UX redesign with 3-tab TUI (Catalog, Installed, Sources)
- External source model (all content from GitHub/Bitbucket repos)
- Removed bundled catalog in favor of source-driven discovery

### Added
- Source management CLI and TUI
- Security scanner for skills, agents, and MCPs
- Type filter chips (1-4 keys)
- Multi-select with batch install/remove

## [1.0.0] - 2026-03-15

### Added
- Initial release
- Interactive TUI with React Ink
- Skill and agent installation
- MCP server registration
- External source support (GitHub, Bitbucket)
