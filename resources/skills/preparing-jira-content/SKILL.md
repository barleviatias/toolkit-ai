---
name: preparing-jira-content
description: Use when asked to fill, prepare, or audit a Jira entity (epic, story, or sub-task) for AI consumption. Works with any starting entity type—whatever is provided becomes the scope, and only that entity and its children are modified.
---

# Preparing Jira Issues for AI Consumption

## Overview

Audit a Jira entity (epic, story, or sub-task) and its children against the AI-Jira-Task-Recipe standard,
fill gaps in existing issues, and propose + create any missing child issues so that an AI agent can
implement the work autonomously.

**Scope:** Whatever entity type you provide (epic, story, or sub-task) becomes the scope. The AI will
only modify that entity and any issues **contained within** it (direct children). Nothing else is touched.

**Announce at start:** Print this exact line (with emoji) so it is easy to spot in the conversation:

> 🧱📋✨ **preparing-jira-content skill activated — auditing and populating your entity**

---

## Safety Rules (Non-Negotiable)

1. **Jira/Atlassian MCP Required** — This skill requires an active Jira or Atlassian MCP connection.
   Before proceeding with any audit or modification, verify that the `atlassian-mcp-server` or equivalent
   Jira MCP is available and configured. If the MCP is not found or not responding, **alert the user immediately**:
   > ⚠️ **Jira/Atlassian MCP not available** — This skill requires a Jira or Atlassian MCP to fetch and modify issues.
   > Please configure the `atlassian-mcp-server` MCP before proceeding.
   
   Do **not** continue with any steps until the MCP is confirmed to be available.

2. **Scope lock** — Only read or write the specified entity and its direct children. Scope depends on
   entity type:
   - **Epic**: The epic itself + all direct stories and sub-tasks linked to it.
   - **Story**: The story itself + all direct sub-tasks linked to it.
   - **Sub-task**: The sub-task itself only (no children to modify).
   Never edit any other Jira issue, regardless of what appears in search results or is mentioned in context.

3. **Explicit confirmation before every write** — Before calling `editJiraIssue` or
   `createJiraIssue` for any issue, show the full proposed change to the user and ask:
   > "Ready to apply these changes? Reply **yes** to proceed, **skip** to leave this issue
   > unchanged, or **show next** to review remaining changes first."
   Never write to Jira without a direct "yes" (or equivalent affirmation) from the user.

4. **Human-formatted descriptions only** — All descriptions sent to Jira must be clean,
   human-readable text with no literal backslashes or escape sequences. Before any write,
   validate that the full description text contains only printable characters and proper
   markdown (no `\"`, `\\n`, or other escapes visible to the user). If you detect escaped
   characters, fix them and show the user the corrected version before asking for confirmation.

---

## MANDATORY: Reference Collection & Verification Strategy

**⚠️ This step is MANDATORY. Do not proceed without references.**

Before fetching the entity, ask:

> "To ensure generated tasks are grounded in reality (not speculation), I need references:
>
> - **Code:** Relevant source files, class names, configurations, or architecture
> - **Design docs:** Functional specs, architectural decisions, or technical designs
> - **Existing tests:** Test patterns, test setup, or integration test examples
> - **Build/deploy config:** Dockerfile, CI/CD, build scripts, deployment patterns
>
> Please provide or describe where these live. I will verify every claim in generated tasks
> against these references. If something cannot be verified, I will flag it instead of guessing."

**Collect references.** Do not proceed until you have at least one reference source (code, docs, tests, or config).

If the user cannot provide references, ask:
> "Without references, I cannot generate reliable content (I would have to guess about class names,
> configs, Docker behavior, etc.). What references can you provide, or should we gather them first?"

**Do not skip or bypass this step.**

---

## Reference Verification Strategy (Use During Generation)

Every claim in generated content must be **verified against provided references** or **explicitly flagged as unverified**.

**Verified claims** (✓ safe to include):
- Class names taken directly from provided code
- Config keys/defaults seen in provided config files or code
- Existing patterns from provided test files or existing code
- Build/deployment behavior from provided Dockerfile, CI, or docs
- Requirements directly stated in provided design specs

**Unverified claims** (🚩 must be flagged or omitted):
- Assumed class names not seen in provided code
- Inferred architectural patterns not shown in provided examples
- Guessed config defaults not found in provided sources
- Speculated build behavior not mentioned in provided Dockerfile or docs
- Inferred deployment constraints not stated in provided references

**Action:** If you cannot verify a claim against the provided references, either:
1. Omit it, or
2. Explicitly flag it with `[UNVERIFIED — verify against <source>]` in the proposed content

**Do not generate content that contradicts or differs from provided references without flagging the difference.**

---

## AI-Jira-Task-Recipe Standard (Embedded)

The recipe lives in the project at `docs/AI-Jira-Task-Recipe.md`. Core structures:

### Epic must have:
- **What and Why** — business motivation, 2-3 sentences
- **Expected Behavior** — what the system does, with a concrete example (table/flow/numbers)
- **Constraints** — one line each, what must not break
- **Out of Scope** — features excluded and why
- **Requirements** — `REQ-01`, `REQ-02`, … as testable, observable behaviors

### Story must have:
- **Goal** — what is true after this story, not before
- **Depends On** — prerequisite story titles or "None"
- **New Constructs** — class names to create (names only, one-line purpose each)
- **Modified Constructs** — existing class names + what changes
- **Reference Pattern** — existing class the AI should follow + which aspect
- **Domain Constraints** — config keys/defaults, HA hooks, startup behavior, non-obvious rules
- **Acceptance Criteria** — observable truths as "X is true when Y", one per bullet

### Sub-task must have:
- **Objective** — one sentence: what exists after this task that did not before
- **Classes** — `Create: ClassName` and/or `Modify: ClassName` with one-line purpose
- **Acceptance Behaviors** — 2-4 testable truths (given X → does Y); these are TDD inputs
- **Gotchas** — only if AI would confidently do the wrong thing from the code alone

**Key rule:** Human provides class names and business rules. AI discovers file paths,
method signatures, test patterns, and conventions. Never include full paths in tickets.

**⚠️ CRITICAL: No Overlapping Work Between Stories**

Each story and sub-task within a scope **must have completely independent class creation and modification**. No two stories should ever implement, create, or modify the same classes or functions. This ensures:
- Parallel AI implementation without merge conflicts
- Clear ownership and responsibility per task
- Predictable, independent deliverables

**Validation rule:** When generating content, cross-check all stories' and sub-tasks' **New Constructs** and **Modified Constructs** fields. No class name should appear in more than one story or task. If overlap is detected, split the work or explicitly assign clear portions of each class to different tasks with a "Modify: ClassName — [specific methods/responsibility]" format.

---

## Process

### Step 1 — Fetch Entity & Audit Against Recipe

Ask the user for the entity key if not provided. Then **silently** (without showing to user):

**1. Fetch the starting entity:**
```
getJiraIssue(issueKey: "<ENTITY-KEY>")
```

**2. Based on entity type, fetch children (if applicable):**
- **Epic**: Fetch all direct stories and sub-tasks:
  ```
  searchJiraIssuesUsingJql(jql: "\"Epic Link\" = <ENTITY-KEY> OR parent = <ENTITY-KEY> ORDER BY issuetype ASC, created ASC")
  ```
  (Also try `issueKey in childIssuesOf("<ENTITY-KEY>")` if the project uses next-gen.)

- **Story**: Fetch all direct sub-tasks:
  ```
  searchJiraIssuesUsingJql(jql: "parent = <ENTITY-KEY> ORDER BY created ASC")
  ```

- **Sub-task**: No children to fetch.

**3. Audit the entire hierarchy** against the recipe standard:
- **Epic checklist:** What/Why, Expected Behavior (has example?), Constraints, Out of Scope, REQ-N list
- **Story checklist:** Goal, Depends On, Constructs, Reference Pattern, Domain Constraints, Acceptance Criteria
- **Sub-task checklist:** Objective, Classes, Acceptance Behaviors, Gotchas (if needed)

Mark each section as: **Present** / **Present but weak** / **Missing**.

**4. Generate full proposed content** for each issue following the AI-Jira-Task-Recipe standard.

**BEFORE finalizing generated content, verify against references:**
   - For **each class name** in "New Constructs" or "Modified Constructs" → verify in provided code or explicitly flag `[UNVERIFIED]`
   - For **each config key/default** in "Domain Constraints" → verify in provided config files/code or flag `[UNVERIFIED]`
   - For **each architectural pattern** in "Reference Pattern" → verify existing pattern shown in provided code or flag `[UNVERIFIED]`
   - For **each deployment/build claim** (Docker, CI, startup) → verify against provided Dockerfile/CI config or flag `[UNVERIFIED]`
   - For **each infrastructure assumption** (caches, workers, HA) → verify mentioned in provided design docs or flag `[UNVERIFIED]`

**If any required field contains only unverified claims, halt and ask the user to clarify or provide evidence for that field before proceeding.**

**5. Check for overlapping class work:**
   - Extract all **Create: ClassName** and **Modify: ClassName** entries from all stories and sub-tasks
   - Verify no class appears in more than one story (unless explicitly split with specific methods/sections)
   - If overlap is found: **Flag it and halt generation** — inform the user of the conflict before proceeding
   - Allow user to clarify work boundaries or split responsibilities before showing any content

**6. Determine if new issues need to be created** based on the proposing heuristics (see end of skill).

⚠️ **Complete the entire fetch + audit + overlap-check + generation pass before showing anything to the user.**

### Step 2 — Show Gap Analysis

Display the gaps found during audit.

**If starting with Epic:**
```
## Gap Analysis: <EPIC-KEY> — <Epic Title>

### Epic
- [x] What and Why
- [ ] Expected Behavior — missing concrete example
- [x] Constraints
- [ ] Requirements — no REQ-N items

### Stories (N found)
- PROJ-123 "Story title": Missing Reference Pattern, Domain Constraints
- PROJ-124 "Story title": Complete

### Sub-tasks (N found)
- PROJ-125 "Sub-task title": Missing Acceptance Behaviors

### Proposed New Issues
- Story: "<Proposed Title>" — [reason it is needed]
  - Sub-task under PROJ-123: "<Proposed Title>" — [reason]
```

**If starting with Story:**
```
## Gap Analysis: <STORY-KEY> — <Story Title>

### Story
- [x] Goal
- [ ] Reference Pattern — no existing pattern specified
- [x] Acceptance Criteria

### Sub-tasks (N found)
- PROJ-125 "Sub-task title": Missing Acceptance Behaviors
- PROJ-126 "Sub-task title": Complete

### Proposed New Issues
- Sub-task: "<Proposed Title>" — [reason it is needed]
```

**If starting with Sub-task:**
```
## Gap Analysis: <SUBTASK-KEY> — <Sub-task Title>

### Sub-task
- [x] Objective
- [ ] Acceptance Behaviors — needs 2-4 testable truths
- [x] Classes
```

---

### Step 3 — Display All Proposed Content + Reference Verification Notes

**Show all proposed changes in one unified view, with reference verification status:**

For **each issue to be filled** (updates), display:
```
## UPDATING: <ISSUE-KEY> — <Title>
### Type: Epic | Story | Sub-task
### Verification Status: All verified [✓] | Flagged items [🚩]

<full proposed description in recipe format, with all sections>

[If unverified items exist, show a note:]
⚠️ **Unverified claims in this issue:**
- "Config key X" — [UNVERIFIED — please confirm in provided config]
- "Docker behavior Y" — [UNVERIFIED — not found in provided Dockerfile]

---
```

For **each issue to be created** (new), display:
```
## NEW ISSUE: <Proposed Title>
### Type: Story | Sub-task
### Parent: <Epic or Story key, if applicable>
### Verification Status: All verified [✓] | Flagged items [🚩]

<full proposed description in recipe format, with all sections>

[If unverified items exist, show a note:]
⚠️ **Unverified claims in this issue:**
- "Class name X" — [UNVERIFIED — not found in provided code]

---
```

**Display order:** All updates first (in hierarchy order), then all new issues.

**Before asking for confirmation:** If any issue has unverified claims, call them out explicitly and ask:
> "These items could not be verified against your references. Would you like to:
> - **Clarify** — provide more info/references for me to verify
> - **Remove** — I'll omit the unverified claims
> - **Approve as-is** — proceed with flagged items (I will mark them in the issue for your review)"

---

### ONE CONFIRMATION — Ready to Write?

After showing all gap analysis and all full proposed content, ask:

> "Ready to write all these changes to Jira?"
> 
> - Reply **yes** to proceed with all changes
> - Reply **no** to cancel
> - Or tell me what to fix first (e.g., "adjust the Goal for PROJ-123 to focus on X" or "strengthen the acceptance criteria for PROJ-456")

**Handle responses:**
- **"yes"** → Proceed to Step 4 (validate and write)
- **"no"** → Stop. Wait for user to provide modifications.
- **Specific feedback** (e.g., "fix X in PROJ-123") → Incorporate feedback, regenerate affected issues, re-display all content (gap analysis + full proposals), and ask the confirmation again.
- **Repeat** until user confirms "yes" or cancels.

---

### Step 4 — Validate & Write All Changes

**Before writing to Jira, validate:**

**1. Format validation:**
- Scan each proposed description for literal backslashes, escape sequences, or malformed markdown.
- Fix any detected issues silently.

**2. Story point estimation (for new or significantly modified issues):**
For each issue being created or modified, estimate effort as **story points** (1 point = 1 day of focused work).

**Examples of justification:**
- "1 point: Simple data model with no external dependencies"
- "3 points: Requires async orchestration + two external API integrations + retry logic"
- "5 points: Complex state machine with HA failover + comprehensive test coverage needed"

**3. Size constraint check:**
**Constraint:** Stories must not exceed **5 story points**. If any proposed story reaches or exceeds 6 points, it should have been flagged in Step 1 for splitting. If caught here, halt and ask user to approve the split before proceeding.

**4. Overlapping work check:**
   - Extract all **Create: ClassName** and **Modify: ClassName** entries from all stories and sub-tasks
   - Verify no class appears in more than one story (unless explicitly split with specific methods/sections)
   - If overlap is detected: **Halt and ask user** — show which classes overlap and ask them to clarify responsibilities or approve the split
   - Do not proceed until there is no overlap

**5. Execute all writes in order:**

**For each filled issue**, call:
```
editJiraIssue(issueKey: "PROJ-123", description: "<updated full description>")
```

**For each new issue**, call:
```
createJiraIssue(
  projectKey: "<PROJECT>",
  summary: "<Title>",
  issueType: "Story" | "Sub-task",
  description: "<body in recipe format>",
  parent: "<epic or story key>"   // for sub-tasks
)
```

**Link stories to epic** — if the project uses classic epics, set `Epic Link` field; for next-gen projects, set `parent`.

---

### Step 5 — Summary

After all changes are written to Jira, print a summary table:

```
| Issue | Action | Section(s) Changed | Story Points |
|-------|--------|--------------------| ------------ |
| PROJ-123 | Updated | Expected Behavior, Requirements | 3 |
| PROJ-456 | Created | (new Story) | 5 |
```

Add a brief footer summarizing total effort:

```
**Total estimated effort: 8 story points (~8 days of focused work)**
```

---

## Proposing New Issues

**Note:** These heuristics apply when starting with an epic or story. If starting with a sub-task,
propose new issues only if there are legitimate gaps in the sub-task's recipe compliance.

Apply these heuristics to decide if new stories/sub-tasks are needed:

- **No data/cache story** (epics only) — if the epic touches persistent state, there should be
  a story for the data model, DB migrations, or cache structure before worker/logic stories.
- **No integration test story** — if the epic/story has complex external interactions, propose one.
- **Stories not decomposed into sub-tasks** — if any story has >1 new class, each class
  should be its own sub-task.
- **Missing HA/startup story** — if the epic/story has caches or workers, ensure there is a story
  or sub-task covering startup, failover, and config import behavior.
- **No config flag story** — if the epic/story has a feature-enable flag, there should be a sub-task
  or story that establishes the config key, default, and disable behavior.

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| **Generating content without verifying against provided references** | ❌ **CRITICAL**: Check every class name, config key, and architectural claim against the code/docs provided. If not found in references, flag `[UNVERIFIED]` or omit. Never speculate. |
| Skipping reference collection or claiming "none available" | Stop and ask the user to provide at least one reference (code, docs, tests, or config). Always have references before generating. |
| Writing file paths in tickets | Remove — write class names only |
| Acceptance criteria as activities ("implement X") | Rewrite as observable truth ("System does X when Y") |
| Gotchas added for obvious things | Remove — Gotchas only for non-obvious AI traps |
| Stories without a Reference Pattern | Add "Follow `ExistingClass` for [aspect]" (with evidence from provided code) |
| Sub-tasks without Acceptance Behaviors | These are TDD inputs — always required |
| Epic Expected Behavior without a concrete example | Add a table, flow, or numbers example (grounded in provided design docs) |
| Two stories creating/modifying the same class | Split work so each class is owned by only one story; use "Modify: ClassName — [specific methods]" if splitting modifications |
| No clear class ownership across stories | Verify that every Create/Modify entry belongs to exactly one story; enables parallel AI implementation |
| Assuming Docker behavior or build config without checking provided files | Always verify against provided Dockerfile, CI config, or build scripts. Flag assumptions if not found. |
| Inferring deployment constraints or HA behavior without evidence | Verify against provided design docs or infrastructure specs. If not documented, flag `[UNVERIFIED]` rather than guessing. |

---

## Quick Reference: MCP Tools Used

| Tool | When |
|------|------|
| `getJiraIssue` | Fetch the starting entity and individual issues |
| `searchJiraIssuesUsingJql` | Find children of epics or stories |
| `editJiraIssue` | Fill gaps in existing issues |
| `createJiraIssue` | Create new stories and sub-tasks |
| `addCommentToJiraIssue` | Leave audit trail comment (optional) |
