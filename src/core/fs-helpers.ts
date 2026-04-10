import fs from 'fs';
import path from 'path';

/** Create a directory and all parent directories if they don't exist. */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Recursively copy a directory tree from `src` to `dest`. */
export function copyDirRecursive(src: string, dest: string): void {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
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
