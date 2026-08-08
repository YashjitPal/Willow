import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { 
  Paperclip, Image as ImageIcon, Lightbulb, Telescope, MoreHorizontal, 
  ChevronRight, Globe, BookOpen, SquarePen, Copy, ImagePlus
} from 'lucide-react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

const SpotifyIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#1ed760">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.54.659.3 1.02zm1.44-3.3c-.301.42-.84.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
  </svg>
);

const GEMINI_TOOL_SYMBOLS: Record<string, string> = {
  'Create image': 'add_photo_alternate',
  Thinking: 'lightbulb',
  'Deep research': 'travel_explore',
  'Web search': 'language',
  'Study and learn': 'school',
  Canvas: 'draw',
  Quizzes: 'quiz',
};

export const PlusDropdownMenu: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onFileSelect: () => void;
  onImportCode?: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
  onToolSelect: (toolId: string) => void;
  geminiStyle?: boolean;
}> = ({ isOpen, onClose, onFileSelect, onImportCode, buttonRef, onToolSelect, geminiStyle = false }) => {
  const [isMoreHovered, setIsMoreHovered] = useState(false);
  const [isMoreUploadsHovered, setIsMoreUploadsHovered] = useState(false);
  const [side, setSide] = useState<'bottom' | 'top'>('bottom');
  const menuRef = useRef<HTMLDivElement>(null);
  const moreMenuTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const moreUploadsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Reset submenu state when the main menu closes
  useEffect(() => {
    if (!isOpen) {
      setIsMoreHovered(false);
      setIsMoreUploadsHovered(false);
    }
  }, [isOpen]);

  // Flip above/below the trigger depending on available viewport space.
  // Runs on open and on resize so a bottom-docked InputBar opens the menu upward.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const recompute = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 260;
      const gap = 8;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setSide(
        spaceBelow < menuH + gap && spaceAbove > spaceBelow ? 'top' : 'bottom'
      );
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [isOpen, buttonRef]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Check if click is outside both menu and trigger button
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose, buttonRef]);

  if (!isOpen) return null;

  const MenuItem = ({ icon: Icon, label, onClick, closeSubmenu, toolId }: { icon: any, label: string, onClick?: () => void, closeSubmenu?: boolean, toolId?: string }) => (
    <button
      onClick={() => {
        if (toolId) {
          onToolSelect(toolId);
          onClose();
        } else if (onClick) {
            onClick();
            onClose();
        }
      }}
      onMouseEnter={() => {
        if (closeSubmenu) {
          setIsMoreHovered(false);
          setIsMoreUploadsHovered(false);
        }
      }}
      className={geminiStyle
        ? "w-full h-9 flex items-center gap-2 px-2 rounded-xl hover:bg-[#333537] cursor-pointer text-left transition-colors"
        : "w-[calc(100%-12px)] flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg hover:bg-white/10 cursor-pointer text-left"}
    >
      {Icon === SpotifyIcon ? (
        <SpotifyIcon size={20} />
      ) : geminiStyle ? (
        <MaterialSymbol name={GEMINI_TOOL_SYMBOLS[label]} className="text-[#e6e6e6]" />
      ) : (
        <Icon size={20} className="shrink-0 text-[#e6e6e6]" strokeWidth={1.6} />
      )}
      <span className={`${geminiStyle ? "text-[13px] leading-[17px] font-['Google_Sans_Flex','Google_Sans','Inter',sans-serif]" : 'text-[14.5px]'} text-[#e6e6e6] font-normal`}>{label}</span>
    </button>
  );

  const handleMoreEnter = () => {
    if (moreMenuTimeoutRef.current) clearTimeout(moreMenuTimeoutRef.current);
    setIsMoreUploadsHovered(false);
    setIsMoreHovered(true);
  };

  const handleMoreUploadsEnter = () => {
    if (moreUploadsTimeoutRef.current) clearTimeout(moreUploadsTimeoutRef.current);
    setIsMoreHovered(false);
    setIsMoreUploadsHovered(true);
  };

  const handleMoreUploadsLeave = () => {
    moreUploadsTimeoutRef.current = setTimeout(() => {
      setIsMoreUploadsHovered(false);
    }, 150);
  };

  const handleMoreLeave = () => {
    moreMenuTimeoutRef.current = setTimeout(() => {
      setIsMoreHovered(false);
    }, 150);
  };

  return (
    <div
      ref={menuRef}
      className={`absolute ${
        side === 'top' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'
      } left-0 z-[100] ${geminiStyle ? 'w-[249px] bg-[#1f1f1f] rounded-[20px] shadow-[0_0_20px_rgba(0,0,0,0.28)] p-2' : 'w-[230px] bg-[#2f2f2f] rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] py-2 border border-white/5'}`}
      role="menu"
      aria-label="Willow tools"
    >
      <button
        onClick={() => { onFileSelect(); onClose(); }}
        onMouseEnter={() => {
          setIsMoreHovered(false);
          setIsMoreUploadsHovered(false);
        }}
        className={geminiStyle
          ? "w-full h-9 flex items-center gap-2 px-2 rounded-xl hover:bg-[#333537] cursor-pointer text-left transition-colors"
          : "w-[calc(100%-12px)] flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg hover:bg-white/10 cursor-pointer text-left"}
      >
        {geminiStyle
          ? <MaterialSymbol name="attach_file" className="text-[#e6e6e6]" />
          : <Paperclip size={20} className="shrink-0 text-[#e6e6e6]" strokeWidth={1.6} />}
        <span className={`${geminiStyle ? "text-[13px] leading-[17px] font-['Google_Sans_Flex','Google_Sans','Inter',sans-serif]" : 'text-[14.5px]'} text-[#e6e6e6] font-normal`}>
          {geminiStyle ? 'Upload files' : 'Add photos & files'}
        </span>
      </button>

      {onImportCode && <div
        className="relative"
        onMouseEnter={handleMoreUploadsEnter}
        onMouseLeave={handleMoreUploadsLeave}
      >
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={isMoreUploadsHovered}
          onClick={() => setIsMoreUploadsHovered(true)}
          className={`${geminiStyle ? 'h-9 w-full px-2 rounded-xl' : 'w-[calc(100%-12px)] px-3 py-2 mx-1.5 rounded-lg'} flex items-center justify-between cursor-pointer transition-colors ${isMoreUploadsHovered ? (geminiStyle ? 'bg-[#333537]' : 'bg-white/10') : (geminiStyle ? 'hover:bg-[#333537]' : 'hover:bg-white/10')}`}
        >
          <div className={`flex items-center ${geminiStyle ? 'gap-2' : 'gap-3'}`}>
            {geminiStyle
              ? <MaterialSymbol name="more_horiz" className="text-[#e6e6e6]" />
              : <MoreHorizontal size={20} className="text-[#e6e6e6]" strokeWidth={1.6} />}
            <span className={`${geminiStyle ? "text-[13px] leading-[17px] font-['Google_Sans_Flex','Google_Sans','Inter',sans-serif]" : 'text-[14.5px]'} text-[#e6e6e6] font-normal`}>
              More uploads
            </span>
          </div>
          {geminiStyle
            ? <MaterialSymbol name="chevron_right" className="text-[#c4c7c5]" />
            : <ChevronRight size={16} className="text-[#c4c7c5]" strokeWidth={2} />}
        </button>

        {isMoreUploadsHovered && (
          <div
            className={`absolute ${
              side === 'top' ? 'bottom-[-8px]' : 'top-[-8px]'
            } left-[calc(100%+4px)] z-[110] ${geminiStyle ? 'w-[233px] bg-[#1f1f1f] rounded-[20px] shadow-[0_0_20px_rgba(0,0,0,0.28)] p-2 max-sm:left-0 max-sm:top-auto max-sm:bottom-[calc(100%+4px)]' : 'w-[200px] bg-[#2f2f2f] rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] py-2 border border-white/5'}`}
            role="menu"
            aria-label="More upload options"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onImportCode();
                onClose();
              }}
              className={geminiStyle
                ? "w-full h-9 flex items-center gap-2 px-2 rounded-xl hover:bg-[#333537] cursor-pointer text-left transition-colors"
                : "w-[calc(100%-12px)] flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg hover:bg-white/10 cursor-pointer text-left"}
            >
              {geminiStyle
                ? <MaterialSymbol name="code" className="text-[#e6e6e6]" />
                : <MaterialSymbol name="code" size={20} className="text-[#e6e6e6]" />}
              <span className={`${geminiStyle ? "text-[13px] leading-[17px] font-['Google_Sans_Flex','Google_Sans','Inter',sans-serif]" : 'text-[14.5px]'} text-[#e6e6e6] font-normal`}>
                Import code
              </span>
            </button>
          </div>
        )}
      </div>}
      
      <div className={`${geminiStyle ? 'h-px bg-[#444746] mx-2 my-2' : 'h-[1px] bg-white/10 mx-3 my-1.5'}`} role="separator" />
      
      <MenuItem icon={ImagePlus} label="Create image" closeSubmenu toolId="images" />
      <MenuItem icon={Lightbulb} label="Thinking" closeSubmenu toolId="thinking" />
      <MenuItem icon={Telescope} label="Deep research" closeSubmenu toolId="research" />
      
      <div 
        className="relative"
        onMouseEnter={handleMoreEnter}
        onMouseLeave={handleMoreLeave}
      >
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={isMoreHovered}
          onClick={() => setIsMoreHovered(true)}
          className={`${geminiStyle ? 'h-9 w-full px-2 rounded-xl' : 'px-3 py-2 mx-1.5 mt-1 rounded-lg'} flex items-center justify-between cursor-pointer transition-colors ${isMoreHovered ? (geminiStyle ? 'bg-[#333537]' : 'bg-white/10') : (geminiStyle ? 'hover:bg-[#333537]' : 'hover:bg-white/10')}`}
        >
          <div className={`flex items-center ${geminiStyle ? 'gap-2' : 'gap-3'}`}>
            {geminiStyle
              ? <MaterialSymbol name="more_horiz" className="text-[#e6e6e6]" />
              : <MoreHorizontal size={20} className="text-[#e6e6e6]" strokeWidth={1.6} />}
            <span className={`${geminiStyle ? "text-[13px] leading-[17px] font-['Google_Sans_Flex','Google_Sans','Inter',sans-serif]" : 'text-[14.5px]'} text-[#e6e6e6] font-normal`}>
              {geminiStyle ? 'More tools' : 'More'}
            </span>
          </div>
          {geminiStyle
            ? <MaterialSymbol name="chevron_right" className="text-[#c4c7c5]" />
            : <ChevronRight size={16} className="text-[#c4c7c5]" strokeWidth={2} />}
        </button>

        {isMoreHovered && (
          <div
            className={`absolute ${
              side === 'top' ? 'bottom-[-8px]' : 'top-[-8px]'
            } left-[calc(100%+4px)] z-[110] ${geminiStyle ? 'w-[233px] bg-[#1f1f1f] rounded-[20px] shadow-[0_0_20px_rgba(0,0,0,0.28)] p-2 max-sm:left-0 max-sm:top-auto max-sm:bottom-[calc(100%+4px)]' : 'w-[200px] bg-[#2f2f2f] rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] py-2 border border-white/5'}`}
            role="menu"
            aria-label="More tools"
          >
            <MenuItem icon={Globe} label="Web search" toolId="web" />
            <MenuItem icon={BookOpen} label="Study and learn" toolId="learn" />
            <MenuItem icon={SquarePen} label="Canvas" toolId="canvas" />
            <MenuItem icon={Copy} label="Quizzes" toolId="quizzes" />
            <MenuItem icon={SpotifyIcon} label="Spotify" toolId="spotify" />
          </div>
        )}
      </div>
    </div>
  );
};
