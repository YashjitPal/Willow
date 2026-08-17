/**
 * A small, synchronous syntax highlighter.
 *
 * Diff and terminal lines reveal one at a time while a tool call streams, so
 * highlighting has to be cheap and non-blocking. `highlight.js` is in the repo
 * but is a full grammar engine measured in hundreds of kilobytes and is
 * document-oriented; this tokenizer is deliberately approximate, runs per
 * visible line, and is linear in line length.
 *
 * Per-line independence is what makes streaming reveal cheap: no state carries
 * across lines, so a line can be highlighted the moment it arrives and never
 * needs revisiting.
 */

export type TokenType =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'function'
  | 'type'
  | 'property'
  | 'operator'
  | 'punctuation'
  | 'tag'
  | 'attr'
  | 'variable'
  | 'constant';

export interface Token {
  type: TokenType;
  value: string;
}

export type Language = 'typescript' | 'json' | 'css' | 'html' | 'markdown' | 'shell' | 'plain';

const TS_KEYWORDS =
  'as|async|await|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|is|keyof|let|new|of|private|protected|public|readonly|return|satisfies|set|static|super|switch|this|throw|try|type|typeof|var|void|while|yield';

const TS_CONSTANTS = 'true|false|null|undefined|NaN|Infinity';

const TS_TYPES =
  'any|bigint|boolean|never|number|object|string|symbol|unknown|Array|Promise|Record|Partial|Readonly|Map|Set|Date|RegExp|Error';

interface Rule {
  type: TokenType;
  pattern: string;
}

const TS_RULES: Rule[] = [
  { type: 'comment', pattern: String.raw`\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)` },
  {
    type: 'string',
    pattern: '`(?:\\\\.|[^`\\\\])*`' + String.raw`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'`,
  },
  { type: 'number', pattern: String.raw`\b0[xXbBoO][\da-fA-F_]+n?\b|\b\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?n?\b` },
  { type: 'keyword', pattern: String.raw`\b(?:${TS_KEYWORDS})\b` },
  { type: 'constant', pattern: String.raw`\b(?:${TS_CONSTANTS})\b|\b[A-Z][A-Z0-9_]{2,}\b` },
  { type: 'type', pattern: String.raw`\b(?:${TS_TYPES})\b|\b[A-Z][A-Za-z0-9_]*\b` },
  { type: 'function', pattern: String.raw`\b[a-zA-Z_$][\w$]*(?=\s*\()` },
  { type: 'property', pattern: String.raw`(?<=\.)[a-zA-Z_$][\w$]*` },
  { type: 'operator', pattern: String.raw`=>|\.{3}|[+\-*/%!<>=&|^~?:]+` },
  { type: 'punctuation', pattern: String.raw`[{}()\[\];,.]` },
];

const RULES: Record<Language, Rule[]> = {
  typescript: TS_RULES,
  json: [
    { type: 'property', pattern: String.raw`"(?:\\.|[^"\\])*"(?=\s*:)` },
    { type: 'string', pattern: String.raw`"(?:\\.|[^"\\])*"` },
    { type: 'number', pattern: String.raw`-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b` },
    { type: 'constant', pattern: String.raw`\b(?:true|false|null)\b` },
    { type: 'punctuation', pattern: String.raw`[{}\[\]:,]` },
  ],
  css: [
    { type: 'comment', pattern: String.raw`\/\*[\s\S]*?(?:\*\/|$)` },
    { type: 'string', pattern: String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'` },
    { type: 'keyword', pattern: String.raw`@[\w-]+` },
    { type: 'variable', pattern: String.raw`--[\w-]+` },
    { type: 'number', pattern: String.raw`#[\da-fA-F]{3,8}\b|\b-?\d*\.?\d+(?:px|rem|em|%|vh|vw|s|ms|deg|fr)?\b` },
    { type: 'property', pattern: String.raw`[a-zA-Z-]+(?=\s*:)` },
    { type: 'function', pattern: String.raw`\b[a-zA-Z-]+(?=\()` },
    { type: 'tag', pattern: String.raw`[.#][\w-]+` },
    { type: 'punctuation', pattern: String.raw`[{}();:,]` },
  ],
  html: [
    { type: 'comment', pattern: String.raw`<!--[\s\S]*?(?:-->|$)` },
    { type: 'string', pattern: String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'` },
    { type: 'tag', pattern: String.raw`<\/?[a-zA-Z][\w:-]*|\/?>` },
    { type: 'attr', pattern: String.raw`\b[a-zA-Z-][\w:-]*(?==)` },
    { type: 'operator', pattern: String.raw`=` },
  ],
  markdown: [
    { type: 'keyword', pattern: String.raw`^#{1,6}\s.*$` },
    { type: 'string', pattern: '`[^`]*`' },
    { type: 'constant', pattern: String.raw`\*\*[^*]+\*\*` },
    { type: 'punctuation', pattern: String.raw`^\s*[-*+]\s|^\s*>\s` },
  ],
  shell: [
    { type: 'comment', pattern: String.raw`#[^\n]*` },
    { type: 'string', pattern: String.raw`"(?:\\.|[^"\\])*"|'[^']*'` },
    { type: 'variable', pattern: String.raw`\$\{[^}]*\}|\$[\w@?#*]+` },
    { type: 'attr', pattern: String.raw`(?<=\s)--?[\w-]+` },
    { type: 'operator', pattern: String.raw`\|\||&&|[|><&;]` },
    { type: 'number', pattern: String.raw`\b\d+\b` },
  ],
  plain: [],
};

const compiled = new Map<Language, { re: RegExp; types: TokenType[] } | null>();

function compile(language: Language) {
  if (compiled.has(language)) return compiled.get(language) ?? null;

  const rules = RULES[language];
  if (!rules || rules.length === 0) {
    compiled.set(language, null);
    return null;
  }

  let entry: { re: RegExp; types: TokenType[] } | null = null;
  try {
    entry = {
      re: new RegExp(rules.map((rule) => `(${rule.pattern})`).join('|'), 'gm'),
      types: rules.map((rule) => rule.type),
    };
  } catch {
    // A malformed pattern must never take down rendering.
    entry = null;
  }
  compiled.set(language, entry);
  return entry;
}

export function tokenize(line: string, language: Language): Token[] {
  const entry = compile(language);
  if (!entry || line.length === 0) {
    return line ? [{ type: 'plain', value: line }] : [];
  }

  const tokens: Token[] = [];
  const { re, types } = entry;
  re.lastIndex = 0;

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(line)) !== null) {
    if (match[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    if (match.index > cursor) {
      tokens.push({ type: 'plain', value: line.slice(cursor, match.index) });
    }

    let type: TokenType = 'plain';
    for (let i = 1; i < match.length; i += 1) {
      if (match[i] !== undefined) {
        type = types[i - 1] ?? 'plain';
        break;
      }
    }

    tokens.push({ type, value: match[0] });
    cursor = match.index + match[0].length;
  }

  if (cursor < line.length) tokens.push({ type: 'plain', value: line.slice(cursor) });
  return tokens;
}

/** Token colours. Tuned for the dark canvas these always render on. */
export const TOKEN_CLASS: Record<TokenType, string> = {
  plain: 'text-[hsl(var(--cb-ink))]',
  keyword: 'text-[hsl(285_82%_78%)]',
  string: 'text-[hsl(95_52%_66%)]',
  number: 'text-[hsl(33_90%_68%)]',
  comment: 'text-[hsl(var(--cb-ink-ghost))] italic',
  function: 'text-[hsl(207_90%_71%)]',
  type: 'text-[hsl(176_60%_62%)]',
  property: 'text-[hsl(199_75%_74%)]',
  operator: 'text-[hsl(var(--cb-ink-muted))]',
  punctuation: 'text-[hsl(var(--cb-ink-faint))]',
  tag: 'text-[hsl(350_82%_72%)]',
  attr: 'text-[hsl(38_85%_68%)]',
  variable: 'text-[hsl(255_85%_78%)]',
  constant: 'text-[hsl(30_88%_70%)]',
};

const EXTENSION_LANGUAGE: Record<string, Language> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'typescript',
  jsx: 'typescript',
  mjs: 'typescript',
  json: 'json',
  css: 'css',
  scss: 'css',
  html: 'html',
  svg: 'html',
  md: 'markdown',
  sh: 'shell',
  bash: 'shell',
};

export function languageFromPath(path: string): Language {
  return EXTENSION_LANGUAGE[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'plain';
}
