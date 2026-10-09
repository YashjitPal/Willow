// One tile in the media gallery, and the pieces only a tile needs.
//
// GalleryTile is the memoized shell (framer-motion wrapper + overlays);
// TileContent is the interior that renders the image/video/audio and its hover
// menu. They are split because the shell re-renders on layout changes while the
// interior should not.
//
// TileContent and useDisplayVideoSrc are deliberately NOT exported — nothing
// outside this file referenced them when it was extracted from MediaView.tsx,
// and keeping them private is what lets these components be reasoned about as a
// unit. Export them only if a second caller genuinely appears.

import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  Undo2,
  RotateCcw,
  Trash2,
  Check,
} from 'lucide-react';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { ImagesIcon, VideoIcon } from './media-icons';
import { Tooltip } from '@willow/ui/Tooltip';
import { FlowIcon, FlowMatDivider, FlowMatMenu, FlowMatMenuItem, type MenuAnchor } from './scenes/flow-ui';
import { AddToSceneSubmenu } from './scenes/AddToSceneSubmenu';
import { DownloadOptions } from './editor/editor-overlays';
import { useVideoStill } from './video-still';
import { useLongPress } from './use-long-press';
import { TouchMoreButton } from './TouchMoreButton';
import './gallery-tile.css';
import type { MediaItem, MediaKind } from './types';

/**
 * How long the reveal runs, start to finish. Must match the longest chain in
 * `gallery-tile.css` — the overlay exit, at 1192.5ms delay + 1500ms — because it is what
 * decides when the tile drops the generating layers and settles.
 */
const REVEAL_DURATION_MS = 2692.5;
const ERROR_REVEAL_HOLD_MS = 2500;

// Videos are stored durably as base64 data URLs (so they survive reload), but a
// large base64 string is slow to load in a <video> element — it can't stream and
// must decode the whole payload first, leaving the tile black for a while. This
// converts a data:video URL to a streaming blob: URL for display only (the stored
// base64 is untouched). Other URLs (blob:, http) pass through unchanged.
const useDisplayVideoSrc = (src?: string): string | undefined => {
  const isDataVideo = !!src && src.startsWith('data:video');
  const [resolved, setResolved] = React.useState<string | undefined>(isDataVideo ? undefined : src);
  React.useEffect(() => {
    if (!src || !src.startsWith('data:video')) { setResolved(src); return; }
    let cancelled = false;
    let objUrl: string | null = null;
    setResolved(undefined);
    fetch(src)
      .then(r => r.blob())
      .then(blob => {
        if (cancelled) return;
        objUrl = URL.createObjectURL(blob);
        setResolved(objUrl);
      })
      .catch(() => { if (!cancelled) setResolved(src); });
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [src]);
  return resolved;
};

const MediaVideo = React.forwardRef<HTMLVideoElement, React.VideoHTMLAttributes<HTMLVideoElement>>(
  ({ src, ...rest }, ref) => {
    const displaySrc = useDisplayVideoSrc(src);
    return <video ref={ref} src={displaySrc} {...rest} />;
  }
);
MediaVideo.displayName = 'MediaVideo';

/*
 * The pieces of a tile the agent sidebar shares, so its preview of a generation is the same
 * surface the canvas draws rather than an approximation. Moved out of TileContent verbatim;
 * the generating liquid itself is still Flow's and still left alone (see AGENTS.md).
 */
export function useGenerationProgress(item: MediaItem): number {
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    if (item.status !== 'generating') return;
    
    const getEstimatedDuration = (modelId: string, kind: MediaKind) => {
      if (modelId === 'upload') return 1500;
      if (kind === 'image') {
        if (modelId === 'gemini-3-pro-image' || modelId === 'gemini-3-pro-image-preview') return 7000;
        return 5000;
      } else {
        if (modelId === 'veo-3.1-fast') return 25000;
        if (modelId === 'veo-3.1') return 55000;
        if (modelId === 'veo-3.1-lite') return 30000;
        if (modelId === 'omni-flash') return 18000;
        if (modelId === 'omni-flash-1.1') return 18000;
        return 35000;
      }
    };

    const duration = getEstimatedDuration(item.modelId || '', item.kind);
    const startTime = item.timestamp || Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(99, Math.floor((elapsed / duration) * 100));
      setProgress(pct);
    }, 200);

    return () => clearInterval(interval);
  }, [item.status, item.timestamp, item.modelId, item.kind]);

  return progress;
}

function useTileReveal(item: MediaItem) {
  const [isImageReady, setIsImageReady] = React.useState(false);

  React.useEffect(() => {
    if (item.status === 'completed' && item.url) {
      if (item.kind === 'video') {
        setIsImageReady(true);
      } else {
        const img = new window.Image();
        img.src = item.url;
        img.onload = () => setIsImageReady(true);
        img.onerror = () => setIsImageReady(true);
      }
    } else if (item.status === 'generating') {
      setIsImageReady(false);
    }
  }, [item.status, item.url, item.kind]);

  const mediaReady = item.status === 'completed' && !!item.url && isImageReady;
  const outcomeReady = mediaReady || item.status === 'failed';

  /*
   * A tile that was already complete or failed when it mounted — restored from storage,
   * or scrolled back into view — starts settled. Without that, every terminal tile in
   * the gallery would play the reveal on page load.
   */
  const [revealPhase, setRevealPhase] = React.useState<'loading' | 'revealing' | 'settled'>(
    () => (
      (item.status === 'completed' && item.url) || item.status === 'failed'
        ? 'settled'
        : 'loading'
    )
  );

  /* Successful media reveals as soon as it is decoded. A fresh error deliberately
   * holds on the generating liquid first, so a fast provider rejection does not flash
   * abruptly into the failure card. */
  React.useLayoutEffect(() => {
    if (revealPhase !== 'loading' || !outcomeReady) return;

    if (item.status !== 'failed') {
      setRevealPhase('revealing');
      return;
    }

    const timer = setTimeout(() => setRevealPhase('revealing'), ERROR_REVEAL_HOLD_MS);
    return () => clearTimeout(timer);
  }, [revealPhase, outcomeReady, item.status]);

  React.useEffect(() => {
    if (revealPhase !== 'revealing') return;
    const timer = setTimeout(() => setRevealPhase('settled'), REVEAL_DURATION_MS);
    return () => clearTimeout(timer);
  }, [revealPhase]);

  const isRevealing = revealPhase === 'revealing';
  /*
   * Keyed off revealPhase alone, deliberately.
   *
   * Deriving this from isImageReady as well left exactly one commit — after the preload
   * resolved but before the phase effect had run — in which `isImageReady` was true while
   * the phase was still `loading`. In that commit the overlay's condition was false and
   * the image's was too, so the tile unmounted both layers and painted its bare #0c0c0c
   * background. Measured off a real generation, that was a full-tile black flash: 100% of
   * the tile's pixels at luminance 12 for ~150ms. Gating both layers on the same phase
   * value means there is no state in which neither is mounted.
   */
  const showGeneratingOverlay = revealPhase !== 'settled';
  // The finished media mounts with the reveal, not before, so the glass fades it in from zero.
  const showMedia = item.status === 'completed' && !!item.url && revealPhase !== 'loading';

  return { revealPhase, isRevealing, showGeneratingOverlay, showMedia };
}

/** The drifting liquid behind a generating tile. `children` is the chrome drawn over it. */
export function GeneratingLayers({ isRevealing, children }: { isRevealing: boolean; children?: React.ReactNode }) {
  return (
      <div
        className={`mesh-container-generating ${isRevealing ? 'mesh-container-generating--revealing' : ''}`}
        style={{ zIndex: 50, pointerEvents: 'none' }}
      >
        <div
          className={`absolute inset-0 z-10 overflow-hidden rounded-[16px] opacity-100 pointer-events-none ${isRevealing ? 'mesh-noise--revealing' : ''}`}
          style={{ filter: 'brightness(1) contrast(1)', mixBlendMode: 'luminosity' }}
        >
          <div className="absolute inset-0 bg-black" style={{ filter: 'blur(12px) contrast(0.9)' }}>
            <div 
              className="absolute inset-0 bg-transparent mix-blend-normal origin-center"
              style={{
                backgroundImage: 'url("https://labs.google/fx/images/perlin.png")',
                backgroundRepeat: 'repeat',
                backgroundSize: '100%',
                backgroundPosition: '0% 50%',
                animation: 'flow-perlin-1 9s linear infinite',
                filter: 'contrast(1.5)',
                transform: 'scale(3.5)',
                opacity: 1
              }}
            />
            <div 
              className="absolute inset-0 bg-transparent mix-blend-multiply origin-center"
              style={{
                backgroundImage: 'url("https://labs.google/fx/images/perlin.png")',
                backgroundRepeat: 'repeat',
                backgroundSize: '100%',
                backgroundPosition: '0% 50%',
                animation: 'flow-perlin-2 6s linear infinite',
                filter: 'contrast(1.5)',
                transform: 'scale(2)',
                opacity: 1
              }}
            />
          </div>
        </div>
        
        <style dangerouslySetInnerHTML={{ __html: `
        .mesh-container-generating {
          position: absolute;
          inset: 0;
          border-radius: 16px;
          background-color: #5F6368; 
          overflow: hidden;
          container-type: inline-size;
        }
        
        @keyframes flow-perlin-1 {
          0% { background-position: 100cqw center; }
          100% { background-position: 0px center; } 
        }
        
        @keyframes flow-perlin-2 {
          0% { background-position: 0% center; }
          100% { background-position: 100cqw center; }
        }
      `}} />

        {children}
      </div>
  );
}

/*
 * One gallery item drawn the way its canvas tile draws it — the same generating liquid,
 * reveal and failure card — without the tile's toolbar, menus or drag handling. The agent
 * sidebar renders one inside each of its media cards. `item` is undefined for the moment
 * between a generation being announced and its tile reaching the gallery.
 */
export function MediaTilePreview({ item }: { item?: MediaItem }) {
  if (!item) {
    return (
      <span className="absolute inset-0 block overflow-hidden bg-[#0c0c0c]">
        <GeneratingLayers isRevealing={false} />
      </span>
    );
  }
  return <MediaTilePreviewContent item={item} />;
}

function MediaTilePreviewContent({ item }: { item: MediaItem }) {
  const { revealPhase, isRevealing, showGeneratingOverlay, showMedia } = useTileReveal(item);
  const progress = useGenerationProgress(item);
  const glassClass = `gallery-tile-glass ${isRevealing ? 'gallery-tile-glass--revealing' : 'gallery-tile-glass--settled'}`;
  const mediaClass = `w-full h-full object-cover rounded-[16px] ${isRevealing ? 'gallery-tile-image--revealing' : ''}`;

  // A video behaves as on its canvas tile: a still until first hovered, then playing only while
  // hovered and paused where it was left. One that lands while shown loads at once, for the reveal.
  const isVideo = item.kind === 'video';
  const [hovered, setHovered] = React.useState(false);
  const [videoLoaded, setVideoLoaded] = React.useState(() => item.status === 'generating');
  const still = useVideoStill(isVideo && !videoLoaded ? item.url : undefined);
  const holdVideo = isVideo && !videoLoaded && still !== null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoveredRef = useRef(hovered);
  hoveredRef.current = hovered;
  React.useEffect(() => {
    if (hovered && isVideo) setVideoLoaded(true);
  }, [hovered, isVideo]);
  React.useEffect(() => {
    const video = videoRef.current;
    if (!isVideo || !video) return;
    if (hovered) video.play().catch(() => {});
    else video.pause();
  }, [hovered, isVideo]);

  return (
    <span
      className="absolute inset-0 block overflow-hidden bg-[#0c0c0c]"
      onMouseEnter={isVideo ? () => setHovered(true) : undefined}
      onMouseLeave={isVideo ? () => setHovered(false) : undefined}
    >
      {showGeneratingOverlay && (
        <GeneratingLayers isRevealing={isRevealing}>
          <div className={`absolute inset-0 z-30 pointer-events-none ${isRevealing ? 'mesh-chrome--revealing' : ''}`}>
            <div className="absolute top-3 left-3 select-none">
              {item.kind === 'video' ? (
                <VideoIcon size={16} className="text-zinc-400 shrink-0" />
              ) : (
                <ImagesIcon size={16} className="text-zinc-400 shrink-0" />
              )}
            </div>
            <div className="absolute top-3 right-3 select-none">
              <span className="text-[12px] font-normal text-zinc-400 leading-none">{progress}%</span>
            </div>
          </div>
        </GeneratingLayers>
      )}

      {showMedia && (
        <div className={glassClass}>
          {isVideo ? (
            <MediaVideo
              ref={videoRef}
              src={holdVideo ? undefined : item.url}
              poster={still || undefined}
              preload={holdVideo ? 'none' : undefined}
              // The first hover sets the source a render after it asks to play.
              onCanPlay={() => { if (hoveredRef.current) videoRef.current?.play().catch(() => {}); }}
              loop
              muted
              playsInline
              className={mediaClass}
              draggable={false}
            />
          ) : (
            <img src={item.url} alt={item.shortenedPrompt || item.prompt} className={mediaClass} draggable={false} />
          )}
        </div>
      )}

      {item.status === 'failed' && revealPhase !== 'loading' && (
        <div className={glassClass}>
          <div className={`absolute inset-0 ${isRevealing ? 'gallery-tile-image--revealing' : ''}`}>
            <div className="absolute inset-0 flex flex-col items-start p-3 bg-gradient-to-b from-[#232323] to-[#171717] rounded-[16px] text-left">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" className="text-zinc-200 shrink-0">
                <path d="M12 2 L22 21 H2 Z" />
                <line x1="12" y1="8" x2="12" y2="14" />
                <line x1="12" y1="17.5" x2="12" y2="18" strokeWidth="2.5" />
              </svg>
              <span className="text-[12px] font-semibold text-zinc-200 mt-1.5 leading-none">Failed</span>
              <span className="text-[11.5px] font-normal text-zinc-300 mt-1 leading-relaxed line-clamp-4 max-w-full break-words">
                {item.error || 'This media could not be generated.'}
              </span>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

const TileContent = React.memo(({
  item,
  isMenuOpen,
  onMenuOpenChange: onMenuOpenChangeProp,
  isHovered,
  onCancel,
  onRefresh,
  onRePrompt,
  onDelete,
  onRename,
  isRenaming,
  setIsRenaming,
  onAddToPrompt,
  onAnimate,
  projectName = 'Default',
  onSetAsCover,
  onToggleFavorite,
  onShare,
  onFlag,
  onSetCollectionCover,
  onMoveOutOfCollection,
  onSelectionMenu,
  hasHistory = false,
}: { 
  item: MediaItem; 
  isMenuOpen: boolean; 
  onMenuOpenChange: (open: boolean, isContext?: boolean) => void; 
  isHovered: boolean;
  onCancel?: (id: string) => void;
  onRefresh?: (item: MediaItem) => void;
  onRePrompt?: (item: MediaItem) => void;
  onDelete?: (id: string) => void;
  onRename?: (id: string, newName: string) => void;
  isRenaming?: boolean;
  setIsRenaming?: (renaming: boolean) => void;
  onAddToPrompt?: (item: MediaItem) => void;
  onAnimate?: (item: MediaItem) => void;
  projectName?: string;
  onSetAsCover?: (url: string, isVideo?: boolean) => void;
  onToggleFavorite?: (id: string) => void;
  onShare?: (item: MediaItem) => void;
  onFlag?: (item: MediaItem) => void;
  /** Set inside a collection only, like the next one. */
  onSetCollectionCover?: (item: MediaItem) => void;
  onMoveOutOfCollection?: (id: string) => void;
  /** Set while the tile is part of a selection: its right-click opens the selection's menu instead. */
  onSelectionMenu?: (x: number, y: number) => void;
  /** Other versions exist (an edit history): Flow's `stacks` badge. */
  hasHistory?: boolean;
}) => {
  /** Made by a model. Only such an item has a prompt to reuse, sizes to upscale to, and an output to share or flag. */
  const generated = item.modelId !== 'upload' && item.modelId !== 'crop' && item.modelId !== 'external' && !!item.prompt;
  const menuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  /** The touch screens' lasting three dots, and whether the open menu came from them. */
  const touchMoreRef = useRef<HTMLButtonElement>(null);
  const openedFromTouchMore = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { isLocalFolderConnected, isLocalFolderAuthorized, authorizeLocalFolder, saveLocalFSMedia, refreshLocalMedia } = useLocalFS();

  const [renameValue, setRenameValue] = React.useState(item.shortenedPrompt || item.prompt);
  const [boxPosition, setBoxPosition] = React.useState<'bottom' | 'top'>('bottom');
  const [contextMenuCoords, setContextMenuCoords] = React.useState<{ x: number; y: number } | null>(null);

  const onMenuOpenChange = (open: boolean, isContext?: boolean) => {
    onMenuOpenChangeProp(open, isContext);
  };

  // Flow opens a tile's context menu with its corner exactly at the pointer.
  const openContextMenu = (x: number, y: number) => {
    if (onSelectionMenu) { onSelectionMenu(x, y); return; }
    setContextMenuCoords({ x, y });
    onMenuOpenChange(true, true);
  };
  // A touch screen's right-click: a long press (use-long-press.ts).
  const longPress = useLongPress(openContextMenu);
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    longPress.cancel();
    if (longPress.justFired()) return;
    openContextMenu(e.clientX, e.clientY);
  };

  React.useEffect(() => {
    if (!isMenuOpen) {
      setContextMenuCoords(null);
      openedFromTouchMore.current = false;
    }
  }, [isMenuOpen]);

  React.useLayoutEffect(() => {
    if (isRenaming && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      
      // If the bottom of the card is within 160px of the viewport bottom, position it at the top
      if (viewportHeight - rect.bottom < 160) {
        setBoxPosition('top');
      } else {
        setBoxPosition('bottom');
      }
    }
  }, [isRenaming]);

  React.useEffect(() => {
    if (!isRenaming) {
      setRenameValue(item.shortenedPrompt || item.prompt);
    }
  }, [item.shortenedPrompt, item.prompt, isRenaming]);

  const handleSave = () => {
    if (onRename && renameValue.trim()) {
      onRename(item.id, renameValue.trim());
    }
    if (setIsRenaming) {
      setIsRenaming(false);
    }
  };

  const handleCancel = () => {
    if (setIsRenaming) {
      setIsRenaming(false);
    }
    setRenameValue(item.shortenedPrompt || item.prompt);
  };

  const progress = useGenerationProgress(item);

  // Flow loads a tile's video on its first hover and keeps it loaded after, paused where it was
  // left; until then the tile is a still of the first frame (video-still.ts) and loads nothing.
  // A tile that mounts while generating loads its video the moment it lands, for the reveal.
  const [videoLoaded, setVideoLoaded] = React.useState(() => item.status === 'generating');
  const still = useVideoStill(item.kind === 'video' && !videoLoaded ? item.url : undefined);
  const holdVideo = item.kind === 'video' && !videoLoaded && still !== null;
  const hoveredRef = useRef(isHovered);
  hoveredRef.current = isHovered;
  React.useEffect(() => {
    if (isHovered && item.kind === 'video') setVideoLoaded(true);
  }, [isHovered, item.kind]);

  React.useEffect(() => {
    if (item.kind !== 'video' || !videoRef.current) return;
    const video = videoRef.current;
    if (isHovered) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isHovered, item.kind]);

  // The menu is Flow's mat-menu (`scenes/flow-ui`): it places, animates and dismisses itself.
  // This only closes it when the gallery scrolls out from under it.
  React.useEffect(() => {
    if (!isMenuOpen) return undefined;
    const onScroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-sb-menu]')) return;
      onMenuOpenChange(false);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, [isMenuOpen, onMenuOpenChange]);

  const [menuAnchor, setMenuAnchor] = React.useState<MenuAnchor | null>(null);
  React.useLayoutEffect(() => {
    if (!isMenuOpen) return;
    const trigger = openedFromTouchMore.current ? touchMoreRef.current : moreButtonRef.current;
    if (contextMenuCoords) setMenuAnchor({ kind: 'point', x: contextMenuCoords.x, y: contextMenuCoords.y });
    else if (trigger) setMenuAnchor({ kind: 'below', rect: trigger.getBoundingClientRect() });
  }, [isMenuOpen, contextMenuCoords]);

  /*
   * Flow's current tile menu (flow.google.com, Angular Material) in its own order: Favorite and
   * Reuse prompt; Add to scene for a video, Animate for an image; the action cluster; the cover;
   * Flag output; the destructive rows. An item no model made (an upload, a saved frame) has no
   * Reuse prompt, Share or Flag output, and downloads at once instead of offering sizes. Inside a
   * collection the cover row asks which cover, and Move out of collection joins Move to trash.
   * Flow's Publish to YouTube has no Willow counterpart and is left out rather than shown dead.
   * The menu closes itself after a row runs.
   */
  const downloadItem = async () => {
    if (item.url) {
      const name = item.shortenedPrompt || item.prompt;
      const ext = item.kind === 'video' ? 'mp4' : 'png';
      const cleanName = name.replace(/[\/:*?"<>|]/g, '').trim() || 'media';
      const filename = `${cleanName}.${ext}`;
      try {
        const response = await fetch(item.url);
        const blob = await response.blob();
        if (isLocalFolderConnected && !isLocalFolderAuthorized) {
          // Prompt for folder access while we're in a user gesture; the
          // auto-sync backfill effect then persists any unsaved items
          // (recording fsName). Do NOT also save directly here — an
          // already-saved item would get a second "name (1).png" on disk,
          // which the reconciler ingests as a phantom duplicate tile.
          await authorizeLocalFolder();
        }
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch (err) {
        const a = document.createElement('a');
        a.href = item.url;
        a.download = filename;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }
  };

  const copyItem = async () => {
    if (item.url) {
      if (item.kind === 'video') {
        if (!item.url.startsWith('data:')) {
          await navigator.clipboard.writeText(item.url);
        }
        return;
      }

      try {
        // To copy any image to clipboard reliably across all browsers,
        // we load it into an Image, paint it to canvas, and write as 'image/png'.
        // This bypasses browser restrictions on copying raw JPEG/WebP or base64 data strings.
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0);
              canvas.toBlob(async (pngBlob) => {
                if (pngBlob) {
                  try {
                    await navigator.clipboard.write([
                      new ClipboardItem({
                        'image/png': pngBlob
                      })
                    ]);
                  } catch (err) {
                    if (!item.url.startsWith('data:')) {
                      await navigator.clipboard.writeText(item.url);
                    }
                  }
                }
              }, 'image/png');
            }
          } catch (err) {
            if (!item.url.startsWith('data:')) {
              navigator.clipboard.writeText(item.url).catch(() => {});
            }
          }
        };
        img.onerror = () => {
          if (!item.url.startsWith('data:')) {
            navigator.clipboard.writeText(item.url).catch(() => {});
          }
        };
        img.src = item.url;
      } catch (err) {
        if (!item.url.startsWith('data:')) {
          await navigator.clipboard.writeText(item.url);
        }
      }
    }
  };

  const dropdownContent = (
    <>
      <FlowMatMenuItem icon="favorite" iconFill={!!item.favorite} label="Favorite" onSelect={() => onToggleFavorite?.(item.id)} />
      {generated && <FlowMatMenuItem icon="keyboard_return" label="Reuse prompt" onSelect={() => onRePrompt?.(item)} />}
      <FlowMatDivider />
      {item.kind === 'video' ? (
        <FlowMatMenuItem
          icon="play_movies"
          label="Add to scene"
          disabled={item.status !== 'completed' || !item.url}
          submenu={<AddToSceneSubmenu item={{ id: item.id, url: item.url, ratio: item.ratio }} />}
        />
      ) : (
        <FlowMatMenuItem icon="motion_blur" label="Animate" onSelect={() => onAnimate?.(item)} />
      )}
      <FlowMatDivider />
      <FlowMatMenuItem icon="add_2" label="Add to prompt" onSelect={() => onAddToPrompt?.(item)} />
      {generated && item.status === 'completed' && item.url ? (
        <FlowMatMenuItem icon="download" label="Download" submenu={<DownloadOptions item={item} />} />
      ) : (
        <FlowMatMenuItem icon="download" label="Download" onSelect={() => { void downloadItem(); }} />
      )}
      <FlowMatMenuItem icon="content_copy" label="Copy" onSelect={() => { void copyItem(); }} />
      <FlowMatMenuItem icon="edit" label="Rename" onSelect={() => setIsRenaming?.(true)} />
      {generated && <FlowMatMenuItem icon="share" label="Share" onSelect={() => onShare?.(item)} />}
      <FlowMatDivider />
      {onSetCollectionCover ? (
        <FlowMatMenuItem
          icon="photo_library"
          label="Set cover image"
          submenu={(
            <>
              <FlowMatMenuItem label="Set project cover" onSelect={() => { if (item.url && onSetAsCover) onSetAsCover(item.url, item.kind === 'video'); }} />
              <FlowMatMenuItem label="Set collection cover" onSelect={() => onSetCollectionCover(item)} />
            </>
          )}
        />
      ) : (
        <FlowMatMenuItem
          icon="photo_library"
          label="Set project cover"
          onSelect={() => { if (item.url && onSetAsCover) onSetAsCover(item.url, item.kind === 'video'); }}
        />
      )}
      {generated && (
        <>
          <FlowMatDivider />
          <FlowMatMenuItem icon="flag" label="Flag output" onSelect={() => onFlag?.(item)} />
        </>
      )}
      <FlowMatDivider />
      {onMoveOutOfCollection && (
        <FlowMatMenuItem icon="drive_file_move_outline" label="Move out of collection" onSelect={() => onMoveOutOfCollection(item.id)} />
      )}
      <FlowMatMenuItem icon="delete" label="Move to trash" danger onSelect={() => onDelete?.(item.id)} />
    </>
  );

  const { revealPhase, isRevealing, showGeneratingOverlay, showMedia } = useTileReveal(item);

  return (
  <>
    {showGeneratingOverlay && (
      <GeneratingLayers isRevealing={isRevealing}>
        {/* Foreground Content */}
        <div className={`absolute inset-0 z-30 pointer-events-none ${isRevealing ? 'mesh-chrome--revealing' : ''}`}>
          <div className="absolute top-4 left-4 pointer-events-none select-none">
            {/* Sized through the prop, not a utility class: these are icon-font glyphs now, and
              * their width/height/font-size are set inline, which outranks `w-[20px]`. */}
            {item.kind === 'image' ? (
              <ImagesIcon size={20} className="text-zinc-400 shrink-0" />
            ) : (
              <VideoIcon size={20} className="text-zinc-400 shrink-0" />
            )}
          </div>

          <div className="absolute top-4 right-4 pointer-events-none select-none">
            <span className="text-[15px] font-normal text-zinc-400 leading-none">
              {progress}%
            </span>
          </div>

          {item.modelId !== 'upload' && (
            <div className="absolute bottom-3.5 left-3.5 right-[60px] flex items-center pointer-events-none min-w-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-out">
              <span className="text-[12px] font-normal text-white/80 truncate max-w-full leading-normal">
                {item.prompt}
              </span>
            </div>
          )}

          {/* Lower Right Re-prompt Button */}
          <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-out pointer-events-none group-hover:pointer-events-auto">
            <div className="bg-white/70 backdrop-blur-[80px] rounded-[11px] p-[2px] shadow-xl">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  if (onRePrompt) onRePrompt(item);
                }}
                className="w-[30px] h-[30px] flex items-center justify-center rounded-[8px] bg-transparent hover:bg-white transition-colors duration-200 outline-none cursor-pointer"
                title="Use prompt again"
              >
                <Undo2 size={18} className="text-[#1a1a1a]" strokeWidth={2.5} style={{ transform: 'scaleY(-1)' }} />
              </button>
            </div>
          </div>
        </div>
      </GeneratingLayers>
    )}
 
    {showMedia && (
      <div
        ref={containerRef}
        className={`gallery-tile-glass ${isRevealing ? 'gallery-tile-glass--revealing' : 'gallery-tile-glass--settled'}`}
        onContextMenu={handleContextMenu}
        {...longPress.handlers}
      >
        {item.kind === 'video' ? (
          <>
            <MediaVideo
              ref={videoRef}
              src={holdVideo ? undefined : item.url}
              poster={still || undefined}
              preload={holdVideo ? 'none' : undefined}
              // The first hover sets the source a render after it asks to play.
              onCanPlay={() => { if (hoveredRef.current) videoRef.current?.play().catch(() => {}); }}
              loop
              muted
              playsInline
              className={`w-full h-full object-cover rounded-[16px] ${isRevealing ? 'gallery-tile-image--revealing' : ''}`}
              draggable={false}
            />
          </>
        ) : (
          <img
            src={item.url}
            alt={item.shortenedPrompt || item.prompt}
            className={`w-full h-full object-cover rounded-[16px] ${isRevealing ? 'gallery-tile-image--revealing' : ''}`}
            draggable="false"
          />
        )}
      </div>
    )}
 
    {item.status === 'failed' && revealPhase !== 'loading' && (
      <div
        className={`gallery-tile-glass ${isRevealing ? 'gallery-tile-glass--revealing' : 'gallery-tile-glass--settled'}`}
      >
        <div className={`absolute inset-0 ${isRevealing ? 'gallery-tile-image--revealing' : ''}`}>
          <div className="absolute inset-0 flex flex-col items-start p-4 bg-gradient-to-b from-[#232323] to-[#171717] rounded-[16px] select-text">
        {/* Steep Sharp Warning Triangle */}
        <svg 
          viewBox="0 0 24 24" 
          width="14" 
          height="14" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="square" 
          strokeLinejoin="miter" 
          className="text-zinc-200 shrink-0"
        >
          <path d="M12 2 L22 21 H2 Z" />
          <line x1="12" y1="8" x2="12" y2="14" />
          <line x1="12" y1="17.5" x2="12" y2="18" strokeWidth="2.5" />
        </svg>

        <h3 className="text-[12px] font-semibold text-zinc-200 mt-1.5 leading-none">Failed</h3>
        <p className="text-[12px] font-normal text-zinc-200 mt-1 leading-relaxed line-clamp-5 max-w-full">
          {item.error ? (
            item.error.includes('policies') ? (
              <>
                {item.error.split('policies')[0]}
                <span className="underline cursor-pointer text-zinc-300 hover:text-white">policies</span>
                {item.error.split('policies')[1]}
              </>
            ) : (
              item.error
            )
          ) : (
            <>
              This prompt might violate our{' '}
              <span className="underline cursor-pointer text-zinc-300 hover:text-white">policies</span>{' '}
              about generating prominent people. Please try a different prompt or send feedback.
            </>
          )}
        </p>

        {/* Lower Right Action Buttons */}
        <div className="absolute bottom-3 right-3 flex items-center gap-[6px] z-30 select-none">
          {/* Refresh/Redo */}
          <div className="bg-white/10 backdrop-blur-[80px] rounded-[11px] p-[2px] shadow-xl">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                if (onRefresh) onRefresh(item);
              }}
              className="w-[30px] h-[30px] flex items-center justify-center rounded-[8px] bg-transparent hover:bg-white/10 transition-colors duration-200 outline-none cursor-pointer"
              title="Retry generation"
            >
              <RotateCcw size={18} className="text-white" strokeWidth={2.5} />
            </button>
          </div>

          {/* Re-prompt */}
          <div className="bg-white/10 backdrop-blur-[80px] rounded-[11px] p-[2px] shadow-xl">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                if (onRePrompt) onRePrompt(item);
              }}
              className="w-[30px] h-[30px] flex items-center justify-center rounded-[8px] bg-transparent hover:bg-white/10 transition-colors duration-200 outline-none cursor-pointer"
              title="Use prompt again"
            >
              <Undo2 size={18} className="text-white" strokeWidth={2.5} style={{ transform: 'scaleY(-1)' }} />
            </button>
          </div>

          {/* Delete */}
          <div className="bg-white/10 backdrop-blur-[80px] rounded-[11px] p-[2px] shadow-xl">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                if (onDelete) onDelete(item.id);
              }}
              className="w-[30px] h-[30px] flex items-center justify-center rounded-[8px] bg-transparent hover:bg-white/10 transition-colors duration-200 outline-none cursor-pointer"
              title="Delete card"
            >
              <Trash2 size={18} className="text-white" strokeWidth={2.5} />
            </button>
          </div>
        </div>
        </div>
      </div>
      </div>
    )}
 
    {showMedia && (
      <>
        {/* Flow's tile chrome (gallery-tile.css): the badges at rest, and on hover the hotbar,
          * with Reuse prompt only where there is a prompt to reuse, and the name footer. */}
        <div className="gt-pre">
          {item.kind === 'video' && (
            <div className="gt-type"><FlowIcon name="play_circle" size={22} fill /></div>
          )}
          {hasHistory && (
            <div className="gt-status"><FlowIcon name="stacks" size={18} /></div>
          )}
        </div>
        <div
          className={`gt-hover${(isMenuOpen && !contextMenuCoords) ? ' is-menu-open' : ''}`}
          style={isRenaming ? { opacity: 0, visibility: 'hidden' } : undefined}
        >
          <div className="sb-hotbar-wrap">
            <div className="sb-hotbar" ref={menuRef} onMouseDown={(e) => e.stopPropagation()}>
              <Tooltip content="Favorite" position="above" className="sb-tooltip">
                <button
                  type="button"
                  className="sb-hotbar-btn"
                  aria-label="Favorite"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onToggleFavorite) onToggleFavorite(item.id);
                  }}
                >
                  <FlowIcon name="favorite" size={18} fill={!!item.favorite} />
                </button>
              </Tooltip>
              {generated && (
                <Tooltip content="Reuse prompt" position="above" className="sb-tooltip">
                  <button
                    type="button"
                    className="sb-hotbar-btn"
                    aria-label="Reuse prompt"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onRePrompt) onRePrompt(item);
                    }}
                  >
                    <FlowIcon name="redo" size={18} style={{ transform: 'rotate(180deg)' }} />
                  </button>
                </Tooltip>
              )}
              <Tooltip content="More" position="above" className="sb-tooltip">
                <button
                  ref={moreButtonRef}
                  type="button"
                  className="sb-hotbar-btn"
                  aria-label="More options"
                  aria-expanded={isMenuOpen && !contextMenuCoords}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMenuOpenChange(!isMenuOpen);
                  }}
                >
                  <FlowIcon name="more_vert" size={18} />
                </button>
              </Tooltip>
            </div>
          </div>
          <div className="gt-footer">
            <div className="gt-footer__left">
              <FlowIcon name={item.kind === 'video' ? 'play_circle' : item.kind === 'audio' ? 'music_note' : 'image'} size={18} />
              <span className="gt-footer__title">{item.shortenedPrompt || item.prompt}</span>
            </div>
          </div>
        </div>
        <TouchMoreButton
          ref={touchMoreRef}
          open={isMenuOpen && !contextMenuCoords}
          hidden={isRenaming}
          onToggle={() => {
            openedFromTouchMore.current = !isMenuOpen;
            onMenuOpenChange(!isMenuOpen);
          }}
        />

        {/* One menu for both ways in, the three-dot button and a right-click, as in Flow. */}
        <FlowMatMenu
          open={isMenuOpen}
          onClose={() => onMenuOpenChange(false)}
          anchor={menuAnchor}
          ignoreRefs={[menuRef]}
        >
          {dropdownContent}
        </FlowMatMenu>
        
        {isRenaming && (
          <div 
            style={{ border: 'none', outline: 'none' }}
            className={`absolute left-1/2 -translate-x-1/2 z-30 bg-[#121214] rounded-[16px] px-4 py-[15px] flex items-center justify-between gap-2 shadow-[0_8px_32px_rgba(0,0,0,0.5)] pointer-events-auto cursor-default w-[78%] ${
              boxPosition === 'top' ? 'top-[-32px]' : 'bottom-[-32px]'
            }`}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  handleSave();
                } else if (e.key === 'Escape') {
                  handleCancel();
                }
              }}
              autoFocus
              style={{ border: 'none', outline: 'none', boxShadow: 'none' }}
              className="bg-transparent border-none outline-none text-white/90 text-[14.5px] font-medium flex-1 min-w-0 py-1 focus:outline-none focus:ring-0 focus:border-none focus-visible:outline-none focus-visible:ring-0"
            />
            <div className="flex items-center gap-2 shrink-0 select-none">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSave();
                }}
                className="w-8 h-8 flex items-center justify-center rounded-[8px] bg-transparent hover:bg-white/10 active:bg-white/20 transition-colors text-white/90 cursor-pointer shrink-0"
                title="Save name"
              >
                <Check size={16} strokeWidth={2.5} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancel();
                }}
                className="w-8 h-8 flex items-center justify-center rounded-[8px] bg-transparent hover:bg-white/10 active:bg-white/20 transition-colors text-white/90 cursor-pointer shrink-0"
                title="Cancel renaming"
              >
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        )}
        
        {!isRenaming && (
          <div className="absolute bottom-0 left-0 right-0 h-[72px] bg-gradient-to-t from-black/45 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 px-5 pb-4 flex items-end pointer-events-none rounded-b-[18px]">
            <div className="flex items-center gap-2.5 w-full min-w-0">
              {item.kind === 'image' ? (
                <ImagesIcon size={17} className="text-white shrink-0" />
              ) : (
                <VideoIcon size={17} className="text-white shrink-0" />
              )}
              <span className="text-[14px] font-normal text-white truncate max-w-full">
                {item.shortenedPrompt || item.prompt}
              </span>
            </div>
          </div>
        )}
      </>
    )}
  </>
  );
});
TileContent.displayName = 'TileContent';

// One gallery tile: the framer-motion wrapper + TileContent + overlays, memoized
// so a hover / prompt keystroke / streaming token only re-renders the tiles whose
// own flags actually changed. All props are primitives or stable callbacks.
// During a sidebar toggle `layoutDuration` changes for every tile, so every tile
// re-renders and participates in the 0.78s FLIP — the animation is untouched.
const GalleryTile = React.memo(({
  item,
  projectName,
  ar,
  finalWidth,
  finalHeight,
  isLastRow,
  layoutDuration,
  isMenuOpen,
  isHovered,
  isRenaming,
  isDragging,
  isSelected,
  dimmed,
  dragDimmed = false,
  hasHistory = false,
  interactionsMuted,
  onTileMouseDown,
  onTileClick,
  onTileMouseEnter,
  onTileMouseLeave,
  onMenuOpenChange,
  onCancel,
  onRefresh,
  onRePrompt,
  onDelete,
  onRename,
  onSetIsRenaming,
  onSetAsCover,
  onAddToPrompt,
  onAnimate,
  onToggleFavorite,
  onShare,
  onFlag,
  onSetCollectionCover,
  onMoveOutOfCollection,
  onSelectionMenu,
}: {
  item: MediaItem;
  projectName: string;
  ar: number;
  finalWidth: number;
  finalHeight: number;
  isLastRow: boolean;
  layoutDuration: number;
  isMenuOpen: boolean;
  isHovered: boolean;
  isRenaming: boolean;
  isDragging: boolean;
  isSelected: boolean;
  dimmed: boolean;
  /** Flow dims every tile a drag doesn't carry (drag/drag.css). */
  dragDimmed?: boolean;
  /** The tile stands for an edit history (Flow's `stacks` badge). */
  hasHistory?: boolean;
  interactionsMuted: boolean;
  onTileMouseDown: (item: MediaItem, e: React.MouseEvent) => void;
  onTileClick: (item: MediaItem) => void;
  onTileMouseEnter: (item: MediaItem) => void;
  onTileMouseLeave: (item: MediaItem) => void;
  onMenuOpenChange: (itemId: string, open: boolean, isContext?: boolean) => void;
  onCancel: (id: string) => void;
  onRefresh: (item: MediaItem) => void;
  onRePrompt: (item: MediaItem) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onSetIsRenaming: (itemId: string, renaming: boolean) => void;
  onSetAsCover: (url: string, isVideo?: boolean) => void;
  onAddToPrompt: (item: MediaItem) => void;
  onAnimate: (item: MediaItem) => void;
  onToggleFavorite: (id: string) => void;
  onShare: (item: MediaItem) => void;
  onFlag: (item: MediaItem) => void;
  /** Given only inside a collection, like the next one. */
  onSetCollectionCover?: (item: MediaItem) => void;
  onMoveOutOfCollection?: (id: string) => void;
  /** Given while the tile is part of a selection (see TileContent). */
  onSelectionMenu?: (x: number, y: number) => void;
}) => {
  const handleMenuOpenChange = React.useCallback(
    (open: boolean, isContext?: boolean) => onMenuOpenChange(item.id, open, isContext),
    [onMenuOpenChange, item.id]
  );
  const handleSetIsRenaming = React.useCallback(
    (renaming: boolean) => onSetIsRenaming(item.id, renaming),
    [onSetIsRenaming, item.id]
  );

  return (
    <motion.div
      layout
      transition={{
        duration: layoutDuration,
        ease: [0.16, 1, 0.3, 1]
      }}
      onMouseDown={(e: React.MouseEvent) => onTileMouseDown(item, e)}
      style={{
        flexGrow: isLastRow ? 0 : ar,
        flexBasis: `${finalWidth}px`,
        height: `${finalHeight}px`,
        cursor: isRenaming ? 'default' : isDragging ? 'grabbing' : 'grab',
      }}
      data-id={item.id}
      className={`gallery-tile dg-tile${dragDimmed ? ' is-drag-dimmed' : ''} relative rounded-[16px] bg-[#0c0c0c] shadow-2xl border-none ${
        interactionsMuted ? '' : 'group'
      } ${
        isRenaming
          ? 'overflow-visible z-50'
          : isMenuOpen
            ? 'overflow-visible z-40'
            : isDragging
              ? 'overflow-visible z-50'
              : isSelected
                ? 'overflow-visible z-[75]'
                : 'overflow-hidden z-10'
      }`}
      onClick={() => onTileClick(item)}
      onMouseEnter={() => onTileMouseEnter(item)}
      onMouseLeave={() => onTileMouseLeave(item)}
    >
      <TileContent
        item={item}
        projectName={projectName}
        isMenuOpen={isMenuOpen}
        onMenuOpenChange={handleMenuOpenChange}
        isHovered={isHovered}
        onCancel={onCancel}
        onRefresh={onRefresh}
        onRePrompt={onRePrompt}
        onDelete={onDelete}
        onRename={onRename}
        isRenaming={isRenaming}
        setIsRenaming={handleSetIsRenaming}
        onSetAsCover={onSetAsCover}
        onAddToPrompt={onAddToPrompt}
        onAnimate={onAnimate}
        onToggleFavorite={onToggleFavorite}
        onShare={onShare}
        onFlag={onFlag}
        onSetCollectionCover={onSetCollectionCover}
        onMoveOutOfCollection={onMoveOutOfCollection}
        onSelectionMenu={onSelectionMenu}
        hasHistory={hasHistory}
      />

      {/* Smooth fading local dark overlay for all other images/videos */}
      <div
        className={`absolute inset-0 bg-black/55 rounded-[16px] z-[35] pointer-events-none transition-opacity duration-[400ms] ${
          dimmed
            ? 'opacity-100'
            : 'opacity-0'
        }`}
      />

      {/* Selection white border overlay to prevent any gap */}
      <div
        className={`absolute inset-0 rounded-[16px] pointer-events-none z-[38] transition-opacity duration-300 ease-in-out ${
          isSelected ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ border: '2.2px solid white' }}
      />
    </motion.div>
  );
});

export { MediaVideo, GalleryTile };
