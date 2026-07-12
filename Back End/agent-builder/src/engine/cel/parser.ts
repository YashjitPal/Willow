/**
 * CEL parser — builds an AST with standard CEL precedence:
 *   ternary ?:  <  ||  <  &&  <  relations (== != < <= > >= in)
 *   <  additive (+ -)  <  multiplicative (* / %)  <  unary (! -)  <  postfix (. [] ())
 */

import { CelSyntaxError, tokenize, type Token } from './lexer.ts';

export type CelNode =
  | { kind: 'lit'; value: string | number | boolean | null }
  | { kind: 'ident'; name: string }
  | { kind: 'list'; items: CelNode[] }
  | { kind: 'map'; entries: Array<{ key: CelNode; value: CelNode }> }
  | { kind: 'member'; obj: CelNode; prop: string }
  | { kind: 'index'; obj: CelNode; index: CelNode }
  | { kind: 'call'; callee: CelNode | null; name: string; args: CelNode[] }
  | { kind: 'unary'; op: '!' | '-'; operand: CelNode }
  | { kind: 'binary'; op: string; left: CelNode; right: CelNode }
  | { kind: 'ternary'; cond: CelNode; then: CelNode; else: CelNode };

export class Parser {
  private tokens: Token[];
  private i = 0;
  private depth = 0;
  private static readonly MAX_DEPTH = 200;

  constructor(src: string) {
    this.tokens = tokenize(src);
  }

  private enter(): void {
    if (++this.depth > Parser.MAX_DEPTH) {
      throw new CelSyntaxError('expression nesting too deep', this.peek().pos);
    }
  }

  private exit(): void {
    this.depth--;
  }

  private peek(): Token {
    return this.tokens[this.i];
  }

  private next(): Token {
    return this.tokens[this.i++];
  }

  private expectOp(op: string): void {
    const t = this.next();
    if (t.type !== 'OP' || t.value !== op) {
      throw new CelSyntaxError(`expected '${op}' but found '${t.value || 'end of input'}'`, t.pos);
    }
  }

  private matchOp(op: string): boolean {
    const t = this.peek();
    if (t.type === 'OP' && t.value === op) {
      this.i++;
      return true;
    }
    return false;
  }

  parse(): CelNode {
    const node = this.parseTernary();
    const t = this.peek();
    if (t.type !== 'EOF') {
      throw new CelSyntaxError(`unexpected trailing input '${t.value}'`, t.pos);
    }
    return node;
  }

  private parseTernary(): CelNode {
    this.enter();
    try {
      const cond = this.parseOr();
      if (this.matchOp('?')) {
        const then = this.parseTernary();
        this.expectOp(':');
        const els = this.parseTernary();
        return { kind: 'ternary', cond, then, else: els };
      }
      return cond;
    } finally {
      this.exit();
    }
  }

  private parseOr(): CelNode {
    let left = this.parseAnd();
    while (this.peek().type === 'OP' && this.peek().value === '||') {
      this.next();
      const right = this.parseAnd();
      left = { kind: 'binary', op: '||', left, right };
    }
    return left;
  }

  private parseAnd(): CelNode {
    let left = this.parseRelation();
    while (this.peek().type === 'OP' && this.peek().value === '&&') {
      this.next();
      const right = this.parseRelation();
      left = { kind: 'binary', op: '&&', left, right };
    }
    return left;
  }

  private parseRelation(): CelNode {
    let left = this.parseAdditive();
    const REL = new Set(['==', '!=', '<', '<=', '>', '>=', 'in']);
    while (this.peek().type === 'OP' && REL.has(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseAdditive();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseAdditive(): CelNode {
    let left = this.parseMultiplicative();
    while (this.peek().type === 'OP' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): CelNode {
    let left = this.parseUnary();
    while (
      this.peek().type === 'OP' &&
      (this.peek().value === '*' || this.peek().value === '/' || this.peek().value === '%')
    ) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): CelNode {
    if (this.matchOp('!')) {
      return { kind: 'unary', op: '!', operand: this.parseUnary() };
    }
    if (this.matchOp('-')) {
      return { kind: 'unary', op: '-', operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): CelNode {
    let node = this.parsePrimary();
    for (;;) {
      if (this.matchOp('.')) {
        const t = this.next();
        if (t.type !== 'IDENT') {
          throw new CelSyntaxError(`expected property name after '.'`, t.pos);
        }
        // method call?
        if (this.peek().type === 'OP' && this.peek().value === '(') {
          this.next(); // consume (
          const args = this.parseArgs();
          node = { kind: 'call', callee: node, name: t.value, args };
        } else {
          node = { kind: 'member', obj: node, prop: t.value };
        }
        continue;
      }
      if (this.matchOp('[')) {
        const idx = this.parseTernary();
        this.expectOp(']');
        node = { kind: 'index', obj: node, index: idx };
        continue;
      }
      break;
    }
    return node;
  }

  private parseArgs(): CelNode[] {
    const args: CelNode[] = [];
    if (this.matchOp(')')) return args;
    for (;;) {
      args.push(this.parseTernary());
      if (this.matchOp(',')) continue;
      this.expectOp(')');
      break;
    }
    return args;
  }

  private parsePrimary(): CelNode {
    const t = this.next();

    if (t.type === 'NUMBER') return { kind: 'lit', value: Number(t.value) };
    if (t.type === 'STRING') return { kind: 'lit', value: t.value };
    if (t.type === 'BOOL') return { kind: 'lit', value: t.value === 'true' };
    if (t.type === 'NULL') return { kind: 'lit', value: null };

    if (t.type === 'IDENT') {
      // global function call?
      if (this.peek().type === 'OP' && this.peek().value === '(') {
        this.next(); // consume (
        const args = this.parseArgs();
        return { kind: 'call', callee: null, name: t.value, args };
      }
      return { kind: 'ident', name: t.value };
    }

    if (t.type === 'OP' && t.value === '(') {
      const inner = this.parseTernary();
      this.expectOp(')');
      return inner;
    }

    if (t.type === 'OP' && t.value === '[') {
      const items: CelNode[] = [];
      if (!this.matchOp(']')) {
        for (;;) {
          items.push(this.parseTernary());
          if (this.matchOp(',')) {
            if (this.matchOp(']')) break; // trailing comma
            continue;
          }
          this.expectOp(']');
          break;
        }
      }
      return { kind: 'list', items };
    }

    if (t.type === 'OP' && t.value === '{') {
      const entries: Array<{ key: CelNode; value: CelNode }> = [];
      if (!this.matchOp('}')) {
        for (;;) {
          const key = this.parseTernary();
          this.expectOp(':');
          const value = this.parseTernary();
          entries.push({ key, value });
          if (this.matchOp(',')) {
            if (this.matchOp('}')) break; // trailing comma
            continue;
          }
          this.expectOp('}');
          break;
        }
      }
      return { kind: 'map', entries };
    }

    throw new CelSyntaxError(`unexpected token '${t.value || 'end of input'}'`, t.pos);
  }
}

export function parse(src: string): CelNode {
  return new Parser(src).parse();
}
