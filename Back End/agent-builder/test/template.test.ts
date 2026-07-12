import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderTemplate, resolveConfigValue, TemplateError } from '../src/engine/template.ts';
import {
  coerceToVarType,
  extractJson,
  schemaFromSimpleProperties,
  validateAgainstSchema,
} from '../src/engine/jsonSchema.ts';

const vars = {
  workflow: { input_as_text: 'hello' },
  state: { count: 2, items: ['a', 'b'] },
  my_agent: { output_text: 'result text', output_parsed: { score: 9 } },
  input_as_text: 'hello',
};

describe('template rendering', () => {
  it('interpolates variables', () => {
    assert.equal(renderTemplate('Say {{workflow.input_as_text}}!', vars), 'Say hello!');
    assert.equal(renderTemplate('{{state.count}} items', vars), '2 items');
    assert.equal(renderTemplate('{{my_agent.output_text}}', vars), 'result text');
  });

  it('supports CEL inside braces', () => {
    assert.equal(renderTemplate('{{state.count + 1}}', vars), '3');
    assert.equal(renderTemplate('{{state.items[1]}}', vars), 'b');
    assert.equal(renderTemplate('{{size(state.items)}}', vars), '2');
  });

  it('renders objects as JSON', () => {
    assert.equal(renderTemplate('{{my_agent.output_parsed}}', vars), '{"score":9}');
  });

  it('handles multiple placeholders and no placeholders', () => {
    assert.equal(renderTemplate('{{state.count}}-{{state.count}}', vars), '2-2');
    assert.equal(renderTemplate('plain text', vars), 'plain text');
    assert.equal(renderTemplate('', vars), '');
  });

  it('unterminated braces pass through', () => {
    assert.equal(renderTemplate('oops {{state.count', vars), 'oops {{state.count');
  });

  it('errors carry the expression', () => {
    assert.throws(() => renderTemplate('{{missing.thing}}', vars), TemplateError);
  });
});

describe('resolveConfigValue', () => {
  it('single-expression strings return raw values', () => {
    assert.deepEqual(resolveConfigValue('{{state.items}}', vars), ['a', 'b']);
    assert.equal(resolveConfigValue('{{state.count}}', vars), 2);
  });

  it('$cel: prefix evaluates as CEL', () => {
    assert.equal(resolveConfigValue('$cel: state.count * 10', vars), 20);
  });

  it('mixed strings render as templates', () => {
    assert.equal(resolveConfigValue('count: {{state.count}}', vars), 'count: 2');
  });

  it('recurses into objects and arrays', () => {
    assert.deepEqual(
      resolveConfigValue({ q: '{{workflow.input_as_text}}', n: 5, list: ['{{state.count}}'] }, vars),
      { q: 'hello', n: 5, list: [2] },
    );
  });
});

describe('json schema validation', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'integer', minimum: 0 },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['name'],
    additionalProperties: false,
  };

  it('accepts valid objects', () => {
    assert.deepEqual(validateAgainstSchema({ name: 'x', age: 3, tags: ['a'] }, schema), []);
  });

  it('flags missing required / wrong types / extras', () => {
    assert.ok(validateAgainstSchema({}, schema).length > 0);
    assert.ok(validateAgainstSchema({ name: 5 }, schema).length > 0);
    assert.ok(validateAgainstSchema({ name: 'x', age: -1 }, schema).length > 0);
    assert.ok(validateAgainstSchema({ name: 'x', extra: 1 }, schema).length > 0);
    assert.ok(validateAgainstSchema({ name: 'x', tags: [1] }, schema).length > 0);
  });

  it('enum and anyOf', () => {
    assert.deepEqual(validateAgainstSchema('qa', { type: 'string', enum: ['qa', 'other'] }), []);
    assert.ok(validateAgainstSchema('nope', { type: 'string', enum: ['qa'] }).length > 0);
    assert.deepEqual(
      validateAgainstSchema(5, { anyOf: [{ type: 'string' }, { type: 'number' }] }),
      [],
    );
  });

  it('schemaFromSimpleProperties builds the UI schema', () => {
    const s = schemaFromSimpleProperties([
      { name: 'title', type: 'String', description: 'the title' },
      { name: 'score', type: 'Number' },
    ]);
    assert.deepEqual(validateAgainstSchema({ title: 'x', score: 1 }, s), []);
    assert.ok(validateAgainstSchema({ title: 'x' }, s).length > 0); // score required
  });
});

describe('extractJson', () => {
  it('parses plain JSON', () => {
    assert.deepEqual(extractJson('{"a": 1}'), { a: 1 });
    assert.deepEqual(extractJson('[1, 2]'), [1, 2]);
  });

  it('parses fenced JSON', () => {
    assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
    assert.deepEqual(extractJson('Here you go:\n```\n{"a": 1}\n```\nEnjoy!'), { a: 1 });
  });

  it('parses embedded JSON with prose', () => {
    assert.deepEqual(extractJson('The answer is {"a": {"b": [1]}} as requested.'), {
      a: { b: [1] },
    });
    assert.deepEqual(extractJson('text with "quotes {" then {"x": "}"}'), { x: '}' });
  });

  it('throws when nothing parses', () => {
    assert.throws(() => extractJson('no json here'));
  });
});

describe('coerceToVarType', () => {
  it('coerces sensibly', () => {
    assert.equal(coerceToVarType('42', 'number'), 42);
    assert.equal(coerceToVarType(1.5, 'number'), 1.5);
    assert.equal(coerceToVarType('true', 'boolean'), true);
    assert.equal(coerceToVarType({ a: 1 }, 'string'), '{"a":1}');
    assert.deepEqual(coerceToVarType('[1,2]', 'list'), [1, 2]);
    assert.deepEqual(coerceToVarType('{"a":1}', 'object'), { a: 1 });
    assert.deepEqual(coerceToVarType(null, 'list'), []);
  });

  it('throws on impossible coercions', () => {
    assert.throws(() => coerceToVarType('not a number', 'number'));
    assert.throws(() => coerceToVarType('nope', 'boolean'));
    assert.throws(() => coerceToVarType('nope', 'object'));
  });
});
