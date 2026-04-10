# Changelog

All notable changes to this project will be documented in this file.

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
