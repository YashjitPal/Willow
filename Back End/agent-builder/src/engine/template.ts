/**
 * `{{ ... }}` variable templating.
 *
 * Inside the braces any CEL expression is allowed (a superset of Agent
 * Builder's variable picker): `{{workflow.input_as_text}}`, `{{state.count}}`,
 * `{{my_agent.output_text}}`, `{{state.items[0]}}`, `{{size(state.items)}}`.
 *
 * Rendering rules: strings render verbatim; null renders as ''; everything
 * else renders as JSON.
 */

import { evaluateCel, type CelValue } from './cel/index.ts';

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

export function renderValue(v: CelValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * Find the `}}` that closes a `{{` at position `open+2`, skipping any `}}`
 * that appears inside a CEL string literal (single, double, or triple quoted).
 * Returns the index of the closing `}}`, or -1 if unterminated.
 */
function findClosingBraces(s: string, from: number): number {
  let i = from;
  const n = s.length;
  let quote: string | null = null;
  let triple = false;
  while (i < n) {
    const c = s[i];
    if (quote) {
      if (!triple && c === '\\') {
        i += 2;
        continue;
      }
      if (triple && s.startsWith(quote.repeat(3), i)) {
        i += 3;
        quote = null;
        triple = false;
        continue;
      }
      if (!triple && c === quote) {
        quote = null;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      if (s.startsWith(c.repeat(3), i)) {
        triple = true;
        quote = c;
        i += 3;
        continue;
      }
      quote = c;
      i++;
      continue;
    }
    if (c === '}' && s[i + 1] === '}') return i;
    i++;
  }
  return -1;
}

/** Render a template string against the variable scope. */
export function renderTemplate(template: string, vars: Record<string, CelValue>): string {
  if (!template.includes('{{')) return template;
  let out = '';
  let i = 0;
  const n = template.length;
  while (i < n) {
    const open = template.indexOf('{{', i);
    if (open === -1) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const close = findClosingBraces(template, open + 2);
    if (close === -1) {
      // Unterminated braces: emit the rest verbatim.
      out += template.slice(open);
      break;
    }
    const expr = template.slice(open + 2, close).trim();
    if (expr === '') {
      out += '';
    } else {
      try {
        out += renderValue(evaluateCel(expr, vars));
      } catch (e) {
        throw new TemplateError(`in '{{${expr}}}': ${(e as Error).message}`);
      }
    }
    i = close + 2;
  }
  return out;
}

/**
 * Resolve a config value that may be:
 *  - a `$cel:`-prefixed string  -> evaluated as CEL, returns the raw value
 *  - a plain string             -> template-rendered, returns a string
 *  - an object/array            -> recursively resolved
 *  - anything else              -> returned as-is
 */
export function resolveConfigValue(value: unknown, vars: Record<string, CelValue>): CelValue {
  if (typeof value === 'string') {
    if (value.startsWith('$cel:')) {
      return evaluateCel(value.slice('$cel:'.length).trim(), vars);
    }
    // A template that is exactly one expression returns the raw value
    // (so `{{state.items}}` passes a list, not its JSON string).
    const m = /^\{\{([^]*)\}\}$/.exec(value.trim());
    if (m && !m[1].includes('{{')) {
      try {
        return evaluateCel(m[1].trim(), vars);
      } catch (e) {
        throw new TemplateError(`in '${value}': ${(e as Error).message}`);
      }
    }
    return renderTemplate(value, vars);
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveConfigValue(v, vars));
  }
  if (value !== null && typeof value === 'object') {
    const out: { [k: string]: CelValue } = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveConfigValue(v, vars);
    return out;
  }
  return (value ?? null) as CelValue;
}
