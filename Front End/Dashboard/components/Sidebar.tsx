
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Home, 
  Search, 
  LayoutGrid, 
  Star, 
  Users, 
  Compass, 
  Activity, 
  PanelLeftClose,
  ChevronDown,
  PanelLeft,
  Inbox,
  Settings,
  CircleHelp,
  Book,
  LogOut,
  ChevronRight,
  Contrast,
  ArrowUpRight,
  UserPlus,
  Zap,
  Check,
  Plus,
  LogIn
} from 'lucide-react';
import logo from '../src/assets/logo.png';
import './Sidebar.css';
import { useAuth } from '../context/AuthContext';

const DiscordIcon = ({ size = 18, strokeWidth = 1.2, ...props }: any) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="-2 -2 20 20" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth={strokeWidth} 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    {...props}
  >
    <path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032q.003.022.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019q.463-.63.818-1.329a.05.05 0 0 0-.01-.059l-.018-.011a9 9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066l.015-.019q.127-.095.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007q.121.1.248.195a.05.05 0 0 1-.004.085 8 8 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.019m-8.198 7.307c-.789 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612m5.316 0c-.788 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612"/>
  </svg>
);

const SidebarItem: React.FC<{ 
  icon: React.ElementType; 
  label: string; 
  active?: boolean; 
  isCollapsed: boolean;
  onClick?: () => void;
  href?: string;
}> = ({ icon: Icon, label, active, isCollapsed, onClick, href }) => (
  <div className="px-[14px]">
    <button 
      onClick={href ? () => window.open(href, '_blank') : onClick}
      className={`relative flex items-center h-[36px] w-full transition-colors duration-150 group/item overflow-hidden 
        ${active ? 'bg-[#1f1f1f] text-white' : 'text-white hover:bg-[#272729] hover:text-white'}
        rounded-xl`}
    >
      <div className="flex items-center justify-center w-[36px] shrink-0">
        <Icon size={18} strokeWidth={active ? 2.2 : 2} className="transition-transform duration-200 group-active/item:scale-90" />
      </div>
      <span className={`whitespace-nowrap text-[13.5px] font-medium tracking-tight transition-opacity duration-200 ease-linear ${isCollapsed ? 'opacity-0' : 'opacity-100'}`}>
        {!isCollapsed && label}
      </span>
      
      {href && !isCollapsed && (
        <div className="ml-auto pr-3 opacity-0 group-hover/item:opacity-100 transition-opacity flex items-center justify-center">
          <ArrowUpRight size={16} strokeWidth={1.5} className="text-zinc-400 group-hover/item:text-white" />
        </div>
      )}

      {isCollapsed && (
        <div className="absolute left-[54px] ml-2 px-3 py-1.5 bg-[#18181b] text-white text-[12px] font-medium rounded-lg opacity-0 group-hover/item:opacity-100 pointer-events-none transition-opacity duration-200 whitespace-nowrap z-50 border border-white/5 shadow-2xl">
          {label}
        </div>
      )}
    </button>
  </div>
);

const SectionHeader: React.FC<{ title: string; isCollapsed: boolean }> = ({ title, isCollapsed }) => (
  <div className="h-[36px] mt-4 mb-0.5 flex items-center overflow-hidden" style={{ paddingLeft: '23px' }}>
    <span className={`text-[13.5px] font-medium text-white transition-opacity duration-150 ${isCollapsed ? 'opacity-0' : 'opacity-100'}`}>
      {!isCollapsed && title}
    </span>
  </div>
);

import { useBackground, BackgroundType } from '../context/BackgroundContext';

const AppearanceMenu: React.FC<{ onClose: () => void; isClosing?: boolean; isMounted?: boolean }> = ({ onClose, isClosing, isMounted }) => {
  const [theme, setTheme] = useState('system');
  const { background, setBackground } = useBackground();

  const backgrounds: { id: BackgroundType; label: string; preview: React.ReactNode }[] = [
    {
      id: 'waves',
      label: 'Waves',
      preview: (
        <div className="w-full h-full bg-gradient-to-t from-[#D94080] via-[#4099FF] to-[#1f1f1f]" />
      )
    },
    {
      id: 'lines',
      label: 'Lines',
      preview: (
        <div className="w-full h-full bg-[#030303] relative overflow-hidden">
          {/* Gold-silvery glowing lines on dark background */}
          <div className="absolute inset-0 flex justify-around">
            <div className="w-[2px] h-full bg-gradient-to-b from-amber-400/80 via-yellow-300/60 to-transparent blur-[1px]" />
            <div className="w-[2px] h-full bg-gradient-to-b from-gray-300/70 via-slate-400/50 to-transparent blur-[1px]" />
            <div className="w-[2px] h-full bg-gradient-to-b from-amber-300/60 via-orange-400/40 to-transparent blur-[1px]" />
            <div className="w-[2px] h-full bg-gradient-to-b from-slate-300/50 via-gray-400/30 to-transparent blur-[1px]" />
          </div>
        </div>
      )
    },
    {
      id: 'solid',
      label: 'Dark',
      preview: (
        <div className="w-full h-full bg-[#1c1c1c]" />
      )
    }
  ];

  // Determine animation state
  const getAnimationClass = () => {
    if (isClosing) return 'opacity-0 translate-x-[-8px]';
    if (isMounted) return 'opacity-100 translate-x-0';
    return 'opacity-0 translate-x-[-8px]'; // Initial state before mounting animation
  };

  return (
    <div 
      className={`absolute top-0 left-[calc(100%+12px)] w-[200px] bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl py-2 z-[70] transition-all duration-150
        before:absolute before:-left-6 before:top-0 before:bottom-0 before:w-6 before:content-['']
        ${getAnimationClass()}`}
    >
      <div className="p-3 grid grid-cols-3 gap-3">
        {backgrounds.map((bg) => (
          <button 
            key={bg.id}
            onClick={() => setBackground(bg.id)}
            className={`aspect-square rounded-xl overflow-hidden transition-all ring-2 ${
              background === bg.id 
                ? 'ring-white/60 scale-105' 
                : 'ring-white/10 hover:ring-white/30'
            }`}
            title={bg.label}
          >
            {bg.preview}
          </button>
        ))}
      </div>

      <div className="px-1.5 space-y-0.5 mt-1">
        <button 
          onClick={() => setTheme('amoled')}
          className="w-full flex items-center justify-between px-3 h-[30px] text-[13.5px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors"
        >
          <span>Amoled</span>
          {theme === 'amoled' && <Check size={16} className="text-white" />}
        </button>
        <button 
          onClick={() => setTheme('dark')}
          className="w-full flex items-center justify-between px-3 h-[30px] text-[13.5px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors"
        >
          <span>Dark</span>
          {theme === 'dark' && <Check size={16} className="text-white" />}
        </button>
        <button 
          onClick={() => setTheme('system')}
          className="w-full flex items-center justify-between px-3 h-[30px] text-[13.5px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors"
        >
          <span>System</span>
          {theme === 'system' && <Check size={16} className="text-white" />}
        </button>
      </div>
    </div>
  );
};


const UserMenu: React.FC<{ isOpen: boolean; onClose: () => void; isCollapsed: boolean; onSettingsClick?: () => void }> = ({ isOpen, onClose, isCollapsed, onSettingsClick }) => {
  const { user, signInWithGoogle, signOut } = useAuth();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showAppearance, setShowAppearance] = useState(false);
  const [shouldRenderAppearance, setShouldRenderAppearance] = useState(false);
  const [isAppearanceClosing, setIsAppearanceClosing] = useState(false);
  const [isAppearanceMounted, setIsAppearanceMounted] = useState(false);

  // Handle appearance submenu animation
  useEffect(() => {
    if (showAppearance) {
      setShouldRenderAppearance(true);
      setIsAppearanceClosing(false);
      // Trigger mount animation after render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAppearanceMounted(true);
        });
      });
    } else if (shouldRenderAppearance) {
      setIsAppearanceClosing(true);
      setIsAppearanceMounted(false);
      const timer = setTimeout(() => {
        setShouldRenderAppearance(false);
        setIsAppearanceClosing(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [showAppearance]);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!shouldRender) return null;

  return (
    <div 
      ref={menuRef}
      className={`absolute bottom-[46px] left-0 w-[200px] bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl py-2 z-[60] origin-bottom-left ${isClosing ? 'menu-fade-out' : 'menu-fade-in'}`}
    >
      <div className="px-3.5 py-2.5 flex items-center gap-2.5 border-b border-white/5 mb-1.5">
        {user ? (
          <>
            <img 
              src={user.photoURL || 'https://picsum.photos/64/64?random=42'} 
              alt="User" 
              className="w-6 h-6 rounded-full border border-white/10 shrink-0" 
            />
            <span className="text-[13.5px] font-bold text-white truncate tracking-tight">{user.email}</span>
          </>
        ) : (
          <button
            onClick={async () => {
              try {
                await signInWithGoogle();
                onClose();
              } catch (error) {
                console.error('Sign in failed:', error);
              }
            }}
            className="w-full flex items-center gap-2.5 text-[13.5px] font-medium text-white hover:text-blue-400 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span>Sign in with Google</span>
          </button>
        )}
      </div>

      <div className="px-1.5 space-y-0.5">
        <button 
            onClick={() => {
                onClose();
                onSettingsClick?.();
            }}
            className="w-full flex items-center gap-3 px-3 h-[36px] text-[13.5px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors"
        >
          <Settings size={18} strokeWidth={2} />
          <span>Settings</span>
        </button>
        
        <div 
          className="relative"
          onMouseEnter={() => setShowAppearance(true)}
          onMouseLeave={() => setShowAppearance(false)}
        >
          <button 
             onClick={() => setShowAppearance(!showAppearance)}
             className="w-full flex items-center justify-between px-3 h-[36px] text-[13.5px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl group/btn"
          >
            <div className="flex items-center gap-3">
              <Contrast size={18} strokeWidth={2} />
              <span>Appearance</span>
            </div>
            <ChevronRight size={14} className="text-white/60 group-hover/btn:text-white" />
          </button>
          
          {shouldRenderAppearance && (
            <AppearanceMenu onClose={() => setShowAppearance(false)} isClosing={isAppearanceClosing} isMounted={isAppearanceMounted} />
          )}
        </div>

        <button 
          onClick={() => window.open('https://discord.gg/7TEtRfxGtP', '_blank')}
          className="w-full flex items-center gap-3 px-3 h-[36px] text-[13.5px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors"
        >
          <Users size={18} strokeWidth={2} />
          <span>Community</span>
        </button>
      </div>

      {user && (
        <div className="mt-1.5 pt-1.5 px-1.5 border-t border-white/5">
          <button 
            onClick={async () => {
              try {
                await signOut();
                onClose();
              } catch (error) {
                console.error('Sign out failed:', error);
              }
            }}
            className="w-full flex items-center gap-3 px-3 h-[36px] text-[13.5px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl"
          >
            <LogOut size={18} strokeWidth={2} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
};

const WorkspaceMenu: React.FC<{ isOpen: boolean; onClose: () => void; onSettingsClick?: () => void; triggerRef?: React.RefObject<HTMLButtonElement> }> = ({ isOpen, onClose, onSettingsClick, triggerRef }) => {
  const { user, userProfile } = useAuth();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Workspace color mapping
  const getWorkspaceColorClass = (color: string | null | undefined) => {
    switch (color) {
      case 'pink': return 'bg-[#ec4899]';
      case 'yellow': return 'bg-[#eab308]';
      case 'orange': return 'bg-[#f97316]';
      case 'green':
      default: return 'bg-[#4a7c59]';
    }
  };

  const workspaceInitial = userProfile?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'W';
  
  // Generate dynamic workspace name fallback
  const getDefaultWorkspaceName = () => {
    if (userProfile?.workspaceName) return userProfile.workspaceName;
    if (userProfile?.displayName) {
      const firstName = userProfile.displayName.split(' ')[0];
      return `${firstName}'s Willow`;
    }
    return "My Willow";
  };
  const workspaceName = getDefaultWorkspaceName();
  const workspaceColorClass = getWorkspaceColorClass(userProfile?.workspaceColor);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // If the click is on the trigger, the toggle logic in Sidebar will handle it
      if (triggerRef?.current?.contains(event.target as Node)) {
        return;
      }
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose, triggerRef]);

  if (!shouldRender) return null;

  return (
    <div 
      ref={menuRef}
      className={`absolute top-[50px] left-3 w-[270px] bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl p-2 z-[60] origin-top-left ${isClosing ? 'menu-fade-out' : 'menu-fade-in'}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-2 mb-2">
        <div className={`w-10 h-10 rounded-xl ${workspaceColorClass} flex items-center justify-center text-[16px] font-bold text-white shadow-inner shrink-0`}>
          {workspaceInitial}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[14px] font-bold text-white truncate">{workspaceName}</span>
          <span className="text-[12px] text-zinc-400">1 member</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 mb-4 px-1">
        <button 
          onClick={() => {
            onClose();
            onSettingsClick?.();
          }}
          className="flex-1 flex items-center justify-center gap-2 h-9 bg-[#27272a] hover:bg-[#3f3f46] text-white text-[13px] font-medium rounded-lg transition-colors border border-white/5"
        >
          <Settings size={14} />
          Settings
        </button>
        <button className="flex-1 flex items-center justify-center gap-2 h-9 bg-[#27272a] hover:bg-[#3f3f46] text-white text-[13px] font-medium rounded-lg transition-colors border border-white/5">
          <UserPlus size={14} />
          Invite
        </button>
      </div>

      {/* Quota Section */}
      <div className="bg-[#27272a]/50 border border-white/5 rounded-xl p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[14px] font-bold text-white">Quota</span>
          <div className="flex items-center gap-1 text-[#a1a1aa] text-[12px] cursor-pointer hover:text-white transition-colors">
            <span>5 left</span>
            <ChevronRight size={12} />
          </div>
        </div>
        <div className="h-2 w-full bg-[#3f3f46] rounded-full overflow-hidden mb-2">
          <div className="h-full bg-[#2563eb] w-[30%] rounded-full" />
        </div>
        <div className="flex items-center gap-2">
           <div className="w-2 h-2 rounded-full bg-[#71717a]" />
           <span className="text-[11px] text-[#a1a1aa]">Daily credits reset at midnight UTC</span>
        </div>
      </div>

      {/* Workspaces List */}
      <div className="px-1">
        <div className="text-[12px] font-medium text-[#71717a] mb-2 px-1">All workspaces</div>
        
        <button className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/5 group transition-colors mb-1 bg-white/[0.03]">
          <div className="flex items-center gap-3">
             <div className={`w-8 h-8 rounded-lg ${workspaceColorClass} flex items-center justify-center text-[12px] font-bold text-white shadow-inner`}>{workspaceInitial}</div>
             <span className="text-[14px] font-medium text-white">{workspaceName}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#27272a] text-[#a1a1aa] border border-white/5">FREE</span>
            <Check size={16} className="text-white" />
          </div>
        </button>

         <button className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 text-[#a1a1aa] hover:text-white transition-colors">
            <div className="w-8 h-8 rounded-lg bg-[#27272a] border border-white/5 flex items-center justify-center">
              <Plus size={16} />
            </div>
            <span className="text-[14px] font-medium">Create new workspace</span>
        </button>
      </div>
    </div>
  );
};

export type ViewType = 'home' | 'projects' | 'staging' | 'starred' | 'shared';

interface SidebarProps {
  onSearchClick?: () => void;
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  onSettingsClick?: () => void;
  backgroundType?: 'waves' | 'lines' | 'solid';
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  onSearchClick, 
  currentView, 
  onViewChange, 
  onSettingsClick, 
  backgroundType,
  isCollapsed,
  onToggleCollapse
}) => {
  const { user, userProfile } = useAuth();
  const navigate = useNavigate();
  // const [isCollapsed, setIsCollapsed] = useState(false); // LIFTED UP
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);

  // const toggleSidebar = () => setIsCollapsed(!isCollapsed); // LIFTED UP

  const handleUserMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsUserMenuOpen(!isUserMenuOpen);
  };

  // Workspace color mapping
  const getWorkspaceColorClass = (color: string | null | undefined) => {
    switch (color) {
      case 'pink': return 'bg-[#ec4899]';
      case 'yellow': return 'bg-[#eab308]';
      case 'orange': return 'bg-[#f97316]';
      case 'green':
      default: return 'bg-[#4a7c59]';
    }
  };

  // Get first letter for workspace icon
  const workspaceInitial = userProfile?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'W';
  
  // Generate dynamic workspace name fallback
  const getDefaultWorkspaceName = () => {
    if (userProfile?.workspaceName) return userProfile.workspaceName;
    if (userProfile?.displayName) {
      const firstName = userProfile.displayName.split(' ')[0];
      return `${firstName}'s Willow`;
    }
    return "My Willow";
  };
  const workspaceName = getDefaultWorkspaceName();
  const workspaceColorClass = getWorkspaceColorClass(userProfile?.workspaceColor);

  // Apply transparency only for 'waves' background - 90% opacity (happy medium)
  const sidebarBgClass = backgroundType === 'waves' 
    ? 'bg-[#0d0d0d]/90 backdrop-blur-xl' 
    : 'bg-[#0d0d0d]';

  return (
    <aside 
      className={`group relative h-screen ${sidebarBgClass} flex flex-col shrink-0 z-50 ${isCollapsed ? 'w-[64px]' : 'w-[260px]'}`}
      style={{ 
        transition: 'width 280ms cubic-bezier(0.32, 0.72, 0, 1)'
      }}
    >
      <div className="h-16 flex items-center relative">
        <div className="w-[64px] flex items-center justify-center shrink-0">
          <button 
            onClick={onToggleCollapse}
            className="w-full h-10 flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer relative group/logo"
          >
            <div className={`transition-all duration-200 flex items-center justify-center
              ${isCollapsed ? 'group-hover:opacity-0 group-hover:scale-75' : 'opacity-100 scale-100'}`}>
              <img src={logo} alt="Logo" className="h-[31px] w-auto object-contain shrink-0" />
            </div>
            {isCollapsed && (
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 transform scale-90 group-hover:scale-110 pointer-events-none">
                <PanelLeft 
                  size={18} 
                  strokeWidth={2.5} 
                  className="text-zinc-400 group-hover:text-white" 
                />
              </div>
            )}
          </button>
        </div>
        
        {!isCollapsed && (
          <div className="absolute right-4">
            <button 
          onClick={onToggleCollapse}
          className="p-1 text-[#a1a1aa] hover:text-white transition-colors"
        >
          {isCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
        )}
      </div>

      {user && (
        <div className="px-[14px] mb-4 transition-all duration-200 ease-linear relative">
          <button 
            ref={workspaceButtonRef}
            onClick={(e) => {
              e.stopPropagation();
              setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen);
            }}
            className={`relative flex items-center h-[36px] w-full rounded-xl bg-[#1b1b1b] hover:bg-[#27272a] text-white transition-all duration-200 ease-linear group/ws overflow-hidden active:scale-[0.98] ring-1 ring-inset ${isCollapsed ? 'ring-transparent' : 'ring-white/5'}`}
          >
              <div className="flex items-center justify-center w-[36px] shrink-0">
                  <div className={`w-6 h-6 shrink-0 rounded-lg ${workspaceColorClass} flex items-center justify-center text-[10px] font-bold text-white shadow-inner`}>{workspaceInitial}</div>
              </div>
              <div className={`flex items-center justify-between flex-1 pr-3 transition-opacity duration-200 ease-linear ${isCollapsed ? 'opacity-0' : 'opacity-100'}`}>
                  {!isCollapsed && (
                    <>
                      <span className="font-semibold text-[13.5px] whitespace-nowrap tracking-tight ml-1">{workspaceName}</span>
                      <ChevronDown size={14} className="text-white shrink-0 transition-colors" />
                    </>
                  )}
              </div>
          </button>
          {!isCollapsed && (
            <WorkspaceMenu 
              isOpen={isWorkspaceMenuOpen} 
              onClose={() => setIsWorkspaceMenuOpen(false)} 
              onSettingsClick={onSettingsClick}
              triggerRef={workspaceButtonRef}
            />
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pt-2">
        <div className="space-y-0.5">
          <SidebarItem 
            icon={Home} 
            label="Home" 
            isCollapsed={isCollapsed} 
            onClick={() => onViewChange('home')}
          />
          {user && (
            <SidebarItem 
              icon={Search} 
              label="Search" 
              isCollapsed={isCollapsed} 
              onClick={onSearchClick}
            />
          )}
        </div>

        {user && (
          <>
            <SectionHeader title="Projects" isCollapsed={isCollapsed} />
            <div className="space-y-0.5">
              <SidebarItem 
                icon={LayoutGrid} 
                label="All projects" 
                isCollapsed={isCollapsed} 
                onClick={() => onViewChange('projects')}
              />
              <SidebarItem 
                icon={Star} 
                label="Starred" 
                isCollapsed={isCollapsed} 
                active={currentView === 'starred'}
                onClick={() => onViewChange('starred')} 
              />
              <SidebarItem 
                icon={Users} 
                label="Shared with me" 
                isCollapsed={isCollapsed} 
                active={currentView === 'shared'}
                onClick={() => onViewChange('shared')} 
              />
            </div>

            <SectionHeader title="Resources" isCollapsed={isCollapsed} />
            <div className="space-y-0.5">
              <SidebarItem icon={Compass} label="Quota" isCollapsed={isCollapsed} />
              <SidebarItem icon={Activity} label="Workflows" isCollapsed={isCollapsed} />
              <SidebarItem 
                icon={DiscordIcon} 
                label="Discord" 
                isCollapsed={isCollapsed} 
                href="https://discord.gg/7TEtRfxGtP"
              />
            </div>
          </>
        )}
      </div>

      <div className={`flex items-center transition-all duration-200 ease-linear h-16 relative border-t border-white/5 mt-auto`}>
        {user ? (
          <div className="flex items-center justify-center w-[64px] shrink-0">
              <div className="relative group/profile">
                  <UserMenu 
                    isOpen={isUserMenuOpen} 
                    isCollapsed={isCollapsed} 
                    onClose={() => setIsUserMenuOpen(false)} 
                    onSettingsClick={onSettingsClick} 
                  />
                  
                  <div className={`absolute -inset-2 rounded-full pointer-events-none ${isUserMenuOpen ? 'opacity-0' : 'group-hover/profile:bg-white/5'}`}></div>
                  
                  {userProfile?.photoURL ? (
                    <img 
                      src={userProfile.photoURL} 
                      alt="User" 
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={handleUserMenuToggle}
                      className={`relative w-8 h-8 rounded-full border border-white/10 shrink-0 cursor-pointer transition-all active:scale-90 object-cover ${isUserMenuOpen ? 'scale-105 border-white/20' : ''}`} 
                    />
                  ) : (
                    <div 
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={handleUserMenuToggle}
                      className={`relative w-8 h-8 rounded-full border border-white/10 shrink-0 cursor-pointer transition-all active:scale-90 bg-gradient-to-br from-[#1e3a29] via-[#4a7c59] to-[#8fb896] flex items-center justify-center text-white text-[12px] font-medium ${isUserMenuOpen ? 'scale-105 border-white/20' : ''}`}
                    >
                      {userProfile?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || '?'}
                    </div>
                  )}
              </div>
          </div>
        ) : (
          <div className="flex items-center justify-center w-[64px] shrink-0">
             <button 
               onClick={() => navigate('/login')}
               className={`relative flex items-center justify-center w-8 h-8 rounded-full border border-white/10 text-white hover:bg-white/5 transition-all active:scale-90`}
               title="Sign In"
             >
               <LogIn size={18} />
             </button>
          </div>
        )}
        
        {!isCollapsed && (
          <div className="flex-1 flex items-center justify-end pr-4 transition-opacity duration-300">
             {user && (
               <button className="flex items-center justify-center w-8 h-8 text-white hover:bg-[#1f1f1f] rounded-xl transition-all active:scale-90">
                  <Inbox size={19} />
               </button>
             )}
             {!user && (
               <button 
                 onClick={() => navigate('/login')}
                 className="text-[13px] font-medium text-white/70 hover:text-white transition-colors"
               >
                 Sign In
               </button>
             )}
          </div>
        )}

        {isCollapsed && (
          <button 
            onClick={() => onToggleCollapse()}
            className="absolute inset-y-0 right-0 w-1 hover:bg-white/5 transition-colors cursor-pointer group/tab"
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 bg-[#1f1f1f] border border-white/10 p-1 rounded-l-md opacity-0 group-hover/tab:opacity-100 transition-opacity">
              <PanelLeft size={14} className="text-white" />
            </div>
          </button>
        )}
      </div>
    </aside>
  );
};
