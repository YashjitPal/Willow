/**
 * OpenAI Codex's V4A patch format (`*** Begin Patch`), applied to a file map.
 *
 * Not the harness's documented edit format — that is SEARCH/REPLACE — but
 * models trained on Codex reach for it out of habit, and a correct patch is
 * applied rather than refused. A port of the format, not of the Rust code in
 * `codex-rs/apply-patch/`.
 *
 * The one behaviour worth calling out is context matching. Models reliably get
 * the shape of a hunk right and the whitespace of it wrong, so a strictly
 * literal matcher rejects patches that are unambiguously correct. Matching is
 * graduated: exact, then ignoring trailing whitespace, then ignoring leading and
 * trailing whitespace. Anything looser starts matching the wrong region, so the
 * ladder stops there.
 */

export interface FileMap {
  [path: string]: string;
}

export type PatchOpKind = 'add' | 'delete' | 'update';

export interface PatchHunkLine {
  kind: 'context' | 'add' | 'remove';
  text: string;
}

export interface PatchHunk {
  /** Text after `@@`, used to narrow the search window. Empty when bare. */
  header: string;
  lines: PatchHunkLine[];
  /** Set by `*** End of File`; anchors the hunk to the end of the file. */
  atEndOfFile: boolean;
}

export interface PatchOp {
  kind: PatchOpKind;
  path: string;
  /** Only for `update` with `*** Move to:`. */
  movePath?: string;
  /** Only for `add`: the full contents. */
  contents?: string;
  /** Only for `update`. */
  hunks: PatchHunk[];
}

export class PatchParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'PatchParseError';
  }
}

export class PatchApplyError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = 'PatchApplyError';
  }
}

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';
const ADD = '*** Add File: ';
const DELETE = '*** Delete File: ';
const UPDATE = '*** Update File: ';
const MOVE = '*** Move to: ';
const EOF_MARKER = '*** End of File';

/* ------------------------------------------------------------------------ */
/* Parsing                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Parses a full patch envelope.
 *
 * Tolerant about two things the grammar is strict on, because models get them
 * wrong constantly and neither is ambiguous: leading/trailing blank lines
 * around the envelope, and a missing trailing newline after `*** End Patch`.
 */
export function parsePatch(source: string): PatchOp[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');

  let index = 0;
  while (index < lines.length && lines[index]!.trim() === '') index += 1;

  if (lines[index]?.trim() !== BEGIN) {
    throw new PatchParseError(
      `A patch must start with "${BEGIN}". Got: ${JSON.stringify(
        (lines[index] ?? '').slice(0, 60),
      )}`,
      index + 1,
    );
  }
  index += 1;

  const ops: PatchOp[] = [];
  let sawEnd = false;

  while (index < lines.length) {
    const line = lines[index]!;

    if (line.trim() === END) {
      sawEnd = true;
      break;
    }

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    if (line.startsWith(ADD)) {
      const path = normalizePath(line.slice(ADD.length).trim(), index + 1);
      index += 1;
      const body: string[] = [];
      while (index < lines.length && lines[index]!.startsWith('+')) {
        body.push(lines[index]!.slice(1));
        index += 1;
      }
      ops.push({ kind: 'add', path, contents: `${body.join('\n')}\n`, hunks: [] });
      continue;
    }

    if (line.startsWith(DELETE)) {
      ops.push({
        kind: 'delete',
        path: normalizePath(line.slice(DELETE.length).trim(), index + 1),
        hunks: [],
      });
      index += 1;
      continue;
    }

    if (line.startsWith(UPDATE)) {
      const path = normalizePath(line.slice(UPDATE.length).trim(), index + 1);
      index += 1;

      let movePath: string | undefined;
      if (lines[index]?.startsWith(MOVE)) {
        movePath = normalizePath(lines[index]!.slice(MOVE.length).trim(), index + 1);
        index += 1;
      }

      const hunks: PatchHunk[] = [];
      let current: PatchHunk | null = null;

      while (index < lines.length) {
        const body = lines[index]!;
        if (
          body.trim() === END ||
          body.startsWith(ADD) ||
          body.startsWith(DELETE) ||
          body.startsWith(UPDATE)
        ) {
          break;
        }

        if (body.startsWith('@@')) {
          current = { header: body.slice(2).trim(), lines: [], atEndOfFile: false };
          hunks.push(current);
          index += 1;
          continue;
        }

        if (body.trim() === EOF_MARKER) {
          if (current) current.atEndOfFile = true;
          index += 1;
          continue;
        }

        // A hunk body may begin without an @@ header; open one implicitly so
        // the common single-hunk case parses.
        if (!current) {
          current = { header: '', lines: [], atEndOfFile: false };
          hunks.push(current);
        }

        const marker = body[0];
        if (marker === '+') current.lines.push({ kind: 'add', text: body.slice(1) });
        else if (marker === '-') current.lines.push({ kind: 'remove', text: body.slice(1) });
        else if (marker === ' ') current.lines.push({ kind: 'context', text: body.slice(1) });
        else if (body === '') current.lines.push({ kind: 'context', text: '' });
        else {
          // An unprefixed line is almost always a context line the model forgot
          // to space-prefix. Rejecting the whole patch over it is worse than
          // treating it as context.
          current.lines.push({ kind: 'context', text: body });
        }
        index += 1;
      }

      ops.push({ kind: 'update', path, movePath, hunks });
      continue;
    }

    throw new PatchParseError(
      `Expected a file header ("${ADD.trim()}", "${DELETE.trim()}" or ` +
        `"${UPDATE.trim()}") but got: ${JSON.stringify(line.slice(0, 60))}`,
      index + 1,
    );
  }

  if (!sawEnd) {
    throw new PatchParseError(`A patch must end with "${END}".`, lines.length);
  }
  if (ops.length === 0) {
    throw new PatchParseError('The patch contained no file operations.', 1);
  }

  return ops;
}

/**
 * Normalises a model-supplied path to the sandbox's rooted form.
 *
 * The sandbox keys files as `/App.tsx`. Models variously emit `App.tsx`,
 * `./App.tsx`, and — despite the prompt — `src/App.tsx`. Normalising here means
 * one place decides, rather than every tool guessing.
 */
export function normalizePath(raw: string, line = 0): string {
  let path = raw.trim().replace(/\\/g, '/');

  if (path === '') {
    throw new PatchParseError('A file operation had an empty path.', line);
  }
  if (/^[a-zA-Z]:\//.test(path) || path.startsWith('//')) {
    throw new PatchParseError(
      `Paths must be project-relative, not absolute: ${raw}`,
      line,
    );
  }

  path = path.replace(/^\.\//, '');
  if (path.split('/').includes('..')) {
    throw new PatchParseError(`Paths may not contain "..": ${raw}`, line);
  }

  if (!path.startsWith('/')) path = `/${path}`;
  // The sandbox serves from the project root; `src/` is not a real prefix here
  // and letting both forms through creates two keys for one file.
  if (path.startsWith('/src/')) path = path.slice(4);

  return path;
}

/* ------------------------------------------------------------------------ */
/* Context matching                                                          */
/* ------------------------------------------------------------------------ */

type Normalizer = (value: string) => string;

/** Graduated fuzz. Order matters: the first match wins. */
const NORMALIZERS: Normalizer[] = [
  (value) => value,
  (value) => value.trimEnd(),
  (value) => value.trim(),
];

/**
 * Finds `needle` in `haystack` at or after `from`, widening tolerance only as
 * far as necessary. Returns -1 when no level matches.
 */
function seekSequence(
  haystack: string[],
  needle: string[],
  from: number,
): { index: number; fuzz: number } {
  if (needle.length === 0) return { index: from, fuzz: 0 };

  for (let level = 0; level < NORMALIZERS.length; level += 1) {
    const normalize = NORMALIZERS[level]!;
    const target = needle.map(normalize);

    for (let start = from; start + needle.length <= haystack.length; start += 1) {
      let matched = true;
      for (let offset = 0; offset < needle.length; offset += 1) {
        if (normalize(haystack[start + offset]!) !== target[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) return { index: start, fuzz: level };
    }
  }

  return { index: -1, fuzz: -1 };
}

/* ------------------------------------------------------------------------ */
/* Applying                                                                  */
/* ------------------------------------------------------------------------ */

export interface FileChange {
  kind: PatchOpKind;
  path: string;
  movePath?: string;
  before: string | null;
  after: string | null;
  added: number;
  removed: number;
  /** Highest fuzz level any hunk needed. 0 is an exact match. */
  fuzz: number;
}

export interface ApplyResult {
  files: FileMap;
  changes: FileChange[];
}

/**
 * Applies a parsed patch to a file map, returning a new map.
 *
 * The input map is never mutated: a failed patch must leave the project exactly
 * as it was, and a partially-applied multi-file patch is the worst possible
 * outcome in a live-preview product.
 */
export function applyPatch(files: FileMap, ops: PatchOp[]): ApplyResult {
  const next: FileMap = { ...files };
  const changes: FileChange[] = [];

  for (const op of ops) {
    if (op.kind === 'add') {
      if (next[op.path] !== undefined) {
        throw new PatchApplyError(
          `Cannot add ${op.path}: it already exists. Use "*** Update File: ${op.path}" instead.`,
          op.path,
        );
      }
      const contents = op.contents ?? '';
      next[op.path] = contents;
      changes.push({
        kind: 'add',
        path: op.path,
        before: null,
        after: contents,
        added: countLines(contents),
        removed: 0,
        fuzz: 0,
      });
      continue;
    }

    if (op.kind === 'delete') {
      const before = next[op.path];
      if (before === undefined) {
        throw new PatchApplyError(
          `Cannot delete ${op.path}: no such file in the project.`,
          op.path,
        );
      }
      delete next[op.path];
      changes.push({
        kind: 'delete',
        path: op.path,
        before,
        after: null,
        added: 0,
        removed: countLines(before),
        fuzz: 0,
      });
      continue;
    }

    const before = next[op.path];
    if (before === undefined) {
      throw new PatchApplyError(
        `Cannot update ${op.path}: no such file in the project. ` +
          `Use "*** Add File: ${op.path}" to create it.`,
        op.path,
      );
    }

    const { text, added, removed, fuzz } = applyHunks(before, op.hunks, op.path);
    const target = op.movePath ?? op.path;

    if (op.movePath) delete next[op.path];
    next[target] = text;

    changes.push({
      kind: 'update',
      path: op.path,
      movePath: op.movePath,
      before,
      after: text,
      added,
      removed,
      fuzz,
    });
  }

  return { files: next, changes };
}

function applyHunks(
  source: string,
  hunks: PatchHunk[],
  path: string,
): { text: string; added: number; removed: number; fuzz: number } {
  const lines = source.split('\n');
  let cursor = 0;
  let added = 0;
  let removed = 0;
  let worstFuzz = 0;

  const out: string[] = [];

  for (const hunk of hunks) {
    const anchor = hunk.lines.filter((line) => line.kind !== 'add');
    const anchorText = anchor.map((line) => line.text);

    let start: number;

    if (hunk.atEndOfFile && anchorText.length > 0) {
      // `*** End of File` pins the hunk to the tail, which disambiguates a
      // repeated snippet that appears both mid-file and at the end.
      const candidate = lines.length - anchorText.length;
      const probe = seekSequence(lines, anchorText, Math.max(cursor, candidate));
      start = probe.index;
      worstFuzz = Math.max(worstFuzz, Math.max(0, probe.fuzz));
    } else if (anchorText.length === 0) {
      // Pure insertion with no context. Only unambiguous at the very end.
      start = lines.length;
    } else {
      let searchFrom = cursor;

      // An `@@ header` narrows the search to after that line, which is how a
      // model disambiguates a snippet repeated across several functions.
      if (hunk.header) {
        const headerHit = seekSequence(lines, [hunk.header], cursor);
        if (headerHit.index !== -1) searchFrom = headerHit.index + 1;
      }

      const probe = seekSequence(lines, anchorText, searchFrom);
      start = probe.index;
      worstFuzz = Math.max(worstFuzz, Math.max(0, probe.fuzz));

      // Fall back to searching the whole file: models sometimes emit hunks out
      // of order, and the cursor would otherwise hide an earlier match.
      if (start === -1) {
        const retry = seekSequence(lines, anchorText, 0);
        start = retry.index;
        worstFuzz = Math.max(worstFuzz, Math.max(0, retry.fuzz));
      }
    }

    if (start === -1) {
      const preview = anchorText.slice(0, 3).join('\n');
      throw new PatchApplyError(
        `Could not locate this hunk in ${path}:\n\n${preview}\n\n` +
          'The context lines do not match the file. Read the file again with ' +
          '`read_file` and rebuild the patch from its current contents.',
        path,
      );
    }

    // Everything between the last hunk and this one passes through untouched.
    out.push(...lines.slice(cursor, start));

    let offset = start;
    for (const line of hunk.lines) {
      if (line.kind === 'add') {
        out.push(line.text);
        added += 1;
      } else if (line.kind === 'remove') {
        offset += 1;
        removed += 1;
      } else {
        // Keep the file's own text, not the model's copy of it, so a fuzzy
        // whitespace match does not silently reformat the line.
        out.push(lines[offset] ?? line.text);
        offset += 1;
      }
    }

    cursor = offset;
  }

  out.push(...lines.slice(cursor));

  return { text: out.join('\n'), added, removed, fuzz: worstFuzz };
}

const countLines = (text: string): number => {
  if (text === '') return 0;
  return text.replace(/\n$/, '').split('\n').length;
};
