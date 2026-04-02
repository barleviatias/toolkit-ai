# Phase 4: Visual Verification with Browser Automation

Verify the implementation against the Figma design in a real browser. Requires Browser MCP (Playwright or Chrome DevTools) and a running dev server.

Use the tool mapping from the Agent Compatibility table in SKILL.md to call the correct tool for your environment.

## Step 1 — Collect App Details

Ask the user for connection details. Read `.env` for hints:

| Question | Default / Hint |
|----------|----------------|
| App URL | Read port from `.env` -> suggest `http://localhost:{PORT}` |
| Username | Read `LOGIN_USERNAME` from `.env` if available |
| Password | Read `LOGIN_PASSWORD` from `.env` if available |
| Target route | Route where the component renders (e.g. `/dashboard`) |
| Login required? | Yes / No |

**Always confirm with the user** — never assume credentials or routes.

## Step 2 — Pre-flight Check

1. **Navigate** to the app URL
2. If navigation fails, **stop and tell the user** to start the dev server
3. **Take a DOM snapshot** to confirm page loaded

## Step 3 — Authenticate (if needed)

1. Navigate to login page
2. **Take a DOM snapshot** to find form element refs
3. **Fill the form** with credentials
4. **Click** submit
5. **Wait** for navigation/content change confirming login succeeded
6. If login fails, **stop and report** — don't proceed

## Step 4 — Navigate to Component

1. **Navigate** to target route
2. **Wait** for component content to render
3. **Resize** viewport to match Figma frame dimensions
4. **Take a DOM snapshot** to verify component is present

## Step 5 — Capture Screenshots

**Implementation:**
Take a screenshot of the current page (not full-page — just the viewport matching Figma dimensions).

**Figma design:**
Use the Figma screenshot tool to get the original design node.

## Step 6 — Compare and Report

Present a structured visual comparison. Do NOT attempt automated pixel diff — provide a manual side-by-side review:

```markdown
## Visual Verification Report

### Discrepancies Found

| Area | Figma | Implementation | Fix Suggestion |
|------|-------|----------------|----------------|
| Card padding | 16px | 12px | Update Container padding to `spacing.md` |
| Title color | #264769 | #333333 | Use `textPrimary` token |
| Button radius | 8px | 4px | Match DS Button borderRadius |

### Matching Correctly

- Layout structure (flex column)
- Font family and weights
- Icon sizes and alignment
```

Provide **actionable fix suggestions** referencing DS tokens and component props — not just "it's different".

## Step 7 — Cleanup

Close the browser page.
