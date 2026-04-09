import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const [, , tempDir] = process.argv;
const buildDir = process.env.TEST_BUILD_DIR;
const { writeCodexMcpServer, parseCodexMcpSection, removeCodexMcpServer } =
  await import(pathToFileURL(path.join(buildDir, 'core', 'platform.js')).href);

const configPath = path.join(tempDir, 'config.toml');
fs.writeFileSync(configPath, 'model = "gpt-5.4"\n');

const entry = {
  type: 'sse',
  url: 'https://example.test/mcp',
  bearerTokenEnvVar: 'EXAMPLE_TOKEN',
  httpHeaders: { 'X-Region': 'eu-west-1' },
  envHttpHeaders: { Authorization: 'EXAMPLE_AUTH' },
  startupTimeoutSec: 20,
  toolTimeoutSec: 45,
  enabled: true,
  required: false,
  enabledTools: ['open', 'search'],
  disabledTools: ['delete'],
};

const firstWrite = writeCodexMcpServer(configPath, 'example', entry);
const secondWrite = writeCodexMcpServer(configPath, 'example', entry);
const parsed = parseCodexMcpSection(fs.readFileSync(configPath, 'utf8'), 'example');
const removedText = removeCodexMcpServer(fs.readFileSync(configPath, 'utf8'), 'example');
if (removedText !== null) fs.writeFileSync(configPath, removedText);
const removed = removedText !== null;
const afterRemove = parseCodexMcpSection(fs.readFileSync(configPath, 'utf8'), 'example');

process.stdout.write(JSON.stringify({ firstWrite, secondWrite, parsed, removed, afterRemove }));
