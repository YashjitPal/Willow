import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, 
  MoreVertical, 
  Search, 
  Filter, 
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
  Sparkles,
  Download,
  Edit2,
  Share2,
  Flag,
  Trash2
} from 'lucide-react';
import logoG from '../../src/assets/logog.png'; // Fallback avatar
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { useUserDataContext } from '../../context/UserDataContext';
import { AssetMenuModal } from '../AssetMenuModal';

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



type MediaKind = 'image' | 'video';
type MediaStatus = 'generating' | 'completed' | 'failed';
type MediaItem = {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  url?: string;
  error?: string;
  prompt: string;
  modelId: string;
  modelName: string;
  ratio: string;
  timestamp: number;
};

const TileContent = React.memo(({ 
  item, 
  isMenuOpen, 
  onMenuOpenChange,
  isHovered
}: { 
  item: MediaItem; 
  isMenuOpen: boolean; 
  onMenuOpenChange: (open: boolean) => void; 
  isHovered: boolean;
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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
            border: 1px solid rgba(255, 255, 255, 0.06);
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
        <div className="absolute bottom-0 left-0 right-0 h-[72px] bg-gradient-to-t from-black/50 to-transparent px-5 pb-4 flex items-end pointer-events-none z-30">
          <div className="flex items-center gap-2.5 w-full min-w-0">
            {item.kind === 'image' ? (
              <ImagesIcon className="text-white/90 w-[17px] h-[17px] shrink-0" />
            ) : (
              <VideoIcon className="text-white/90 w-[17px] h-[17px] shrink-0 translate-y-[1.5px]" />
            )}
            <span className="text-[14px] font-normal text-white/90 truncate max-w-full">
              {item.prompt}
            </span>
          </div>
        </div>
      </div>
    )}
 
    {item.status === 'completed' && item.url && (
      item.kind === 'video' ? (
        <>
          <video
            ref={videoRef}
            src={item.url}
            loop
            muted
            playsInline
            className="w-full h-full object-cover rounded-[18px]"
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
          alt={item.prompt}
          className="w-full h-full object-cover rounded-[18px]"
        />
      )
    )}
 
    {item.status === 'failed' && (
      <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center bg-[#0c0c0c] rounded-[18px]">
        <div className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center mb-3">
          <X size={18} className="text-red-400" strokeWidth={2.5} />
        </div>
        <span className="text-[11px] text-red-300/90 leading-relaxed line-clamp-4">{item.error}</span>
      </div>
    )}
 
    {item.status === 'completed' && item.url && (
      <>
        {/* Top-right menu */}
        <div className={`absolute top-3 right-3 opacity-0 -translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 pointer-events-none z-30 ${isMenuOpen ? '!opacity-100 !translate-y-0 !transition-none' : ''}`}>
          <div className="flex items-center gap-1 bg-white/70 backdrop-blur-[80px] rounded-[12px] p-1 shadow-xl pointer-events-auto" ref={menuRef}>
            <button className="w-[30px] h-[30px] flex items-center justify-center rounded-[8px] bg-transparent hover:bg-white transition-colors duration-200 outline-none">
               <Heart size={18} className="text-[#1a1a1a]" strokeWidth={2} />
            </button>
            <button className="w-[30px] h-[30px] flex items-center justify-center rounded-[8px] bg-transparent hover:bg-white transition-colors duration-200 outline-none">
               <Undo2 size={18} className="text-[#1a1a1a]" strokeWidth={2} />
            </button>
            <button 
              className={`w-[30px] h-[30px] flex items-center justify-center rounded-[8px] transition-colors duration-200 outline-none ${isMenuOpen ? 'bg-white' : 'bg-transparent hover:bg-white'}`}
              onClick={(e) => {
                e.stopPropagation();
                onMenuOpenChange(!isMenuOpen);
              }}
            >
               <MoreVertical size={18} className="text-[#1a1a1a]" strokeWidth={2} />
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
                  <button className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100">
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
                  
                  <button className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100">
                    <Plus size={18} strokeWidth={2.5} className="text-zinc-100" />
                    <span>Add to prompt</span>
                  </button>
                  <button className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100">
                    <Download size={18} strokeWidth={2.5} className="text-zinc-100" />
                    <span>Download</span>
                  </button>
                  <button className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100">
                    <Edit2 size={18} strokeWidth={2.5} className="text-zinc-100" />
                    <span>Rename</span>
                  </button>
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
                  
                  <button className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 transition-colors text-[14px] font-medium text-zinc-100">
                    <Flag size={18} strokeWidth={2.5} className="text-zinc-100" />
                    <span>Flag output</span>
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
        
        <div className="absolute bottom-0 left-0 right-0 h-[72px] bg-gradient-to-t from-black/45 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 px-5 pb-4 flex items-end pointer-events-none rounded-b-[18px]">
          <div className="flex items-center gap-2.5 w-full min-w-0">
            {item.kind === 'image' ? (
              <ImagesIcon className="text-white w-[17px] h-[17px] shrink-0" />
            ) : (
              <VideoIcon className="text-white w-[17px] h-[17px] shrink-0 translate-y-[1.5px]" />
            )}
            <span className="text-[14px] font-normal text-white truncate max-w-full">
              {item.prompt}
            </span>
          </div>
        </div>
      </>
    )}
  </>
  );
});
TileContent.displayName = 'TileContent';

export const MediaView: React.FC = () => {
  const { user, userProfile } = useAuth();
  const { apiKeys } = useUserDataContext();
  const [prompt, setPrompt] = React.useState('');
  const [projectName, setProjectName] = React.useState('May 25, 05:55 AM');
  const [isTopFaded, setIsTopFaded] = React.useState(false);
  const [isBottomFaded, setIsBottomFaded] = React.useState(false);
  const [activeMenuId, setActiveMenuId] = React.useState<string | null>(null);
  const [hoveredTileId, setHoveredTileId] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  interface ImageAttachment {
    id: string;
    url: string;
    name: string;
    file?: File;
  }
  const [attachments, setAttachments] = React.useState<ImageAttachment[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [removingIds, setRemovingIds] = React.useState<Set<string>>(new Set());
  const hasActiveAttachments = attachments.length > 0 && !attachments.every(att => removingIds.has(att.id));

  const removeAttachment = (id: string) => {
    setRemovingIds(prev => new Set(prev).add(id));
    setTimeout(() => {
      setAttachments(prev => prev.filter(att => att.id !== id));
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
        file
      }));
    setAttachments(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Model Menu State
  const [isModelMenuOpen, setIsModelMenuOpen] = React.useState(false);
  const [generationError, setGenerationError] = React.useState<string | null>(null);
  const [mediaItems, setMediaItems] = React.useState<MediaItem[]>([]);
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

  const [imageRatio, setImageRatio] = React.useState('16:9');
  const [imageBatch, setImageBatch] = React.useState('x4');
  const [videoMode, setVideoMode] = React.useState<'frames' | 'ingredients'>('ingredients');
  const [videoRatio, setVideoRatio] = React.useState('16:9');
  const [videoBatch, setVideoBatch] = React.useState('x4');
  const [videoDuration, setVideoDuration] = React.useState('10s');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);


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
    if (textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 384)}px`;
      
      // Delay fade calculation so browser scroll position completes updating first
      const handle = requestAnimationFrame(() => {
        updateFades(el);
      });
      return () => cancelAnimationFrame(handle);
    }
  }, [prompt]);

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
                prev.map(m => (m.id === item.id ? { ...m, prompt: text } : m)),
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
        throw new Error(errData?.error?.message || `API error (${response.status})`);
      }

      const data = await response.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
      if (!imagePart?.inlineData?.data) {
        throw new Error('No image returned. Try refining your prompt.');
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
        throw new Error(errData?.error?.message || `API error (${startResp.status})`);
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
            throw new Error(pollData.error.message || 'Video generation failed.');
          }
          videoUri =
            pollData?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ??
            pollData?.response?.videos?.[0]?.uri ??
            pollData?.response?.generatedVideos?.[0]?.video?.uri;
        }
      }

      if (!videoUri) throw new Error('Video generation timed out.');

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

  const handleGenerate = async () => {
    const activePrompt = prompt.trim();
    if (!activePrompt) return;
    setGenerationError(null);

    const activeAttachments = [...attachments];
    const attachmentIds = attachments.map(att => att.id);
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

  return (
    <div
      className="relative flex flex-col h-screen w-screen bg-[#000000] text-gray-200 overflow-hidden"
      style={{ fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif" }}
    >
      
      {/* Fading Backdrop Blur & Dark Gradient Strip */}
      <div 
        className="absolute inset-x-0 top-0 h-32 pointer-events-none z-20"
        style={{
          background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.95) 0%, rgba(0, 0, 0, 0.6) 40%, rgba(0, 0, 0, 0.15) 75%, transparent 100%)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          maskImage: 'linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.9) 35%, rgba(0, 0, 0, 0.3) 70%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.9) 35%, rgba(0, 0, 0, 0.3) 70%, transparent 100%)'
        }}
      />

      {/* Top Header */}
      <header className="absolute top-0 left-0 right-0 h-16 flex items-center justify-between px-4 shrink-0 z-40 bg-transparent pointer-events-none">
        
        {/* Left Section */}
        <div className="flex items-center gap-4 w-[300px] pointer-events-auto">
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
        <div className="flex items-center gap-3 flex-1 justify-center max-w-2xl pointer-events-auto">
          <div className="flex items-center bg-[#171717]/90 backdrop-blur-xl rounded-full h-11 w-full max-w-[500px] px-4 border border-transparent hover:border-white/10 transition-colors">
            <Search size={18} className="text-gray-400" />
            <input 
              type="text" 
              className="bg-transparent border-none outline-none text-sm text-white w-full ml-3"
              placeholder=""
            />
          </div>
          <button className="flex items-center justify-center w-11 h-11 rounded-full bg-[#171717]/90 backdrop-blur-xl hover:bg-[#202020]/90 transition-colors border border-transparent hover:border-white/10">
            <Filter size={18} className="text-gray-300" />
          </button>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-4 w-[300px] justify-end pointer-events-auto">
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
        <aside className={`${isSidebarCollapsed ? 'w-[74px]' : 'w-[238px]'} flex flex-col justify-between pt-16 pb-2 px-3 shrink-0 relative z-30`}>
          <nav className="flex flex-col gap-1">
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
        <main ref={mainRef} className="flex-1 bg-[#000000] relative overflow-y-auto no-scrollbar">
          {mediaItems.length > 0 && (
            <div
              className="flex flex-wrap gap-3 pt-[72px] pr-3 pb-44 w-full"
              style={{ ['--th' as any]: isSidebarCollapsed ? '230px' : '270px' }}
            >
              <AnimatePresence mode="popLayout">
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
                  const itemsPerRow = canvasInnerWidth > 0
                    ? Math.max(1, Math.floor((canvasInnerWidth + gap) / (naturalW + gap)))
                    : 0;
                  const maxW = itemsPerRow > 0
                    ? (canvasInnerWidth - (itemsPerRow - 1) * gap) / itemsPerRow
                    : 0;

                  return (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9, y: 16 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
                      transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
                      style={{
                        flexGrow: ar,
                        flexBasis: `calc(var(--th) * ${ar})`,
                        minWidth: `calc(var(--th) * ${ar} * 0.75)`,
                        maxWidth: maxW > 0 ? `${maxW}px` : undefined,
                        aspectRatio: ar,
                      }}
                      className={`gallery-tile relative group rounded-[18px] border border-white/5 bg-[#0c0c0c] shadow-2xl ${
                        activeMenuId === item.id ? 'overflow-visible z-40' : 'overflow-hidden z-10'
                      }`}
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
                      />
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </main>
      </div>

      {/* Centered Flower Empty State */}
      {mediaItems.length === 0 && (
        <div className="absolute top-[48%] left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none z-10">
          <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="mb-5 text-gray-500">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 16.5A4.5 4.5 0 1 1 7.5 12" />
            <path d="M12 7.5A4.5 4.5 0 1 1 16.5 12" />
            <path d="M12 16.5A4.5 4.5 0 1 0 16.5 12" />
            <path d="M12 7.5A4.5 4.5 0 1 0 7.5 12" />
          </svg>

          <p className="text-lg text-gray-500 font-medium">
            Start creating or drop media
          </p>
        </div>
      )}

      {/* Bottom Prompt Bar */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-[600px] z-50">
        <AssetMenuModal
          isOpen={isAssetMenuOpen}
          onClose={() => setIsAssetMenuOpen(false)}
          buttonRef={assetMenuPlusRef}
          projectName={projectName}
          mediaItems={mediaItems}
          onFileSelect={() => fileInputRef.current?.click()}
          onAddPrompt={(assetId, assetUrl, assetTitle) => {
            if (assetUrl) {
              setAttachments(prev => {
                if (prev.some(att => att.url === assetUrl)) return prev;
                return [...prev, {
                  id: assetId,
                  url: assetUrl,
                  name: assetTitle || 'Attached Image'
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
        <div className="bg-[#141517]/90 backdrop-blur-[80px] rounded-[22px] pt-3 pb-2 px-2 flex flex-col shadow-2xl border border-white/5">
          
          <input 
            type="file" 
            multiple 
            accept="image/*"
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileSelect} 
          />

          {/* Attachments Area */}
          <div className={`grid transition-[grid-template-rows,margin-bottom] duration-[250ms] ease-in-out ${hasActiveAttachments ? 'grid-rows-[1fr] mb-2.5' : 'grid-rows-[0fr] mb-0'}`}>
            <div className="overflow-hidden">
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-3 px-3 pt-2">
                {attachments.map((att) => (
                  <div key={att.id} className={`relative group flex-shrink-0 transition-all duration-200 ${removingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}>
                    <div className="relative">
                      <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1c]">
                        <img src={att.url} alt={att.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <button 
                        onClick={() => removeAttachment(att.id)}
                        className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <style>{`
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
            .no-scrollbar::-webkit-scrollbar {
              display: none;
            }
            @keyframes shimmer {
              0% { background-position: 200% 0; }
              100% { background-position: -200% 0; }
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
                  setAttachments(prev => [...prev, ...newAttachments]);
                }
              }}
              rows={1}
              placeholder="What do you want to create?" 
              className={`bg-transparent border-none outline-none text-[14px] font-medium text-white placeholder-[#606060] w-full pl-1 py-0.5 resize-none max-h-[384px] overflow-y-auto no-scrollbar transition-all duration-200 ${
                isTopFaded && isBottomFaded ? 'both-fade' : 
                isTopFaded ? 'top-fade' : 
                isBottomFaded ? 'bottom-fade' : ''
              }`}
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', paddingRight: '14px' }}
            />
            {prompt && (
              <button 
                onClick={() => setPrompt('')}
                className="absolute right-[-4px] top-[-4px] text-gray-500 hover:text-white transition-colors p-0.5 rounded-full hover:bg-white/5 cursor-pointer"
                title="Clear prompt"
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            )}
          </div>
          
          <div className="flex items-center justify-between mt-2.5">
            
            {/* Left Controls */}
            <div className="flex items-center gap-2.5 relative">
              <button
                ref={assetMenuPlusRef}
                onClick={() => setIsAssetMenuOpen(!isAssetMenuOpen)}
                className="text-[#a0a0a0] hover:text-white transition-colors ml-1.5 cursor-pointer outline-none"
              >
                <Plus size={22} strokeWidth={1.5} />
              </button>
              <button className="flex items-center justify-center h-9 bg-[#27282b] hover:bg-[#33343a] transition-colors rounded-full px-4 border border-transparent">
                <span className="text-[11px] font-semibold text-[#d0d0d0] tracking-wide">Agent</span>
              </button>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2.5 relative">
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => (isModelMenuOpen ? setIsModelMenuOpen(false) : openModelMenu())}
                  className={`flex items-center h-9 transition-colors rounded-full px-3.5 gap-1.5 border border-transparent ${isModelMenuOpen ? 'bg-[#33343a]' : 'bg-[#27282b] hover:bg-[#33343a]'}`}
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
                    <div className="flex bg-[#1e1f21]/50 backdrop-blur-md rounded-[14px] p-1">
                      <button
                        onClick={() => setModelMode('image')}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[10px] transition-colors font-normal ${modelMode === 'image' ? 'bg-[#f4f4f4] text-black' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                      >
                        <ImageIcon size={14} strokeWidth={2} />
                        <span className="text-[13px]">Image</span>
                      </button>
                      <button
                        onClick={() => setModelMode('video')}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[10px] transition-colors font-normal ${modelMode === 'video' ? 'bg-[#f4f4f4] text-black' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'}`}
                      >
                        <PlayCircle size={14} strokeWidth={2} />
                        <span className="text-[13px]">Video</span>
                      </button>
                    </div>

                    <AnimatePresence mode="popLayout" initial={false}>
                    {modelMode === 'image' ? (
                      <motion.div
                        key="image-panel"
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
                        className="flex flex-col gap-1.5"
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
                        className="flex flex-col gap-1.5"
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
                )}
                </AnimatePresence>,
                document.body
                )}
              </div>
              
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                className={`flex items-center justify-center w-9 h-9 rounded-full transition-all border border-transparent ${
                  !prompt.trim()
                    ? 'bg-[#27282b]/90 cursor-not-allowed'
                    : 'bg-white hover:bg-zinc-200 cursor-pointer active:scale-95'
                }`}
              >
                <ArrowRight size={16} strokeWidth={2.5} className={!prompt.trim() ? "text-white" : "text-black"} />
              </button>
            </div>

          </div>

        </div>
      </div>

    </div>
  );
};

export default MediaView;
