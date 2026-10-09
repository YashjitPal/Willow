/**
 * An image the user sent, full screen: Gemini's `image-expansion-dialog` as it opens for an
 * uploaded image (`trusted-image-dialog-container`), measured at 1536x826, 800x1280 and 390x844
 * (`tools/scratch/gemini-sent-image.cjs`, captures in `tools/ui-research/captures/gemini/sent-image/`).
 *
 * The lightbox the generated-image viewer uses — a 0.9-black backdrop and the image's own
 * colours washed over the screen — with a lighter header: Close, the image glyph and the file's
 * name, and More options, which holds Copy. No editing. The image keeps its own size up to
 * 768px wide (95vw on a phone, three quarters of a tablet's width) and 90vh tall, centred.
 *
 * Gemini closes it only from Close: Escape and a click on the dark area do nothing there.
 * Escape closes it here as well, as it does Willow's other viewer.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { showCopyToast } from '@willow/ui/copy-toast-store';
import { samplePalette } from './ImageViewer';
import './media.css';

/** Gemini's dialog close: the content fades and shrinks for 75ms, then the overlay goes. */
const CLOSE_MS = 75;

/** The clipboard takes images as PNG, so anything else is redrawn as one first. */
const asPng = (blob: Blob): Promise<Blob> => {
  if (blob.type === 'image/png') return Promise.resolve(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')?.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('no PNG'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    img.src = url;
  });
};

const copyImage = async (url: string): Promise<void> => {
  const blob = await (await fetch(url)).blob();
  const png = await asPng(blob);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
};

export const SentImageViewer: React.FC<{
  url: string;
  name: string;
  onClose: () => void;
}> = ({ url, name, onClose }) => {
  const [palette, setPalette] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => { void samplePalette(url).then(setPalette); }, [url]);
  // The dialog's first control takes focus, as Gemini's does.
  useEffect(() => { backRef.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(() => closeRef.current(), CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (menuOpen) setMenuOpen(false);
      else setClosing(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest('.gm-sent-viewer__more-anchor')) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [menuOpen]);

  const copy = () => {
    setMenuOpen(false);
    copyImage(url)
      .then(() => showCopyToast('Image copied'))
      .catch(() => showCopyToast('Couldn\u2019t copy the image'));
  };

  return createPortal(
    <div
      className={`gm-sent-viewer${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Lightbox showing the image in a larger view"
    >
      <div className="gm-sent-viewer__backdrop" aria-hidden="true" />
      <div className="gm-viewer__mesh gm-sent-viewer__mesh" style={palette[0] ? { backgroundColor: palette[0] } : undefined} aria-hidden="true">
        {palette.slice(1).map((color, index) => (
          <div key={index} className={`gm-viewer__node gm-viewer__node--${index + 1}`} style={{ background: color }} />
        ))}
      </div>

      <div className="gm-sent-viewer__header">
        <div className="gm-sent-viewer__title">
          <button
            ref={backRef}
            type="button"
            className="gm-sent-viewer__button gm-sent-viewer__back"
            aria-label="Close"
            title="Close"
            onClick={() => setClosing(true)}
          >
            <MaterialSymbol family="luminous" name="arrow_back" size={24} weight={300} roundness={100} opticalSize={24} />
          </button>
          <div className="gm-sent-viewer__name-row">
            <MaterialSymbol family="luminous" name="image" size={24} weight={300} roundness={100} opticalSize={24} />
            <span className="gm-sent-viewer__name" title={name}>{name}</span>
          </div>
        </div>
        <div className="gm-sent-viewer__more-anchor">
          <button
            type="button"
            className="gm-sent-viewer__button gm-sent-viewer__more"
            aria-label="More options"
            title="More options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MaterialSymbol family="luminous" name="more_horiz" size={24} weight={300} roundness={100} opticalSize={24} />
          </button>
          {menuOpen && (
            <div className="gm-sent-viewer__menu" role="menu">
              <button type="button" role="menuitem" className="gm-sent-viewer__menu-item" onClick={copy}>
                <MaterialSymbol family="luminous" name="content_copy" size={24} weight={300} roundness={100} opticalSize={24} />
                <span>Copy</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="gm-sent-viewer__content">
        <img className="gm-sent-viewer__img" src={url} alt={name} draggable={false} />
      </div>
    </div>,
    document.body,
  );
};
