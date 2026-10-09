/**
 * `create_design` — the Design tool, as the model calls it.
 *
 * Puts a screen on the Design canvas: a mockup to look at and compare, apart
 * from the app. The screen is written first as an ordinary file under
 * `/Designs/`, with the same action that writes every other file, so the code
 * never travels inside a JSON string; this tool only places it. The canvas
 * renders each screen on its own, so a screen must be one self-contained
 * component.
 */

import { nextId } from './protocol';
import type { HarnessTool } from './tools';
import { PathError } from './workspace';

export interface DesignToolOptions {
  /** Puts the screen on the canvas and returns its node id. */
  addToCanvas: (design: { name: string; code: string; fileName: string }) => string;
  /** Builds and renders the screen on its own; a problem to report, or null. */
  validate?: (code: string) => Promise<string | null>;
}

const ALLOWED_IMPORT = /^(react|react-dom|lucide-react)(\/|$)/;

const humanize = (fileName: string): string =>
  fileName.replace(/Design$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim() || 'Design';

/** The modules a file imports, by specifier. */
export function importedModules(code: string): string[] {
  return [...code.matchAll(/^\s*import\s[^;]*?['"]([^'"]+)['"]/gm)].map((match) => match[1]!);
}

export function makeDesignTool(options: DesignToolOptions): HarnessTool {
  return {
    name: 'create_design',
    description:
      'Puts a screen on the Design canvas: a mockup to look at and compare, kept apart from the app. First write the screen with an action to /Designs/<Name>.tsx as one self-contained component — a default export using React, Tailwind classes and lucide-react icons only, with no imports from the project — then call this with its path.',
    signature: '{"path": "/Designs/PricingPage.tsx", "name": "Pricing page"}',
    readOnly: false,
    source: 'builtin',
    startStep: (args) => ({
      id: nextId('step'),
      kind: 'design',
      name: String(args.name ?? args.path ?? 'Design').trim().slice(0, 80),
      status: 'running',
    }),
    async run(args, context) {
      let path: string;
      try {
        path = context.workspace.resolvePath(String(args.path ?? args.file ?? ''));
      } catch (error) {
        if (error instanceof PathError) return { output: `${error.message} Pass the path of the screen you wrote, like /Designs/PricingPage.tsx.`, isError: true, step: { status: 'error', error: 'Invalid path' } };
        throw error;
      }
      if (!/^\/Designs\/[^/]+\.(tsx|jsx)$/.test(path)) {
        return { output: `Designs live in /Designs/ as one .tsx file each; ${path} is not one.`, isError: true, step: { status: 'error', error: 'Not a design file' } };
      }
      const code = context.workspace.read(path);
      if (code === undefined) {
        return { output: `There is no ${path} yet. Write it with an action first, then call create_design.`, isError: true, step: { status: 'error', error: 'File not written' } };
      }
      if (!/export\s+default\b/.test(code)) {
        return { output: `${path} has no default export. Export the screen component as default.`, isError: true, step: { status: 'error', error: 'No default export' } };
      }
      const outside = importedModules(code).filter((specifier) => !ALLOWED_IMPORT.test(specifier));
      if (outside.length > 0) {
        return {
          output: `A design screen can only import react and lucide-react; ${path} imports ${outside.join(', ')}. Put everything it needs in the one file.`,
          isError: true,
          step: { status: 'error', error: 'Imports from outside' },
        };
      }
      const problem = await options.validate?.(code);
      if (problem) return { output: `${path} does not run on its own:\n${problem}`, isError: true, step: { status: 'error', error: 'Does not run' } };

      const fileName = path.slice('/Designs/'.length).replace(/\.(tsx|jsx)$/, '');
      const name = String(args.name ?? '').trim().slice(0, 80) || humanize(fileName);
      const nodeId = options.addToCanvas({ name, code, fileName });
      return { output: `Put ${path} on the Design canvas as "${name}". The user can open it from the chat.`, step: { status: 'done', name, nodeId } };
    },
  };
}
