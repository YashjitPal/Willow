import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { extractDocumentText } from '../src/rag/extractText.ts';
import { textPdf } from './fixtures.ts';

describe('document text extraction', () => {
  it('preserves supported plain-text uploads', async () => {
    const content = Buffer.from('# Guide\n\nSearchable content', 'utf8');
    assert.equal(await extractDocumentText('guide.md', content, 'text/markdown'), content.toString('utf8'));
  });

  it('bounds already-decoded text just like binary documents', async () => {
    const oversized = 'x'.repeat(20 * 1024 * 1024 + 1);
    await assert.rejects(
      extractDocumentText('already-decoded.txt', oversized),
      /document extracted text exceeds 20 MB/,
    );
  });

  it('extracts text from DOCX bytes', async () => {
    const fixture = await readFile(new URL('../node_modules/mammoth/test/test-data/single-paragraph.docx', import.meta.url));
    const text = await extractDocumentText('source.docx', fixture, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.match(text, /Walking on imported air/);
  });

  it('rejects DOCX archives that advertise unsafe expanded content', async () => {
    const fixture = Buffer.from(await readFile(new URL('../node_modules/mammoth/test/test-data/single-paragraph.docx', import.meta.url)));
    let patchedEntries = 0;
    for (let offset = 0; offset + 46 <= fixture.length; offset++) {
      if (fixture.readUInt32LE(offset) !== 0x02014b50) continue;
      fixture.writeUInt32LE(16 * 1024 * 1024, offset + 24);
      patchedEntries++;
      if (patchedEntries === 3) break;
    }
    assert.equal(patchedEntries, 3);
    await assert.rejects(
      extractDocumentText('unsafe.docx', fixture, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      /expanded content exceeds 32 MB/,
    );
  });

  it('extracts text from PDF bytes', async () => {
    const text = await extractDocumentText('knowledge.pdf', textPdf('Willow PDF knowledge'), 'application/pdf');
    assert.match(text, /Willow PDF knowledge/);
  });

  it('rejects binary formats without an extractor', async () => {
    await assert.rejects(
      extractDocumentText('archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'application/zip'),
      /unsupported file type/,
    );
  });
});
