import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { exportPython, exportPythonSdkPackage, exportTypeScript, exportTypeScriptSdkPackage } from '../src/codegen/index.ts';
import { normalizeGraph } from '../src/domain/normalize.ts';

const nodeRequire = createRequire(import.meta.url);

function exportGraph() {
  return normalizeGraph({
    nodes: [
      {
        id: 's',
        type: 'start',
        config: {
          inputVariables: [{ name: 'input_as_text', type: 'string' }, { name: 'mode', type: 'string', defaultValue: 'standard' }],
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
        id: 'agent_export_contract',
        type: 'agent',
        config: {
          instructions: 'Export settings', model: 'gpt-5', tools: [{ kind: 'function', name: 'lookup_export', description: 'Lookup exported data', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, execution: { mode: 'http', url: 'https://example.invalid/tool', headers: { Authorization: 'Bearer must-not-export' } } }], toolChoice: 'none', parallelToolCalls: false,
          modelParams: { temperature: 0.2, topP: 0.9, maxTokens: 512 }, reasoningEffort: 'low', verbosity: 'high', maxTurns: 7,
          outputFormat: 'text', includeChatHistory: true, writeToConversationHistory: true, continueOnError: false,
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
      { id: 'approval', type: 'userApproval', config: { message: 'Approve {{workflow.input_as_text}}?', timeoutMs: 5000 } },
      { id: 'guard', type: 'guardrail', config: { pii: true, input: '{{workflow.input_as_text}}', continueOnError: true, onTripwire: 'stop' } },
      {
        id: 'search',
        type: 'fileSearch',
        config: { vectorStoreIds: ['vs_docs'], query: '{{workflow.input_as_text}}', executionPolicy: { timeoutMs: 1200, maxRetries: 2, retryBackoffMs: 10 } },
      },
      {
        id: 'mcp',
        type: 'mcp',
        config: { serverId: 'mcp_server', tool: 'lookup', arguments: { query: '{{workflow.input_as_text}}' }, requireApproval: 'always', continueOnError: true, executionPolicy: { timeoutMs: 2500, maxRetries: 1 } },
      },
      { id: 'end', type: 'end', config: { output: '$cel:state.count', outputSchema: { type: 'integer', minimum: 0, maximum: 10 } } },
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

function agentToolGraph() {
  return normalizeGraph({
    nodes: [
      { id: 's', type: 'start', data: {} },
      { id: 'a', type: 'agent', config: { instructions: 'Use the tool', model: 'gpt-5', tools: [{ kind: 'function', name: 'lookup', description: 'Lookup data', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, execution: { mode: 'client' } }], toolChoice: { name: 'lookup' }, outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false, continueOnError: false } },
      { id: 'e', type: 'end', config: {} },
    ],
    edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
  }).graph;
}

function historyGraph() {
  return normalizeGraph({
    nodes: [
      { id: 's', type: 'start', data: {} },
      { id: 'first', type: 'agent', name: 'First', config: {
        instructions: 'First', model: 'gpt-5', tools: [], outputFormat: 'text',
        includeChatHistory: true, writeToConversationHistory: true, maxTurns: 3,
        modelParams: { temperature: 0.2, topP: 0.8, maxTokens: 120 }, reasoningEffort: 'low', verbosity: 'high',
        promptCache: { policy: 'enabled', key: 'history-thread', retention: '24h' },
      } },
      { id: 'second', type: 'agent', name: 'Second', config: {
        instructions: 'Second', model: 'gpt-5', tools: [], outputFormat: 'text',
        includeChatHistory: true, writeToConversationHistory: false, maxTurns: 4,
      } },
      { id: 'e', type: 'end', config: { output: '{{second.output_text}}' } },
    ],
    edges: [
      { id: 'sa', source: 's', target: 'first' },
      { id: 'ab', source: 'first', target: 'second' },
      { id: 'be', source: 'second', target: 'e' },
    ],
  }).graph;
}

function subflowGraph() {
  return normalizeGraph({
    nodes: [
      { id: 's', type: 'start', config: { inputVariables: [{ name: 'input_as_text', type: 'string' }, { name: 'mode', type: 'string', defaultValue: 'standard' }], stateVariables: [{ name: 'count', type: 'number', initialValue: 2 }] } },
      { id: 'call', type: 'subflow', name: 'Call child', config: {
        workflowId: 'wf_child', version: 3, maxDepth: 6, onError: 'fail',
        inputMappings: [
          { target: 'input_as_text', value: '{{workflow.input_as_text}}' },
          { target: 'variables.mode', value: '{{workflow.mode}}' },
          { target: 'state_variables.count', value: '$cel:state.count' },
        ],
        outputMappings: [
          { name: 'answer', type: 'string', expression: '{{child.output_text}}' },
          { name: 'child_count', type: 'number', expression: '$cel:child.state.count' },
        ],
      } },
      { id: 'e', type: 'end', config: { output: '{{call_child.answer}}' } },
    ],
    edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
  }).graph;
}

function handoffGraph() {
  return normalizeGraph({
    nodes: [
      { id: 's', type: 'start', data: {} },
      { id: 'source', type: 'agent', name: 'Triage', config: {
        instructions: 'Triage {{workflow.input_as_text}}', model: 'gpt-5', tools: [], outputFormat: 'text',
        includeChatHistory: false, writeToConversationHistory: false, continueOnError: false,
        handoffs: [{ targetNodeId: 'specialist', toolName: 'transfer_specialist', description: 'Use the specialist.' }],
      } },
      { id: 'specialist', type: 'agent', name: 'Specialist', config: {
        instructions: 'Handle {{triage.handoff_reason}}', model: 'gpt-5', tools: [], outputFormat: 'text',
        includeChatHistory: false, writeToConversationHistory: false, continueOnError: false,
      } },
      { id: 'fallback', type: 'end', config: { output: 'fallback' } },
      { id: 'done', type: 'end', config: { output: '{{specialist.output_text}}' } },
    ],
    edges: [
      { id: 'ss', source: 's', target: 'source' },
      { id: 'sf', source: 'source', target: 'fallback' },
      { id: 'sd', source: 'specialist', target: 'done' },
    ],
  }).graph;
}

function reenteredWhileGraph() {
  return normalizeGraph({
    nodes: [
      { id: 's', type: 'start', config: { stateVariables: [
        { name: 'phase', type: 'number', initialValue: 0 },
        { name: 'count', type: 'number', initialValue: 0 },
        { name: 'total', type: 'number', initialValue: 0 },
      ] } },
      { id: 'loop', type: 'while', name: 'Reusable loop', config: {
        condition: 'state.count < 2',
        maxIterations: 2,
        onMaxIterations: 'break',
      } },
      { id: 'increment', type: 'setState', config: { assignments: [
        { name: 'count', expression: 'state.count + 1' },
        { name: 'total', expression: 'state.total + 1' },
      ] } },
      { id: 'again', type: 'ifElse', config: { branches: [
        { id: 'repeat', label: 'Repeat', condition: 'state.phase == 0' },
      ] } },
      { id: 'reset', type: 'setState', config: { assignments: [
        { name: 'phase', expression: '1' },
        { name: 'count', expression: '1' },
      ] } },
      { id: 'end', type: 'end', config: { output: '$cel:state.total' } },
    ],
    edges: [
      { id: 's-loop', source: 's', target: 'loop' },
      { id: 'loop-increment', source: 'loop', target: 'increment', sourceHandle: 'loop' },
      { id: 'increment-loop', source: 'increment', target: 'loop', targetHandle: 'loop_back' },
      { id: 'loop-again', source: 'loop', target: 'again', sourceHandle: 'done' },
      { id: 'again-reset', source: 'again', target: 'reset', sourceHandle: 'repeat' },
      { id: 'again-end', source: 'again', target: 'end', sourceHandle: 'else' },
      { id: 'reset-loop', source: 'reset', target: 'loop' },
    ],
  }).graph;
}

describe('code export', () => {
  it('enforces Transform and Set state types in TypeScript and Python exports', async () => {
    const graph = normalizeGraph({
      nodes: [
        { id: 's', type: 'start', config: { stateVariables: [{ name: 'flag', type: 'boolean', initialValue: 'false' }] } },
        { id: 't', type: 'transform', config: { outputs: [
          { name: 'n', type: 'number', expression: '"42"' },
          { name: 'items', type: 'list', expression: '"[1,2]"' },
        ] } },
        { id: 'set', type: 'setState', config: { assignments: [{ name: 'flag', expression: '"true"' }] } },
        { id: 'e', type: 'end', config: { output: '$cel:{"n": transform.n, "items": transform.items, "flag": state.flag}' } },
      ],
      edges: [
        { id: 'st', source: 's', target: 't' },
        { id: 'ts', source: 't', target: 'set' },
        { id: 'se', source: 'set', target: 'e' },
      ],
    }).graph;

    const tsCode = exportTypeScript('Typed data', graph);
    const transpiled = ts.transpileModule(tsCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const exports: Record<string, any> = {};
    const require = (moduleName: string) => moduleName === 'zod' ? nodeRequire('zod') : { Agent: class {}, tool: (config: unknown) => config, run: async () => ({ finalOutput: null }) };
    new Function('exports', 'require', transpiled.outputText)(exports, require);
    assert.deepEqual(await exports.runWorkflow(''), { n: 42, items: [1, 2], flag: true });

    const executed = spawnSync('python', ['-c', [
      'import asyncio, json, sys, types',
      'module = types.ModuleType("agents")',
      'module.Agent = module.FunctionTool = module.ModelSettings = type("Stub", (), {"__init__": lambda self, **kwargs: None})',
      'module.Runner = type("Runner", (), {})',
      'sys.modules["agents"] = module',
      'scope = {}',
      'exec(sys.stdin.read(), scope)',
      'print(json.dumps(asyncio.run(scope["run_workflow"]("")), separators=(",", ":")))',
    ].join('\n')], { input: exportPython('Typed data', graph), encoding: 'utf8' });
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stdout.trim(), '{"n":42,"items":[1,2],"flag":true}');
  });

  it('redacts raw, URL-encoded, Base64, and Base64url secret variants in generated runtimes', () => {
    const graph = normalizeGraph({
      nodes: [{ id: 's', type: 'start', data: {} }, { id: 'e', type: 'end', config: {} }],
      edges: [{ id: 'se', source: 's', target: 'e' }],
    }).graph;
    const secret = 'päss+/ token';
    const base64 = Buffer.from(secret, 'utf8').toString('base64');
    const variants = [secret, encodeURIComponent(secret), encodeURIComponent(secret).toLowerCase(), base64, base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')];
    const payload = Object.fromEntries(variants.map((variant, index) => [`value${index}`, `prefix:${variant}:suffix`]));

    const tsCode = exportTypeScript('Secret redaction', graph).replace('function redactSecrets(', 'export function redactSecrets(');
    const transpiled = ts.transpileModule(tsCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const exports: Record<string, any> = {};
    const require = (id: string) => id === 'zod' ? nodeRequire('zod') : ({
      Agent: class Agent { constructor(_config: unknown) {} }, tool: (config: unknown) => config, run: async () => ({ finalOutput: null }),
    });
    new Function('exports', 'require', transpiled.outputText)(exports, require);
    const tsRedacted = exports.redactSecrets(payload, { API_TOKEN: secret });
    assert.deepEqual(Object.values(tsRedacted), variants.map(() => 'prefix:[REDACTED]:suffix'));

    const pyCode = exportPython('Secret redaction', graph);
    const executed = spawnSync('python', ['-c', [
      'import sys, types, json',
      'module = types.ModuleType("agents")',
      'class Stub:\n def __init__(self, *args, **kwargs): self.__dict__.update(kwargs)',
      'module.Agent = module.FunctionTool = module.ModelSettings = Stub',
      'module.Runner = type("Runner", (), {})',
      'sys.modules["agents"] = module',
      'ns = {"__name__": "generated"}',
      'exec(compile(sys.stdin.read(), "<generated>", "exec"), ns)',
      `print(json.dumps(ns["_redact_secrets"](${JSON.stringify(payload)}, {"API_TOKEN": ${JSON.stringify(secret)}}), ensure_ascii=False))`,
    ].join('\n')], { input: pyCode, encoding: 'utf8' });
    if (!executed.error || (executed.error as NodeJS.ErrnoException).code !== 'ENOENT') {
      assert.equal(executed.status, 0, executed.stderr);
      assert.deepEqual(Object.values(JSON.parse(executed.stdout)), variants.map(() => 'prefix:[REDACTED]:suffix'));
    }
  });

  it('preserves approval decisions as node output in TypeScript and Python', async () => {
    const graph = normalizeGraph({
      nodes: [
        { id: 's', type: 'start', data: {} },
        { id: 'approval', type: 'userApproval', name: 'Approval', config: { message: 'Proceed?' } },
        { id: 'approved', type: 'end', config: { output: '$cel:approval.approved' } },
        { id: 'rejected', type: 'end', config: { output: '$cel:approval.reason' } },
      ],
      edges: [
        { id: 's-approval', source: 's', target: 'approval' },
        { id: 'approval-approved', source: 'approval', target: 'approved', sourceHandle: 'approved' },
        { id: 'approval-rejected', source: 'approval', target: 'rejected', sourceHandle: 'rejected' },
      ],
    }).graph;

    const tsCode = exportTypeScript('Approval output', graph);
    const transpiled = ts.transpileModule(tsCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const exports: Record<string, any> = {};
    const require = (id: string) => id === 'zod' ? nodeRequire('zod') : ({
      Agent: class Agent { constructor(_config: unknown) {} },
      tool: (config: unknown) => config,
      run: async () => ({ finalOutput: null }),
    });
    new Function('exports', 'require', transpiled.outputText)(exports, require);
    assert.equal(await exports.runWorkflow('', {}, { approve: async () => true }), true);
    assert.equal(
      await exports.runWorkflow('', {}, { approve: async () => ({ approved: false, reason: 'Revise the draft.' }) }),
      'Revise the draft.',
    );

    const pyCode = exportPython('Approval output', graph);
    const executed = spawnSync('python', ['-c', [
      'import sys, types, asyncio',
      'module = types.ModuleType("agents")',
      'class Stub:\n def __init__(self, *args, **kwargs): self.__dict__.update(kwargs)',
      'module.Agent = module.FunctionTool = module.ModelSettings = Stub',
      'module.Runner = type("Runner", (), {})',
      'sys.modules["agents"] = module',
      'ns = {"__name__": "generated"}',
      'exec(compile(sys.stdin.read(), "<generated>", "exec"), ns)',
      'async def reject(_message): return {"approved": False, "reason": "Revise the draft."}',
      'print(asyncio.run(ns["run_workflow"]("", hooks={"approve": reject})))',
    ].join('\n')], { input: pyCode, encoding: 'utf8' });
    if (!executed.error || (executed.error as NodeJS.ErrnoException).code !== 'ENOENT') {
      assert.equal(executed.status, 0, executed.stderr);
      assert.equal(executed.stdout.trim(), 'Revise the draft.');
    }
  });

  it('resets While counters after exit before re-entering in TypeScript and Python', async () => {
    const graph = reenteredWhileGraph();
    const tsCode = exportTypeScript('While re-entry', graph);
    const transpiled = ts.transpileModule(tsCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const exports: Record<string, any> = {};
    const require = (id: string) => id === 'zod' ? nodeRequire('zod') : ({
      Agent: class Agent { constructor(_config: unknown) {} },
      tool: (config: unknown) => config,
      run: async () => ({ finalOutput: null }),
    });
    new Function('exports', 'require', transpiled.outputText)(exports, require);
    assert.equal(await exports.runWorkflow(''), 3);

    const pyCode = exportPython('While re-entry', graph);
    const executed = spawnSync('python', ['-c', [
      'import sys, types, asyncio',
      'module = types.ModuleType("agents")',
      'class Stub:\n def __init__(self, *args, **kwargs): self.__dict__.update(kwargs)',
      'module.Agent = module.FunctionTool = module.ModelSettings = Stub',
      'module.Runner = type("Runner", (), {})',
      'sys.modules["agents"] = module',
      'ns = {"__name__": "generated"}',
      'exec(compile(sys.stdin.read(), "<generated>", "exec"), ns)',
      'print(asyncio.run(ns["run_workflow"]("")))',
    ].join('\n')], { input: pyCode, encoding: 'utf8' });
    if (!executed.error || (executed.error as NodeJS.ErrnoException).code !== 'ENOENT') {
      assert.equal(executed.status, 0, executed.stderr);
      assert.equal(executed.stdout.trim(), '3');
    }
  });

  it('ignores Note artifacts and fails closed on missing canonical transitions', async () => {
    const graph = normalizeGraph({
      nodes: [
        { id: 's', type: 'start', data: {} },
        { id: 'a', type: 'agent', config: { instructions: '', model: 'mock/echo', tools: [], outputFormat: 'text' } },
        { id: 'note', type: 'note', data: { label: 'Designer annotation' } },
        { id: 'end', type: 'end', config: {} },
      ],
      edges: [
        { id: 'sa', source: 's', target: 'a' },
        { id: 'a-note', source: 'a', target: 'note' },
        { id: 'note-end', source: 'note', target: 'end' },
      ],
    }).graph;
    const tsCode = exportTypeScript('Note semantics', graph);
    const pyCode = exportPython('Note semantics', graph);
    assert.doesNotMatch(tsCode, /case "note"/);
    assert.doesNotMatch(pyCode, /# note:/);
    assert.match(tsCode, /requireTransition\("a", null\)/);
    assert.match(pyCode, /_require_transition\("a", None\)/);

    const strictGraph = normalizeGraph({
      nodes: [
        { id: 's', type: 'start', data: {} },
        { id: 'transform', type: 'transform', config: { outputs: [] } },
        { id: 'end', type: 'end', config: {} },
      ],
      edges: [{ id: 's-transform', source: 's', target: 'transform' }],
    }).graph;
    const strictTs = exportTypeScript('Strict transitions', strictGraph);
    assert.match(strictTs, /has no executable transition/);
    const transpiled = ts.transpileModule(strictTs, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    const exports: Record<string, any> = {};
    const z: any = new Proxy(() => z, { get: () => z, apply: () => z });
    const require = (moduleName: string) => {
      if (moduleName === 'zod') return { z };
      assert.equal(moduleName, '@openai/agents');
      return { Agent: class Agent { constructor(_config: unknown) {} }, tool: (config: unknown) => config, run: async () => ({ finalOutput: null }) };
    };
    new Function('exports', 'require', transpiled.outputText)(exports, require);
    await assert.rejects(() => exports.runWorkflow('hello'), /has no executable transition/);

    const strictPy = exportPython('Strict transitions', strictGraph);
    const executed = spawnSync(
      'python',
      [
        '-c',
        [
          'import sys, types',
          'module = types.ModuleType("agents")',
          'module.Agent = type("Agent", (), {"__init__": lambda self, **kwargs: None})',
          'module.ModelSettings = type("ModelSettings", (), {"__init__": lambda self, **kwargs: None})',
          'module.FunctionTool = type("FunctionTool", (), {"__init__": lambda self, **kwargs: None})',
          'module.Runner = type("Runner", (), {})',
          'sys.modules["agents"] = module',
          'exec(compile(sys.stdin.read(), "<generated>", "exec"))',
        ].join('; '),
      ],
      { input: strictPy, encoding: 'utf8' },
    );
    if (!executed.error || (executed.error as NodeJS.ErrnoException).code !== 'ENOENT') {
      assert.notEqual(executed.status, 0);
      assert.match(executed.stderr, /has no executable transition/);
    }
  });

  it('routes fail, continue, and branch node errors consistently', async () => {
    const loadTypeScript = (code: string) => {
      const transpiled = ts.transpileModule(code, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        reportDiagnostics: true,
      });
      const exports: Record<string, any> = {};
      const require = (moduleName: string) => {
        assert.equal(moduleName, '@openai/agents');
        return { Agent: class Agent { constructor(_config: unknown) {} }, tool: (config: unknown) => config, run: async () => ({ finalOutput: null }) };
      };
      new Function('exports', 'require', transpiled.outputText)(exports, require);
      return exports;
    };

    const continueGraph = normalizeGraph({
      nodes: [
        { id: 's', type: 'start', data: {} },
        { id: 't', type: 'transform', config: { onError: 'continue', outputs: [{ name: 'value', type: 'string', expression: 'missing.value' }] } },
        { id: 'e', type: 'end', config: { output: '$cel: transform.error' } },
      ],
      edges: [{ id: 'st', source: 's', target: 't' }, { id: 'te', source: 't', target: 'e' }],
    }).graph;
    const continueTs = exportTypeScript('Continue errors', continueGraph);
    const continuePython = exportPython('Continue errors', continueGraph);
    assert.match(continueTs, /node_execution_error/);
    assert.match(continuePython, /node_execution_error/);
    assert.match(continuePython, /policy\["defaultTarget"\]/);
    const continueResult = await loadTypeScript(continueTs).runWorkflow('hello');
    assert.deepEqual(continueResult, {
      type: 'node_execution_error',
      message: "CEL expression failed: missing.value (unknown variable 'missing')",
      nodeId: 't',
      nodeType: 'transform',
    });

    const branchGraph = normalizeGraph({
      nodes: [
        { id: 's', type: 'start', data: {} },
        { id: 't', type: 'transform', config: { onError: 'branch', outputs: [{ name: 'value', type: 'string', expression: 'missing.value' }] } },
        { id: 'default', type: 'end', config: { output: 'DEFAULT' } },
        { id: 'error', type: 'end', config: { output: 'ERROR BRANCH' } },
      ],
      edges: [
        { id: 'st', source: 's', target: 't' },
        { id: 'td', source: 't', target: 'default' },
        { id: 'te', source: 't', target: 'error', sourceHandle: 'error' },
      ],
    }).graph;
    const branchResult = await loadTypeScript(exportTypeScript('Branch errors', branchGraph)).runWorkflow('hello');
    assert.equal(branchResult, 'ERROR BRANCH');

    const failGraph = normalizeGraph({
      nodes: [
        { id: 's', type: 'start', data: {} },
        { id: 't', type: 'transform', config: { onError: 'fail', outputs: [{ name: 'value', type: 'string', expression: 'missing.value' }] } },
        { id: 'e', type: 'end', config: { output: 'UNREACHABLE' } },
      ],
      edges: [{ id: 'st', source: 's', target: 't' }, { id: 'te', source: 't', target: 'e' }],
    }).graph;
    await assert.rejects(() => loadTypeScript(exportTypeScript('Fail errors', failGraph)).runWorkflow('hello'), /CEL expression failed/);
  });

  it('emits executable TypeScript control flow and integration hooks', async () => {
    const code = exportTypeScript('Export parity', exportGraph());
    assert.doesNotMatch(code, /TODO/);
    assert.match(code, /evaluateExpression\("state\.count < 2"/);
    assert.match(code, /hooks\.approve/);
    assert.match(code, /hooks\.guardrail/);
    assert.match(code, /hooks\.fileSearch/);
    assert.match(code, /hooks\.mcp/);
    assert.match(code, /finalOutput = resolveValue\("\$cel:state\.count"/);
    assert.match(code, /Promise\.race/);
    assert.match(code, /assertSchema\(finalOutput/);
    assert.match(code, /"mode":"standard"/);
    assert.match(code, /if \(!hooks\.approve\) throw new Error\("MCP 'MCP' requires hooks\.approve"\)/);
    assert.match(code, /const mcpApprovalResult = await hooks\.approve/);
    assert.match(code, /typeof mcpApprovalResult === 'boolean' \? mcpApprovalResult : mcpApprovalResult\.approved/);
    const pythonCode = exportPython('Export parity', exportGraph());
    assert.match(pythonCode, /mcp_approval_result = await _call\(hooks\["approve"\]/);
    assert.match(pythonCode, /mcp_approved = mcp_approval_result if isinstance\(mcp_approval_result, bool\) else bool\(mcp_approval_result\.get\("approved"\)\)/);
    assert.match(code, /catch \(error\).*output_text: ''/s);
    assert.match(code, /if \(!passed\) throw new Error\("Guardrails 'Guardrails' tripwire triggered"\)/);
    assert.match(code, /modelSettings: \{"toolChoice":"none","parallelToolCalls":false,"temperature":0\.2,"topP":0\.9,"maxTokens":512,"reasoning":\{"effort":"low"\},"text":\{"verbosity":"high"\}\}/);
    assert.match(code, /resetToolChoice: true/);
    assert.match(code, /parameters: z\.object\(\{ "query": z\.string\(\) \}\)\.strict\(\)/);
    assert.match(code, /function agentInput\(/);
    assert.match(code, /maxTurns: 7/);
    assert.match(code, /conversationHistory\.push/);
    assert.match(code, /executeHttpTool/);
    assert.match(code, /async function runToolCall/);
    assert.match(code, /"timeoutMs":1200/);
    assert.match(code, /name: "lookup_export"/);
    assert.doesNotMatch(code, /must-not-export/);

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
      if (moduleName === 'zod') return nodeRequire('zod');
      assert.equal(moduleName, '@openai/agents');
      return {
        Agent: class Agent { constructor(_config: unknown) {} },
        tool: (config: unknown) => config,
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
    assert.match(code, /asyncio\.wait_for/);
    assert.match(code, /_assert_schema\(final_output/);
    assert.match(code, /"mode": "standard"/);
    assert.match(code, /mcp_approval_result = await _call\(hooks\["approve"\]/);
    assert.match(code, /mcp_approved = mcp_approval_result if isinstance\(mcp_approval_result, bool\) else bool\(mcp_approval_result\.get\("approved"\)\)/);
    assert.match(code, /except Exception as error:/);
    assert.match(code, /if not passed: raise RuntimeError\("Guardrails 'Guardrails' tripwire triggered"\)/);
    assert.match(code, /model_settings=ModelSettings\([^\n]*tool_choice="none"[^\n]*parallel_tool_calls=False/);
    assert.match(code, /_agent_input\(conversation_history, prompt\)/);
    assert.match(code, /max_turns=7/);
    assert.match(code, /conversation_history\.append/);
    assert.match(code, /reset_tool_choice=True/);
    assert.match(code, /FunctionTool\(name="lookup_export"/);
    assert.match(code, /_execute_http_tool/);
    assert.match(code, /async def _run_tool/);
    assert.match(code, /"timeoutMs": 1200/);
    assert.doesNotMatch(code, /must-not-export/);

    const compiled = spawnSync(
      'python',
      [
        '-c',
        [
          'import sys, types',
          'module = types.ModuleType("agents")',
          'module.Agent = type("Agent", (), {"__init__": lambda self, **kwargs: None})',
          'module.ModelSettings = type("ModelSettings", (), {"__init__": lambda self, **kwargs: None})',
          'module.FunctionTool = type("FunctionTool", (), {"__init__": lambda self, **kwargs: None})',
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

  it('preserves agent history, model settings, and turn caps in generated runners', async () => {
    const code = exportTypeScript('History parity', historyGraph());
    const transpiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const exports: Record<string, any> = {};
    const calls: any[] = [];
    const require = (id: string) => id === 'zod' ? nodeRequire('zod') : ({
      Agent: class Agent { config: any; constructor(config: any) { this.config = config; } },
      tool: (config: any) => config,
      run: async (agent: any, input: any, options: any) => {
        calls.push({ name: agent.config.name, input, options, modelSettings: agent.config.modelSettings });
        return { finalOutput: agent.config.name === 'First' ? 'first output' : 'second output' };
      },
    });
    new Function('exports', 'require', transpiled.outputText)(exports, require);
    const output = await exports.runWorkflow('current', {}, {}, [{ role: 'user', content: 'prior' }]);
    assert.equal(output, 'second output');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.maxTurns, 3);
    assert.equal(calls[1].options.maxTurns, 4);
    assert.deepEqual(calls[0].input.map((item: any) => item.role), ['user', 'user']);
    assert.deepEqual(calls[1].input.map((item: any) => item.role), ['user', 'assistant', 'user']);
    assert.equal(calls[1].input[1].content[0].text, 'first output');
    assert.equal(calls[0].modelSettings.temperature, 0.2);
    assert.equal(calls[0].modelSettings.reasoning.effort, 'low');
    assert.equal(calls[0].modelSettings.text.verbosity, 'high');
    assert.equal(calls[0].modelSettings.providerData.prompt_cache_key, 'history-thread');

    const python = exportPython('History parity', historyGraph());
    assert.match(python, /_agent_input\(conversation_history, prompt\)/);
    assert.match(python, /max_turns=3/);
    assert.match(python, /temperature=0\.2, top_p=0\.8, max_tokens=120/);
    assert.match(python, /reasoning=\{"effort": "low"\}, verbosity="high"/);
    assert.match(python, /prompt_cache_key/);
  });

  it('executes exported agent tools through invocation-scoped hooks', async () => {
    const tsCode = exportTypeScript('Tool export', agentToolGraph());
    const transpiled = ts.transpileModule(tsCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const exports: Record<string, any> = {};
    const require = (id: string) => id === 'zod' ? nodeRequire('zod') : ({
      Agent: class Agent { config: any; constructor(config: any) { this.config = config; } },
      tool: (config: any) => config,
      run: async (agent: any) => ({ finalOutput: await agent.config.tools[0].execute({ query: 'Ada' }) }),
    });
    new Function('exports', 'require', transpiled.outputText)(exports, require);
    const calls: any[] = [];
    const output = await exports.runWorkflow('hello', {}, { agentTool: async (call: any) => { calls.push(call); return `found:${call.arguments.query}`; } });
    assert.equal(output, 'found:Ada');
    assert.equal(calls[0].nodeId, 'a');
    assert.equal(calls[0].name, 'lookup');

    const pyCode = exportPython('Tool export', agentToolGraph());
    const executed = spawnSync('python', ['-c', [
      'import sys, types, asyncio, json',
      'module = types.ModuleType("agents")',
      'class Agent:\n def __init__(self, **kwargs): self.__dict__.update(kwargs)',
      'class FunctionTool:\n def __init__(self, **kwargs): self.__dict__.update(kwargs)',
      'class ModelSettings:\n def __init__(self, **kwargs): self.__dict__.update(kwargs)',
      'class Runner:\n @staticmethod\n async def run(agent, prompt, **kwargs): return types.SimpleNamespace(final_output=await agent.tools[0].on_invoke_tool(None, json.dumps({"query":"Ada"})))',
      'module.Agent, module.FunctionTool, module.ModelSettings, module.Runner = Agent, FunctionTool, ModelSettings, Runner',
      'sys.modules["agents"] = module',
      'ns = {"__name__": "generated"}',
      'exec(compile(sys.stdin.read(), "<generated>", "exec"), ns)',
      'async def hook(call): return "found:" + call["arguments"]["query"]',
      'print(asyncio.run(ns["run_workflow"]("hello", hooks={"agent_tool": hook})))',
    ].join('\n')], { input: pyCode, encoding: 'utf8' });
    if (!executed.error || (executed.error as NodeJS.ErrnoException).code !== 'ENOENT') {
      assert.equal(executed.status, 0, executed.stderr);
      assert.equal(executed.stdout.trim(), 'found:Ada');
    }
  });

  it('preserves dynamic Agent handoffs and runtime-resolved instructions in both exports', async () => {
    const tsCode = exportTypeScript('Handoff export', handoffGraph());
    const transpiled = ts.transpileModule(tsCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const exports: Record<string, any> = {};
    const tsCalls: any[] = [];
    const require = (id: string) => id === 'zod' ? nodeRequire('zod') : ({
      Agent: class Agent { config: any; constructor(config: any) { this.config = config; } },
      tool: (config: any) => config,
      run: async (agent: any) => {
        tsCalls.push({ name: agent.config.name, instructions: agent.config.instructions });
        if (agent.config.name === 'Triage') {
          const handoff = agent.config.tools.find((tool: any) => tool.name === 'transfer_specialist');
          assert.ok(handoff);
          await handoff.execute({ reason: 'billing' });
          return { finalOutput: 'must be ignored' };
        }
        return { finalOutput: 'specialist result' };
      },
    });
    new Function('exports', 'require', transpiled.outputText)(exports, require);
    assert.equal(await exports.runWorkflow('invoice'), 'specialist result');
    assert.deepEqual(tsCalls, [
      { name: 'Triage', instructions: 'Triage invoice' },
      { name: 'Specialist', instructions: 'Handle billing' },
    ]);

    const pyCode = exportPython('Handoff export', handoffGraph());
    const executed = spawnSync('python', ['-c', [
      'import sys, types, asyncio, json',
      'module = types.ModuleType("agents")',
      'class Stub:\n def __init__(self, *args, **kwargs): self.__dict__.update(kwargs)',
      'class Runner:\n @staticmethod\n async def run(agent, prompt, **kwargs):\n  calls.append({"name":agent.name,"instructions":agent.instructions})\n  if agent.name == "Triage":\n   tool = next(t for t in agent.tools if t.name == "transfer_specialist")\n   await tool.on_invoke_tool(None, json.dumps({"reason":"billing"}))\n   return types.SimpleNamespace(final_output="must be ignored")\n  return types.SimpleNamespace(final_output="specialist result")',
      'module.Agent = module.FunctionTool = module.ModelSettings = Stub',
      'module.Runner = Runner',
      'sys.modules["agents"] = module',
      'calls = []',
      'ns = {"__name__": "generated"}',
      'exec(compile(sys.stdin.read(), "<generated>", "exec"), ns)',
      'result = asyncio.run(ns["run_workflow"]("invoice"))',
      'print(json.dumps({"result":result,"calls":calls}))',
    ].join('\n')], { input: pyCode, encoding: 'utf8' });
    if (!executed.error || (executed.error as NodeJS.ErrnoException).code !== 'ENOENT') {
      assert.equal(executed.status, 0, executed.stderr);
      assert.deepEqual(JSON.parse(executed.stdout.trim()), {
        result: 'specialist result',
        calls: [
          { name: 'Triage', instructions: 'Triage invoice' },
          { name: 'Specialist', instructions: 'Handle billing' },
        ],
      });
    }
  });

  it('executes pinned subflows through explicit TypeScript and Python hooks', async () => {
    const graph = subflowGraph();
    const tsCode = exportTypeScript('Subflow export', graph);
    const transpiled = ts.transpileModule(tsCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const exports: Record<string, any> = {};
    const require = (id: string) => id === 'zod' ? nodeRequire('zod') : ({
      Agent: class Agent { constructor(_config: unknown) {} },
      tool: (config: unknown) => config,
      run: async () => ({ finalOutput: null }),
    });
    new Function('exports', 'require', transpiled.outputText)(exports, require);
    await assert.rejects(() => exports.runWorkflow('hello'), /requires hooks\.subflow/);
    const calls: any[] = [];
    const output = await exports.runWorkflow('hello', { mode: 'fast' }, { subflow: async (request: any) => {
      calls.push(request);
      return { id: 'run_child', status: 'completed', output: `child:${request.input.input_as_text}`, state: { count: 9 } };
    } });
    assert.equal(output, 'child:hello');
    assert.deepEqual(calls, [{
      nodeId: 'call', workflowId: 'wf_child', version: 3, maxDepth: 6,
      input: { input_as_text: 'hello', variables: { mode: 'fast' }, state_variables: { count: 2 } },
    }]);
    await assert.rejects(() => exports.runWorkflow('hello', {}, { subflow: async () => ({ id: 'run_bad', status: 'failed', error: 'child boom' }) }), /child failed \(failed\): child boom/);

    const pyCode = exportPython('Subflow export', graph);
    const executed = spawnSync('python', ['-c', [
      'import sys, types, asyncio, json',
      'module = types.ModuleType("agents")',
      'class Stub:\n def __init__(self, *args, **kwargs): self.__dict__.update(kwargs)',
      'module.Agent = module.FunctionTool = module.ModelSettings = Stub',
      'module.Runner = type("Runner", (), {})',
      'sys.modules["agents"] = module',
      'ns = {"__name__": "generated"}',
      'exec(compile(sys.stdin.read(), "<generated>", "exec"), ns)',
      'calls = []',
      'async def hook(request):\n calls.append(request)\n return {"id":"run_child","status":"completed","output":"child:" + request["input"]["input_as_text"],"state":{"count":9}}',
      'result = asyncio.run(ns["run_workflow"]("hello", {"mode":"fast"}, {"subflow": hook}))',
      'print(json.dumps({"result": result, "request": calls[0]}, sort_keys=True))',
    ].join('\n')], { input: pyCode, encoding: 'utf8' });
    if (!executed.error || (executed.error as NodeJS.ErrnoException).code !== 'ENOENT') {
      assert.equal(executed.status, 0, executed.stderr);
      const result = JSON.parse(executed.stdout.trim());
      assert.equal(result.result, 'child:hello');
      assert.deepEqual(result.request, calls[0]);
    }

    const tsBundle = exportTypeScriptSdkPackage('Subflow export', graph);
    const pyBundle = exportPythonSdkPackage('Subflow export', graph);
    const dependency = { nodeId: 'call', workflowId: 'wf_child', version: 3 };
    assert.deepEqual(tsBundle.manifest.subflows, [dependency]);
    assert.deepEqual(pyBundle.manifest.subflows, [dependency]);
    assert.match(tsBundle.manifest.compatibility.warnings.join(' '), /subflow hook/i);
    assert.match(tsBundle.files['README.md'], /subflow.*hook/i);
  });

  it('packages SDK-native TypeScript and Python entrypoints with valid manifests', () => {
    const tsBundle = exportTypeScriptSdkPackage('SDK export', exportGraph());
    assert.equal(tsBundle.mode, 'agents-sdk');
    assert.equal(tsBundle.language, 'typescript');
    assert.equal(tsBundle.entrypoint, 'src/index.ts');
    assert.equal(tsBundle.installCommand, 'npm install');
    assert.match(tsBundle.runCommand, /npm start/);
    assert.deepEqual(tsBundle.dependencies.find((dependency) => dependency.name === '@openai/agents'), {
      name: '@openai/agents', version: 'latest', kind: 'runtime',
    });
    const manifest = JSON.parse(tsBundle.files['package.json']);
    assert.equal(manifest.dependencies['@openai/agents'], 'latest');
    assert.equal(manifest.dependencies['@openai/agents-core'], 'latest');
    assert.equal(manifest.dependencies.zod, 'latest');
    assert.match(tsBundle.files['README.md'], /OPENAI_API_KEY/);
    assert.deepEqual(tsBundle.manifest.requiredHooks, ['approve', 'guardrail', 'fileSearch', 'mcp']);
    assert.match(tsBundle.files['README.md'], /Required runtime hooks/);
    for (const [filename, source] of Object.entries(tsBundle.files).filter(([filename]) => filename.endsWith('.ts'))) {
      const transpiled = ts.transpileModule(source, {
        fileName: filename,
        reportDiagnostics: true,
        compilerOptions: { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022 },
      });
      assert.deepEqual(transpiled.diagnostics ?? [], [], filename);
    }
    const temp = fs.mkdtempSync(path.join(process.cwd(), '.willow-sdk-export-'));
    try {
      for (const [filename, source] of Object.entries(tsBundle.files).filter(([filename]) => filename.endsWith('.ts'))) {
        const target = path.join(temp, filename);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, source);
      }
      fs.writeFileSync(path.join(temp, 'package.json'), tsBundle.files['package.json']);
      const program = ts.createProgram([
        path.join(temp, 'src/workflow.ts'), path.join(temp, 'src/index.ts'),
      ], { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true });
      const errors = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
      assert.deepEqual(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }

    const pyBundle = exportPythonSdkPackage('SDK export', exportGraph());
    assert.equal(pyBundle.mode, 'agents-sdk');
    assert.equal(pyBundle.language, 'python');
    assert.equal(pyBundle.entrypoint, 'main.py');
    assert.equal(pyBundle.installCommand, 'python -m pip install .');
    assert.match(pyBundle.runCommand, /python main\.py/);
    assert.deepEqual(pyBundle.dependencies, [
      { name: 'openai-agents', version: 'latest', kind: 'runtime' },
    ]);
    assert.match(pyBundle.files['pyproject.toml'], /openai-agents/);
    assert.match(pyBundle.files['README.md'], /OPENAI_API_KEY/);
    assert.deepEqual(pyBundle.manifest.requiredHooks, ['approve', 'guardrail', 'fileSearch', 'mcp']);
    assert.match(pyBundle.files['README.md'], /file_search/);
    const compiled = spawnSync('python', ['-c', [
      'import ast, sys',
      'for name in ("workflow.py", "main.py"):',
      ' source = sys.stdin.readline().rstrip("\\n")',
      ' ast.parse(bytes.fromhex(source).decode("utf-8"), filename=name)',
    ].join('\n')], {
      input: [pyBundle.files['workflow.py'], pyBundle.files['main.py']].map((source) => Buffer.from(source).toString('hex')).join('\n') + '\n',
      encoding: 'utf8',
    });
    if (!compiled.error || (compiled.error as NodeJS.ErrnoException).code !== 'ENOENT') assert.equal(compiled.status, 0, compiled.stderr);

    const imported = spawnSync('python', ['-c', [
      'import sys, types',
      'agents = types.ModuleType("agents")',
      'class Stub:\n def __init__(self, *args, **kwargs): self.__dict__.update(kwargs)',
      'class Runner:\n @staticmethod\n async def run(agent, prompt, **kwargs): return types.SimpleNamespace(final_output="ok")',
      'agents.Agent = agents.FunctionTool = agents.ModelSettings = Stub',
      'agents.Runner = Runner',
      'sys.modules["agents"] = agents',
      'workflow = types.ModuleType("workflow")',
      'exec(compile(bytes.fromhex(sys.stdin.readline().strip()).decode(), "workflow.py", "exec"), workflow.__dict__)',
      'sys.modules["workflow"] = workflow',
      'scope = {"__name__": "sdk_bundle_import"}',
      'exec(compile(bytes.fromhex(sys.stdin.readline().strip()).decode(), "main.py", "exec"), scope)',
    ].join('\n')], {
      input: [pyBundle.files['workflow.py'], pyBundle.files['main.py']].map((source) => Buffer.from(source).toString('hex')).join('\n') + '\n',
      encoding: 'utf8',
    });
    if (!imported.error || (imported.error as NodeJS.ErrnoException).code !== 'ENOENT') assert.equal(imported.status, 0, imported.stderr);
  });

  it('fails closed when an exported workflow is missing a required runtime hook', async () => {
    const graph = normalizeGraph({
      nodes: [
        { id: 'start', type: 'start', config: {} },
        { id: 'guard', type: 'guardrail', name: 'Safety check', config: { input: '{{workflow.input_as_text}}', onTripwire: 'stop' } },
        { id: 'end', type: 'end', config: { output: '{{workflow.input_as_text}}' } },
      ],
      edges: [
        { id: 'start-guard', source: 'start', target: 'guard' },
        { id: 'guard-end', source: 'guard', target: 'end', sourceHandle: 'pass' },
      ],
    }).graph;

    const transpiled = ts.transpileModule(exportTypeScript('Required hook', graph), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    const tsExports: Record<string, any> = {};
    const require = (moduleName: string) => {
      if (moduleName === '@openai/agents') return { Agent: class Agent {}, tool: (config: unknown) => config, run: async () => ({ finalOutput: null }) };
      if (moduleName === 'zod') return { z: {} };
      throw new Error(`Unexpected generated import ${moduleName}`);
    };
    new Function('exports', 'require', transpiled.outputText)(tsExports, require);
    await assert.rejects(() => tsExports.runWorkflow('hello'), /Safety check.*requires hooks\.guardrail/);
    assert.equal(await tsExports.runWorkflow('hello', {}, { guardrail: async () => true }), 'hello');

    const pyCode = exportPython('Required hook', graph);
    const executed = spawnSync('python', ['-c', [
      'import sys, types, asyncio',
      'agents = types.ModuleType("agents")',
      'class Stub:\n def __init__(self, *args, **kwargs): self.__dict__.update(kwargs)',
      'agents.Agent = agents.FunctionTool = agents.ModelSettings = Stub',
      'agents.Runner = type("Runner", (), {})',
      'sys.modules["agents"] = agents',
      'scope = {"__name__": "generated"}',
      'exec(compile(sys.stdin.read(), "<generated>", "exec"), scope)',
      'try: asyncio.run(scope["run_workflow"]("hello"))',
      'except RuntimeError as error: print(str(error))',
      'else: raise AssertionError("missing guardrail hook did not fail")',
    ].join('\n')], { input: pyCode, encoding: 'utf8' });
    if (!executed.error || (executed.error as NodeJS.ErrnoException).code !== 'ENOENT') {
      assert.equal(executed.status, 0, executed.stderr);
      assert.match(executed.stdout, /Safety check.*requires hooks\['guardrail'\]/);
    }
  });
});
