/**
 * Demo: seeds example workflows into the backend's data directory and runs
 * one end-to-end (keyless, using the mock provider) printing the live event
 * stream. Safe to run repeatedly.
 *
 *   node scripts/demo.ts
 */

import { createApp } from '../src/index.ts';

const app = await createApp();

// ---------------------------------------------------------------------------
// 1. Support triage: guardrails -> classifier (structured output) -> routing
// ---------------------------------------------------------------------------
const triage = await app.workflows.create({
  name: 'Support triage',
  description: 'Guardrails, a JSON classifier and category routing',
  graph: {
    nodes: [
      { id: 'start', type: 'start', config: { inputVariables: [{ name: 'input_as_text', type: 'string' }], stateVariables: [] } },
      {
        id: 'guard',
        type: 'guardrail',
        name: 'Input guardrails',
        config: { pii: true, moderation: false, jailbreak: true, hallucination: false, continueOnError: true },
      },
      {
        id: 'classify',
        type: 'agent',
        name: 'Classifier',
        config: {
          instructions:
            'Classify the user request into one of: billing, technical, other. Respond as JSON.',
          model: 'gemini-3-flash',
          includeChatHistory: false,
          writeToConversationHistory: false,
          tools: [],
          outputFormat: 'json',
          outputSchema: {
            type: 'object',
            properties: { category: { type: 'string', enum: ['billing', 'technical', 'other'] } },
            required: ['category'],
          },
          continueOnError: false,
        },
      },
      {
        id: 'route',
        type: 'ifElse',
        name: 'Route',
        config: {
          branches: [
            { id: 'billing', label: 'Billing', condition: 'classifier.output_parsed.category == "billing"' },
            { id: 'technical', label: 'Technical', condition: 'classifier.output_parsed.category == "technical"' },
          ],
        },
      },
      {
        id: 'billing_agent',
        type: 'agent',
        name: 'Billing agent',
        config: {
          instructions: 'You are a billing support specialist. Help with: {{workflow.input_as_text}}',
          model: 'gemini-3-flash',
          includeChatHistory: true,
          writeToConversationHistory: true,
          tools: [],
          outputFormat: 'text',
          continueOnError: false,
        },
      },
      {
        id: 'tech_agent',
        type: 'agent',
        name: 'Technical agent',
        config: {
          instructions: 'You are a technical support engineer. Help with: {{workflow.input_as_text}}',
          model: 'gemini-3-flash',
          includeChatHistory: true,
          writeToConversationHistory: true,
          tools: [{ kind: 'web_search' }],
          outputFormat: 'text',
          continueOnError: false,
        },
      },
      {
        id: 'general_agent',
        type: 'agent',
        name: 'General agent',
        config: {
          instructions: 'You are a friendly generalist support agent.',
          model: 'gemini-3-flash',
          includeChatHistory: true,
          writeToConversationHistory: true,
          tools: [],
          outputFormat: 'text',
          continueOnError: false,
        },
      },
      { id: 'blocked', type: 'end', name: 'Blocked', config: { output: 'Your message was blocked by input guardrails: {{input_guardrails.triggered}}' } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'guard' },
      { id: 'e2', source: 'guard', target: 'classify', sourceHandle: 'pass' },
      { id: 'e3', source: 'guard', target: 'blocked', sourceHandle: 'fail' },
      { id: 'e4', source: 'classify', target: 'route' },
      { id: 'e5', source: 'route', target: 'billing_agent', sourceHandle: 'billing' },
      { id: 'e6', source: 'route', target: 'tech_agent', sourceHandle: 'technical' },
      { id: 'e7', source: 'route', target: 'general_agent', sourceHandle: 'else' },
    ],
  },
});
console.log(`seeded: ${triage.workflow.name} (${triage.workflow.id}) — valid: ${triage.validation.valid}`);

// ---------------------------------------------------------------------------
// 2. Research with approval: agent -> user approval -> agent
// ---------------------------------------------------------------------------
const research = await app.workflows.create({
  name: 'Research with approval',
  description: 'Draft, wait for human approval, then finalize',
  graph: {
    nodes: [
      { id: 'start', type: 'start', config: { inputVariables: [{ name: 'input_as_text', type: 'string' }], stateVariables: [] } },
      {
        id: 'draft',
        type: 'agent',
        name: 'Drafter',
        config: {
          instructions: 'Draft a short answer to the question. Be concise.',
          model: 'gemini-3-flash',
          includeChatHistory: true,
          writeToConversationHistory: true,
          tools: [{ kind: 'web_search' }],
          outputFormat: 'text',
          continueOnError: false,
        },
      },
      {
        id: 'approve',
        type: 'userApproval',
        name: 'Review draft',
        config: { message: 'Send this draft?\n\n{{drafter.output_text}}' },
      },
      {
        id: 'finalize',
        type: 'agent',
        name: 'Finalizer',
        config: {
          instructions: 'Polish this draft into a final answer: {{drafter.output_text}}',
          model: 'gemini-3-flash',
          includeChatHistory: false,
          writeToConversationHistory: true,
          tools: [],
          outputFormat: 'text',
          continueOnError: false,
        },
      },
      { id: 'rejected', type: 'end', name: 'Rejected', config: { output: 'Draft rejected by reviewer.' } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'draft' },
      { id: 'e2', source: 'draft', target: 'approve' },
      { id: 'e3', source: 'approve', target: 'finalize', sourceHandle: 'approved' },
      { id: 'e4', source: 'approve', target: 'rejected', sourceHandle: 'rejected' },
    ],
  },
});
console.log(`seeded: ${research.workflow.name} (${research.workflow.id}) — valid: ${research.validation.valid}`);

// ---------------------------------------------------------------------------
// 3. Haiku loop (while + transform + set state) — runs keyless on mocks
// ---------------------------------------------------------------------------
const loop = await app.workflows.create({
  name: 'Haiku loop (demo)',
  description: 'While + Transform + Set state over a topic list — runs without API keys',
  graph: {
    nodes: [
      {
        id: 'start',
        type: 'start',
        config: {
          inputVariables: [{ name: 'input_as_text', type: 'string' }],
          stateVariables: [
            { name: 'topics', type: 'list', initialValue: ['sunsets', 'rivers', 'code'] },
            { name: 'i', type: 'number', initialValue: 0 },
            { name: 'poems', type: 'list', initialValue: [] },
          ],
        },
      },
      { id: 'loop', type: 'while', name: 'For each topic', config: { condition: 'state.i < size(state.topics)', maxIterations: 20 } },
      {
        id: 'pick',
        type: 'transform',
        name: 'Pick topic',
        config: { outputs: [{ name: 'topic', type: 'string', expression: 'state.topics[state.i]' }] },
      },
      {
        id: 'poet',
        type: 'agent',
        name: 'Poet',
        config: {
          instructions: 'Write one haiku about the topic. Return just the haiku.',
          model: 'mock/upper',
          includeChatHistory: false,
          writeToConversationHistory: false,
          tools: [],
          outputFormat: 'text',
          continueOnError: false,
          userMessage: 'haiku about {{pick_topic.topic}}',
        },
      },
      {
        id: 'store',
        type: 'setState',
        name: 'Store poem',
        config: {
          assignments: [
            { name: 'poems', expression: 'state.poems + [poet.output_text]' },
            { name: 'i', expression: 'state.i + 1' },
          ],
        },
      },
      { id: 'end', type: 'end', name: 'Done', config: { output: '$cel: state.poems' } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'loop' },
      { id: 'e2', source: 'loop', target: 'pick', sourceHandle: 'loop' },
      { id: 'e3', source: 'pick', target: 'poet' },
      { id: 'e4', source: 'poet', target: 'store' },
      { id: 'e5', source: 'store', target: 'loop' },
      { id: 'e6', source: 'loop', target: 'end', sourceHandle: 'done' },
    ],
  },
});
console.log(`seeded: ${loop.workflow.name} (${loop.workflow.id}) — valid: ${loop.validation.valid}`);

// publish the demo loop and run it live
await app.workflows.publish(loop.workflow.id, 'demo seed');

console.log('\nrunning "Haiku loop (demo)" (mock provider, no keys needed)…\n');
const run = await app.engine.createRun({
  workflowId: loop.workflow.id,
  version: -1,
  input: { input_as_text: 'go' },
});
const unsubscribe = app.engine.subscribe(run.id, (event) => {
  if (event.type === 'llm.delta') return;
  const extra =
    event.type === 'node.started' ? ` ${ (event as { name?: string }).name ?? '' }`
    : event.type === 'state.updated' ? ` ${JSON.stringify((event as { state?: unknown }).state)}`
    : event.type === 'run.completed' ? ` output=${JSON.stringify((event as { output?: unknown }).output)}`
    : '';
  console.log(`  [${event.type}]${extra}`);
});

await new Promise<void>((resolve) => {
  const timer = setInterval(async () => {
    const r = await app.engine.getRun(run.id);
    if (r && ['completed', 'failed', 'cancelled'].includes(r.status)) {
      clearInterval(timer);
      resolve();
    }
  }, 50);
});
unsubscribe();

const final = await app.engine.getRun(run.id);
console.log(`\nrun ${final?.status}: ${JSON.stringify(final?.output)}`);
console.log(`usage: ${JSON.stringify(final?.usage)}`);
console.log('\nSeeded 3 workflows. Start the server with `npm start` and open the API at /api/v1/workflows');
await app.close();
process.exit(0);
