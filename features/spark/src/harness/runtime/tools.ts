/**
 * Tool implementations for the Spark harness.
 *
 * Each handler receives parsed arguments and a `ToolContext` whose entire
 * surface is "read the project files, write the project files". There is no
 * escape hatch, which is what makes the no-shell guarantee structural: a tool
 * *cannot* run a command here, because nothing in scope can.
 *
 * Handlers return an `observation` string. That text is fed back to the model
 * verbatim as the tool's result, so it is written for the model to read — dense,
 * unambiguous, and explicit about failure.
 */

import { normalizePath } from './apply-patch';
import type { ToolContext, ToolHandler, ToolResult } from './protocol';

const MAX_PREVIEW_LINES = 400;
const MAX_SEARCH_HITS = 40;

let counter = 0;
export const nextId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(counter += 1).toString(36)}`;

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/* ------------------------------------------------------------------------ */
/* read_file                                                                 */
/* ------------------------------------------------------------------------ */

const readFile: ToolHandler = {
  id: 'read_file',
  async run(args, context): Promise<ToolResult> {
    const rawPath = asString(args.path);
    if (!rawPath) {
      return { observation: 'read_file requires a "path" argument.', failed: true };
    }

    let path: string;
    try {
      path = normalizePath(rawPath);
    } catch (error) {
      return { observation: (error as Error).message, failed: true };
    }

    const files = context.readFiles();
    const contents = files[path];

    if (contents === undefined) {
      const available = Object.keys(files).sort().slice(0, 40);
      return {
        observation:
          `No file at ${path}.\n\nThe project currently contains:\n` +
          available.map((entry) => `  ${entry}`).join('\n'),
        failed: true,
      };
    }

    const all = contents.split('\n');
    const start = Math.max(1, asNumber(args.start_line) ?? 1);
    const end = Math.min(all.length, asNumber(args.end_line) ?? all.length);
    const slice = all.slice(start - 1, end).slice(0, MAX_PREVIEW_LINES);

    const id = context.emit({
      id: nextId('call'),
      kind: 'read',
      status: 'running',
      startedAt: Date.now(),
      path,
      range: [start, start + slice.length - 1],
      totalLines: all.length,
      preview: slice.slice(0, 24),
    });
    context.patch(id, { status: 'success', endedAt: Date.now() });

    const numbered = slice
      .map((line, index) => `${String(start + index).padStart(5)}  ${line}`)
      .join('\n');

    const truncated =
      slice.length < end - start + 1
        ? `\n\n[truncated at ${MAX_PREVIEW_LINES} lines; request a narrower range]`
        : '';

    return {
      observation: `${path} (${all.length} lines)\n\n${numbered}${truncated}`,
    };
  },
};

/* ------------------------------------------------------------------------ */
/* list_files                                                                */
/* ------------------------------------------------------------------------ */

const listFiles: ToolHandler = {
  id: 'list_files',
  async run(args, context): Promise<ToolResult> {
    const files = context.readFiles();
    const prefix = args.path ? normalizePath(asString(args.path)) : '/';

    const paths = Object.keys(files)
      .filter((path) => path.startsWith(prefix === '/' ? '/' : `${prefix}/`) || path === prefix)
      .sort();

    if (paths.length === 0) {
      return {
        observation: `No files under ${prefix}. The project is empty.`,
      };
    }

    const id = context.emit({
      id: nextId('call'),
      kind: 'list',
      status: 'running',
      startedAt: Date.now(),
      path: prefix,
      entries: paths.map((path) => ({
        name: path,
        type: 'file' as const,
        size: files[path]!.length,
      })),
    });
    context.patch(id, { status: 'success', endedAt: Date.now() });

    const listing = paths
      .map((path) => {
        const lines = files[path]!.split('\n').length;
        return `  ${path}  (${lines} lines)`;
      })
      .join('\n');

    return { observation: `${paths.length} files:\n${listing}` };
  },
};

/* ------------------------------------------------------------------------ */
/* search_files                                                              */
/* ------------------------------------------------------------------------ */

const searchFiles: ToolHandler = {
  id: 'search_files',
  async run(args, context): Promise<ToolResult> {
    const query = asString(args.query ?? args.pattern);
    if (!query) {
      return {
        observation: 'search_files requires a "query" argument.',
        failed: true,
      };
    }

    const files = context.readFiles();
    const useRegex = args.regex === true;

    let test: (line: string) => number;
    if (useRegex) {
      let expression: RegExp;
      try {
        expression = new RegExp(query, 'i');
      } catch (error) {
        return {
          observation: `Invalid regular expression: ${(error as Error).message}`,
          failed: true,
        };
      }
      test = (line) => line.search(expression);
    } else {
      const needle = query.toLowerCase();
      test = (line) => line.toLowerCase().indexOf(needle);
    }

    const hits: { path: string; line: number; text: string; match: [number, number] }[] = [];
    const touched = new Set<string>();

    for (const path of Object.keys(files).sort()) {
      const lines = files[path]!.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        const at = test(lines[index]!);
        if (at === -1) continue;
        touched.add(path);
        if (hits.length < MAX_SEARCH_HITS) {
          const text = lines[index]!;
          hits.push({
            path,
            line: index + 1,
            text: text.length > 200 ? `${text.slice(0, 200)}…` : text,
            match: [at, at + query.length],
          });
        }
      }
    }

    const id = context.emit({
      id: nextId('call'),
      kind: 'search',
      status: 'running',
      startedAt: Date.now(),
      query,
      scope: '/',
      hits,
      fileCount: touched.size,
    });
    context.patch(id, { status: 'success', endedAt: Date.now() });

    if (hits.length === 0) {
      return { observation: `No matches for ${JSON.stringify(query)}.` };
    }

    const rendered = hits
      .map((hit) => `${hit.path}:${hit.line}: ${hit.text.trim()}`)
      .join('\n');

    return {
      observation:
        `${hits.length} match(es) in ${touched.size} file(s):\n${rendered}` +
        (hits.length === MAX_SEARCH_HITS ? '\n[results truncated]' : ''),
    };
  },
};

/* ------------------------------------------------------------------------ */
/* update_plan                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Mirrors upstream's `update_plan`. Kept deliberately close to the vendored
 * prompt's description of it, since that text is what the model is following.
 */
const updatePlan: ToolHandler = {
  id: 'update_plan',
  async run(args, context): Promise<ToolResult> {
    const raw = Array.isArray(args.plan) ? args.plan : Array.isArray(args.steps) ? args.steps : [];

    const steps = raw
      .map((entry) => {
        if (typeof entry === 'string') {
          return { text: entry, status: 'pending' as const };
        }
        if (entry && typeof entry === 'object') {
          const item = entry as Record<string, unknown>;
          const status = asString(item.status, 'pending');
          return {
            text: asString(item.step ?? item.text ?? item.title),
            status:
              status === 'in_progress' || status === 'completed'
                ? (status as 'in_progress' | 'completed')
                : ('pending' as const),
          };
        }
        return null;
      })
      .filter((step): step is { text: string; status: 'pending' | 'in_progress' | 'completed' } =>
        Boolean(step && step.text),
      );

    if (steps.length === 0) {
      return {
        observation:
          'update_plan requires a "plan" array of { step, status } objects, ' +
          'where status is "pending", "in_progress" or "completed".',
        failed: true,
      };
    }

    const id = context.emit({
      id: nextId('call'),
      kind: 'plan',
      status: 'running',
      startedAt: Date.now(),
      steps,
      explanation: asString(args.explanation) || undefined,
    });
    context.patch(id, { status: 'success', endedAt: Date.now() });

    const done = steps.filter((step) => step.status === 'completed').length;
    return {
      observation: `Plan updated (${done}/${steps.length} complete). Do not repeat it back to the user.`,
    };
  },
};

/* ------------------------------------------------------------------------ */
/* add_dependency                                                            */
/* ------------------------------------------------------------------------ */

/**
 * A Willow addition with no upstream equivalent.
 *
 * Without it the model reaches for `npm install`, which does not exist here.
 * Giving the intent somewhere legitimate to land is what stops the attempts —
 * and it edits `package.json`, so the sandbox actually installs the package.
 */
const addDependency: ToolHandler = {
  id: 'add_dependency',
  async run(args, context): Promise<ToolResult> {
    const name = asString(args.name ?? args.package).trim();
    const version = asString(args.version, 'latest').trim() || 'latest';

    if (!name) {
      return { observation: 'add_dependency requires a "name".', failed: true };
    }
    if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(name)) {
      return {
        observation: `${JSON.stringify(name)} is not a valid npm package name.`,
        failed: true,
      };
    }

    const files = context.readFiles();
    const manifestPath = '/package.json';

    let manifest: Record<string, unknown>;
    try {
      manifest = files[manifestPath]
        ? (JSON.parse(files[manifestPath]!) as Record<string, unknown>)
        : { name: 'sandbox-app', private: true, dependencies: {} };
    } catch {
      return {
        observation:
          '/package.json is not valid JSON, so the dependency could not be added. ' +
          'Read it and repair it with apply_patch first.',
        failed: true,
      };
    }

    const dependencies = (manifest.dependencies ?? {}) as Record<string, string>;
    const previous = dependencies[name];

    const id = context.emit({
      id: nextId('call'),
      kind: 'dependency',
      status: 'running',
      startedAt: Date.now(),
      name,
      version,
      output: [{ stream: 'stdout', text: `add ${name}@${version}\n` }],
    });

    dependencies[name] = version;
    manifest.dependencies = Object.fromEntries(
      Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
    );

    context.writeFiles({
      ...files,
      [manifestPath]: `${JSON.stringify(manifest, null, 2)}\n`,
    });

    context.patch(id, {
      status: 'success',
      endedAt: Date.now(),
      output: [
        { stream: 'stdout', text: `add ${name}@${version}\n` },
        {
          stream: 'stdout',
          text: previous
            ? `updated ${name} ${previous} -> ${version}\n`
            : `added ${name}@${version} to dependencies\n`,
        },
        { stream: 'stdout', text: 'package.json written; sandbox will reinstall\n' },
      ],
    } as Partial<import('./protocol').DependencyCall>);

    return {
      observation:
        `${previous ? 'Updated' : 'Added'} ${name}@${version} in /package.json. ` +
        'The sandbox installs it on the next bundle. You may import it now.',
    };
  },
};

/* ------------------------------------------------------------------------ */
/* Registry                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * The file tools. `task` lives in `agent.ts` because it needs the turn loop,
 * and `apply_patch` is not here at all — it arrives as a patch envelope rather
 * than a `*** Call:` block, and is handled by the streaming parser.
 */
export const FILE_TOOLS: ToolHandler[] = [
  readFile,
  listFiles,
  searchFiles,
  updatePlan,
  addDependency,
];

export function toolRegistry(extra: ToolHandler[] = []): Map<string, ToolHandler> {
  const map = new Map<string, ToolHandler>();
  for (const handler of [...FILE_TOOLS, ...extra]) map.set(handler.id, handler);
  return map;
}

export type { ToolContext };
