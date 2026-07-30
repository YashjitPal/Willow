export type ChatAttachmentKind =
  | 'github'
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'code'
  | 'text'
  | 'generic';

/** Serializable metadata kept inside a saved chat message. */
export interface ChatAttachment {
  id: string;
  kind: ChatAttachmentKind;
  name: string;
  extension: string;
  mimeType: string;
  size: number;
  /** Canonical URL for linked sources such as a GitHub repository. */
  sourceUrl?: string;
  sourceOwner?: string;
  sourceRepository?: string;
  sourceRef?: string;
  sourceCommit?: string;
  sourceDescription?: string;
  sourceFileCount?: number;
  /** Runtime-only object URL reconstructed from Willow's local blob store. */
  url?: string;
}

/** Attachment while it is still in the prompt composer. */
export interface ComposerAttachment extends ChatAttachment {
  /** Linked sources use a generated text snapshot; ordinary uploads use the original file. */
  file?: File;
  url?: string;
}

const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const AUDIO_EXTENSIONS = new Set(['aac', 'aiff', 'alac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'wma']);
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'webm', 'wmv']);
const DOCUMENT_EXTENSIONS = new Set(['doc', 'docx', 'epub', 'odt', 'pages', 'rtf']);
const SPREADSHEET_EXTENSIONS = new Set(['csv', 'numbers', 'ods', 'tsv', 'xls', 'xlsm', 'xlsx']);
const PRESENTATION_EXTENSIONS = new Set(['key', 'odp', 'ppt', 'pptx']);
const ARCHIVE_EXTENSIONS = new Set(['7z', 'bz2', 'gz', 'rar', 'tar', 'tgz', 'xz', 'zip']);
const CODE_EXTENSIONS = new Set([
  'astro', 'c', 'cc', 'cpp', 'cs', 'css', 'dart', 'go', 'graphql', 'h', 'hpp', 'html', 'java',
  'js', 'jsx', 'kt', 'kts', 'lua', 'm', 'mdx', 'php', 'pl', 'py', 'r', 'rb', 'rs', 'scss', 'sh',
  'sql', 'svelte', 'swift', 'toml', 'ts', 'tsx', 'vue', 'xml', 'yaml', 'yml',
]);
const TEXT_EXTENSIONS = new Set(['ini', 'json', 'log', 'md', 'text', 'txt']);

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  json: 'application/json',
  md: 'text/markdown',
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
};

export function getFileExtension(name: string): string {
  const cleanName = name.trim();
  const dotIndex = cleanName.lastIndexOf('.');
  return dotIndex > -1 && dotIndex < cleanName.length - 1
    ? cleanName.slice(dotIndex + 1).toLowerCase()
    : '';
}

export function inferAttachmentMimeType(file: Pick<File, 'name' | 'type'>): string {
  const reported = file.type?.trim().toLowerCase();
  if (reported) return reported;
  return MIME_BY_EXTENSION[getFileExtension(file.name)] || 'application/octet-stream';
}

export function detectAttachmentKind(
  name: string,
  mimeType = '',
): ChatAttachmentKind {
  const extension = getFileExtension(name);
  const mime = mimeType.toLowerCase();

  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (SPREADSHEET_EXTENSIONS.has(extension) || /spreadsheet|excel|csv/.test(mime)) return 'spreadsheet';
  if (PRESENTATION_EXTENSIONS.has(extension) || /presentation|powerpoint/.test(mime)) return 'presentation';
  if (ARCHIVE_EXTENSIONS.has(extension) || /zip|compressed|archive|tar/.test(mime)) return 'archive';
  if (CODE_EXTENSIONS.has(extension)) return 'code';
  if (TEXT_EXTENSIONS.has(extension) || mime.startsWith('text/') || /json|xml|yaml/.test(mime)) return 'text';
  if (DOCUMENT_EXTENSIONS.has(extension) || /word|document|rtf|epub/.test(mime)) return 'document';
  return 'generic';
}

export function createComposerAttachment(file: File): ComposerAttachment {
  const mimeType = inferAttachmentMimeType(file);
  const fallbackExtension = mimeType.split('/')[1]?.split('+')[0] || 'file';
  const extension = getFileExtension(file.name) || fallbackExtension;
  const name = file.name || `attachment.${extension}`;

  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: detectAttachmentKind(name, mimeType),
    name,
    extension,
    mimeType,
    size: file.size,
    file,
    url: URL.createObjectURL(file),
  };
}

export function toPersistedChatAttachment(attachment: ChatAttachment): ChatAttachment {
  const { url: _url, file: _file, ...persisted } = attachment as ComposerAttachment;
  return persisted;
}

export function isTextLikeAttachment(attachment: Pick<ChatAttachment, 'kind' | 'mimeType'>): boolean {
  return attachment.kind === 'text'
    || attachment.kind === 'code'
    || attachment.mimeType.startsWith('text/')
    || /json|xml|yaml/.test(attachment.mimeType);
}

export function getAttachmentFormatLabel(attachment: Pick<ChatAttachment, 'kind' | 'extension'>): string {
  if (attachment.kind === 'github') return 'GITHUB';
  if (attachment.kind === 'pdf') return 'PDF';
  if (attachment.extension) return attachment.extension.toUpperCase();
  switch (attachment.kind) {
    case 'audio': return 'AUDIO';
    case 'video': return 'VIDEO';
    case 'document': return 'DOCUMENT';
    case 'spreadsheet': return 'SHEET';
    case 'presentation': return 'SLIDES';
    case 'archive': return 'ARCHIVE';
    case 'code': return 'CODE';
    case 'text': return 'TEXT';
    case 'image': return 'IMAGE';
    default: return 'FILE';
  }
}

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Unable to read attachment.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}
