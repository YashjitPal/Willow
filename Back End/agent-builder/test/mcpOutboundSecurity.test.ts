import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSafeMcpFetch } from '../src/mcp/manager.ts';

describe('MCP outbound network policy', () => {
  it('blocks localhost by default before invoking the transport', async () => {
    let called = false;
    const safeFetch = createSafeMcpFetch(false, async () => {
      called = true;
      return new Response('unexpected');
    });

    await assert.rejects(
      safeFetch('http://127.0.0.1:8787/mcp'),
      /private or local network address/,
    );
    assert.equal(called, false);
  });

  it('allows localhost only with the explicit development opt-in', async () => {
    let requestedUrl = '';
    let requestedRedirect: RequestInit['redirect'];
    const safeFetch = createSafeMcpFetch(true, async (input, init) => {
      requestedUrl = String(input);
      requestedRedirect = init?.redirect;
      return new Response('{}', { status: 200 });
    });

    const response = await safeFetch('http://127.0.0.1:8787/mcp', { redirect: 'follow' });
    assert.equal(response.status, 200);
    assert.equal(requestedUrl, 'http://127.0.0.1:8787/mcp');
    assert.equal(requestedRedirect, 'error');
  });

  it('rejects URL credentials even when private-network access is enabled', async () => {
    const safeFetch = createSafeMcpFetch(true, async () => new Response('{}'));
    await assert.rejects(
      safeFetch('https://user:secret@example.com/mcp'),
      /must not contain credentials/,
    );
  });

  it('applies the same checks to Request objects used by SDK reconnects', async () => {
    let called = false;
    const safeFetch = createSafeMcpFetch(false, async () => {
      called = true;
      return new Response('unexpected');
    });
    await assert.rejects(
      safeFetch(new Request('http://[::1]/events')),
      /private or local network address/,
    );
    assert.equal(called, false);
  });
});
