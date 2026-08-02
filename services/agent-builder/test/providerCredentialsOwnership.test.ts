import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { providerKeysStorageId } from '../src/services/providerCredentials.ts';
import { COLLECTIONS } from '../src/storage/index.ts';
import { listen, makeApp, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let closeServer: () => Promise<void>;
let baseUrl = '';

async function request(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
}

before(async () => {
  ({ app, cleanup } = await makeApp());
  ({ baseUrl, close: closeServer } = await listen(app));
});

after(async () => {
  await closeServer();
  await cleanup();
});

describe('workspace provider credentials', () => {
  it('isolates stored keys while preserving the default workspace legacy record', async () => {
    const bootstrap = await request('POST', '/api/v1/admin/api-keys', { name: 'Credential bootstrap', role: 'admin' });
    assert.equal(bootstrap.status, 200);
    const rootToken = bootstrap.data.token as string;
    const createWorkspaceAdmin = async (name: string, subjectId: string, workspaceId: string) => {
      const created = await request('POST', '/api/v1/admin/api-keys', { name, role: 'admin', subjectId, workspaceId }, rootToken);
      assert.equal(created.status, 200);
      return created.data.token as string;
    };
    const alpha = await createWorkspaceAdmin('Alpha credentials', 'alpha-admin', 'alpha');
    const alphaPeer = await createWorkspaceAdmin('Alpha peer', 'alpha-peer', 'alpha');
    const beta = await createWorkspaceAdmin('Beta credentials', 'beta-admin', 'beta');

    const alphaSecret = 'sk-alpha-workspace-secret';
    assert.equal((await request('PUT', '/api/v1/settings/keys', { openai: [alphaSecret] }, alpha)).status, 200);

    const alphaView = await request('GET', '/api/v1/settings/keys', undefined, alpha);
    const alphaPeerView = await request('GET', '/api/v1/settings/keys', undefined, alphaPeer);
    const betaView = await request('GET', '/api/v1/settings/keys', undefined, beta);
    assert.equal(alphaView.status, 200);
    assert.deepEqual(alphaPeerView.data.keys, alphaView.data.keys);
    assert.deepEqual(betaView.data.keys, {});
    assert.doesNotMatch(JSON.stringify(alphaView.data), new RegExp(alphaSecret));
    assert.deepEqual(
      await app.storage.get(COLLECTIONS.settings, providerKeysStorageId('alpha')),
      { openai: [alphaSecret] },
    );
    assert.equal(await app.storage.get(COLLECTIONS.settings, providerKeysStorageId('beta')), undefined);

    const betaWorkflow = await request('POST', '/api/v1/workflows', {
      name: 'Beta remote model',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', name: 'Remote', config: { instructions: '', model: 'gpt-4.1-mini', tools: [], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false, continueOnError: false } },
          { id: 'e', type: 'end', data: {} },
        ],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
      },
    }, beta);
    assert.equal(betaWorkflow.status, 200);
    const platformOpenAiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const betaRun = await request('POST', `/api/v1/workflows/${betaWorkflow.data.workflow.id}/runs`, { input: { input_as_text: 'hello' } }, beta)
      .finally(() => {
        if (platformOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = platformOpenAiKey;
      });
    assert.equal(betaRun.status, 200);
    assert.equal(betaRun.data.run.status, 'awaiting_credentials');
    assert.deepEqual(betaRun.data.run.credentialRequirements.providers, ['openai']);

    const legacySecret = 'legacy-default-provider-secret';
    await app.storage.put(COLLECTIONS.settings, 'provider_keys', { openai: [legacySecret], anthropic: [legacySecret] });
    const legacyRun = await app.storage.get<any>(COLLECTIONS.runs, betaRun.data.run.id);
    delete legacyRun.ownerId;
    delete legacyRun.workspaceId;
    legacyRun.status = 'queued';
    delete legacyRun.credentialRequirements;
    await app.storage.put(COLLECTIONS.runs, legacyRun.id, legacyRun, legacyRun.workflowId);
    const platformKeyDuringRecovery = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await app.engine.recoverInterruptedRuns().finally(() => {
      if (platformKeyDuringRecovery === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = platformKeyDuringRecovery;
    });
    const recoveredLegacyRun = await app.storage.get<any>(COLLECTIONS.runs, legacyRun.id);
    assert.equal(recoveredLegacyRun.status, 'awaiting_credentials');
    assert.deepEqual([recoveredLegacyRun.ownerId, recoveredLegacyRun.workspaceId], ['beta-admin', 'beta']);

    const defaultView = await request('GET', '/api/v1/settings/keys', undefined, rootToken);
    assert.equal(defaultView.data.keys.anthropic.length, 1);
    assert.doesNotMatch(JSON.stringify(defaultView.data), new RegExp(legacySecret));
    assert.deepEqual((await request('GET', '/api/v1/settings/keys', undefined, beta)).data.keys, {});

    const [openai, anthropic, betaWrite] = await Promise.all([
      request('PUT', '/api/v1/settings/keys', { brave: ['brave-concurrent-alpha'] }, alpha),
      request('PUT', '/api/v1/settings/keys', { tavily: ['tavily-concurrent-alpha'] }, alpha),
      request('PUT', '/api/v1/settings/keys', { gemini: ['concurrent-beta-gemini'] }, beta),
    ]);
    assert.deepEqual([openai.status, anthropic.status, betaWrite.status], [200, 200, 200]);

    assert.deepEqual(
      await app.storage.get(COLLECTIONS.settings, providerKeysStorageId('alpha')),
      { openai: [alphaSecret], brave: ['brave-concurrent-alpha'], tavily: ['tavily-concurrent-alpha'] },
    );
    assert.deepEqual(
      await app.storage.get(COLLECTIONS.settings, providerKeysStorageId('beta')),
      { gemini: ['concurrent-beta-gemini'] },
    );

    const [cleared, rotated] = await Promise.all([
      request('PUT', '/api/v1/settings/keys', { brave: null }, alpha),
      request('PUT', '/api/v1/settings/keys', { tavily: ['tavily-concurrent-alpha-rotated'] }, alpha),
    ]);
    assert.deepEqual([cleared.status, rotated.status], [200, 200]);
    assert.deepEqual(
      await app.storage.get(COLLECTIONS.settings, providerKeysStorageId('alpha')),
      { openai: [alphaSecret], tavily: ['tavily-concurrent-alpha-rotated'] },
    );
  });
});
