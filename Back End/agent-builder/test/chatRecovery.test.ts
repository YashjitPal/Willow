import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import type { ChatThread } from '../src/domain/types.ts';
import { COLLECTIONS } from '../src/storage/index.ts';
import { makeApp, type App, waitForRun } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;

before(async () => ({ app, cleanup } = await makeApp()));
after(async () => cleanup());

it('recovers lost ChatKit turn finalizers exactly once', async () => {
  const workflow = await app.workflows.create({ name: 'Chat recovery' });
  const session = await app.chat.createSession({ workflowId: workflow.workflow.id, version: 0, user: 'test' });
  const thread = await app.chat.createThread(session.id, session.clientSecret);
  const sent = await app.chat.sendMessage(thread.id, 'recover me', undefined, session.clientSecret);
  await waitForRun(app, sent.run.id, ['completed', 'failed']);

  let finalized: ChatThread | undefined;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    finalized = await app.chat.getThread(thread.id);
    if (finalized?.messages.some((message) => message.role === 'assistant' && message.runId === sent.run.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(finalized);
  finalized.messages = finalized.messages.filter((message) => !(message.role === 'assistant' && message.runId === sent.run.id));
  await app.storage.put(COLLECTIONS.threads, finalized.id, finalized, finalized.sessionId);

  assert.equal(await app.chat.recoverPendingTurns(), 1);
  assert.equal(await app.chat.recoverPendingTurns(), 0);
  const recovered = await app.chat.getThread(thread.id);
  assert.equal(recovered?.messages.filter((message) => message.role === 'assistant' && message.runId === sent.run.id).length, 1);
});
