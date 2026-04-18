# Roadmap

Post-launch work, grouped by impact. Not blocking the current release.

## Next up (UX polish)

- **Cold-start spinner.** `src/hooks/useCatalog.ts:27` runs `fetchExternalResources` synchronously in the `useState` initializer. First paint is blank for 5–30s on a fresh install while git clones. A progressive "Fetching sources (1/N)…" status would fix the worst first-impression issue in the tool.
- **`i`/`r`/`u` silent no-op.** `src/components/ItemList.tsx:72-81` does nothing if the action isn't applicable (already installed, no update available, etc.). Show a one-line hint instead ("already installed — press `r` to remove") so users don't think the tool broke.
- **`?` help overlay.** The StatusBar hint line lists 10+ bindings on one wrap-prone row. A dedicated help overlay on `?` would replace the cramped hints.
- **Refresh feedback.** `src/tabs/SourcesTab.tsx:55-63` sets "Refreshing…" then blocks synchronously — the message never paints. Defer with `setTimeout(0)` or an async flag.

## Performance

- **Parallel git clones.** `src/core/sources.ts:380-401` fetches sources serially in a `for` loop. `Promise.all` over async `spawn` would cut cold start by `N` × RTT.
- **Atomic `fetchSource`.** `sources.ts:118-121` deletes the cache dir *before* the new clone. If the network fails, the user loses their working cache. Clone to a temp dir, move on success.
- **`git fetch` instead of full re-clone** on TTL refresh. Current behavior re-clones from scratch every 24h even though nothing changed.
- **Batch lock reads in `updateAll`.** `src/core/updater.ts:113-192` reads the lock 6+ times per call. Read once, mutate, write once.

## Test coverage gaps

- **`updateAll` has zero dedicated tests.** Covered indirectly via `install-remove-recover`, but the bundle sub-item update logic and the "catalog item removed → uninstall from lock" path are untested.
- **Bundle install/remove has no fixtures.** `installBundle` / `installExternalBundle` / `removeBundle` and the `isItemProtected` transitive logic are not exercised.
- **`parseCodexMcpSection` round-trip** when adjacent unrelated sections exist — currently only the happy path is tested.

## Architecture

- **Split `src/core/installer.ts`** (520 lines, 5 concerns). Extract `renderCodexAgent` to `codex-agent.ts`, `writeMcpToConfigs` to `mcp-config-writer.ts`, bundle logic to `bundle-installer.ts`.
- **Deduplicate the four `scanSource*` functions** in `src/core/sources.ts:229-356` — they share a walk-parse-hash-sort pattern, ~130 lines.
- **Resource-handler registry.** Adding a 5th resource type (e.g. "prompts") today touches 8+ files. A handler registry (`{ skill: SkillHandler, agent: AgentHandler, ... }`) would keep new types to 1–2 files.

## Maybe someday

- **`toolkit doctor`** — diagnose lock ↔ filesystem ↔ MCP-config drift.
- **Private repo support** via `GITHUB_TOKEN`.
- **Offline mode** — use stale cache when `git clone` fails instead of returning empty.
