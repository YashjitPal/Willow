import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeGraph, toVarName } from '../src/domain/normalize.ts';
import { validateGraph } from '../src/domain/validate.ts';

describe('normalizeGraph', () => {
  it('accepts the raw React Flow shape from the canvas', () => {
    const { graph, varNames } = normalizeGraph({
      nodes: [
        { id: '1', type: 'start', data: { label: 'Start' }, position: { x: 50, y: 125 } },
        {
          id: '2',
          type: 'agent',
          data: { label: 'My Agent', instructions: 'Be helpful' },
          position: { x: 300, y: 125 },
        },
        {
          id: '3',
          type: 'guardrail',
          data: { label: 'Guardrails', config: { pii: true, continueOnError: false } },
        },
        { id: 'p1', type: 'placeholder', data: { label: '+ New node' } },
      ],
      edges: [
        { id: 'e1-2', source: '1', target: '2', type: 'custom', style: { stroke: '#404040' } },
        { id: 'e2-3', source: '2', target: '3' },
        { id: 'ep', source: '3', target: 'p1', sourceHandle: 'pass' },
      ],
    });

    assert.equal(graph.nodes.length, 3); // placeholder dropped
    assert.equal(graph.edges.length, 2); // placeholder edge dropped
    const agent = graph.nodes.find((n) => n.id === '2')!;
    assert.equal(agent.type, 'agent');
    assert.equal(agent.name, 'My Agent');
    assert.equal(agent.config.instructions, 'Be helpful');
    assert.equal(agent.config.model, 'gemini-3-flash'); // default
    const guard = graph.nodes.find((n) => n.id === '3')!;
    assert.equal(guard.config.pii, true);
    assert.equal(varNames.get('2'), 'my_agent');
  });

  it('maps type aliases and legacy if handle', () => {
    const { graph } = normalizeGraph({
      nodes: [
        { id: 's', type: 'start', data: {} },
        {
          id: 'i',
          type: 'if-else',
          config: { branches: [{ id: 'b1', condition: 'true' }] },
        },
        { id: 'a', type: 'agent', data: {} },
        { id: 'e', type: 'end', data: {} },
      ],
      edges: [
        { id: '1', source: 's', target: 'i' },
        { id: '2', source: 'i', target: 'a', sourceHandle: 'if' },
        { id: '3', source: 'i', target: 'e', sourceHandle: 'else' },
      ],
    });
    assert.equal(graph.nodes.find((n) => n.id === 'i')!.type, 'ifElse');
    assert.equal(graph.edges.find((e) => e.id === '2')!.sourceHandle, 'b1');
  });

  it('is idempotent on canonical graphs', () => {
    const first = normalizeGraph({
      nodes: [
        { id: 's', type: 'start', data: { label: 'Start' } },
        { id: 'a', type: 'agent', data: { label: 'Agent', instructions: 'x' } },
      ],
      edges: [{ id: 'e', source: 's', target: 'a' }],
    });
    const second = normalizeGraph(first.graph);
    assert.deepEqual(second.graph, first.graph);
  });

  it('dedupes variable names', () => {
    const { varNames } = normalizeGraph({
      nodes: [
        { id: 's', type: 'start', data: {} },
        { id: 'a1', type: 'agent', data: { label: 'Agent' } },
        { id: 'a2', type: 'agent', data: { label: 'Agent' } },
      ],
      edges: [],
    });
    assert.equal(varNames.get('a1'), 'agent');
    assert.equal(varNames.get('a2'), 'agent_2');
  });

  it('rejects garbage', () => {
    assert.throws(() => normalizeGraph(null));
    assert.throws(() => normalizeGraph({ nodes: 'x', edges: [] }));
    assert.throws(() => normalizeGraph({ nodes: [{ id: 'x', type: 'nope' }], edges: [] }));
    assert.throws(() =>
      normalizeGraph({ nodes: [{ id: 'a', type: 'start' }, { id: 'a', type: 'end' }], edges: [] }),
    );
  });

  it('toVarName', () => {
    assert.equal(toVarName('My Cool Agent!'), 'my_cool_agent');
    assert.equal(toVarName('  '), 'node');
    assert.equal(toVarName('Émail agent'), 'mail_agent');
  });
});

describe('validateGraph', () => {
  const g = (nodes: unknown[], edges: unknown[]) => normalizeGraph({ nodes, edges }).graph;

  it('valid minimal workflow', () => {
    const result = validateGraph(
      g(
        [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', data: {} },
        ],
        [{ id: 'e', source: 's', target: 'a' }],
      ),
    );
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    const agent = result.contracts.find((c) => c.nodeType === 'agent');
    assert.ok(agent?.outputs.some((field) => field.name === 'output_text' && field.type === 'string'));
  });

  it('requires exactly one start', () => {
    assert.equal(validateGraph(g([{ id: 'a', type: 'agent', data: {} }], [])).valid, false);
    const two = validateGraph(
      g(
        [
          { id: 's1', type: 'start', data: {} },
          { id: 's2', type: 'start', data: {} },
        ],
        [],
      ),
    );
    assert.equal(two.valid, false);
  });

  it('rejects multiple default-flow outgoing edges', () => {
    const result = validateGraph(
      g(
        [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', data: {} },
          { id: 'b', type: 'agent', data: {} },
        ],
        [
          { id: 'e1', source: 's', target: 'a' },
          { id: 'e2', source: 's', target: 'b' },
        ],
      ),
    );
    assert.equal(result.valid, false);
  });

  it('validates branch handles', () => {
    const result = validateGraph(
      g(
        [
          { id: 's', type: 'start', data: {} },
          { id: 'gr', type: 'guardrail', config: { pii: true } },
          { id: 'a', type: 'agent', data: {} },
        ],
        [
          { id: 'e1', source: 's', target: 'gr' },
          { id: 'e2', source: 'gr', target: 'a', sourceHandle: 'bogus' },
        ],
      ),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes('pass, fail')));
  });

  it('rejects invalid CEL', () => {
    const result = validateGraph(
      g(
        [
          { id: 's', type: 'start', data: {} },
          { id: 'i', type: 'ifElse', config: { branches: [{ id: 'b', condition: '1 +' }] } },
        ],
        [{ id: 'e1', source: 's', target: 'i' }],
      ),
    );
    assert.equal(result.valid, false);
  });

  it('rejects cycles without a While node', () => {
    const result = validateGraph(
      g(
        [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', data: { label: 'A' } },
          { id: 'b', type: 'transform', config: { outputs: [{ name: 'x', type: 'string', expression: '"y"' }] } },
        ],
        [
          { id: 'e1', source: 's', target: 'a' },
          { id: 'e2', source: 'a', target: 'b' },
          { id: 'e3', source: 'b', target: 'a' },
        ],
      ),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes('cycle')));
  });

  it('allows loops through a While node', () => {
    const result = validateGraph(
      g(
        [
          {
            id: 's',
            type: 'start',
            config: {
              inputVariables: [{ name: 'input_as_text', type: 'string' }],
              stateVariables: [{ name: 'i', type: 'number', initialValue: 0 }],
            },
          },
          { id: 'w', type: 'while', config: { condition: 'state.i < 3' } },
          {
            id: 'inc',
            type: 'setState',
            config: { assignments: [{ name: 'i', expression: 'state.i + 1' }] },
          },
          { id: 'e', type: 'end', data: {} },
        ],
        [
          { id: 'e1', source: 's', target: 'w' },
          { id: 'e2', source: 'w', target: 'inc', sourceHandle: 'loop' },
          { id: 'e3', source: 'inc', target: 'w' },
          { id: 'e4', source: 'w', target: 'e', sourceHandle: 'done' },
        ],
      ),
    );
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  });

  it('rejects setState writing undeclared variables', () => {
    const result = validateGraph(
      g(
        [
          {
            id: 's',
            type: 'start',
            config: {
              inputVariables: [],
              stateVariables: [{ name: 'declared', type: 'string' }],
            },
          },
          {
            id: 'ss',
            type: 'setState',
            config: { assignments: [{ name: 'undeclared', expression: '"x"' }] },
          },
        ],
        [{ id: 'e1', source: 's', target: 'ss' }],
      ),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes('undeclared')));
  });

  it('warns about unknown variables in templates and CEL config values', () => {
    const result = validateGraph(
      g(
        [
          { id: 's', type: 'start', data: {} },
          {
            id: 'a',
            type: 'agent',
            data: {
              label: 'Writer',
              instructions: 'Use {{missing_agent.output_text}}',
            },
          },
          {
            id: 't',
            type: 'transform',
            config: {
              outputs: [{ name: 'value', type: 'string', expression: 'writer.output_text' }],
            },
          },
          {
            id: 'e',
            type: 'end',
            config: { output: '$cel:unknown_result.value' },
          },
        ],
        [
          { id: 'e1', source: 's', target: 'a' },
          { id: 'e2', source: 'a', target: 't' },
          { id: 'e3', source: 't', target: 'e' },
        ],
      ),
    );

    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.ok(result.warnings.some((w) => w.message.includes("unknown variable 'missing_agent'")));
    assert.ok(result.warnings.some((w) => w.message.includes("unknown variable 'unknown_result'")));
    assert.ok(!result.warnings.some((w) => w.message.includes("unknown variable 'writer'")));
  });

  it('does not treat CEL macro locals or global functions as workflow variables', () => {
    const result = validateGraph(
      g(
        [
          {
            id: 's',
            type: 'start',
            config: {
              inputVariables: [],
              stateVariables: [{ name: 'items', type: 'list', initialValue: [1, 2, 3] }],
            },
          },
          {
            id: 'i',
            type: 'ifElse',
            config: {
              branches: [{
                id: 'b',
                condition: 'state.items.exists(item, item > 2) && size(state.items) > 0',
              }],
            },
          },
          { id: 'e', type: 'end', data: {} },
        ],
        [
          { id: 'e1', source: 's', target: 'i' },
          { id: 'e2', source: 'i', target: 'e', sourceHandle: 'b' },
          { id: 'e3', source: 'i', target: 'e', sourceHandle: 'else' },
        ],
      ),
    );

    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.ok(!result.warnings.some((w) => w.message.includes("unknown variable 'item'")));
    assert.ok(!result.warnings.some((w) => w.message.includes("unknown variable 'size'")));
  });

  it('ignores template-looking braces inside function tool source code', () => {
    const result = validateGraph(
      g(
        [
          { id: 's', type: 'start', data: {} },
          {
            id: 'a',
            type: 'agent',
            data: {
              tools: [{
                kind: 'function',
                name: 'render',
                execution: { mode: 'js', code: 'return "{{not_a_workflow_variable}}";' },
              }],
            },
          },
        ],
        [{ id: 'e', source: 's', target: 'a' }],
      ),
    );
    assert.ok(!result.warnings.some((w) => w.message.includes("unknown variable 'not_a_workflow_variable'")));
  });

  it('rejects duplicate or invalid typed names and agent ranges', () => {
    const result = validateGraph(
      g(
        [
          {
            id: 's',
            type: 'start',
            config: {
              inputVariables: [
                { name: 'customer-name', type: 'string' },
                { name: 'customer-name', type: 'string' },
              ],
              stateVariables: [{ name: 'counter', type: 'number' }],
            },
          },
          {
            id: 'a',
            type: 'agent',
            data: { maxTurns: 0, modelParams: { temperature: 3 } },
          },
        ],
        [{ id: 'e', source: 's', target: 'a' }],
      ),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes('duplicate input variable')));
    assert.ok(result.errors.some((e) => e.message.includes('CEL identifier')));
    assert.ok(result.errors.some((e) => e.message.includes('maxTurns')));
    assert.ok(result.errors.some((e) => e.message.includes('temperature')));
  });
});
