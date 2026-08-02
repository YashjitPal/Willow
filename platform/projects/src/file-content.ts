const TEXT_EXTENSIONS = new Set([
  'css', 'csv', 'graphql', 'gql', 'htm', 'html', 'ini', 'java', 'js', 'jsx',
  'json', 'jsonc', 'kt', 'less', 'log', 'lua', 'md', 'mjs', 'cjs', 'php',
  'properties', 'py', 'rb', 'rs', 'scss', 'sh', 'sql', 'svelte', 'svg', 'toml',
  'ts', 'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif', bmp: 'image/bmp', css: 'text/css', csv: 'text/csv',
  eot: 'application/vnd.ms-fontobject', gif: 'image/gif', html: 'text/html',
  ico: 'image/x-icon', jpeg: 'image/jpeg', jpg: 'image/jpeg', js: 'application/javascript',
  json: 'application/json', jsx: 'application/javascript', md: 'text/markdown',
  mp3: 'audio/mpeg', mp4: 'video/mp4', ogg: 'audio/ogg', otf: 'font/otf',
  pdf: 'application/pdf', png: 'image/png', svg: 'image/svg+xml',
  ts: 'application/typescript', tsx: 'application/typescript', ttf: 'font/ttf',
  txt: 'text/plain', wasm: 'application/wasm', wav: 'audio/wav', webm: 'video/webm',
  webp: 'image/webp', woff: 'font/woff', woff2: 'font/woff2', xml: 'application/xml',
  yaml: 'application/yaml', yml: 'application/yaml', zip: 'application/zip',
};

function extension(filename: string): string {
  const basename = filename.replace(/\\/g, '/').split('/').pop() || '';
  const index = basename.lastIndexOf('.');
  return index >= 0 ? basename.slice(index + 1).toLowerCase() : '';
}

export function getProjectFileMimeType(filename: string): string {
  return MIME_BY_EXTENSION[extension(filename)] || 'application/octet-stream';
}

function isTextMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(';', 1)[0];
  return normalized.startsWith('text/') ||
    normalized === 'application/json' || normalized.endsWith('+json') ||
    normalized === 'application/javascript' || normalized === 'application/typescript' ||
    normalized === 'application/xml' || normalized.endsWith('+xml') ||
    normalized === 'application/yaml';
}

function bytesLookBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.some((byte) => byte === 0)) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return false;
  } catch {
    return true;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * The editor is string-based, so binary files use a data URL while in memory.
 * Text files stay plain text. This representation survives IndexedDB snapshots
 * and Drive round-trips without passing arbitrary bytes through UTF-8.
 */
export function projectFileContentFromBytes(
  filename: string,
  bytes: Uint8Array,
  reportedMimeType = '',
): string {
  const inferredMimeType = getProjectFileMimeType(filename);
  const knownTextExtension = TEXT_EXTENSIONS.has(extension(filename));
  const mimeType = reportedMimeType || inferredMimeType;
  const binary = !knownTextExtension && (
    (reportedMimeType && !isTextMimeType(reportedMimeType)) ||
    (!reportedMimeType && !isTextMimeType(inferredMimeType) && bytesLookBinary(bytes)) ||
    bytesLookBinary(bytes)
  );
  if (binary) return `data:${mimeType || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
  return new TextDecoder('utf-8').decode(bytes);
}

export async function readProjectFileContent(file: File): Promise<string> {
  return projectFileContentFromBytes(file.name, new Uint8Array(await file.arrayBuffer()), file.type);
}

export interface ProjectFileUploadPayload {
  blob: Blob;
  mimeType: string;
  binary: boolean;
}

/** Decode Willow's in-memory binary representation before writing to disk/Drive. */
export function getProjectFileUploadPayload(
  filename: string,
  content: string,
  fallbackMimeType = getProjectFileMimeType(filename),
): ProjectFileUploadPayload {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(content);
  const knownTextExtension = TEXT_EXTENSIONS.has(extension(filename));
  if (match && !knownTextExtension && !isTextMimeType(match[1])) {
    const mimeType = match[1] || fallbackMimeType || 'application/octet-stream';
    return { blob: new Blob([base64ToBytes(match[2])], { type: mimeType }), mimeType, binary: true };
  }
  const mimeType = isTextMimeType(fallbackMimeType) ? fallbackMimeType : 'text/plain';
  return { blob: new Blob([content], { type: mimeType }), mimeType, binary: false };
}
