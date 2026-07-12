/**
 * CEL (Common Expression Language) — lexer.
 * Supports the subset used by Agent Builder conditions/expressions.
 */

export type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'IDENT'
  | 'BOOL'
  | 'NULL'
  | 'OP'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=', '&&', '||']);
const ONE_CHAR_OPS = new Set([
  '+', '-', '*', '/', '%', '<', '>', '!', '(', ')', '[', ']', '{', '}',
  ',', '.', ':', '?',
]);

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

export class CelSyntaxError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(`${message} (at position ${pos})`);
    this.name = 'CelSyntaxError';
    this.pos = pos;
  }
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    // whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }

    // comments (CEL uses //)
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }

    // numbers: int, float, hex
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const start = i;
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
        i += 2;
        while (i < n && /[0-9a-fA-F]/.test(src[i])) i++;
        tokens.push({ type: 'NUMBER', value: String(parseInt(src.slice(start, i), 16)), pos: start });
        continue;
      }
      while (i < n && /[0-9]/.test(src[i])) i++;
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
        i++;
        while (i < n && /[0-9]/.test(src[i])) i++;
      }
      if (src[i] === 'e' || src[i] === 'E') {
        let j = i + 1;
        if (src[j] === '+' || src[j] === '-') j++;
        if (/[0-9]/.test(src[j] ?? '')) {
          i = j;
          while (i < n && /[0-9]/.test(src[i])) i++;
        }
      }
      // unsigned suffix
      if (src[i] === 'u' || src[i] === 'U') i++;
      tokens.push({ type: 'NUMBER', value: src.slice(start, i).replace(/[uU]$/, ''), pos: start });
      continue;
    }

    // strings: '...' or "..." with escapes; r"..." raw
    if (c === '"' || c === "'" || ((c === 'r' || c === 'R') && (src[i + 1] === '"' || src[i + 1] === "'"))) {
      const raw = c === 'r' || c === 'R';
      let quote: string;
      let start = i;
      if (raw) {
        quote = src[i + 1];
        i += 2;
      } else {
        quote = c;
        i += 1;
      }
      // triple-quoted
      const triple = src.slice(i, i + 2) === quote + quote;
      const q = triple ? quote.repeat(3) : quote;
      if (triple) i += 2;
      let out = '';
      while (i < n) {
        if (src.startsWith(q, i)) {
          i += q.length;
          tokens.push({ type: 'STRING', value: out, pos: start });
          break;
        }
        const ch = src[i];
        if (!raw && ch === '\\') {
          const esc = src[i + 1];
          switch (esc) {
            case 'n': out += '\n'; i += 2; break;
            case 't': out += '\t'; i += 2; break;
            case 'r': out += '\r'; i += 2; break;
            case '\\': out += '\\'; i += 2; break;
            case '"': out += '"'; i += 2; break;
            case "'": out += "'"; i += 2; break;
            case '0': out += '\0'; i += 2; break;
            case 'u': {
              const hex = src.slice(i + 2, i + 6);
              if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                out += String.fromCharCode(parseInt(hex, 16));
                i += 6;
              } else {
                throw new CelSyntaxError('invalid \\u escape', i);
              }
              break;
            }
            default:
              out += esc ?? '';
              i += 2;
          }
          continue;
        }
        out += ch;
        i++;
        if (i >= n) throw new CelSyntaxError('unterminated string', start);
      }
      continue;
    }

    // identifiers / keywords
    if (IDENT_START.test(c)) {
      const start = i;
      while (i < n && IDENT_PART.test(src[i])) i++;
      const word = src.slice(start, i);
      if (word === 'true' || word === 'false') {
        tokens.push({ type: 'BOOL', value: word, pos: start });
      } else if (word === 'null') {
        tokens.push({ type: 'NULL', value: word, pos: start });
      } else if (word === 'in') {
        tokens.push({ type: 'OP', value: 'in', pos: start });
      } else {
        tokens.push({ type: 'IDENT', value: word, pos: start });
      }
      continue;
    }

    // operators
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ type: 'OP', value: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      tokens.push({ type: 'OP', value: c, pos: i });
      i += 1;
      continue;
    }

    throw new CelSyntaxError(`unexpected character '${c}'`, i);
  }

  tokens.push({ type: 'EOF', value: '', pos: n });
  return tokens;
}
