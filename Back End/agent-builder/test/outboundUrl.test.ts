import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertSafeOutboundUrl } from '../src/http/outboundUrl.ts';

describe('outbound URL policy', () => {
  it('rejects non-HTTP schemes and URL credentials', async () => {
    await assert.rejects(assertSafeOutboundUrl('file:///etc/passwd'), /must use http or https/);
    await assert.rejects(assertSafeOutboundUrl('https://user:secret@example.com/path'), /must not contain credentials/);
  });

  it('rejects loopback IPv4, mapped IPv6, and localhost DNS', async () => {
    await assert.rejects(assertSafeOutboundUrl('http://127.0.0.1/tool'), /private or local/);
    await assert.rejects(assertSafeOutboundUrl('http://[::ffff:127.0.0.1]/tool'), /private or local/);
    await assert.rejects(assertSafeOutboundUrl('http://localhost/tool'), /private or local/);
  });

  it('permits private targets only through the explicit development opt-in', async () => {
    const url = await assertSafeOutboundUrl('http://127.0.0.1:8787/tool', true);
    assert.equal(url.hostname, '127.0.0.1');
  });
});
