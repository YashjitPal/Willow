import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CelEvalError, evaluateCel, evaluateCelBool } from '../src/engine/cel/index.ts';

const vars = {
  a_list: ['sunsets', 'rivers', 'code'],
  a_ctr: 1,
  state: { count: 3, name: 'willow', flag: true, items: [1, 2, 3] },
  workflow: { input_as_text: 'hello world' },
  classifier: { output_parsed: { category: 'qa', score: 0.9 } },
  empty: [],
  nested: { deep: { value: 42 } },
};

describe('CEL literals & operators', () => {
  it('numbers and arithmetic', () => {
    assert.equal(evaluateCel('1 + 2 * 3', vars), 7);
    assert.equal(evaluateCel('(1 + 2) * 3', vars), 9);
    assert.equal(evaluateCel('10 / 4', vars), 2.5); // JS-double semantics (use int() to truncate)
    assert.equal(evaluateCel('int(10 / 4)', vars), 2);
    assert.equal(evaluateCel('10.0 / 4', vars), 2.5);
    assert.equal(evaluateCel('7 % 3', vars), 1);
    assert.equal(evaluateCel('-5 + 2', vars), -3);
    assert.equal(evaluateCel('0x10', vars), 16);
    assert.equal(evaluateCel('1e3', vars), 1000);
  });

  it('strings', () => {
    assert.equal(evaluateCel(`'a' + "b"`, vars), 'ab');
    assert.equal(evaluateCel(`"line\\n2"`, vars), 'line\n2');
    assert.equal(evaluateCel(`r"raw\\n"`, vars), 'raw\\n');
    assert.equal(evaluateCel(`"quote: \\""`, vars), 'quote: "');
  });

  it('booleans, null, comparisons', () => {
    assert.equal(evaluateCel('true && !false', vars), true);
    assert.equal(evaluateCel('null == null', vars), true);
    assert.equal(evaluateCel('1 < 2 && 2 <= 2 && 3 > 2 && 3 >= 3', vars), true);
    assert.equal(evaluateCel('"a" < "b"', vars), true);
    assert.equal(evaluateCel('1 != 2', vars), true);
  });

  it('short-circuit', () => {
    // right side would throw if evaluated
    assert.equal(evaluateCel('false && (1 / 0 > 0)', vars), false);
    assert.equal(evaluateCel('true || (1 / 0 > 0)', vars), true);
  });

  it('ternary', () => {
    assert.equal(evaluateCel('a_ctr > 0 ? "yes" : "no"', vars), 'yes');
    assert.equal(evaluateCel('a_ctr > 5 ? 1 : a_ctr > 0 ? 2 : 3', vars), 2);
  });

  it('in operator', () => {
    assert.equal(evaluateCel(`'rivers' in a_list`, vars), true);
    assert.equal(evaluateCel(`'oceans' in a_list`, vars), false);
    assert.equal(evaluateCel(`'count' in state`, vars), true);
    assert.equal(evaluateCel(`'ell' in 'hello'`, vars), true);
  });

  it('lists and maps', () => {
    assert.deepEqual(evaluateCel('[1, 2, 3]', vars), [1, 2, 3]);
    assert.deepEqual(evaluateCel('{"a": 1, "b": 2}', vars), { a: 1, b: 2 });
    assert.deepEqual(evaluateCel('[1, 2] + [3]', vars), [1, 2, 3]);
    assert.deepEqual(evaluateCel('[1, 2, 3,]', vars), [1, 2, 3]); // trailing comma
    assert.equal(evaluateCel('[1, [2, 3]][1][0]', vars), 2);
  });
});

describe('CEL member access & indexing', () => {
  it('member chains', () => {
    assert.equal(evaluateCel('state.count', vars), 3);
    assert.equal(evaluateCel('nested.deep.value', vars), 42);
    assert.equal(evaluateCel('classifier.output_parsed.category', vars), 'qa');
  });

  it('indexing', () => {
    assert.equal(evaluateCel('a_list[a_ctr]', vars), 'rivers');
    assert.equal(evaluateCel('a_list[0]', vars), 'sunsets');
    assert.equal(evaluateCel(`state["name"]`, vars), 'willow');
    assert.equal(evaluateCel(`"abc"[1]`, vars), 'b');
  });

  it('errors: unknown variable / field / out of range', () => {
    assert.throws(() => evaluateCel('missing_var', vars), CelEvalError);
    assert.throws(() => evaluateCel('state.missing', vars), CelEvalError);
    assert.throws(() => evaluateCel('a_list[99]', vars), CelEvalError);
    assert.throws(() => evaluateCel('1 / 0', vars), CelEvalError);
  });
});

describe('CEL functions & macros', () => {
  it('size()', () => {
    assert.equal(evaluateCel('size(a_list)', vars), 3);
    assert.equal(evaluateCel(`size("hello")`, vars), 5);
    assert.equal(evaluateCel('size(state)', vars), 4);
    assert.equal(evaluateCel('size(empty) == 0', vars), true);
  });

  it('has()', () => {
    assert.equal(evaluateCel('has(state.count)', vars), true);
    assert.equal(evaluateCel('has(state.missing)', vars), false);
    assert.equal(evaluateCel('has(missing_var)', vars), false);
  });

  it('type conversions', () => {
    assert.equal(evaluateCel(`int("42")`, vars), 42);
    assert.equal(evaluateCel('int(3.9)', vars), 3);
    assert.equal(evaluateCel(`double("2.5")`, vars), 2.5);
    assert.equal(evaluateCel('string(42)', vars), '42');
    assert.equal(evaluateCel(`bool("true")`, vars), true);
    assert.equal(evaluateCel('type(1)', vars), 'int');
    assert.equal(evaluateCel('type(1.5)', vars), 'double');
    assert.equal(evaluateCel('type("x")', vars), 'string');
  });

  it('string methods', () => {
    assert.equal(evaluateCel(`"hello world".contains("wor")`, vars), true);
    assert.equal(evaluateCel(`"hello".startsWith("he")`, vars), true);
    assert.equal(evaluateCel(`"hello".endsWith("lo")`, vars), true);
    assert.equal(evaluateCel(`"Hello".lowerAscii()`, vars), 'hello');
    assert.equal(evaluateCel(`"  x  ".trim()`, vars), 'x');
    assert.deepEqual(evaluateCel(`"a,b,c".split(",")`, vars), ['a', 'b', 'c']);
    assert.equal(evaluateCel(`"a-b".replace("-", "_")`, vars), 'a_b');
    assert.equal(evaluateCel(`"abc123".matches("[a-z]+[0-9]+")`, vars), true);
  });

  it('list macros', () => {
    assert.deepEqual(
      evaluateCel('state.items.filter(i, i > 1)', vars),
      [2, 3],
    );
    assert.deepEqual(
      evaluateCel('state.items.map(i, i * 2)', vars),
      [2, 4, 6],
    );
    assert.equal(evaluateCel('state.items.exists(i, i == 2)', vars), true);
    assert.equal(evaluateCel('state.items.all(i, i > 0)', vars), true);
    assert.equal(evaluateCel('state.items.exists_one(i, i == 2)', vars), true);
    assert.equal(evaluateCel('state.items.exists_one(i, i > 1)', vars), false);
    // nested macro
    assert.deepEqual(
      evaluateCel('state.items.filter(i, i > 1).map(j, j + 10)', vars),
      [12, 13],
    );
  });

  it('list methods', () => {
    assert.equal(evaluateCel(`a_list.join(", ")`, vars), 'sunsets, rivers, code');
    assert.equal(evaluateCel('state.items.indexOf(2)', vars), 1);
  });

  it('the community haiku-loop pattern', () => {
    // While: a_ctr < size(a_list); Transform: a_list[a_ctr]; Set state: a_ctr + 1
    assert.equal(evaluateCelBool('a_ctr < size(a_list)', vars), true);
    assert.equal(evaluateCel('a_list[a_ctr]', vars), 'rivers');
    assert.equal(evaluateCel('a_ctr + 1', vars), 2);
  });
});

describe('CEL syntax errors', () => {
  it('rejects malformed expressions', () => {
    assert.throws(() => evaluateCel('1 +', vars));
    assert.throws(() => evaluateCel('(1', vars));
    assert.throws(() => evaluateCel('a ==', vars));
    assert.throws(() => evaluateCel('"unterminated', vars));
    assert.throws(() => evaluateCel('1 2', vars));
  });

  it('condition must be boolean', () => {
    assert.throws(() => evaluateCelBool('1 + 1', vars), CelEvalError);
  });
});
