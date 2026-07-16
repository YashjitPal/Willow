
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Home, 
  Search, 
  SquarePen,
  Glasses,
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
  LogIn,
  Terminal,
  Clapperboard,
  History,
  Clock,
  MessageSquare,
  MoreVertical,
  Share2,
  Pin,
  Pencil,
  BookOpen,
  Trash2
} from 'lucide-react';
import logo from '../src/assets/logo.png';
import './Sidebar.css';
import { useAuth } from '../context/AuthContext';
import { useLocalFS, parseTempIdTimestamp } from '../context/LocalFSContext';
import { useBackground, BackgroundType } from '../context/BackgroundContext';
import { isCodeChat, markCodeChat, renameCodeChat, unmarkCodeChat } from '../lib/codeChatStorage';
// NOTE: import from './sidebar/index' (not './sidebar'). On a case-insensitive
// filesystem (Windows/macOS) './sidebar' can resolve to THIS file (Sidebar.tsx),
// causing a circular self-import whose named exports are undefined — which crashed
// the whole app to a black screen. '/index' forces the folder to resolve.
import { DiscordIcon, MediaIcon, SidebarItem, SidebarSkeleton, SectionHeader, UserMenu } from './sidebar/index';

// ── Inline menus (used once, kept here) ──────────────────────────────────────

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

const InboxMenu: React.FC<{ isOpen: boolean; onClose: () => void; triggerRef?: React.RefObject<HTMLButtonElement>; backgroundType?: string }> = ({ isOpen, onClose, triggerRef, backgroundType }) => {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const sidebarBgClass = backgroundType === 'waves' 
    ? 'bg-[#0d0d0d]/90 backdrop-blur-xl' 
    : backgroundType === 'solid'
      ? 'bg-[#181818]'
      : 'bg-[#0d0d0d]';

  return (
    <div 
      ref={menuRef}
      style={{ 
        left: '-3px',
        boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 40px -10px rgba(0, 0, 0, 0.8), 0 1px 0 0 rgba(255, 255, 255, 0.05) inset'
      }}
      className={`absolute bottom-[38px] w-[250px] ${sidebarBgClass} py-3 z-[60] origin-bottom rounded-2xl ${isClosing ? 'menu-fade-out' : 'menu-fade-in'}`}
    >
      <div className="px-2 space-y-0.5">
        <button className="w-full flex items-center gap-3 px-3 h-[36px] text-[14px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors">
          <History size={18} strokeWidth={2} className="text-zinc-300" />
          <span>Activity</span>
        </button>
        <button className="w-full flex items-center gap-3 px-3 h-[36px] text-[14px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors">
          <Activity size={18} strokeWidth={2} className="text-zinc-300" />
          <span>Workflows</span>
        </button>
        <button className="w-full flex items-center gap-3 px-3 h-[36px] text-[14px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors">
          <Compass size={18} strokeWidth={2} className="text-zinc-300" />
          <span>Quota</span>
        </button>
        <button className="w-full flex items-center gap-3 px-3 h-[36px] text-[14px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors">
          <Clock size={18} strokeWidth={2} className="text-zinc-300" />
          <span>Scheduled actions</span>
        </button>
        
        <div className="h-[1px] bg-white/10 my-2 mx-3" />
        
        <button onClick={() => window.open('https://discord.gg/7TEtRfxGtP', '_blank')} className="w-full flex items-center gap-3 px-3 h-[36px] text-[14px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors">
          <DiscordIcon size={18} strokeWidth={1.5} className="text-zinc-300" />
          <span>Discord Community</span>
        </button>
        <button className="w-full flex items-center justify-between px-3 h-[36px] text-[14px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors group">
          <div className="flex items-center gap-3">
            <CircleHelp size={18} strokeWidth={2} className="text-zinc-300" />
            <span>Help</span>
          </div>
          <ChevronRight size={14} className="text-zinc-500 group-hover:text-white" />
        </button>
      </div>

      <div className="mt-2 pt-3 pb-1 px-5 border-t border-white/10 flex items-start gap-3">
        <div className="w-[6px] h-[6px] rounded-full bg-zinc-500 mt-1.5 shrink-0" />
        <div className="flex flex-col text-[13px] gap-0.5">
          <span className="text-blue-400 hover:underline cursor-pointer">Tokyo, Japan</span>
          <span className="text-zinc-400 text-[12px]">From your IP address</span>
          <span className="text-white hover:underline cursor-pointer mt-0.5">Update location</span>
        </div>
      </div>
    </div>
  );
};

// ── Types ────────────────────────────────────────────────────────────────────

export type ViewType = 'home' | 'projects' | 'staging' | 'starred' | 'shared';

interface SidebarProps {
  onSearchClick?: () => void;
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  dashboardMode?: 'chat' | 'develop' | 'media';
  onModeChange?: (mode: 'chat' | 'develop' | 'media') => void;
  onSettingsClick?: () => void;
  backgroundType?: 'waves' | 'lines' | 'solid';
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  hasActiveChat?: boolean;
  onNewChat?: () => void;
  isIncognito?: boolean;
  onIncognitoChat?: () => void;
  isHidden?: boolean;
}

// ── Main component ──────────────────────────────────────────────────────────

export const Sidebar: React.FC<SidebarProps> = ({ 
  onSearchClick, 
  currentView, 
  onViewChange, 
  dashboardMode,
  onModeChange,
  onSettingsClick, 
  backgroundType,
  isCollapsed,
  onToggleCollapse,
  hasActiveChat = false,
  onNewChat,
  isIncognito = false,
  onIncognitoChat,
  isHidden = false
}) => {
  const { user, userProfile } = useAuth();
  const { 
    localChats, 
    activeChatId, 
    selectLocalFSInboxChat, 
    isLocalFolderConnected,
    isLocalFolderAuthorized,
    authorizeLocalFolder,
    deleteLocalFSChat,
    renameLocalFSChat,
    loadLocalFSChat,
    getChatTimestamp,
    refreshLocalChats,
    isInitializingLocalFS
  } = useLocalFS();

  const isChatOngoing = !!activeChatId || hasActiveChat;

  useEffect(() => {
    if (isLocalFolderConnected && isLocalFolderAuthorized) {
      refreshLocalChats();
    }
  }, [isLocalFolderConnected, isLocalFolderAuthorized, refreshLocalChats]);

  const [isScrolled, setIsScrolled] = useState(false);
  const [, setCodeChatVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setCodeChatVersion((version) => version + 1);
    window.addEventListener('willow_code_chats_updated', refresh);
    return () => window.removeEventListener('willow_code_chats_updated', refresh);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(localChats.map(async (chatId) => {
      const messages = await loadLocalFSChat(chatId);
      if (!cancelled && messages?.some((message: any) => message?.willowMode === 'code')) {
        markCodeChat(chatId);
      }
    }));
    return () => { cancelled = true; };
  }, [localChats, loadLocalFSChat]);
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setIsScrolled(e.currentTarget.scrollTop > 5);
  };

  // Pinned chats persistence
  const [pinnedChats, setPinnedChats] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('willow_pinned_chats');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const togglePinChat = (chatId: string) => {
    const next = pinnedChats.includes(chatId)
      ? pinnedChats.filter((c) => c !== chatId)
      : [...pinnedChats, chatId];
    setPinnedChats(next);
    localStorage.setItem('willow_pinned_chats', JSON.stringify(next));
  };

  // Three-dot menu state
  const [menuActiveChat, setMenuActiveChat] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; isAbove: boolean } | null>(null);
  const [shouldRenderMenu, setShouldRenderMenu] = useState(false);
  const [isMenuClosing, setIsMenuClosing] = useState(false);

  // Inline renaming state
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Delete chat confirmation state
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);
  const [shouldRenderDelete, setShouldRenderDelete] = useState(false);
  const [isDeleteClosing, setIsDeleteClosing] = useState(false);

  const handleMenuClick = (e: React.MouseEvent, chat: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menuHeight = 180;
    const spaceBelow = window.innerHeight - rect.bottom;
    const isAbove = spaceBelow < menuHeight;

    setMenuPosition({
      top: isAbove ? rect.top - menuHeight - 4 : rect.bottom + 4,
      left: rect.left,
      isAbove,
    });
    setMenuActiveChat(chat);
    setShouldRenderMenu(true);
    setIsMenuClosing(false);
  };

  const triggerCloseMenu = () => {
    setIsMenuClosing(true);
    setTimeout(() => {
      setShouldRenderMenu(false);
      setIsMenuClosing(false);
      setMenuActiveChat(null);
      setMenuPosition(null);
    }, 150);
  };

  const handleRenameSave = async () => {
    // Strip filesystem-illegal characters with the same regex every disk-name
    // path uses — the chat id IS the on-disk filename (Chats/<id>.json).
    // Sanitizing HERE keeps the dup-check, pin carry-over and code-chat
    // bookkeeping below in lock-step with the id the context actually writes
    // (renameLocalFSChat sanitizes too, as the last line of defense).
    const trimmed = editValue.replace(/[\/:*?"<>|]/g, '').trim();
    if (trimmed && trimmed !== editingChatId) {
      if (localChats.includes(trimmed)) {
        alert("A chat with this name already exists.");
        setEditingChatId(null);
        return;
      }
      const success = await renameLocalFSChat(editingChatId!, trimmed);
      if (!success) {
        alert("Failed to rename chat file.");
      } else if (pinnedChats.includes(editingChatId!)) {
        // The pin list stores chat ids (= names) — carry the pin across the
        // rename or the chat silently loses it.
        const next = pinnedChats.map((c) => (c === editingChatId ? trimmed : c));
        setPinnedChats(next);
        localStorage.setItem('willow_pinned_chats', JSON.stringify(next));
      }
      if (success) renameCodeChat(editingChatId!, trimmed);
    }
    setEditingChatId(null);
  };

  const handleDeleteChat = (chat: string) => {
    setChatToDelete(chat);
    setShouldRenderDelete(true);
    setIsDeleteClosing(false);
    triggerCloseMenu(); // Close the 3-dot menu when deleting
  };

  const triggerCloseDelete = () => {
    setIsDeleteClosing(true);
    setTimeout(() => {
      setShouldRenderDelete(false);
      setIsDeleteClosing(false);
      setChatToDelete(null);
    }, 150);
  };

  const confirmDeleteChat = async () => {
    if (chatToDelete) {
      const success = await deleteLocalFSChat(chatToDelete);
      if (success) unmarkCodeChat(chatToDelete);
      if (!success) {
        alert("Failed to delete chat file.");
      }
      // Drop any pin pointing at the deleted chat so it can't linger as a
      // stale entry in the pinned list.
      if (pinnedChats.includes(chatToDelete)) {
        const next = pinnedChats.filter((c) => c !== chatToDelete);
        setPinnedChats(next);
        localStorage.setItem('willow_pinned_chats', JSON.stringify(next));
      }
      triggerCloseDelete();
    }
  };

  useEffect(() => {
    const handleClose = () => {
      if (shouldRenderMenu && !isMenuClosing) {
        triggerCloseMenu();
      }
    };
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, [shouldRenderMenu, isMenuClosing]);
  const navigate = useNavigate();
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isInboxMenuOpen, setIsInboxMenuOpen] = useState(false);
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);
  const inboxButtonRef = useRef<HTMLButtonElement>(null);

  const handleUserMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsUserMenuOpen(!isUserMenuOpen);
    setIsInboxMenuOpen(false);
    setIsWorkspaceMenuOpen(false);
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
    : backgroundType === 'solid'
      ? 'bg-[#181818]'
      : 'bg-[#0d0d0d]';

  const glowGradient = backgroundType === 'solid'
    ? 'linear-gradient(to bottom, #181818 15%, rgba(24, 24, 24, 0))'
    : backgroundType === 'waves'
      ? 'linear-gradient(to bottom, rgba(13, 13, 13, 0.9) 15%, rgba(13, 13, 13, 0))'
      : 'linear-gradient(to bottom, #0d0d0d 15%, rgba(13, 13, 13, 0))';

  return (
    <aside 
      className={`group relative h-screen ${sidebarBgClass} flex flex-col shrink-0 z-50`}
      style={{ 
        width: isHidden ? '0px' : (isCollapsed ? '64px' : '260px'),
        transform: isHidden ? 'translateX(-100%)' : 'translateX(0)',
        opacity: isHidden ? 0 : 1,
        transition: 'width 280ms cubic-bezier(0.32, 0.72, 0, 1), transform 280ms cubic-bezier(0.32, 0.72, 0, 1), opacity 280ms cubic-bezier(0.32, 0.72, 0, 1)',
        pointerEvents: isHidden ? 'none' : 'auto'
      }}
    >
      <div className="h-16 flex items-center relative min-w-[64px]">
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
              setIsUserMenuOpen(false);
              setIsInboxMenuOpen(false);
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

      {/* Fixed top-level navigation: Home & Search */}
      <div className="pt-2 space-y-0.5 shrink-0">
        <SidebarItem 
          icon={isChatOngoing ? SquarePen : Home} 
          label={isChatOngoing ? "New chat" : "Home"} 
          isCollapsed={isCollapsed} 
          active={currentView === 'home' && dashboardMode === 'chat' && !isChatOngoing}
          onClick={() => {
            if (isChatOngoing) {
              selectLocalFSInboxChat(null);
              if (onNewChat) {
                onNewChat();
              }
            }
            onViewChange('home');
            onModeChange?.('chat');
          }}
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

      {/* Scrollable lower navigation wrapper */}
      <div className="flex-1 relative min-h-0">
        <div
          onScroll={handleScroll}
          className="h-full overflow-y-auto pt-0.5 pb-4 no-scrollbar"
        >
          <div className="space-y-0.5">
            <SidebarItem 
              icon={Terminal} 
              label="Code" 
              isCollapsed={isCollapsed} 
              active={currentView === 'home' && dashboardMode === 'develop'}
              onClick={() => {
                onViewChange('home');
                onModeChange?.('develop');
              }}
            />
            <SidebarItem 
              icon={MediaIcon} 
              label="Media" 
              isCollapsed={isCollapsed} 
              active={currentView === 'home' && dashboardMode === 'media'}
              onClick={() => {
                onViewChange('home');
                onModeChange?.('media');
              }}
            />
          </div>

          {(user || isLocalFolderConnected) && (
            <>
              <SectionHeader title="Projects" isCollapsed={isCollapsed} />
              <div className="space-y-0.5">
                <SidebarItem 
                  icon={LayoutGrid} 
                  label="All projects" 
                  isCollapsed={isCollapsed} 
                  active={currentView === 'projects'}
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

              {isLocalFolderConnected && (!isLocalFolderAuthorized || localChats.length > 0) && (
                <>
                  <div className="flex items-center justify-between pr-[23px]">
                    <SectionHeader title="Chats" isCollapsed={isCollapsed} />
                  </div>
                  <div className="space-y-0.5">
                    {localChats.length === 0 ? null : (
                      (() => {
                        // Read the timestamp map ONCE per render — calling
                        // getChatTimestamp inside the comparator re-parsed the
                        // whole localStorage JSON O(n log n) times per render.
                        let tsMap: Record<string, number> = {};
                        try {
                          const rawTs = localStorage.getItem('willow_chat_timestamps');
                          if (rawTs) tsMap = JSON.parse(rawTs) || {};
                        } catch {}
                        // `localChats` arrives from context already sorted
                        // newest→oldest with a deterministic tiebreaker
                        // (sortChatsNewestToOldest). For chats with no stored
                        // timestamp yet (first paint before the disk reconcile
                        // backfills lastModified), fall back to the array's own
                        // order instead of re-guessing — this keeps first paint
                        // and post-reconcile renders from reshuffling.
                        const indexOf = new Map(localChats.map((c, i) => [c, i]));
                        const chatTs = (id: string) => tsMap[id] || parseTempIdTimestamp(id);
                        const sortedChats = [...localChats].sort((a, b) => {
                          const aPinned = pinnedChats.includes(a);
                          const bPinned = pinnedChats.includes(b);
                          if (aPinned && !bPinned) return -1;
                          if (!aPinned && bPinned) return 1;

                          const tA = chatTs(a);
                          const tB = chatTs(b);
                          if (tA && tB && tB !== tA) {
                            return tB - tA;
                          }
                          if (!!tA !== !!tB) return tA ? -1 : 1; // known-time chats above unknown
                          // Equal or both-unknown timestamps → keep the
                          // context's persisted order (already newest-first).
                          return (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0);
                        });
                        return sortedChats.map((chat) => {
                          const isTemp = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_[a-z0-9]{6}$/i.test(chat);
                          if (isTemp) {
                            if (activeChatId === chat) {
                              return <SidebarSkeleton key={chat} isCollapsed={isCollapsed} />;
                            }
                            return null;
                          }

                          return (
                            <SidebarItem 
                              key={chat}
                              label={chat} 
                              customLabel={
                                editingChatId === chat ? (
                                  <input
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={handleRenameSave}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleRenameSave();
                                      if (e.key === 'Escape') setEditingChatId(null);
                                    }}
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full bg-transparent border-b border-white/20 text-white font-medium text-[13.5px] outline-none px-1 py-0.5 min-w-0"
                                  />
                                ) : (
                                  <div className="flex items-center gap-1.5 min-w-0 w-full">
                                     <span className="truncate flex-1">{chat}</span>
                                     {isCodeChat(chat) && (
                                       <span
                                         title="Started in Code mode"
                                         className="shrink-0 text-[9px] font-semibold leading-none text-zinc-400 border border-white/10 px-1 py-0.5 rounded"
                                       >
                                         Code
                                       </span>
                                     )}
                                    {pinnedChats.includes(chat) && (
                                      <Pin size={10} className="text-amber-400 shrink-0 transform rotate-45" />
                                    )}
                                  </div>
                                )
                              }
                              isCollapsed={isCollapsed} 
                              active={currentView === 'home' && dashboardMode === 'chat' && activeChatId === chat}
                              onClick={() => {
                                onViewChange('home');
                                onModeChange?.('chat');
                                selectLocalFSInboxChat(chat);
                              }}
                              keepActionsVisible={menuActiveChat === chat}
                              actions={
                                <button
                                  onClick={(e) => handleMenuClick(e, chat)}
                                  className={`p-1 hover:bg-white/10 rounded-md text-zinc-400 hover:text-white transition-colors shrink-0 ${
                                    menuActiveChat === chat ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'
                                  }`}
                                >
                                  <MoreVertical size={14} />
                                </button>
                              }
                            />
                          );
                        });
                      })()
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Fancy top glow overlay matching sidebar background under Search tab */}
        <div 
          className="absolute top-0 left-0 right-0 pointer-events-none z-10 transition-opacity duration-200"
          style={{
            background: glowGradient,
            height: '12px', // Reduced height intensity for an extremely subtle, clean look
            opacity: isScrolled ? 1 : 0
          }}
        />
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
                    backgroundType={backgroundType}
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
               <div className="relative">
                 <button 
                   ref={inboxButtonRef}
                   onClick={() => {
                     setIsInboxMenuOpen(!isInboxMenuOpen);
                     setIsUserMenuOpen(false);
                     setIsWorkspaceMenuOpen(false);
                   }}
                   className="flex items-center justify-center w-8 h-8 text-white hover:bg-[#1f1f1f] rounded-xl transition-all active:scale-90"
                 >
                    <Inbox size={19} />
                 </button>
                 <InboxMenu 
                   isOpen={isInboxMenuOpen}
                   onClose={() => setIsInboxMenuOpen(false)}
                   triggerRef={inboxButtonRef}
                   backgroundType={backgroundType}
                 />
               </div>
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

      {shouldRenderMenu && menuActiveChat && menuPosition && (
        <div 
          className={`fixed z-[9999] w-[185px] ${sidebarBgClass} py-2 ${
            menuPosition.isAbove ? 'origin-bottom' : 'origin-top'
          } rounded-2xl border border-white/5 ${
            isMenuClosing ? 'menu-fade-out' : 'menu-fade-in'
          }`}
          style={{ 
            top: `${menuPosition.top}px`, 
            left: `${menuPosition.left}px`,
            boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 40px -10px rgba(0, 0, 0, 0.8), 0 1px 0 0 rgba(255, 255, 255, 0.05) inset'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-1.5 space-y-0.5">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                triggerCloseMenu();
                alert("Sharing conversation link: " + window.location.origin + "/chat/" + menuActiveChat);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 h-[30px] text-[13px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors"
            >
              <Share2 size={15} strokeWidth={2} className="text-zinc-300" />
              <span>Share conversation</span>
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                togglePinChat(menuActiveChat);
                triggerCloseMenu();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 h-[30px] text-[13px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors"
            >
              <Pin size={15} strokeWidth={2} className={pinnedChats.includes(menuActiveChat) ? "text-amber-400 fill-amber-400" : "text-zinc-300"} />
              <span>{pinnedChats.includes(menuActiveChat) ? 'Unpin' : 'Pin'}</span>
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setEditingChatId(menuActiveChat);
                setEditValue(menuActiveChat);
                triggerCloseMenu();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 h-[30px] text-[13px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors"
            >
              <Pencil size={15} strokeWidth={2} className="text-zinc-300" />
              <span>Rename</span>
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                triggerCloseMenu();
                alert(`Added "${menuActiveChat}" to Notebook.`);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 h-[30px] text-[13px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors"
            >
              <BookOpen size={15} strokeWidth={2} className="text-zinc-300" />
              <span>Add to notebook</span>
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                const chatToDelete = menuActiveChat;
                triggerCloseMenu();
                handleDeleteChat(chatToDelete);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 h-[30px] text-[13px] font-medium tracking-tight text-white hover:bg-white/5 rounded-xl transition-colors"
            >
              <Trash2 size={15} strokeWidth={2} className="text-zinc-300" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* Delete Chat Confirmation Dialog */}
      {shouldRenderDelete && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center px-4">
          {/* Backdrop */}
          <div 
            className={`absolute inset-0 bg-black/60 ${isDeleteClosing ? 'backdrop-fade-out' : 'backdrop-fade-in'}`} 
            onClick={(e) => {
              e.stopPropagation();
              triggerCloseDelete();
            }}
          />
          
          <div className={`relative bg-[#1e1f20] rounded-[28px] p-6 max-w-[500px] w-full shadow-2xl ${isDeleteClosing ? 'modal-scale-out' : 'modal-scale-in'}`}>
            <h2 className="text-[22px] font-medium text-[#e3e3e3] mb-4">Delete chat?</h2>
            
            <p className="text-[15px] text-[#c4c7c5] leading-relaxed mb-8">
              This will permanently delete this conversation and its history. This action cannot be undone.
            </p>
            
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  triggerCloseDelete();
                }}
                className="px-5 py-2.5 text-[14px] font-medium text-[#e3e3e3] hover:bg-white/5 rounded-full transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  confirmDeleteChat();
                }}
                className="px-5 py-2.5 text-[14px] font-medium text-[#e3e3e3] hover:bg-white/5 rounded-full transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
