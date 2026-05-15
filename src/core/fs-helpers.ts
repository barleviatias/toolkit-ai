import fs from 'fs';
import path from 'path';

/** Create a directory and all parent directories if they don't exist. */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Write a JSON file atomically. Writes to a sibling `.<name>.tmp.<pid>.<rand>`
 * file first, then renames over the target -- rename is a single inode swap
 * on POSIX filesystems, so a crash mid-write leaves either the old file
 * intact or the new file fully written. Never a torn / zero-byte target.
 *
 * Use this for every write to a config file under the user's home (Claude's
 * `installed_plugins.json`, `known_marketplaces.json`, `settings.json`;
 * Copilot's `config.json`, `settings.json`; toolkit's own `lock.json`).
 * A torn write to any of these blocks the parser on next read.
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  const body = JSON.stringify(data, null, 2);
  try {
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

/**
 * Read+parse a JSON file. Returns `null` when the file is **absent**, throws
 * when the file is **present but malformed**. Use the throw distinction to
 * refuse to overwrite a transiently-corrupt file (the alternative -- silent
 * default-to-empty -- destroys whatever the parser would have recovered on
 * a successful read).
 */
export function readJsonOrNull<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

// Dirs that are dev-state, never part of published content. We skip them
// when recursively copying so a plugin author's `.claude/worktrees/` (git
// worktrees full of broken symlinks) or `node_modules/` can't blow up an
// otherwise-clean copy mid-tree.
const COPY_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', 'worktrees']);

/**
 * Recursively copy a directory tree from `src` to `dest`. Skips known
 * dev-state dirs (see `COPY_SKIP_DIRS`) and irregular file types (symlinks,
 * sockets, FIFOs) — those can't be cleanly copied and represent local
 * state, not plugin content. Per-entry errors are swallowed so a single
 * unreadable file doesn't abort the whole copy.
 */
export function copyDirRecursive(src: string, dest: string): void {
  ensureDir(dest);
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(src, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (COPY_SKIP_DIRS.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    try {
      if (entry.isDirectory()) {
        copyDirRecursive(s, d);
      } else if (entry.isFile()) {
        fs.copyFileSync(s, d);
      }
      // Skip symlinks and other irregular types silently.
    } catch { /* best-effort copy */ }
  }
}

/** Symlink (or copy as fallback) a directory. Returns install status. */
export function linkOrCopyDir(
  src: string,
  dest: string,
  force: boolean,
  forceCopy: boolean,
): 'installed' | 'updated' | 'exists' {
  if (fs.existsSync(dest)) {
    if (!force) return 'exists';
    fs.rmSync(dest, { recursive: true, force: true });
  }
  ensureDir(path.dirname(dest));
  if (forceCopy) {
    copyDirRecursive(src, dest);
  } else {
    try {
      fs.symlinkSync(src, dest, 'junction');
    } catch {
      copyDirRecursive(src, dest);
    }
  }
  return force ? 'updated' : 'installed';
}

/** Symlink (or copy as fallback) a single file. Returns install status. */
export function linkOrCopyFile(
  src: string,
  dest: string,
  force: boolean,
  forceCopy: boolean,
): 'installed' | 'updated' | 'exists' {
  if (fs.existsSync(dest)) {
    if (!force) return 'exists';
    try { fs.unlinkSync(dest); } catch { fs.rmSync(dest, { force: true }); }
  }
  ensureDir(path.dirname(dest));
  if (forceCopy) {
    fs.copyFileSync(src, dest);
  } else {
    try {
      fs.symlinkSync(src, dest, 'file');
    } catch {
      fs.copyFileSync(src, dest);
    }
  }
  return force ? 'updated' : 'installed';
}

/** Remove a file, symlink, or directory. Returns true if something was removed. */
export function removeLink(p: string): boolean {
  if (!fs.existsSync(p)) return false;
  const stat = fs.lstatSync(p);
  if (stat.isDirectory()) {
    fs.rmSync(p, { recursive: true, force: true });
  } else {
    fs.unlinkSync(p);
  }
  return true;
}
