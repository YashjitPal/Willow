import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { exportPython, exportTypeScript } from '../src/codegen/index.ts';
import { normalizeGraph } from '../src/domain/normalize.ts';

function exportGraph() {
  return normalizeGraph({
    nodes: [
      {
        id: 's',
        type: 'start',
        config: {
          inputVariables: [{ name: 'input_as_text', type: 'string' }],
          stateVariables: [{ name: 'count', type: 'number', initialValue: 0 }],
        },
      },
      {
        id: 'route',
        type: 'ifElse',
        config: {
          branches: [
            { id: 'first', label: 'First', condition: 'state.count < 2' },
            { id: 'second', label: 'Second', condition: 'workflow.input_as_text.contains("search")' },
          ],
        },
      },
      {
        id: 'transform',
        type: 'transform',
        config: { outputs: [{ name: 'next_count', type: 'number', expression: 'state.count + 1' }] },
      },
      {
        id: 'state',
        type: 'setState',
        config: { assignments: [{ name: 'count', expression: 'transform.next_count' }] },
      },
      {
        id: 'loop',
        type: 'while',
        config: { condition: 'state.count < 3', maxIterations: 4, onMaxIterations: 'break' },
      },
      { id: 'approval', type: 'userApproval', config: { message: 'Approve {{workflow.input_as_text}}?' } },
      { id: 'guard', type: 'guardrail', config: { pii: true, input: '{{workflow.input_as_text}}' } },
      {
        id: 'search',
        type: 'fileSearch',
        config: { vectorStoreIds: ['vs_docs'], query: '{{workflow.input_as_text}}' },
      },
      {
        id: 'mcp',
        type: 'mcp',
        config: { serverId: 'mcp_server', tool: 'lookup', arguments: { query: '{{workflow.input_as_text}}' } },
      },
      { id: 'end', type: 'end', config: { output: '$cel:state.count' } },
    ],
    edges: [
      { id: 's-route', source: 's', target: 'route' },
      { id: 'route-transform', source: 'route', target: 'transform', sourceHandle: 'first' },
      { id: 'route-approval', source: 'route', target: 'approval', sourceHandle: 'second' },
      { id: 'route-end', source: 'route', target: 'end', sourceHandle: 'else' },
      { id: 'transform-state', source: 'transform', target: 'state' },
      { id: 'state-loop', source: 'state', target: 'loop' },
      { id: 'loop-transform', source: 'loop', target: 'transform', sourceHandle: 'loop' },
      { id: 'loop-end', source: 'loop', target: 'end', sourceHandle: 'done' },
      { id: 'approval-guard', source: 'approval', target: 'guard', sourceHandle: 'approved' },
      { id: 'approval-end', source: 'approval', target: 'end', sourceHandle: 'rejected' },
      { id: 'guard-search', source: 'guard', target: 'search', sourceHandle: 'pass' },
      { id: 'guard-end', source: 'guard', target: 'end', sourceHandle: 'fail' },
      { id: 'search-mcp', source: 'search', target: 'mcp' },
      { id: 'mcp-end', source: 'mcp', target: 'end' },
    ],
  }).graph;
}

describe('code export', () => {
  it('emits executable TypeScript control flow and integration hooks', async () => {
    const code = exportTypeScript('Export parity', exportGraph());
    assert.doesNotMatch(code, /TODO/);
    assert.match(code, /evaluateExpression\("state\.count < 2"/);
    assert.match(code, /hooks\.approve/);
    assert.match(code, /hooks\.guardrail/);
    assert.match(code, /hooks\.fileSearch/);
    assert.match(code, /hooks\.mcp/);
    assert.match(code, /finalOutput = resolveValue\("\$cel:state\.count"/);

    const transpiled = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    const errors = (transpiled.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    assert.deepEqual(errors.map((diagnostic) => diagnostic.messageText), []);

    const exports: Record<string, any> = {};
    const require = (moduleName: string) => {
      assert.equal(moduleName, '@openai/agents');
      return {
        Agent: class Agent { constructor(_config: unknown) {} },
        run: async () => ({ finalOutput: 'unused' }),
      };
    };
    new Function('exports', 'require', transpiled.outputText)(exports, require);
    assert.equal(await exports.runWorkflow('hello'), 3);
  });

  it('emits syntactically valid Python without placeholder branches', () => {
    const code = exportPython('Export parity', exportGraph());
    assert.doesNotMatch(code, /TODO/);
    assert.match(code, /bool\(_eval\("state\.count < 2"/);
    assert.match(code, /_call\(hooks\["approve"\]/);
    assert.match(code, /_call\(hooks\["file_search"\]/);
    assert.match(code, /final_output = _resolve\("\$cel:state\.count"/);

    const compiled = spawnSync(
      'python',
      [
        '-c',
        [
          'import sys, types',
          'module = types.ModuleType("agents")',
          'module.Agent = type("Agent", (), {"__init__": lambda self, **kwargs: None})',
          'module.Runner = type("Runner", (), {})',
          'sys.modules["agents"] = module',
          'exec(compile(sys.stdin.read(), "<generated>", "exec"))',
        ].join('; '),
      ],
      { input: code, encoding: 'utf8' },
    );
    if (compiled.error && (compiled.error as NodeJS.ErrnoException).code === 'ENOENT') return;
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.match(compiled.stdout.trim(), /3$/);
  });
});
