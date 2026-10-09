/**
 * The generated image full screen — Gemini's `expansion-dialog` (image-expansion-dialog-panel).
 *
 * Measured at 1536x826: a 0.9-black backdrop with a 2px blur, over which a fixed
 * `mesh-gradient-bg` washes the screen in the image's own colours (a dark base plus four large
 * blurred ellipses). The image is fitted inside 1024 x (viewport - 300) and centred; a 36px
 * frosted back button sits at 28/14, undo/redo/more at the top right; under the image, a tool row
 * (Prompt in chat, Resize, Erase) and the 361x64 "Describe your changes" pill.
 *
 * Editing here posts a new chat turn with this image as its input, the way the composer would.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { downloadMedia, shareMedia } from './GeneratedImage';
import { IMAGE_ASPECT_RATIOS } from './generated-media';
import './media.css';

/** Five colours off the image: a dark base, then one per quadrant. */
export const samplePalette = (url: string): Promise<string[]> => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    try {
      const size = 24;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) { resolve([]); return; }
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      const average = (x0: number, y0: number, w: number, h: number) => {
        let r = 0; let g = 0; let b = 0; let n = 0;
        for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) {
          const i = (y * size + x) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
        }
        return [r / n, g / n, b / n];
      };
      const half = size / 2;
      const quads = [average(0, 0, half, half), average(half, 0, half, half), average(0, half, size, half), average(half / 2, half / 2, half, half)];
      const all = average(0, 0, size, size);
      const css = ([r, g, b]: number[], k = 1) => `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
      resolve([css(all, 0.32), ...quads.map((q) => css(q, 0.62))]);
    } catch {
      resolve([]);
    }
  };
  img.onerror = () => resolve([]);
  img.src = url;
});

export const ImageViewer: React.FC<{
  url: string;
  name: string;
  alt: string;
  mimeType: string;
  onClose: () => void;
  onSubmitEdit?: (instruction: string) => void;
}> = ({ url, name, alt, mimeType, onClose, onSubmitEdit }) => {
  const [palette, setPalette] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'prompt' | 'erase'>('prompt');
  const [resizeOpen, setResizeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { void samplePalette(url).then(setPalette); }, [url]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (menuOpen || resizeOpen) { setMenuOpen(false); setResizeOpen(false); return; }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, resizeOpen, onClose]);

  const nodes = useMemo(() => palette.slice(1), [palette]);
  const submit = () => {
    const text = draft.trim();
    if (!text || !onSubmitEdit) return;
    onSubmitEdit(mode === 'erase' ? `Erase this from the image, filling the space naturally: ${text}` : text);
  };

  return createPortal(
    <div className="gm-viewer" role="dialog" aria-label="Lightbox showing the image in a larger view">
      <div className="gm-viewer__backdrop" />
      <div className="gm-viewer__mesh" style={palette[0] ? { backgroundColor: palette[0] } : undefined} aria-hidden="true">
        {nodes.map((color, i) => (
          <div key={i} className={`gm-viewer__node gm-viewer__node--${i + 1}`} style={{ background: color }} />
        ))}
      </div>

      <button type="button" className="gm-viewer__exit" aria-label="Close" title="Close" onClick={onClose}>
        <MaterialSymbol family="luminous" name="arrow_back" size={24} weight={300} roundness={100} opticalSize={24} />
      </button>
      <div className="gm-viewer__actions">
        <button type="button" className="gm-viewer__action" aria-label="Undo" title="Undo" disabled>
          <MaterialSymbol family="luminous" name="undo" size={24} weight={300} roundness={100} opticalSize={24} />
        </button>
        <button type="button" className="gm-viewer__action" aria-label="Redo" title="Redo" disabled>
          <MaterialSymbol family="luminous" name="redo" size={24} weight={300} roundness={100} opticalSize={24} />
        </button>
        <div className="gm-viewer__more-anchor">
          <button type="button" className="gm-viewer__more" aria-label="More options" title="More options" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            <MaterialSymbol family="luminous" name="more_horiz" size={24} weight={300} roundness={100} opticalSize={24} />
          </button>
          {menuOpen && (
            <div className="gm-viewer__menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); downloadMedia(url, name); }}>
                <MaterialSymbol family="luminous" name="download" size={20} weight={300} roundness={100} opticalSize={20} />
                <span>Download</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void shareMedia(url, name, mimeType); }}>
                <MaterialSymbol family="luminous" name="share_1" size={20} weight={300} roundness={100} opticalSize={20} />
                <span>Share</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="gm-viewer__stage">
        <img className="gm-viewer__img" src={url} alt={alt} draggable={false} />
      </div>

      {onSubmitEdit && (
        <div className="gm-viewer__editing">
          <div className="gm-viewer__tools">
            <button
              type="button"
              className={`gm-viewer__prompt${mode === 'prompt' ? ' is-active' : ''}`}
              aria-label="Prompt in chat"
              title="Prompt in chat"
              onClick={() => { setMode('prompt'); inputRef.current?.focus(); }}
            >
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                <path d="M6 0c.4 3.1 2.9 5.6 6 6-3.1.4-5.6 2.9-6 6-.4-3.1-2.9-5.6-6-6 3.1-.4 5.6-2.9 6-6z" fill="currentColor" />
              </svg>
            </button>
            <div className="gm-viewer__resize-anchor">
              <button type="button" className="gm-viewer__tool" aria-expanded={resizeOpen} onClick={() => setResizeOpen((open) => !open)}>Resize</button>
              {resizeOpen && (
                <div className="gm-viewer__menu gm-viewer__menu--up" role="menu">
                  {IMAGE_ASPECT_RATIOS.map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      role="menuitem"
                      onClick={() => { setResizeOpen(false); onSubmitEdit(`Extend this image to a ${ratio} aspect ratio, keeping everything already in it unchanged and filling the new space naturally.`); }}
                    >
                      <span>{ratio}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className={`gm-viewer__tool${mode === 'erase' ? ' is-active' : ''}`}
              onClick={() => { setMode('erase'); inputRef.current?.focus(); }}
            >
              Erase
            </button>
          </div>
          <form className="gm-viewer__input" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              placeholder={mode === 'erase' ? 'Describe what to erase' : 'Describe your changes'}
              aria-label={mode === 'erase' ? 'Describe what to erase' : 'Describe your changes'}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
              }}
            />
            <button type="submit" className="gm-viewer__send" aria-label="Send" disabled={!draft.trim()}>
              <MaterialSymbol family="luminous" name="arrow_upward" size={24} weight={300} roundness={100} opticalSize={24} />
            </button>
          </form>
        </div>
      )}
    </div>,
    document.body,
  );
};
