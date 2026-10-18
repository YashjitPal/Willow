/**
 * One media tile: Gemini's `LibraryItemCard`.
 *
 * A square of surface-container-highest holding the picture, cropped to cover. Until it has
 * loaded, a square skeleton pulses over it ("Loading thumbnail"); an image that cannot load
 * says "Couldn't load image" over a muted `hide_image`; anything else with no picture shows
 * its title over its type's glyph. Videos and tracks carry a round badge once the picture is
 * in. From 769px a translucent Delete appears top right while the tile is hovered or focused;
 * below that a More options button is always there instead and opens the item sheet.
 */
import React, { useEffect, useState } from 'react';
import { IconButton, Icon, LibraryTooltip, useTooltip } from './LibraryOverlays';
import { mediaBadgeIcon, mediaTitle, mediaTypeIcon, type LibraryMedia } from './library-items';

export type LoadMediaUrl = (item: LibraryMedia, which: 'thumbnail' | 'file') => Promise<string | null>;

export const LibraryTile: React.FC<{
  item: LibraryMedia;
  loadUrl: LoadMediaUrl;
  onOpen: () => void;
  onDelete: () => void;
  onMore: () => void;
}> = ({ item, loadUrl, onOpen, onDelete, onMore }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const hasThumbnail = !!item.thumbnail;
  const isImage = item.kind === 'image';
  const title = mediaTitle(item);
  const brokenTip = useTooltip();

  const thumbnailId = item.thumbnail?.id;
  useEffect(() => {
    if (!thumbnailId) return undefined;
    let cancelled = false;
    setUrl(null);
    setLoaded(false);
    setFailed(false);
    loadUrl(item, 'thumbnail').then((next) => {
      if (cancelled) return;
      if (next) setUrl(next); else setFailed(true);
    }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // The tile follows its picture, not the item object's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.key, thumbnailId, loadUrl]);

  // A picture already in memory can finish before React is listening for its load.
  const settleIfReady = (el: HTMLImageElement | HTMLVideoElement | null) => {
    if (!el) return;
    if (el instanceof HTMLImageElement ? el.complete && el.naturalWidth > 0 : el.readyState >= 2) setLoaded(true);
  };

  const broken = isImage && (!hasThumbnail || failed);
  const badge = mediaBadgeIcon(item.kind);
  const showBadge = !broken && !!badge && (!hasThumbnail || loaded || failed);

  let face: React.ReactNode;
  if (broken) {
    face = (
      <div className="gm-library-tile-text">
        <div style={{ width: '100%' }}>
          <span className="gm-library-body gm-library-muted gm-library-clamp-2" {...brokenTip.handlers}>Couldn&apos;t load image</span>
          {brokenTip.anchor && <LibraryTooltip anchor={brokenTip.anchor} label="Couldn't load image" />}
        </div>
        <div className="gm-library-muted-icon"><Icon name="hide_image" size={24} /></div>
      </div>
    );
  } else if (hasThumbnail && !failed) {
    face = (
      <>
        {!loaded && (
          <div aria-busy="true" aria-label="Loading thumbnail" role="status" className="gm-library-tile-loading">
            <span aria-hidden="true" className="gm-library-skeleton gm-library-skeleton--square" />
          </div>
        )}
        {url && (item.kind === 'video' ? (
          <video
            ref={settleIfReady}
            className="gm-library-tile-media"
            src={url}
            muted
            playsInline
            preload="metadata"
            onLoadedData={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        ) : (
          <img
            ref={settleIfReady}
            className="gm-library-tile-media"
            src={url}
            alt={title}
            draggable={false}
            decoding="async"
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        ))}
      </>
    );
  } else {
    face = (
      <div className="gm-library-tile-text">
        <div style={{ width: '100%' }}>
          <span className="gm-library-body gm-library-body--emphasized gm-library-clamp-3">{title}</span>
        </div>
        <Icon name={mediaTypeIcon(item.kind)} size={24} />
      </div>
    );
  }

  return (
    <div
      className="gm-library-tile"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false); }}
    >
      <button type="button" aria-label={`Preview or open ${title}`} className="gm-library-tile-card gm-library-press" onClick={onOpen}>
        {face}
        {showBadge && <span className="gm-library-badge"><Icon name={badge} size={24} /></span>}
      </button>
      {(hovered || focusWithin) && (
        <div className="gm-library-tile-delete">
          <IconButton icon="delete" label="Delete" variant="translucent" onClick={(event) => { event.stopPropagation(); onDelete(); }} />
        </div>
      )}
      <div className="gm-library-tile-more">
        <IconButton icon="more_vert" label="More options" variant="translucent" tooltip={false} onClick={(event) => { event.stopPropagation(); onMore(); }} />
      </div>
    </div>
  );
};

/** The next page's placeholders: square skeletons, 5 from 769px and 3 below. */
export const SkeletonTiles: React.FC<{ count: number }> = ({ count }) => (
  <div className="gm-library-grid" aria-hidden="true">
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className="gm-library-tile-loading" style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden' }}>
        <span className="gm-library-skeleton gm-library-skeleton--square" />
      </div>
    ))}
  </div>
);
