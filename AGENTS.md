# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the application code for the CLI and Ink TUI. Use `src/commands/` for command entrypoints, `src/core/` for install/update/remove/catalog logic, `src/components/` for shared UI pieces, `src/tabs/` for top-level TUI screens, and `src/hooks/` for React hooks. Static data lives in `resources/`, and repo utilities such as catalog generation live in `scripts/`. Build output is written to `bin/ai-toolkit.mjs`; do not hand-edit generated files.

## Build, Test, and Development Commands
`npm install` installs dependencies. `npm run build` bundles the CLI with `tsup` into `bin/`. `npm run dev` runs `tsup --watch` for iterative development. `npm run generate:catalog` rebuilds catalog data from repository resources. `npm test` currently aliases to `npm run build`, so a passing build is the main validation gate.

## Coding Style & Naming Conventions
This repo uses TypeScript with `strict` mode and ES module syntax. Match the existing style: 2-space indentation is not used here; keep tabs/spaces consistent with the file, and prefer concise functions, explicit types, and named exports where practical. Use PascalCase for React components (`DetailView.tsx`), camelCase for functions and variables, and kebab-case for resource names such as skills, agents, bundles, and MCP definitions. Keep command modules focused and place filesystem or platform-specific logic in `src/core/`.

## Testing Guidelines
There is no dedicated test directory yet. For now, validate changes with `npm run build`, then exercise the affected CLI flow locally, such as `node bin/ai-toolkit.mjs` or the relevant headless command. When adding tests later, place them near the feature or in a clearly named `test/` directory and mirror the target module name.

## Commit & Pull Request Guidelines
Recent history favors short, imperative commit subjects like `Recover installed items from disk when lock file is missing` and `Remove legacy bundled catalog model`. Keep commits scoped to one change and describe behavior, not implementation trivia. PRs should include a concise summary, manual validation steps, linked issues when relevant, and terminal screenshots for TUI changes.

## Contributor Notes
Check `CONTRIBUTING.md` before adding skills, agents, bundles, or MCP definitions. If you change repository resources or generated catalog inputs, regenerate the catalog before opening a PR.
