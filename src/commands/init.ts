import fs from 'fs';
import path from 'path';

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const GREEN = '\x1b[32m';
const DIM   = '\x1b[2m';

const TOOLKIT_USAGE_SKILL = `---
name: toolkit-usage
description: How to install, browse, update, and curate AI assistant content with toolkit-ai (skills, agents, MCPs, slash commands, bundles, provider on/off).
---

# Using toolkit-ai

\`toolkit-ai\` is a content layer for AI coding assistants. It pulls
**skills**, **agents**, **MCP servers**, **slash commands**, and
**bundles** from external Git sources and installs them into the
right per-tool directories on your machine (Claude Code, Cursor,
VS Code, Codex, GitHub Copilot, Amp).

You can run it interactively (\`toolkit-ai\`) or headlessly
(\`toolkit-ai <verb> <name>\`).

## Add a source

\`\`\`sh
toolkit-ai source add owner/repo                 # GitHub
toolkit-ai source add https://bitbucket.org/...  # Bitbucket
toolkit-ai source list
toolkit-ai source refresh                        # re-clone all
\`\`\`

The catalog is built by walking each source's cache and matching
file conventions (see "Layout").

## Browse the catalog

\`\`\`sh
toolkit-ai                # interactive TUI
toolkit-ai list           # flat list per type
toolkit-ai targets        # which tools are detected + enabled
\`\`\`

## Install one thing

\`\`\`sh
toolkit-ai skill <name>          # install a skill
toolkit-ai agent <name>          # install an agent
toolkit-ai mcp <name>            # register an MCP server
toolkit-ai command <name>        # install a slash command
toolkit-ai bundle <name>         # install a bundle (all referenced items)
\`\`\`

Each install writes to **every detected and enabled** target tool.
A skill goes to \`~/.claude/skills/\`, \`~/.cursor/...\`, etc. A slash
command goes verbatim to \`~/.claude/commands/<name>.md\` and as a
transformed VS Code prompt to
\`~/Library/Application Support/Code/User/prompts/<name>.prompt.md\`.

Add \`--force\` to reinstall over an existing copy.

## Bundles

A bundle is a JSON manifest that names skills/agents/mcps/commands
to install together — useful when a project needs a coherent set.

\`\`\`json
{
  "name": "starter",
  "description": "Minimal starter pack",
  "skills":   ["toolkit-usage"],
  "commands": ["example"],
  "agents":   [],
  "mcps":     []
}
\`\`\`

\`toolkit-ai bundle starter\` resolves each name against the catalog
and installs them. Removing the bundle removes its members unless
another bundle still references them.

## Slash commands (\`*.prompt.md\`)

Source convention: any file ending in \`.prompt.md\` becomes a
slash command. Frontmatter keys: \`name\`, \`description\`, optional
\`argument-hint\`. Use \`$ARGUMENTS\` in the body.

- Claude / Cursor get the file verbatim at \`<dir>/commands/<name>.md\`.
- VS Code prompts get a rewritten frontmatter (\`mode: agent\`,
  description JSON-stringified) and \`$ARGUMENTS\` is replaced with
  \`\${input:topic:<argument-hint>}\` so Copilot Chat asks for the
  argument before running.

## Provider on/off

Sometimes you want to install only to a subset of detected tools.

\`\`\`sh
toolkit-ai settings tools            # show enabled/disabled per provider
toolkit-ai settings tool vscode off  # skip VS Code on future installs
toolkit-ai settings tool vscode on   # re-enable
\`\`\`

The opt-out list is stored in \`~/.toolkit/config.json\` under
\`disabledTools\`. Existing files on disk are left alone — only
future writes are skipped.

## Update / remove

\`\`\`sh
toolkit-ai check               # show which installs have newer hashes
toolkit-ai update              # bring everything to the latest
toolkit-ai remove <type> <name>
\`\`\`

\`toolkit-ai\` keeps a lockfile at \`~/.toolkit/lock.json\` so updates
only re-write items whose source hash changed.

## Layout for this repo

\`\`\`
skills/<name>/SKILL.md          skills (frontmatter: name, description)
agents/<name>.agent.md          agents (frontmatter: name, description, tools?)
mcps/<name>.mcp.json            MCP server configs
commands/<name>.prompt.md       slash prompts (frontmatter: name, description, argument-hint?)
bundles/<name>.bundle.json      curated sets
\`\`\`

Discovery is recursive — the directory names above are conventions,
not hard requirements. \`toolkit-ai\` matches by file pattern, so
nested layouts work as long as the names follow the conventions.
`;

const COMMAND_TEMPLATE = `---
name: example
description: Sample slash prompt scaffolded by \`toolkit-ai init\`
argument-hint: "<topic>"
---

You are about to work on: $ARGUMENTS

1. Restate the task in your own words.
2. Identify constraints and unknowns.
3. Propose a short plan before changing code.
`;

const MCP_TEMPLATE = JSON.stringify(
  {
    name: 'github',
    description: 'Stdio MCP server exposing GitHub repos, issues, and PRs to the agent. Requires a fine-grained personal access token.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      // Reference an env var the user already exports in their shell — the
      // MCP runtime substitutes this at launch. Never inline a real token here.
      GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}',
      LOG_LEVEL: 'info',
    },
    envVars: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    cwd: '${HOME}',
    startupTimeoutSec: 15,
    toolTimeoutSec: 60,
    enabled: true,
    required: false,
    enabledTools: [
      'search_repositories',
      'get_file_contents',
      'list_issues',
      'create_issue',
      'list_pull_requests',
    ],
    disabledTools: [
      'delete_repository',
    ],
    setupNote: 'Create a GitHub Personal Access Token with `repo` and `read:org` scopes, then export it as GITHUB_PERSONAL_ACCESS_TOKEN before launching your AI tool. toolkit-ai writes this config into your tool\'s MCP registry; the token resolves at runtime via shell env, not from this file.',
  },
  null,
  2,
);

const BUNDLE_TEMPLATE = JSON.stringify(
  {
    name: 'starter',
    description: 'Toolkit usage skill, sample slash command, and a realistic stdio MCP example',
    skills: ['toolkit-usage'],
    commands: ['example'],
    mcps: ['github'],
  },
  null,
  2,
);

const README_TEMPLATE = `# My Toolkit Pack

A small \`toolkit-ai\` source. Ships:

- \`skills/toolkit-usage/SKILL.md\` — how to use \`toolkit-ai\` (read this first).
- \`commands/example.prompt.md\` — a starter slash prompt.
- \`mcps/github.mcp.json\` — realistic stdio MCP example (env vars, allow/deny tools, timeouts).
- \`bundles/starter.bundle.json\` — installs all three at once.

## Use it

\`\`\`sh
toolkit-ai source add owner/repo   # this repo
toolkit-ai bundle starter          # or: toolkit-ai skill toolkit-usage
\`\`\`

The MCP example references \`GITHUB_PERSONAL_ACCESS_TOKEN\` from your
shell — set that before installing if you want the server to start.
Tokens never live in the JSON.

## Add your own content

| Type     | Path                            | Frontmatter / Schema                              |
|----------|---------------------------------|---------------------------------------------------|
| Skill    | \`skills/<name>/SKILL.md\`        | \`name\`, \`description\`                             |
| Agent    | \`agents/<name>.agent.md\`        | \`name\`, \`description\`, optional \`tools\`           |
| MCP      | \`mcps/<name>.mcp.json\`          | JSON: \`name\`, \`description\`, \`command\`/\`url\`...   |
| Command  | \`commands/<name>.prompt.md\`     | \`name\`, \`description\`, optional \`argument-hint\`   |
| Bundle   | \`bundles/<name>.bundle.json\`    | JSON: \`name\`, \`description\`, arrays of names      |

Discovery is recursive. Use any subfolders you like as long as
filenames follow these conventions.
`;

const GITIGNORE_TEMPLATE = `node_modules/
.DS_Store
`;

interface FileEntry {
  path: string;
  content: string;
}

const FILES: FileEntry[] = [
  { path: 'skills/toolkit-usage/SKILL.md', content: TOOLKIT_USAGE_SKILL },
  { path: 'commands/example.prompt.md', content: COMMAND_TEMPLATE },
  { path: 'mcps/github.mcp.json', content: MCP_TEMPLATE },
  { path: 'bundles/starter.bundle.json', content: BUNDLE_TEMPLATE },
  { path: 'README.md', content: README_TEMPLATE },
  { path: '.gitignore', content: GITIGNORE_TEMPLATE },
];

const SCAFFOLD_DIRS = ['skills', 'commands', 'mcps', 'bundles'] as const;

export function runInit(targetDir: string): void {
  const absTarget = path.resolve(targetDir);

  for (const dir of SCAFFOLD_DIRS) {
    if (fs.existsSync(path.join(absTarget, dir))) {
      console.log(`\n  ${BOLD}${dir}/${RESET} already exists in ${DIM}${absTarget}${RESET}`);
      console.log(`  Aborting to avoid overwriting existing content.\n`);
      process.exit(1);
    }
  }

  console.log();
  console.log(`${BOLD}Scaffolding toolkit pack in${RESET} ${DIM}${absTarget}${RESET}`);
  console.log();

  for (const file of FILES) {
    const filePath = path.join(absTarget, file.path);
    const dir = path.dirname(filePath);

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
  console.log(`  1. Read ${BOLD}skills/toolkit-usage/SKILL.md${RESET} — it's the manual for toolkit-ai.`);
  console.log(`  2. Edit the starter command and bundle, or add your own.`);
  console.log(`  3. Push to GitHub/Bitbucket and add as a source: ${BOLD}toolkit-ai source add owner/repo${RESET}`);
  console.log();
}
