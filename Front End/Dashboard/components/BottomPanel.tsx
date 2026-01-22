import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { 
  ArrowRight, 
  Star, 
  MoreHorizontal, 
  SquareDashed, 
  Folder, 
  RotateCcw, 
  Pencil, 
  Settings, 
  Trash2 
} from 'lucide-react';
import { RECENT_PROJECTS } from '../constants';

interface ProjectMenuProps {
  onClose: () => void;
}

const ProjectMenu: React.FC<ProjectMenuProps> = ({ onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<'top' | 'bottom'>('bottom');

  useLayoutEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      if (rect.bottom > viewportHeight - 20) {
        setPosition('top');
      } else {
        setPosition('bottom');
      }
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const menuItems = [
    { label: 'Select', icon: SquareDashed },
    { label: 'Move to folder', icon: Folder },
    { label: 'Remix', icon: RotateCcw },
    { label: 'Rename', icon: Pencil },
    { label: 'Settings', icon: Settings },
    { label: 'Delete', icon: Trash2, variant: 'danger' },
  ];

  return (
    <div 
      ref={menuRef}
      className={`absolute right-0 w-fit min-w-[150px] bg-[#18181b] border border-white/10 rounded-2xl shadow-2xl py-1.5 z-50
        ${position === 'bottom' ? 'top-[50px]' : 'bottom-[50px]'}`}
    >
      {menuItems.map((item, idx) => (
        <button 
          key={idx}
          className={`w-full flex items-center gap-2.5 px-4 py-2 text-[13px] font-medium hover:bg-white/5 first:rounded-t-xl last:rounded-b-xl whitespace-nowrap
            ${item.variant === 'danger' ? 'text-[#ef4444]' : 'text-white/90'}`}
        >
          <item.icon size={15} strokeWidth={2.2} className="shrink-0" />
          {item.label}
        </button>
      ))}
    </div>
  );
};

import { useBackground } from '../context/BackgroundContext';
import { useAuth } from '../context/AuthContext';
import { HardDrive } from 'lucide-react';

interface BottomPanelProps {
  onOpenDriveSettings?: () => void;
}

export const BottomPanel: React.FC<BottomPanelProps> = ({ onOpenDriveSettings }) => {
  const [starredProjects, setStarredProjects] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [animatingStar, setAnimatingStar] = useState<string | null>(null);
  const { background } = useBackground();
  const { isDriveConnected } = useAuth();

  const toggleStar = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newStarred = new Set(starredProjects);
    if (newStarred.has(id)) {
      newStarred.delete(id);
    } else {
      newStarred.add(id);
      setAnimatingStar(id);
      setTimeout(() => setAnimatingStar(null), 300);
    }
    setStarredProjects(newStarred);
  };

  const toggleMenu = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setOpenMenuId(openMenuId === id ? null : id);
  };

  // Match sidebar opacity (90%) for waves, keep original (70%) for others
  const panelBgClass = background === 'waves'
    ? 'bg-[#0d0d0d]/90'
    : 'bg-[#0d0d0d]/70';

  return (
    <div className={`mx-12 ${panelBgClass} backdrop-blur-2xl border border-white/10 pt-7 pb-8 px-8 mt-auto rounded-[2rem] relative z-20 shadow-2xl transition-colors duration-300`}>
      <style>{`
        @keyframes subtle-star-jump {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
        .star-jump-icon {
          animation: subtle-star-jump 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
      `}</style>

      {/* Drive Not Connected Overlay */}
      {!isDriveConnected && (
        <div className="absolute inset-0 z-30 rounded-[2rem] overflow-hidden">
          <div className="absolute inset-0 backdrop-blur-md bg-[#0d0d0d]/80" />
          <div className="relative z-10 h-full flex flex-col items-center justify-center gap-6">
            <div className="w-16 h-16 rounded-2xl bg-[#272729] flex items-center justify-center border border-white/10 shadow-xl">
              <HardDrive size={28} className="text-white/70" />
            </div>
            <div className="text-center">
              <h3 className="text-[18px] font-bold text-white mb-2">Connect Google Drive to have Projects</h3>
              <p className="text-[14px] text-zinc-400 max-w-md">Save and access your projects from anywhere by connecting your Google Drive.</p>
            </div>
            <button 
              onClick={onOpenDriveSettings}
              className="px-6 py-3 bg-white text-black text-[14px] font-bold rounded-xl hover:bg-zinc-200 transition-all shadow-lg shadow-white/10 flex items-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Connect Google Drive
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2">
            <button className="text-[13px] font-semibold text-white px-4 py-2 bg-[#1f1f1f] rounded-xl border border-white/5 transition-all active:scale-95">Recently viewed</button>
            <button className="text-[13px] font-medium text-[#71717a] px-4 py-2 hover:text-white transition-colors">My projects</button>
            <button className="text-[13px] font-medium text-[#71717a] px-4 py-2 hover:text-white transition-colors">Starred</button>
        </div>
        <button className="flex items-center gap-1.5 text-[13px] font-medium text-[#71717a] hover:text-white transition-colors group">
            Browse all <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">
        {RECENT_PROJECTS.slice(0, 9).map((project, index) => {
          const isStarred = starredProjects.has(project.id);
          const isAnimating = animatingStar === project.id;
          const isMenuOpen = openMenuId === project.id;

          return (
            <div key={project.id} className="group cursor-pointer">
                <div className="relative aspect-[16/9] bg-[#1a1a1a] rounded-xl overflow-hidden border border-white/5 mb-4 transition-all group-hover:shadow-xl">
                    <img 
                      src={project.thumbnail} 
                      className="w-full h-full object-cover opacity-90" 
                      alt={project.title} 
                    />
                    
                    <div className="absolute top-3 right-3">
                      <button 
                        onClick={(e) => toggleStar(e, project.id)}
                        className={`w-10 h-10 flex items-center justify-center backdrop-blur-xl rounded-xl border active:scale-95
                          ${isStarred 
                            ? 'opacity-100 bg-black/60 border-white/10 text-yellow-400 shadow-lg shadow-yellow-500/10' 
                            : 'opacity-0 group-hover:opacity-100 bg-black/40 border-white/10 text-white/70 hover:text-white hover:bg-black/60'}`}
                      >
                        <div className={isAnimating ? 'star-jump-icon' : ''}>
                          <Star size={18} fill={isStarred ? "currentColor" : "none"} />
                        </div>
                      </button>
                    </div>
                </div>
                
                <div className="flex items-center justify-between px-1 relative">
                    <div className="flex items-center gap-3">
                        <img 
                          src={`https://picsum.photos/32/32?random=${index + 10}`} 
                          className="w-8 h-8 rounded-full border border-white/10 shrink-0"
                          alt="Project Owner"
                        />
                        <div className="flex flex-col">
                            <p className="text-[14px] font-bold text-white leading-tight">
                              {project.title}
                            </p>
                            <p className="text-[12px] font-medium text-[#52525b] mt-0.5">
                              Viewed {project.lastViewed}
                            </p>
                        </div>
                    </div>

                    <div className="relative">
                      <button 
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => toggleMenu(e, project.id)}
                        className={`p-2 rounded-xl transition-opacity
                          ${isMenuOpen 
                            ? 'opacity-100 text-white bg-transparent' 
                            : 'opacity-0 group-hover:opacity-100 text-[#52525b] hover:text-white hover:bg-white/5'}`}
                      >
                        <MoreHorizontal size={20} />
                      </button>
                      
                      {isMenuOpen && (
                        <ProjectMenu onClose={() => setOpenMenuId(null)} />
                      )}
                    </div>
                </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};