# Repository Guidelines

Conventions for contributors and AI coding agents (Claude Code, Codex, Copilot, Cursor). Pairs with [CLAUDE.md](CLAUDE.md) (architecture) and [README.md](README.md) (user docs).

## Project Structure & Module Organization

`src/` contains all application code for the CLI and Ink TUI:

- `src/commands/` — command entrypoints (`headless.ts`, `init.ts`)
- `src/core/` — install / update / remove / catalog / scanner / sources / platform logic
- `src/components/` — shared UI pieces (`ItemRow`, `ItemList`, `DetailView`, `TypeFilter`, …)
- `src/tabs/` — top-level TUI screens (`CatalogTab`, `InstalledTab`, `SourcesTab`)
- `src/hooks/` — React hooks (`useCatalog`, `useFilteredItems`)

Static data lives in `resources/` (default sources manifest); repo-level utilities live in `scripts/`. Build output is written to `bin/ai-toolkit.mjs` — do **not** hand-edit generated files.

## Build, Test, and Development Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install dev dependencies (ink, react, tsup, typescript) |
| `npm run build` | Production bundle into `bin/ai-toolkit.mjs` (publish only) |
| `npm run build:dev` | **Local verification build** — stamps a git build number into the UI / `--version`; use this to verify changes manually |
| `npm run dev` | `tsup --watch` for iterative development |
| `npm test` | `tsc --noEmit` typecheck, then run all `tests/*.test.mjs` via `node:test` |
| `npm link` | Link the CLI globally for local testing (`toolkit`, `ai-toolkit`, `toolkit-ai`) |

Tests are authored against the compiled build in `.test-dist/` (see `tests/run.mjs`). Fixtures live in `tests/fixtures/*.mjs` and communicate results as JSON via stdout.

**Manual / TUI verification must use `npm run build:dev`, never `npm run build`.** The dev build stamps a build number (git short SHA, `+-dirty`) into the Logo and `--version`, e.g. `toolkit-ai v2.1.13 dev build · adb1edd`. This matters because the global `toolkit` command may resolve to the **published npm copy** in `node_modules`, not your repo build — both print the same version, so a stale global silently runs old code. Run `npm link` first so the global commands point at the repo build, then confirm the build number in the UI before trusting any manual verification.

## Coding Style & Naming Conventions

- **TypeScript** `strict: true`, ES modules, 2-space indentation
- **No `any`** — catch errors as `unknown` with `e instanceof Error` guards
- **Named exports** over default; **PascalCase** for React components, **camelCase** for functions/variables, **kebab-case** for resource names (skills, agents, bundles, MCPs)
- **JSDoc** on every exported function in `src/core/`
- **No shell strings** — use `spawnSync(bin, [args], ...)` with array arguments; never `{shell: true}`
- Keep command modules focused; put filesystem and platform-specific logic in `src/core/`

## Testing Guidelines

Tests use Node.js built-in runner (`node:test`). To add a test:

1. Create `tests/fixtures/<name>.mjs` that imports from `process.env.TEST_BUILD_DIR`, runs assertions, and outputs JSON on stdout
2. Add a `test()` call in the appropriate `tests/*.test.mjs` that calls `runFixture()` and asserts on the JSON result
3. Run `npm test` to typecheck + compile + execute

Current coverage: 64 unit/integration tests across item-key, lock, catalog, fs-helpers, scanner (RCE / reverse shells / size limits / SSRF / protocol blocks / format), Codex config round-trip, install/remove/recovery, security paths, native plugin install/remove, provider-specific MCP behavior, and plugin discovery from Claude/Codex/Copilot native installs.

## Native Plugin MCP Notes

When debugging plugin installs, keep native plugin behavior separate from
decomposed resource installs:

- Claude, Codex, and GitHub Copilot have native plugin registries. For these
  tools, plugin MCPs should stay inside the plugin tree and be referenced from
  the plugin manifest as `mcpServers: "./.mcp.json"`.
- Cursor, VS Code, and Amp do not use the toolkit native plugin registry. For
  these tools, plugin MCPs still decompose into their normal user-level MCP
  config files.
- Do not re-add plugin MCPs to Claude/Codex/Copilot user-level MCP config as a
  fallback without documenting why. It creates duplicate MCP entries on clients
  that already read plugin-scoped MCPs.
- `src/core/claude-plugins.ts` owns scoped plugin tree copying. The helper
  collects `.mcp.json` entries, writes one canonical `.mcp.json` in the copied
  plugin tree, and rewrites manifest `mcpServers` to point at that file.
- `src/core/platform.ts` owns legacy/decomposed MCP config writes. Preserve the
  Codex `type` field when parsing/writing `[mcp_servers.<name>]`; streamable
  HTTP/SSE/stdio behavior depends on it.
- Codex marketplace snapshots live at
  `~/.codex/plugins/cache/toolkit-ai/.agents/plugins/marketplace.json`. The old
  `.codex-plugin/marketplace.json` path is stale and should be removed during
  install/update cleanup.

Future MCP regressions need three checks before changing installer behavior:

1. Installed cache shape: manifest has `mcpServers: "./.mcp.json"` and copied
   `.mcp.json` has expected `mcpServers.<name>` entries.
2. Provider config shape: Claude/Codex/Copilot should not have duplicate
   user-level plugin MCP entries; Cursor/VS Code/Amp should have decomposed
   entries when those tools are enabled.
3. Runtime behavior: start the real target client or run the relevant Codex
   runtime check. A correct manifest does not prove the MCP server transport is
   compatible.

Headless install strictness is explicit. Piped or CI installs do not auto-enable
strict mode; pass `--strict` when a pipeline must hard-fail on block-severity
scanner findings.

## Commit & Pull Request Guidelines

- **Commit subjects**: short, imperative, describe behavior not implementation (`fix(tui): restore alt-screen on exit`, not `edit app.tsx`)
- **Scope**: one logical change per commit; split mechanical refactors from behavior changes
- **Conventional prefixes** are encouraged: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `ci:`, `wip:`
- **PRs** use `.github/PULL_REQUEST_TEMPLATE.md` — include a summary, test-plan checklist, and link related issues

Co-authored commits are welcome when pairing with an agent; do not let agents push directly to `main`.

## Releasing

```bash
npm version patch   # bug fix:      2.1.0 → 2.1.1
npm version minor   # new feature:  2.1.0 → 2.2.0
npm version major   # breaking:     2.1.0 → 3.0.0
git push && git push --tags
```

CI publishes to npm automatically via OIDC trusted publishing on `v*` tag push. Do **not** hand-edit `version` in `package.json` or create tags manually.

## Security

All external resources are scanned before installation (see [`src/core/scanner.ts`](src/core/scanner.ts) and the [Security section in the README](README.md#security)). Path segments are validated via `assertSafePathSegment()`. Never use `shell: true` or `exec()` — use `spawnSync` with array arguments.

The install policy is **alert, never block** — scanner findings surface to the user (TUI consent dialog, CLI log output) but do not refuse the install. The CLI `--strict` flag (`InstallOptions.strict`) opts in to hard-fail on block-severity findings for CI. Don't add per-call bypass flags; see the Security Model section in [`CLAUDE.md`](CLAUDE.md).

Report vulnerabilities via [GitHub Security Advisories](https://github.com/barleviatias/toolkit-ai/security) — see [`SECURITY.md`](SECURITY.md) for the full policy.

## Contributor Notes

- Before adding default sources, skills, agents, bundles, or MCP definitions, read [`CONTRIBUTING.md`](CONTRIBUTING.md)
- If you change repository resources or generated catalog inputs, regenerate the catalog before opening a PR
- When in doubt about architecture, read [`CLAUDE.md`](CLAUDE.md)
