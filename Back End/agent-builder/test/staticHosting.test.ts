import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { AppConfig } from '../src/config.ts';
import { createRequestHandler } from '../src/http/server.ts';
import { Router } from '../src/http/router.ts';

let dir = '';
let baseUrl = '';
let server: http.Server;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-static-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Willow smoke</title><div id="root"></div>');
  fs.writeFileSync(path.join(dir, 'assets', 'app-123.js'), 'globalThis.__willowSmoke = true;');
  fs.writeFileSync(path.join(dir, '.secret'), 'must not be served');
  const config: AppConfig = {
    port: 0, host: '127.0.0.1', dataDir: dir, corsOrigins: [],
    defaultMaxIterations: 100, defaultMaxTurns: 8, maxConcurrentRuns: 8,
    sessionTtlSeconds: 3600, traceRetentionMaxRuns: 0, traceRetentionMaxAgeDays: 0,
    traceRetentionIntervalSeconds: 60, staticDir: dir, allowPrivateNetworks: false,
  };
  const principal = {
    id: 'test', subjectId: 'test', workspaceId: 'test', role: 'admin', scopes: ['*'],
    kind: 'api_key', authority: 'platform',
  };
  const governance = {
    authenticate: async () => principal,
    allows: () => true,
    audit: async () => undefined,
  };
  server = http.createServer(createRequestHandler(new Router(), config, governance as never));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('static server failed to listen');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('production static hosting', () => {
  it('serves the frontend entrypoint, immutable assets, HEAD, and SPA routes', async () => {
    const root = await fetch(`${baseUrl}/`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(root.headers.get('cache-control'), 'no-cache');
    assert.match(await root.text(), /Willow smoke/);

    const asset = await fetch(`${baseUrl}/assets/app-123.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /^text\/javascript/);
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(await asset.text(), /__willowSmoke/);

    const head = await fetch(`${baseUrl}/assets/app-123.js`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.ok(Number(head.headers.get('content-length')) > 0);
    assert.equal(await head.text(), '');

    const spa = await fetch(`${baseUrl}/workflows/wf_123/builder`);
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /Willow smoke/);
  });

  it('does not turn missing assets, API paths, dotfiles, or traversal attempts into SPA responses', async () => {
    for (const requestPath of ['/assets/missing.js', '/api/v1/missing', '/.secret', '/..%5coutside.txt']) {
      const response = await fetch(`${baseUrl}${requestPath}`);
      assert.equal(response.status, 404, requestPath);
      assert.match(response.headers.get('content-type') ?? '', /application\/json/);
      assert.doesNotMatch(await response.text(), /must not be served|Willow smoke/);
    }
  });
});
