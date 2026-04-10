# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the application code for the CLI and Ink TUI. Use `src/commands/` for command entrypoints, `src/core/` for install/update/remove/catalog logic, `src/components/` for shared UI pieces, `src/tabs/` for top-level TUI screens, and `src/hooks/` for React hooks. Static data lives in `resources/`, and repo utilities such as catalog generation live in `scripts/`. Build output is written to `bin/ai-toolkit.mjs`; do not hand-edit generated files.

## Build, Test, and Development Commands
`npm install` installs dependencies. `npm run build` bundles the CLI with `tsup` into `bin/`. `npm run dev` runs `tsup --watch` for iterative development. `npm test` runs `tsc --noEmit` (typecheck) followed by all unit and integration tests via Node.js built-in test runner. Tests live in `tests/*.test.mjs` with fixtures in `tests/fixtures/*.mjs`.

## Coding Style & Naming Conventions
This repo uses TypeScript with `strict: true` and ES module syntax. Match the existing style: 2-space indentation, concise functions, explicit types, named exports, and JSDoc on all public functions. Use PascalCase for React components (`DetailView.tsx`), camelCase for functions and variables, and kebab-case for resource names (skills, agents, bundles, MCPs). Keep command modules focused and place filesystem or platform-specific logic in `src/core/`. All errors must be caught as `unknown` with `instanceof Error` type guards — never use `catch (e: any)`.

## Testing Guidelines
Tests use Node.js built-in test runner (`node:test`). The test runner (`tests/run.mjs`) compiles TypeScript to `.test-dist/`, then runs all `*.test.mjs` files. Fixtures live in `tests/fixtures/` and communicate results as JSON via stdout.

To add tests: create a fixture in `tests/fixtures/` that imports from the compiled build (`process.env.TEST_BUILD_DIR`), runs assertions, and outputs JSON. Then add a `test()` call in the appropriate `tests/*.test.mjs` file that calls `runFixture()` and asserts on the JSON output. Run `npm test` to validate.

## Commit & Pull Request Guidelines
Use short, imperative commit subjects that describe behavior, not implementation. Keep commits scoped to one logical change. PRs should use the template in `.github/PULL_REQUEST_TEMPLATE.md` — include a summary, test plan with checkboxes, and link issues when relevant.

## Security
All external resources are scanned before installation (see `src/core/scanner.ts`). Path segments are validated via `assertSafePathSegment()`. Never use `shell: true` or `exec()` — use `spawnSync` with array arguments. See `SECURITY.md` for the full security policy.

## Contributor Notes
Check `CONTRIBUTING.md` before adding skills, agents, bundles, or MCP definitions. If you change repository resources or generated catalog inputs, regenerate the catalog before opening a PR.
