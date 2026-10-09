/**
 * The Tool Builder's tools, forked from the Code harness's (`features/code/src/harness/tools.ts`),
 * and the one interface every tool source implements.
 *
 * A tool is a question the model asks: it is called with
 * `<willow-tool name="…">{json}</willow-tool>`, runs after the reply ends, and
 * its output comes back as the next message. Changes to the project are not
 * tools — they are actions, applied the instant their tag closes.
 *
 * Built-in tools, skills (`read_skill`) and connectors (MCP servers) all arrive
 * as `HarnessTool`s, so the turn loop dispatches all three the same way and a
 * new source — another connector protocol, a web fetcher — is one more array
 * passed to `runTurn`, not a change to the loop.
 */

import { nextId, type TurnMode, type TurnStep } from './protocol';
import { isBinaryAsset, PathError, type Workspace } from './workspace';
import type { CheckReport } from './verify';
import { formatCheckReport, summarizeCheck } from './verify';

export interface ToolContext {
  workspace: Workspace;
  signal?: AbortSignal;
  /** Builds and runs the project as it stands in the workspace. */
  check: () => Promise<CheckReport>;
  /** Ids of the skills read with `read_skill` this turn. */
  readSkills: Set<string>;
  mode: TurnMode;
  /** For a tool that shows more than one step, such as a batch of computer actions. */
  record: {
    add: (step: TurnStep) => string;
    patch: (id: string, patch: Partial<TurnStep>) => void;
  };
}

/** A picture handed to the model with a tool's output, e.g. a screenshot. */
export interface ToolImage {
  mimeType: string;
  /** Base64, no data-URL prefix. */
  data: string;
}

export interface ToolRunResult {
  /** Handed to the model verbatim. Written for it to read. */
  output: string;
  isError?: boolean;
  /** Fields to update on the tool's transcript step. */
  step?: Partial<TurnStep>;
  /** Pictures the model sees with the output. */
  images?: ToolImage[];
  /** Ends the turn after this round, with the user's go-ahead pending. */
  endTurn?: 'awaiting-approval';
}

export interface HarnessTool {
  name: string;
  /** One line for the prompt's tool list. */
  description: string;
  /** Argument shape, as the prompt shows it: `{"path": "/App.tsx"}`. */
  signature: string;
  /** Plan mode only offers tools that cannot change the project. */
  readOnly: boolean;
  /** Where the tool came from, for grouping in the prompt. */
  source: 'builtin' | 'skill' | 'connector';
  /** The step the transcript shows while it runs, or null for none. */
  startStep: (args: Record<string, unknown>) => TurnStep | null;
  run: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolRunResult>;
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNumber = (value: unknown): number | undefined => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
};

/** The path argument, under any of the names models use for it. */
const pathArg = (args: Record<string, unknown>): string =>
  asString(args.path ?? args.file ?? args.file_path ?? args.filePath ?? args.filename);

const MAX_READ_LINES = 1_500;
const MAX_READ_CHARS = 80_000;
const MAX_SEARCH_HITS = 60;

/* ------------------------------------------------------------------------ */
/* read_file                                                                 */
/* ------------------------------------------------------------------------ */

export const readFileTool: HarnessTool = {
  name: 'read_file',
  description: "Returns a file's current contents. Optionally a line range.",
  signature: '{"path": "/components/Header.tsx", "start_line"?: 1, "end_line"?: 120}',
  readOnly: true,
  source: 'builtin',
  startStep: (args) => ({ id: nextId('step'), kind: 'read', path: pathArg(args) || '(no path)', status: 'running' }),
  async run(args, { workspace }) {
    const raw = pathArg(args);
    if (!raw) return { output: 'read_file needs a "path".', isError: true, step: { status: 'error' } };

    let path: string;
    try {
      path = workspace.resolvePath(raw);
    } catch (error) {
      return { output: (error as Error).message, isError: true, step: { status: 'error' } };
    }

    const contents = workspace.read(path);
    if (contents === undefined) {
      const similar = workspace.similarPaths(path);
      return {
        output:
          `${path} does not exist.` +
          (similar.length > 0 ? ` Similar files: ${similar.join(', ')}.` : ` The project has: ${workspace.paths().slice(0, 40).join(', ')}.`),
        isError: true,
        step: { path, status: 'error' },
      };
    }
    if (isBinaryAsset(path, contents)) {
      return {
        output: `${path} is a binary asset (${Math.round(contents.length / 1024)} KB as a data URL). Import it by path; its contents are not text.`,
        step: { path, status: 'done' },
      };
    }

    const lines = contents.replace(/\n$/, '').split('\n');
    const start = Math.max(1, Math.floor(asNumber(args.start_line) ?? 1));
    const requestedEnd = Math.floor(asNumber(args.end_line) ?? lines.length);
    let end = Math.min(lines.length, Math.max(start, requestedEnd));
    if (end - start + 1 > MAX_READ_LINES) end = start + MAX_READ_LINES - 1;

    let body = lines.slice(start - 1, end).join('\n');
    let note = '';
    if (body.length > MAX_READ_CHARS) {
      body = body.slice(0, MAX_READ_CHARS);
      note = '\n[…truncated; request a narrower line range]';
    } else if (end < lines.length) {
      note = `\n[lines ${start}–${end} of ${lines.length}; request more with start_line/end_line]`;
    }

    const range = start === 1 && end === lines.length ? `${lines.length} lines` : `lines ${start}–${end} of ${lines.length}`;
    return {
      output: `<file path="${path}" ${range.startsWith('lines') ? `range="${range}"` : `lines="${lines.length}"`}>\n${body}\n</file>${note}`,
      step: { path, status: 'done' },
    };
  },
};

/* ------------------------------------------------------------------------ */
/* list_files                                                                */
/* ------------------------------------------------------------------------ */

export const listFilesTool: HarnessTool = {
  name: 'list_files',
  description: 'Lists project files with their sizes, optionally under a folder.',
  signature: '{"path"?: "/components"}',
  readOnly: true,
  source: 'builtin',
  startStep: (args) => ({ id: nextId('step'), kind: 'list', path: pathArg(args) || '/', status: 'running' }),
  async run(args, { workspace }) {
    const raw = pathArg(args).replace(/\/+$/, '');
    const prefix = raw ? (raw.startsWith('/') ? raw : `/${raw}`) : '';
    const paths = workspace.paths().filter((path) => !prefix || path === prefix || path.startsWith(`${prefix}/`));
    if (paths.length === 0) {
      return {
        output: prefix ? `No files under ${prefix}.` : 'The project has no files yet.',
        step: { status: 'done' },
      };
    }
    const listing = paths.map((path) => {
      const contents = workspace.read(path)!;
      return isBinaryAsset(path, contents)
        ? `${path}  (binary asset)`
        : `${path}  (${contents.replace(/\n$/, '').split('\n').length} lines)`;
    });
    return { output: `${paths.length} file${paths.length === 1 ? '' : 's'}:\n${listing.join('\n')}`, step: { status: 'done' } };
  },
};

/* ------------------------------------------------------------------------ */
/* search_files                                                              */
/* ------------------------------------------------------------------------ */

export const searchFilesTool: HarnessTool = {
  name: 'search_files',
  description: 'Finds lines matching text (or a regex) across the project, with line numbers.',
  signature: '{"query": "useCart", "regex"?: false, "path"?: "/components"}',
  readOnly: true,
  source: 'builtin',
  startStep: (args) => ({
    id: nextId('step'),
    kind: 'search',
    query: asString(args.query ?? args.pattern ?? args.text) || '(empty)',
    status: 'running',
  }),
  async run(args, { workspace }) {
    const query = asString(args.query ?? args.pattern ?? args.text);
    if (!query) return { output: 'search_files needs a "query".', isError: true, step: { status: 'error' } };

    let test: (line: string) => boolean;
    if (args.regex === true || args.regex === 'true') {
      let expression: RegExp;
      try {
        expression = new RegExp(query, 'i');
      } catch (error) {
        return { output: `Invalid regular expression: ${(error as Error).message}`, isError: true, step: { status: 'error' } };
      }
      test = (line) => expression.test(line);
    } else {
      const needle = query.toLowerCase();
      test = (line) => line.toLowerCase().includes(needle);
    }

    const scope = pathArg(args).replace(/\/+$/, '');
    const prefix = scope ? (scope.startsWith('/') ? scope : `/${scope}`) : '';
    const hits: string[] = [];
    const files = new Set<string>();
    let total = 0;
    for (const path of workspace.paths()) {
      if (prefix && path !== prefix && !path.startsWith(`${prefix}/`)) continue;
      const contents = workspace.read(path)!;
      if (isBinaryAsset(path, contents)) continue;
      const lines = contents.split('\n');
      lines.forEach((line, index) => {
        if (!test(line)) return;
        total += 1;
        files.add(path);
        if (hits.length < MAX_SEARCH_HITS) {
          const text = line.trim();
          hits.push(`${path}:${index + 1}: ${text.length > 220 ? `${text.slice(0, 220)}…` : text}`);
        }
      });
    }

    if (total === 0) return { output: `No matches for ${JSON.stringify(query)}.`, step: { status: 'done', matches: 0 } };
    return {
      output:
        `${total} match${total === 1 ? '' : 'es'} in ${files.size} file${files.size === 1 ? '' : 's'}:\n${hits.join('\n')}` +
        (total > hits.length ? `\n[${total - hits.length} more not shown; narrow the query]` : ''),
      step: { status: 'done', matches: total },
    };
  },
};

/* ------------------------------------------------------------------------ */
/* check_project                                                             */
/* ------------------------------------------------------------------------ */

export const checkProjectTool: HarnessTool = {
  name: 'check_project',
  description:
    "Builds and runs the app as it is now, and reports build errors, runtime errors, console output and an outline of what rendered. Use it to look into a problem the user describes before you change anything. You don't need it after making changes: Willow checks automatically when you finish.",
  signature: '{}',
  readOnly: true,
  source: 'builtin',
  startStep: () => ({ id: nextId('step'), kind: 'check', status: 'running' }),
  async run(_args, { check }) {
    const report = await check();
    const summary = summarizeCheck(report);
    return {
      output: formatCheckReport(report, { includeOutline: true }),
      step: { status: 'done', errors: summary.errors, warnings: summary.warnings, skipped: report.skipped },
    };
  },
};

/* ------------------------------------------------------------------------ */
/* propose_plan                                                              */
/* ------------------------------------------------------------------------ */

/** The Plan tool, as the model calls it: stop on a plan and wait for a go-ahead. */
export const proposePlanTool: HarnessTool = {
  name: 'propose_plan',
  description:
    "Stops and waits for the user's go-ahead on the plan you just wrote, instead of building it. Only for a large or genuinely ambiguous request, where building the wrong thing would waste the user's time — never for a small or clear one. Write the plan in your reply, then call this last; the user gets an Implement plan button.",
  signature: '{}',
  readOnly: true,
  source: 'builtin',
  startStep: () => null,
  async run() {
    return { output: 'The plan is waiting for the user to approve it.', endTurn: 'awaiting-approval' };
  },
};

/** Flow's Tool Builder has no Plan mode, so `propose_plan` is kept here but not offered. */
export const BUILTIN_TOOLS: HarnessTool[] = [readFileTool, listFilesTool, searchFilesTool, checkProjectTool];

/** Parses a tool body. Fences and a bare path are tolerated; anything else must be JSON. */
export function parseToolArgs(body: string, attrs: Record<string, string>): Record<string, unknown> {
  const fromAttrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key !== 'name') fromAttrs[key] = value;
  }

  let text = body.trim();
  const fence = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(text);
  if (fence) text = fence[1]!.trim();
  if (!text) return fromAttrs;

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...fromAttrs, ...(parsed as Record<string, unknown>) };
    }
  } catch {
    // A JSON object followed by stray prose: take the object.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (parsed && typeof parsed === 'object') return { ...fromAttrs, ...(parsed as Record<string, unknown>) };
      } catch {
        /* fall through */
      }
    }
    if (!text.includes('{') && !text.includes('\n')) return { ...fromAttrs, path: text.replace(/^["']|["']$/g, '') };
    throw new Error(`The arguments are not valid JSON: ${text.slice(0, 160)}`);
  }
  return fromAttrs;
}

export { PathError };
