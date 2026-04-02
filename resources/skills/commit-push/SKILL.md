---
name: commit-push
description: Use when you need to quickly review, commit, and push staged changes without pre-push verification, typically for minor fixes or documentation updates
---

# Commit Push

## Overview

A streamlined workflow for reviewing staged changes, creating a descriptive commit, and pushing with bypassed pre-push hooks. Most useful for small changes that don't require full CI validation.

## When to Use

**Use when:**

- You have staged changes ready to commit
- Changes are minor (documentation, comments, formatting)
- You want to bypass pre-push hooks (linting, tests)
- Working on feature branches where CI will run on PR
- Need quick iteration cycle

**Don't use when:**

- Changes affect critical functionality
- Working on main/master branch
- Pre-push hooks are essential for your workflow
- Changes require full test validation

## Core Pattern

```bash
# 1. Review what's staged
git status
git diff --cached

# 2. Run code review agent (quality check)
# Use code-reviewer agent with staged changes context

# 3. Commit with descriptive message
git commit -m "Descriptive commit message"

# 4. Push bypassing hooks
git push --no-verify
```

## Quick Reference

| Command                         | Purpose                     |
| ------------------------------- | --------------------------- |
| `get_changed_files(["staged"])` | Review staged changes       |
| `runSubagent("code-reviewer")`  | Run code review agent       |
| `git commit -m "message"`       | Commit with message         |
| `git push --no-verify`          | Push without pre-push hooks |

## Implementation

### Step 1: Review Staged Changes

Always review what you're about to commit:

```typescript
// Use get_changed_files to see staged changes
get_changed_files({
  sourceControlState: ['staged'],
});
```

### Step 2: Run Code Review Agent

Always run code review before committing to catch issues:

```typescript
// Use code-reviewer agent with proper context
runSubagent({
  agentName: 'code-reviewer',
  description: 'Review staged changes',
  prompt: `Review the staged changes for production readiness.

**What Was Implemented:**
[Brief description of changes - e.g., "Removed obsolete comments from UpdateSubscriptions component"]

**Requirements:**
Minor code cleanup / documentation update / bug fix [as applicable]

**Changes to Review:**
Use get_changed_files with sourceControlState: ["staged"] to see the staged changes.

**Review Focus:**
- Code quality and best practices
- Potential bugs or issues
- Architecture alignment
- Testing coverage (if applicable)

Provide a quick assessment suitable for ${changeType} changes:
- Critical issues (must fix)
- Important issues (should fix)
- Ready to commit verdict
`,
});
```

### Step 3: Create Descriptive Commit

Write clear, actionable commit messages:

```bash
# ✅ Good: Describes what changed
git commit -m "Remove obsolete comment from UpdateSubscriptions component"
git commit -m "Fix typo in user dashboard header"
git commit -m "Update README installation instructions"

# ❌ Bad: Vague or generic
git commit -m "fix"
git commit -m "updates"
git commit -m "changes"
```

### Step 4: Push Without Verification

Use `--no-verify` to skip pre-push hooks:

```bash
git push --no-verify
```

## Common Mistakes

| Mistake                     | Fix                                                            |
| --------------------------- | -------------------------------------------------------------- |
| Not reviewing changes first | Always check `git status` and `git diff --cached`              |
| Skipping code review step   | Always run code-reviewer agent before committing               |
| Vague commit messages       | Use descriptive action words: "Remove", "Fix", "Add", "Update" |
| Using on critical code      | Reserve for minor changes only                                 |
| Forgetting `--no-verify`    | Add explicitly to bypass hooks                                 |
| Insufficient review context | Provide clear description of changes to code-reviewer agent    |

## Workflow Integration

This skill works well with:

- Feature branch development
- Documentation updates
- Code review feedback implementation
- Rapid prototyping cycles

**Safety note:** Always ensure your team's workflow allows bypassing pre-push hooks for the type of changes you're committing.
