import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.html', '.htm', '.xml', '.yaml', '.yml', '.log']);
const MAX_EXTRACTED_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_DOCX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_DOCX_EXPANSION_RATIO = 100;

function boundedText(text: string): string {
  if (Buffer.byteLength(text, 'utf8') > MAX_EXTRACTED_TEXT_BYTES) {
    throw new Error('document extracted text exceeds 20 MB');
  }
  return text;
}

function validateDocxArchive(content: Buffer): void {
  let expandedBytes = 0;
  let entries = 0;
  for (let offset = 0; offset + 46 <= content.length;) {
    const signature = content.readUInt32LE(offset);
    if (signature !== 0x02014b50) {
      offset++;
      continue;
    }
    const compressedBytes = content.readUInt32LE(offset + 20);
    const uncompressedBytes = content.readUInt32LE(offset + 24);
    const nameLength = content.readUInt16LE(offset + 28);
    const extraLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    if (compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff) {
      throw new Error('DOCX ZIP64 archives are not supported');
    }
    expandedBytes += uncompressedBytes;
    entries++;
    if (expandedBytes > MAX_DOCX_EXPANDED_BYTES) {
      throw new Error('DOCX expanded content exceeds 32 MB');
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!entries) throw new Error('DOCX archive has no readable entries');
  if (expandedBytes > Math.max(content.byteLength * MAX_DOCX_EXPANSION_RATIO, 1024 * 1024)) {
    throw new Error('DOCX archive expansion ratio exceeds the safety limit');
  }
}

export async function extractDocumentText(
  filename: string,
  content: string | Buffer,
  mimeType?: string,
): Promise<string> {
  // Keep the same extraction bound for callers that already decoded text. This
  // path is used by vector-store imports and otherwise bypasses the byte limit
  // enforced for binary document extractors.
  if (typeof content === 'string') return boundedText(content);
  const extension = path.extname(filename).toLowerCase();
  const normalizedMime = mimeType?.split(';', 1)[0].trim().toLowerCase();

  if (extension === '.pdf' || normalizedMime === 'application/pdf') {
    const parser = new PDFParse({ data: new Uint8Array(content) });
    try {
      return boundedText((await parser.getText()).text);
    } finally {
      await parser.destroy();
    }
  }

  if (extension === '.docx' || normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    validateDocxArchive(content);
    const result = await mammoth.extractRawText({ buffer: content });
    return boundedText(result.value);
  }

  if (TEXT_EXTENSIONS.has(extension) || normalizedMime?.startsWith('text/') || normalizedMime === 'application/json') {
    return boundedText(content.toString('utf8'));
  }

  throw new Error(`unsupported file type '${extension || normalizedMime || 'unknown'}'; supported formats are PDF, DOCX, TXT, Markdown, CSV, JSON, HTML, XML, YAML, TSV, and log files`);
}
