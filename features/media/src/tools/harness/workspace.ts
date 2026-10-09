/**
 * The turn's working copy of the project.
 *
 * Every action in a turn lands here, not in the workbench. The workbench only
 * sees the result when the turn ends (see `commitWorkspace` in `run-turn.ts`),
 * which is what keeps the preview from flashing half-finished multi-file
 * changes and lets the harness build and run the project before the user ever
 * sees a broken state.
 *
 * It also remembers what each path looked like when the turn began, which is
 * both the change list the commit applies and the line counts the transcript
 * shows.
 */

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

export interface FileChange {
  path: string;
  kind: 'created' | 'modified' | 'deleted';
  /** Contents when the turn began, or null for a file the turn created. */
  before: string | null;
  /** Contents now, or null for a file the turn deleted. */
  after: string | null;
}

/** Lines in a file, the way an editor counts them. */
export function countLines(text: string | null | undefined): number {
  if (!text) return 0;
  return text.replace(/\n$/, '').split('\n').length;
}

/**
 * Lines added and removed between two versions, by a cheap multiset
 * comparison. Exact enough for a "+12 −3" badge and linear in file size,
 * where a real diff would be quadratic on every keystroke-sized edit.
 */
export function lineDelta(before: string | null, after: string | null): { added: number; removed: number } {
  const beforeLines = before ? before.replace(/\n$/, '').split('\n') : [];
  const afterLines = after ? after.replace(/\n$/, '').split('\n') : [];
  const counts = new Map<string, number>();
  for (const line of beforeLines) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of afterLines) {
    const remaining = counts.get(line) ?? 0;
    if (remaining > 0) counts.set(line, remaining - 1);
    else added += 1;
  }
  let removed = 0;
  for (const remaining of counts.values()) removed += remaining;
  return { added, removed };
}

export class Workspace {
  #files: Record<string, string>;
  /** Contents at the start of the turn, for every path the turn has touched. */
  #original = new Map<string, string | null>();
  #revision = 0;

  constructor(initial: Record<string, string>) {
    this.#files = { ...initial };
  }

  /** A copy of the current file map. */
  get files(): Record<string, string> {
    return { ...this.#files };
  }

  /** Bumped on every change, so a check can tell whether anything moved since. */
  get revision(): number {
    return this.#revision;
  }

  paths(): string[] {
    return Object.keys(this.#files).sort();
  }

  read(path: string): string | undefined {
    return this.#files[path];
  }

  exists(path: string): boolean {
    return this.#files[path] !== undefined;
  }

  /** True when the project keeps its sources under `/src/`. */
  get usesSrcDirectory(): boolean {
    return Object.keys(this.#files).some((path) => path.startsWith('/src/') && /\.(tsx?|jsx?)$/.test(path));
  }

  /**
   * A model-supplied path in the project's own terms.
   *
   * Models write `App.tsx`, `./App.tsx`, `/App.tsx` and — out of Vite habit —
   * `src/App.tsx` for the same file. Projects made here keep sources at the
   * root, so `src/` is dropped; a project imported with a real `src/` folder
   * keeps it. Whichever form already exists wins.
   */
  resolvePath(raw: string): string {
    let path = (raw ?? '').trim().replace(/\\/g, '/').replace(/^["'`]|["'`]$/g, '');
    if (!path) throw new PathError('The path is empty.');
    if (/^[a-zA-Z]:\//.test(path) || path.startsWith('//') || /^[a-z]+:\/\//i.test(path)) {
      throw new PathError(`Paths are project-relative, like /components/Button.tsx — not ${raw}.`);
    }
    path = path.replace(/^\.\//, '').replace(/\/{2,}/g, '/');
    if (path.split('/').includes('..')) {
      throw new PathError(`Paths may not contain "..": ${raw}`);
    }
    if (!path.startsWith('/')) path = `/${path}`;
    if (path.endsWith('/')) throw new PathError(`${raw} is a folder, not a file.`);

    if (this.exists(path)) return path;
    if (path.startsWith('/src/')) {
      const stripped = path.slice(4);
      if (this.exists(stripped) || !this.usesSrcDirectory) return stripped;
      return path;
    }
    if (this.usesSrcDirectory && this.exists(`/src${path}`)) return `/src${path}`;
    return path;
  }

  #remember(path: string): void {
    if (!this.#original.has(path)) this.#original.set(path, this.#files[path] ?? null);
  }

  write(path: string, contents: string): { created: boolean; added: number; removed: number; unchanged: boolean } {
    const previous = this.#files[path];
    if (previous === contents) return { created: false, added: 0, removed: 0, unchanged: true };
    this.#remember(path);
    this.#files[path] = contents;
    this.#revision += 1;
    const { added, removed } = lineDelta(previous ?? null, contents);
    return { created: previous === undefined, added, removed, unchanged: false };
  }

  delete(path: string): number {
    const previous = this.#files[path];
    if (previous === undefined) throw new PathError(`${path} does not exist.`);
    this.#remember(path);
    delete this.#files[path];
    this.#revision += 1;
    return countLines(previous);
  }

  rename(from: string, to: string): void {
    const contents = this.#files[from];
    if (contents === undefined) throw new PathError(`${from} does not exist.`);
    if (this.#files[to] !== undefined) throw new PathError(`${to} already exists.`);
    this.#remember(from);
    this.#remember(to);
    delete this.#files[from];
    this.#files[to] = contents;
    this.#revision += 1;
  }

  /** Every path whose contents differ from the start of the turn. */
  changes(): FileChange[] {
    const out: FileChange[] = [];
    for (const [path, before] of this.#original) {
      const after = this.#files[path] ?? null;
      if (before === after) continue;
      out.push({
        path,
        kind: before === null ? 'created' : after === null ? 'deleted' : 'modified',
        before,
        after,
      });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Paths with similar names, for "did you mean" on a missing file. */
  similarPaths(path: string, limit = 5): string[] {
    const base = path.split('/').pop()?.toLowerCase().replace(/\.(tsx?|jsx?|css|json)$/, '') ?? '';
    if (!base) return [];
    return this.paths()
      .filter((candidate) => {
        const name = candidate.split('/').pop()!.toLowerCase();
        return name.includes(base) || base.includes(name.replace(/\.(tsx?|jsx?|css|json)$/, ''));
      })
      .slice(0, limit);
  }
}

/** True for a file whose contents are a data URL rather than text. */
export const isBinaryAsset = (path: string, contents: string): boolean =>
  contents.startsWith('data:') || /\.(png|jpe?g|gif|webp|avif|ico|bmp|mp3|wav|mp4|webm|woff2?|ttf|otf)$/i.test(path);
