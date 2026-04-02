// scripts/ci/lint-skills.js
// Validates YAML frontmatter in all skills/*/SKILL.md files.
// Fails (exit 1) if any SKILL.md is missing required fields.

'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const REQUIRED_FIELDS = ['name', 'description'];
const skillsDir = path.join(__dirname, '..', '..', 'resources', 'skills');

let errors = 0;

const skills = fs.readdirSync(skillsDir, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name);

for (const skill of skills) {
  const filePath = path.join(skillsDir, skill, 'SKILL.md');
  let skillErrors = 0;

  if (!fs.existsSync(filePath)) {
    console.error(`[X] ${skill}: missing SKILL.md`);
    errors++;
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf8');

  // Extract YAML frontmatter between the first pair of --- delimiters.
  // Allow \r\n (Windows) or \n (Unix) line endings.
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    console.error(`[X] ${skill}/SKILL.md: no YAML frontmatter found (expected --- delimiters)`);
    errors++;
    continue;
  }

  let fm;
  try {
    fm = yaml.load(match[1]);
  } catch (e) {
    console.error(`[X] ${skill}/SKILL.md: invalid YAML -- ${e.message}`);
    errors++;
    continue;
  }

  for (const field of REQUIRED_FIELDS) {
    if (!fm[field] || String(fm[field]).trim() === '') {
      console.error(`[X] ${skill}/SKILL.md: missing or empty required field "${field}"`);
      skillErrors++;
    }
  }

  errors += skillErrors;

  if (skillErrors === 0) {
    console.log(`  [OK] ${skill}`);
  }
}

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
} else {
  console.log('\nAll skills passed frontmatter validation.');
}
