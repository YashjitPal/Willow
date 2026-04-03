import React, { useState, useRef, useEffect } from 'react';
import { 
  Paperclip, Image as ImageIcon, Lightbulb, Telescope, MoreHorizontal, 
  ChevronRight, Globe, BookOpen, SquarePen, Github, Copy, ImagePlus
} from 'lucide-react';

const SpotifyIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#1ed760">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.54.659.3 1.02zm1.44-3.3c-.301.42-.84.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
  </svg>
);

export const PlusDropdownMenu: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onFileSelect: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
  onToolSelect: (toolId: string) => void;
}> = ({ isOpen, onClose, onFileSelect, buttonRef, onToolSelect }) => {
  const [isMoreHovered, setIsMoreHovered] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreMenuTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Reset submenu state when the main menu closes
  useEffect(() => {
    if (!isOpen) {
      setIsMoreHovered(false);
    }
  }, [isOpen]);

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
    <div 
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
        if (closeSubmenu) setIsMoreHovered(false);
      }}
      className="flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
    >
      {Icon === SpotifyIcon ? <SpotifyIcon size={20} /> : <Icon size={20} className="text-[#e0e0e0]" strokeWidth={1.6} />}
      <span className="text-[14.5px] text-[#e0e0e0] font-normal">{label}</span>
    </div>
  );

  const handleMoreEnter = () => {
    if (moreMenuTimeoutRef.current) clearTimeout(moreMenuTimeoutRef.current);
    setIsMoreHovered(true);
  };

  const handleMoreLeave = () => {
    moreMenuTimeoutRef.current = setTimeout(() => {
      setIsMoreHovered(false);
    }, 150);
  };

  return (
    <div 
      ref={menuRef}
      className="absolute top-[calc(100%+8px)] left-0 w-[230px] bg-[#2f2f2f] rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] py-2 z-[100] border border-white/5"
    >
      <div 
        onClick={() => { onFileSelect(); onClose(); }}
        onMouseEnter={() => setIsMoreHovered(false)}
        className="flex items-center gap-3 px-3 py-2 mx-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
      >
        <Paperclip size={20} className="text-[#e0e0e0]" strokeWidth={1.6} />
        <span className="text-[14.5px] text-[#e0e0e0] font-normal">Add photos & files</span>
      </div>
      
      <div className="h-[1px] bg-white/10 mx-3 my-1.5" />
      
      <MenuItem icon={ImagePlus} label="Create image" closeSubmenu toolId="images" />
      <MenuItem icon={Lightbulb} label="Thinking" closeSubmenu toolId="thinking" />
      <MenuItem icon={Telescope} label="Deep research" closeSubmenu toolId="research" />
      
      <div 
        className="relative"
        onMouseEnter={handleMoreEnter}
        onMouseLeave={handleMoreLeave}
      >
        <div 
          className={`flex items-center justify-between px-3 py-2 mx-1.5 mt-1 rounded-lg cursor-pointer transition-colors ${isMoreHovered ? 'bg-white/10' : 'hover:bg-white/10'}`}
        >
          <div className="flex items-center gap-3">
            <MoreHorizontal size={20} className="text-[#e0e0e0]" strokeWidth={1.6} />
            <span className="text-[14.5px] text-[#e0e0e0] font-normal">More</span>
          </div>
          <ChevronRight size={16} className="text-[#a0a0a0]" strokeWidth={2} />
        </div>

        {isMoreHovered && (
          <div 
            className="absolute top-[-8px] left-[calc(100%+4px)] w-[200px] bg-[#2f2f2f] rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] py-2 z-[110] border border-white/5"
          >
            <MenuItem icon={Globe} label="Web search" toolId="web" />
            <MenuItem icon={BookOpen} label="Study and learn" toolId="learn" />
            <MenuItem icon={SquarePen} label="Canvas" toolId="canvas" />
            <MenuItem icon={Github} label="GitHub" toolId="github" />
            <MenuItem icon={Copy} label="Quizzes" toolId="quizzes" />
            <MenuItem icon={SpotifyIcon} label="Spotify" toolId="spotify" />
          </div>
        )}
      </div>
    </div>
  );
};
