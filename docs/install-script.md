# `installScript` — design spec

**Status:** Draft
**Author:** @barleviatias
**Target:** toolkit-ai 2.2.x
**Related:** [ROADMAP.md](../ROADMAP.md), [SECURITY.md](../SECURITY.md)

---

## Motivation

toolkit-ai today installs five static resource types: `skill`, `agent`, `mcp`, `bundle`, `command`. Several real-world frameworks (Radware AMS being the first concrete case) ship through a **single existing shell installer** that does work toolkit-ai cannot yet express natively:

- Merging script-driven JSON into `~/.claude/settings.json` (hooks)
- Registering a Copilot CLI plugin via `copilot plugin install <path>`
- Rewriting frontmatter when transforming a canonical command file into per-tool shapes (Claude `.md`, Copilot plugin `.md`, VSCode `${input:topic:hint}` prompt files)
- Stack detection, license-header policy, multi-tool dispatch in one go

Building each of those as a first-class resource type is the right *long-term* answer — and the [roadmap](../ROADMAP.md) tracks it. In the short term, those frameworks have working installers today. Forcing them to wait for toolkit-ai's native primitives blocks discovery, lockfile, update, and removal benefits that toolkit-ai already provides for skills/agents/MCPs.

`installScript` is a deliberate **escape hatch**: toolkit-ai becomes the discovery + consent + execution surface for a framework's existing installer, while the rest of the toolkit-ai contract (lockfile, source-trust, scanner, update, remove) still applies as much as it can.

It is **not** a replacement for native resource types. New frameworks should use native types where they exist. `installScript` is documented as a legacy/transition path with an explicit policy to migrate off when native types catch up (see [Compatibility & migration policy](#compatibility--migration-policy)).

## Non-goals

- **Lockfile-level idempotency.** toolkit-ai records that the script ran. It does not track each individual file the script writes; the script is responsible for its own idempotency.
- **Sandboxing.** The script runs with the user's privileges. toolkit-ai does not chroot, dropPriv, or otherwise isolate it.
- **Generic post-install steps for other resource types.** `installScript` is its own action on a bundle, not a hook into existing resource installers. Native resource types do not gain a `postInstall:` field as part of this work.
- **Arbitrary curl-to-bash.** The script must be a file in a source repo that toolkit-ai already trusts and clones, not a URL fetched at install time.

---

## Bundle field shape

### TypeScript

```ts
// src/types.ts

export type Platform = 'darwin' | 'linux' | 'win32';

export interface InstallScriptSpec {
  /** Path to the script, relative to the source repo root. */
  src: string;

  /** Path to the uninstall script, relative to the source repo root. Required. */
  uninstall: string;

  /** Arguments passed to the script. Default: []. */
  args?: string[];

  /** Environment variables set when running the script. Merged on top of process.env. */
  env?: Record<string, string>;

  /**
   * Allowlist of platforms where this script is supported. Required.
   * Installs on other platforms surface a "not supported on this platform" message
   * and exit cleanly without running.
   */
  platforms: Platform[];

  /**
   * Declared output paths the script touches. Required, informational.
   * Shown in the consent dialog so users can preview the blast radius.
   * Not enforced — the script can write anywhere — but a mismatch with
   * actual writes is grounds for rejecting the source from `trusted` tier.
   */
  writes: string[];

  /**
   * Interpreter to invoke. Default inferred from extension:
   *   .sh → 'sh'   (or 'bash' if the first line is `#!/bin/bash`)
   *   .ps1 → 'pwsh'
   *   .mjs / .js → 'node'
   */
  interpreter?: 'bash' | 'sh' | 'pwsh' | 'node';

  /** Hard cap on script runtime, seconds. Default: 120. */
  timeoutSec?: number;
}

export interface BundleConfig {
  name: string;
  description: string;
  version?: string;
  skills?: string[];
  agents?: string[];
  mcps?: string[];
  commands?: string[];
  installScript?: InstallScriptSpec;   // new
}
```

### YAML example (the Radware AMS case)

```yaml
name: radware-ams
description: Radware Agentic Methodology System
version: 0.4.0

installScript:
  src: tools/install-global.sh
  uninstall: tools/uninstall-global.sh
  args: ['--non-interactive']
  platforms: [darwin, linux]
  writes:
    - ~/.ams/
    - ~/.claude/commands/
    - ~/.claude/settings.json     # JSON-merge of hook config
    - ~/.copilot/agents/
    - ~/.copilot/skills/
    - ~/.copilot/installed-plugins/_direct/ams-agentic/
    - ~/Library/Application Support/Code/User/prompts/
  timeoutSec: 180
```

The bundle may *also* declare `skills`/`agents`/`commands`/`mcps` natively — `installScript` is additive. AMS will likely keep its skills/agents installed natively via toolkit-ai (cleaner uninstall, scanner coverage) and only use `installScript` for the parts toolkit-ai cannot yet express (hooks, Copilot plugin registration, VSCode prompt transforms). When the user installs the bundle, native resources install first, then the script runs.

---

## Source-repo convention

A source repo declares its bundle in the existing toolkit-ai location (`bundle.json` / `bundle.yaml` at the resource root). The `installScript` field references files relative to the source repo root, not relative to the bundle file.

The script and its uninstall counterpart must exist at the declared paths at clone time. toolkit-ai validates this during source refresh; missing files mark the bundle as `broken` and exclude it from install.

---

## Trust model

### Hard requirement: trusted source

A source must be marked `allowInstallScript: true` in `settings.json` (toolkit-ai's config) before any bundle from that source can run an `installScript`. The default is `false`. Two ways to opt in:

1. **Per-source flag at add time**:
   ```bash
   toolkit source add bitbucket.org/rdwr/ams-agentic --allow-scripts
   ```
2. **Settings tab toggle** in the TUI: `Sources → <name> → Allow install scripts`.

If a bundle declares `installScript` and the source is *not* allow-scripts-enabled, the bundle still surfaces in the TUI/CLI but is marked **`install-script blocked`** with a one-liner explaining the gate. `toolkit-ai install <bundle>` exits with code 2 and the message:

```
Bundle 'radware-ams' requires installScript permission.
Source 'bitbucket.org/rdwr/ams-agentic' has not been granted that permission.
Run: toolkit source trust bitbucket.org/rdwr/ams-agentic --allow-scripts
```

When the trusted-source-tiers feature lands (currently roadmap "dreams"), the per-source flag becomes a derivative of source tier — `installScript` is allowed by default on `verified` sources, requires explicit opt-in on `trusted`, and is hard-blocked on `unverified`. Until then, the per-source flag is the only gate.

### Strict scanner mode

`installScript` runs the existing `scanner.ts` rules over the script and uninstall script. Findings of severity `block` cause the install to fail with no override. There is no `--force` for this. The rationale: a `block`-severity finding (curl-to-shell, reverse shell, encoded PowerShell, base64 eval, etc.) on a script that's about to execute is a fundamentally different risk profile than the same finding on a skill markdown file — there is no human review step between "scanner blocks" and "code runs."

`warn`-severity findings are shown in the consent dialog but do not block install.

### Mandatory uninstall

`installScript.uninstall` is required. A bundle without an uninstall script is rejected at bundle-load time. Frameworks that genuinely cannot uninstall (rare) must document that and ship a no-op uninstall script that prints a warning.

### Platform allowlist

`platforms` is required and must list every platform where the script is intended to run. Installs on platforms outside the list fail with:

```
Bundle 'radware-ams' is not supported on win32 (declared: darwin, linux).
```

This prevents bash-only installers from being attempted on Windows under WSL detection edge cases.

### Distinct consent UX

The consent dialog for `installScript` is visually distinct from the native-resource consent dialog. See [Consent UX](#consent-ux) below.

---

## Install flow

```
1. User runs: toolkit-ai install <bundle>
2. toolkit-ai loads the bundle from cached source.
3. If bundle has installScript:
   a. Check source.allowInstallScript. If false → reject (exit 2).
   b. Check current platform against installScript.platforms. If mismatch → skip with notice.
   c. Run scanner.ts on installScript.src and installScript.uninstall.
      If any block-severity finding → reject (exit 3).
   d. Show consent dialog (see below). Require explicit user "Yes, run script".
4. Install any native resources declared in the bundle (skills, agents, etc.) first.
   These follow existing install semantics; lockfile entries created as usual.
5. Execute installScript.src with declared args/env/interpreter under the timeout.
   stdout/stderr stream into a log buffer; full log written to:
     ~/.config/toolkit-ai/logs/install/<bundle>-<timestamp>.log
6. On exit-0:
   a. Compute hash of installScript.src and installScript.uninstall.
   b. Write lockfile entry (see schema below).
   c. Print success summary with log path.
7. On non-zero exit, timeout, or signal:
   a. Native resources installed in step 4 remain installed (no automatic rollback —
      the script likely modified state in non-reversible ways before failing).
   b. Print failure with exit code, last 40 log lines, and the full log path.
   c. Do not write the lockfile entry. The bundle is marked "install failed".
```

### Update flow

```
1. toolkit-ai check / update detects the source repo has changed.
2. Re-clone, re-load the bundle.
3. If installScript.src or installScript.uninstall hash differs from lockfile:
   a. Run scanner on the new versions (strict).
   b. Show update consent dialog: diff of script changes (or "Script changed,
      8 lines added, 3 removed" with the option to view full diff in $PAGER).
   c. On approval, execute the new installScript.src (same flow as install).
4. If only native resource hashes changed, run their updaters as usual.
   installScript is not re-executed when only native resources changed.
```

### Uninstall flow

```
1. toolkit-ai remove <bundle>
2. If bundle's lockfile entry includes installScript:
   a. Run scanner on installScript.uninstall (strict).
   b. Show consent dialog with the uninstall script's writes (declared in spec).
   c. Execute installScript.uninstall.
3. Remove native resources (skills/agents/etc.) per their own removers.
4. Delete lockfile entry on success.
```

If the uninstall script fails, the lockfile entry remains and the bundle is marked `uninstall failed` so the user can re-run after fixing.

---

## Lockfile schema

Extend the existing `LockEntry` shape:

```ts
export interface InstallScriptLockEntry {
  hash: string;                // sha256 of installScript.src contents
  uninstallHash: string;       // sha256 of installScript.uninstall contents
  installedAt: string;         // ISO-8601
  args: string[];              // what we ran with
  platform: Platform;
  declaredWrites: string[];    // snapshot of writes[] at install time
  scannerReport: string;       // path to saved scanner report
  exitCode: 0;                 // only successful installs are recorded
  logPath: string;             // path to the install log
}

export interface LockEntry {
  hash: string;
  installedAt: string;
  items?: Record<string, LockEntry>;
  installScript?: InstallScriptLockEntry;   // new
}
```

`toolkit-ai list` shows install-script bundles with a `[script]` tag so they're visually distinct from native-resource-only bundles.

---

## Consent UX

The consent dialog for an `installScript` install differs from the native-resource dialog in three ways: it shows a **script** (not a path list), it includes the **scanner report inline** (not a link), and it has a **secondary confirmation** (the user types `run` rather than pressing Enter).

### Wireframe — install consent

```
╭──────────────────────────────────────────────────────────────────────────────╮
│  ⚠  Install script — radware-ams                                             │
│                                                                              │
│  Source:    bitbucket.org/rdwr/ams-agentic       [trusted: yes]              │
│  Bundle:    radware-ams 0.4.0                                                │
│  Script:    tools/install-global.sh   (412 lines, 14.2 KB)                   │
│  Runtime:   bash, 180s timeout                                               │
│                                                                              │
│  This bundle runs a shell script on your machine. The script can write       │
│  to any file the current user can write to. toolkit-ai will not isolate      │
│  it.                                                                         │
│                                                                              │
│  Declared writes:                                                            │
│    • ~/.ams/                                                                 │
│    • ~/.claude/commands/                                                     │
│    • ~/.claude/settings.json   (JSON merge)                                  │
│    • ~/.copilot/agents/                                                      │
│    • ~/.copilot/skills/                                                      │
│    • ~/.copilot/installed-plugins/_direct/ams-agentic/                       │
│    • ~/Library/Application Support/Code/User/prompts/                        │
│                                                                              │
│  Scanner report:                                                             │
│    ✓ no block-severity findings                                              │
│    ⚠ 1 warning: line 312 uses `command -v copilot` (informational)           │
│                                                                              │
│  [v] view script        [d] view scanner report        [c] cancel            │
│                                                                              │
│  To proceed, type: run                                                       │
│  > _                                                                         │
╰──────────────────────────────────────────────────────────────────────────────╯
```

### Wireframe — update consent

When the script changes between installs, the dialog shows a unified diff in the body and the same `type run to proceed` confirmation.

```
╭──────────────────────────────────────────────────────────────────────────────╮
│  ⚠  Install script changed — radware-ams                                     │
│                                                                              │
│  Source:    bitbucket.org/rdwr/ams-agentic                                   │
│  Bundle:    radware-ams 0.3.0 → 0.4.0                                        │
│  Script:    tools/install-global.sh   (diff: +18 / -4 lines)                 │
│                                                                              │
│  --- tools/install-global.sh (installed 2026-04-12)                          │
│  +++ tools/install-global.sh (incoming)                                      │
│  @@ -287,6 +287,18 @@                                                        │
│  -  copilot plugin install "$AMS_ROOT" >/dev/null 2>&1                       │
│  +  if [ -d "$PLUGIN_CACHE" ]; then                                          │
│  +    copilot plugin update radware-ams >/dev/null 2>&1                      │
│  +  else                                                                     │
│  +    copilot plugin install "$AMS_ROOT" >/dev/null 2>&1                     │
│  +  fi                                                                       │
│  ... 13 more lines                                                           │
│                                                                              │
│  Scanner report:                                                             │
│    ✓ no block-severity findings                                              │
│                                                                              │
│  [V] view full diff   [d] view scanner report   [k] keep current   [c] cancel│
│                                                                              │
│  To proceed, type: run                                                       │
│  > _                                                                         │
╰──────────────────────────────────────────────────────────────────────────────╯
```

### Headless mode

`toolkit-ai --yes install <bundle>` skips the consent dialog **only if** the source has been granted `--allow-scripts` *and* an additional `--accept-install-script` flag is passed (or `settings.installScript.allowHeadless: true`). The script's bash content is logged before execution. The double-gate is intentional: a single `--yes` should never cause arbitrary code to run on the user's machine in a CI context.

---

## Failure modes

| Failure | Behavior |
|---|---|
| Source not allow-scripts | Exit 2 with instructions to opt in |
| Platform not in `platforms` allowlist | Exit 0 with "skipped, unsupported platform" |
| Scanner finds block-severity rule | Exit 3 with scanner report; no override |
| Script missing in source repo | Bundle marked `broken` at source-refresh time; not installable |
| Uninstall script missing | Same as above |
| Script exits non-zero | Exit 4 with last 40 log lines + full log path; lockfile not written; bundle marked `install failed` |
| Script exceeds `timeoutSec` | Kill SIGTERM → 5s grace → SIGKILL; treat as non-zero exit |
| Script writes outside `writes` allowlist | Not enforced at runtime. Surface as a warning post-install if we detect it (best-effort via fs watcher on declared paths' parents — phase 2). |
| Uninstall fails | Lockfile retained; bundle marked `uninstall failed`; user re-runs `remove` after fixing |

---

## CLI surface

New / changed commands:

```bash
# Source-level trust toggle
toolkit source add <repo> [--allow-scripts]
toolkit source trust <name> --allow-scripts        # toggle on
toolkit source trust <name> --no-allow-scripts     # toggle off

# Headless gating
toolkit --yes install <bundle>                     # rejects installScript bundles
toolkit --yes --accept-install-script install <bundle>   # explicit consent

# Inspection
toolkit show <bundle>                              # shows installScript section if present
toolkit list                                       # bundles with installScript marked [script]
```

`settings.json` additions:

```jsonc
{
  "sources": {
    "bitbucket.org/rdwr/ams-agentic": {
      "allowInstallScript": true
    }
  },
  "installScript": {
    "allowHeadless": false,
    "defaultTimeoutSec": 120
  }
}
```

---

## Compatibility & migration policy

`installScript` is documented in [ROADMAP.md](../ROADMAP.md) under the heading **"Legacy bridge — install scripts."** The policy:

- Existing frameworks with working installers may use `installScript` to onboard without rewriting.
- New frameworks should prefer native resource types. Code review on bundle PRs should push back on `installScript` use when the work could be expressed natively.
- Each `installScript` bundle is expected to have a **migration plan** in its README: "We use `installScript` today because toolkit-ai does not yet support X. When X lands, we will move to native resources."
- At the 6-month mark from the first `installScript` shipping, review usage. If most users have migrated to native types, deprecate the field on a 6-month timer.

---

## Open questions

1. **Should `writes` enforcement be runtime or post-hoc?** Runtime (intercepting writes) is intrusive and incomplete (script can spawn subprocesses). Post-hoc fs-watching declared paths' parents catches most drift cheaply. Spec proposes post-hoc, phase 2.
2. **Do we need a `preInstall` script in addition to `installScript`?** Some frameworks need to detect prerequisites (jq, node) before the main installer. For now, the main script handles its own preflight; revisit if a real case appears.
3. **Should native resources install before or after the script?** Spec proposes **before** so the script can read installed-state if needed. The opposite order is defensible (script provides the framework, then resources land on top). Revisit after first real consumer.
4. **Per-bundle script log retention.** Spec keeps one log per install/update under `~/.config/toolkit-ai/logs/install/`. Retention policy: keep N most recent per bundle? Cap total size? Both?
5. **Diff rendering in the update dialog.** For long diffs the inline preview is unreadable. Spec uses a 20-line peek + `[V] view full diff`. Worth UX-testing.

---

## Test plan

Unit:
- Scanner integration: a script with `curl | sh` → install rejected (exit 3).
- Platform allowlist: install on `win32` with `platforms: [darwin, linux]` → skipped with notice, exit 0.
- Hash drift detection: change one byte in the script, `toolkit check` flags update available.
- Headless mode: `--yes` without `--accept-install-script` rejects installScript bundles.
- Lockfile entry shape matches schema.

Integration:
- Full install/update/remove cycle against a fixture bundle that ships a noop `install.sh` writing a sentinel file under `$TMPDIR`. Verify sentinel exists post-install, gone post-remove.
- Real bundle: `radware-ams` (`bitbucket.org/rdwr/ams-agentic`) — install on macOS, verify `~/.ams/` and `~/.claude/settings.json` populated, then `toolkit remove radware-ams` and verify cleanup.

Security:
- Fixture bundle with intentional block-severity finding (`base64 -d | bash` in script) — verify rejected with no override path.
- Fixture bundle with untrusted source (`allowInstallScript: false`) — verify rejected with clear remediation.
- Path-traversal in `installScript.src` (e.g. `../../etc/something`) — verify rejected at bundle-load.

---

## Out of scope (this RFC)

- Hooks as a first-class resource type (separate roadmap item; `installScript` is the bridge until hooks ship).
- Per-tool command transform adapter (separate roadmap item).
- Copilot CLI plugin registration as a native action (separate roadmap item).
- Trusted-source tiers (separate roadmap item; `installScript` uses the per-source `allowInstallScript` flag until tiers exist).
- Cross-platform install scripts written in Node/PowerShell — `interpreter` field is defined, but the first release ships bash/sh support only; pwsh/node land in a follow-up once a real consumer needs them.
