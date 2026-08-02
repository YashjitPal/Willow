import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import type { Run } from '../src/domain/types.ts';
import { makeApp, type App, waitForRun } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;

before(async () => ({ app, cleanup } = await makeApp()));
after(async () => cleanup());

it('does not let session cancellation race past an admitted ChatKit turn', async () => {
  const workflow = await app.workflows.create({ name: 'Chat cancellation boundary' });
  await app.workflows.saveDraft(workflow.workflow.id, {
    nodes: [
      { id: 'start', type: 'start', data: {} },
      { id: 'approval', type: 'userApproval', config: { message: 'Keep this turn pending?' } },
      { id: 'end', type: 'end', config: { output: 'done' } },
    ],
    edges: [
      { id: 'start-approval', source: 'start', target: 'approval' },
      { id: 'approval-end', source: 'approval', target: 'end', sourceHandle: 'approved' },
      { id: 'approval-rejected', source: 'approval', target: 'end', sourceHandle: 'rejected' },
    ],
  }, workflow.workflow.draftRevision);
  const session = await app.chat.createSession({ workflowId: workflow.workflow.id, version: 0, user: 'lifecycle-user' });
  const thread = await app.chat.createThread(session.id, session.clientSecret);

  const originalCreateRun = app.engine.createRun.bind(app.engine);
  let releaseCreateRun!: () => void;
  const createRunEntered = new Promise<void>((resolve) => {
    (app.engine as unknown as { createRun: typeof app.engine.createRun }).createRun = async (...args): Promise<Run> => {
      resolve();
      await new Promise<void>((release) => { releaseCreateRun = release; });
      return originalCreateRun(...args);
    };
  });

  try {
    const sending = app.chat.sendMessage(thread.id, 'cancel this turn', undefined, session.clientSecret);
    await createRunEntered;
    const cancelling = app.chat.cancelSession(session.id, session.clientSecret);

    let cancellationSettled = false;
    void cancelling.then(() => { cancellationSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(cancellationSettled, false, 'cancellation must wait for an in-flight turn admission');

    releaseCreateRun();
    const sent = await sending;
    const cancelled = await cancelling;
    assert.equal(cancelled?.status, 'cancelled');
    const run = await waitForRun(app, sent.run.id, ['cancelled', 'completed', 'failed']);
    assert.equal(run.status, 'cancelled');
    await assert.rejects(
      () => app.chat.sendMessage(thread.id, 'must not start', undefined, session.clientSecret),
      /session is cancelled/,
    );
  } finally {
    (app.engine as unknown as { createRun: typeof app.engine.createRun }).createRun = originalCreateRun;
  }
});

it('keeps credential-paused turns exclusive and cancels them with the session', async () => {
  const workflow = await app.workflows.create({ name: 'Chat credential pause' });
  await app.workflows.saveDraft(workflow.workflow.id, {
    nodes: [
      { id: 'start', type: 'start', data: {} },
      { id: 'agent', type: 'agent', config: { model: 'gpt-4o-mini', instructions: 'Reply briefly.' } },
      { id: 'end', type: 'end', config: { output: '{{agent.output}}' } },
    ],
    edges: [
      { id: 'start-agent', source: 'start', target: 'agent' },
      { id: 'agent-end', source: 'agent', target: 'end' },
    ],
  }, workflow.workflow.draftRevision);
  const session = await app.chat.createSession({ workflowId: workflow.workflow.id, version: 0, user: 'credential-user' });
  const thread = await app.chat.createThread(session.id, session.clientSecret);
  const sent = await app.chat.sendMessage(thread.id, 'wait for credentials', undefined, session.clientSecret);
  const paused = await waitForRun(app, sent.run.id, ['awaiting_credentials', 'failed']);
  assert.equal(paused.status, 'awaiting_credentials');

  await assert.rejects(
    () => app.chat.sendMessage(thread.id, 'must wait', undefined, session.clientSecret),
    /previous turn is still in progress.*awaiting_credentials/,
  );

  const cancelled = await app.chat.cancelSession(session.id, session.clientSecret);
  assert.equal(cancelled?.status, 'cancelled');
  const run = await waitForRun(app, sent.run.id, ['cancelled', 'completed', 'failed']);
  assert.equal(run.status, 'cancelled');
});
