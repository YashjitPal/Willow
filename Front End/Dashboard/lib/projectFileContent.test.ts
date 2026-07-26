import assert from 'node:assert/strict';
import test from 'node:test';
import { getProjectFileUploadPayload, projectFileContentFromBytes } from './projectFileContent.ts';

test('binary project files round-trip without UTF-8 corruption', async () => {
  const original = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10, 0x80]);
  const content = projectFileContentFromBytes('assets/logo.png', original, 'image/png');
  assert.match(content, /^data:image\/png;base64,/);
  const payload = getProjectFileUploadPayload('assets/logo.png', content);
  assert.equal(payload.binary, true);
  assert.deepEqual(new Uint8Array(await payload.blob.arrayBuffer()), original);
});

test('UTF-8 source files remain plain editable text', async () => {
  const text = 'export const greeting = "Namaste 👋";\n';
  const bytes = new TextEncoder().encode(text);
  assert.equal(projectFileContentFromBytes('src/app.ts', bytes, 'application/typescript'), text);
});

test('data URL text inside a source file is not decoded as the source file itself', async () => {
  const content = 'data:image/png;base64,iVBORw0KGgo=';
  const payload = getProjectFileUploadPayload('src/fixture.ts', content, 'application/typescript');
  assert.equal(payload.binary, false);
  assert.equal(await payload.blob.text(), content);
});

test('unknown binary files are sniffed and represented safely', () => {
  const content = projectFileContentFromBytes('asset.dat', new Uint8Array([0, 1, 2, 255]));
  assert.match(content, /^data:application\/octet-stream;base64,/);
});
