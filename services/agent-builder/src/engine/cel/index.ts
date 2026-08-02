/**
 * CEL evaluator.
 *
 * Implements the subset of CEL used by Agent Builder workflows:
 *  - literals, lists, maps, identifiers, member/index access
 *  - arithmetic, comparison, logical ops, ternary, `in`
 *  - functions: size(), has(), string(), int(), double(), bool(), type(), matches()
 *  - string methods: contains, startsWith, endsWith, matches, lower/upperAscii,
 *    trim, split, join (on lists), replace, size
 *  - list macros: filter, map, exists, all, exists_one
 *
 * Deliberate deviations from strict CEL: numbers are JS doubles (no int/uint
 * distinction), and unknown identifiers throw a CelEvalError naming the
 * identifier (better DX for workflow authors than CEL's partial semantics).
 */

import { parse, type CelNode } from './parser.ts';

export type CelValue =
  | string
  | number
  | boolean
  | null
  | CelValue[]
  | { [key: string]: CelValue };

export class CelEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CelEvalError';
  }
}

export interface CelEnv {
  /** Root variables visible to the expression. */
  vars: Record<string, CelValue>;
}

const MACROS = new Set(['filter', 'map', 'exists', 'all', 'exists_one']);

function typeName(v: CelValue): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'list';
  switch (typeof v) {
    case 'string': return 'string';
    case 'number': return Number.isInteger(v) ? 'int' : 'double';
    case 'boolean': return 'bool';
    case 'object': return 'map';
    default: return 'unknown';
  }
}

function isPlainObject(v: CelValue): v is { [key: string]: CelValue } {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Own-property check — inherited props (constructor, toString, ...) are not CEL fields. */
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function deepEqual(a: CelValue, b: CelValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!hasOwn(b, k) || !deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

function requireBool(v: CelValue, ctx: string): boolean {
  if (typeof v !== 'boolean') {
    throw new CelEvalError(`${ctx}: expected bool, got ${typeName(v)}`);
  }
  return v;
}

function requireArgs(name: string, args: CelNode[], count: number): void {
  if (args.length !== count) {
    throw new CelEvalError(`${name}() takes exactly ${count} argument${count === 1 ? '' : 's'}`);
  }
}

function compare(a: CelValue, b: CelValue, op: string): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    switch (op) {
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
    }
  }
  if (typeof a === 'string' && typeof b === 'string') {
    switch (op) {
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
    }
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    const na = a ? 1 : 0;
    const nb = b ? 1 : 0;
    switch (op) {
      case '<': return na < nb;
      case '<=': return na <= nb;
      case '>': return na > nb;
      case '>=': return na >= nb;
    }
  }
  throw new CelEvalError(`cannot compare ${typeName(a)} ${op} ${typeName(b)}`);
}

/** RE2-ish safety: reject obviously catastrophic patterns and cap length. */
function safeRegex(pattern: string): RegExp {
  if (pattern.length > 1000) throw new CelEvalError('regex pattern too long');
  try {
    return new RegExp(pattern);
  } catch (e) {
    throw new CelEvalError(`invalid regex: ${(e as Error).message}`);
  }
}

class Evaluator {
  private env: CelEnv;
  constructor(env: CelEnv) {
    this.env = env;
  }

  eval(node: CelNode, scope: Record<string, CelValue>): CelValue {
    switch (node.kind) {
      case 'lit':
        return node.value;

      case 'ident': {
        if (hasOwn(scope, node.name)) return scope[node.name];
        throw new CelEvalError(`unknown variable '${node.name}'`);
      }

      case 'list':
        return node.items.map((it) => this.eval(it, scope));

      case 'map': {
        const out: { [key: string]: CelValue } = {};
        for (const e of node.entries) {
          const k = this.eval(e.key, scope);
          if (typeof k !== 'string' && typeof k !== 'number') {
            throw new CelEvalError(`map key must be string or number, got ${typeName(k)}`);
          }
          out[String(k)] = this.eval(e.value, scope);
        }
        return out;
      }

      case 'member': {
        const obj = this.eval(node.obj, scope);
        if (isPlainObject(obj)) {
          if (hasOwn(obj, node.prop)) return obj[node.prop];
          throw new CelEvalError(`no such field '${node.prop}'`);
        }
        throw new CelEvalError(`cannot access field '${node.prop}' on ${typeName(obj)}`);
      }

      case 'index': {
        const obj = this.eval(node.obj, scope);
        const idx = this.eval(node.index, scope);
        if (Array.isArray(obj)) {
          if (typeof idx !== 'number' || !Number.isInteger(idx)) {
            throw new CelEvalError(`list index must be an integer, got ${typeName(idx)}`);
          }
          if (idx < 0 || idx >= obj.length) {
            throw new CelEvalError(`list index ${idx} out of range (size ${obj.length})`);
          }
          return obj[idx];
        }
        if (isPlainObject(obj)) {
          const key = String(idx);
          if (hasOwn(obj, key)) return obj[key];
          throw new CelEvalError(`no such key '${key}'`);
        }
        if (typeof obj === 'string' && typeof idx === 'number') {
          if (idx < 0 || idx >= obj.length) {
            throw new CelEvalError(`string index ${idx} out of range`);
          }
          return obj[idx];
        }
        throw new CelEvalError(`cannot index ${typeName(obj)}`);
      }

      case 'unary': {
        const v = this.eval(node.operand, scope);
        if (node.op === '!') return !requireBool(v, 'operator !');
        if (typeof v !== 'number') throw new CelEvalError(`operator -: expected number, got ${typeName(v)}`);
        return -v;
      }

      case 'binary':
        return this.evalBinary(node, scope);

      case 'ternary': {
        const c = requireBool(this.eval(node.cond, scope), 'ternary condition');
        return c ? this.eval(node.then, scope) : this.eval(node.else, scope);
      }

      case 'call':
        return this.evalCall(node, scope);
    }
  }

  private evalBinary(
    node: Extract<CelNode, { kind: 'binary' }>,
    scope: Record<string, CelValue>,
  ): CelValue {
    const { op } = node;

    // short-circuit
    if (op === '&&') {
      const l = this.eval(node.left, scope);
      if (requireBool(l, '&&') === false) return false;
      return requireBool(this.eval(node.right, scope), '&&');
    }
    if (op === '||') {
      const l = this.eval(node.left, scope);
      if (requireBool(l, '||') === true) return true;
      return requireBool(this.eval(node.right, scope), '||');
    }

    const a = this.eval(node.left, scope);
    const b = this.eval(node.right, scope);

    switch (op) {
      case '==': return deepEqual(a, b);
      case '!=': return !deepEqual(a, b);
      case '<':
      case '<=':
      case '>':
      case '>=':
        return compare(a, b, op);
      case 'in': {
        if (Array.isArray(b)) return b.some((x) => deepEqual(a, x));
        if (isPlainObject(b)) {
          if (typeof a !== 'string' && typeof a !== 'number') {
            throw new CelEvalError(`'in' key must be string or number`);
          }
          return hasOwn(b, String(a));
        }
        if (typeof b === 'string') {
          if (typeof a !== 'string') throw new CelEvalError(`'in' on string requires string operand`);
          return b.includes(a);
        }
        throw new CelEvalError(`'in' requires list, map or string on the right, got ${typeName(b)}`);
      }
      case '+': {
        if (typeof a === 'number' && typeof b === 'number') return a + b;
        if (typeof a === 'string' && typeof b === 'string') return a + b;
        if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
        throw new CelEvalError(`cannot add ${typeName(a)} + ${typeName(b)}`);
      }
      case '-': {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        throw new CelEvalError(`cannot subtract ${typeName(a)} - ${typeName(b)}`);
      }
      case '*': {
        if (typeof a === 'number' && typeof b === 'number') return a * b;
        throw new CelEvalError(`cannot multiply ${typeName(a)} * ${typeName(b)}`);
      }
      case '/': {
        if (typeof a === 'number' && typeof b === 'number') {
          if (b === 0) throw new CelEvalError('division by zero');
          // Deviation from strict CEL: all numbers are JS doubles, so division
          // is exact (10 / 4 == 2.5). Use int(a / b) for truncating division.
          return a / b;
        }
        throw new CelEvalError(`cannot divide ${typeName(a)} / ${typeName(b)}`);
      }
      case '%': {
        if (typeof a === 'number' && typeof b === 'number') {
          if (b === 0) throw new CelEvalError('modulo by zero');
          return a % b;
        }
        throw new CelEvalError(`cannot mod ${typeName(a)} % ${typeName(b)}`);
      }
      default:
        throw new CelEvalError(`unsupported operator '${op}'`);
    }
  }

  private evalCall(
    node: Extract<CelNode, { kind: 'call' }>,
    scope: Record<string, CelValue>,
  ): CelValue {
    const { name, callee, args } = node;

    // --- macros (method form: list.filter(x, expr)) ---
    if (callee && MACROS.has(name)) {
      const target = this.eval(callee, scope);
      if (!Array.isArray(target) && !isPlainObject(target)) {
        throw new CelEvalError(`${name}() requires a list or map, got ${typeName(target)}`);
      }
      const items: CelValue[] = Array.isArray(target) ? target : Object.keys(target);
      if (args.length !== 2 || args[0].kind !== 'ident') {
        throw new CelEvalError(`${name}(var, expr) requires an identifier and an expression`);
      }
      const varName = args[0].name;
      const body = args[1];
      const evalWith = (item: CelValue): CelValue =>
        this.eval(body, { ...scope, [varName]: item });

      switch (name) {
        case 'filter':
          return items.filter((it) => requireBool(evalWith(it), 'filter predicate'));
        case 'map':
          return items.map((it) => evalWith(it));
        case 'exists':
          return items.some((it) => requireBool(evalWith(it), 'exists predicate'));
        case 'all':
          return items.every((it) => requireBool(evalWith(it), 'all predicate'));
        case 'exists_one': {
          let count = 0;
          for (const it of items) {
            if (requireBool(evalWith(it), 'exists_one predicate')) count++;
            if (count > 1) return false;
          }
          return count === 1;
        }
      }
    }

    // --- has(x.y) — special form, does not evaluate the member access ---
    if (!callee && name === 'has') {
      if (args.length !== 1) throw new CelEvalError('has() takes exactly one argument');
      const arg = args[0];
      if (arg.kind === 'member') {
        let obj: CelValue;
        try {
          obj = this.eval(arg.obj, scope);
        } catch {
          return false;
        }
        return isPlainObject(obj) && hasOwn(obj, arg.prop);
      }
      if (arg.kind === 'index') {
        let obj: CelValue;
        let idx: CelValue;
        try {
          obj = this.eval(arg.obj, scope);
          idx = this.eval(arg.index, scope);
        } catch {
          return false;
        }
        if (isPlainObject(obj)) return hasOwn(obj, String(idx));
        if (Array.isArray(obj)) return typeof idx === 'number' && idx >= 0 && idx < obj.length;
        return false;
      }
      if (arg.kind === 'ident') return hasOwn(scope, arg.name);
      throw new CelEvalError('has() requires a field selection');
    }

    // --- global functions ---
    if (!callee) {
      const unaryFunctions = new Set(['size', 'string', 'int', 'double', 'bool', 'type']);
      if (unaryFunctions.has(name)) requireArgs(name, args, 1);
      if (name === 'matches') requireArgs(name, args, 2);
      if ((name === 'min' || name === 'max') && args.length === 0) {
        throw new CelEvalError(`${name}() requires at least one argument`);
      }
      const vals = args.map((a) => this.eval(a, scope));
      switch (name) {
        case 'size': {
          const v = vals[0];
          if (typeof v === 'string') return v.length;
          if (Array.isArray(v)) return v.length;
          if (isPlainObject(v)) return Object.keys(v).length;
          throw new CelEvalError(`size() requires string, list or map, got ${typeName(v)}`);
        }
        case 'string': {
          const v = vals[0];
          if (typeof v === 'string') return v;
          if (v === null) return 'null';
          if (typeof v === 'object') return JSON.stringify(v);
          return String(v);
        }
        case 'int': {
          const v = vals[0];
          if (typeof v === 'number') return Math.trunc(v);
          if (typeof v === 'string') {
            const n = Number.parseFloat(v);
            if (Number.isNaN(n)) throw new CelEvalError(`int(): cannot parse '${v}'`);
            return Math.trunc(n);
          }
          if (typeof v === 'boolean') return v ? 1 : 0;
          throw new CelEvalError(`int() cannot convert ${typeName(v)}`);
        }
        case 'double': {
          const v = vals[0];
          if (typeof v === 'number') return v;
          if (typeof v === 'string') {
            const n = Number.parseFloat(v);
            if (Number.isNaN(n)) throw new CelEvalError(`double(): cannot parse '${v}'`);
            return n;
          }
          throw new CelEvalError(`double() cannot convert ${typeName(v)}`);
        }
        case 'bool': {
          const v = vals[0];
          if (typeof v === 'boolean') return v;
          if (v === 'true') return true;
          if (v === 'false') return false;
          throw new CelEvalError(`bool() cannot convert ${typeName(v)}`);
        }
        case 'type':
          return typeName(vals[0]);
        case 'matches': {
          const [s, p] = vals;
          if (typeof s !== 'string' || typeof p !== 'string') {
            throw new CelEvalError('matches(string, pattern) requires strings');
          }
          return safeRegex(p).test(s);
        }
        case 'min': {
          const nums = (Array.isArray(vals[0]) && vals.length === 1 ? vals[0] : vals) as CelValue[];
          if (!nums.length || nums.some((v) => typeof v !== 'number')) {
            throw new CelEvalError('min() requires numbers');
          }
          return Math.min(...(nums as number[]));
        }
        case 'max': {
          const nums = (Array.isArray(vals[0]) && vals.length === 1 ? vals[0] : vals) as CelValue[];
          if (!nums.length || nums.some((v) => typeof v !== 'number')) {
            throw new CelEvalError('max() requires numbers');
          }
          return Math.max(...(nums as number[]));
        }
        default:
          throw new CelEvalError(`unknown function '${name}'`);
      }
    }

    // --- method calls ---
    const target = this.eval(callee, scope);
    const vals = args.map((a) => this.eval(a, scope));

    if (typeof target === 'string') {
      switch (name) {
        case 'contains':
          if (typeof vals[0] !== 'string') throw new CelEvalError('contains() requires a string');
          return target.includes(vals[0]);
        case 'startsWith':
          if (typeof vals[0] !== 'string') throw new CelEvalError('startsWith() requires a string');
          return target.startsWith(vals[0]);
        case 'endsWith':
          if (typeof vals[0] !== 'string') throw new CelEvalError('endsWith() requires a string');
          return target.endsWith(vals[0]);
        case 'matches':
          if (typeof vals[0] !== 'string') throw new CelEvalError('matches() requires a string');
          return safeRegex(vals[0]).test(target);
        case 'lowerAscii':
        case 'toLowerCase':
          return target.toLowerCase();
        case 'upperAscii':
        case 'toUpperCase':
          return target.toUpperCase();
        case 'trim':
          return target.trim();
        case 'size':
          return target.length;
        case 'split':
          if (typeof vals[0] !== 'string') throw new CelEvalError('split() requires a string');
          return target.split(vals[0]);
        case 'replace': {
          if (typeof vals[0] !== 'string' || typeof vals[1] !== 'string') {
            throw new CelEvalError('replace(old, new) requires strings');
          }
          return target.split(vals[0]).join(vals[1]);
        }
        case 'indexOf':
          if (typeof vals[0] !== 'string') throw new CelEvalError('indexOf() requires a string');
          return target.indexOf(vals[0]);
        default:
          throw new CelEvalError(`unknown string method '${name}'`);
      }
    }

    if (Array.isArray(target)) {
      switch (name) {
        case 'size':
          return target.length;
        case 'join': {
          const sep = vals.length ? vals[0] : '';
          if (typeof sep !== 'string') throw new CelEvalError('join() separator must be a string');
          return target
            .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
            .join(sep);
        }
        case 'indexOf': {
          for (let i = 0; i < target.length; i++) {
            if (deepEqual(target[i], vals[0])) return i;
          }
          return -1;
        }
        default:
          throw new CelEvalError(`unknown list method '${name}'`);
      }
    }

    if (isPlainObject(target)) {
      switch (name) {
        case 'size':
          return Object.keys(target).length;
        case 'keys':
          return Object.keys(target);
        case 'values':
          return Object.values(target);
        default:
          throw new CelEvalError(`unknown map method '${name}'`);
      }
    }

    throw new CelEvalError(`cannot call method '${name}' on ${typeName(target)}`);
  }
}

/** Parse + evaluate a CEL expression against the given variables. */
export function evaluateCel(expression: string, vars: Record<string, CelValue>): CelValue {
  const ast = parse(expression);
  return new Evaluator({ vars }).eval(ast, vars);
}

/** Evaluate and coerce to boolean (for If/else and While conditions). */
export function evaluateCelBool(expression: string, vars: Record<string, CelValue>): boolean {
  const v = evaluateCel(expression, vars);
  if (typeof v !== 'boolean') {
    throw new CelEvalError(
      `condition must evaluate to a bool, got ${typeName(v)} from '${expression}'`,
    );
  }
  return v;
}

export { parse } from './parser.ts';
export { CelSyntaxError } from './lexer.ts';
