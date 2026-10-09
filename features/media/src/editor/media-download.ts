// What the editors' Download menus hand back. Flow renders its upscales on a server; Willow has
// none, so an image's 2K/4K is a high-quality resample on the device and the video sizes Willow
// cannot encode (GIF, 1080p, 4K) are offered disabled.
import type { MediaItem } from '../types';

export type DownloadSize = '1k' | '2k' | '4k' | 'gif' | '720p' | '1080p' | '4k-video';

export interface DownloadOption {
  size: DownloadSize;
  label: string;
  caption: string;
  available: boolean;
}

export const IMAGE_DOWNLOADS: DownloadOption[] = [
  { size: '1k', label: '1K', caption: 'Original size', available: true },
  { size: '2k', label: '2K', caption: 'Upscaled', available: true },
  { size: '4k', label: '4K', caption: 'Upscaled', available: true },
];

export const VIDEO_DOWNLOADS: DownloadOption[] = [
  { size: 'gif', label: '270p', caption: 'Animated GIF', available: false },
  { size: '720p', label: '720p', caption: 'Original size', available: true },
  { size: '1080p', label: '1080p', caption: 'Upscaled', available: false },
  { size: '4k-video', label: '4K', caption: 'Upscaled', available: false },
];

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '').trim() || 'media';

function save(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

async function upscale(url: string, longEdge: number): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const scale = longEdge / Math.max(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * Math.max(scale, 1));
  canvas.height = Math.round(img.naturalHeight * Math.max(scale, 1));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encode failed'))), 'image/png'));
}

export async function downloadMedia(item: MediaItem, size: DownloadSize): Promise<void> {
  if (!item.url) return;
  const name = safeName(item.shortenedPrompt || item.prompt);
  if (item.kind === 'image' && (size === '2k' || size === '4k')) {
    save(await upscale(item.url, size === '2k' ? 2048 : 4096), `${name} (${size.toUpperCase()}).png`);
    return;
  }
  const blob = await (await fetch(item.url)).blob();
  const ext = item.kind === 'video' ? (blob.type.includes('webm') ? 'webm' : 'mp4') : (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  save(blob, `${name}.${ext}`);
}

/** An image onto the clipboard as PNG, the one image type every browser accepts there. */
export async function copyImage(url: string): Promise<void> {
  // upscale never shrinks, so a long edge of 0 keeps the image's own size.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': upscale(url, 0) })]);
}

/** A collection's Download: every item at its original size, in one zip named after it. */
export async function downloadCollection(collectionName: string, items: MediaItem[]): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  for (const item of items) {
    if (!item.url || item.status !== 'completed') continue;
    const blob = await (await fetch(item.url)).blob();
    const ext = item.kind === 'video'
      ? (blob.type.includes('webm') ? 'webm' : 'mp4')
      : item.kind === 'audio'
        ? (blob.type.split('/')[1] || 'mp3').replace('mpeg', 'mp3')
        : (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const base = safeName(item.shortenedPrompt || item.prompt);
    let file = `${base}.${ext}`;
    for (let n = 1; used.has(file.toLowerCase()); n += 1) file = `${base} (${n}).${ext}`;
    used.add(file.toLowerCase());
    zip.file(file, blob);
  }
  save(await zip.generateAsync({ type: 'blob' }), `${safeName(collectionName)}.zip`);
}
