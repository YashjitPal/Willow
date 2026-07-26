import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { webSearch } from '../src/tools/webSearch.ts';

describe('web search cancellation', () => {
  it('aborts an in-flight fallback request with the run signal', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    })) as typeof fetch;
    try {
      const controller = new AbortController();
      const pending = webSearch('cancel me', undefined, 5, controller.signal);
      controller.abort(new Error('run cancelled'));
      await assert.rejects(pending, /run cancelled|request aborted/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('disables redirects on keyed and fallback search requests', async () => {
    const originalFetch = globalThis.fetch;
    const redirects: Array<RequestInit['redirect']> = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      redirects.push(init?.redirect);
      if (redirects.length === 1) throw new TypeError('redirect blocked');
      return new Response('', { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    try {
      await webSearch('redirect test', { tavily: ['secret-key'] }, 5);
      assert.deepEqual(redirects, ['error', 'error', 'error']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects an oversized search response before parsing it', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('too large', {
      status: 200,
      headers: { 'content-length': String(4 * 1024 * 1024 + 1) },
    })) as typeof fetch;
    try {
      await assert.rejects(webSearch('large response', undefined, 5), /response exceeds 4194304 bytes/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('normalizes Tavily result URLs and rejects unsafe provider junk', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      results: [
        { title: 'safe', url: 'HTTPS://Example.COM:443/a/../result?q=one two#part', content: 'ok' },
        { title: 'script', url: 'javascript:alert(1)', content: 'bad' },
        { title: 'credentials', url: 'https://user:pass@example.com/private', content: 'bad' },
        { title: 'relative', url: '//example.com/not-absolute', content: 'bad' },
        { title: 'invalid', url: 'http://[::1', content: 'bad' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      assert.deepEqual(await webSearch('urls', { tavily: ['key'] }, 10), [{
        title: 'safe',
        url: 'https://example.com/result?q=one%20two#part',
        snippet: 'ok',
      }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('applies the same URL validation to Brave results', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ web: { results: [
      { title: '<b>safe</b>', url: 'http://Example.com:80/path', description: '<i>ok</i>' },
      { title: 'file', url: 'file:///etc/passwd', description: 'bad' },
      { title: 'credentials', url: 'https://token@example.com/', description: 'bad' },
    ] } }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      assert.deepEqual(await webSearch('urls', { brave: ['key'] }, 10), [{
        title: 'safe', url: 'http://example.com/path', snippet: 'ok',
      }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('validates decoded DuckDuckGo targets and skips malformed redirect encoding', async () => {
    const originalFetch = globalThis.fetch;
    const html = [
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2FExample.com%3A443%2Fsafe%3Fx%3D1">safe</a>',
      '<a class="result__a" href="javascript:alert(1)">script</a>',
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fuser%40example.com%40evil.test%2F">credentials</a>',
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=%E0%A4%A">malformed</a>',
      '<a class="result__snippet">safe snippet</a>',
    ].join('');
    globalThis.fetch = (async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
    try {
      assert.deepEqual(await webSearch('urls', { tavily: [], brave: [] }, 10), [{
        title: 'safe', url: 'https://example.com/safe?x=1', snippet: 'safe snippet',
      }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses a bounded integer result count for non-finite and fractional requests', async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      requests.push(String(url));
      return new Response(JSON.stringify({ web: { results: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      await webSearch('bounded', { brave: ['key'] }, Number.NaN);
      await webSearch('bounded', { brave: ['key'] }, Number.POSITIVE_INFINITY);
      await webSearch('bounded', { brave: ['key'] }, 3.9);
      assert.match(requests[0], /count=5/);
      assert.match(requests[1], /count=5/);
      assert.match(requests[2], /count=3/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
