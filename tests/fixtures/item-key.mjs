import path from 'path';
import { pathToFileURL } from 'url';

const buildDir = process.env.TEST_BUILD_DIR;

const { makeKey, parseKey } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'item-key.js')).href);

const results = {};

// makeKey produces correct format
results.makeKeyBasic = makeKey('skill', 'source', 'name');

// parseKey with :: delimiter
results.parseKeyNew = parseKey('skill::source::name');

// parseKey with legacy single-colon format
results.parseKeyLegacy = parseKey('skill:name');

process.stdout.write(JSON.stringify(results));
