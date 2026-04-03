import fs from 'fs';
import path from 'path';

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const GREEN = '\x1b[32m';
const DIM   = '\x1b[2m';

const SKILL_TEMPLATE = `---
name: example-skill
description: A short description of what this skill does
---

# Example Skill

Instructions for the AI agent go here.

## When to use

Describe when this skill should be activated.

## How it works

Step-by-step guidance for the agent.
`;

const AGENT_TEMPLATE = `---
name: example-agent
description: A short description of what this agent does
tools:
  - read
---

# Example Agent

You are an agent that does X.

## What you do

- First responsibility
- Second responsibility

## How you work

Describe the agent's approach and behavior.
`;

const MCP_TEMPLATE = JSON.stringify(
  {
    name: 'example-mcp',
    description: 'A short description of this MCP server',
    transport: 'sse',
    url: 'https://your-server.example.com/sse',
    setupNote: 'Instructions for setting up this MCP connection.',
  },
  null,
  2,
);

const BUNDLE_TEMPLATE = JSON.stringify(
  {
    name: 'fullstack-starter',
    description: 'Essential skills and MCPs for full-stack development',
    skills: ['example-skill'],
    agents: ['example-agent'],
    mcps: ['example-mcp'],
  },
  null,
  2,
);

const README_TEMPLATE = `# My Skills

A collection of AI skills, agents, MCP configurations, and bundles for use with [toolkit-ai](https://www.npmjs.com/package/toolkit-ai).

## Usage

Add this repo as an external source in toolkit-ai:

\`\`\`bash
ai-toolkit source add owner/repo
\`\`\`

Then browse and install from the TUI, or use headless commands:

\`\`\`bash
ai-toolkit --skill <name>    # Install a skill
ai-toolkit --bundle <name>   # Install a bundle (all items at once)
\`\`\`

## Structure

\`\`\`
resources/
  skills/<name>/SKILL.md           # Skills with YAML frontmatter
  agents/<name>.agent.md           # Agent definitions
  mcps/<name>.json                 # MCP server configs
  bundles/<name>.bundle.json       # Bundles (curated sets of items)
\`\`\`

## Resource Types

- **Skills** — Markdown files that teach AI agents domain knowledge or workflows. Require \`name\` and \`description\` in YAML frontmatter.
- **Agents** — Markdown files defining specialized AI workers with their own tools and behavior.
- **MCPs** — JSON configs for Model Context Protocol servers (connect AI to external services).
- **Bundles** — JSON manifests that reference skills, agents, and MCPs by name. Installing a bundle installs all referenced items together.

## Adding Content

1. Create your resource in the appropriate \`resources/\` directory
2. Skills require \`name\` and \`description\` in YAML frontmatter
3. Agents use \`*.agent.md\` naming with YAML frontmatter
4. MCPs are JSON with \`name\`, \`description\`, \`transport\`, \`url\`
5. Bundles are JSON with \`name\`, \`description\`, and arrays of \`skills\`, \`agents\`, \`mcps\`
`;

const GITIGNORE_TEMPLATE = `node_modules/
.DS_Store
`;

interface FileEntry {
  path: string;
  content: string;
}

const FILES: FileEntry[] = [
  { path: 'resources/skills/example-skill/SKILL.md', content: SKILL_TEMPLATE },
  { path: 'resources/agents/example-agent.agent.md', content: AGENT_TEMPLATE },
  { path: 'resources/mcps/example-mcp.json', content: MCP_TEMPLATE },
  { path: 'resources/bundles/fullstack-starter.bundle.json', content: BUNDLE_TEMPLATE },
  { path: 'README.md', content: README_TEMPLATE },
  { path: '.gitignore', content: GITIGNORE_TEMPLATE },
];

export function runInit(targetDir: string): void {
  const absTarget = path.resolve(targetDir);

  // Check if resources/ already exists
  if (fs.existsSync(path.join(absTarget, 'resources'))) {
    console.log(`\n  ${BOLD}resources/${RESET} already exists in ${DIM}${absTarget}${RESET}`);
    console.log(`  Aborting to avoid overwriting existing content.\n`);
    process.exit(1);
  }

  console.log();
  console.log(`${BOLD}Scaffolding skill repo in${RESET} ${DIM}${absTarget}${RESET}`);
  console.log();

  for (const file of FILES) {
    const filePath = path.join(absTarget, file.path);
    const dir = path.dirname(filePath);

    // Skip files that already exist (e.g. README, .gitignore)
    if (fs.existsSync(filePath)) {
      console.log(`  ${DIM}skip${RESET}  ${file.path} (already exists)`);
      continue;
    }

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, file.content, 'utf-8');
    console.log(`  ${GREEN}create${RESET}  ${file.path}`);
  }

  console.log();
  console.log(`${GREEN}Done!${RESET} Next steps:`);
  console.log(`  1. Edit the example files in ${BOLD}resources/${RESET}`);
  console.log(`  2. Push to GitHub or Bitbucket`);
  console.log(`  3. Add as a source: ${BOLD}toolkit-ai source add owner/repo${RESET}`);
  console.log();
}
