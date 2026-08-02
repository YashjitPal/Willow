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
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MoreVertical,
  Plus,
  X,
  Heart,
  Undo2,
  RotateCcw,
  Download,
  Edit2,
  Share2,
  Trash2,
  Check,
  Copy,
  Image as ImageIcon,
} from 'lucide-react';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { ImagesIcon, VideoIcon } from './media-icons';
import type { MediaItem, MediaKind } from './types';






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
  onSetAsCover
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
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { isLocalFolderConnected, isLocalFolderAuthorized, authorizeLocalFolder, saveLocalFSMedia, refreshLocalMedia } = useLocalFS();

  const [progress, setProgress] = React.useState(0);
  const [renameValue, setRenameValue] = React.useState(item.shortenedPrompt || item.prompt);
  const [boxPosition, setBoxPosition] = React.useState<'bottom' | 'top'>('bottom');
  const [contextMenuCoords, setContextMenuCoords] = React.useState<{ x: number; y: number } | null>(null);

  const onMenuOpenChange = (open: boolean, isContext?: boolean) => {
    if (!open) {
      if (dropdownRef.current) {
        dropdownRef.current.style.display = 'none';
      }
    }
    onMenuOpenChangeProp(open, isContext);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const clientX = e.clientX;
    const clientY = e.clientY;

    requestAnimationFrame(() => {
      const x = clientX - 4;
      const y = clientY - 4;
      const dropdownWidth = 180;
      const dropdownHeight = 342;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = x;
      if (left + dropdownWidth > viewportWidth - 4) {
        left = viewportWidth - dropdownWidth - 4;
      }
      if (left < 4) left = 4;

      let top = y;
      if (top + dropdownHeight > viewportHeight - 4) {
        top = viewportHeight - dropdownHeight - 4;
        if (top < 4) {
          top = 4;
        }
      }

      setMenuStyle({
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        width: `${dropdownWidth}px`,
        zIndex: 9999,
        transformOrigin: 'top left',
      });

      setContextMenuCoords({ x: clientX, y: clientY });
      onMenuOpenChange(true, true);
    });
  };

  React.useEffect(() => {
    if (!isMenuOpen) {
      setContextMenuCoords(null);
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

  React.useEffect(() => {
    if (item.status !== 'generating') return;
    
    const getEstimatedDuration = (modelId: string, kind: MediaKind) => {
      if (modelId === 'upload') return 1500;
      if (kind === 'image') {
        if (modelId === 'gemini-3-pro-image-preview') return 7000;
        return 5000;
      } else {
        if (modelId === 'veo-3.1-fast') return 25000;
        if (modelId === 'veo-3.1') return 55000;
        if (modelId === 'veo-3.1-lite') return 30000;
        if (modelId === 'omni-flash') return 18000;
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

  React.useEffect(() => {
    if (item.kind !== 'video' || !videoRef.current) return;
    const video = videoRef.current;
    if (isHovered) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isHovered, item.kind]);

  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({
    right: 0,
    top: '100%',
    bottom: 'auto',
    marginTop: '-3px',
    marginBottom: 'auto',
    transformOrigin: 'top right'
  });

  React.useEffect(() => {
    const handleClose = (event: Event) => {
      if (event.type === 'scroll') {
        onMenuOpenChange(false);
        return;
      }
      
      const mouseEvent = event as MouseEvent;
      const clickedOutsideMenu = menuRef.current && !menuRef.current.contains(mouseEvent.target as Node);
      const clickedOutsideDropdown = dropdownRef.current && !dropdownRef.current.contains(mouseEvent.target as Node);
      
      if (clickedOutsideMenu && clickedOutsideDropdown) {
        onMenuOpenChange(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClose, { capture: true });
      document.addEventListener('scroll', handleClose, { capture: true, passive: true });
    }
    return () => {
      document.removeEventListener('mousedown', handleClose, { capture: true });
      document.removeEventListener('scroll', handleClose, { capture: true });
    };
  }, [isMenuOpen, onMenuOpenChange]);

  React.useLayoutEffect(() => {
    if (!isMenuOpen) return;

    if (contextMenuCoords) {
      // Offset slightly northwest (4px left, 4px up) to align closer to the cursor tip
      const x = contextMenuCoords.x - 4;
      const y = contextMenuCoords.y - 4;
      const dropdownWidth = 180;
      const dropdownHeight = 342;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = x;
      if (left + dropdownWidth > viewportWidth - 4) {
        left = viewportWidth - dropdownWidth - 4;
      }
      if (left < 4) left = 4;

      let top = y;
      if (top + dropdownHeight > viewportHeight - 4) {
        // Slide up just enough to fit within the viewport bottom boundary
        top = viewportHeight - dropdownHeight - 4;
        if (top < 4) {
          top = 4; // Cap at viewport top boundary if screen is too small
        }
      }

      setMenuStyle({
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        width: `${dropdownWidth}px`,
        zIndex: 9999,
        transformOrigin: 'top left',
      });
      return;
    }

    if (!menuRef.current) return;

    const updatePosition = () => {
      if (!menuRef.current) return;
      const triggerRect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const dropdownWidth = 180;
      const dropdownHeight = 342; // exact height of the menu with current button padding and dividers

      const centerRightOffset = (dropdownWidth - triggerRect.width) / 2;
      const spaceOnRight = viewportWidth - triggerRect.right;
      let rightOffset = centerRightOffset;
      if (spaceOnRight < centerRightOffset + 12) {
        rightOffset = Math.max(0, spaceOnRight - 12);
      }
      
      const fixedRight = spaceOnRight - rightOffset;

      // Compute actual bottom of dropdown when opening downwards (with 3px overlap/margin)
      const actualDropdownBottom = triggerRect.bottom + dropdownHeight - 3;

      // The only time it should appear up is when there is no space on the screen below
      const openUp = actualDropdownBottom > (viewportHeight - 8);

      setMenuStyle({
        position: 'fixed',
        right: `${fixedRight}px`,
        top: openUp ? 'auto' : `${triggerRect.bottom - 3}px`,
        bottom: openUp ? `${viewportHeight - triggerRect.top - 3}px` : 'auto',
        width: `${dropdownWidth}px`,
        zIndex: 9999,
        transformOrigin: `${openUp ? 'bottom' : 'top'} ${rightOffset === 0 ? 'right' : 'center'}`,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [isMenuOpen, contextMenuCoords]);

  const dropdownContent = (
    <>
      <button 
        onClick={(e) => {
          e.stopPropagation();
          onMenuOpenChange(false);
          if (onAnimate) onAnimate(item);
        }}
        className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100"
      >
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          viewBox="25 0 100 50" 
          className="w-[20px] h-[20px] text-zinc-100" 
          fill="currentColor"
        >
          <defs>
            <mask id="inner-hole" maskUnits="userSpaceOnUse" x="0" y="0" width="150" height="50">
              <rect x="0" y="0" width="150" height="50" fill="white" />
              <circle cx="100" cy="25" r="15" fill="black" />
            </mask>
          </defs>
          <g fill="currentColor" mask="url(#inner-hole)">
            <circle cx="100" cy="25" r="25" />
            <rect x="35" y="0" width="65" height="10" />
            <rect x="25" y="20" width="10" height="10" />
            <rect x="45" y="20" width="55" height="10" />
            <rect x="27" y="40" width="8" height="10" />
            <rect x="45" y="40" width="55" height="10" />
          </g>
        </svg>
        <span>Animate</span>
      </button>
      
      <div className="mx-3.5 h-[1px] bg-white/10 my-1" />
      
      <button 
        onClick={(e) => {
          e.stopPropagation();
          onMenuOpenChange(false);
          if (onAddToPrompt) onAddToPrompt(item);
        }}
        className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100"
      >
        <Plus size={18} strokeWidth={2.5} className="text-zinc-100" />
        <span>Add to prompt</span>
      </button>
      <button 
        onClick={async (e) => {
          e.stopPropagation();
          onMenuOpenChange(false);
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
        }}
        className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100"
      >
        <Download size={18} strokeWidth={2.5} className="text-zinc-100" />
        <span>Download</span>
      </button>
      <button 
        onClick={(e) => {
          e.stopPropagation();
          onMenuOpenChange(false);
          if (setIsRenaming) {
            setIsRenaming(true);
          }
        }}
        className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100"
      >
        <Edit2 size={18} strokeWidth={2.5} className="text-zinc-100" />
        <span>Rename</span>
      </button>
      <button 
        onClick={async (e) => {
          e.stopPropagation();
          onMenuOpenChange(false);
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
        }}
        className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100"
      >
        <Copy size={18} strokeWidth={2.5} className="text-zinc-100" />
        <span>Copy</span>
      </button>
      
      <div className="mx-3.5 h-[1px] bg-white/10 my-1" />
      
      <button className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100">
        <Share2 size={18} strokeWidth={2.5} className="text-zinc-100" />
        <span>Share</span>
      </button>
      
      <div className="mx-3.5 h-[1px] bg-white/10 my-1" />
      
      <button 
        onClick={(e) => {
          e.stopPropagation();
          onMenuOpenChange(false);
          if (item.url && onSetAsCover) {
            onSetAsCover(item.url, item.kind === 'video');
          }
        }}
        className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100"
      >
        <ImageIcon size={18} strokeWidth={2.5} className="text-zinc-100" />
        <span>Set as cover</span>
      </button>
      
      <div className="mx-3.5 h-[1px] bg-white/10 my-1" />
      
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMenuOpenChange(false);
          if (onDelete) onDelete(item.id);
        }}
        className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-[#ff6b6b]"
      >
        <Trash2 size={18} strokeWidth={2.5} className="text-[#ff6b6b]" />
        <span>Move to trash</span>
      </button>
      
      <div className="mx-3.5 h-[1px] bg-white/10 my-1" />
      
      <button className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100">
        <Share2 size={18} strokeWidth={2.5} className="text-zinc-100" />
        <span>Share</span>
      </button>
    </>
  );

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

  const showGeneratingOverlay = item.status === 'generating' || (item.status === 'completed' && !isImageReady);

  return (
  <>
    <AnimatePresence>
      {showGeneratingOverlay && (
        <motion.div 
          className="mesh-container-generating"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, filter: 'blur(12px)' }}
          transition={{ duration: 2.2, ease: [0.16, 1, 0.3, 1] }}
          style={{ zIndex: 50, pointerEvents: 'none' }}>
          <div className="absolute inset-0 z-10 overflow-hidden rounded-[18px] opacity-100 pointer-events-none" style={{ filter: 'brightness(1) contrast(1)', mixBlendMode: 'luminosity' }}>
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
            border-radius: 18px;
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

        {/* Foreground Content */}
        <div className="absolute top-4 left-4 pointer-events-none z-30 select-none">
          {item.kind === 'image' ? (
            <ImagesIcon className="text-zinc-400 w-[20px] h-[20px] shrink-0" />
          ) : (
            <VideoIcon className="text-zinc-400 w-[20px] h-[20px] shrink-0 translate-y-[0.5px]" />
          )}
        </div>

        <div className="absolute top-4 right-4 pointer-events-none z-30 select-none">
          <span className="text-[15px] font-normal text-zinc-400 leading-none">
            {progress}%
          </span>
        </div>

        {item.modelId !== 'upload' && (
          <div className="absolute bottom-3.5 left-3.5 right-[60px] flex items-center pointer-events-none z-30 min-w-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-out">
            <span className="text-[12px] font-normal text-white/80 truncate max-w-full leading-normal">
              {item.prompt}
            </span>
          </div>
        )}

        {/* Lower Right Re-prompt Button */}
        <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-out pointer-events-none group-hover:pointer-events-auto z-30">
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
      </motion.div>
    )}
    </AnimatePresence>
 
    {item.status === 'completed' && item.url && (
      <div ref={containerRef} className="w-full h-full relative" onContextMenu={handleContextMenu}>
        {item.kind === 'video' ? (
          <>
            <MediaVideo
              ref={videoRef}
              src={item.url}
              loop
              muted
              playsInline
              className="w-full h-full object-cover rounded-[18px]"
              draggable={false}
            />
            <div className="absolute top-3.5 left-3.5 w-[22px] h-[22px] flex items-center justify-center shadow-md pointer-events-none group-hover:opacity-0 transition-opacity duration-300 z-20 rounded-full">
              <svg viewBox="0 0 26 26" className="w-[22px] h-[22px] text-white fill-current">
                <defs>
                  <mask id={`play-cutout-${item.id}`}>
                    <rect x="0" y="0" width="26" height="26" fill="white" />
                    <path d="M10.5 9v8l7-4z" fill="black" />
                  </mask>
                </defs>
                <circle cx="13" cy="13" r="12" mask={`url(#play-cutout-${item.id})`} />
              </svg>
            </div>
          </>
        ) : (
          <img
            src={item.url}
            alt={item.shortenedPrompt || item.prompt}
            className="w-full h-full object-cover rounded-[18px]"
            draggable="false"
          />
        )}
      </div>
    )}
 
    {item.status === 'failed' && (
      <div className="absolute inset-0 flex flex-col items-start p-4 bg-gradient-to-b from-[#232323] to-[#171717] rounded-[18px] select-text">
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
    )}
 
    {item.status === 'completed' && item.url && (
      <>
        <div className={`absolute top-3 right-3 transition-all duration-300 z-30 ${
          isRenaming 
            ? 'opacity-0 -translate-y-2 pointer-events-none' 
            : `opacity-0 -translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto ${(isMenuOpen && !contextMenuCoords) ? '!opacity-100 !translate-y-0 !transition-none' : ''}`
        }`}>
          <div className="flex items-center gap-[3.5px] bg-white/70 backdrop-blur-[80px] rounded-[11px] p-[3.5px] shadow-xl pointer-events-auto" ref={menuRef}>
            <button 
              onClick={(e) => e.stopPropagation()}
              className="w-[28px] h-[28px] flex items-center justify-center rounded-[7px] bg-transparent hover:bg-white transition-colors duration-200 outline-none"
            >
               <Heart size={17} className="text-[#1a1a1a]" strokeWidth={2} />
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                if (onRePrompt) onRePrompt(item);
              }}
              className="w-[28px] h-[28px] flex items-center justify-center rounded-[7px] bg-transparent hover:bg-white transition-colors duration-200 outline-none cursor-pointer"
              title="Use prompt again"
            >
               <Undo2 size={17} className="text-[#1a1a1a]" strokeWidth={2} style={{ transform: 'scaleY(-1)' }} />
            </button>
            <button 
              className={`w-[28px] h-[28px] flex items-center justify-center rounded-[7px] transition-colors duration-200 outline-none ${(isMenuOpen && !contextMenuCoords) ? 'bg-white' : 'bg-transparent hover:bg-white'}`}
              onClick={(e) => {
                e.stopPropagation();
                onMenuOpenChange(!isMenuOpen);
              }}
            >
               <MoreVertical size={17} className="text-[#1a1a1a]" strokeWidth={2} />
            </button>
          </div>
 
          {/* Dropdown Menu */}
          {createPortal(
            contextMenuCoords ? (
              isMenuOpen && (
                <div
                  ref={dropdownRef}
                  style={{ ...menuStyle, WebkitBackfaceVisibility: 'hidden', backfaceVisibility: 'hidden' }}
                  className="fixed w-[180px] bg-[#141517]/90 backdrop-blur-[80px] rounded-[20px] py-2 shadow-[0_10px_40px_rgba(0,0,0,0.5)] overflow-hidden text-[#e5e5e5] pointer-events-auto border border-white/5"
                >
                  {dropdownContent}
                </div>
              )
            ) : (
              <AnimatePresence>
                {isMenuOpen && (
                  <motion.div
                    ref={dropdownRef}
                    initial={{ opacity: 0, y: menuStyle.bottom !== 'auto' ? -8 : 8 }}
                    animate={{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 650, damping: 38 } }}
                    exit={{ 
                      opacity: 0, 
                      y: isHovered ? (menuStyle.bottom !== 'auto' ? 8 : -8) : -8, 
                      transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } 
                    }}
                    style={{ ...menuStyle, WebkitBackfaceVisibility: 'hidden', backfaceVisibility: 'hidden' }}
                    className="fixed w-[180px] bg-[#141517]/90 backdrop-blur-[80px] rounded-[20px] py-2 shadow-[0_10px_40px_rgba(0,0,0,0.5)] overflow-hidden text-[#e5e5e5] pointer-events-auto border border-white/5"
                  >
                    {dropdownContent}
                  </motion.div>
                )}
              </AnimatePresence>
            ),
            document.body
          )}
        </div>
        
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
                <ImagesIcon className="text-white w-[17px] h-[17px] shrink-0" />
              ) : (
                <VideoIcon className="text-white w-[17px] h-[17px] shrink-0 translate-y-[1.5px]" />
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
  onAnimate
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
        borderWidth: item.status === 'completed' ? '0.5px' : '0px',
        borderColor: item.status === 'completed' ? '#0e0e10' : 'transparent',
        cursor: isRenaming ? 'default' : isDragging ? 'grabbing' : 'grab',
      }}
      data-id={item.id}
      className={`gallery-tile relative rounded-[18px] bg-[#0c0c0c] shadow-2xl ${
        interactionsMuted ? '' : 'group'
      } ${
        item.status === 'completed' ? 'border' : 'border-none'
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
      />

      {/* Smooth fading local dark overlay for all other images/videos */}
      <div
        className={`absolute inset-0 bg-black/55 rounded-[18px] z-[35] pointer-events-none transition-opacity duration-[400ms] ${
          dimmed
            ? 'opacity-100'
            : 'opacity-0'
        }`}
      />

      {/* Selection white border overlay to prevent any gap */}
      <div
        className={`absolute rounded-[18px] pointer-events-none z-[38] transition-opacity duration-300 ease-in-out ${
          isSelected ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          top: item.status === 'completed' ? '-0.5px' : '0px',
          left: item.status === 'completed' ? '-0.5px' : '0px',
          right: item.status === 'completed' ? '-0.5px' : '0px',
          bottom: item.status === 'completed' ? '-0.5px' : '0px',
          border: '2.2px solid white',
        }}
      />
    </motion.div>
  );
});

export { MediaVideo, GalleryTile };
