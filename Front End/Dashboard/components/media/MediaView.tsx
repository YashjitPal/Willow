import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, 
  MoreVertical, 
  Search, 
  Plus, 
  HelpCircle, 
  Settings, 
  ArrowRight,
  Monitor,
  X,
  Image as ImageIcon,
  PlayCircle,
  Scan,
  FlaskConical,
  ChevronDown,
  Heart,
  Undo2,
  Redo2,
  RotateCcw,
  Sparkles,
  Download,
  Edit2,
  Share2,
  Flag,
  Trash2,
  Crop,
  Info,
  AlertTriangle,
  Eye,
  EyeOff,
  Check,
  Copy
} from 'lucide-react';
import logoG from '../../src/assets/logog.png'; // Fallback avatar
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { useUserDataContext } from '../../context/UserDataContext';
import { AssetMenuModal } from '../AssetMenuModal';
import { AgentSidebar, AgentInstruction } from './AgentSidebar';
import { streamChat, ChatMessage, StreamPhase } from '../../lib/ai';
import { TextShimmer } from '../ui/text-shimmer';

const popupItemVariants = {
  hidden: { opacity: 0, y: 8, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const },
  },
  exit: {
    opacity: 0,
    y: -4,
    scale: 0.98,
    transition: { duration: 0.14, ease: [0.32, 0.72, 0, 1] as const },
  },
};

const RatioIcon = ({ ratio, className = "text-white" }: { ratio: string, className?: string }) => {
  const getProps = () => {
    switch (ratio) {
      case '16:9': return { x: 2, y: 6, width: 20, height: 12, rx: 2 };
      case '4:3':  return { x: 4, y: 5, width: 16, height: 14, rx: 2 };
      case '1:1':  return { x: 5, y: 5, width: 14, height: 14, rx: 2 };
      case '3:4':  return { x: 5, y: 4, width: 14, height: 16, rx: 2 };
      case '9:16': return { x: 6, y: 2, width: 12, height: 20, rx: 2 };
      default:     return { x: 2, y: 6, width: 20, height: 12, rx: 2 };
    }
  };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect {...getProps()} />
    </svg>
  );
};

const AllMediaIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="-4 -4 113 113" fill="currentColor" className={className}>
    <path d="M0,0 H35 V45 H0 Z M10,10 V35 H25 V10 Z M50,0 H105 V45 H50 Z M60,10 V35 H95 V10 Z M0,60 H55 V105 H0 Z M10,70 V95 H45 V70 Z M70,60 H105 V105 H70 Z M80,70 V95 H95 V70 Z" />
  </svg>
);

const ImagesIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="8 8 109 109" fill="currentColor" className={className}>
    <path d="M12 27 A15 15 0 0 1 27 12 h71 a15 15 0 0 1 15 15 v71 a15 15 0 0 1 -15 15 H27 A15 15 0 0 1 12 98 Z M23 27 V98 A4 4 0 0 0 27 102 H98 A4 4 0 0 0 102 98 V27 A4 4 0 0 0 98 23 H27 A4 4 0 0 0 23 27 Z M32 91 L48 63 L64 91 Z M54 91 L74 49 L94 91 Z" />
  </svg>
);

const VideoIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="6 8 116 116" fill="currentColor" className={className}>
    <path d="M28 26h44a16 16 0 0 1 16 16v44a16 16 0 0 1-16 16H28A16 16 0 0 1 12 86V42A16 16 0 0 1 28 26z M28 35a7 7 0 0 0-7 7v44a7 7 0 0 0 7 7h44a7 7 0 0 0 7-7V42a7 7 0 0 0-7-7H28z M87 64l33-26v52z" />
  </svg>
);

const UploadsIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="10 10 80 80" fill="none" stroke="currentColor" className={className}>
    <path d="M 23 18 L 38 18 L 48 28 L 77 28 A 8 8 0 0 1 85 36 L 85 74 A 8 8 0 0 1 77 82 L 23 82 A 8 8 0 0 1 15 74 L 15 26 A 8 8 0 0 1 23 18 Z" strokeWidth="7" strokeLinejoin="round" />
    <path d="M 50 37.5 L 34.5 53 L 47 53 L 47 72 L 53 72 L 53 53 L 65.5 53 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const CharactersIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="9 8 82 82" fill="currentColor" className={className}>
    <circle cx="50" cy="18" r="10" />
    <path d="M 86 31.5 L 50 36 L 14 31.5 L 14 39.5 L 39 42.625 L 39 90 L 46 90 L 46 62 L 54 62 L 54 90 L 61 90 L 61 42.625 L 86 39.5 Z" />
  </svg>
);

const ScenesIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="56 96 400 320" fill="currentColor" className={className}>
    <path d="M 96 176 L 96 376 L 416 376 L 416 176 L 384 176 L 352 96 L 408 96 A 48 48 0 0 1 456 144 L 456 368 A 48 48 0 0 1 408 416 L 104 416 A 48 48 0 0 1 56 368 L 56 144 A 48 48 0 0 1 104 96 L 128 96 L 160 176 L 96 176 Z M 160 96 L 224 96 L 256 176 L 192 176 Z M 256 96 L 320 96 L 352 176 L 288 176 Z" />
  </svg>
);

const ToolsIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="3 6 117 117" fill="currentColor" className={className}>
    {/* Top Row */}
    <circle cx="18" cy="46.25" r="8.5" />
    <circle cx="50" cy="46.25" r="8.5" />
    {/* Middle Row */}
    <circle cx="18" cy="78.25" r="8.5" />
    <circle cx="50" cy="78.25" r="8.5" />
    <circle cx="82" cy="78.25" r="8.5" />
    {/* Bottom Row */}
    <circle cx="18" cy="110.25" r="8.5" />
    <circle cx="50" cy="110.25" r="8.5" />
    <circle cx="82" cy="110.25" r="8.5" />
    {/* Sparkle Star */}
    <path d="M 94 9.25 Q 94 34.25 69 34.25 Q 94 34.25 94 59.25 Q 94 34.25 119 34.25 Q 94 34.25 94 9.25 Z" />
  </svg>
);

const TrashIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 6.5h18" />
    <path d="M9.5 6.5V4.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5v2" />
    <path d="M5.5 6.5l1 14a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-14" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

const CollapseIcon = ({ className }: { className?: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M8 4v16" />
    <path d="M15 16l-4-4 4-4v8z" fill="currentColor" stroke="none" />
  </svg>
);



interface ImageAttachment {
  id: string;
  url: string;
  name: string;
  file?: File;
  kind?: 'image' | 'video';
}

type MediaKind = 'image' | 'video';
type MediaStatus = 'generating' | 'completed' | 'failed';
type MediaItem = {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  url?: string;
  error?: string;
  prompt: string;
  shortenedPrompt?: string;
  modelId: string;
  modelName: string;
  ratio: string;
  timestamp: number;
  attachments?: ImageAttachment[];
};

const TileContent = React.memo(({ 
  item, 
  isMenuOpen, 
  onMenuOpenChange,
  isHovered,
  onCancel,
  onRefresh,
  onRePrompt,
  onDelete,
  onRename,
  isRenaming,
  setIsRenaming,
  onAddToPrompt,
  onAnimate
}: { 
  item: MediaItem; 
  isMenuOpen: boolean; 
  onMenuOpenChange: (open: boolean) => void; 
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
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const [progress, setProgress] = React.useState(0);
  const [renameValue, setRenameValue] = React.useState(item.shortenedPrompt || item.prompt);
  const [boxPosition, setBoxPosition] = React.useState<'bottom' | 'top'>('bottom');

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
    
    const getEstimatedDuration = (modelId: string, kind: 'image' | 'video') => {
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
      document.addEventListener('mousedown', handleClose);
      document.addEventListener('scroll', handleClose, { capture: true, passive: true });
    }
    return () => {
      document.removeEventListener('mousedown', handleClose);
      document.removeEventListener('scroll', handleClose, { capture: true });
    };
  }, [isMenuOpen, onMenuOpenChange]);

  React.useLayoutEffect(() => {
    if (!isMenuOpen || !menuRef.current) return;

    const updatePosition = () => {
      if (!menuRef.current) return;
      const triggerRect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const dropdownWidth = 190;
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
  }, [isMenuOpen]);

  return (
  <>
    {item.status === 'generating' && (
      <div className="mesh-container-generating">
        <style dangerouslySetInnerHTML={{ __html: `
          .mesh-container-generating {
            position: absolute;
            inset: 0;
            border-radius: 18px;
            background-color: #1a1b1f;
            overflow: hidden;
          }

          .mesh-container-generating::after {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 18px;
            pointer-events: none;
            z-index: 30;
          }

          /* Soft, highly blurred blobs for liquid blending */
          .mesh-blob {
            position: absolute;
            border-radius: 50%;
            filter: blur(45px); 
            opacity: 0.85;
            will-change: transform;
          }

          /* Lighter top-left highlight sweeping */
          .blob-1 {
            top: -20%;
            left: -20%;
            width: 80%;
            height: 80%;
            background-color: #a3a8b5; /* Changed to a much lighter silvery gray */
            animation: move1 8s infinite ease-in-out; /* Drastically faster */
          }

          /* Mid-tone gray */
          .blob-2 {
            bottom: -20%;
            right: -20%;
            width: 70%;
            height: 70%;
            background-color: #757a87; /* Changed to a medium-light gray */
            animation: move2 9s infinite ease-in-out; /* Drastically faster */
          }

          /* Deep shadow block 1 - Sweeping organically */
          .blob-3 {
            top: -15%;
            left: -15%;
            width: 65%;
            height: 65%;
            background-color: #12141a; /* Adjusted to a deep dark gray */
            animation: move3 13s infinite ease-in-out; 
          }

          /* Secondary highlight acting as a separator */
          .blob-4 {
            bottom: 10%;
            left: 10%;
            width: 60%;
            height: 60%;
            background-color: #c2c6d1; /* Brightest light gray highlight */
            animation: move4 15s infinite ease-in-out; /* Changed timing */
            z-index: 2;
          }

          /* Deep shadow block 2 - Sweeping organically */
          .blob-5 {
            bottom: -15%;
            right: -15%;
            width: 70%;
            height: 70%;
            background-color: #0d0f14; /* Adjusted to a deep dark gray */
            animation: move5 17s infinite ease-in-out; 
          }

          /* * Continuous looping keyframes (0% matches 100%)
           * This prevents the "bounce" of alternate keyframes and stops blobs from clumping.
           */
          @keyframes move1 {
            0% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(25%, 15%) scale(1.05); }
            66% { transform: translate(-10%, 25%) scale(0.95); }
            100% { transform: translate(0, 0) scale(1); }
          }
          
          @keyframes move2 {
            0% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(-25%, -15%) scale(0.95); }
            66% { transform: translate(15%, -25%) scale(1.05); }
            100% { transform: translate(0, 0) scale(1); }
          }
          
          /* Dark Ridge 1 takes a wider, more erratic path */
          @keyframes move3 {
            0% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(70%, 20%) scale(1.15); } /* Sweeps far right */
            66% { transform: translate(20%, 70%) scale(0.85); } /* Drops low */
            100% { transform: translate(0, 0) scale(1); }
          }
          
          @keyframes move4 {
            0% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(-20%, 20%) scale(1.1); }
            66% { transform: translate(30%, -15%) scale(0.9); }
            100% { transform: translate(0, 0) scale(1); }
          }

          /* Dark Ridge 2 takes an independent, overlapping path */
          @keyframes move5 {
            0% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(-80%, -30%) scale(1.1); } /* Sweeps far left */
            66% { transform: translate(-10%, -80%) scale(0.9); } /* Rises high */
            100% { transform: translate(0, 0) scale(1); }
          }

          /* Fine grain texture overlay just like the video */
          .noise-layer {
            position: absolute;
            inset: 0;
            z-index: 10;
            opacity: 0.045;
            mix-blend-mode: overlay;
            pointer-events: none;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
          }
        `}} />

        {/* Animated fluid mesh background layers */}
        <div className="mesh-blob blob-1"></div>
        <div className="mesh-blob blob-2"></div>
        <div className="mesh-blob blob-3"></div>
        <div className="mesh-blob blob-4"></div>
        <div className="mesh-blob blob-5"></div>

        {/* Subtle noise overlay for premium cinematic texture */}
        <div className="noise-layer"></div>

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

        <div className="absolute bottom-3.5 left-3.5 right-[60px] flex items-center pointer-events-none z-30 min-w-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-out">
          <span className="text-[12px] font-normal text-white/80 truncate max-w-full leading-normal">
            {item.prompt}
          </span>
        </div>

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
      </div>
    )}
 
    {item.status === 'completed' && item.url && (
      <div ref={containerRef} className="w-full h-full relative">
        {item.kind === 'video' ? (
          <>
            <video
              ref={videoRef}
              src={item.url}
              loop
              muted
              playsInline
              className="w-full h-full object-cover rounded-[18px]"
              draggable="false"
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
            : `opacity-0 -translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto ${isMenuOpen ? '!opacity-100 !translate-y-0 !transition-none' : ''}`
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
              className={`w-[28px] h-[28px] flex items-center justify-center rounded-[7px] transition-colors duration-200 outline-none ${isMenuOpen ? 'bg-white' : 'bg-transparent hover:bg-white'}`}
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
                  className="fixed w-[190px] bg-[#141517]/90 backdrop-blur-[80px] rounded-[20px] py-2 shadow-[0_10px_40px_rgba(0,0,0,0.5)] overflow-hidden text-[#e5e5e5] pointer-events-auto border border-white/5"
                >
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
                  
                  <button className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100">
                    <ImageIcon size={18} strokeWidth={2.5} className="text-zinc-100" />
                    <span>Set project cover</span>
                  </button>
                  
                  <div className="mx-3.5 h-[1px] bg-white/10 my-1" />
                  
                  <button className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-[#ff6b6b]">
                    <Trash2 size={18} strokeWidth={2.5} className="text-[#ff6b6b]" />
                    <span>Move to trash</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>,
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

const getSvgPathD = (points: { x: number; y: number }[]) => {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
  
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
};

const SUNFLOWER_BOX_SHADOW: string = "160px 42px #cacaca, 120px 50px #9e9e9e, 128px 50px #9e9e9e, 136px 50px #9e9e9e, 152px 50px #cacaca, 160px 50px #cacaca, 120px 58px #404040, 128px 58px #9e9e9e, 136px 58px #9e9e9e, 144px 58px #cacaca, 152px 58px #cacaca, 160px 58px #cacaca, 96px 66px #ffffff, 104px 66px #cacaca, 112px 66px #cacaca, 120px 66px #cacaca, 128px 66px #404040, 136px 66px #404040, 144px 66px #cacaca, 152px 66px #cacaca, 160px 66px #cacaca, 96px 74px #ffffff, 104px 74px #ffffff, 112px 74px #cacaca, 120px 74px #cacaca, 128px 74px #cacaca, 136px 74px #404040, 144px 74px #cacaca, 152px 74px #cacaca, 160px 74px #cacaca, 96px 82px #ffffff, 104px 82px #ffffff, 112px 82px #ffffff, 120px 82px #cacaca, 128px 82px #cacaca, 136px 82px #cacaca, 144px 82px #cacaca, 152px 82px #cacaca, 160px 82px #cacaca, 80px 90px #9e9e9e, 88px 90px #9e9e9e, 96px 90px #ffffff, 104px 90px #ffffff, 112px 90px #ffffff, 120px 90px #ffffff, 128px 90px #cacaca, 136px 90px #cacaca, 144px 90px rgba(64,64,64,0.8), 152px 90px #cacaca, 160px 90px #cacaca, 80px 98px #9e9e9e, 88px 98px #9e9e9e, 96px 98px #404040, 104px 98px #ffffff, 112px 98px #ffffff, 120px 98px #ffffff, 128px 98px #ffffff, 136px 98px #cacaca, 88px 106px #9e9e9e, 96px 106px #404040, 104px 106px #404040, 112px 106px #ffffff, 120px 106px #ffffff, 128px 106px #ffffff, 88px 114px #cacaca, 96px 114px #cacaca, 104px 114px #cacaca, 112px 114px #cacaca, 120px 114px rgba(64,64,64,0.8), 80px 122px #cacaca, 88px 122px #cacaca, 96px 122px #cacaca, 104px 122px #cacaca, 112px 122px #cacaca, 120px 122px #cacaca, 72px 130px #cacaca, 80px 130px #cacaca, 88px 130px #cacaca, 96px 130px #cacaca, 104px 130px #cacaca, 112px 130px #cacaca, 120px 130px #cacaca, 80px 138px #ffffff, 88px 138px #ffffff, 96px 138px #ffffff, 104px 138px #ffffff, 112px 138px #ffffff, 120px 138px #ffffff, 88px 146px #ffffff, 96px 146px #ffffff, 104px 146px #ffffff, 112px 146px #ffffff, 120px 146px rgba(64,64,64,0.8), 88px 154px #9e9e9e, 96px 154px #404040, 104px 154px #404040, 112px 154px #ffffff, 120px 154px #ffffff, 128px 154px #ffffff, 80px 162px #9e9e9e, 88px 162px #9e9e9e, 96px 162px #404040, 104px 162px #ffffff, 112px 162px #ffffff, 120px 162px #ffffff, 128px 162px #ffffff, 136px 162px #cacaca, 80px 170px #9e9e9e, 88px 170px #9e9e9e, 96px 170px #ffffff, 104px 170px #ffffff, 112px 170px #ffffff, 120px 170px #ffffff, 128px 170px #cacaca, 136px 170px #cacaca, 144px 170px rgba(64,64,64,0.8), 152px 170px #ffffff, 160px 170px #cacaca, 96px 178px #ffffff, 104px 178px #ffffff, 112px 178px #ffffff, 120px 178px #cacaca, 128px 178px #cacaca, 136px 178px #cacaca, 144px 178px #ffffff, 152px 178px #ffffff, 160px 178px #cacaca, 96px 186px #ffffff, 104px 186px #ffffff, 112px 186px #cacaca, 120px 186px #cacaca, 128px 186px #cacaca, 136px 186px #404040, 144px 186px #ffffff, 152px 186px #ffffff, 160px 186px #cacaca, 96px 194px #ffffff, 104px 194px #cacaca, 112px 194px #cacaca, 120px 194px #cacaca, 128px 194px #404040, 136px 194px #404040, 144px 194px #ffffff, 152px 194px #ffffff, 160px 194px #cacaca, 120px 202px #404040, 128px 202px #9e9e9e, 136px 202px #9e9e9e, 144px 202px #ffffff, 152px 202px #ffffff, 160px 202px #cacaca, 120px 210px #9e9e9e, 128px 210px #9e9e9e, 136px 210px #9e9e9e, 152px 210px #ffffff, 160px 210px #cacaca, 152px 218px #242424, 160px 218px #cacaca, 88px 226px #242424, 96px 226px #4e4e4e, 104px 226px #4e4e4e, 112px 226px #4e4e4e, 152px 226px #242424, 160px 226px #4e4e4e, 88px 234px #242424, 96px 234px #242424, 104px 234px #4e4e4e, 112px 234px #4e4e4e, 120px 234px #4e4e4e, 152px 234px #4e4e4e, 160px 234px #4e4e4e, 88px 242px #242424, 96px 242px #242424, 104px 242px #242424, 112px 242px #4e4e4e, 120px 242px #4e4e4e, 128px 242px #4e4e4e, 152px 242px #4e4e4e, 160px 242px #909090, 88px 250px #242424, 96px 250px #242424, 104px 250px #242424, 112px 250px #242424, 120px 250px #4e4e4e, 128px 250px #4e4e4e, 136px 250px #4e4e4e, 152px 250px #4e4e4e, 160px 250px #909090, 96px 258px #242424, 104px 258px #242424, 112px 258px #242424, 120px 258px #242424, 128px 258px #4e4e4e, 136px 258px #4e4e4e, 152px 258px #4e4e4e, 160px 258px #909090, 104px 266px #242424, 112px 266px #242424, 120px 266px #242424, 128px 266px #242424, 136px 266px #4e4e4e, 152px 266px #4e4e4e, 160px 266px #909090, 112px 274px #242424, 120px 274px #242424, 128px 274px #242424, 136px 274px #242424, 152px 274px #4e4e4e, 160px 274px #909090, 152px 282px #4e4e4e, 160px 282px #909090, 144px 98px #121212, 152px 98px #121212, 160px 98px #121212, 168px 98px #121212, 176px 98px #121212, 136px 106px #121212, 144px 106px #5c5c5c, 152px 106px #121212, 160px 106px #5c5c5c, 168px 106px #5c5c5c, 176px 106px #5c5c5c, 184px 106px #121212, 128px 114px #121212, 136px 114px #5c5c5c, 144px 114px #121212, 152px 114px #5c5c5c, 160px 114px #bcbcbc, 168px 114px #5c5c5c, 176px 114px #bcbcbc, 184px 114px #5c5c5c, 192px 114px #121212, 128px 122px #121212, 136px 122px #121212, 144px 122px #5c5c5c, 152px 122px #5c5c5c, 160px 122px #5c5c5c, 168px 122px #bcbcbc, 176px 122px #5c5c5c, 184px 122px #5c5c5c, 192px 122px #121212, 128px 130px #121212, 136px 130px #5c5c5c, 144px 130px #121212, 152px 130px #5c5c5c, 160px 130px #bcbcbc, 168px 130px #5c5c5c, 176px 130px #bcbcbc, 184px 130px #5c5c5c, 192px 130px #121212, 128px 138px #121212, 136px 138px #121212, 144px 138px #5c5c5c, 152px 138px #5c5c5c, 160px 138px #5c5c5c, 168px 138px #5c5c5c, 176px 138px #5c5c5c, 184px 138px #5c5c5c, 192px 138px #121212, 128px 146px #121212, 136px 146px #5c5c5c, 144px 146px #121212, 152px 146px #5c5c5c, 160px 146px #5c5c5c, 168px 146px #5c5c5c, 176px 146px #121212, 184px 146px #5c5c5c, 192px 146px #121212, 136px 154px #121212, 144px 154px #5c5c5c, 152px 154px #121212, 160px 154px #5c5c5c, 168px 154px #121212, 176px 154px #5c5c5c, 184px 154px #121212, 144px 162px #121212, 152px 162px #121212, 160px 162px #121212, 168px 162px #121212, 176px 162px #121212, 168px 50px #ffffff, 184px 50px #9e9e9e, 192px 50px #9e9e9e, 200px 50px #9e9e9e, 168px 58px #ffffff, 176px 58px #ffffff, 184px 58px #9e9e9e, 192px 58px #9e9e9e, 200px 58px #404040, 168px 66px #ffffff, 176px 66px #ffffff, 184px 66px #404040, 192px 66px #404040, 200px 66px #cacaca, 208px 66px #cacaca, 216px 66px #cacaca, 224px 66px #ffffff, 168px 74px #ffffff, 176px 74px #ffffff, 184px 74px #404040, 192px 74px #cacaca, 200px 74px #cacaca, 208px 74px #cacaca, 216px 74px #ffffff, 224px 74px #ffffff, 168px 82px #ffffff, 176px 82px #ffffff, 184px 82px #cacaca, 192px 82px #cacaca, 200px 82px #cacaca, 208px 82px #ffffff, 216px 82px #ffffff, 224px 82px #ffffff, 168px 90px #ffffff, 176px 90px rgba(64,64,64,0.8), 184px 90px #cacaca, 192px 90px #cacaca, 200px 90px #ffffff, 208px 90px #ffffff, 216px 90px #ffffff, 224px 90px #ffffff, 232px 90px #404040, 240px 90px #9e9e9e, 184px 98px #cacaca, 192px 98px #ffffff, 200px 98px #ffffff, 208px 98px #ffffff, 216px 98px #ffffff, 224px 98px #404040, 232px 98px #9e9e9e, 240px 98px #9e9e9e, 192px 106px #ffffff, 200px 106px #ffffff, 208px 106px #ffffff, 216px 106px #404040, 224px 106px #404040, 232px 106px #9e9e9e, 200px 114px rgba(64,64,64,0.8), 208px 114px #cacaca, 216px 114px #cacaca, 224px 114px #cacaca, 232px 114px #cacaca, 200px 122px #cacaca, 208px 122px #cacaca, 216px 122px #cacaca, 224px 122px #cacaca, 232px 122px #cacaca, 240px 122px #cacaca, 200px 130px #cacaca, 208px 130px #cacaca, 216px 130px #cacaca, 224px 130px #cacaca, 232px 130px #cacaca, 240px 130px #cacaca, 248px 130px #cacaca, 200px 138px #ffffff, 208px 138px #ffffff, 216px 138px #ffffff, 224px 138px #ffffff, 232px 138px #ffffff, 240px 138px #ffffff, 200px 146px rgba(64,64,64,0.8), 208px 146px #ffffff, 216px 146px #ffffff, 224px 146px #ffffff, 232px 146px #ffffff, 192px 154px #ffffff, 200px 154px #ffffff, 208px 154px #ffffff, 216px 154px #404040, 224px 154px #404040, 232px 154px #404040, 184px 162px #cacaca, 192px 162px #ffffff, 200px 162px #ffffff, 208px 162px #ffffff, 216px 162px #ffffff, 224px 162px #404040, 232px 162px #9e9e9e, 240px 162px #9e9e9e, 168px 170px #cacaca, 176px 170px rgba(64,64,64,0.8), 184px 170px #cacaca, 192px 170px #cacaca, 200px 170px #ffffff, 208px 170px #ffffff, 216px 170px #ffffff, 224px 170px #ffffff, 232px 170px #9e9e9e, 240px 170px #9e9e9e, 168px 178px #cacaca, 176px 178px #cacaca, 184px 178px #cacaca, 192px 178px #cacaca, 200px 178px #cacaca, 208px 178px #ffffff, 216px 178px #ffffff, 224px 178px #ffffff, 168px 186px #cacaca, 176px 186px #cacaca, 184px 186px #404040, 192px 186px #cacaca, 200px 186px #cacaca, 208px 186px #cacaca, 216px 186px #ffffff, 224px 186px #ffffff, 168px 194px #cacaca, 176px 194px #cacaca, 184px 194px #404040, 192px 194px #404040, 200px 194px #cacaca, 208px 194px #cacaca, 216px 194px #cacaca, 224px 194px #ffffff, 168px 202px #cacaca, 176px 202px #cacaca, 184px 202px #9e9e9e, 192px 202px #9e9e9e, 200px 202px #404040, 168px 210px #cacaca, 184px 210px #9e9e9e, 192px 210px #9e9e9e, 200px 210px #9e9e9e, 200px 226px #4e4e4e, 208px 226px #4e4e4e, 216px 226px #4e4e4e, 224px 226px #242424, 192px 234px #4e4e4e, 200px 234px #4e4e4e, 208px 234px #4e4e4e, 216px 234px #242424, 224px 234px #242424, 184px 242px #4e4e4e, 192px 242px #4e4e4e, 200px 242px #4e4e4e, 208px 242px #242424, 216px 242px #242424, 224px 242px #242424, 176px 250px #4e4e4e, 184px 250px #4e4e4e, 192px 250px #4e4e4e, 200px 250px #242424, 208px 250px #242424, 216px 250px #242424, 224px 250px #242424, 176px 258px #4e4e4e, 184px 258px #4e4e4e, 192px 258px #242424, 200px 258px #242424, 208px 258px #242424, 216px 258px #242424, 176px 266px #4e4e4e, 184px 266px #242424, 192px 266px #242424, 200px 266px #242424, 208px 266px #242424, 176px 274px #242424, 184px 274px #242424, 192px 274px #242424, 200px 274px #242424";

export const MediaView: React.FC = () => {
  const { user, userProfile } = useAuth();
  const { apiKeys } = useUserDataContext();
  const [prompt, setPrompt] = React.useState('');
  const [projectName, setProjectName] = React.useState('May 25, 05:55 AM');
  const [isTopFaded, setIsTopFaded] = React.useState(false);
  const [isBottomFaded, setIsBottomFaded] = React.useState(false);
  const [isAgentActive, setIsAgentActive] = React.useState(false);
  const [isAgentSidebarOpen, setIsAgentSidebarOpen] = React.useState(false);
  const [agentAnimationKey, setAgentAnimationKey] = React.useState(0);

  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([]);
  const [isAgentGenerating, setIsAgentGenerating] = React.useState(false);
  const [agentStreaming, setAgentStreaming] = React.useState('');
  const [isAgentThinking, setIsAgentThinking] = React.useState(false);
  const [agentThinkingPhase, setAgentThinkingPhase] = React.useState<StreamPhase>('thinking');
  const [sessionName, setSessionName] = React.useState('Untitled session');

  React.useEffect(() => {
    if (chatMessages.length === 0) {
      setSessionName('Untitled session');
    }
  }, [chatMessages]);
  const [activeMenuId, setActiveMenuId] = React.useState<string | null>(null);
  const [hoveredTileId, setHoveredTileId] = React.useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = React.useState<string | null>(null);
  const [dragMousePos, setDragMousePos] = React.useState({ x: 0, y: 0 });
  const [isDragOverPrompt, setIsDragOverPrompt] = React.useState(false);
  const [draggedOverZone, setDraggedOverZone] = React.useState<'start' | 'end' | null>(null);

  React.useEffect(() => {
    if (!draggingItemId) {
      setDraggedOverZone(null);
    }
  }, [draggingItemId]);

  const blankDragImage = React.useMemo(() => {
    if (typeof window === 'undefined') return null;
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    return img;
  }, []);

  React.useEffect(() => {
    if (!draggingItemId) return;
    
    const handleDragOver = (e: DragEvent) => {
      setDragMousePos({ x: e.clientX, y: e.clientY });
    };
    
    window.addEventListener('dragover', handleDragOver);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
    };
  }, [draggingItemId]);

  React.useEffect(() => {
    if (!draggingItemId) return;

    let animationFrameId: number;
    
    const scrollLoop = () => {
      const el = mainRef.current;
      if (!el) {
        animationFrameId = requestAnimationFrame(scrollLoop);
        return;
      }
      
      const rect = el.getBoundingClientRect();
      const mouseY = dragMousePos.y;
      
      const threshold = 100;
      const topBoundary = rect.top + threshold;
      const bottomBoundary = rect.bottom - threshold;
      
      if (mouseY < topBoundary && mouseY > rect.top) {
        const distance = topBoundary - mouseY;
        const speed = Math.min(15, (distance / threshold) * 15);
        el.scrollTop -= speed;
      } else if (mouseY > bottomBoundary && mouseY < rect.bottom) {
        const distance = mouseY - bottomBoundary;
        const speed = Math.min(15, (distance / threshold) * 15);
        el.scrollTop += speed;
      }
      
      animationFrameId = requestAnimationFrame(scrollLoop);
    };
    
    animationFrameId = requestAnimationFrame(scrollLoop);
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [draggingItemId, dragMousePos]);

  React.useEffect(() => {
    if (!draggingItemId) return;
    
    const handleWheel = (e: WheelEvent) => {
      const el = mainRef.current;
      if (!el) return;
      el.scrollTop += e.deltaY;
    };
    
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, [draggingItemId]);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Full-screen Image viewer modal states
  const [selectedItem, setSelectedItem] = React.useState<MediaItem | null>(null);
  const [showHistory, setShowHistory] = React.useState(true);
  const [activeTool, setActiveTool] = React.useState<'crop' | 'pen' | 'select'>('pen');
  const [showPenMenu, setShowPenMenu] = React.useState(false);
  const [showSelectMenu, setShowSelectMenu] = React.useState(false);
  const [showCropMenu, setShowCropMenu] = React.useState(false);
  const [activeSelectSubTool, setActiveSelectSubTool] = React.useState<'box' | 'lasso'>('box');
  const [activeCropRatio, setActiveCropRatio] = React.useState<'16:9' | '9:16' | '1:1' | 'freeform'>('16:9');
  const [pendingTool, setPendingTool] = React.useState<'crop' | 'pen' | 'select' | null>(null);
  const [previousTool, setPreviousTool] = React.useState<'pen' | 'select'>('pen');
  const [activeColor, setActiveColor] = React.useState('#ff0000');
  const [penSize, setPenSize] = React.useState(4);
  const [activePenSubTool, setActivePenSubTool] = React.useState<'draw' | 'text' | 'rect'>('draw');
  const [showColorPicker, setShowColorPicker] = React.useState(false);

  // Carousel animation states
  const [isAnimating, setIsAnimating] = React.useState(false);
  const [xTranslate, setXTranslate] = React.useState(-176);
  const targetItemRef = React.useRef<MediaItem | null>(null);
  const [editPrompt, setEditPrompt] = React.useState('');
  const [viewerModelId, setViewerModelId] = React.useState<string>('');
  const [viewerModelName, setViewerModelName] = React.useState<string>('');
  const [isViewerModelDropdownOpen, setIsViewerModelDropdownOpen] = React.useState(false);
  const viewerModelDropdownRef = React.useRef<HTMLDivElement>(null);
  const [viewerAttachments, setViewerAttachments] = React.useState<ImageAttachment[]>([]);
  const [viewerRemovingIds, setViewerRemovingIds] = React.useState<Set<string>>(new Set());
  const hasViewerAttachments = viewerAttachments.length > 0 && !viewerAttachments.every(att => viewerRemovingIds.has(att.id));
  const [isViewerAssetMenuOpen, setIsViewerAssetMenuOpen] = React.useState(false);
  const viewerAssetMenuPlusRef = React.useRef<HTMLButtonElement>(null);
  const viewerFileInputRef = React.useRef<HTMLInputElement>(null);
  const viewerTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [isViewerTopFaded, setIsViewerTopFaded] = React.useState(false);
  const [isViewerBottomFaded, setIsViewerBottomFaded] = React.useState(false);
  // Interactive crop box state (all values in % of image container 0-100)
  const [cropBox, setCropBox] = React.useState({ x: 0, y: 0, w: 100, h: 100 });
  const cropContainerRef = React.useRef<HTMLDivElement>(null);
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const cropDragRef = React.useRef<{
    type: 'move' | 'nw' | 'ne' | 'sw' | 'se';
    startMouseX: number;
    startMouseY: number;
    startBox: { x: number; y: number; w: number; h: number };
  } | null>(null);

  // Parse the image's own aspect ratio number
  const getImageAr = () => {
    if (!selectedItem) return 16 / 9;
    const r = selectedItem.ratio;
    if (r === '4:3') return 4 / 3;
    if (r === '1:1') return 1;
    if (r === '3:4') return 3 / 4;
    if (r === '9:16') return 9 / 16;
    return 16 / 9;
  };

  // Compute maximized crop box for a given crop ratio inside the image's aspect ratio
  const computeMaxCropBox = (cropRatio: string) => {
    if (cropRatio === 'freeform') return { x: 0, y: 0, w: 100, h: 100 };
    const imageAr = getImageAr();
    const [cw, ch] = cropRatio.split(':').map(Number);
    const cropAr = cw / ch;
    // Compare crop AR to image AR to decide which dimension is the constraint
    let boxW: number, boxH: number;
    if (cropAr >= imageAr) {
      // Crop is wider relative to image → width-constrained
      boxW = 100;
      boxH = (imageAr / cropAr) * 100;
    } else {
      // Crop is taller relative to image → height-constrained
      boxH = 100;
      boxW = (cropAr / imageAr) * 100;
    }
    return { x: (100 - boxW) / 2, y: (100 - boxH) / 2, w: boxW, h: boxH };
  };

  // Initialize crop box when ratio changes while in crop mode
  React.useEffect(() => {
    if (activeTool === 'crop') {
      setCropBox(computeMaxCropBox(activeCropRatio));
    }
  }, [activeCropRatio, activeTool, selectedItem]);

  // Crop drag handlers
  const getCropMousePct = (e: MouseEvent | React.MouseEvent) => {
    const el = cropContainerRef.current;
    if (!el) return { px: 0, py: 0 };
    const rect = el.getBoundingClientRect();
    return {
      px: ((e.clientX - rect.left) / rect.width) * 100,
      py: ((e.clientY - rect.top) / rect.height) * 100,
    };
  };

  const onCropPointerDown = (e: React.MouseEvent, type: 'move' | 'nw' | 'ne' | 'sw' | 'se') => {
    e.preventDefault();
    e.stopPropagation();

    // Auto-close any open tool menu when using the tool
    setShowPenMenu(false);
    setShowSelectMenu(false);
    setShowCropMenu(false);
    setShowColorPicker(false);

    const { px, py } = getCropMousePct(e.nativeEvent);
    cropDragRef.current = {
      type,
      startMouseX: px,
      startMouseY: py,
      startBox: { ...cropBox },
    };
    const onMove = (ev: MouseEvent) => {
      if (!cropDragRef.current) return;
      const { px: mx, py: my } = getCropMousePct(ev);
      const dx = mx - cropDragRef.current.startMouseX;
      const dy = my - cropDragRef.current.startMouseY;
      const s = cropDragRef.current.startBox;
      const t = cropDragRef.current.type;

      if (t === 'move') {
        let nx = s.x + dx;
        let ny = s.y + dy;
        nx = Math.max(0, Math.min(100 - s.w, nx));
        ny = Math.max(0, Math.min(100 - s.h, ny));
        setCropBox({ x: nx, y: ny, w: s.w, h: s.h });
        return;
      }

      // Resize from corners
      const imageAr = getImageAr();
      const isFixed = activeCropRatio !== 'freeform';
      let cropAr = 1;
      if (isFixed) {
        const [cw, ch] = activeCropRatio.split(':').map(Number);
        cropAr = (cw / ch) / imageAr; // in percentage-space AR
      }

      let nx = s.x, ny = s.y, nw = s.w, nh = s.h;
      const minSize = 5; // minimum 5% in either dimension

      if (t === 'se') {
        nw = Math.max(minSize, Math.min(100 - s.x, s.w + dx));
        if (isFixed) {
          nh = nw / cropAr;
        } else {
          nh = Math.max(minSize, Math.min(100 - s.y, s.h + dy));
        }
        if (ny + nh > 100) { nh = 100 - ny; if (isFixed) nw = nh * cropAr; }
        if (nx + nw > 100) { nw = 100 - nx; if (isFixed) nh = nw / cropAr; }
      } else if (t === 'sw') {
        nw = Math.max(minSize, Math.min(s.x + s.w, s.w - dx));
        nx = s.x + s.w - nw;
        if (isFixed) {
          nh = nw / cropAr;
        } else {
          nh = Math.max(minSize, Math.min(100 - s.y, s.h + dy));
        }
        if (ny + nh > 100) { nh = 100 - ny; if (isFixed) { nw = nh * cropAr; nx = s.x + s.w - nw; } }
        if (nx < 0) { nx = 0; nw = s.x + s.w; if (isFixed) nh = nw / cropAr; }
      } else if (t === 'ne') {
        nw = Math.max(minSize, Math.min(100 - s.x, s.w + dx));
        if (isFixed) {
          nh = nw / cropAr;
        } else {
          nh = Math.max(minSize, Math.min(s.y + s.h, s.h - dy));
        }
        ny = s.y + s.h - nh;
        if (ny < 0) { ny = 0; nh = s.y + s.h; if (isFixed) nw = nh * cropAr; }
        if (nx + nw > 100) { nw = 100 - nx; if (isFixed) { nh = nw / cropAr; ny = s.y + s.h - nh; } }
      } else if (t === 'nw') {
        nw = Math.max(minSize, Math.min(s.x + s.w, s.w - dx));
        nx = s.x + s.w - nw;
        if (isFixed) {
          nh = nw / cropAr;
        } else {
          nh = Math.max(minSize, Math.min(s.y + s.h, s.h - dy));
        }
        ny = s.y + s.h - nh;
        if (nx < 0) { nx = 0; nw = s.x + s.w; if (isFixed) { nh = nw / cropAr; ny = s.y + s.h - nh; } }
        if (ny < 0) { ny = 0; nh = s.y + s.h; if (isFixed) { nw = nh * cropAr; nx = s.x + s.w - nw; } }
      }

      setCropBox({ x: nx, y: ny, w: nw, h: nh });
    };
    const onUp = () => {
      cropDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  interface Annotation {
    id: string;
    type: 'draw' | 'text' | 'rect' | 'select-box' | 'select-lasso';
    color: string;
    size: number;
    points?: { x: number; y: number }[];
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    text?: string;
  }

  interface TextInputState {
    x: number;
    y: number;
    value: string;
  }

  const [annotations, setAnnotations] = React.useState<Annotation[]>([]);
  const [redoStack, setRedoStack] = React.useState<Annotation[]>([]);
  const [currentAnnotation, setCurrentAnnotation] = React.useState<Annotation | null>(null);
  const [textInput, setTextInput] = React.useState<TextInputState | null>(null);

  React.useEffect(() => {
    setActiveTool('pen');
    setPreviousTool('pen');
    setShowPenMenu(false);
    setShowSelectMenu(false);
    setShowCropMenu(false);
    setActiveSelectSubTool('box');
    setActiveCropRatio('16:9');
    setPendingTool(null);
    setShowColorPicker(false);
    setAnnotations([]);
    setRedoStack([]);
    setCurrentAnnotation(null);
    setTextInput(null);
  }, [selectedItem]);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setShowPenMenu(false);
        setShowSelectMenu(false);
        setShowCropMenu(false);
        setShowColorPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const svgRef = React.useRef<SVGSVGElement>(null);

  const getCoordinates = (e: React.MouseEvent<SVGSVGElement> | MouseEvent) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return { x, y };
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // Only allow starting drawings or selections with the primary (left) mouse button
    if (e.button !== 0) return;

    if (activeTool !== 'pen' && activeTool !== 'select') return;

    // Auto-close any open tool menu when using the tool
    setShowPenMenu(false);
    setShowSelectMenu(false);
    setShowCropMenu(false);
    setShowColorPicker(false);

    const coords = getCoordinates(e);
    if (!coords) return;

    if (activeTool === 'pen') {
      if (activePenSubTool === 'draw') {
        const newAnn: Annotation = {
          id: Math.random().toString(),
          type: 'draw',
          color: activeColor,
          size: penSize,
          points: [coords]
        };
        setCurrentAnnotation(newAnn);
      } else if (activePenSubTool === 'rect') {
        const newAnn: Annotation = {
          id: Math.random().toString(),
          type: 'rect',
          color: activeColor,
          size: penSize,
          x: coords.x,
          y: coords.y,
          width: 0,
          height: 0
        };
        setCurrentAnnotation(newAnn);
      } else if (activePenSubTool === 'text') {
        setTextInput({
          x: coords.x,
          y: coords.y,
          value: ''
        });
      }
    } else if (activeTool === 'select') {
      setAnnotations((prev) => prev.filter((ann) => ann.type !== 'select-box' && ann.type !== 'select-lasso'));
      
      if (activeSelectSubTool === 'box') {
        const newAnn: Annotation = {
          id: Math.random().toString(),
          type: 'select-box',
          color: '#ffffff',
          size: 1.5,
          x: coords.x,
          y: coords.y,
          width: 0,
          height: 0
        };
        setCurrentAnnotation(newAnn);
      } else if (activeSelectSubTool === 'lasso') {
        const newAnn: Annotation = {
          id: Math.random().toString(),
          type: 'select-lasso',
          color: '#ffffff',
          size: 1.5,
          points: [coords]
        };
        setCurrentAnnotation(newAnn);
      }
    }
    setRedoStack([]);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement> | MouseEvent) => {
    // If a drawing is active but the left mouse button is not pressed (e.g. missed MouseUp event),
    // save the current drawing and release the state to prevent accidental hover painting.
    if (currentAnnotation && (e.buttons & 1) === 0) {
      setAnnotations([...annotations, currentAnnotation]);
      setCurrentAnnotation(null);
      return;
    }

    if (!currentAnnotation) return;
    const coords = getCoordinates(e);
    if (!coords) return;

    if ((currentAnnotation.type === 'draw' || currentAnnotation.type === 'select-lasso') && currentAnnotation.points) {
      setCurrentAnnotation({
        ...currentAnnotation,
        points: [...currentAnnotation.points, coords]
      });
    } else if (currentAnnotation.type === 'rect' || currentAnnotation.type === 'select-box') {
      const width = coords.x - (currentAnnotation.x || 0);
      const height = coords.y - (currentAnnotation.y || 0);
      setCurrentAnnotation({
        ...currentAnnotation,
        width,
        height
      });
    }
  };

  const handleMouseUp = () => {
    if (!currentAnnotation) return;
    setAnnotations([...annotations, currentAnnotation]);
    setCurrentAnnotation(null);
  };

  React.useEffect(() => {
    if (!currentAnnotation) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      handleMouseMove(e);
    };

    const handleWindowMouseUp = () => {
      handleMouseUp();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [currentAnnotation, annotations]);

  const handleUndo = () => {
    if (annotations.length === 0) return;
    const last = annotations[annotations.length - 1];
    setAnnotations(annotations.slice(0, -1));
    setRedoStack([last, ...redoStack]);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setRedoStack(redoStack.slice(1));
    setAnnotations([...annotations, next]);
  };

  const handleReset = () => {
    setAnnotations([]);
    setRedoStack([]);
    setActiveColor('#ff0000');
    setPenSize(4);
    setActivePenSubTool('draw');
    setShowColorPicker(false);
    setTextInput(null);
  };

  const handleToolSwitch = (targetTool: 'crop' | 'pen' | 'select') => {
    if (targetTool === 'crop') {
      if (activeTool === 'crop') {
        setShowCropMenu(!showCropMenu);
        return;
      }
      if (annotations.length > 0) {
        setPendingTool('crop');
      } else {
        setPreviousTool(activeTool as 'pen' | 'select');
        setActiveTool('crop');
        setShowCropMenu(true);
        setShowPenMenu(false);
        setShowSelectMenu(false);
      }
      return;
    }

    if (targetTool === activeTool) {
      if (targetTool === 'pen') {
        setShowPenMenu(!showPenMenu);
      } else if (targetTool === 'select') {
        setShowSelectMenu(!showSelectMenu);
      }
      return;
    }

    if (annotations.length > 0) {
      setPendingTool(targetTool);
    } else {
      setActiveTool(targetTool);
      setShowPenMenu(targetTool === 'pen');
      setShowSelectMenu(targetTool === 'select');
      setShowCropMenu(false);
    }
  };

  // Scroll direction header show/hide state
  const [isHeaderVisible, setIsHeaderVisible] = React.useState(true);
  const [isAtTop, setIsAtTop] = React.useState(true);
  const lastScrollTop = React.useRef(0);
  const maxScrollTop = React.useRef(0);

  // Unified transition timing used by both left sidebar and right agent sidebar
  const sidebarShowTransition = '0.78s cubic-bezier(0.16, 1, 0.3, 1)';
  const sidebarHideTransition = '1.0s cubic-bezier(0.25, 1, 0.5, 1) 80ms';
  const currentSidebarTransitionTiming = isHeaderVisible ? sidebarShowTransition : sidebarHideTransition;

  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    if (scrollTop <= 10) {
      setIsHeaderVisible(true);
      setIsAtTop(true);
      maxScrollTop.current = scrollTop;
    } else {
      setIsAtTop(false);
      if (scrollTop > lastScrollTop.current) {
        setIsHeaderVisible(false);
        maxScrollTop.current = scrollTop;
      } else if (scrollTop < lastScrollTop.current) {
        // Reappear only after scrolling up a small distance (45px) from the peak scroll position
        if (maxScrollTop.current - scrollTop >= 45) {
          setIsHeaderVisible(true);
        }
      }
    }
    lastScrollTop.current = scrollTop;
  };

  const [attachments, setAttachments] = React.useState<ImageAttachment[]>([]);
  const [hoveredAttachmentUrl, setHoveredAttachmentUrl] = React.useState<string | null>(null);
  const [hoveredAttachmentRect, setHoveredAttachmentRect] = React.useState<{ left: number; width: number } | null>(null);
  const hoverTimeoutRef = React.useRef<any>(null);
  const closeTimeoutRef = React.useRef<any>(null);
  
  const handleAttachmentMouseEnter = (e: React.MouseEvent<HTMLDivElement>, url: string) => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    
    const rect = e.currentTarget.getBoundingClientRect();
    const parent = e.currentTarget.closest('.prompt-container-box');
    const leftOffset = parent ? rect.left - parent.getBoundingClientRect().left : 0;
    const width = rect.width;
    
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredAttachmentRect({
        left: leftOffset,
        width: width
      });
      setHoveredAttachmentUrl(url);
    }, 330);
  };

  const handleAttachmentMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    
    closeTimeoutRef.current = setTimeout(() => {
      setHoveredAttachmentUrl(null);
      setHoveredAttachmentRect(null);
    }, 200);
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [removingIds, setRemovingIds] = React.useState<Set<string>>(new Set());
  const hasActiveAttachments = attachments.filter(Boolean).length > 0 && !attachments.filter(Boolean).every(att => removingIds.has(att.id));

  const removeAttachment = (id: string) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    setHoveredAttachmentUrl(null);
    setHoveredAttachmentRect(null);

    if (modelMode === 'video' && videoMode === 'frames') {
      setAttachments(prev => {
        const next = [...prev];
        const idx = next.findIndex(att => att && att.id === id);
        if (idx !== -1) {
          next[idx] = undefined as any;
        }
        if (!next[0] && !next[1]) {
          return [];
        }
        return next;
      });
      return;
    }
    setRemovingIds(prev => new Set(prev).add(id));
    setTimeout(() => {
      setAttachments(prev => prev.filter(att => att && att.id !== id));
      setRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newAttachments: ImageAttachment[] = Array.from(e.target.files)
      .filter(file => file.type.startsWith('image/'))
      .map(file => ({
        id: Math.random().toString(36).substring(7),
        url: URL.createObjectURL(file),
        name: file.name,
        file,
        kind: 'image'
      }));
    setAttachments(prev => {
      const next = [...prev, ...newAttachments];
      return (modelMode === 'video' && videoMode === 'frames') ? next.slice(0, 2) : next;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Model Menu State
  const [isModelMenuOpen, setIsModelMenuOpen] = React.useState(false);
  const [generationError, setGenerationError] = React.useState<string | null>(null);
  const [mediaItems, setMediaItems] = React.useState<MediaItem[]>([]);
  const [renamingItemId, setRenamingItemId] = React.useState<string | null>(null);
  type ImageModelId = 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview';
  const [imageModel, setImageModel] = React.useState<ImageModelId>('gemini-3-pro-image-preview');
  const [isImageModelDropdownOpen, setIsImageModelDropdownOpen] = React.useState(false);
  const [imageModelDropDirection, setImageModelDropDirection] = React.useState<'down' | 'up'>('down');
  const imageModelDropdownRef = React.useRef<HTMLDivElement>(null);
  const imageModelButtonRef = React.useRef<HTMLButtonElement>(null);

  type VideoModelId = 'veo-3.1-fast' | 'veo-3.1' | 'veo-3.1-lite' | 'omni-flash';
  const VIDEO_MODELS: { id: VideoModelId; name: string; apiId: string }[] = [
    { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast', apiId: 'veo-3.1-fast-generate-preview' },
    { id: 'veo-3.1', name: 'Veo 3.1', apiId: 'veo-3.1-generate-preview' },
    { id: 'veo-3.1-lite', name: 'Veo 3.1 Lite', apiId: 'veo-3.0-fast-generate-001' },
    { id: 'omni-flash', name: 'Omni Flash', apiId: 'veo-3.0-generate-001' },
  ];
  const getVideoApiModelId = (id: VideoModelId) =>
    VIDEO_MODELS.find(m => m.id === id)?.apiId ?? 'veo-3.1-fast-generate-preview';
  const [videoModel, setVideoModel] = React.useState<VideoModelId>('omni-flash');
  const [isVideoModelDropdownOpen, setIsVideoModelDropdownOpen] = React.useState(false);
  const [videoModelDropDirection, setVideoModelDropDirection] = React.useState<'down' | 'up'>('down');
  const videoModelDropdownRef = React.useRef<HTMLDivElement>(null);
  const videoModelButtonRef = React.useRef<HTMLButtonElement>(null);
  const getVideoModelName = (id: VideoModelId) => VIDEO_MODELS.find(m => m.id === id)?.name ?? 'Omni Flash';

  // Estimate dropdown panel height: each item ~42px + container padding 8px
  const estimateDropdownHeight = (itemCount: number) => itemCount * 42 + 8;

  const computeDropDirection = (
    buttonEl: HTMLElement | null,
    panelHeight: number,
  ): 'down' | 'up' => {
    if (!buttonEl) return 'down';
    const rect = buttonEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const margin = 12;
    return spaceBelow >= panelHeight + margin ? 'down' : 'up';
  };

  const toggleImageModelDropdown = () => {
    setIsImageModelDropdownOpen(open => {
      const next = !open;
      if (next) {
        setImageModelDropDirection(
          computeDropDirection(imageModelButtonRef.current, estimateDropdownHeight(2)),
        );
      }
      return next;
    });
  };

  const toggleVideoModelDropdown = () => {
    setIsVideoModelDropdownOpen(open => {
      const next = !open;
      if (next) {
        setVideoModelDropDirection(
          computeDropDirection(videoModelButtonRef.current, estimateDropdownHeight(VIDEO_MODELS.length)),
        );
      }
      return next;
    });
  };

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (imageModelDropdownRef.current && !imageModelDropdownRef.current.contains(event.target as Node)) {
        setIsImageModelDropdownOpen(false);
      }
    };
    if (isImageModelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isImageModelDropdownOpen]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (videoModelDropdownRef.current && !videoModelDropdownRef.current.contains(event.target as Node)) {
        setIsVideoModelDropdownOpen(false);
      }
    };
    if (isVideoModelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isVideoModelDropdownOpen]);

  const getImageModelName = (id: string) => {
    return id === 'gemini-3-pro-image-preview' ? 'Nano Banana Pro' : 'Nano Banana 2';
  };

  const menuRef = React.useRef<HTMLDivElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const [menuRect, setMenuRect] = React.useState<{ bottom: number; right: number } | null>(null);

  const openModelMenu = () => {
    if (menuRef.current) {
      const r = menuRef.current.getBoundingClientRect();
      setMenuRect({
        bottom: window.innerHeight - r.top + 12,
        right: window.innerWidth - r.right,
      });
    }
    setIsModelMenuOpen(true);
  };

  React.useEffect(() => {
    const isInsideMenu = (target: Node | null) =>
      (!!target && menuRef.current?.contains(target)) ||
      (!!target && popupRef.current?.contains(target));
    const handleClickOutside = (event: MouseEvent) => {
      if (!isInsideMenu(event.target as Node)) {
        setIsModelMenuOpen(false);
      }
    };
    const handleScroll = (event: Event) => {
      if (isInsideMenu(event.target as Node)) return;
      setIsModelMenuOpen(false);
    };
    const handleResize = () => setIsModelMenuOpen(false);
    if (isModelMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('wheel', handleScroll, { capture: true, passive: true });
      window.addEventListener('resize', handleResize);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('wheel', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isModelMenuOpen]);

  const [modelMode, setModelMode] = useState<'image' | 'video'>('image');
  
  const [isAssetMenuOpen, setIsAssetMenuOpen] = useState(false);
  const assetMenuPlusRef = useRef<HTMLButtonElement>(null);
  const [assetMenuSource, setAssetMenuSource] = useState<'main' | 'sidebar' | 'instruction-reference'>('main');
  const [sidebarButtonRef, setSidebarButtonRef] = useState<React.RefObject<HTMLButtonElement> | null>(null);
  const [instructions, setInstructions] = useState<AgentInstruction[]>([]);
  const [activeInstructionId, setActiveInstructionId] = useState<string | null>(null);
  const [instructionButtonRef, setInstructionButtonRef] = useState<React.RefObject<any> | null>(null);

  const [imageRatio, setImageRatio] = React.useState('16:9');
  const [imageBatch, setImageBatch] = React.useState('x4');
  const [videoMode, setVideoMode] = React.useState<'frames' | 'ingredients'>('ingredients');
  const [videoRatio, setVideoRatio] = React.useState('16:9');
  const [videoBatch, setVideoBatch] = React.useState('x4');
  const [videoDuration, setVideoDuration] = React.useState('10s');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);

  const [showFramesPlaceholders, setShowFramesPlaceholders] = React.useState(false);
  const isFramesMode = modelMode === 'video' && videoMode === 'frames';

  React.useEffect(() => {
    if (isFramesMode) {
      setShowFramesPlaceholders(true);
      // Automatically slice attachments to a max of 2 when entering Frames mode
      setAttachments(prev => {
        if (prev.length > 2) {
          return prev.slice(0, 2);
        }
        return prev;
      });
    } else {
      if (!hasActiveAttachments) {
        const timer = setTimeout(() => {
          setShowFramesPlaceholders(false);
        }, 250);
        return () => clearTimeout(timer);
      } else {
        setShowFramesPlaceholders(false);
      }
    }
  }, [isFramesMode, hasActiveAttachments]);


  const mainRef = React.useRef<HTMLElement>(null);

  const [canvasInnerWidth, setCanvasInnerWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const update = () => setCanvasInnerWidth(el.clientWidth - 12);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Viewer prompt-box height tracking. When the bottom "What do you want to
  // change?" card grows (attachments / multiline text), the flex-1 main area
  // shrinks and drags the left toolbar and right history thumbnail upward. We
  // measure the card and imperatively counter-translate ONLY those two rails so
  // they stay pinned, while the centered image keeps its natural drift/resize.
  //
  // The offsets are written directly to the DOM from inside the ResizeObserver
  // callback (NOT via React state). ResizeObserver fires after layout but before
  // paint in the SAME frame, so the counter-transform lands in lockstep with the
  // flex layout shift during the 250ms expand/shrink. A React state update would
  // re-render a frame later, leaving the rails visibly drifting mid-animation.
  const viewerPromptBaselineRef = React.useRef<number | null>(null);
  const viewerPromptResizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const viewerPromptDeltaRef = React.useRef(0);
  const historyRailRef = React.useRef<HTMLDivElement | null>(null);

  const applyRailOffsets = React.useCallback(() => {
    const delta = viewerPromptDeltaRef.current;
    // Toolbar is vertically centered → it drifts up by delta/2, so counter by delta/2.
    if (toolbarRef.current) {
      toolbarRef.current.style.transform = `translateY(${delta / 2}px)`;
    }
    // History thumbnail is bottom-anchored → it drifts up by the full delta.
    // 28px is the original `translate-y-7` resting nudge, folded in here.
    if (historyRailRef.current) {
      historyRailRef.current.style.transform = `translateY(${28 + delta}px)`;
    }
  }, []);

  // Callback ref for the history thumbnail's inner div: re-apply the current
  // offset whenever it mounts (e.g. toggling Show history back on while an
  // attachment is present), since the ResizeObserver won't fire on that toggle.
  const setHistoryRail = React.useCallback((el: HTMLDivElement | null) => {
    historyRailRef.current = el;
    if (el) applyRailOffsets();
  }, [applyRailOffsets]);

  const measureViewerPromptCard = React.useCallback((el: HTMLDivElement | null) => {
    viewerPromptResizeObserverRef.current?.disconnect();
    viewerPromptResizeObserverRef.current = null;
    if (!el) {
      // Card unmounted (viewer closed or crop mode) → no rail offset.
      viewerPromptBaselineRef.current = null;
      viewerPromptDeltaRef.current = 0;
      applyRailOffsets();
      return;
    }
    const update = () => {
      const h = el.offsetHeight;
      if (viewerPromptBaselineRef.current === null || h < viewerPromptBaselineRef.current) {
        viewerPromptBaselineRef.current = h;
      }
      viewerPromptDeltaRef.current = Math.max(0, h - (viewerPromptBaselineRef.current ?? h));
      applyRailOffsets();
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    viewerPromptResizeObserverRef.current = ro;
  }, [applyRailOffsets]);

  const prevItemCountRef = React.useRef(0);
  React.useEffect(() => {
    if (mediaItems.length > prevItemCountRef.current && mainRef.current) {
      mainRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevItemCountRef.current = mediaItems.length;
  }, [mediaItems.length]);

  const updateFades = (target: HTMLTextAreaElement) => {
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;
    const scrollTop = target.scrollTop;

    // Use a 4px tolerance to handle fractional browser scaling/zoom & line heights
    const hasScrollableHeight = scrollHeight > clientHeight + 4;
    const scrolledFromTop = scrollTop > 2;
    const canScrollMore = scrollHeight - scrollTop > clientHeight + 4;

    setIsTopFaded(hasScrollableHeight && scrolledFromTop);
    setIsBottomFaded(hasScrollableHeight && canScrollMore);
  };

  React.useEffect(() => {
    const adjustHeight = () => {
      if (textareaRef.current) {
        const el = textareaRef.current;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 384)}px`;
        updateFades(el);
      }
    };

    adjustHeight();

    const handle = requestAnimationFrame(adjustHeight);
    
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(adjustHeight);
    }

    const timer = setTimeout(adjustHeight, 200);
    window.addEventListener('resize', adjustHeight);

    return () => {
      cancelAnimationFrame(handle);
      clearTimeout(timer);
      window.removeEventListener('resize', adjustHeight);
    };
  }, [prompt]);

  const updateViewerFades = (target: HTMLTextAreaElement) => {
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;
    const scrollTop = target.scrollTop;

    // Use a 4px tolerance to handle fractional browser scaling/zoom & line heights
    const hasScrollableHeight = scrollHeight > clientHeight + 4;
    const scrolledFromTop = scrollTop > 2;
    const canScrollMore = scrollHeight - scrollTop > clientHeight + 4;

    setIsViewerTopFaded(hasScrollableHeight && scrolledFromTop);
    setIsViewerBottomFaded(hasScrollableHeight && canScrollMore);
  };

  React.useEffect(() => {
    const adjustHeight = () => {
      if (viewerTextareaRef.current) {
        const el = viewerTextareaRef.current;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 384)}px`;
        updateViewerFades(el);
      }
    };

    adjustHeight();

    const handle = requestAnimationFrame(adjustHeight);
    
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(adjustHeight);
    }

    const timer = setTimeout(adjustHeight, 200);
    window.addEventListener('resize', adjustHeight);

    return () => {
      cancelAnimationFrame(handle);
      clearTimeout(timer);
      window.removeEventListener('resize', adjustHeight);
    };
  }, [editPrompt]);

  const getGeminiInlinePart = async (att: ImageAttachment): Promise<{ inlineData: { data: string; mimeType: string } }> => {
    if (att.url.startsWith('data:')) {
      const match = att.url.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        return {
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        };
      }
    }

    if (att.file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const match = result.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            resolve({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          } else {
            reject(new Error('Failed to parse file data'));
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(att.file);
      });
    }

    try {
      const resp = await fetch(att.url);
      const blob = await resp.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const match = result.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            resolve({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          } else {
            reject(new Error('Failed to parse fetched blob'));
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      throw new Error(`Failed to load attachment: ${att.name}`);
    }
  };

  const generateSingleImage = async (
    item: MediaItem,
    activePrompt: string,
    modelId: string,
    ratio: string,
    apiKey: string,
    activeAttachments: ImageAttachment[],
  ) => {
    // In parallel, rephrase the prompt using Gemini 3.1 Flash Lite
    void (async () => {
      try {
        const fetchRephrase = async (model: string) => {
          return await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [{
                    text: `You are a creative helper. Rephrase this image generation prompt into a very concise and descriptive title/name (maximum 6 to 8 words). Return only the rephrased title itself, without any punctuation, quotes, introduction, or explanations.\n\nPrompt: ${activePrompt}`
                  }]
                }]
              })
            }
          );
        };

        let rephraseResp = await fetchRephrase('gemini-3.1-flash-lite');
        if (!rephraseResp.ok) {
          rephraseResp = await fetchRephrase('gemini-3.1-flash-lite-preview');
        }
        if (!rephraseResp.ok) {
          rephraseResp = await fetchRephrase('gemini-1.5-flash');
        }
        
        if (rephraseResp.ok) {
          const rephraseData = await rephraseResp.json();
          let text = rephraseData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) {
            text = text.replace(/^["'`\s]+|["'`\s]+$/g, '');
            if (text) {
              setMediaItems(prev =>
                prev.map(m => (m.id === item.id ? { ...m, shortenedPrompt: text } : m)),
              );
            }
          }
        }
      } catch (e) {
        console.error('Failed to rephrase prompt with Gemini 3.1 Flash Lite:', e);
      }
    })();

    try {
      const inlineParts = await Promise.all(activeAttachments.map(getGeminiInlinePart));

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: activePrompt },
                ...inlineParts
              ]
            }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: { aspectRatio: ratio, imageSize: '1K' },
            },
          }),
        },
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const status = response.status;
        const msg = errData?.error?.message || '';
        
        if (status === 400 && msg.toLowerCase().includes('key')) {
          throw new Error('Invalid API Key. Please check your workspace configuration in the Settings panel.');
        } else if (status === 403) {
          throw new Error('Access forbidden. Please check your API key permissions and region restrictions.');
        } else if (status === 429) {
          throw new Error('Rate limit exceeded. Too many requests. Please wait a moment and try again.');
        } else if (status === 503 || status === 504) {
          throw new Error('The generation service is currently overloaded. Please wait a few seconds and try again.');
        }
        
        throw new Error(msg || `API error (${status})`);
      }

      const data = await response.json();
      
      if (data?.promptFeedback?.blockReason === 'SAFETY') {
        throw new Error('This prompt might violate our safety policies. Please try a different prompt or send feedback.');
      }
      if (data?.candidates?.[0]?.finishReason === 'SAFETY') {
        throw new Error('This prompt might violate our safety policies. Please try a different prompt or send feedback.');
      }
      if (data?.candidates?.[0]?.finishReason === 'RECITATION') {
        throw new Error('Blocked due to copyright or recitation policies. Please try a different prompt.');
      }

      const parts = data?.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
      if (!imagePart?.inlineData?.data) {
        throw new Error('The model was unable to generate an image from this prompt. Try adding more descriptive details.');
      }
      const url = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
      setMediaItems(prev =>
        prev.map(m => (m.id === item.id ? { ...m, status: 'completed', url } : m)),
      );
    } catch (err: any) {
      console.error(`[image ${item.id}] failed:`, err);
      setMediaItems(prev =>
        prev.map(m =>
          m.id === item.id ? { ...m, status: 'failed', error: err?.message || 'Generation failed.' } : m,
        ),
      );
    }
  };

  const generateSingleVideo = async (
    item: MediaItem,
    activePrompt: string,
    videoModelKey: VideoModelId,
    ratio: string,
    durationStr: string,
    apiKey: string,
    activeAttachments: ImageAttachment[],
  ) => {
    try {
      const apiModelId = getVideoApiModelId(videoModelKey);
      const durationSec = parseInt(durationStr.replace('s', ''), 10) || 8;

      const inlineParts = await Promise.all(activeAttachments.map(getGeminiInlinePart));
      const firstImagePart = inlineParts[0]?.inlineData;

      const instance: any = { prompt: activePrompt };
      if (firstImagePart) {
        instance.image = {
          imageBytes: firstImagePart.data,
          mimeType: firstImagePart.mimeType
        };
      }

      const startResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${apiModelId}:predictLongRunning?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [instance],
            parameters: {
              aspectRatio: ratio,
              durationSeconds: durationSec,
              personGeneration: 'allow_all',
            },
          }),
        },
      );

      if (!startResp.ok) {
        const errData = await startResp.json().catch(() => ({}));
        const status = startResp.status;
        const msg = errData?.error?.message || '';
        
        if (status === 400 && msg.toLowerCase().includes('key')) {
          throw new Error('Invalid API Key. Please check your workspace configuration in the Settings panel.');
        } else if (status === 403) {
          throw new Error('Access forbidden. Please check your API key permissions and region restrictions.');
        } else if (status === 429) {
          throw new Error('Rate limit exceeded. Too many requests. Please wait a moment and try again.');
        } else if (status === 503 || status === 504) {
          throw new Error('The generation service is currently overloaded. Please wait a few seconds and try again.');
        }
        
        throw new Error(msg || `API error (${status})`);
      }

      const startData = await startResp.json();
      const operationName: string | undefined = startData?.name;
      if (!operationName) throw new Error('Veo returned no operation handle.');

      let done = false;
      let videoUri: string | undefined;
      const maxAttempts = 90;
      for (let attempt = 0; attempt < maxAttempts && !done; attempt++) {
        await new Promise(r => setTimeout(r, 5000));
        const pollResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`,
        );
        if (!pollResp.ok) continue;
        const pollData = await pollResp.json();
        if (pollData?.done) {
          done = true;
          if (pollData.error) {
            const msg = pollData.error.message || '';
            if (msg.toLowerCase().includes('safety')) {
              throw new Error('This prompt might violate our safety policies. Please try a different prompt or send feedback.');
            }
            throw new Error(msg || 'Video generation failed.');
          }
          videoUri =
            pollData?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ??
            pollData?.response?.videos?.[0]?.uri ??
            pollData?.response?.generatedVideos?.[0]?.video?.uri;
        }
      }

      if (!videoUri) throw new Error('Video generation request timed out after polling.');

      const sep = videoUri.includes('?') ? '&' : '?';
      const url = `${videoUri}${sep}key=${apiKey}`;

      setMediaItems(prev =>
        prev.map(m => (m.id === item.id ? { ...m, status: 'completed', url } : m)),
      );
    } catch (err: any) {
      console.error(`[video ${item.id}] failed:`, err);
      setMediaItems(prev =>
        prev.map(m =>
          m.id === item.id ? { ...m, status: 'failed', error: err?.message || 'Video generation failed.' } : m,
        ),
      );
    }
  };

  const handleAgentSend = async (text: string) => {
    if (!text.trim() && attachments.length === 0) return;
    if (isAgentGenerating) return;

    const activeAttachments = attachments.filter(Boolean);
    const attachmentIds = activeAttachments.map(att => att.id);

    if (attachmentIds.length > 0) {
      setRemovingIds(prev => {
        const next = new Set(prev);
        attachmentIds.forEach(id => next.add(id));
        return next;
      });
      setTimeout(() => {
        setAttachments([]);
        setRemovingIds(prev => {
          const next = new Set(prev);
          attachmentIds.forEach(id => next.delete(id));
          return next;
        });
      }, 200);
    } else {
      setAttachments([]);
    }

    setPrompt('');

    setIsAgentGenerating(true);
    setIsAgentThinking(true);
    setAgentThinkingPhase('thinking');
    setAgentStreaming('');

    const convertedAttachments = await Promise.all(
      activeAttachments.map(async (att) => {
        try {
          if (att.url.startsWith('data:')) {
            const match = att.url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              return {
                type: 'image',
                mimeType: match[1],
                data: match[2],
                name: att.name
              };
            }
          }
          if (att.file) {
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const result = reader.result as string;
                const match = result.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                  resolve({
                    type: 'image',
                    mimeType: match[1],
                    data: match[2],
                    name: att.name
                  });
                } else {
                  reject(new Error('Failed to parse file data'));
                }
              };
              reader.onerror = reject;
              reader.readAsDataURL(att.file);
            });
          }
          const res = await fetch(att.url);
          const blob = await res.blob();
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              const match = result.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                resolve({
                  type: 'image',
                  mimeType: match[1],
                  data: match[2],
                  name: att.name
                });
              } else {
                reject(new Error('Failed to parse file data'));
              }
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          return null;
        }
      })
    );

    const validAttachments = convertedAttachments.filter(Boolean) as any[];

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      ...(validAttachments.length > 0 ? { attachments: validAttachments } : {})
    };

    const newMessages: ChatMessage[] = [
      ...chatMessages,
      userMsg,
      { role: 'assistant', content: '' }
    ];

    setChatMessages(newMessages);

    const apiKey = apiKeys?.gemini?.[0];
    if (!apiKey) {
      setChatMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          last.content = 'Google Gemini API Key is missing. Please add it under Settings > Models & API.';
        }
        return next;
      });
      setIsAgentGenerating(false);
      setIsAgentThinking(false);
      return;
    }

    const activeImageModelName = imageModel === 'gemini-3-pro-image-preview' ? 'Nano Banana Pro' : 'Nano Banana 2';
    const activeVideoModelName = videoModel === 'veo-3.1-fast' ? 'Veo 3.1 Fast' : videoModel === 'veo-3.1' ? 'Veo 3.1' : videoModel === 'veo-3.1-lite' ? 'Veo 3.1 Lite' : 'Omni Flash';

    const activeGuidelines = instructions
      .filter(i => i.isActive && i.content.trim())
      .map(i => `- [${i.title}]: ${i.content}`)
      .join('\n');

    const systemPrompt = `You are a creative co-pilot AI Agent assisting the user in crafting elite-tier media prompts, storytelling, and refining video/image properties.
At any point, you can suggest full storyboard ideas, prompt scripts, or style guidelines. Keep your formatting gorgeous with clean headings and bullets.

Active Workspace Generation Settings:
- Default Image Generator: ${activeImageModelName} (Aspect Ratio: ${imageRatio}, Batch Size: ${imageBatch})
- Default Video Generator: ${activeVideoModelName} (Aspect Ratio: ${videoRatio}, Batch Size: ${videoBatch})

${activeGuidelines ? `Yashjit's custom instructions/guidelines you MUST follow:\n${activeGuidelines}` : ''}`;

    const isFirstPrompt = chatMessages.length === 0;

    if (isFirstPrompt) {
      void (async () => {
        try {
          const title = await generateSessionTitle(text, apiKey);
          if (title && title.trim()) {
            setSessionName(title.trim());
          }
        } catch (e) {
          // ignore
        }
      })();
    }

    let acc = '';
    try {
      await streamChat(
        newMessages.slice(0, -1),
        {
          provider: 'gemini',
          model: 'gemini-3.5-flash',
          apiKey: apiKey,
          thinkingLevel: 1,
          enableSearch: true,
          enableCodeExecution: true
        },
        (token) => {
          setIsAgentThinking(false);
          acc += token;
          setAgentStreaming(acc);
          setChatMessages(prev => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant') {
              last.content = acc;
            }
            return next;
          });
        },
        () => {},
        systemPrompt,
        (phase) => {
          if (phase !== 'responding') {
            setAgentThinkingPhase(phase);
          }
        }
      );
    } catch (e: any) {
      setChatMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          last.content = `Something went wrong: ${e?.message || 'Unknown error.'}`;
        }
        return next;
      });
    } finally {
      setIsAgentGenerating(false);
      setIsAgentThinking(false);
      setAgentStreaming('');
    }
  };

  const handleGenerate = async () => {
    const activePrompt = prompt.trim();
    if (!activePrompt) return;

    if (isAgentActive) {
      void handleAgentSend(activePrompt);
      return;
    }

    setGenerationError(null);

    const activeAttachments = attachments.filter(Boolean);
    const attachmentIds = activeAttachments.map(att => att.id);
    if (attachmentIds.length > 0) {
      setRemovingIds(prev => {
        const next = new Set(prev);
        attachmentIds.forEach(id => next.add(id));
        return next;
      });
    }

    setPrompt('');

    if (attachmentIds.length > 0) {
      setTimeout(() => {
        setAttachments([]);
        setRemovingIds(prev => {
          const next = new Set(prev);
          attachmentIds.forEach(id => next.delete(id));
          return next;
        });
      }, 200);
    } else {
      setAttachments([]);
    }

    const apiKey = apiKeys?.gemini?.[0];
    if (!apiKey) {
      setGenerationError('Google Gemini API Key is missing. Please add it under Settings > Models & API.');
      return;
    }

    const batchStr = modelMode === 'image' ? imageBatch : videoBatch;
    const batchCount = Math.max(1, parseInt(batchStr.replace('x', ''), 10) || 1);
    const activeRatio = modelMode === 'image' ? imageRatio : videoRatio;
    const activeModelId = modelMode === 'image' ? imageModel : videoModel;
    const activeModelName =
      modelMode === 'image' ? getImageModelName(imageModel) : getVideoModelName(videoModel);

    const newItems: MediaItem[] = Array.from({ length: batchCount }, (_, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      kind: modelMode,
      status: 'generating',
      prompt: activePrompt,
      modelId: activeModelId,
      modelName: activeModelName,
      ratio: activeRatio,
      timestamp: Date.now(),
      attachments: activeAttachments,
    }));

    setMediaItems(prev => [...newItems, ...prev]);

    newItems.forEach(item => {
      if (item.kind === 'image') {
        void generateSingleImage(item, activePrompt, item.modelId, item.ratio, apiKey, activeAttachments);
      } else {
        void generateSingleVideo(item, activePrompt, item.modelId as VideoModelId, item.ratio, videoDuration, apiKey, activeAttachments);
      }
    });
  };

  const handleRefreshItem = (targetItem: MediaItem) => {
    const apiKey = apiKeys?.gemini?.[0];
    if (!apiKey) return;
    
    const newItem: MediaItem = {
      id: `${Date.now()}-0-${Math.random().toString(36).slice(2, 8)}`,
      kind: targetItem.kind,
      status: 'generating',
      prompt: targetItem.prompt,
      modelId: targetItem.modelId,
      modelName: targetItem.modelName,
      ratio: targetItem.ratio,
      timestamp: Date.now(),
      attachments: targetItem.attachments,
    };
    
    setMediaItems(prev => [newItem, ...prev]);
    
    if (targetItem.kind === 'image') {
      void generateSingleImage(newItem, newItem.prompt, newItem.modelId, newItem.ratio, apiKey, newItem.attachments || []);
    } else {
      void generateSingleVideo(newItem, newItem.prompt, newItem.modelId as VideoModelId, newItem.ratio, videoDuration, apiKey, newItem.attachments || []);
    }
  };

  const handleRePromptItem = (targetItem: MediaItem) => {
    // 1. Restore the mode (Image vs. Video)
    setModelMode(targetItem.kind);

    // 2. Restore the specific model and aspect ratio used
    if (targetItem.kind === 'image') {
      setImageModel(targetItem.modelId as ImageModelId);
      setImageRatio(targetItem.ratio);
    } else {
      setVideoModel(targetItem.modelId as VideoModelId);
      setVideoRatio(targetItem.ratio);
    }

    // 3. Restore the text prompt and attachments
    setPrompt(targetItem.prompt);
    setAttachments(targetItem.attachments || []);

    // 4. Focus the prompt input area
    textareaRef.current?.focus();
  };

  const completedItems = React.useMemo(() => {
    return mediaItems.filter((m) => m.status === 'completed' && m.url);
  }, [mediaItems]);

  const selectedIdx = React.useMemo(() => {
    if (!selectedItem) return -1;
    return completedItems.findIndex((m) => m.id === selectedItem.id);
  }, [selectedItem, completedItems]);

  const K_THUMBS = 7;
  const carouselWindow = React.useMemo(() => {
    const N = completedItems.length;
    if (N === 0 || selectedIdx === -1) return { items: [] };

    // Construct exactly 15 items cycled around selectedIdx (-7 to +7 offset) for sliding animation
    const items = [];
    for (let d = -7; d <= 7; d++) {
      const idx = ((selectedIdx + d) % N + N) % N;
      items.push(completedItems[idx]);
    }
    return {
      items
    };
  }, [completedItems, selectedIdx]);

  const handleNextThumb = React.useCallback(() => {
    if (isAnimating) return;
    if (selectedIdx !== -1 && completedItems.length > 0) {
      const N = completedItems.length;
      const nextItem = completedItems[(selectedIdx + 1) % N];
      targetItemRef.current = nextItem;
      setXTranslate(-176 - 44);
      setIsAnimating(true);
    }
  }, [selectedIdx, completedItems, isAnimating]);

  const handlePrevThumb = React.useCallback(() => {
    if (isAnimating) return;
    if (selectedIdx !== -1 && completedItems.length > 0) {
      const N = completedItems.length;
      const prevItem = completedItems[(selectedIdx - 1 + N) % N];
      targetItemRef.current = prevItem;
      setXTranslate(-176 + 44);
      setIsAnimating(true);
    }
  }, [selectedIdx, completedItems, isAnimating]);

  const handleThumbClick = React.useCallback((thumbItem: MediaItem, idx: number) => {
    if (isAnimating) return;
    const offset = idx - 7;
    if (offset === 0) return; // Already selected

    targetItemRef.current = thumbItem;
    setXTranslate(-176 - offset * 44);
    setIsAnimating(true);
  }, [isAnimating]);

  const handleTransitionEnd = React.useCallback(() => {
    if (isAnimating && targetItemRef.current) {
      setSelectedItem(targetItemRef.current);
      setIsAnimating(false);
      setXTranslate(-176);
      targetItemRef.current = null;
    }
  }, [isAnimating]);

  React.useEffect(() => {
    if (selectedItem) {
      setViewerModelId(selectedItem.modelId);
      setViewerModelName(selectedItem.modelName);
    } else {
      setViewerModelId('');
      setViewerModelName('');
    }
    setIsViewerModelDropdownOpen(false);
    setViewerAttachments([]);
    setViewerRemovingIds(new Set());
    setIsViewerAssetMenuOpen(false);
  }, [selectedItem]);

  const handleViewerFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newAttachments: ImageAttachment[] = Array.from(e.target.files)
      .filter(file => file.type.startsWith('image/'))
      .map(file => ({
        id: Math.random().toString(36).substring(7),
        url: URL.createObjectURL(file),
        name: file.name,
        file
      }));
    setViewerAttachments(prev => [...prev, ...newAttachments]);
    if (viewerFileInputRef.current) viewerFileInputRef.current.value = '';
  };

  const removeViewerAttachment = (id: string) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    setHoveredAttachmentUrl(null);
    setHoveredAttachmentRect(null);

    setViewerRemovingIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setTimeout(() => {
      setViewerAttachments(prev => prev.filter(att => att.id !== id));
      setViewerRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  };

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (viewerModelDropdownRef.current && !viewerModelDropdownRef.current.contains(event.target as Node)) {
        setIsViewerModelDropdownOpen(false);
      }
    };
    if (isViewerModelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isViewerModelDropdownOpen]);

  const getAnnotatedImageBase64 = async (): Promise<{ data: string; mimeType: string } | null> => {
    if (!selectedItem || !selectedItem.url) return null;

    // Load the base image
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = selectedItem.url;

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Draw base image
    ctx.drawImage(img, 0, 0);

    const scaleX = canvas.width / 100;
    const scaleY = canvas.height / 100;

    // Draw annotations on top of the image
    annotations.forEach((ann) => {
      if (ann.type === 'draw' && ann.points && ann.points.length > 0) {
        ctx.beginPath();
        ctx.lineWidth = Math.max(1, ann.size * (canvas.width / 1000));
        ctx.strokeStyle = ann.color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.moveTo(ann.points[0].x * scaleX, ann.points[0].y * scaleY);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x * scaleX, ann.points[i].y * scaleY);
        }
        ctx.stroke();
      } else if (ann.type === 'rect' && ann.x !== undefined && ann.y !== undefined && ann.width !== undefined && ann.height !== undefined) {
        ctx.beginPath();
        ctx.lineWidth = Math.max(1, ann.size * (canvas.width / 1000));
        ctx.strokeStyle = ann.color;
        ctx.strokeRect(ann.x * scaleX, ann.y * scaleY, ann.width * scaleX, ann.height * scaleY);
      } else if (ann.type === 'text' && ann.x !== undefined && ann.y !== undefined && ann.text) {
        ctx.fillStyle = ann.color;
        const fontSize = Math.max(12, ann.size * 2.5 + 8) * (canvas.width / 800);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(ann.text, ann.x * scaleX, ann.y * scaleY);
      } else if (ann.type === 'select-box' && ann.x !== undefined && ann.y !== undefined && ann.width !== undefined && ann.height !== undefined) {
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, canvas.width / 400);
        ctx.setLineDash([Math.max(4, canvas.width / 150), Math.max(4, canvas.width / 150)]);
        ctx.strokeRect(ann.x * scaleX, ann.y * scaleY, ann.width * scaleX, ann.height * scaleY);
        ctx.restore();
      } else if (ann.type === 'select-lasso' && ann.points && ann.points.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, canvas.width / 400);
        ctx.setLineDash([Math.max(4, canvas.width / 150), Math.max(4, canvas.width / 150)]);
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x * scaleX, ann.points[0].y * scaleY);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x * scaleX, ann.points[i].y * scaleY);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    });

    const dataUrl = canvas.toDataURL('image/jpeg', 1.0);
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return {
        mimeType: match[1],
        data: match[2],
      };
    }

    return null;
  };

  const getAnnotationSystemPrompt = () => {
    const segments: string[] = [];

    const drawAnns = annotations.filter(a => a.type === 'draw');
    const textAnns = annotations.filter(a => a.type === 'text');
    const rectAnns = annotations.filter(a => a.type === 'rect');
    const boxAnns = annotations.filter(a => a.type === 'select-box');
    const lassoAnns = annotations.filter(a => a.type === 'select-lasso');

    if (drawAnns.length > 0) {
      const colors = Array.from(new Set(drawAnns.map(a => a.color))).join(', ');
      segments.push(`The user used drawing/brush annotations to paint something on the screen with the color(s): ${colors}. Please generate and edit the image based on what the user has drawn.`);
    }

    if (textAnns.length > 0) {
      const colors = Array.from(new Set(textAnns.map(a => a.color))).join(', ');
      segments.push(`The user used the text option to write text on the screen in the color(s): ${colors}.`);
    }

    if (rectAnns.length > 0) {
      const colors = Array.from(new Set(rectAnns.map(a => a.color))).join(', ');
      segments.push(`The user drew a rectangle on the screen in the color(s): ${colors} to highlight a region.`);
    }

    if (boxAnns.length > 0) {
      segments.push(`The user used a select-box tool to target a rectangular area.`);
    }

    if (lassoAnns.length > 0) {
      segments.push(`The user used a lasso tool to select a custom region.`);
    }

    if (segments.length === 0) {
      return "The user is editing this image. Please edit the image to match the user's request.";
    }

    return `The user is editing this image. Details about the user's annotations/selections:\n${segments.join('\n')}\nModify the image based on these inputs and the user request. IMPORTANT: The user's drawings, selections, and annotations are guiding masks/inputs only. Do NOT include, reproduce, or show the actual drawn outlines, brush strokes, text annotations, colors, or selections themselves in the final generated image output.`;
  };

  const handleViewerGenerate = async () => {
    if (!editPrompt.trim() || !selectedItem || isAnimating) return;

    const apiKey = apiKeys?.gemini?.[0];
    if (!apiKey) {
      setGenerationError('Google Gemini API Key is missing. Please add it under Settings > Models & API.');
      return;
    }

    setSelectedItem(null);

    const systemPrompt = getAnnotationSystemPrompt();
    const fullPrompt = `[Context: ${systemPrompt}] ${editPrompt}`;

    const isImage = selectedItem.kind === 'image';
    const newModelId = viewerModelId || selectedItem.modelId;
    const newModelName = viewerModelName || selectedItem.modelName;

    const newItem: MediaItem = {
      id: `${Date.now()}-viewer-${Math.random().toString(36).slice(2, 8)}`,
      kind: selectedItem.kind,
      status: 'generating',
      prompt: editPrompt,
      modelId: newModelId,
      modelName: newModelName,
      ratio: selectedItem.ratio,
      timestamp: Date.now(),
    };

    setMediaItems(prev => [newItem, ...prev]);

    const selectedInlinePart = await getAnnotatedImageBase64();
    const attachments: ImageAttachment[] = [];
    if (selectedInlinePart) {
      attachments.push({
        id: 'selected-base-img',
        name: 'base_image.png',
        url: `data:${selectedInlinePart.mimeType};base64,${selectedInlinePart.data}`
      });
    }

    const activeViewerAttachments = viewerAttachments.filter(att => !viewerRemovingIds.has(att.id));
    attachments.push(...activeViewerAttachments);

    if (isImage) {
      void generateSingleImage(newItem, fullPrompt, newModelId, selectedItem.ratio, apiKey, attachments);
    } else {
      void generateSingleVideo(newItem, fullPrompt, newModelId as VideoModelId, selectedItem.ratio, videoDuration, apiKey, attachments);
    }

    setEditPrompt('');
    setViewerAttachments([]);
    setViewerRemovingIds(new Set());
  };

  return (
    <div
      className="relative flex flex-col h-screen w-screen bg-[#000000] text-gray-200 overflow-hidden"
      style={{ fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif" }}
    >
      
      {/* Fading Backdrop Blur & Dark Gradient Strip */}
      <div 
        className="absolute inset-x-0 top-0 h-32 pointer-events-none z-[55]"
        style={{
          background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.95) 0%, rgba(0, 0, 0, 0.6) 40%, rgba(0, 0, 0, 0.15) 75%, transparent 100%)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          maskImage: 'linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.9) 35%, rgba(0, 0, 0, 0.3) 70%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.9) 35%, rgba(0, 0, 0, 0.3) 70%, transparent 100%)',
          transform: (isHeaderVisible && !isAtTop) ? 'translateY(0)' : 'translateY(-56px)',
          opacity: (isHeaderVisible && !isAtTop) ? 1 : 0,
          transition: isHeaderVisible
            ? 'transform 0.78s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.78s cubic-bezier(0.16, 1, 0.3, 1)'
            : 'transform 0.68s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.68s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      />

      {/* Top Header */}
      <header 
        className="absolute top-0 left-0 right-0 h-16 flex items-center justify-between px-4 shrink-0 z-[60] bg-transparent pointer-events-none"
        style={{
          transform: isHeaderVisible ? 'translateY(0)' : 'translateY(-56px)',
          opacity: isHeaderVisible ? 1 : 0,
          transition: isHeaderVisible
            ? 'transform 0.78s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.78s cubic-bezier(0.16, 1, 0.3, 1)'
            : 'transform 0.68s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.68s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        
        {/* Left Section */}
        <div className={`flex items-center gap-4 w-[300px] ${isHeaderVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
          <button className="p-2.5 hover:bg-white/10 rounded-full transition-colors">
            <ArrowLeft size={22} className="text-white" />
          </button>
          <span className="text-sm font-medium text-white tracking-wide">
            {projectName}
          </span>
          <button className="p-1 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white">
            <MoreVertical size={20} />
          </button>
        </div>

        {/* Center Section: Search */}
        <div className={`flex items-center gap-3 flex-1 justify-center max-w-2xl ${isHeaderVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
          <div className="flex items-center bg-[#171717]/90 backdrop-blur-xl rounded-2xl h-11 w-full max-w-[500px] px-4 border border-transparent hover:border-white/10 transition-colors">
            <Search size={18} className="text-gray-400" />
            <input 
              type="text" 
              className="bg-transparent border-none outline-none text-sm text-white w-full ml-3"
              placeholder=""
            />
          </div>
          <button className="flex items-center justify-center w-11 h-11 rounded-2xl bg-[#171717]/90 backdrop-blur-xl hover:bg-[#202020]/90 transition-colors border border-transparent hover:border-white/10">
            <svg 
              width="18" 
              height="18" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2.5" 
              strokeLinecap="round" 
              className="text-gray-300"
            >
              <line x1="5" y1="8" x2="19" y2="8" />
              <line x1="8" y1="12" x2="16" y2="12" />
              <line x1="11" y1="16" x2="13" y2="16" />
            </svg>
          </button>
        </div>

        {/* Right Section */}
        <div className={`flex items-center gap-4 w-[300px] justify-end ${isHeaderVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
          <button className="text-gray-300 hover:text-white transition-colors">
            <Plus size={22} />
          </button>
          <button className="text-gray-300 hover:text-white transition-colors">
            <HelpCircle size={22} />
          </button>
          <button className="text-gray-300 hover:text-white transition-colors">
            <Settings size={22} />
          </button>
          <button className="text-gray-300 hover:text-white transition-colors">
            <MoreVertical size={22} />
          </button>
          
          <button className="flex items-center h-10 bg-[#171717] rounded-full pl-3 pr-1 gap-2 hover:bg-[#202020] transition-colors border border-transparent hover:border-white/10">
            <span className="text-xs font-semibold text-gray-300 mr-1 truncate max-w-[100px]">
              {userProfile?.displayName || user?.email?.split('@')[0] || 'Guest'}
            </span>
            <Avatar
              src={userProfile?.photoURL || user?.photoURL}
              name={userProfile?.displayName || user?.email}
              size={32}
            />
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Left Sidebar */}
        <aside className={`${isSidebarCollapsed ? 'w-[74px]' : 'w-[238px]'} flex flex-col justify-between pt-[72px] pb-2 px-3 shrink-0 relative z-[70]`}>
          <nav 
            className="flex flex-col gap-1"
            style={{
              transform: isHeaderVisible ? 'translateY(0)' : 'translateY(-56px)',
              transition: `transform ${currentSidebarTransitionTiming}`
            }}
          >
            <button className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4'} px-3.5 py-3.5 bg-[#373737] rounded-2xl text-white`}>
              <AllMediaIcon className="text-gray-300" />
              {!isSidebarCollapsed && <span className="text-[13px] font-semibold tracking-wide">All Media</span>}
            </button>
            <button className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4'} px-3.5 py-3.5 hover:bg-[#171717] rounded-2xl text-white transition-colors group`}>
              <ImagesIcon className="text-gray-200 group-hover:text-white transition-colors" />
              {!isSidebarCollapsed && <span className="text-[13px] font-semibold tracking-wide text-gray-200 group-hover:text-white transition-colors">Images</span>}
            </button>
            <button className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4'} px-3.5 py-3.5 hover:bg-[#171717] rounded-2xl text-white transition-colors group`}>
              <VideoIcon className="text-gray-200 group-hover:text-white transition-colors" />
              {!isSidebarCollapsed && <span className="text-[13px] font-semibold tracking-wide text-gray-200 group-hover:text-white transition-colors">Video</span>}
            </button>
            <button className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4'} px-3.5 py-3.5 hover:bg-[#171717] rounded-2xl text-white transition-colors group`}>
              <CharactersIcon className="text-gray-200 group-hover:text-white transition-colors" />
              {!isSidebarCollapsed && <span className="text-[13px] font-semibold tracking-wide text-gray-200 group-hover:text-white transition-colors">Characters</span>}
            </button>
            <button className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4'} px-3.5 py-3.5 hover:bg-[#171717] rounded-2xl text-white transition-colors group`}>
              <ScenesIcon className="text-gray-200 group-hover:text-white transition-colors" />
              {!isSidebarCollapsed && <span className="text-[13px] font-semibold tracking-wide text-gray-200 group-hover:text-white transition-colors">Scenes</span>}
            </button>
            <button className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4'} px-3.5 py-3.5 hover:bg-[#171717] rounded-2xl text-white transition-colors group`}>
              <UploadsIcon className="text-gray-200 group-hover:text-white transition-colors" />
              {!isSidebarCollapsed && <span className="text-[13px] font-semibold tracking-wide text-gray-200 group-hover:text-white transition-colors">Uploads</span>}
            </button>

            <div className={`h-[1px] bg-white/20 ${isSidebarCollapsed ? 'mx-3' : 'mx-4'} my-2`} />

            <button className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4'} px-3.5 py-3.5 hover:bg-[#171717] rounded-2xl text-white transition-colors group`}>
              <ToolsIcon className="text-gray-200 group-hover:text-white transition-colors" />
              {!isSidebarCollapsed && <span className="text-[13px] font-semibold tracking-wide text-gray-200 group-hover:text-white transition-colors">Tools</span>}
            </button>
          </nav>

          <nav className="flex flex-col gap-1 mb-2">
            <button className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4'} px-3.5 py-3.5 hover:bg-[#171717] rounded-2xl text-white transition-colors group`}>
              <TrashIcon className="text-gray-200 group-hover:text-white transition-colors" />
              {!isSidebarCollapsed && <span className="text-[13px] font-semibold tracking-wide text-gray-200 group-hover:text-white transition-colors">Trash</span>}
            </button>
            <button
              onClick={() => setIsSidebarCollapsed(c => !c)}
              className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-4'} px-3.5 py-3.5 hover:bg-[#171717] rounded-2xl text-white transition-colors group`}
            >
              <CollapseIcon className="text-gray-200 group-hover:text-white transition-colors" />
              {!isSidebarCollapsed && <span className="text-[13px] font-semibold tracking-wide text-gray-200 group-hover:text-white transition-colors">Collapse</span>}
            </button>
          </nav>
        </aside>

        {/* Center Canvas */}
        <main 
          ref={mainRef} 
          onScroll={handleScroll} 
          className={`flex-1 bg-[#000000] relative sleek-scrollbar ${
            isAgentSidebarOpen ? 'hide-scrollbar-thumb' : ''
          } ${
            renamingItemId ? 'overflow-hidden' : 'overflow-y-auto'
          }`}
        >
          {renamingItemId && (
            <div 
              className="fixed inset-0 bg-transparent z-40 cursor-default pointer-events-auto"
              onClick={() => setRenamingItemId(null)}
            />
          )}
          {mediaItems.length > 0 && (
            <div
              className="flex flex-wrap gap-3 pt-[72px] pb-44 w-full transition-[padding-right]"
              style={{ 
                ['--th' as any]: isSidebarCollapsed ? '230px' : '270px',
                paddingRight: isAgentSidebarOpen ? '358px' : '12px',
                transitionDuration: '0.5s',
                transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)'
              }}
            >
                {mediaItems.map((item) => {
                  const ratio = item.ratio;
                  let ar = 16 / 9;
                  if (ratio === '4:3') ar = 4 / 3;
                  else if (ratio === '1:1') ar = 1;
                  else if (ratio === '3:4') ar = 3 / 4;
                  else if (ratio === '9:16') ar = 9 / 16;

                  const targetH = isSidebarCollapsed ? 230 : 270;
                  const gap = 12;
                  const naturalW = targetH * ar;
                  const visibleWidth = isAgentSidebarOpen ? canvasInnerWidth - 346 : canvasInnerWidth;
                  const itemsPerRow = visibleWidth > 0
                    ? Math.max(1, Math.floor((visibleWidth + gap) / (naturalW + gap)))
                    : 0;
                  const maxW = itemsPerRow > 0
                    ? (visibleWidth - (itemsPerRow - 1) * gap) / itemsPerRow
                    : 0;

                  return (
                    <div
                      key={item.id}
                      draggable={!renamingItemId && activeMenuId === null}
                      onDragStart={(e) => {
                        setHoveredTileId(null);
                        setActiveMenuId(null);
                        setDragMousePos({ x: e.clientX, y: e.clientY });
                        
                        if (blankDragImage) {
                          e.dataTransfer.setDragImage(blankDragImage, 0, 0);
                        }
                        e.dataTransfer.effectAllowed = 'move';
                        setDraggingItemId(item.id);
                      }}
                      onDragEnd={() => {
                        setDraggingItemId(null);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                      }}
                      style={{
                        flexGrow: ar,
                        flexBasis: `calc(var(--th) * ${ar})`,
                        minWidth: `calc(var(--th) * ${ar} * 0.75)`,
                        maxWidth: maxW > 0 ? `${maxW}px` : undefined,
                        aspectRatio: ar,
                        borderWidth: item.status === 'completed' ? '0.5px' : '0px',
                        borderColor: item.status === 'completed' ? '#0e0e10' : 'transparent',
                        cursor: renamingItemId === item.id ? 'default' : draggingItemId === item.id ? 'grabbing' : 'grab',
                      }}
                      className={`gallery-tile relative rounded-[18px] bg-[#0c0c0c] shadow-2xl ${
                        draggingItemId ? '' : 'group'
                      } ${
                        item.status === 'completed' ? 'border' : 'border-none'
                      } ${
                        renamingItemId === item.id 
                          ? 'overflow-visible z-50' 
                          : activeMenuId === item.id 
                            ? 'overflow-visible z-40' 
                            : draggingItemId === item.id
                              ? 'overflow-visible z-50'
                              : 'overflow-hidden z-10'
                      }`}
                      onClick={() => {
                        if (renamingItemId === item.id) return;
                        if (item.status === 'completed' && item.url) {
                          setSelectedItem(item);
                        }
                      }}
                      onMouseEnter={() => setHoveredTileId(item.id)}
                      onMouseLeave={() => {
                        setHoveredTileId(null);
                        if (activeMenuId === item.id) setActiveMenuId(null);
                      }}
                    >
                      <TileContent 
                        item={item} 
                        isMenuOpen={activeMenuId === item.id} 
                        onMenuOpenChange={(open) => setActiveMenuId(open ? item.id : null)} 
                        isHovered={hoveredTileId === item.id}
                        onCancel={(id) => setMediaItems(prev => prev.filter(m => m.id !== id))}
                        onRefresh={handleRefreshItem}
                        onRePrompt={handleRePromptItem}
                        onDelete={(id) => setMediaItems(prev => prev.filter(m => m.id !== id))}
                        onRename={(id, newName) => {
                          setMediaItems(prev => prev.map(m => m.id === id ? { ...m, shortenedPrompt: newName } : m));
                        }}
                        isRenaming={renamingItemId === item.id}
                        setIsRenaming={(renaming) => setRenamingItemId(renaming ? item.id : null)}
                        onAddToPrompt={(targetItem) => {
                          if (targetItem.url) {
                            setAttachments(prev => {
                              if (prev.some(att => att && att.url === targetItem.url)) return prev;
                              return [...prev, {
                                id: targetItem.id,
                                url: targetItem.url,
                                name: targetItem.shortenedPrompt || targetItem.prompt || 'Attached Media',
                                kind: targetItem.kind
                              }];
                            });
                            setTimeout(() => {
                              textareaRef.current?.focus();
                            }, 50);
                          }
                        }}
                        onAnimate={(targetItem) => {
                          setModelMode('video');
                          setVideoMode('frames');
                          if (targetItem.url) {
                            setAttachments(prev => {
                              if (prev.some(att => att && att.url === targetItem.url)) return prev;
                              const next = [...prev, {
                                id: targetItem.id,
                                url: targetItem.url,
                                name: targetItem.shortenedPrompt || targetItem.prompt || 'Attached Media',
                                kind: targetItem.kind
                              }];
                              return next.slice(0, 2);
                            });
                            setTimeout(() => {
                              textareaRef.current?.focus();
                            }, 50);
                          }
                        }}
                      />
                      
                      {/* Smooth fading local dark overlay for all other images/videos */}
                      <div 
                        className={`absolute inset-0 bg-black/55 rounded-[18px] z-[35] pointer-events-none transition-opacity duration-[300ms] ease-out ${
                          (renamingItemId && renamingItemId !== item.id) || (draggingItemId && draggingItemId !== item.id) ? 'opacity-100' : 'opacity-0'
                        }`}
                      />
                    </div>
                  );
                })}
            </div>
          )}
        </main>
      </div>

      {/* Centered Flower Empty State */}
      {mediaItems.length === 0 && (
        <div 
          className="absolute top-[48%] flex flex-col items-center justify-center pointer-events-none z-10 transition-all"
          style={{
            left: isAgentSidebarOpen ? 'calc(50% - 178px)' : '50%',
            transform: 'translate(-50%, -50%)',
            transitionDuration: '0.5s',
            transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          <div className="relative mb-5 text-gray-500/20 w-[110px] h-[149px] flex items-center justify-center overflow-visible">
            <div
              style={{
                position: 'absolute',
                width: '8px',
                height: '8px',
                left: '50%',
                top: '50%',
                transform: 'translate(-97.6px, -98.8px) scale(0.6)',
                boxShadow: SUNFLOWER_BOX_SHADOW
              } as any}
            />
          </div>

          <p className="text-lg text-gray-500 font-medium">
            Start creating or drop media
          </p>
        </div>
      )}

      {/* Bottom Prompt Bar */}
      <div 
        className="absolute bottom-8 left-1/2 w-full max-w-[600px] z-50 transition-all duration-300 ease-in-out"
        style={{
          opacity: isAgentSidebarOpen ? 0 : 1,
          transform: 'translate(-50%, 0px)',
          pointerEvents: isAgentSidebarOpen ? 'none' : 'auto'
        }}
      >
        <AssetMenuModal
          isOpen={isAssetMenuOpen && assetMenuSource === 'main'}
          onClose={() => setIsAssetMenuOpen(false)}
          buttonRef={assetMenuPlusRef}
          openedFrom="main"
          projectName={projectName}
          mediaItems={mediaItems}
          onFileSelect={() => fileInputRef.current?.click()}
          onAddPrompt={(assetId, assetUrl, assetTitle, assetKind) => {
            if (assetUrl) {
              setAttachments(prev => {
                if (prev.some(att => att && att.url === assetUrl)) return prev;
                const next = [...prev, {
                  id: assetId,
                  url: assetUrl,
                  name: assetTitle || 'Attached Image',
                  kind: assetKind || 'image'
                }];
                return (modelMode === 'video' && videoMode === 'frames') ? next.slice(0, 2) : next;
              });
            } else if (assetTitle) {
              setPrompt(prev => {
                const separator = prev.trim() ? ' ' : '';
                return `${prev.trim()}${separator}[${assetTitle}]`;
              });
            }
          }}
        />
        <div 
          className={`relative rounded-[22px] flex flex-col prompt-container-box ${
            (draggingItemId && isFramesMode)
              ? 'bg-transparent border-none shadow-none p-0'
              : 'bg-[#141517]/90 backdrop-blur-[80px] pt-3 pb-2 px-3 shadow-2xl border'
          } ${
            (draggingItemId && !isFramesMode) ? 'transition-all duration-300' : ''
          }`}
          style={{
            transform: (isDragOverPrompt && !isFramesMode) ? 'scale(1.015)' : 'scale(1)',
            transition: (draggingItemId && !isFramesMode) ? 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
            borderWidth: (isDragOverPrompt && !isFramesMode) ? '1.5px' : ((draggingItemId && isFramesMode) ? '0px' : '1px'),
            borderColor: (isDragOverPrompt && !isFramesMode) ? 'rgba(255, 255, 255, 0.9)' : ((draggingItemId && isFramesMode) ? 'transparent' : 'rgba(255, 255, 255, 0.05)')
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            if (draggingItemId) setIsDragOverPrompt(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragOverPrompt(false);
            if (isFramesMode) {
              setDraggedOverZone(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOverPrompt(false);
            if (isFramesMode) {
              setDraggedOverZone(null);
            }
            if (draggingItemId) {
              const draggedItem = mediaItems.find(m => m.id === draggingItemId);
              if (draggedItem && draggedItem.url) {
                setAttachments(prev => {
                  if (prev.some(att => att && att.url === draggedItem.url)) return prev;
                  return [...prev, {
                    id: draggedItem.id,
                    url: draggedItem.url,
                    name: draggedItem.shortenedPrompt || draggedItem.prompt || 'Attached Media',
                    kind: draggedItem.kind
                  }];
                });
              }
              setDraggingItemId(null);
            }
          }}
        >
          {draggingItemId !== null ? (
            isFramesMode ? (
              <div className="flex gap-3 w-full h-[96px]" onMouseLeave={() => setDraggedOverZone(null)}>
                {/* Start Frame Dropzone */}
                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDraggedOverZone('start');
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDraggedOverZone('start');
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setDraggedOverZone(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDraggedOverZone(null);
                    setIsDragOverPrompt(false);
                    if (draggingItemId) {
                      const draggedItem = mediaItems.find(m => m.id === draggingItemId);
                      if (draggedItem && draggedItem.url) {
                        setAttachments(prev => {
                          const next = [...prev];
                          next[0] = {
                            id: `${draggedItem.id}-${Math.random().toString(36).substring(7)}`,
                            url: draggedItem.url,
                            name: draggedItem.shortenedPrompt || draggedItem.prompt || 'Attached Media',
                            kind: draggedItem.kind
                          };
                          return next;
                        });
                      }
                      setDraggingItemId(null);
                    }
                  }}
                  style={{
                    transform: draggedOverZone === 'start' ? 'scale(1.015)' : 'scale(1)',
                    borderWidth: draggedOverZone === 'start' ? '1.5px' : '1px',
                    borderColor: draggedOverZone === 'start' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.05)',
                    transition: draggingItemId ? 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
                  }}
                  className="flex-1 flex items-center justify-center bg-[#18191b] rounded-[22px] select-none cursor-pointer border border-solid"
                >
                  <span className="text-[15px] font-semibold text-white tracking-wide pointer-events-none flex items-center gap-1.5">
                    <span className="text-[17px] font-light leading-none pointer-events-none">+</span> Add start frame
                  </span>
                </div>

                {/* End Frame Dropzone */}
                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDraggedOverZone('end');
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDraggedOverZone('end');
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setDraggedOverZone(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDraggedOverZone(null);
                    setIsDragOverPrompt(false);
                    if (draggingItemId) {
                      const draggedItem = mediaItems.find(m => m.id === draggingItemId);
                      if (draggedItem && draggedItem.url) {
                        setAttachments(prev => {
                          const next = [...prev];
                          next[1] = {
                            id: `${draggedItem.id}-${Math.random().toString(36).substring(7)}`,
                            url: draggedItem.url,
                            name: draggedItem.shortenedPrompt || draggedItem.prompt || 'Attached Media',
                            kind: draggedItem.kind
                          };
                          return next;
                        });
                      }
                      setDraggingItemId(null);
                    }
                  }}
                  style={{
                    transform: draggedOverZone === 'end' ? 'scale(1.015)' : 'scale(1)',
                    borderWidth: draggedOverZone === 'end' ? '1.5px' : '1px',
                    borderColor: draggedOverZone === 'end' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.05)',
                    transition: draggingItemId ? 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
                  }}
                  className="flex-1 flex items-center justify-center bg-[#18191b] rounded-[22px] select-none cursor-pointer border border-solid"
                >
                  <span className="text-[15px] font-semibold text-white tracking-wide pointer-events-none flex items-center gap-1.5">
                    <span className="text-[17px] font-light leading-none pointer-events-none">+</span> Add end frame
                  </span>
                </div>
              </div>
            ) : (
              <div 
                className="flex items-center justify-center w-full select-none pointer-events-none"
                style={{ height: '76px' }}
              >
                <span className="text-[15px] font-semibold text-white tracking-wide pointer-events-none">
                  + Add Ingredient
                </span>
              </div>
            )
          ) : (
            <>
          {hoveredAttachmentUrl && hoveredAttachmentRect && (
            <div 
              style={{
                left: `${hoveredAttachmentRect.left + hoveredAttachmentRect.width / 2}px`,
                transform: 'translate(-50%, 0)'
              }}
              className="absolute bottom-full z-50 pointer-events-auto pb-0"
              onMouseEnter={() => {
                if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
              }}
              onMouseLeave={() => {
                setHoveredAttachmentUrl(null);
                setHoveredAttachmentRect(null);
              }}
            >
              <div className="shadow-2xl overflow-hidden preview-fade-in">
                <img 
                  src={hoveredAttachmentUrl} 
                  className="max-h-[320px] max-w-[400px] object-contain rounded-[18px] border-[5px] border-[#444c57] bg-[#121214]" 
                />
              </div>
              {/* Invisible bridge to cover prompt box padding gap */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 w-16 h-[24px] bg-transparent" />
            </div>
          )}
        {(isAgentActive && agentAnimationKey > 0) && (
          <div 
            key={`toggle-${agentAnimationKey}`}
            className="absolute inset-0 z-30 pointer-events-none rounded-[22px] overflow-hidden"
          >
            <svg width="100%" height="100%" className="absolute inset-0 mix-blend-screen animate-[parent-fade_1.8s_ease-in-out_forwards]">
              <filter id="glow-blur">
                <feGaussianBlur stdDeviation="11" />
              </filter>
              <g filter="url(#glow-blur)">
                <rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" fill="none" stroke="#82858b" strokeWidth="13"
                      pathLength="100" strokeDasharray="60 40" className="animate-[snake-stroke_1.8s_linear_forwards]" style={{ animationDelay: '0.1s', opacity: 0.15 }} strokeLinecap="round" />
                <rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" fill="none" stroke="#82858b" strokeWidth="13"
                      pathLength="100" strokeDasharray="60 40" className="animate-[snake-stroke_1.8s_linear_forwards]" style={{ animationDelay: '0.05s', opacity: 0.4 }} strokeLinecap="round" />
                <rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" fill="none" stroke="#82858b" strokeWidth="13"
                      pathLength="100" strokeDasharray="60 40" className="animate-[snake-stroke_1.8s_linear_forwards]" style={{ animationDelay: '0s', opacity: 0.9 }} strokeLinecap="round" />
              </g>
            </svg>
          </div>
        )}

        <AnimatePresence>
          {(isAgentActive && isAgentGenerating) && (
            <motion.div 
              key="thinking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="absolute inset-0 z-30 pointer-events-none rounded-[22px] overflow-hidden"
            >
              <svg width="100%" height="100%" className="absolute inset-0 mix-blend-screen opacity-80">
                <filter id="glow-blur-thinking">
                  <feGaussianBlur stdDeviation="11" />
                </filter>
                <g filter="url(#glow-blur-thinking)">
                  <rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" fill="none" stroke="#82858b" strokeWidth="13"
                        pathLength="100" strokeDasharray="60 40" className="animate-[btn-snake-dynamic_2.5s_infinite]" style={{ animationDelay: '0.1s', opacity: 0.15 }} strokeLinecap="round" />
                  <rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" fill="none" stroke="#82858b" strokeWidth="13"
                        pathLength="100" strokeDasharray="60 40" className="animate-[btn-snake-dynamic_2.5s_infinite]" style={{ animationDelay: '0.05s', opacity: 0.4 }} strokeLinecap="round" />
                  <rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" fill="none" stroke="#82858b" strokeWidth="13"
                        pathLength="100" strokeDasharray="60 40" className="animate-[btn-snake-dynamic_2.5s_infinite]" style={{ animationDelay: '0s', opacity: 0.9 }} strokeLinecap="round" />
                </g>
              </svg>
            </motion.div>
          )}
        </AnimatePresence>

          <input 
            type="file" 
            multiple 
            accept="image/*"
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileSelect} 
          />

          {/* Attachments Area */}
          <div className={`grid transition-[grid-template-rows,margin-bottom] duration-[250ms] ease-in-out ${(hasActiveAttachments || (modelMode === 'video' && videoMode === 'frames')) ? 'grid-rows-[1fr] mb-0' : 'grid-rows-[0fr] mb-0'}`}>
            <div className="overflow-hidden">
              {showFramesPlaceholders ? (
                <div className="flex items-center gap-2 px-2 pt-2 pb-2.5">
                  {/* Start Frame */}
                  {attachments[0] ? (
                    <div 
                      onMouseEnter={(e) => handleAttachmentMouseEnter(e, attachments[0].url)}
                      onMouseLeave={handleAttachmentMouseLeave}
                      className={`relative group flex-shrink-0 p-1.5 -m-1.5 transition-all duration-200 ${removingIds.has(attachments[0].id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}
                    >
                      <div className="relative">
                        <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1e]">
                          {attachments[0].kind === 'video' ? (
                            <video src={attachments[0].url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" muted loop playsInline />
                          ) : (
                            <img src={attachments[0].url} alt={attachments[0].name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                          )}
                        </div>
                        <button 
                          onClick={() => removeAttachment(attachments[0].id)}
                          className={`absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 transition-all duration-200 shadow-xl z-[60] ${
                            hoveredAttachmentUrl === attachments[0].url ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
                          }`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAssetMenuSource('main');
                        setIsAssetMenuOpen(true);
                      }}
                      className="w-16 h-16 flex items-center justify-center rounded-2xl border border-dashed border-white/20 bg-transparent hover:bg-white/[0.02] hover:border-white/35 transition-all duration-200 cursor-pointer outline-none group"
                    >
                      <span className="text-[12px] font-semibold text-[#909398] group-hover:text-white transition-colors select-none">Start</span>
                    </button>
                  )}

                   {/* Arrow Icon ⇆ */}
                  <div className="flex items-center justify-center select-none text-[#505050] shrink-0">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                      {/* Top arrow pointing right (distinctly shifted right) */}
                      <path d="M 7,5.5 H 16 V 2.5 L 23,7 L 16,11.5 V 8.5 H 7 Z" />
                      {/* Bottom arrow pointing left (distinctly shifted left) */}
                      <path d="M 17,15.5 H 8 V 12.5 L 1,17 L 8,21.5 V 18.5 H 17 Z" />
                    </svg>
                  </div>

                  {/* End Frame */}
                  {attachments[1] ? (
                    <div 
                      onMouseEnter={(e) => handleAttachmentMouseEnter(e, attachments[1].url)}
                      onMouseLeave={handleAttachmentMouseLeave}
                      className={`relative group flex-shrink-0 p-1.5 -m-1.5 transition-all duration-200 ${removingIds.has(attachments[1].id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}
                    >
                      <div className="relative">
                        <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1e]">
                          {attachments[1].kind === 'video' ? (
                            <video src={attachments[1].url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" muted loop playsInline />
                          ) : (
                            <img src={attachments[1].url} alt={attachments[1].name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                          )}
                        </div>
                        <button 
                          onClick={() => removeAttachment(attachments[1].id)}
                          className={`absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 transition-all duration-200 shadow-xl z-[60] ${
                            hoveredAttachmentUrl === attachments[1].url ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
                          }`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAssetMenuSource('main');
                        setIsAssetMenuOpen(true);
                      }}
                      className="w-16 h-16 flex items-center justify-center rounded-2xl border border-dashed border-white/20 bg-transparent hover:bg-white/[0.02] hover:border-white/35 transition-all duration-200 cursor-pointer outline-none group"
                    >
                      <span className="text-[12px] font-semibold text-[#909398] group-hover:text-white transition-colors select-none">End</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2.5 px-2 pt-2">
                  {attachments.filter(Boolean).map((att) => (
                    <div 
                      key={att.id} 
                      onMouseEnter={(e) => handleAttachmentMouseEnter(e, att.url)}
                      onMouseLeave={handleAttachmentMouseLeave}
                      className={`relative group flex-shrink-0 p-1.5 -m-1.5 transition-all duration-200 ${removingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}
                    >
                      <div className="relative">
                        <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1e]">
                          {att.kind === 'video' ? (
                            <video src={att.url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" muted loop playsInline />
                          ) : (
                            <img src={att.url} alt={att.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                          )}
                        </div>
                        <button 
                          onClick={() => removeAttachment(att.id)}
                          className={`absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 transition-all duration-200 shadow-xl z-[60] ${
                            hoveredAttachmentUrl === att.url ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
                          }`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <style>{`
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
            .no-scrollbar::-webkit-scrollbar {
              display: none;
            }
            .sleek-scrollbar::-webkit-scrollbar {
              width: 8px;
              height: 8px;
            }
            .sleek-scrollbar::-webkit-scrollbar-track {
              background: transparent;
            }
            .sleek-scrollbar::-webkit-scrollbar-thumb {
              background: rgba(255, 255, 255, 0.12);
              border-radius: 99px;
              border: 2px solid transparent;
              background-clip: padding-box;
            }
            .sleek-scrollbar::-webkit-scrollbar-thumb:hover {
              background: rgba(255, 255, 255, 0.25);
              border: 2px solid transparent;
              background-clip: padding-box;
            }
            .sleek-scrollbar.hide-scrollbar-thumb::-webkit-scrollbar-thumb {
              background: transparent !important;
            }
            .sleek-scrollbar.hide-scrollbar-thumb::-webkit-scrollbar-thumb:hover {
              background: transparent !important;
            }
            @keyframes quickFadeIn {
              0% { opacity: 0; }
              100% { opacity: 1; }
            }
            .preview-fade-in {
              animation: quickFadeIn 230ms ease-out forwards;
            }
            @keyframes shimmer {
              0% { background-position: 200% 0; }
              100% { background-position: -200% 0; }
            }
            @keyframes snake-stroke {
              0% { 
                stroke-dashoffset: 85;
                animation-timing-function: cubic-bezier(0.4, 0, 0.8, 1);
              }
              29% { 
                stroke-dashoffset: 68;
                animation-timing-function: linear;
              }
              52% { 
                stroke-dashoffset: 13;
                animation-timing-function: cubic-bezier(0.25, 1, 0.5, 1);
              }
              100% { 
                stroke-dashoffset: -42; 
              }
            }
            @keyframes parent-fade {
              0% { opacity: 0; }
              35% { opacity: 0.80; }
              75% { opacity: 0.80; }
              100% { opacity: 0; }
            }
            @keyframes btn-snake {
              0% { stroke-dashoffset: 0; }
              100% { stroke-dashoffset: -100; }
            }
            @keyframes btn-snake-dynamic {
              0% { 
                stroke-dashoffset: 0;
                animation-timing-function: cubic-bezier(0.7, 0.2, 0.2, 0.8);
              }
              100% { 
                stroke-dashoffset: -100; 
              }
            }
            @keyframes btn-blur-travel {
              0% { left: 18px; top: 0px; }
              30% { left: calc(100% - 18px); top: 0px; }
              34% { left: calc(100% - 5px); top: 5px; }
              38% { left: 100%; top: 18px; }
              42% { left: calc(100% - 5px); top: calc(100% - 5px); }
              46% { left: calc(100% - 18px); top: 100%; }
              76% { left: 18px; top: 100%; }
              80% { left: 5px; top: calc(100% - 5px); }
              84% { left: 0px; top: 18px; }
              88% { left: 5px; top: 5px; }
              92% { left: 18px; top: 0px; }
              100% { left: 18px; top: 0px; }
            }
            .top-fade {
              mask-image: linear-gradient(to bottom, transparent 0%, black 32px, black 100%);
              -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 32px, black 100%);
            }
            .bottom-fade {
              mask-image: linear-gradient(to bottom, black 0%, black calc(100% - 32px), transparent 100%);
              -webkit-mask-image: linear-gradient(to bottom, black 0%, black calc(100% - 32px), transparent 100%);
            }
            .both-fade {
              mask-image: linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%);
              -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%);
            }
            .gallery-tile {
              will-change: transform;
              contain: layout paint;
            }
            .gallery-tile.overflow-visible {
              contain: none !important;
            }
            .gallery-tile:hover img, .gallery-tile:hover video {
              transform: scale(1) !important;
            }
          `}</style>

          {generationError && (
            <div className="p-3 mx-1 bg-red-950/20 border border-red-500/20 rounded-xl text-xs text-red-300 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-1 duration-200">
              <span className="font-semibold leading-relaxed">{generationError}</span>
              <button onClick={() => setGenerationError(null)} className="p-1 hover:bg-white/5 rounded-full text-red-400 hover:text-white transition-colors shrink-0 cursor-pointer">
                <X size={14} strokeWidth={2.5} />
              </button>
            </div>
          )}

          <div className="relative flex items-start w-full">
            {isAgentGenerating ? (
              <div className="w-full flex items-start min-h-[24px]">
                <TextShimmer className="text-[14px] font-medium pl-1 py-0.5" duration={1.5}>
                  {agentThinkingPhase === 'searching' ? 'Searching...' :
                   agentThinkingPhase === 'executing' ? 'Running code...' : 'Thinking...'}
                </TextShimmer>
              </div>
            ) : (
              <textarea 
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onScroll={(e) => updateFades(e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  const imageFiles: File[] = [];
                  for (let i = 0; i < items.length; i++) {
                    if (items[i].type.startsWith('image/')) {
                      const file = items[i].getAsFile();
                      if (file) imageFiles.push(file);
                    }
                  }
                  if (imageFiles.length > 0) {
                    e.preventDefault();
                    const newAttachments: ImageAttachment[] = imageFiles.map(file => ({
                      id: Math.random().toString(36).substring(7),
                      url: URL.createObjectURL(file),
                      name: file.name || `pasted-image.${file.type.split('/')[1] || 'png'}`,
                      file
                    }));
                    setAttachments(prev => {
                      const next = [...prev, ...newAttachments];
                      return (modelMode === 'video' && videoMode === 'frames') ? next.slice(0, 2) : next;
                    });
                  }
                }}
                rows={1}
                placeholder="What do you want to create?" 
                className={`bg-transparent border-none outline-none text-[14px] font-medium text-white placeholder-[#606060] w-full pl-1 py-0.5 resize-none max-h-[384px] overflow-y-auto no-scrollbar transition-all duration-200 ${
                  isTopFaded && isBottomFaded ? 'both-fade' : 
                  isTopFaded ? 'top-fade' : 
                  isBottomFaded ? 'bottom-fade' : ''
                }`}
                style={{ 
                  scrollbarWidth: 'none', 
                  msOverflowStyle: 'none', 
                  paddingRight: isAgentActive ? (prompt ? '44px' : '24px') : (prompt ? '20px' : '14px') 
                }}
              />
            )}
            {isAgentActive ? (
              <div className="absolute right-[-4px] top-[-4px] flex items-center gap-1">
                {/* Clear Button (shown if text is entered and not generating) */}
                {prompt && !isAgentGenerating && (
                  <button 
                    onClick={() => setPrompt('')}
                    className="text-[#909398] hover:text-white transition-colors p-0.5 rounded-full hover:bg-white/5 cursor-pointer outline-none focus:outline-none focus:ring-0"
                    title="Clear prompt"
                  >
                    <X size={14} strokeWidth={2.5} />
                  </button>
                )}
                
                {/* Agent View/Focus Corners Button (always visible in Agent mode) */}
                <button 
                  onClick={() => setIsAgentSidebarOpen(true)}
                  className="text-[#909398] hover:text-white transition-colors p-0.5 rounded-full hover:bg-white/5 cursor-pointer outline-none focus:outline-none focus:ring-0"
                  title="Expand view"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="butt" strokeLinejoin="miter" className="w-4 h-4">
                    {/* Top-Right Corner */}
                    <path d="M 13,5 L 19,5 L 19,11" />
                    {/* Bottom-Left Corner */}
                    <path d="M 11,19 L 5,19 L 5,13" />
                  </svg>
                </button>
              </div>
            ) : (
              prompt && (
                <button 
                  onClick={() => setPrompt('')}
                  className="absolute right-[-4px] top-[-4px] text-gray-500 hover:text-white transition-colors p-0.5 rounded-full hover:bg-white/5 cursor-pointer"
                  title="Clear prompt"
                >
                  <X size={14} strokeWidth={2.5} />
                </button>
              )
            )}
          </div>
          
          <div className="flex items-center justify-between mt-2.5">
            
            {/* Left Controls */}
            <div className="flex items-center gap-2.5 relative">
              <button
                ref={assetMenuPlusRef}
                disabled={isAgentGenerating}
                onClick={() => {
                  setAssetMenuSource('main');
                  setIsAssetMenuOpen(!isAssetMenuOpen);
                }}
                className={`text-[#a0a0a0] transition-colors ml-0 outline-none ${isAgentGenerating ? 'opacity-40 cursor-not-allowed' : 'hover:text-white cursor-pointer'}`}
              >
                <Plus size={22} strokeWidth={1.5} />
              </button>
              <button 
                onClick={() => {
                  if (isAgentGenerating) return;
                  const nextActive = !isAgentActive;
                  setIsAgentActive(nextActive);
                  if (nextActive) {
                    setAgentAnimationKey(prev => prev + 1);
                  }
                }}
                className={`flex items-center justify-center h-9 transition-colors rounded-full px-4 border relative z-40 ${
                  isAgentActive 
                    ? 'bg-white text-black hover:bg-gray-200 border-transparent overflow-visible' 
                    : 'bg-[#27282b] hover:bg-[#33343a] border-transparent text-[#d0d0d0] overflow-hidden'
                }`}
              >
                <span className={`text-[11px] font-semibold tracking-wide relative z-10 ${isAgentActive ? 'text-black' : 'text-[#d0d0d0]'}`}>Agent</span>
              </button>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2.5 relative">
              {isAgentActive ? (
                <div className="flex items-center gap-1" key="agent-buttons-wrapper">
                  {/* Document with Sparkle Button */}
                  <button
                    key="agent-docs-btn"
                    className="flex items-center justify-center w-9 h-9 rounded-full text-[#a0a0a0] transition-colors outline-none focus:outline-none focus:ring-0 active:scale-[0.93] hover:bg-white/5 hover:text-white cursor-pointer"
                    title="Agent Documents"
                  >
                    <svg viewBox="16 10 76 76" className="w-5 h-5">
                      <path 
                        d="M 52,24 L 28,24 A 4,4 0 0,0 24,28 L 24,72 A 4,4 0 0,0 28,76 L 72,76 A 4,4 0 0,0 76,72 L 76,52" 
                        fill="none" 
                        stroke="currentColor" 
                        strokeWidth="6" 
                        strokeLinecap="round"
                      />
                      <g fill="currentColor">
                        <rect x="34" y="34" width="18" height="6" rx="1" />
                        <rect x="34" y="47" width="30" height="6" rx="1" />
                        <rect x="34" y="60" width="18" height="6" rx="1" />
                        <path d="M 72,16 Q 72,32 56,32 Q 72,32 72,48 Q 72,32 88,32 Q 72,32 72,16 Z" />
                      </g>
                    </svg>
                  </button>

                  {/* Settings Sliders Button */}
                  <button
                    key="agent-settings-btn"
                    className="flex items-center justify-center w-9 h-9 rounded-full text-[#a0a0a0] transition-colors outline-none focus:outline-none focus:ring-0 active:scale-[0.93] hover:bg-white/5 hover:text-white cursor-pointer"
                    title="Agent Settings"
                  >
                    <svg viewBox="0 0 100 100" className="w-5 h-5">
                      <g fill="currentColor">
                        {/* Top Row */}
                        <rect x="14" y="22" width="40" height="8" rx="1.5" />
                        <rect x="62" y="14" width="8" height="24" rx="1.5" />
                        <rect x="70" y="22" width="16" height="8" rx="1.5" />
                        
                        {/* Middle Row */}
                        <rect x="14" y="46" width="16" height="8" rx="1.5" />
                        <rect x="30" y="38" width="8" height="24" rx="1.5" />
                        <rect x="46" y="46" width="40" height="8" rx="1.5" />
                        
                        {/* Bottom Row */}
                        <rect x="14" y="70" width="24" height="8" rx="1.5" />
                        <rect x="46" y="62" width="8" height="24" rx="1.5" />
                        <rect x="54" y="70" width="32" height="8" rx="1.5" />
                      </g>
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="relative" ref={menuRef} key="model-selector-wrapper">
                  <button
                    key="model-selector-btn"
                    onClick={() => (isModelMenuOpen ? setIsModelMenuOpen(false) : openModelMenu())}
                    className={`flex items-center h-9 transition-colors rounded-full px-3.5 gap-1.5 outline-none ${isModelMenuOpen ? 'bg-[#33343a]' : 'bg-[#27282b] hover:bg-[#33343a]'}`}
                  >
                    {(() => {
                      const activeName = modelMode === 'image' ? getImageModelName(imageModel) : getVideoModelName(videoModel);
                      return activeName.toLowerCase().includes('banana') ? (
                        <span className="text-[11px]">🍌</span>
                      ) : null;
                    })()}
                    <span className="text-[11px] font-semibold text-[#d0d0d0]">
                      {modelMode === 'image' ? getImageModelName(imageModel) : getVideoModelName(videoModel)}
                    </span>
                    <div className="text-[#888888] flex items-center justify-center">
                      <RatioIcon ratio={modelMode === 'image' ? imageRatio : videoRatio} className="w-3 h-3" />
                    </div>
                    <span className="text-[11px] font-bold text-[#888888]">
                      {modelMode === 'image' ? imageBatch : videoBatch}
                    </span>
                  </button>

                  {createPortal(
                  <AnimatePresence>
                  {isModelMenuOpen && menuRect && (
                    <motion.div
                      ref={popupRef}
                      layout
                      initial={{ opacity: 0, scale: 0.96, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96, y: 8 }}
                      transition={{
                        layout: { duration: 0.32, ease: [0.32, 0.72, 0, 1] },
                        opacity: { duration: 0.16, ease: 'easeOut' },
                        scale: { duration: 0.22, ease: [0.32, 0.72, 0, 1] },
                        y: { duration: 0.22, ease: [0.32, 0.72, 0, 1] },
                      }}
                      style={{
                        position: 'fixed',
                        bottom: menuRect.bottom,
                        right: menuRect.right,
                        originY: 1,
                        originX: 1,
                        willChange: 'transform, height, opacity',
                      }}
                      className="w-[270px] bg-[#141517]/90 backdrop-blur-xl rounded-[22px] p-1.5 flex flex-col gap-1.5 shadow-2xl border border-white/5 z-50 overflow-hidden"
                    >

                      {/* Top Tabs */}
                      <motion.div layout="position" className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                        <button
                          onClick={() => {
                            setModelMode('image');
                            setIsImageModelDropdownOpen(false);
                            setIsVideoModelDropdownOpen(false);
                          }}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[10px] transition-colors font-normal ${modelMode === 'image' ? 'bg-[#f4f4f4] text-black' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                        >
                          <ImageIcon size={14} strokeWidth={2} />
                          <span className="text-[13px]">Image</span>
                        </button>
                        <button
                          onClick={() => {
                            setModelMode('video');
                            setIsImageModelDropdownOpen(false);
                            setIsVideoModelDropdownOpen(false);
                          }}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[10px] transition-colors font-normal ${modelMode === 'video' ? 'bg-[#f4f4f4] text-black' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                        >
                          <PlayCircle size={14} strokeWidth={2} />
                          <span className="text-[13px]">Video</span>
                        </button>
                      </motion.div>

                      <motion.div layout="position" className="relative w-full flex flex-col">
                      <AnimatePresence mode="popLayout" initial={false}>
                      {modelMode === 'image' ? (
                        <motion.div
                          key="image-panel"
                          layout="position"
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                          variants={{
                            hidden: { opacity: 0 },
                            visible: {
                              opacity: 1,
                              transition: { staggerChildren: 0.035 },
                            },
                            exit: {
                              opacity: 0,
                              transition: { staggerChildren: 0.02, staggerDirection: -1 },
                            },
                          }}
                          className="w-full flex flex-col gap-1.5"
                        >
                          {/* Image Aspect Ratios */}
                          <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1 justify-between">
                            {['16:9', '4:3', '1:1', '3:4', '9:16'].map(ratio => (
                              <button
                                key={ratio}
                                onClick={() => setImageRatio(ratio)}
                                className={`flex-1 flex flex-col items-center justify-center gap-1 py-1.5 rounded-[10px] transition-colors ${imageRatio === ratio ? 'bg-[#4a4a4a]' : 'hover:bg-white/5'}`}
                              >
                                <RatioIcon ratio={ratio} className="w-4 h-4" />
                                <span className={`text-[11px] font-normal text-white`}>{ratio}</span>
                              </button>
                            ))}
                          </motion.div>

                          {/* Image Multipliers */}
                          <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                            {['1x', 'x2', 'x3', 'x4'].map(batch => (
                              <button
                                key={batch}
                                onClick={() => setImageBatch(batch)}
                                className={`flex-1 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${imageBatch === batch ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                              >
                                {batch}
                              </button>
                            ))}
                          </motion.div>

                          {/* Model Selector */}
                          <motion.div variants={popupItemVariants} className="relative" ref={imageModelDropdownRef}>
                            <button
                              type="button"
                              ref={imageModelButtonRef}
                              onClick={toggleImageModelDropdown}
                              className="w-full flex items-center justify-between bg-[#1e1f21]/50 backdrop-blur-md hover:bg-[#202020]/50 transition-colors rounded-[14px] px-3 py-3"
                            >
                              <span className="text-[13px] font-normal text-white">{getImageModelName(imageModel)}</span>
                              <ChevronDown
                                size={16}
                                className={`text-[#a0a0a0] transition-transform duration-200 ${isImageModelDropdownOpen ? 'rotate-180' : ''}`}
                              />
                            </button>

                            {isImageModelDropdownOpen && (
                              <div className={`absolute ${imageModelDropDirection === 'down' ? 'top-[calc(100%+6px)]' : 'bottom-[calc(100%+6px)]'} left-0 right-0 bg-[#141517]/90 backdrop-blur-xl rounded-[14px] p-1 flex flex-col shadow-2xl z-50`}>
                                {[
                                  { id: 'gemini-3-pro-image-preview' as ImageModelId, name: 'Nano Banana Pro' },
                                  { id: 'gemini-3.1-flash-image-preview' as ImageModelId, name: 'Nano Banana 2' },
                                ].map(modelOpt => (
                                  <button
                                    key={modelOpt.id}
                                    type="button"
                                    onClick={() => {
                                      setImageModel(modelOpt.id);
                                      setIsImageModelDropdownOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${imageModel === modelOpt.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                                  >
                                    {modelOpt.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </motion.div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="video-panel"
                          layout="position"
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                          variants={{
                            hidden: { opacity: 0 },
                            visible: {
                              opacity: 1,
                              transition: { staggerChildren: 0.035 },
                            },
                            exit: {
                              opacity: 0,
                              transition: { staggerChildren: 0.02, staggerDirection: -1 },
                            },
                          }}
                          className="w-full flex flex-col gap-1.5"
                        >
                          {/* Video Tabs */}
                          <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                            <button
                              onClick={() => setVideoMode('frames')}
                              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[12px] transition-colors font-normal ${videoMode === 'frames' ? 'bg-[#f4f4f4] text-black' : 'bg-[#1e1f21]/50 backdrop-blur-md text-[#a0a0a0] hover:text-white hover:bg-[#202020]/50'}`}
                            >
                              <Scan size={14} strokeWidth={2} />
                              <span className="text-[12px]">Frames</span>
                            </button>
                            <button
                              onClick={() => setVideoMode('ingredients')}
                              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[12px] transition-colors font-normal ${videoMode === 'ingredients' ? 'bg-[#f4f4f4] text-black' : 'bg-[#1e1f21]/50 backdrop-blur-md text-[#a0a0a0] hover:text-white hover:bg-[#202020]/50'}`}
                            >
                              <svg 
                                xmlns="http://www.w3.org/2000/svg" 
                                viewBox="0 0 100 100" 
                                className="w-3.5 h-3.5"
                              >
                                <path d="M 26 20 L 42 20 A 8 8 0 0 0 58 20 L 74 20 A 6 6 0 0 1 80 26 L 80 42 A 8 8 0 0 1 80 58 L 80 74 A 6 6 0 0 1 74 80 L 26 80 A 6 6 0 0 1 20 74 L 20 58 A 8 8 0 0 0 20 42 L 20 26 A 6 6 0 0 1 26 20 Z" 
                                      fill="none" 
                                      stroke="currentColor" 
                                      strokeWidth="7.5" 
                                      strokeLinecap="round" 
                                      strokeLinejoin="round" />
                              </svg>
                              <span className="text-[12px]">Ingredients</span>
                            </button>
                          </motion.div>

                          {/* Video Aspect Ratios */}
                          <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                             {['9:16', '16:9'].map(ratio => (
                               <button
                                 key={ratio}
                                 onClick={() => setVideoRatio(ratio)}
                                 className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-[10px] transition-colors ${videoRatio === ratio ? 'bg-[#4a4a4a]' : 'hover:bg-white/5'}`}
                               >
                                 <RatioIcon ratio={ratio} className={videoRatio === ratio ? "text-white w-3.5 h-3.5" : "text-[#a0a0a0] w-3.5 h-3.5"} />
                                 <span className={`text-[11px] font-normal ${videoRatio === ratio ? 'text-white' : 'text-[#a0a0a0]'}`}>{ratio}</span>
                               </button>
                             ))}
                          </motion.div>

                          {/* Video Multipliers */}
                          <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                            {['1x', 'x2', 'x3', 'x4'].map(batch => (
                              <button
                                key={batch}
                                onClick={() => setVideoBatch(batch)}
                                className={`flex-1 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${videoBatch === batch ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                              >
                                {batch}
                              </button>
                            ))}
                          </motion.div>

                          {/* Video Model Selector */}
                          <motion.div variants={popupItemVariants} className="relative" ref={videoModelDropdownRef}>
                            <button
                              type="button"
                              ref={videoModelButtonRef}
                              onClick={toggleVideoModelDropdown}
                              className="w-full flex items-center justify-between bg-[#1e1f21]/50 backdrop-blur-md hover:bg-[#202020]/50 transition-colors rounded-[14px] px-3 py-3"
                            >
                              <span className="text-[13px] font-normal text-white">{getVideoModelName(videoModel)}</span>
                              <ChevronDown
                                size={16}
                                className={`text-[#a0a0a0] transition-transform duration-200 ${isVideoModelDropdownOpen ? 'rotate-180' : ''}`}
                              />
                            </button>

                            {isVideoModelDropdownOpen && (
                              <div className={`absolute ${videoModelDropDirection === 'down' ? 'top-[calc(100%+6px)]' : 'bottom-[calc(100%+6px)]'} left-0 right-0 bg-[#141517]/90 backdrop-blur-xl rounded-[14px] p-1 flex flex-col shadow-2xl z-50`}>
                                {VIDEO_MODELS.map(modelOpt => (
                                  <button
                                    key={modelOpt.id}
                                    type="button"
                                    onClick={() => {
                                      setVideoModel(modelOpt.id);
                                      setIsVideoModelDropdownOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${videoModel === modelOpt.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                                  >
                                    {modelOpt.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </motion.div>

                          {/* Video Duration */}
                          <motion.div variants={popupItemVariants} className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                            {['4s', '6s', '8s', '10s'].map(dur => (
                              <button
                                key={dur}
                                onClick={() => setVideoDuration(dur)}
                                className={`flex-1 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${videoDuration === dur ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                              >
                                {dur}
                              </button>
                            ))}
                          </motion.div>
                        </motion.div>
                      )}
                      </AnimatePresence>
                    </motion.div>
                  </motion.div>
                )}
                </AnimatePresence>,
                document.body
                )}
              </div>
              )}
              
              <button
                onClick={isAgentGenerating ? undefined : handleGenerate}
                disabled={!isAgentGenerating && !prompt.trim()}
                className={`flex items-center justify-center w-9 h-9 rounded-full transition-all border border-transparent ${
                  (!isAgentGenerating && !prompt.trim())
                    ? 'bg-[#27282b]/90 cursor-not-allowed'
                    : 'bg-white hover:bg-zinc-200 cursor-pointer active:scale-95'
                }`}
              >
                {isAgentGenerating ? (
                  <div className="w-[9px] h-[9px] bg-black rounded-[1px]" />
                ) : (
                  <ArrowRight size={16} strokeWidth={2.5} className={!prompt.trim() ? "text-white" : "text-black"} />
                )}
              </button>
            </div>

          </div>
            </>
          )}
        </div>
      </div>

      {/* Full-screen Image Viewer / Inpainting Overlay */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 bg-black/95 backdrop-blur-2xl z-[100] flex flex-col overflow-hidden text-white select-none"
            style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}
          >
            {/* Top Bar */}
            <motion.div 
              initial={{ y: -15, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -15, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="h-16 flex items-center justify-between px-6 shrink-0 z-10 bg-transparent"
            >
              {/* Left controls */}
              <div className="flex items-center gap-4 w-[380px]">
                <button 
                  onClick={() => setSelectedItem(null)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-300 hover:text-white"
                  title="Close viewer"
                >
                  <ArrowLeft size={20} strokeWidth={2.5} />
                </button>
                <span className="text-[14px] font-semibold text-white tracking-wide truncate max-w-[200px]">
                  {selectedItem.shortenedPrompt || selectedItem.prompt}
                </span>
                <button className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white">
                  <Info size={18} strokeWidth={2.5} />
                </button>
              </div>

              {/* Center thumbnail carousel aligned with image */}
              <div 
                className="flex items-center gap-1.5 select-none group"
                style={{
                  marginRight: showHistory ? 208 : 0,
                  transition: 'margin-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {/* Prev Arrow */}
                <button
                  onClick={handlePrevThumb}
                  className={`w-9 h-9 flex items-center justify-center text-white/90 hover:text-white transition-all rounded-[12px] hover:bg-white/10 ${
                    completedItems.length > 1 ? 'opacity-0 group-hover:opacity-100 cursor-pointer' : 'opacity-0 pointer-events-none'
                  }`}
                  style={{ transition: 'opacity 0.2s ease, background-color 0.2s ease' }}
                  title="Previous image"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={18} height={18} fill="currentColor">
                    <path d="M15 6v12l-7-6z" />
                  </svg>
                </button>

                {/* Thumbnails Container */}
                <div 
                  className="flex items-center gap-2 overflow-hidden relative"
                  style={{
                    width: `${K_THUMBS * 36 + (K_THUMBS - 1) * 8}px`,
                    maskImage: completedItems.length > 1
                      ? 'linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)'
                      : 'none',
                    WebkitMaskImage: completedItems.length > 1
                      ? 'linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)'
                      : 'none',
                  }}
                >
                  {/* Static highlight frame centered in the viewport */}
                  {completedItems.length > 0 && (
                    <div 
                      className="absolute w-9 h-9 border-2 border-white rounded-[12px] shadow-[0_0_6px_rgba(255,255,255,0.45)] pointer-events-none z-10 left-[132px] top-1/2 -translate-y-1/2"
                    />
                  )}

                  {/* Sliding Inner Row */}
                  <div
                    className="flex items-center gap-2"
                    style={{
                      transform: isAnimating 
                        ? `translateX(${xTranslate}px)` 
                        : 'translateX(-176px)',
                      transition: isAnimating ? 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
                    }}
                    onTransitionEnd={handleTransitionEnd}
                  >
                    {carouselWindow.items.map((thumbItem, idx) => {
                      return (
                        <button
                          key={`${thumbItem.id}-${idx}`}
                          onClick={() => handleThumbClick(thumbItem, idx)}
                          className="w-9 h-9 rounded-[12px] overflow-hidden border border-white/5 shrink-0 transition-opacity active:scale-[0.95] opacity-80 hover:opacity-100"
                        >
                          {thumbItem.kind === 'video' ? (
                            <video src={thumbItem.url} className="w-full h-full object-cover pointer-events-none" muted />
                          ) : (
                            <img src={thumbItem.url} className="w-full h-full object-cover pointer-events-none" alt="" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Next Arrow */}
                <button
                  onClick={handleNextThumb}
                  className={`w-9 h-9 flex items-center justify-center text-white/90 hover:text-white transition-all rounded-[12px] hover:bg-white/10 ${
                    completedItems.length > 1 ? 'opacity-0 group-hover:opacity-100 cursor-pointer' : 'opacity-0 pointer-events-none'
                  }`}
                  style={{ transition: 'opacity 0.2s ease, background-color 0.2s ease' }}
                  title="Next image"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={18} height={18} fill="currentColor">
                    <path d="M9 6v12l7-6z" />
                  </svg>
                </button>
              </div>

              {/* Right controls */}
              <div className="flex items-center gap-3 w-[380px] justify-end">
                <button className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-300 hover:text-white">
                  <Heart size={20} strokeWidth={2} />
                </button>
                <button 
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (selectedItem.url) {
                      const name = selectedItem.shortenedPrompt || selectedItem.prompt;
                      const ext = selectedItem.kind === 'video' ? 'mp4' : 'png';
                      const cleanName = name.replace(/[\/:*?"<>|]/g, '').trim() || 'media';
                      const filename = `${cleanName}.${ext}`;
                      try {
                        const response = await fetch(selectedItem.url);
                        const blob = await response.blob();
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
                        a.href = selectedItem.url;
                        a.download = filename;
                        a.target = '_blank';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }
                    }
                  }}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-300 hover:text-white"
                  title="Download output"
                >
                  <Download size={20} strokeWidth={2} />
                </button>
                <button className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-300 hover:text-white">
                  <Share2 size={20} strokeWidth={2} />
                </button>
                <button 
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex items-center h-9 bg-[#1c1c1e] hover:bg-[#2c2c2e] text-white rounded-2xl pl-3.5 pr-4 gap-1.5 transition-colors shrink-0"
                >
                  {showHistory ? <EyeOff size={16} strokeWidth={2.5} /> : <Eye size={16} strokeWidth={2.5} />}
                  <span className="text-[12px] font-semibold">
                    {showHistory ? 'Hide history' : 'Show history'}
                  </span>
                </button>
                <button 
                  onClick={() => setSelectedItem(null)}
                  className="flex items-center justify-center h-9 bg-white hover:bg-zinc-200 text-black font-semibold rounded-2xl px-5 transition-colors shrink-0"
                >
                  <span className="text-[12px]">Done</span>
                </button>
              </div>
            </motion.div>

            {/* Main Area */}
            <div className="flex-1 min-h-0 flex items-center justify-between px-8 pt-6 pb-0 overflow-visible relative">
              {/* Left Toolbar */}
              <motion.div 
                ref={toolbarRef} 
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -20, opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="-ml-3 flex flex-col gap-3 shrink-0 select-none z-30 relative"
              >
                <button 
                  onClick={() => handleToolSwitch('crop')}
                  className={`w-11 h-11 flex items-center justify-center rounded-full text-white transition-all ${
                    activeTool === 'crop' || showCropMenu ? 'bg-[#303030]' : 'bg-transparent hover:bg-white/10'
                  }`}
                >
                  {activeCropRatio === '16:9' ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                      <rect width="18" height="12" x="3" y="6" rx="1.5" />
                    </svg>
                  ) : activeCropRatio === '9:16' ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                      <rect width="12" height="18" x="6" y="3" rx="1.5" />
                    </svg>
                  ) : activeCropRatio === '1:1' ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                      <rect width="16" height="16" x="4" y="4" rx="1.5" />
                    </svg>
                  ) : (
                    <Crop size={22} strokeWidth={2.25} />
                  )}
                </button>
                <button 
                  onClick={() => handleToolSwitch('pen')}
                  className={`w-11 h-11 flex items-center justify-center rounded-full text-white transition-all ${
                    activeTool === 'pen' ? 'bg-[#303030]' : 'bg-transparent hover:bg-white/10'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={22} height={22}>
                    <defs>
                      <mask id="pen-mask">
                        <rect width="100%" height="100%" fill="white" />
                        <path d="M 4 20 L 4 16.5 L 15.5 5 A 2.475 2.475 0 0 1 19 8.5 L 7.5 20 Z" 
                              fill="black" stroke="black" stroke-width="2.75" stroke-linejoin="round" />
                      </mask>
                    </defs>
                    <path d="M 4 7 C 4 3, 9 3, 11 6 C 13 9, 13 14, 15 17 C 17 20, 20 19, 21 17" 
                          fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" mask="url(#pen-mask)" />
                    <path d="M 4 20 L 4 16.5 L 15.5 5 A 2.475 2.475 0 0 1 19 8.5 L 7.5 20 Z M 7 16 L 14 9 L 15 10 L 8 17 Z" 
                          fill="currentColor" fill-rule="evenodd" />
                  </svg>
                </button>
                <button 
                  onClick={() => handleToolSwitch('select')}
                  className={`w-11 h-11 flex items-center justify-center rounded-full text-white transition-all ${
                    activeTool === 'select' ? 'bg-[#303030]' : 'bg-transparent hover:bg-white/10'
                  }`}
                >
                  {activeSelectSubTool === 'box' ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                      <rect width="18" height="18" x="3" y="3" rx="2" stroke-dasharray="3 3" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="7" strokeDasharray="3 3" />
                      <path d="M17 17l4 4M17 17h4M17 17v4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>

                <AnimatePresence>
                  {showPenMenu && (
                    <motion.div 
                      initial={{ opacity: 0, x: -10, y: "-50%", scale: 0.95 }}
                      animate={{ opacity: 1, x: 0, y: "-50%", scale: 1 }}
                      exit={{ opacity: 0, x: -10, y: "-50%", scale: 0.95 }}
                      transition={{ duration: 0.18, ease: [0.32, 0.94, 0.6, 1] }}
                      className="absolute left-[58px] top-1/2 -translate-y-1/2 z-50 bg-[#141517]/90 backdrop-blur-xl border border-white/10 rounded-[28px] p-3 w-[150px] flex flex-col gap-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
                    >
                      <style>{`
                        .pen-menu-range::-webkit-slider-thumb {
                          -webkit-appearance: none;
                          appearance: none;
                          width: 14px;
                          height: 14px;
                          border-radius: 50%;
                          background: #ffffff;
                          cursor: pointer;
                          border: none;
                          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                          transition: transform 0.1s ease;
                        }
                        .pen-menu-range::-webkit-slider-thumb:hover {
                          transform: scale(1.15);
                        }
                        .pen-menu-range::-webkit-slider-thumb:active {
                          transform: scale(0.9);
                        }
                        .pen-menu-range::-moz-range-thumb {
                          width: 14px;
                          height: 14px;
                          border-radius: 50%;
                          background: #ffffff;
                          cursor: pointer;
                          border: none;
                          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                          transition: transform 0.1s ease;
                        }
                        .pen-menu-range::-moz-range-thumb:hover {
                          transform: scale(1.15);
                        }
                        .pen-menu-range::-moz-range-thumb:active {
                          transform: scale(0.9);
                        }
                      `}</style>
                      
                      {/* Sub-tools Row */}
                      <div className="flex justify-center items-center gap-1.5">
                        <button
                          onClick={() => {
                            setActivePenSubTool('draw');
                            setShowColorPicker(false);
                          }}
                          className={`w-9 h-9 flex items-center justify-center rounded-[12px] transition-all active:scale-95 ${
                            activePenSubTool === 'draw' ? 'bg-[#303030] text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={18} height={18}>
                            <defs>
                              <mask id="pen-mask-menu">
                                <rect width="100%" height="100%" fill="white" />
                                <path d="M 4 20 L 4 16.5 L 15.5 5 A 2.475 2.475 0 0 1 19 8.5 L 7.5 20 Z" 
                                      fill="black" stroke="black" stroke-width="2.75" stroke-linejoin="round" />
                              </mask>
                            </defs>
                            <path d="M 4 7 C 4 3, 9 3, 11 6 C 13 9, 13 14, 15 17 C 17 20, 20 19, 21 17" 
                                  fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" mask="url(#pen-mask-menu)" />
                            <path d="M 4 20 L 4 16.5 L 15.5 5 A 2.475 2.475 0 0 1 19 8.5 L 7.5 20 Z M 7 16 L 14 9 L 15 10 L 8 17 Z" 
                                  fill="currentColor" fill-rule="evenodd" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            setActivePenSubTool('text');
                            setShowColorPicker(false);
                          }}
                          className={`w-9 h-9 flex items-center justify-center rounded-[12px] transition-all active:scale-95 ${
                            activePenSubTool === 'text' ? 'bg-[#303030] text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <span className="text-[17px] font-bold select-none leading-none tracking-tighter font-sans">Tt</span>
                        </button>
                        <button
                          onClick={() => {
                            setActivePenSubTool('rect');
                            setShowColorPicker(false);
                          }}
                          className={`w-9 h-9 flex items-center justify-center rounded-[12px] transition-all active:scale-95 ${
                            activePenSubTool === 'rect' ? 'bg-[#303030] text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round">
                            <rect x={3} y={4} width={18} height={16} rx={1} />
                          </svg>
                        </button>
                      </div>

                      {/* Color Selector Capsule */}
                      <div className="relative w-full flex flex-col gap-2">
                        <button 
                          onClick={() => setShowColorPicker(!showColorPicker)}
                          className="w-full h-7 rounded-full border border-white/80 p-[2px] flex items-center justify-center transition-all hover:border-white active:scale-98"
                        >
                          <div 
                            className="w-full h-full rounded-full transition-colors" 
                            style={{ backgroundColor: activeColor }} 
                          />
                        </button>
                        
                        {showColorPicker && (
                          <div className="grid grid-cols-4 gap-1.5 p-1.5 bg-[#1f2022] border border-white/10 rounded-2xl transition-all duration-200 shadow-inner justify-items-center">
                            {['#ff0000', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de', '#ffffff', '#000000'].map((color) => (
                              <button
                                key={color}
                                onClick={() => {
                                  setActiveColor(color);
                                  setShowColorPicker(false);
                                }}
                                className={`w-[22px] h-[22px] rounded-full border transition-all relative flex items-center justify-center ${
                                  activeColor === color ? 'border-white scale-110 shadow-md' : 'border-transparent hover:scale-105'
                                }`}
                                style={{ backgroundColor: color }}
                              >
                                {activeColor === color && (
                                  <span className={`w-1.5 h-1.5 rounded-full ${color === '#ffffff' ? 'bg-black' : 'bg-white'}`} />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Brush Size Slider */}
                      <div className="flex flex-col gap-0.5">
                        <div className="text-[12px] font-bold text-white/95 select-none pl-0.5">{penSize}px</div>
                        <div className="relative flex items-center h-4">
                          <input
                            type="range"
                            min={1}
                            max={20}
                            value={penSize}
                            onChange={(e) => setPenSize(parseInt(e.target.value))}
                            className="pen-menu-range w-full h-[2px] bg-white/20 rounded-lg appearance-none cursor-pointer focus:outline-none"
                            style={{
                              background: `linear-gradient(to right, #ffffff 0%, #ffffff ${(penSize - 1) / 19 * 100}%, rgba(255,255,255,0.2) ${(penSize - 1) / 19 * 100}%, rgba(255,255,255,0.2) 100%)`
                            }}
                          />
                        </div>
                      </div>

                      {/* Actions Row */}
                      <div className="flex justify-center items-center gap-1.5 pt-1">
                        <button 
                          className={`w-9 h-9 flex items-center justify-center rounded-[12px] transition-all active:scale-90 ${
                            annotations.length === 0 
                              ? 'text-white/20 cursor-not-allowed pointer-events-none' 
                              : 'text-white/60 hover:text-white hover:bg-white/5'
                          }`}
                          onClick={handleUndo}
                          title="Undo"
                        >
                          <Undo2 size={18} strokeWidth={2.25} />
                        </button>
                        <button 
                          className={`w-9 h-9 flex items-center justify-center rounded-[12px] transition-all active:scale-90 ${
                            redoStack.length === 0 
                              ? 'text-white/20 cursor-not-allowed pointer-events-none' 
                              : 'text-white/60 hover:text-white hover:bg-white/5'
                          }`}
                          onClick={handleRedo}
                          title="Redo"
                        >
                          <Redo2 size={18} strokeWidth={2.25} />
                        </button>
                        <button 
                          className={`w-9 h-9 flex items-center justify-center rounded-[12px] transition-all active:scale-90 ${
                            annotations.length === 0 && redoStack.length === 0 && activeColor === '#ff0000' && penSize === 4 && activePenSubTool === 'draw'
                              ? 'text-white/20 cursor-not-allowed pointer-events-none' 
                              : 'text-white/60 hover:text-white hover:bg-white/5'
                          }`}
                          onClick={handleReset}
                          title="Reset"
                        >
                          <RotateCcw size={15} strokeWidth={2.25} />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {showSelectMenu && (
                    <motion.div 
                      initial={{ opacity: 0, x: -10, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -10, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.18, ease: [0.32, 0.94, 0.6, 1] }}
                      className="absolute left-[58px] bottom-0 z-50 bg-[#141517]/90 backdrop-blur-xl border border-white/10 rounded-[24px] p-1.5 w-[145px] flex flex-col gap-1 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
                    >
                      <button
                        onClick={() => {
                          setActiveSelectSubTool('box');
                          setShowSelectMenu(false);
                        }}
                        className={`flex items-center gap-3 px-3.5 py-2.5 w-full rounded-[18px] transition-all active:scale-[0.98] ${
                          activeSelectSubTool === 'box' 
                            ? 'bg-white/10 text-white font-semibold' 
                            : 'text-white/60 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                          <rect width="16" height="16" x="4" y="4" rx="2" strokeDasharray="3 3" />
                        </svg>
                        <span className="text-[14px]">Box</span>
                      </button>
                      
                      <button
                        onClick={() => {
                          setActiveSelectSubTool('lasso');
                          setShowSelectMenu(false);
                        }}
                        className={`flex items-center gap-3 px-3.5 py-2.5 w-full rounded-[18px] transition-all active:scale-[0.98] ${
                          activeSelectSubTool === 'lasso' 
                            ? 'bg-white/10 text-white font-semibold' 
                            : 'text-white/60 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="7" strokeDasharray="3 3" />
                          <path d="M17 17l4 4M17 17h4M17 17v4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="text-[14px]">Lasso</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {showCropMenu && (
                    <motion.div 
                      initial={{ opacity: 0, x: -10, y: -20, scale: 0.95 }}
                      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -10, y: -20, scale: 0.95 }}
                      transition={{ duration: 0.18, ease: [0.32, 0.94, 0.6, 1] }}
                      className="absolute left-[58px] top-0 z-50 bg-[#141517]/90 backdrop-blur-xl border border-white/10 rounded-[24px] p-1.5 w-[190px] flex flex-col gap-1 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
                    >
                      <button
                        onClick={() => {
                          if (activeTool !== 'crop') {
                            setPreviousTool(activeTool as 'pen' | 'select');
                            setActiveTool('crop');
                          }
                          setActiveCropRatio('16:9');
                          setShowCropMenu(false);
                        }}
                        className={`flex items-center gap-3 px-3.5 py-2.5 w-full rounded-[18px] transition-all active:scale-[0.98] ${
                          activeCropRatio === '16:9' 
                            ? 'bg-white/10 text-white font-semibold' 
                            : 'text-white/60 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                          <rect width="18" height="12" x="3" y="6" rx="1.5" />
                        </svg>
                        <span className="text-[14px]">Landscape (16:9)</span>
                      </button>

                      <button
                        onClick={() => {
                          if (activeTool !== 'crop') {
                            setPreviousTool(activeTool as 'pen' | 'select');
                            setActiveTool('crop');
                          }
                          setActiveCropRatio('9:16');
                          setShowCropMenu(false);
                        }}
                        className={`flex items-center gap-3 px-3.5 py-2.5 w-full rounded-[18px] transition-all active:scale-[0.98] ${
                          activeCropRatio === '9:16' 
                            ? 'bg-white/10 text-white font-semibold' 
                            : 'text-white/60 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                          <rect width="12" height="18" x="6" y="3" rx="1.5" />
                        </svg>
                        <span className="text-[14px]">Portrait (9:16)</span>
                      </button>

                      <button
                        onClick={() => {
                          if (activeTool !== 'crop') {
                            setPreviousTool(activeTool as 'pen' | 'select');
                            setActiveTool('crop');
                          }
                          setActiveCropRatio('1:1');
                          setShowCropMenu(false);
                        }}
                        className={`flex items-center gap-3 px-3.5 py-2.5 w-full rounded-[18px] transition-all active:scale-[0.98] ${
                          activeCropRatio === '1:1' 
                            ? 'bg-white/10 text-white font-semibold' 
                            : 'text-white/60 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                          <rect width="16" height="16" x="4" y="4" rx="1.5" />
                        </svg>
                        <span className="text-[14px]">Square (1:1)</span>
                      </button>

                      <button
                        onClick={() => {
                          if (activeTool !== 'crop') {
                            setPreviousTool(activeTool as 'pen' | 'select');
                            setActiveTool('crop');
                          }
                          setActiveCropRatio('freeform');
                          setShowCropMenu(false);
                        }}
                        className={`flex items-center gap-3 px-3.5 py-2.5 w-full rounded-[18px] transition-all active:scale-[0.98] ${
                          activeCropRatio === 'freeform' 
                            ? 'bg-white/10 text-white font-semibold' 
                            : 'text-white/60 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <Crop size={18} strokeWidth={2.25} />
                        <span className="text-[14px]">Freeform</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Centered Image */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className={`flex-1 h-full min-h-0 flex items-center justify-center relative select-none pl-5 ${showHistory ? 'pr-4' : 'pr-13'}`}
              >
                {(() => {
                  const ratio = selectedItem.ratio;
                  let ar = "16 / 9";
                  if (ratio === '4:3') ar = "4 / 3";
                  else if (ratio === '1:1') ar = "1 / 1";
                  else if (ratio === '3:4') ar = "3 / 4";
                  else if (ratio === '9:16') ar = "9 / 16";
                  
                  return (
                    <div 
                      className={`relative max-w-full max-h-full overflow-hidden shadow-2xl border bg-[#141517]/40 flex items-center justify-center ${
                        activeTool === 'crop' ? 'rounded-none' : 'rounded-[32px]'
                      }`}
                      style={{ aspectRatio: ar, borderWidth: '0.5px', borderColor: '#0e0e10', borderStyle: 'solid' }}
                    >
                      {selectedItem.kind === 'video' ? (
                        <video
                          src={selectedItem.url}
                          controls
                          autoPlay
                          loop
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <img
                          src={selectedItem.url}
                          alt={selectedItem.shortenedPrompt || selectedItem.prompt}
                          className="w-full h-full object-cover pointer-events-none"
                        />
                      )}
                      
                      {/* Crop Box Overlay with Corner Vertices */}
                      {activeTool === 'crop' && (
                        <div ref={cropContainerRef} className="absolute inset-0 z-20 select-none" style={{ cursor: 'default' }}>
                          {/* Dark overlay strips around the crop box (contained within image bounds) */}
                          {/* Top strip */}
                          <div className="absolute bg-black/50" style={{ left: 0, top: 0, right: 0, height: `${cropBox.y}%` }} />
                          {/* Bottom strip */}
                          <div className="absolute bg-black/50" style={{ left: 0, top: `${cropBox.y + cropBox.h}%`, right: 0, bottom: 0 }} />
                          {/* Left strip (between top and bottom) */}
                          <div className="absolute bg-black/50" style={{ left: 0, top: `${cropBox.y}%`, width: `${cropBox.x}%`, height: `${cropBox.h}%` }} />
                          {/* Right strip (between top and bottom) */}
                          <div className="absolute bg-black/50" style={{ left: `${cropBox.x + cropBox.w}%`, top: `${cropBox.y}%`, right: 0, height: `${cropBox.h}%` }} />

                          {/* The crop box border */}
                          <div
                            className="absolute border-2 border-white"
                            style={{
                              left: `${cropBox.x}%`,
                              top: `${cropBox.y}%`,
                              width: `${cropBox.w}%`,
                              height: `${cropBox.h}%`,
                            }}
                          >
                            {/* Move handle — full interior */}
                            <div
                              className="absolute inset-0 cursor-move"
                              onMouseDown={(e) => onCropPointerDown(e, 'move')}
                            />
                            {/* Corner handles (L-shaped vertices) */}
                            {/* Top-Left */}
                            <div
                              className="absolute top-[-3px] left-[-3px] w-5 h-5 border-t-[3px] border-l-[3px] border-white cursor-nwse-resize z-10"
                              onMouseDown={(e) => onCropPointerDown(e, 'nw')}
                            />
                            {/* Top-Right */}
                            <div
                              className="absolute top-[-3px] right-[-3px] w-5 h-5 border-t-[3px] border-r-[3px] border-white cursor-nesw-resize z-10"
                              onMouseDown={(e) => onCropPointerDown(e, 'ne')}
                            />
                            {/* Bottom-Left */}
                            <div
                              className="absolute bottom-[-3px] left-[-3px] w-5 h-5 border-b-[3px] border-l-[3px] border-white cursor-nesw-resize z-10"
                              onMouseDown={(e) => onCropPointerDown(e, 'sw')}
                            />
                            {/* Bottom-Right */}
                            <div
                              className="absolute bottom-[-3px] right-[-3px] w-5 h-5 border-b-[3px] border-r-[3px] border-white cursor-nwse-resize z-10"
                              onMouseDown={(e) => onCropPointerDown(e, 'se')}
                            />
                          </div>
                        </div>
                      )}
                      
                      {/* SVG Canvas overlay */}
                      {(activeTool === 'pen' || activeTool === 'select') && (
                        <svg
                          ref={svgRef}
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          className="absolute inset-0 w-full h-full pointer-events-auto cursor-crosshair select-none z-10"
                          onMouseDown={handleMouseDown}
                          style={{ touchAction: 'none' }}
                        >
                          {/* Render existing annotations */}
                          {annotations.map((ann) => {
                            if (ann.type === 'draw' && ann.points) {
                              return (
                                <path
                                  key={ann.id}
                                  d={getSvgPathD(ann.points)}
                                  stroke={ann.color}
                                  strokeWidth={ann.size}
                                  vectorEffect="non-scaling-stroke"
                                  fill="none"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              );
                            }
                            if (ann.type === 'rect') {
                              const x = Math.min(ann.x || 0, (ann.x || 0) + (ann.width || 0));
                              const y = Math.min(ann.y || 0, (ann.y || 0) + (ann.height || 0));
                              const width = Math.abs(ann.width || 0);
                              const height = Math.abs(ann.height || 0);
                              return (
                                <rect
                                  key={ann.id}
                                  x={`${x}%`}
                                  y={`${y}%`}
                                  width={`${width}%`}
                                  height={`${height}%`}
                                  stroke={ann.color}
                                  strokeWidth={ann.size}
                                  vectorEffect="non-scaling-stroke"
                                  fill="none"
                                />
                              );
                            }
                            if (ann.type === 'select-box') {
                              const x = Math.min(ann.x || 0, (ann.x || 0) + (ann.width || 0));
                              const y = Math.min(ann.y || 0, (ann.y || 0) + (ann.height || 0));
                              const width = Math.abs(ann.width || 0);
                              const height = Math.abs(ann.height || 0);
                              return (
                                <g key={ann.id}>
                                  <rect
                                    x={`${x}%`}
                                    y={`${y}%`}
                                    width={`${width}%`}
                                    height={`${height}%`}
                                    stroke="black"
                                    strokeWidth={ann.size}
                                    vectorEffect="non-scaling-stroke"
                                    fill="none"
                                  />
                                  <rect
                                    x={`${x}%`}
                                    y={`${y}%`}
                                    width={`${width}%`}
                                    height={`${height}%`}
                                    stroke="white"
                                    strokeWidth={ann.size}
                                    strokeDasharray="4 4"
                                    vectorEffect="non-scaling-stroke"
                                    fill="rgba(255, 255, 255, 0.05)"
                                  />
                                </g>
                              );
                            }
                            if (ann.type === 'select-lasso' && ann.points) {
                              return (
                                <g key={ann.id}>
                                  <path
                                    d={getSvgPathD(ann.points)}
                                    stroke="black"
                                    strokeWidth={ann.size}
                                    vectorEffect="non-scaling-stroke"
                                    fill="none"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d={getSvgPathD(ann.points)}
                                    stroke="white"
                                    strokeWidth={ann.size}
                                    strokeDasharray="4 4"
                                    vectorEffect="non-scaling-stroke"
                                    fill="rgba(255, 255, 255, 0.05)"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </g>
                              );
                            }
                            if (ann.type === 'text') {
                              return (
                                <text
                                  key={ann.id}
                                  x={`${ann.x}%`}
                                  y={`${ann.y}%`}
                                  fill={ann.color}
                                  fontSize={`${ann.size * 2.5 + 8}px`}
                                  fontFamily="sans-serif"
                                  fontWeight="bold"
                                  dominantBaseline="middle"
                                >
                                  {ann.text}
                                </text>
                              );
                            }
                            return null;
                          })}

                          {/* Render currently drawing annotation */}
                          {currentAnnotation && currentAnnotation.type === 'draw' && currentAnnotation.points && (
                            <path
                              d={getSvgPathD(currentAnnotation.points)}
                              stroke={currentAnnotation.color}
                              strokeWidth={currentAnnotation.size}
                              vectorEffect="non-scaling-stroke"
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          )}
                          {currentAnnotation && currentAnnotation.type === 'rect' && (
                            <rect
                              x={`${Math.min(currentAnnotation.x || 0, (currentAnnotation.x || 0) + (currentAnnotation.width || 0))}%`}
                              y={`${Math.min(currentAnnotation.y || 0, (currentAnnotation.y || 0) + (currentAnnotation.height || 0))}%`}
                              width={`${Math.abs(currentAnnotation.width || 0)}%`}
                              height={`${Math.abs(currentAnnotation.height || 0)}%`}
                              stroke={currentAnnotation.color}
                              strokeWidth={currentAnnotation.size}
                              vectorEffect="non-scaling-stroke"
                              fill="none"
                            />
                          )}
                          {currentAnnotation && currentAnnotation.type === 'select-lasso' && currentAnnotation.points && (
                            <g>
                              <path
                                d={getSvgPathD(currentAnnotation.points)}
                                stroke="black"
                                strokeWidth={currentAnnotation.size}
                                vectorEffect="non-scaling-stroke"
                                fill="none"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path
                                d={getSvgPathD(currentAnnotation.points)}
                                stroke="white"
                                strokeWidth={currentAnnotation.size}
                                strokeDasharray="4 4"
                                vectorEffect="non-scaling-stroke"
                                fill="rgba(255, 255, 255, 0.05)"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </g>
                          )}
                          {currentAnnotation && currentAnnotation.type === 'select-box' && (
                            <g>
                              <rect
                                x={`${Math.min(currentAnnotation.x || 0, (currentAnnotation.x || 0) + (currentAnnotation.width || 0))}%`}
                                y={`${Math.min(currentAnnotation.y || 0, (currentAnnotation.y || 0) + (currentAnnotation.height || 0))}%`}
                                width={`${Math.abs(currentAnnotation.width || 0)}%`}
                                height={`${Math.abs(currentAnnotation.height || 0)}%`}
                                stroke="black"
                                strokeWidth={currentAnnotation.size}
                                vectorEffect="non-scaling-stroke"
                                fill="none"
                              />
                              <rect
                                x={`${Math.min(currentAnnotation.x || 0, (currentAnnotation.x || 0) + (currentAnnotation.width || 0))}%`}
                                y={`${Math.min(currentAnnotation.y || 0, (currentAnnotation.y || 0) + (currentAnnotation.height || 0))}%`}
                                width={`${Math.abs(currentAnnotation.width || 0)}%`}
                                height={`${Math.abs(currentAnnotation.height || 0)}%`}
                                stroke="white"
                                strokeWidth={currentAnnotation.size}
                                strokeDasharray="4 4"
                                vectorEffect="non-scaling-stroke"
                                fill="rgba(255, 255, 255, 0.05)"
                              />
                            </g>
                          )}
                        </svg>
                      )}
                      
                      {/* Active Text Input overlay */}
                      {activeTool === 'pen' && textInput && (
                        <input
                          autoFocus
                          type="text"
                          value={textInput.value}
                          onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (textInput.value.trim()) {
                                const newAnn: Annotation = {
                                  id: Math.random().toString(),
                                  type: 'text',
                                  color: activeColor,
                                  size: penSize,
                                  x: textInput.x,
                                  y: textInput.y,
                                  text: textInput.value
                                };
                                setAnnotations([...annotations, newAnn]);
                                setRedoStack([]);
                              }
                              setTextInput(null);
                            } else if (e.key === 'Escape') {
                              setTextInput(null);
                            }
                          }}
                          onBlur={() => {
                            if (textInput.value.trim()) {
                              const newAnn: Annotation = {
                                id: Math.random().toString(),
                                type: 'text',
                                color: activeColor,
                                size: penSize,
                                x: textInput.x,
                                y: textInput.y,
                                text: textInput.value
                              };
                              setAnnotations([...annotations, newAnn]);
                              setRedoStack([]);
                            }
                            setTextInput(null);
                          }}
                          className="absolute bg-[#141517] text-white border border-white/20 px-2 py-1 rounded-[6px] text-[13px] font-sans shadow-lg focus:outline-none focus:border-white/50 z-20 transform -translate-y-1/2"
                          style={{
                            left: `${textInput.x}%`,
                            top: `${textInput.y}%`,
                            color: activeColor,
                            fontSize: `${Math.max(12, penSize * 2.5 + 8)}px`,
                            lineHeight: '1'
                          }}
                        />
                      )}
                    </div>
                  );
                })()}
              </motion.div>

              {/* Right Sidebar - History panel */}
              <AnimatePresence>
                {showHistory && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="h-full flex flex-col justify-end shrink-0 select-none ml-6"
                  >
                    <div ref={setHistoryRail} className="w-[220px] flex flex-col items-start">
                      {(() => {
                        const ratio = selectedItem.ratio;
                        let ar = 16 / 9;
                        if (ratio === '4:3') ar = 4 / 3;
                        else if (ratio === '1:1') ar = 1;
                        else if (ratio === '3:4') ar = 3 / 4;
                        else if (ratio === '9:16') ar = 9 / 16;

                        return (
                          <div className="w-full rounded-[20px] overflow-hidden border-2 border-white bg-[#141517]/40 shadow-xl flex flex-col">
                            <div 
                              className="w-full overflow-hidden bg-zinc-900"
                              style={{ aspectRatio: ar }}
                            >
                              {selectedItem.kind === 'video' ? (
                                <video src={selectedItem.url} className="w-full h-full object-cover" muted />
                              ) : (
                                <img src={selectedItem.url} className="w-full h-full object-cover" alt="" />
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Bottom Area */}
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="shrink-0 flex flex-col items-center justify-end relative select-none pt-3 pb-8"
            >


              {activeTool === 'crop' ? (
                <div
                  className="flex items-center gap-3 mt-4"
                  style={{
                    marginRight: showHistory ? 208 : 0,
                    transition: 'margin-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <button 
                    onClick={() => {
                      setActiveTool(previousTool);
                      setShowCropMenu(false);
                    }}
                    className="flex items-center h-10 px-5 rounded-full bg-[#1c1c1e] hover:bg-[#2c2c2e] border border-white/10 text-white font-medium text-[13px] gap-2 transition-all active:scale-[0.97]"
                  >
                    <X size={15} strokeWidth={2.5} className="text-white/85" />
                    <span>Cancel</span>
                  </button>
                  <button 
                    onClick={() => {
                      setActiveTool(previousTool);
                      setShowCropMenu(false);
                    }}
                    className="flex items-center h-10 px-6 rounded-full bg-white hover:bg-zinc-200 text-black font-semibold text-[13px] gap-2 transition-all active:scale-[0.97]"
                  >
                    <ArrowRight size={15} strokeWidth={2.5} className="text-black" />
                    <span>Crop</span>
                  </button>
                </div>
              ) : (
                <div 
                  className="relative w-full max-w-[600px] flex flex-col z-50"
                  style={{
                    marginRight: showHistory ? 208 : 0,
                    transition: 'margin-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                <AssetMenuModal
                  isOpen={isViewerAssetMenuOpen}
                  onClose={() => setIsViewerAssetMenuOpen(false)}
                  buttonRef={viewerAssetMenuPlusRef}
                  projectName={projectName}
                  mediaItems={mediaItems}
                  onFileSelect={() => viewerFileInputRef.current?.click()}
                  onAddPrompt={(assetId, assetUrl, assetTitle, assetKind) => {
                    if (assetUrl) {
                      setViewerAttachments(prev => {
                        if (prev.some(att => att && att.url === assetUrl)) return prev;
                        return [...prev, {
                          id: assetId,
                          url: assetUrl,
                          name: assetTitle || 'Attached Image',
                          kind: assetKind || 'image'
                        }];
                      });
                    } else if (assetTitle) {
                      setEditPrompt(prev => {
                        const separator = prev.trim() ? ' ' : '';
                        return `${prev.trim()}${separator}[${assetTitle}]`;
                      });
                    }
                  }}
                />
                <div
                  ref={measureViewerPromptCard}
                  className="bg-[#141517]/90 backdrop-blur-[80px] rounded-[22px] pt-3 pb-2 px-3 flex flex-col shadow-2xl border border-white/5 w-full"
                >
                  <input 
                    type="file" 
                    multiple 
                    accept="image/*"
                    className="hidden" 
                    ref={viewerFileInputRef} 
                    onChange={handleViewerFileSelect} 
                  />

                  {/* Attachments Area */}
                  {(() => {
                    const hasViewerAttachments = viewerAttachments.length > 0 && !viewerAttachments.every(att => viewerRemovingIds.has(att.id));
                    return (
                      <div className={`grid transition-[grid-template-rows,margin-bottom] duration-[250ms] ease-in-out ${hasViewerAttachments ? 'grid-rows-[1fr] mb-0' : 'grid-rows-[0fr] mb-0'}`}>
                        <div className="overflow-hidden">
                          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2.5 px-2 pt-2">
                            {viewerAttachments.map((att) => (
                              <div key={att.id} className={`relative group flex-shrink-0 transition-all duration-200 ${viewerRemovingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}>
                                <div className="relative">
                                  <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1c]">
                                    <img src={att.url} alt={att.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                  </div>
                                  <button 
                                    onClick={() => removeViewerAttachment(att.id)}
                                    className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 hover:opacity-100 transition-all duration-200 shadow-xl z-[60]"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="relative flex items-start w-full">
                    <textarea 
                      ref={viewerTextareaRef}
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      onScroll={(e) => updateViewerFades(e.currentTarget)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleViewerGenerate();
                        }
                      }}
                      onPaste={(e) => {
                        const items = e.clipboardData?.items;
                        if (!items) return;
                        const imageFiles: File[] = [];
                        for (let i = 0; i < items.length; i++) {
                          if (items[i].type.startsWith('image/')) {
                            const file = items[i].getAsFile();
                            if (file) imageFiles.push(file);
                          }
                        }
                        if (imageFiles.length > 0) {
                          e.preventDefault();
                          const newAttachments: ImageAttachment[] = imageFiles.map(file => ({
                            id: Math.random().toString(36).substring(7),
                            url: URL.createObjectURL(file),
                            name: file.name || `pasted-image.${file.type.split('/')[1] || 'png'}`,
                            file
                          }));
                          setViewerAttachments(prev => [...prev, ...newAttachments]);
                        }
                      }}
                      rows={1}
                      placeholder="What do you want to change?" 
                      className={`bg-transparent border-none outline-none text-[14px] font-medium text-white placeholder-[#606060] w-full pl-1 py-0.5 resize-none max-h-[384px] overflow-y-auto no-scrollbar transition-all duration-200 ${
                        isViewerTopFaded && isViewerBottomFaded ? 'both-fade' : 
                        isViewerTopFaded ? 'top-fade' : 
                        isViewerBottomFaded ? 'bottom-fade' : ''
                      }`}
                      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', paddingRight: '14px' }}
                    />
                    {editPrompt && (
                      <button 
                        onClick={() => setEditPrompt('')}
                        className="absolute right-[-4px] top-[-4px] text-gray-500 hover:text-white transition-colors p-0.5 rounded-full hover:bg-white/5 cursor-pointer"
                        title="Clear prompt"
                      >
                        <X size={14} strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2.5">
                    <div className="flex items-center gap-2.5 relative">
                      <button 
                        ref={viewerAssetMenuPlusRef}
                        onClick={() => setIsViewerAssetMenuOpen(!isViewerAssetMenuOpen)}
                        className="text-[#a0a0a0] hover:text-white transition-colors ml-0 outline-none active:scale-[0.93] cursor-pointer"
                      >
                        <Plus size={22} strokeWidth={1.5} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2.5 relative">
                      <div className="relative" ref={viewerModelDropdownRef}>
                        <button 
                          onClick={() => setIsViewerModelDropdownOpen(!isViewerModelDropdownOpen)}
                          className="flex items-center h-9 bg-[#27282b] hover:bg-[#33343a] transition-colors rounded-full px-3.5 gap-1.5 border border-transparent cursor-pointer select-none"
                        >
                          {viewerModelName.toLowerCase().includes('banana') ? (
                            <span className="text-[11px]">🍌</span>
                          ) : null}
                          <span className="text-[11px] font-semibold text-[#d0d0d0]">
                            {viewerModelName}
                          </span>
                          <ChevronDown size={12} className={`text-[#a0a0a0] transition-transform duration-200 ${isViewerModelDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        
                        {isViewerModelDropdownOpen && (
                          <div className="absolute bottom-[calc(100%+6px)] right-0 bg-[#141517]/95 backdrop-blur-xl rounded-[14px] p-1 flex flex-col shadow-2xl z-50 border border-white/5 min-w-[140px]">
                            {selectedItem.kind === 'image' ? (
                              [
                                { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro' },
                                { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2' },
                              ].map(modelOpt => (
                                <button
                                  key={modelOpt.id}
                                  type="button"
                                  onClick={() => {
                                    setViewerModelId(modelOpt.id);
                                    setViewerModelName(modelOpt.name);
                                    setIsViewerModelDropdownOpen(false);
                                  }}
                                  className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${viewerModelId === modelOpt.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                                >
                                  {modelOpt.name}
                                </button>
                              ))
                            ) : (
                              [
                                { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast' },
                                { id: 'veo-3.1', name: 'Veo 3.1' },
                                { id: 'veo-3.1-lite', name: 'Veo 3.1 Lite' },
                                { id: 'omni-flash', name: 'Omni Flash' },
                              ].map(modelOpt => (
                                <button
                                  key={modelOpt.id}
                                  type="button"
                                  onClick={() => {
                                    setViewerModelId(modelOpt.id);
                                    setViewerModelName(modelOpt.name);
                                    setIsViewerModelDropdownOpen(false);
                                  }}
                                  className={`w-full text-left px-3 py-2 rounded-[10px] text-[12px] font-normal transition-colors ${viewerModelId === modelOpt.id ? 'bg-[#4a4a4a] text-white' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                                >
                                  {modelOpt.name}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                      <button 
                        onClick={handleViewerGenerate}
                        disabled={!editPrompt.trim()}
                        className={`flex items-center justify-center w-9 h-9 rounded-full transition-all border border-transparent ${
                          !editPrompt.trim()
                            ? 'bg-[#27282b]/90 cursor-not-allowed'
                            : 'bg-white hover:bg-zinc-200 cursor-pointer active:scale-95'
                        }`}
                      >
                        <ArrowRight size={16} strokeWidth={2.5} className={!editPrompt.trim() ? "text-white/40" : "text-black"} />
                      </button>
                    </div>
                  </div>
                </div>
                </div>
              )}
            </motion.div>

            {/* Warning popup overlay */}
            {pendingTool !== null && (
              <div 
                className="absolute inset-0 z-[100] flex items-center justify-center"
                style={{
                  animation: 'slowBlurFade 1.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                }}
              >
                <style>{`
                  @keyframes slowBlurFade {
                    from {
                      backdrop-filter: blur(0px);
                      background-color: rgba(0, 0, 0, 0);
                    }
                    to {
                      backdrop-filter: blur(8px);
                      background-color: rgba(0, 0, 0, 0.45);
                    }
                  }
                `}</style>
                
                {/* Menu Card itself - immediately visible */}
                <div 
                  className="bg-[#141517]/90 backdrop-blur-xl rounded-[22px] pt-3.5 pb-[9px] px-[9px] w-[370px] flex flex-col items-center shadow-[0_20px_45px_rgba(0,0,0,0.65)] animate-none transform -translate-y-12"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" className="text-white opacity-90">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  
                  <p className="text-white text-[11.5px] font-semibold text-center mt-3 tracking-wide select-none">
                    Changing editing modes will discard ungenerated changes!
                  </p>
                  
                  <div className="flex items-center gap-[9px] w-full mt-4">
                    <button
                      onClick={() => setPendingTool(null)}
                      className="flex-1 py-[7px] rounded-[9px] bg-[#2c2c2e] hover:bg-[#3a3a3c] text-white text-[12px] font-semibold transition-colors"
                    >
                      Go Back
                    </button>
                    <button
                      onClick={() => {
                        // Discard changes
                        setAnnotations([]);
                        setRedoStack([]);
                        setCurrentAnnotation(null);
                        setTextInput(null);
                        
                        // Switch tool
                        if (pendingTool === 'crop') {
                          setPreviousTool(activeTool as 'pen' | 'select');
                        }
                        setActiveTool(pendingTool);
                        setShowPenMenu(pendingTool === 'pen');
                        setShowSelectMenu(pendingTool === 'select');
                        setShowCropMenu(pendingTool === 'crop');
                        
                        // Close warning dialog
                        setPendingTool(null);
                      }}
                      className="flex-1 py-[7px] rounded-[9px] bg-white hover:bg-zinc-200 text-black text-[12px] font-semibold transition-colors"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AgentSidebar 
        isOpen={isAgentSidebarOpen} 
        onClose={() => setIsAgentSidebarOpen(false)} 
        isHeaderVisible={isHeaderVisible}
        sidebarTransition={currentSidebarTransitionTiming}
        prompt={prompt}
        setPrompt={setPrompt}
        attachments={attachments.filter(Boolean)}
        setAttachments={setAttachments}
        chatMessages={chatMessages}
        setChatMessages={setChatMessages}
        isGenerating={isAgentGenerating}
        setIsGenerating={setIsAgentGenerating}
        streaming={agentStreaming}
        setStreaming={setAgentStreaming}
        isThinking={isAgentThinking}
        setIsThinking={setIsAgentThinking}
        thinkingPhase={agentThinkingPhase}
        setThinkingPhase={setAgentThinkingPhase}
        sessionName={sessionName}
        setSessionName={setSessionName}
        handleSend={handleAgentSend}
        imageRatio={imageRatio}
        setImageRatio={setImageRatio}
        imageBatch={imageBatch}
        setImageBatch={setImageBatch}
        imageModel={imageModel}
        setImageModel={setImageModel}
        videoRatio={videoRatio}
        setVideoRatio={setVideoRatio}
        videoBatch={videoBatch}
        setVideoBatch={setVideoBatch}
        videoModel={videoModel}
        setVideoModel={setVideoModel}
        instructions={instructions}
        setInstructions={setInstructions}
        onPlusClick={(ref, source, instructionId) => {
          setAssetMenuSource(source);
          if (source === 'instruction-reference') {
            setInstructionButtonRef(ref);
            if (instructionId) {
              setActiveInstructionId(instructionId);
            }
          } else {
            setSidebarButtonRef(ref);
          }
          setIsAssetMenuOpen(true);
        }}
      />

      <AssetMenuModal
        isOpen={isAssetMenuOpen && (assetMenuSource === 'sidebar' || assetMenuSource === 'instruction-reference')}
        onClose={() => setIsAssetMenuOpen(false)}
        buttonRef={assetMenuSource === 'instruction-reference' ? instructionButtonRef : (sidebarButtonRef || assetMenuPlusRef)}
        openedFrom={assetMenuSource === 'instruction-reference' ? 'instruction-reference' : 'sidebar'}
        projectName={projectName}
        mediaItems={mediaItems}
        onFileSelect={() => fileInputRef.current?.click()}
        onAddPrompt={(assetId, assetUrl, assetTitle, assetKind) => {
          if (assetMenuSource === 'instruction-reference') {
            if (activeInstructionId) {
              setInstructions(prev => prev.map(inst => 
                inst.id === activeInstructionId 
                  ? { ...inst, referenceName: assetTitle || 'reference.pdf' } 
                  : inst
              ));
            }
            setIsAssetMenuOpen(false);
            return;
          }

          if (assetUrl) {
            setAttachments(prev => {
              if (prev.some(att => att && att.url === assetUrl)) return prev;
              return [...prev, {
                id: assetId,
                url: assetUrl,
                name: assetTitle || 'Attached Image',
                kind: assetKind || 'image'
              }];
            });
          } else if (assetTitle) {
            setPrompt(prev => {
              const separator = prev.trim() ? ' ' : '';
              return `${prev.trim()}${separator}[${assetTitle}]`;
            });
          }
        }}
      />
      
      {/* Custom floating ghost drag image with 100% full opacity, no border, and larger size */}
      {draggingItemId && (() => {
        const item = mediaItems.find(m => m.id === draggingItemId);
        if (!item || !item.url) return null;
        
        const ratio = item.ratio;
        let ar = 16 / 9;
        if (ratio === '4:3') ar = 4 / 3;
        else if (ratio === '1:1') ar = 1;
        else if (ratio === '3:4') ar = 3 / 4;
        else if (ratio === '9:16') ar = 9 / 16;
        
        const ghostWidth = 250; // Increased size slightly more!
        const ghostHeight = ghostWidth / ar;
        
        return (
          <div
            style={{
              position: 'fixed',
              left: `${dragMousePos.x - ghostWidth / 2}px`,
              top: `${dragMousePos.y - ghostHeight / 2}px`,
              width: `${ghostWidth}px`,
              height: `${ghostHeight}px`,
              pointerEvents: 'none',
              zIndex: 99999,
              opacity: 1, // 100% full opacity
              borderRadius: '18px',
              overflow: 'hidden',
              boxShadow: '0 30px 60px -10px rgba(0, 0, 0, 0.8)',
              backgroundColor: '#0c0c0c',
              border: 'none', // No border
            }}
          >
            {item.kind === 'video' ? (
              <video
                src={item.url}
                loop
                muted
                autoPlay
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '18px' }}
              />
            ) : (
              <img
                src={item.url}
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '18px' }}
                alt=""
              />
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default MediaView;
