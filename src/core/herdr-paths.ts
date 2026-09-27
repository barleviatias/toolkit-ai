import path from 'node:path';

/** Compare HerdR paths in one namespace, including Windows drive and UNC paths. */
export function relativeHerdrPath(from: string, to: string, platform = process.platform): string {
  if (platform === 'win32') {
    const normalize = (value: string): string => path.win32.toNamespacedPath(path.win32.normalize(value));
    return path.win32.relative(normalize(from), normalize(to));
  }
  return path.posix.relative(from, to);
}

/** Match optional registrations without treating a missing path as the working directory. */
export function sameHerdrPath(left: string | undefined, right: string | undefined, platform = process.platform): boolean {
  if (left === undefined || right === undefined) return left === right;
  return relativeHerdrPath(left, right, platform) === '';
}
