/**
 * The Code tab's highlighting, as Flow's code explorer does it: highlight.js over the whole file
 * with Flow's extension map and grammar tweaks (function names and CONSTANTS as titles and
 * symbols, no object-key colouring, TypeScript inside `{…}` in HTML), then split into lines with
 * the open spans carried across each break (R0b in its bundle).
 */
import hljs from 'highlight.js/lib/core';
import type { LanguageFn, Mode } from 'highlight.js';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

const IDENT = '[_$a-zA-Z\\xA0-\\uFFFF][$\\w\\xA0-\\uFFFF]*';
const KEYWORDS = 'as|assert|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield';

const METHOD_CALL: Mode = { begin: `\\.${IDENT}(?=\\s*\\()`, returnBegin: true, contains: [{ className: 'title', begin: IDENT }], relevance: 0 };
const ARROW_DEFINITION: Mode = {
  className: 'title',
  begin: `${IDENT}(?=\\s*[=:]\\s*(?:async\\s*)?(?:\\bfunction\\b|(?:\\((?:[^()]|\\([^()]*\\))*\\)|${IDENT})\\s*=>))`,
  relevance: 0,
};
const CALL: Mode = { className: 'title', begin: `\\b(?!${KEYWORDS}\\b)${IDENT}(?=\\s*(\\(\\s*|:\\s*\\())`, relevance: 0 };
const CONSTANT: Mode = { className: 'symbol', begin: '\\b[A-Z](?:[A-Z_]|\\dx?)*\\b', relevance: 0 };

const withTitles = (language: LanguageFn): LanguageFn => (api) => {
  const grammar = language(api);
  if (Array.isArray(grammar.contains)) {
    grammar.contains = grammar.contains.filter((mode) => {
      const inner = (mode as Mode).contains;
      return !(Array.isArray(inner) && inner.some((m) => (m as Mode).className === 'attr'));
    });
    grammar.contains.unshift(METHOD_CALL, ARROW_DEFINITION, CALL, CONSTANT);
  }
  return grammar;
};

const withScripts = (language: LanguageFn): LanguageFn => (api) => {
  const grammar = language(api);
  const nested: Mode = { begin: /\{/, end: /\}/, subLanguage: 'typescript', contains: ['self'] as never };
  const attribute: Mode = { begin: /=\s*\{/, end: /\}/, subLanguage: 'typescript', contains: [nested] };
  const block: Mode = { begin: /\{/, end: /\}/, subLanguage: 'typescript', contains: [nested] };
  if (Array.isArray(grammar.contains)) {
    for (const mode of grammar.contains as Mode[]) {
      if (mode.className !== 'tag' || !Array.isArray(mode.contains)) continue;
      for (const inner of mode.contains as Mode[]) {
        const starts = inner.starts;
        if (inner.className === 'name' && Array.isArray(starts?.contains)) starts!.contains!.unshift(attribute);
      }
    }
    grammar.contains.push(block);
  }
  return grammar;
};

let registered = false;
function register(): void {
  if (registered) return;
  registered = true;
  const ts = withTitles(typescript);
  const js = withTitles(javascript);
  const html = withScripts(xml);
  for (const name of ['typescript', 'ts', 'tsx']) hljs.registerLanguage(name, ts);
  for (const name of ['javascript', 'js', 'jsx']) hljs.registerLanguage(name, js);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('html', html);
  hljs.registerLanguage('xml', html);
  hljs.registerLanguage('json', json);
}

const LANGUAGES: Record<string, string> = {
  css: 'css', html: 'html', xml: 'xml', json: 'json',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
};

export const languageFor = (path: string): string => LANGUAGES[path.split('.').pop()?.toLowerCase() ?? ''] ?? '';

/** The file list's glyph: `css`, `code` for scripts, `description` for the rest. */
export const fileIcon = (path: string): string =>
  path.endsWith('.css') ? 'css' : /\.(js|ts|tsx|jsx)$/.test(path) ? 'code' : 'description';

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Highlighted HTML split into lines, each closing the spans it opened and reopening the ones it inherited. */
export function splitHighlightedLines(html: string): string[] {
  if (!html) return [];
  const lines = html.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const out: string[] = [];
  const open: string[] = [];
  for (const line of lines) {
    const prefix = open.join('');
    for (const match of line.matchAll(/<\/?span[^>]*>/g)) {
      if (match[0].startsWith('</')) open.pop();
      else open.push(match[0]);
    }
    out.push(prefix + line + '</span>'.repeat(open.length));
  }
  return out;
}

/** One file as the explorer's lines of HTML. Text it cannot highlight is escaped as is. */
export function highlightLines(path: string, content: string): string[] {
  if (!content) return [];
  register();
  const language = languageFor(path);
  let html: string;
  try {
    html = language ? hljs.highlight(content, { language, ignoreIllegals: true }).value : escapeHtml(content);
  } catch {
    html = escapeHtml(content);
  }
  return splitHighlightedLines(html);
}
