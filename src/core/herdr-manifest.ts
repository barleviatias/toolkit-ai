import fs from 'fs';
import path from 'path';
import { parse } from 'smol-toml';
import { assertSafePathSegment } from './platform.js';

interface BuildStep { command: string[]; platforms?: string[] }
interface HerdrManifest {
  id: string;
  version: string;
  description: string;
  platforms?: string[];
  build: BuildStep[];
}

function platforms(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(p => ['linux', 'macos', 'windows'].includes(String(p)))) {
    throw new Error('Invalid HerdR platforms');
  }
  return value as string[];
}

/** Parse native HerdR metadata; HerdR remains responsible for full manifest validation. */
export function readHerdrManifest(dir: string): HerdrManifest {
  const value = parse(fs.readFileSync(path.join(dir, 'herdr-plugin.toml'), 'utf8'));
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value.id)) {
    throw new Error('Invalid HerdR plugin id');
  }
  if (typeof value.version !== 'string') throw new Error('Missing HerdR plugin version');
  if (value.build !== undefined && !Array.isArray(value.build)) throw new Error('Invalid HerdR build list');
  const build = ((value.build ?? []) as unknown[]).map(step => {
    if (!step || typeof step !== 'object') throw new Error('Invalid HerdR build step');
    const item = step as Record<string, unknown>;
    if (!Array.isArray(item.command) || !item.command.length || !item.command.every(arg => typeof arg === 'string' && !arg.includes('\0'))) {
      throw new Error('HerdR build commands must be nonempty argv arrays');
    }
    return { command: item.command as string[], platforms: platforms(item.platforms) };
  });
  return { id: value.id, version: value.version, description: typeof value.description === 'string' ? value.description : '', platforms: platforms(value.platforms), build };
}

/** Resolve optional toolkit.json runtime siblings without allowing paths outside their parent. */
export function herdrRuntimeDirs(dir: string, sourceRoot: string): string[] {
  const metadata = path.join(dir, 'toolkit.json');
  if (!fs.existsSync(metadata)) return [];
  const value: unknown = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  if (!value || typeof value !== 'object') throw new Error('Invalid toolkit.json');
  const siblings = (value as Record<string, unknown>).runtimeSiblings ?? [];
  if (!Array.isArray(siblings) || !siblings.every(name => typeof name === 'string')) throw new Error('Invalid runtimeSiblings');
  const parent = fs.realpathSync(path.dirname(dir));
  const relative = path.relative(fs.realpathSync(sourceRoot), parent);
  if (siblings.length && (relative.startsWith('..') || path.isAbsolute(relative))) throw new Error('Runtime siblings must stay inside the configured source');
  return [...new Set(siblings as string[])].sort().map(name => {
    assertSafePathSegment(name, 'runtime sibling');
    if (name === path.basename(dir)) throw new Error('Runtime sibling cannot be the plugin itself');
    const candidate = path.join(parent, name);
    if (fs.lstatSync(candidate).isSymbolicLink() || !fs.statSync(candidate).isDirectory() || fs.realpathSync(candidate) !== candidate) {
      throw new Error(`Runtime sibling must be a real sibling directory: ${name}`);
    }
    return candidate;
  });
}
