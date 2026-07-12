/**
 * Frontend-integration smoke test: exercises the AgentBuilderClient exactly
 * as the useAgentBuilderBackend hook does — React Flow graph in, canonical
 * out, run + stream, export — against a live backend.
 */

import { AgentBuilderClient } from '../client/index.ts';

const base = process.env.SMOKE_BASE || 'http://127.0.0.1:8787';
const ab = new AgentBuilderClient({ baseUrl: base });

// Same shape the canvas sends (data.label / data.instructions / data.model / data.config).
const reactFlowGraph = {
  nodes: [
    { id: '1', type: 'start', position: { x: 50, y: 125 }, data: { label: 'Start' } },
    { id: '2', type: 'agent', position: { x: 300, y: 125 }, data: { label: 'Greeter', instructions: 'Say hi to {{workflow.input_as_text}}', model: 'mock/upper', outputFormat: 'text' } },
    { id: '3', type: 'end', position: { x: 560, y: 125 }, data: { label: 'End', config: { output: '{{greeter.output_text}}' } } },
  ],
  edges: [
    { id: 'e1', source: '1', target: '2' },
    { id: 'e2', source: '2', target: '3' },
  ],
};

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

const health = await ab.health();
assert(health.ok, 'health');
console.log('health ok, version', health.version);

const { workflow, validation } = await ab.createWorkflow({ name: 'Smoke workflow', graph: reactFlowGraph });
assert(validation.valid, 'created workflow valid: ' + JSON.stringify(validation.errors));
console.log('created', workflow.id);

// Autosave (the hook debounces this; here direct).
const saved = await ab.saveDraft(workflow.id, reactFlowGraph);
assert(saved.validation.valid, 'saved valid');

// Load back + verify the canonical mapping preserves what the panels need.
const { workflow: loaded } = await ab.getWorkflow(workflow.id);
const agent = loaded.draft.nodes.find((n: any) => n.id === '2') as any;
assert(agent.name === 'Greeter', 'agent name preserved');
assert(agent.config.instructions.includes('Say hi'), 'instructions preserved');
assert(agent.config.model === 'mock/upper', 'model preserved: ' + agent.config.model);
console.log('round-trip preserved name/instructions/model');

// Preview run (draft version 0) + stream.
const { run } = await ab.startRun(workflow.id, { input_as_text: 'willow' }, 0);
console.log('run', run.id, 'started');

let completed = false;
let output: unknown;
const events: string[] = [];
await new Promise<void>((resolve) => {
  const stop = ab.streamRunEvents(run.id, (ev) => {
    events.push(ev.type);
    if (ev.type === 'run.completed') { completed = true; output = (ev as any).output; stop(); resolve(); }
    if (ev.type === 'run.failed') { stop(); resolve(); }
  }, { onDone: () => resolve() });
});
assert(completed, 'run completed; events=' + events.join(','));
assert(output === 'WILLOW', 'output WILLOW, got ' + JSON.stringify(output));
console.log('run streamed to completion, output =', JSON.stringify(output));
console.log('  events:', [...new Set(events)].join(', '));

// Publish + export.
const pub = await ab.publishWorkflow(workflow.id);
assert(pub.version.version === 1, 'published v1');
const { code } = await ab.exportCode(workflow.id, 'typescript');
assert(code.includes('new Agent('), 'TS export has Agent');
console.log('published v1, exported', code.length, 'chars of TypeScript');

// Sidebar list.
const { workflows } = await ab.listWorkflows();
assert(workflows.some((w) => w.id === workflow.id), 'workflow in list');
console.log('workflow appears in list (' + workflows.length + ' total)');

console.log('\n✅ FRONTEND INTEGRATION SMOKE TEST PASSED');
process.exit(0);
