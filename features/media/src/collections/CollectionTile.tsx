// A collection in the gallery: Flow's `flow-collection-tile`.
//
// At rest it shows the first of its items (or Flow's grey gradient while it is empty) under the
// name in 36px Google Sans, with a count per kind in the corner. Hovering brings up the hotbar and
// steps through its first three distinct items every 1800ms, crossfading through a blur; it holds
// whichever one it reached when the pointer leaves. During a drag it is a drop target: dimmed like every
// other tile until the pointer is on it, then lit with Flow's ring.
import React from 'react';
import { motion } from 'framer-motion';
import { FlowIcon, FlowMatDivider, FlowMatMenu, FlowMatMenuItem, FlowRenameOverlay, type MenuAnchor } from '../scenes/flow-ui';
import type { MediaItem } from '../types';
import { useVideoStill } from '../video-still';
import { useLongPress } from '../use-long-press';
import { TouchMoreButton } from '../TouchMoreButton';
import type { Collection } from './collection-store';
import './collections.css';

const SLIDE_MS = 1800;
const SLOTS = 3;

/** A video in a cover slot never plays, so it is the still of its first frame and loads nothing. */
const CoverVideo: React.FC<{ item: MediaItem; className: string }> = ({ item, className }) => {
  const still = useVideoStill(item.url);
  return (
    <video
      className={className}
      src={still === null ? item.url : undefined}
      poster={still || undefined}
      muted
      playsInline
      preload={still === null ? 'auto' : 'none'}
      aria-hidden="true"
    />
  );
};

export const CollectionTile = React.memo(({
  collection,
  tileId,
  items,
  ar,
  finalWidth,
  finalHeight,
  isLastRow,
  layoutDuration,
  dragDimmed,
  dropTarget,
  isSelected = false,
  selectionDimmed = false,
  onPress,
  onSelectionMenu,
  onOpen,
  onToggleFavorite,
  onRename,
  onDownload,
  onTrash,
}: {
  collection: Collection;
  /** Its id in the gallery's grid, selection and drag (`collection:<id>`). */
  tileId: string;
  /** What is in it — and in every collection inside it — in gallery order. */
  items: MediaItem[];
  ar: number;
  finalWidth: number;
  finalHeight: number;
  isLastRow: boolean;
  layoutDuration: number;
  dragDimmed: boolean;
  dropTarget: boolean;
  isSelected?: boolean;
  /** Dimmed by a selection it isn't in, as the gallery's other tiles are. */
  selectionDimmed?: boolean;
  /** A press that may become a drag; the gallery's drag system takes it from there. */
  onPress?: (collection: Collection, e: React.MouseEvent) => void;
  /** Set while the tile is part of a selection: its right-click opens the selection's menu instead. */
  onSelectionMenu?: (x: number, y: number) => void;
  onOpen: (collection: Collection) => void;
  onToggleFavorite: (collection: Collection) => void;
  onRename: (collection: Collection, name: string) => void;
  onDownload: (collection: Collection) => void;
  onTrash: (collection: Collection) => void;
}) => {
  const [hover, setHover] = React.useState(false);
  const [menu, setMenu] = React.useState<MenuAnchor | null>(null);
  const [renaming, setRenaming] = React.useState<DOMRect | null>(null);
  const [active, setActive] = React.useState(0);
  const tileRef = React.useRef<HTMLDivElement>(null);
  const moreRef = React.useRef<HTMLButtonElement>(null);

  // Flow fills all three slots, repeating the last item when there are fewer than three, and its
  // slideshow steps only through the distinct ones: a single item never moves (so never blurs),
  // two alternate.
  const covers = React.useMemo(() => items.filter((i) => i.url && i.status === 'completed' && i.kind !== 'audio').slice(0, SLOTS), [items]);
  const slots = covers.length ? Array.from({ length: SLOTS }, (_, i) => covers[Math.min(i, covers.length - 1)]) : [];
  const shown = Math.min(active, Math.max(0, covers.length - 1));
  const images = items.filter((i) => i.kind === 'image').length;
  const videos = items.filter((i) => i.kind === 'video').length;
  const sounds = items.filter((i) => i.kind === 'audio').length;

  React.useEffect(() => {
    if (!hover || covers.length < 2) return undefined;
    const timer = window.setInterval(() => setActive((a) => (Math.min(a, covers.length - 1) + 1) % covers.length), SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [hover, covers.length]);

  const openMenuBelow = () => {
    if (moreRef.current) setMenu({ kind: 'below', rect: moreRef.current.getBoundingClientRect() });
  };
  const openContextMenu = (x: number, y: number) => {
    if (onSelectionMenu) onSelectionMenu(x, y);
    else setMenu({ kind: 'point', x, y });
  };
  // A touch screen's right-click.
  const hold = useLongPress(openContextMenu);

  return (
    <motion.div
      ref={tileRef}
      layout
      transition={{ duration: layoutDuration, ease: [0.16, 1, 0.3, 1] }}
      style={{ flexGrow: isLastRow ? 0 : ar, flexBasis: `${finalWidth}px`, height: `${finalHeight}px` }}
      className={`gallery-tile relative rounded-[16px] ${menu ? 'overflow-visible z-40' : 'z-10'}`}
      aria-label={collection.name}
      data-id={tileId}
      data-drop-collection={collection.id}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={(e) => { if (!renaming && !menu) onPress?.(collection, e); }}
      onClick={() => { if (!renaming) onOpen(collection); }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        hold.cancel();
        if (hold.justFired()) return;
        openContextMenu(e.clientX, e.clientY);
      }}
      {...hold.handlers}
    >
      <div className={`ct-container${hover ? ' is-hover' : ''}${menu ? ' is-menu-open' : ''}${dragDimmed && !dropTarget ? ' is-dimmed' : ''}${dropTarget ? ' is-drop-target' : ''}`}>
        <div className="ct-preview">
          {slots.map((item, i) => (item.kind === 'video' ? (
            <CoverVideo key={`${item.id}-${i}`} item={item} className={`ct-thumb${i === shown ? ' is-active' : ''}`} />
          ) : (
            <img
              key={`${item.id}-${i}`}
              className={`ct-thumb${i === shown ? ' is-active' : ''}`}
              src={item.url}
              draggable={false}
              alt="A piece of media generated or uploaded by you, that is present in your collection."
            />
          )))}
        </div>
        <div className="ct-title">
          <span className="ct-title-text">{collection.name}</span>
        </div>
        <div className="ct-hover">
          <div className="sb-hotbar-wrap">
            <div className="sb-hotbar" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="sb-hotbar-btn"
                aria-label={collection.favorite ? 'Remove favorite' : 'Favorite'}
                onClick={() => onToggleFavorite(collection)}
              >
                <FlowIcon name="favorite" size={18} fill={!!collection.favorite} />
              </button>
              <button
                ref={moreRef}
                type="button"
                className="sb-hotbar-btn"
                aria-label="More options"
                aria-expanded={!!menu}
                onClick={() => (menu ? setMenu(null) : openMenuBelow())}
              >
                <FlowIcon name="more_vert" size={18} />
              </button>
            </div>
          </div>
        </div>
        {(images > 0 || videos > 0 || sounds > 0) && (
          <div className="ct-counts">
            {images > 0 && <div className="ct-count-row"><FlowIcon name="image" size={16} />{` ${images} `}</div>}
            {videos > 0 && <div className="ct-count-row"><FlowIcon name="videocam" size={16} />{` ${videos} `}</div>}
            {sounds > 0 && <div className="ct-count-row"><FlowIcon name="music_note" size={16} />{` ${sounds} `}</div>}
          </div>
        )}
      </div>

      {/* The selection's dimming and ring, the gallery tile's own (GalleryTile.tsx). */}
      <div className={`absolute inset-0 bg-black/55 rounded-[16px] z-[35] pointer-events-none transition-opacity duration-[400ms] ${selectionDimmed ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`absolute inset-0 rounded-[16px] pointer-events-none z-[38] transition-opacity duration-300 ease-in-out ${isSelected ? 'opacity-100' : 'opacity-0'}`}
        style={{ border: '2.2px solid white' }}
      />

      <TouchMoreButton
        corner="top"
        open={!!menu}
        hidden={!!renaming}
        onToggle={(rect) => setMenu(menu ? null : { kind: 'below', rect })}
      />

      <FlowRenameOverlay
        open={!!renaming}
        anchor={renaming}
        value={collection.name}
        onCommit={(name) => onRename(collection, name)}
        onClose={() => setRenaming(null)}
      />

      <FlowMatMenu open={!!menu} onClose={() => setMenu(null)} anchor={menu} ignoreRefs={[moreRef]}>
        <FlowMatMenuItem icon="favorite" iconFill={!!collection.favorite} label="Favorite" onSelect={() => onToggleFavorite(collection)} />
        <FlowMatMenuItem icon="download" label="Download collection" disabled={items.length === 0} onSelect={() => onDownload(collection)} />
        <FlowMatDivider />
        <FlowMatMenuItem icon="edit" label="Rename" onSelect={() => setRenaming(tileRef.current?.getBoundingClientRect() ?? null)} />
        <FlowMatDivider />
        <FlowMatMenuItem icon="delete" label="Move all contents to trash" danger onSelect={() => onTrash(collection)} />
      </FlowMatMenu>
    </motion.div>
  );
});
CollectionTile.displayName = 'CollectionTile';
