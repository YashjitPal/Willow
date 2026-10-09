/**
 * Paths on the user's computer, as the native runtime resolves them.
 *
 * The browser workspace keys files as `/App.tsx` and refuses anything absolute.
 * Here a path is what it is on disk: relative paths resolve against the turn's
 * working folder, absolute ones are taken as written, and everything is keyed by
 * its absolute form in the platform's own separators.
 */

import { PatchParseError } from '../runtime/apply-patch';

export interface NativePaths {
  /** The turn's working folder, absolute. */
  readonly cwd: string;
  readonly windows: boolean;
  /** Absolute form of `raw`, relative to `base` (default: the working folder). */
  resolve: (raw: string, base?: string) => string;
  /** How a path is shown back: relative to the working folder when inside it. */
  display: (absolute: string) => string;
  /** Whether `candidate` is `root` or inside it. */
  isInside: (root: string, candidate: string) => boolean;
  /** `parsePatch`'s normalizer: a header path to the absolute key it is applied under. */
  forPatch: (raw: string, line: number) => string;
}

const isWindowsAbsolute = (value: string): boolean => /^[a-zA-Z]:[\\/]/.test(value) || /^[\\/]{2}[^\\/]/.test(value);

/** Collapses `.` and `..` and duplicate separators, keeping the root. */
const normalizeParts = (root: string, rest: string[]): string[] => {
  const parts: string[] = [];
  for (const part of rest) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return [root, ...parts];
};

export const createNativePaths = (cwd: string, options: { platform: string; home: string }): NativePaths => {
  const windows = options.platform === 'win32';
  const sep = windows ? '\\' : '/';

  const absolute = (value: string): string => {
    if (windows) {
      const unified = value.replace(/\//g, '\\');
      if (/^[a-zA-Z]:\\/.test(unified)) {
        const [drive, ...rest] = unified.split('\\');
        const parts = normalizeParts(drive!.toUpperCase(), rest);
        return parts.length === 1 ? `${parts[0]}\\` : parts.join('\\');
      }
      if (unified.startsWith('\\\\')) {
        const [, , server, share, ...rest] = unified.split('\\');
        return normalizeParts(`\\\\${server}\\${share}`, rest).join('\\');
      }
      throw new Error(`Not an absolute path: ${value}`);
    }
    if (!value.startsWith('/')) throw new Error(`Not an absolute path: ${value}`);
    return normalizeParts('', value.split('/')).join('/') || '/';
  };

  const root = absolute(cwd);
  const home = absolute(options.home);

  const resolve = (raw: string, base = root): string => {
    let value = raw.trim();
    if (!value) throw new Error('A path is required.');
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim();
    if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) value = `${home}${sep}${value.slice(2)}`;
    if (windows) {
      if (/^[a-zA-Z]:$/.test(value)) return `${value.toUpperCase()}\\`;
      if (isWindowsAbsolute(value)) return absolute(value);
      // `\foo` on Windows is the working folder's drive root, as cmd and PowerShell read it.
      if (/^[\\/](?![\\/])/.test(value)) return absolute(`${base.slice(0, 2)}\\${value.slice(1)}`);
      return absolute(`${base}\\${value}`);
    }
    if (value.startsWith('/')) return absolute(value);
    return absolute(`${base}/${value}`);
  };

  const compare = (value: string): string => (windows ? value.toLowerCase() : value);

  const isInside = (parent: string, candidate: string): boolean => {
    const a = compare(parent.replace(/[\\/]+$/, ''));
    const b = compare(candidate);
    return b === a || b.startsWith(`${a}${sep}`);
  };

  const display = (path: string): string => {
    if (compare(path) === compare(root)) return '.';
    if (isInside(root, path)) return path.slice(root.replace(/[\\/]+$/, '').length + 1);
    return path;
  };

  const forPatch = (raw: string, line: number): string => {
    if (!raw.trim()) throw new PatchParseError('A file operation had an empty path.', line);
    try {
      return resolve(raw);
    } catch (error) {
      throw new PatchParseError((error as Error).message, line);
    }
  };

  return { cwd: root, windows, resolve, display, isInside, forPatch };
};
