import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type { InstallResult, LockEntry } from '../types.js';
import { TOOLKIT_HOME, assertSafePathSegment, getSourceRoot } from './platform.js';
import { readLock, writeLock } from './lock.js';
import { herdrRuntimeDirs, readHerdrManifest } from './herdr-manifest.js';
import { scanSkillDir, formatReport } from './scanner.js';

const SKIP = new Set(['.git', 'node_modules', 'target', '__pycache__', '.DS_Store']);
type Log = (message: string) => void;
type Registration = { plugin_id: string; plugin_root: string; enabled: boolean };

function run(bin: string, args: string[], cwd?: string): string {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${bin} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.slice(-4000)}`);
  }
  return result.stdout;
}

function registration(id: string): Registration | undefined {
  const value = JSON.parse(run('herdr', ['plugin', 'list', '--json'])) as { result?: { plugins?: Registration[] } };
  if (!Array.isArray(value.result?.plugins)) throw new Error('Unexpected HerdR plugin list response');
  return value.result.plugins.find(plugin => plugin.plugin_id === id);
}

function managedRoot(name: string): string {
  assertSafePathSegment(name, 'HerdR resource name');
  const home = fs.realpathSync(path.dirname(TOOLKIT_HOME));
  const root = path.join(home, path.basename(TOOLKIT_HOME), 'herdr', name);
  // Refuse redirected managed directories instead of copying/deleting through links.
  for (let current = root; current !== home; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Managed path is a symlink: ${current}`);
  }
  return root;
}

function owns(name: string, installedPath: string): boolean {
  const relative = path.relative(managedRoot(name), installedPath);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function copyTree(source: string, destination: string, packageRoot = fs.realpathSync(source), ancestors = new Set<string>()): void {
  const realSource = fs.realpathSync(source);
  const relative = path.relative(packageRoot, realSource);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Runtime link points outside packaged directory: ${source}`);
  if (ancestors.has(realSource)) throw new Error(`Runtime link creates a directory cycle: ${source}`);
  const nextAncestors = new Set(ancestors).add(realSource);
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(realSource, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const src = path.join(realSource, entry.name);
    const dest = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(src, dest, packageRoot, nextAncestors);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
    else if (entry.isSymbolicLink()) {
      const target = fs.realpathSync(src);
      const targetStat = fs.statSync(target);
      if (targetStat.isDirectory()) copyTree(target, dest, packageRoot, nextAncestors);
      else if (targetStat.isFile()) {
        const targetRelative = path.relative(packageRoot, target);
        if (targetRelative.startsWith('..') || path.isAbsolute(targetRelative)) throw new Error(`Runtime link points outside packaged directory: ${src}`);
        fs.copyFileSync(target, dest);
      } else throw new Error(`Cannot package non-regular runtime link: ${src}`);
    }
    else throw new Error(`Cannot package non-regular runtime file: ${src}`);
  }
}

/** Copy, scan and build a native HerdR plugin before registering it through HerdR's CLI. */
export function installHerdrPlugin(name: string, source: string, hash: string, sourceName: string,
  opts: { force?: boolean; strict?: boolean }, log: Log): InstallResult {
  const root = managedRoot(name);
  const manifest = readHerdrManifest(source);
  const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : process.platform;
  if (manifest.platforms && !manifest.platforms.includes(platform)) throw new Error(`Plugin does not support ${platform}`);
  const lock = readLock();
  const previous = lock.installed[`herdr:${name}`];
  const current = registration(manifest.id);
  if (current && (!previous?.herdr || current.plugin_root !== previous.herdr.path || !owns(name, current.plugin_root))) {
    throw new Error(`HerdR resource ${manifest.id} is already registered outside this toolkit install. Unlink it explicitly before installing with toolkit.`);
  }
  if (previous?.herdr && previous.herdr.id !== manifest.id) throw new Error('HerdR plugin id changed; remove the previous install first');
  if (current && previous?.hash === hash && !opts.force) return { type: 'herdr', name, action: 'skipped' };
  const directories = [source, ...herdrRuntimeDirs(source, getSourceRoot(sourceName), manifest.id)];
  fs.mkdirSync(root, { recursive: true });
  const generation = fs.mkdtempSync(path.join(root, 'install-'));
  const pluginPath = path.join(generation, path.basename(source));
  let linkAttempted = false;
  try {
    for (const dir of directories) copyTree(dir, path.join(generation, path.basename(dir)));
    for (const dir of directories) {
      const report = scanSkillDir(path.join(generation, path.basename(dir)), path.basename(dir), sourceName);
      if (report.findings.length) log(formatReport(report));
      if (!report.passed && opts.strict) {
        fs.rmSync(generation, { recursive: true, force: true });
        return { type: 'herdr', name, action: 'blocked' };
      }
    }
    const manifestFile = path.join(pluginPath, 'herdr-plugin.toml');
    const original = fs.readFileSync(manifestFile, 'utf8');
    for (const step of manifest.build) {
      if (step.platforms && !step.platforms.includes(platform)) continue;
      log(`  Building ${name}: ${step.command.join(' ')}`);
      const output = run(step.command[0], step.command.slice(1), pluginPath);
      if (output.trim()) log(output.trim());
    }
    if (fs.readFileSync(manifestFile, 'utf8') !== original) throw new Error('Build changed herdr-plugin.toml; registration aborted');
    // Recheck ownership after a potentially long build.
    const latest = registration(manifest.id);
    if (latest?.plugin_root !== current?.plugin_root) throw new Error('HerdR registration changed during build; retry');
    linkAttempted = true;
    run('herdr', ['plugin', 'link', pluginPath, current?.enabled === false ? '--disabled' : '--enabled']);
    const verified = registration(manifest.id);
    if (verified?.plugin_root !== pluginPath) throw new Error('HerdR did not confirm the installed plugin path');
    const latestLock = readLock();
    latestLock.installed[`herdr:${name}`] = { hash, installedAt: new Date().toISOString(), herdr: { id: manifest.id, path: pluginPath } };
    writeLock(latestLock);
    log(`  [+] herdr ${name} installed`);
    // Keep older generations for already-running panes until explicit removal.
    return { type: 'herdr', name, action: previous ? 'updated' : 'installed' };
  } catch (error) {
    let canRemove = true;
    if (linkAttempted) {
      try {
        if (registration(manifest.id)?.plugin_root === pluginPath) {
          if (current) run('herdr', ['plugin', 'link', current.plugin_root, current.enabled ? '--enabled' : '--disabled']);
          else run('herdr', ['plugin', 'unlink', manifest.id]);
        }
        canRemove = registration(manifest.id)?.plugin_root !== pluginPath;
      } catch {
        canRemove = false;
      }
    }
    if (canRemove) fs.rmSync(generation, { recursive: true, force: true });
    else log(`  [!] HerdR recovery needs attention; retained files at ${pluginPath}`);
    throw error;
  }
}

/** Unlink only the toolkit-owned registration, then remove its managed generations. */
export function removeHerdrPlugin(name: string, installed: NonNullable<LockEntry['herdr']>, log: Log): void {
  if (!owns(name, installed.path)) throw new Error('Refusing to remove a HerdR path outside toolkit storage');
  const current = registration(installed.id);
  if (current && current.plugin_root !== installed.path) throw new Error('HerdR plugin now points elsewhere; refusing to unlink it');
  if (current) run('herdr', ['plugin', 'unlink', installed.id]);
  fs.rmSync(managedRoot(name), { recursive: true, force: true });
  log(`  [-] herdr ${name} removed`);
}
