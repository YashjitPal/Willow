/**
 * Flow's tool compiler, run in the page instead of a sandboxed frame: esbuild-wasm bundles a
 * tool's files into one ES module, with every npm import left external for the runner's import
 * map. The plugin is Flow's `virtual-fs` (its compiler frame, captured in
 * tools/ui-research/captures/flow/tools/frames/): entry resolution, relative and index lookups,
 * CSS turned into a `<style>` append, packages external, and a CSS import from a package dropped.
 *
 * esbuild may be initialised once per page, and the Code tab's bundler shares the module, so a
 * second `initialize` that fails with "more than once" means it is ready.
 */
import * as esbuild from 'esbuild-wasm';
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';

export interface ToolFile {
  path: string;
  content: string;
}

export type CompileResult =
  | { success: true; code: string; externalImports: string[] }
  | { success: false; errors: string[] };

const RESOLVE_EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js', '.css'];
const INDEX_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];
const LOADERS: Record<string, esbuild.Loader> = { tsx: 'tsx', ts: 'ts', jsx: 'jsx', js: 'js', json: 'json' };
const ENTRY_FALLBACKS = ['src/App.tsx', 'App.tsx', 'src/App.jsx', 'App.jsx', 'src/index.tsx', 'index.tsx', 'src/main.tsx', 'main.tsx', 'src/App.ts', 'App.ts'];

let ready: Promise<void> | null = null;

function initCompiler(): Promise<void> {
  if (!ready) {
    ready = esbuild
      .initialize(typeof window === 'undefined' ? { worker: false } : { wasmURL: esbuildWasmUrl, worker: false })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/initialize/.test(message) && /once/.test(message)) return;
        ready = null;
        throw error;
      });
  }
  return ready;
}

const normalise = (p: string): string => (p.startsWith('/') ? p.slice(1) : p);

/** Flow's entry rule: the named file, without `./` or `/`, under `src/`, then the usual names. */
export function resolveEntry(entry: string, files: ReadonlyMap<string, string>): string {
  if (files.has(entry)) return entry;
  const bare = entry.startsWith('./') ? entry.slice(2) : entry.startsWith('/') ? entry.slice(1) : entry;
  if (files.has(bare)) return bare;
  if (files.has(`src/${bare}`)) return `src/${bare}`;
  return ENTRY_FALLBACKS.find((candidate) => files.has(candidate)) ?? entry;
}

function joinRelative(importer: string | undefined, spec: string): string {
  const parts = importer ? importer.split('/').slice(0, -1).filter(Boolean) : [];
  for (const segment of spec.split('/').filter(Boolean)) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

function virtualFs(files: ReadonlyMap<string, string>): esbuild.Plugin {
  return {
    name: 'virtual-fs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const kind = args.kind === 'entry-point'
          ? 'entry-point'
          : args.path.startsWith('./') || args.path.startsWith('../')
            ? 'relative'
            : args.path.startsWith('.') || args.path.startsWith('/') ? 'fallback' : 'package';
        if (kind === 'entry-point') return { path: resolveEntry(args.path, files), namespace: 'virtual' };
        if (kind === 'package') {
          return args.path.endsWith('.css') ? { path: args.path, namespace: 'css-stub' } : { path: args.path, external: true };
        }
        if (kind === 'relative') {
          const base = joinRelative(args.importer, args.path);
          for (const ext of RESOLVE_EXTENSIONS) {
            if (files.has(`${base}${ext}`)) return { path: `${base}${ext}`, namespace: 'virtual' };
          }
          for (const ext of INDEX_EXTENSIONS) {
            if (files.has(`${base}/index${ext}`)) return { path: `${base}/index${ext}`, namespace: 'virtual' };
          }
          return base.endsWith('.css') ? { path: base, namespace: 'css-stub' } : { path: args.path, namespace: 'virtual' };
        }
        return { path: args.path, namespace: 'virtual' };
      });
      build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => {
        const content = files.get(args.path);
        if (content === undefined) return { errors: [{ text: `File not found: ${args.path}` }] };
        const ext = args.path.split('.').pop() || '';
        if (ext === 'css') {
          return {
            contents: `
                  const style = document.createElement('style');
                  style.textContent = ${JSON.stringify(content)};
                  document.head.appendChild(style);
                `,
            loader: 'js',
          };
        }
        return { contents: content, loader: LOADERS[ext] || 'tsx' };
      });
      build.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: '', loader: 'js' }));
    },
  };
}

const formatMessage = (m: esbuild.Message): string =>
  `${m.location ? `${m.location.file}:${m.location.line}: ` : ''}${m.text}`;

/** Compiles a tool as Flow's compiler frame does. Never throws; failures come back as errors. */
export async function compileTool(toolFiles: readonly ToolFile[], entryPoint = 'App.tsx'): Promise<CompileResult> {
  try {
    await initCompiler();
    const files = new Map<string, string>();
    for (const file of toolFiles) files.set(normalise(file.path), file.content);
    const entry = normalise(entryPoint || 'App.tsx');
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'esm',
      target: 'es2020',
      jsx: 'automatic',
      jsxImportSource: 'react',
      plugins: [virtualFs(files)],
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
      metafile: true,
    });
    if (result.errors.length > 0) return { success: false, errors: result.errors.map(formatMessage) };
    const code = result.outputFiles?.[0]?.text || '';
    const externalImports = Array.from(new Set(
      Object.values(result.metafile?.outputs ?? {}).flatMap((output) => (output.imports ?? []).filter((i) => i.external).map((i) => i.path)),
    ));
    return { success: true, code, externalImports };
  } catch (error) {
    const failure = error as { errors?: esbuild.Message[]; message?: string };
    if (Array.isArray(failure?.errors) && failure.errors.length) return { success: false, errors: failure.errors.map(formatMessage) };
    return { success: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}
