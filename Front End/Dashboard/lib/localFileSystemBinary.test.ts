import assert from 'node:assert/strict';
import test from 'node:test';
import { readFilesRecursively, writeFileRecursively } from './localFileSystemService.ts';

test('local project traversal represents binary files without decoding them as text', async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0xff]);
  const file = {
    name: 'logo.png',
    type: 'image/png',
    arrayBuffer: async () => bytes.buffer.slice(0),
  } as File;
  const directory = {
    async *values() {
      yield { kind: 'file', name: 'logo.png', getFile: async () => file };
    },
  } as unknown as FileSystemDirectoryHandle;

  const files = await readFilesRecursively(directory);
  assert.equal(files[0].name, 'logo.png');
  assert.match(files[0].content, /^data:image\/png;base64,/);
});

test('local recursive writes decode the binary representation back to bytes', async () => {
  const bytes = new Uint8Array([0, 1, 2, 0xfe, 0xff]);
  const content = `data:font/woff2;base64,${btoa(String.fromCharCode(...bytes))}`;
  let written: Blob | string | BufferSource | null = null;
  const writable = {
    write: async (value: Blob | string | BufferSource) => { written = value; },
    close: async () => undefined,
    abort: async () => undefined,
  };
  const directory: any = {
    getDirectoryHandle: async () => directory,
    getFileHandle: async () => ({ createWritable: async () => writable }),
  };

  await writeFileRecursively(directory, 'fonts/app.woff2', content);
  assert.ok(written instanceof Blob);
  assert.deepEqual(new Uint8Array(await written.arrayBuffer()), bytes);
});
