/**
 * A generated image in the thread — Gemini's `generated-image.luminous-layout`.
 *
 * Waiting: `.image-gen-shimmer-placeholder.gem-shimmer-active`, a 708x708 square (whatever the
 * requested shape — the placeholder never guesses), radius 40, #171717, with the -65deg sweep.
 * Done: the image at the column's width, radius 40, zooming in from 1.15 over 200ms once it has
 * loaded; on hover a translucent Edit / Share / Copy / Download row 12px in from the top right.
 */
import React, { useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { showCopyToast } from '@willow/ui/copy-toast-store';
import type { GeneratedMedia } from './generated-media';
import { ImageViewer } from './ImageViewer';
import './media.css';

const fileName = (item: GeneratedMedia): string => {
  const ext = item.attachment?.extension || (item.attachment?.mimeType.split('/')[1] ?? 'png');
  const stem = (item.prompt || 'Generated image').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'Generated image';
  return `${stem}.${ext}`;
};

export const downloadMedia = (url: string, name: string): void => {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

export const shareMedia = async (url: string, name: string, mimeType: string): Promise<void> => {
  try {
    const blob = await fetch(url).then((res) => res.blob());
    const file = new File([blob], name, { type: mimeType || blob.type });
    if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'AbortError') return;
  }
  downloadMedia(url, name);
};

const copyImage = async (url: string): Promise<void> => {
  try {
    const blob = await fetch(url).then((res) => res.blob());
    const png = blob.type === 'image/png' ? blob : await new Promise<Blob>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d')?.drawImage(img, 0, 0);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png');
      };
      img.onerror = reject;
      img.src = url;
    });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    showCopyToast('Copied to clipboard');
  } catch {
    showCopyToast('Something went wrong');
  }
};

/** One translucent 36px control: Gemini's `gem-icon-button[iconType=translucent]`. */
export const TranslucentButton: React.FC<{
  icon: string;
  label: string;
  onClick: () => void;
  size?: 36 | 48;
}> = ({ icon, label, onClick, size = 36 }) => (
  <button
    type="button"
    className={`gm-translucent-btn gm-translucent-btn--${size}`}
    aria-label={label}
    title={label}
    onClick={(event) => { event.stopPropagation(); onClick(); }}
  >
    <MaterialSymbol family="luminous" name={icon} size={24} weight={300} roundness={100} opticalSize={24} />
  </button>
);

/*
 * Images that have zoomed in, by URL. Text written after an image's call moves the image into
 * the reply between two slices, which mounts it again; it must not vanish and zoom in a second
 * time under the user's eyes. A chat opened again makes new URLs, so its images still zoom in.
 */
const shownImages = new Set<string>();

export const GeneratedImage: React.FC<{
  item: GeneratedMedia;
  /** "Describe your changes" in the viewer, and the hover row's Edit. */
  onEdit?: (item: GeneratedMedia, instruction: string) => void;
}> = ({ item, onEdit }) => {
  const url = item.attachment?.url;
  const [shown] = useState(() => !!url && shownImages.has(url));
  const [loaded, setLoaded] = useState(shown);
  const [viewerOpen, setViewerOpen] = useState(false);

  if (item.status === 'generating') {
    return <div className="gm-image-placeholder gm-shimmer" aria-label="Creating your image" role="img" />;
  }

  if (item.status === 'error' || !url) {
    return (
      <div className="gm-media-error" role="note">
        <MaterialSymbol family="luminous" name="hide_image" size={24} weight={300} roundness={100} opticalSize={24} />
        <span>{item.attachment?.unavailable ? 'This image is no longer available.' : item.error || "This image couldn't be created."}</span>
      </div>
    );
  }

  const name = fileName(item);
  return (
    <div className={`gm-image${loaded ? '' : ' gm-shimmer gm-image--loading'}`} style={!loaded && item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined}>
      <button type="button" className="gm-image__button" aria-label="Open image" onClick={() => setViewerOpen(true)}>
        <img
          className={`gm-image__img${loaded ? (shown ? ' is-shown' : ' is-loaded') : ''}`}
          src={url}
          alt={item.prompt}
          draggable={false}
          onLoad={() => { setLoaded(true); shownImages.add(url); }}
        />
      </button>
      {loaded && (
        <div className="gm-image__controls">
          {onEdit && (
            <button
              type="button"
              className="gm-translucent-pill"
              aria-label="Edit image"
              title="Edit image"
              onClick={(event) => { event.stopPropagation(); setViewerOpen(true); }}
            >
              Edit
            </button>
          )}
          <TranslucentButton icon="share_1" label="Share image" onClick={() => { void shareMedia(url, name, item.attachment?.mimeType ?? 'image/png'); }} />
          <TranslucentButton icon="content_copy" label="Copy image" onClick={() => { void copyImage(url); }} />
          <TranslucentButton icon="download" label="Download full size image" onClick={() => downloadMedia(url, name)} />
        </div>
      )}
      {viewerOpen && (
        <ImageViewer
          url={url}
          name={name}
          alt={item.prompt}
          mimeType={item.attachment?.mimeType ?? 'image/png'}
          onClose={() => setViewerOpen(false)}
          onSubmitEdit={onEdit ? (instruction) => { setViewerOpen(false); onEdit(item, instruction); } : undefined}
        />
      )}
    </div>
  );
};
