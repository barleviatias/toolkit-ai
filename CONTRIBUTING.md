# Contributing to the Agent Toolkit

## Adding a skill

1. Create `skills/<name>/SKILL.md` with required frontmatter:

```yaml
---
name: your-skill-name
description: >
  One to three sentences describing what this skill does and when to use it.
  This is what the agent reads to decide relevance — be specific.
---
```

2. Open a PR — CI will lint the frontmatter.

Optionally add a `references/` subdirectory for supplementary docs that the agent loads on demand.

---

## Adding an agent

1. Create `agents/<name>.agent.md` with `name` and `description` in frontmatter:

```yaml
---
name: your-agent-name
description: >
  What this agent does and when to use it.
tools:
  - read
  - write
---
```

2. Open a PR.

---

## Adding a bundle

1. Create `bundles/<name>.bundle.json` referencing only things that already exist in `resources`:

```json
{
  "name": "your-bundle",
  "description": "What this bundle provides",
  "skills": ["skill-one", "skill-two"],
  "agents": ["agent-one"],
  "mcps":   ["mcp-one"]
}
```

2. Optionally add to relevant teams in `teams.json`.
3. Open a PR — CI will validate all refs exist in catalog.

---

## Adding an MCP

1. Coordinate with infra to deploy the MCP server endpoint.
2. Create `mcps/<name>.json`:

```json
{
  "name": "your-mcp",
  "description": "What this MCP connects to",
  "type": "sse",
  "url": "https://mcp.your-org.internal/your-mcp",
  "setupNote": "After install, restart your agent and follow any prompts."
}
```

3. Reference it from a bundle if appropriate.
4. Open a PR.

---

## Updating a skill

Edit the `SKILL.md` file and open a PR. Because developers use symlinks,
the update reaches every developer as soon as they run `git pull`.
No reinstall needed.

---

## Naming conventions

- Skill names: lowercase, hyphens, max 64 chars (`our-api-conventions`)
- Agent names: lowercase, hyphens (`backend-specialist`)
- Bundle names: lowercase, hyphens (`backend-core`)
- MCP names: match the system (`crm`, `jira`, `data-warehouse`)

---

## CI checks

PRs that modify `skills/` must pass frontmatter linting.
PRs that modify `teams.json` or `bundles/` must pass catalog validation (all refs must resolve).
