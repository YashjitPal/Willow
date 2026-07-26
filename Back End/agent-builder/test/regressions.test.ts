import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeApp, waitForRun, type App } from './helpers.ts';
import { renderTemplate } from '../src/engine/template.ts';
import { evaluateCel, CelSyntaxError } from '../src/engine/cel/index.ts';

let app: App;
let cleanup: () => Promise<void>;
before(async () => { ({ app, cleanup } = await makeApp()); });
after(async () => { await cleanup(); });

async function wf(nodes: unknown[], edges: unknown[]): Promise<string> {
  const { workflow } = await app.workflows.create({ name: 't', graph: { nodes, edges } });
  return workflow.id;
}

describe('regression: template }} inside CEL string literals', () => {
  it('does not treat }} inside a quoted literal as the closer', () => {
    assert.equal(renderTemplate('{{"a}}b"}}', {}), 'a}}b');
    assert.equal(renderTemplate("pre {{ 'x' + '}}' }} post", {}), 'pre x}} post');
    assert.equal(renderTemplate('{{ state.n }}', { state: { n: 5 } }), '5');
  });
});

describe('regression: parser depth cap', () => {
  it('throws a clean CelSyntaxError instead of RangeError on deep nesting', () => {
    const expr = '('.repeat(5000) + '1' + ')'.repeat(5000);
    assert.throws(() => evaluateCel(expr, {}), CelSyntaxError);
    // ordinary nesting still parses
    assert.equal(evaluateCel('((1 + 2) * (3 + 4))', {}), 21);
  });
});

describe('regression: agent does not duplicate the current user message', () => {
  it('mock/echo with includeChatHistory sees the input exactly once', async () => {
    // mock/echo returns the LAST user message; if the input were duplicated as
    // two user turns the echo would still be the input, so assert via a second
    // agent that concatenates history length is overkill — instead use a
    // transform-free check: echo returns the single input unchanged.
    const id = await wf(
      [
        { id: 's', type: 'start', data: {} },
        { id: 'a', type: 'agent', config: { instructions: '', model: 'mock/echo', tools: [], outputFormat: 'text', includeChatHistory: true, writeToConversationHistory: true, continueOnError: false } },
      ],
      [{ id: 'e', source: 's', target: 'a' }],
    );
    const run = await app.engine.createRun({ workflowId: id, input: { input_as_text: 'solo' } });
    const done = await waitForRun(app, run.id, ['completed', 'failed']);
    assert.equal(done.output, 'solo');
    // history must contain exactly one user message with the input
    const hist = await app.engine.runHistory(run.id);
    assert.equal(hist.filter((m) => m.role === 'user' && m.content === 'solo').length, 1);
  });

  it('records an explicitly empty attachment-only user turn', async () => {
    const id = await wf(
      [
        { id: 's', type: 'start', data: {} },
        { id: 'e', type: 'end', config: { output: 'received' } },
      ],
      [{ id: 'edge', source: 's', target: 'e' }],
    );
    const run = await app.engine.createRun({
      workflowId: id,
      input: {
        input_as_text: '',
        attachments: [{
          name: 'request.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from('attachment-only request').toString('base64'),
        }],
      },
    });
    await waitForRun(app, run.id, ['completed', 'failed']);

    const history = await app.engine.runHistory(run.id);
    assert.equal(history.filter((message) => message.role === 'user').length, 1);
    assert.equal(history.find((message) => message.role === 'user')?.content, '');
  });
});

describe('regression: double-resolve approval guard', () => {
  it('rejects a second concurrent resolution of the same approval', async () => {
    const id = await wf(
      [
        { id: 's', type: 'start', data: {} },
        { id: 'u', type: 'userApproval', config: { message: 'ok?' } },
        { id: 'y', type: 'end', config: { output: 'YES' } },
        { id: 'n', type: 'end', config: { output: 'NO' } },
      ],
      [
        { id: 'e1', source: 's', target: 'u' },
        { id: 'e2', source: 'u', target: 'y', sourceHandle: 'approved' },
        { id: 'e3', source: 'u', target: 'n', sourceHandle: 'rejected' },
      ],
    );
    const run = await app.engine.createRun({ workflowId: id, input: {} });
    const paused = await waitForRun(app, run.id, ['awaiting_approval']);
    const aid = paused.pendingApproval!.id;
    // fire two resolutions "simultaneously" — exactly one must win
    const results = await Promise.allSettled([
      app.engine.resolveApproval(run.id, aid, { approved: true }),
      app.engine.resolveApproval(run.id, aid, { approved: false }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const err = results.filter((r) => r.status === 'rejected').length;
    assert.equal(ok, 1);
    assert.equal(err, 1);
    const done = await waitForRun(app, run.id, ['completed', 'failed']);
    assert.equal(done.output, 'YES'); // the approve won (fired first)
  });

  it('does not revive a cancelled run when approval resolution is already in flight', async () => {
    const id = await wf(
      [
        { id: 's', type: 'start', data: {} },
        { id: 'u', type: 'userApproval', config: { message: 'ok?' } },
        { id: 'y', type: 'end', config: { output: 'YES' } },
        { id: 'n', type: 'end', config: { output: 'NO' } },
      ],
      [
        { id: 'e1', source: 's', target: 'u' },
        { id: 'e2', source: 'u', target: 'y', sourceHandle: 'approved' },
        { id: 'e3', source: 'u', target: 'n', sourceHandle: 'rejected' },
      ],
    );
    const run = await app.engine.createRun({ workflowId: id, input: {} });
    const paused = await waitForRun(app, run.id, ['awaiting_approval']);

    const engine = app.engine as unknown as {
      missingCredentials: (...args: unknown[]) => Promise<string[]>;
    };
    const originalMissingCredentials = engine.missingCredentials.bind(app.engine);
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    engine.missingCredentials = async () => {
      entered();
      await releasePromise;
      return [];
    };

    try {
      const resolution = app.engine.resolveApproval(run.id, paused.pendingApproval!.id, { approved: true });
      await enteredPromise;
      await app.engine.cancelRun(run.id);
      release();
      await assert.rejects(resolution, /not awaiting approval \(status: cancelled\)/);
    } finally {
      engine.missingCredentials = originalMissingCredentials;
      release();
    }

    const cancelled = await app.engine.getRun(run.id);
    assert.equal(cancelled?.status, 'cancelled');
    assert.equal(cancelled?.pendingApproval, undefined);
    assert.equal((await app.engine.pastEvents(run.id)).some((event) => event.type === 'approval.resolved'), false);
  });
});

describe('approval rejection audit context', () => {
  it('retains a bounded rejection reason in events and trace spans', async () => {
    const id = await wf(
      [
        { id: 's', type: 'start', data: {} },
        { id: 'u', type: 'userApproval', config: { message: 'Ship this change?' } },
        { id: 'y', type: 'end', config: { output: 'YES' } },
        { id: 'n', type: 'end', config: { output: 'NO' } },
      ],
      [
        { id: 'e1', source: 's', target: 'u' },
        { id: 'e2', source: 'u', target: 'y', sourceHandle: 'approved' },
        { id: 'e3', source: 'u', target: 'n', sourceHandle: 'rejected' },
      ],
    );
    const run = await app.engine.createRun({ workflowId: id, input: {} });
    const paused = await waitForRun(app, run.id, ['awaiting_approval']);
    await app.engine.resolveApproval(run.id, paused.pendingApproval!.id, { approved: false, reason: 'Missing security review' });
    const done = await waitForRun(app, run.id, ['completed', 'failed']);
    assert.equal(done.output, 'NO');
    const event = (await app.engine.pastEvents(run.id)).find((item) => item.type === 'approval.resolved');
    assert.equal(event?.type === 'approval.resolved' ? event.reason : undefined, 'Missing security review');
    const trace = await app.engine.traceSpans(run.id);
    const approval = trace?.find((span) => span.type === 'approval');
    assert.equal(approval?.data?.reason, 'Missing security review');
  });

  it('rejects oversized reasons without consuming the pending approval', async () => {
    const id = await wf(
      [{ id: 's', type: 'start', data: {} }, { id: 'u', type: 'userApproval', config: { message: 'Continue?' } }, { id: 'n', type: 'end', config: { output: 'NO' } }],
      [{ id: 'e1', source: 's', target: 'u' }, { id: 'e2', source: 'u', target: 'n', sourceHandle: 'rejected' }, { id: 'e3', source: 'u', target: 'n', sourceHandle: 'approved' }],
    );
    const run = await app.engine.createRun({ workflowId: id, input: {} });
    const paused = await waitForRun(app, run.id, ['awaiting_approval']);
    await assert.rejects(() => app.engine.resolveApproval(run.id, paused.pendingApproval!.id, { approved: false, reason: 'x'.repeat(2001) }), /2000 characters/);
    assert.equal((await app.engine.getRun(run.id))?.status, 'awaiting_approval');
  });
});

describe('regression: paused run is immune to draft edits', () => {
  it('resumes against the graph snapshot captured at creation', async () => {
    // create a workflow, start a run that pauses, then mutate the draft
    const created = await app.workflows.create({
      name: 'snap',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'u', type: 'userApproval', config: { message: 'ok?' } },
          { id: 'y', type: 'end', config: { output: 'ORIGINAL' } },
          { id: 'n', type: 'end', config: { output: 'NO' } },
        ],
        edges: [
          { id: 'e1', source: 's', target: 'u' },
          { id: 'e2', source: 'u', target: 'y', sourceHandle: 'approved' },
          { id: 'e3', source: 'u', target: 'n', sourceHandle: 'rejected' },
        ],
      },
    });
    const wfId = created.workflow.id;
    const run = await app.engine.createRun({ workflowId: wfId, input: {} });
    const paused = await waitForRun(app, run.id, ['awaiting_approval']);

    // now corrupt the draft: remove the approved-branch target entirely
    await app.workflows.saveDraft(wfId, {
      nodes: [{ id: 's', type: 'start', data: {} }],
      edges: [],
    });

    // resume — must still follow the ORIGINAL graph, not the broken draft
    await app.engine.resolveApproval(run.id, paused.pendingApproval!.id, { approved: true });
    const done = await waitForRun(app, run.id, ['completed', 'failed']);
    assert.equal(done.status, 'completed', done.error);
    assert.equal(done.output, 'ORIGINAL');
  });
});

describe('regression: guardrail PII mask rewrites conversation history', () => {
  it('a downstream agent with chat history never sees the raw PII', async () => {
    const id = await wf(
      [
        { id: 's', type: 'start', data: {} },
        {
          id: 'g',
          type: 'guardrail',
          config: {
            pii: true,
            moderation: false,
            jailbreak: false,
            hallucination: false,
            continueOnError: false,
            settings: { piiMode: 'mask' },
          },
        },
        // echo the running chat history's last user message back
        { id: 'a', type: 'agent', name: 'Echoer', config: { instructions: '', model: 'mock/echo', tools: [], outputFormat: 'text', includeChatHistory: true, writeToConversationHistory: false, continueOnError: false } },
        { id: 'e', type: 'end', config: { output: '{{echoer.output_text}}' } },
      ],
      [
        { id: 'e1', source: 's', target: 'g' },
        { id: 'e2', source: 'g', target: 'a', sourceHandle: 'pass' },
        { id: 'e4', source: 'g', target: 'e', sourceHandle: 'fail' },
        { id: 'e3', source: 'a', target: 'e' },
      ],
    );
    const run = await app.engine.createRun({
      workflowId: id,
      input: { input_as_text: 'reach me at jane@example.com anytime' },
    });
    const done = await waitForRun(app, run.id, ['completed', 'failed']);
    assert.equal(done.status, 'completed', done.error);
    // masked branch passes; the agent echoing history must not surface the raw email
    assert.doesNotMatch(String(done.output), /jane@example\.com/);
    assert.match(String(done.output), /<EMAIL_ADDRESS>/);
  });
});

describe('regression: resume payload does not leak past its node', () => {
  it('an approved decision does not auto-approve a later approval gate', async () => {
    const id = await wf(
      [
        { id: 's', type: 'start', data: {} },
        { id: 'u1', type: 'userApproval', config: { message: 'first?' } },
        { id: 'u2', type: 'userApproval', config: { message: 'second?' } },
        { id: 'yy', type: 'end', config: { output: 'BOTH APPROVED' } },
        { id: 'r1', type: 'end', config: { output: 'FIRST REJECTED' } },
        { id: 'r2', type: 'end', config: { output: 'SECOND REJECTED' } },
      ],
      [
        { id: 'e1', source: 's', target: 'u1' },
        { id: 'e2', source: 'u1', target: 'u2', sourceHandle: 'approved' },
        { id: 'e3', source: 'u1', target: 'r1', sourceHandle: 'rejected' },
        { id: 'e4', source: 'u2', target: 'yy', sourceHandle: 'approved' },
        { id: 'e5', source: 'u2', target: 'r2', sourceHandle: 'rejected' },
      ],
    );
    const run = await app.engine.createRun({ workflowId: id, input: {} });
    const p1 = await waitForRun(app, run.id, ['awaiting_approval']);
    await app.engine.resolveApproval(run.id, p1.pendingApproval!.id, { approved: true });
    // must pause AGAIN at the second gate, not auto-continue on the stale decision
    const p2 = await waitForRun(app, run.id, ['awaiting_approval']);
    assert.notEqual(p2.pendingApproval!.id, p1.pendingApproval!.id);
    await app.engine.resolveApproval(run.id, p2.pendingApproval!.id, { approved: false });
    const done = await waitForRun(app, run.id, ['completed', 'failed']);
    assert.equal(done.output, 'SECOND REJECTED');
  });
});
