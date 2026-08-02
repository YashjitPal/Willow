import assert from 'node:assert/strict';
import test from 'node:test';
import { DriveService } from './google-drive';
import { getProjectFileUploadPayload } from '@willow/projects/file-content';

test('Drive binary upload uses the resumable byte-safe path', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    if (calls.length === 1) {
      return new Response('{}', { status: 200, headers: { Location: 'https://upload.example/session' } });
    }
    return new Response(JSON.stringify({ id: 'file-1', name: 'logo.png', mimeType: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0xff]);
    const content = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
    await new DriveService('token').createFile('logo.png', content, 'parent', 'image/png');
    assert.equal(calls.length, 2);
    assert.match(calls[0].input, /uploadType=resumable/);
    assert.equal(calls[1].input, 'https://upload.example/session');
    assert.deepEqual(new Uint8Array(await (calls[1].init?.body as Blob).arrayBuffer()), bytes);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Drive binary download becomes the editor data-URL representation', async () => {
  const originalFetch = globalThis.fetch;
  const bytes = new Uint8Array([0, 1, 2, 0xfe, 0xff]);
  globalThis.fetch = (async () => new Response(bytes, { status: 200 })) as typeof fetch;
  try {
    const content = await new DriveService('token').getFileContent({
      id: 'file-1', name: 'font.woff2', mimeType: 'font/woff2',
    });
    assert.match(content, /^data:font\/woff2;base64,/);
    const decoded = getProjectFileUploadPayload('font.woff2', content);
    assert.deepEqual(new Uint8Array(await decoded.blob.arrayBuffer()), bytes);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
