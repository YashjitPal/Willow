/**
 * An image from the Library, full screen: Luminous's Lightbox as Gemini's Library opens it.
 *
 * The picture fills at most the window less 180px of height (contained), over itself blurred
 * 24px and scaled 1.1 under a 90% #1e1e1e scrim; until it has loaded a square skeleton stands
 * in, `min(100vh - 180px, 100vw - 128px)` a side. Under it a pill of actions (12px down) —
 * Copy image, Download full size, Go to chat, Delete — disabled until the picture is in, each
 * with its tooltip. Close is the back arrow 16px in from the top left; Escape and a click
 * beside the picture close it too. Gemini's Share buttons need its public links, which Willow
 * has no counterpart for, so they are not here (Gemini hides them too when sharing is off).
 *
 * It opens and closes in one frame, as Gemini's does. A fade would uncover the blurred copy,
 * which fills the window at full strength under a scrim still on its way in or out.
 */
import React, { useEffect, useRef, useState } from 'react';
import { IconButton, Icon, OverlayPortal, useEscape, useFocusReturn } from './LibraryOverlays';
import { mediaTitle, type LibraryMedia } from './library-items';
import type { LoadMediaUrl } from './LibraryTile';

export const LibraryLightbox: React.FC<{
  item: LibraryMedia | null;
  loadUrl: LoadMediaUrl;
  onClose: () => void;
  onCopy: (url: string) => void;
  onDownload: (url: string) => void;
  onGoToChat: () => void;
  onDelete: () => void;
}> = ({ item, loadUrl, onClose, onCopy, onDownload, onGoToChat, onDelete }) => {
  const open = !!item;
  const dialogRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // Another picture's state is dropped before anything paints, so it never shows for a frame.
  const [shownKey, setShownKey] = useState(item?.key ?? null);
  if ((item?.key ?? null) !== shownKey) {
    setShownKey(item?.key ?? null);
    setUrl(null);
    setLoaded(false);
    setFailed(false);
  }
  useEscape(open, onClose);
  useFocusReturn(open, dialogRef);

  useEffect(() => {
    if (!item) return undefined;
    let cancelled = false;
    loadUrl(item, 'file').then((next) => {
      if (cancelled) return;
      if (next) setUrl(next); else { setFailed(true); setLoaded(true); }
    }, () => { if (!cancelled) { setFailed(true); setLoaded(true); } });
    return () => { cancelled = true; };
    // The lightbox follows its picture, not the item object's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.key, loadUrl]);

  if (!item) return null;
  const title = mediaTitle(item);
  const ready = loaded && !failed && !!url;
  return (
    <OverlayPortal>
      {ready && <img aria-hidden="true" alt="" className="gm-library-lightbox-ambient" src={url ?? undefined} />}
      <div className="gm-library-lightbox-scrim" aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} style={{ outline: 'none' }}>
        <div className="gm-library-lightbox-stage" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
          <div className="gm-library-lightbox-media" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            {!loaded && (
              <div className="gm-library-lightbox-loading" aria-hidden="true">
                <span className="gm-library-skeleton gm-library-skeleton--square" />
              </div>
            )}
            {failed ? (
              <div className="gm-library-lightbox-broken"><Icon name="hide_image" size={40} /></div>
            ) : url && (
              <img
                ref={(el) => { if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true); }}
                src={url}
                alt={title}
                decoding="async"
                style={{ display: loaded ? 'block' : 'none' }}
                onLoad={() => setLoaded(true)}
                onError={() => { setFailed(true); setLoaded(true); }}
              />
            )}
          </div>
          <div className="gm-library-lightbox-actions">
            <IconButton icon="content_copy" label="Copy image" disabled={!ready} onClick={() => url && onCopy(url)} />
            <IconButton icon="download" label="Download full size" disabled={!ready} onClick={() => url && onDownload(url)} />
            <IconButton icon="chat" label="Go to chat" disabled={!ready} onClick={onGoToChat} />
            <IconButton icon="delete" label="Delete" disabled={!ready} onClick={onDelete} />
          </div>
        </div>
        <div className="gm-library-lightbox-close">
          <IconButton icon="arrow_back" label="Close" size="m" tooltip={false} onClick={onClose} />
        </div>
      </div>
    </OverlayPortal>
  );
};
