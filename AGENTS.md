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
| `npm run build` | Bundle the CLI with tsup into `bin/ai-toolkit.mjs` |
| `npm run dev` | `tsup --watch` for iterative development |
| `npm test` | `tsc --noEmit` typecheck, then run all `tests/*.test.mjs` via `node:test` |
| `npm link` | Link the CLI globally for local testing (`toolkit`, `ai-toolkit`, `toolkit-ai`) |

Tests are authored against the compiled build in `.test-dist/` (see `tests/run.mjs`). Fixtures live in `tests/fixtures/*.mjs` and communicate results as JSON via stdout.

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

Current coverage: 31 unit/integration tests across item-key, lock, catalog, fs-helpers, scanner (RCE / reverse shells / size limits / SSRF / protocol blocks / format), Codex config round-trip, install/remove/recovery, security paths.

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
