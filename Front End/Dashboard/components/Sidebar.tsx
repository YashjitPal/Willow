
import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { useNavigate } from 'react-router-dom';
import { 
  Home, 
  Search, 
  SquarePen,
  LayoutGrid, 
  Star, 
  Users, 
  PanelLeft,
  ArrowUpRight,
  LogIn,
  Terminal,
  MoreVertical,
  Share2,
  Pin,
  Pencil,
  BookOpen,
  Trash2,
} from 'lucide-react';
import logo from '../src/assets/logo.png';
import './Sidebar.css';
import { useAuth } from '../context/AuthContext';
import { useLocalFS, isTempChatId } from '../context/LocalFSContext';
import { useBackground, BackgroundType } from '../context/BackgroundContext';
import { isCodeChat, markCodeChat, migrateVerifiedLegacyCodeChat, renameCodeChat, unmarkCodeChat } from '../lib/codeChatStorage';
import {
  DASHBOARD_SIDEBAR_COLLAPSED_WIDTH,
  DASHBOARD_SIDEBAR_EXPANDED_WIDTH,
} from '../lib/dashboard-layout';
import {
  goToAllSparkTasks,
  goToSparkApps,
  goToSparkHome,
  goToSparkSchedules,
  goToSparkSkills,
  sparkLocation,
} from '../lib/stores/spark-store';
import type { DashboardExperience } from '../types';
// NOTE: import from './sidebar/index' (not './sidebar'). On a case-insensitive
// filesystem (Windows/macOS) './sidebar' can resolve to THIS file (Sidebar.tsx),
// causing a circular self-import whose named exports are undefined — which crashed
// the whole app to a black screen. '/index' forces the folder to resolve.
import { MediaIcon, SidebarItem, SidebarSkeleton, SectionHeader, UserMenu } from './sidebar/index';
import { AgentIcon } from './ui/AgentIcon';
import { MaterialSymbol } from './ui/MaterialSymbol';

// ── Inline menus (used once, kept here) ──────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

type GeminiSettingsMenuProps = {
  isOpen: boolean;
  isCollapsed: boolean;
  onClose: () => void;
  onSettingsClick?: () => void;
};

type GeminiSettingsItem = {
  id: string;
  label: string;
  icon: string;
  iconFamily?: 'luminous' | 'google-symbols' | 'avatar' | 'spark-settings';
  trailingArrow?: boolean;
  action?: 'settings';
};

const GEMINI_SETTINGS_ITEMS: GeminiSettingsItem[] = [
  { id: 'activity', label: 'Activity', icon: 'history', iconFamily: 'luminous', action: 'settings' },
  { id: 'intelligence', label: 'Personal Intelligence', icon: 'personal_recommendations', iconFamily: 'luminous', action: 'settings' },
  { id: 'memory', label: 'Import memory to Willow', icon: 'upload_file', iconFamily: 'google-symbols', action: 'settings' },
  { id: 'avatar', label: 'Avatar', icon: 'likeness_lumi_icon', iconFamily: 'avatar', action: 'settings' },
  { id: 'limits', label: 'Usage limits', icon: 'donut_large', iconFamily: 'google-symbols', action: 'settings' },
  { id: 'scheduled', label: 'Scheduled actions', icon: 'schedule', iconFamily: 'luminous', action: 'settings' },
  { id: 'skills', label: 'Skills', icon: 'contract', iconFamily: 'luminous', action: 'settings' },
  { id: 'gems', label: 'Gems', icon: 'gems', iconFamily: 'luminous', action: 'settings' },
  { id: 'links', label: 'Your public links', icon: 'link', iconFamily: 'google-symbols', action: 'settings' },
  { id: 'theme', label: 'Theme', icon: 'routine', iconFamily: 'google-symbols', trailingArrow: true },
  { id: 'spark-settings', label: 'Willow Spark settings', icon: 'agent_mode_spark', iconFamily: 'spark-settings', action: 'settings' },
  { id: 'subscription', label: 'Manage subscription', icon: 'counter_1', iconFamily: 'google-symbols', action: 'settings' },
  { id: 'upgrade', label: 'Upgrade to Willow Ultra', icon: 'spark', iconFamily: 'luminous', action: 'settings' },
  { id: 'notebook', label: 'Willow Notebook', icon: 'notebook_lm', iconFamily: 'luminous', action: 'settings' },
  { id: 'feedback', label: 'Send feedback', icon: 'chat_info', iconFamily: 'google-symbols' },
  { id: 'help', label: 'Help', icon: 'quiz', iconFamily: 'luminous', trailingArrow: true },
];

const GeminiAvatarSettingsIcon: React.FC = () => (
  <svg aria-hidden="true" className="h-6 w-6 shrink-0" viewBox="0 0 28 28" fill="none">
    <path d="M14,24.5C8.201,24.5 3.5,19.799 3.5,14C3.5,8.201 8.201,3.5 14,3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M17.281,11.666m-1,0a1,1 0,1 1,2 0a1,1 0,1 1,-2 0" fill="currentColor" />
    <path d="M19.25,4.907m-1,0a1,1 0,1 1,2 0a1,1 0,1 1,-2 0" fill="currentColor" />
    <path d="M23.093,8.751m-1,0a1,1 0,1 1,2 0a1,1 0,1 1,-2 0" fill="currentColor" />
    <path d="M24.499,14m-1,0a1,1 0,1 1,2 0a1,1 0,1 1,-2 0" fill="currentColor" />
    <path d="M23.092,19.249m-1,0a1,1 0,1 1,2 0a1,1 0,1 1,-2 0" fill="currentColor" />
    <path d="M19.249,23.091m-1,0a1,1 0,1 1,2 0a1,1 0,1 1,-2 0" fill="currentColor" />
    <path d="M10.719,11.666m-1,0a1,1 0,1 1,2 0a1,1 0,1 1,-2 0" fill="currentColor" />
    <path d="M17.5,16.916C15.469,18.472 12.531,18.472 10.5,16.916" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const GeminiSparkSettingsIcon: React.FC = () => (
  <svg aria-hidden="true" className="h-6 w-6 shrink-0" viewBox="0 0 20 20" fill="none">
    <path d="M2.5 13.3337L4.16667 11.667" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M6.66602 17.4997L8.33268 15.833" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M2.5 17.5L7.5 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M16.2365 7.71553C15.3377 7.32841 14.5515 6.79811 13.8767 6.12396C13.2025 5.44981 12.6716 4.66297 12.2851 3.76411C12.1366 3.41941 12.0173 3.06544 11.9258 2.70218C11.896 2.58352 11.79 2.5 11.6673 2.5C11.5447 2.5 11.4386 2.58352 11.4088 2.70218C11.3173 3.06544 11.198 3.41875 11.0495 3.76411C10.6624 4.66297 10.1321 5.44981 9.45794 6.12396C8.7838 6.79744 7.99696 7.32841 7.09809 7.71553C6.7534 7.86402 6.39942 7.98333 6.03616 8.07481C5.91751 8.10464 5.83398 8.2107 5.83398 8.33333C5.83398 8.45597 5.91751 8.56203 6.03616 8.59186C6.39942 8.68333 6.75273 8.80265 7.09809 8.95114C7.99696 9.33826 8.78313 9.86856 9.45794 10.5427C10.1321 11.2169 10.6631 12.0037 11.0495 12.9026C11.198 13.2473 11.3173 13.6012 11.4088 13.9645C11.4386 14.0831 11.5453 14.1667 11.6673 14.1667C11.79 14.1667 11.896 14.0831 11.9258 13.9645C12.0173 13.6012 12.1366 13.2479 12.2851 12.9026C12.6722 12.0037 13.2025 11.2175 13.8767 10.5427C14.5508 9.86856 15.3377 9.3376 16.2365 8.95114C16.5812 8.80265 16.9352 8.68333 17.2985 8.59186C17.4171 8.56203 17.5007 8.4553 17.5007 8.33333C17.5007 8.2107 17.4171 8.10464 17.2985 8.07481C16.9352 7.98333 16.5819 7.86402 16.2365 7.71553Z" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const GeminiSettingsItemIcon: React.FC<{ item: GeminiSettingsItem }> = ({ item }) => {
  if (item.iconFamily === 'avatar') return <GeminiAvatarSettingsIcon />;
  if (item.iconFamily === 'spark-settings') return <GeminiSparkSettingsIcon />;

  return (
    <MaterialSymbol
      name={item.icon}
      family={item.iconFamily ?? 'luminous'}
      size={24}
      weight={300}
      roundness={100}
      opticalSize={24}
    />
  );
};

const GeminiSubmenuArrow: React.FC = () => (
  <svg aria-hidden="true" className="h-[10px] w-[5px] shrink-0 fill-current" viewBox="0 0 5 10">
    <polygon points="0,0 5,5 0,10" />
  </svg>
);

const GEMINI_SIDEBAR_POSITION_MOTION = '300ms cubic-bezier(0.2, 0, 0, 1)';
const GEMINI_SIDEBAR_SURFACE_MOTION = '300ms cubic-bezier(0.2, 0, 0, 1)';

const SidebarGlyph: React.FC<{ name: string; className?: string }> = ({ name, className = '' }) => (
  <span
    aria-hidden="true"
    className={`luminous-symbols inline-flex shrink-0 items-center justify-center ${className}`}
    style={{
      fontFamily: "'Luminous Symbols', sans-serif",
      fontWeight: 330,
      fontVariationSettings: '"FILL" 0, "wght" 330, "GRAD" 0, "opsz" 20, "ROND" 100',
    }}
  >
    {name}
  </span>
);

const GeminiSettingsMenu: React.FC<GeminiSettingsMenuProps> = ({ isOpen, isCollapsed, onClose, onSettingsClick }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleItemClick = (item: GeminiSettingsItem) => {
    if (item.action === 'settings') {
      onClose();
      onSettingsClick?.();
    }
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Settings"
      className="absolute z-[100] w-[300px] max-h-[calc(100vh-16px)] overflow-y-auto rounded-[20px] bg-[#1f1f1f] p-2 text-[#e3e3e3] shadow-[0_0_20px_rgba(0,0,0,0.28)]"
      style={{
        left: isCollapsed ? '52px' : 'calc(100% - 44px)',
        bottom: isCollapsed ? '94px' : '50px',
      }}
    >
      {GEMINI_SETTINGS_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          aria-label={item.label}
          onClick={() => handleItemClick(item)}
          className="group/settings-item flex h-9 w-full items-center overflow-hidden rounded-xl px-2 text-left font-['Google_Sans_Flex','Google_Sans_Text','Google_Sans',sans-serif] text-[14px] font-medium text-[#e3e3e3] transition-colors hover:bg-white/[0.08]"
        >
          <GeminiSettingsItemIcon item={item} />
          <span className="ml-2 min-w-0 flex-1 truncate">{item.label}</span>
          {item.trailingArrow && <GeminiSubmenuArrow />}
        </button>
      ))}
      <div role="menuitem" className="h-[50px] overflow-hidden rounded-xl px-2 pt-3 text-[14px]">
        <div className="flex items-start gap-2">
          <MaterialSymbol
            name="circle"
            family="google-symbols"
            size={24}
            weight={300}
            fill
            roundness={100}
            opticalSize={24}
            className="mt-0.5 text-[#a8c7fa]"
          />
          <div className="min-w-0 leading-[17px]">
            <div className="truncate text-[#a8c7fa]">Kolkata, West Bengal, India</div>
            <div className="truncate text-[#e3e3e3]">Based on your places (Home)</div>
          </div>
        </div>
      </div>
      <button
        type="button"
        role="menuitem"
        aria-label="Update location"
        className="flex h-9 w-full items-end overflow-hidden rounded-xl px-2 pb-2 text-left text-[14px] text-[#a8c7fa] hover:bg-white/[0.08]"
      >
        <span className="ml-8">Update location</span>
      </button>
    </div>
  );
};

export type ViewType = 'home' | 'agents' | 'projects' | 'staging' | 'starred' | 'shared';

const SparkSidebarItem: React.FC<{
  label: string;
  symbol: string;
  isCollapsed: boolean;
  active?: boolean;
  onClick?: () => void;
}> = ({ label, symbol, isCollapsed, active = false, onClick }) => (
  <div className="px-1.5">
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      title={isCollapsed ? label : undefined}
      className={`group/spark-item relative flex h-8 w-full items-center gap-2 rounded-full px-2 text-[#e6e6e6] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-white/25 ${
        active ? 'bg-transparent' : 'hover:bg-[#272729]'
      }`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
        <MaterialSymbol
          family="luminous"
          name={symbol}
          size={20}
          opticalSize={20}
          className="transition-transform duration-200 group-active/spark-item:scale-90"
        />
      </span>
      {!isCollapsed && (
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left text-[13px] font-normal leading-[17px]">
          {label}
        </span>
      )}
      {isCollapsed && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-[46px] z-[100] ml-2 whitespace-nowrap rounded-lg border border-white/5 bg-[#18181b] px-3 py-1.5 text-[12px] font-medium text-white opacity-0 shadow-2xl transition-opacity duration-150 group-hover/spark-item:opacity-100 group-focus-visible/spark-item:opacity-100"
        >
          {label}
        </span>
      )}
    </button>
  </div>
);

interface SidebarProps {
  onSearchClick?: () => void;
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  dashboardMode?: 'chat' | 'develop' | 'media';
  onModeChange?: (mode: 'chat' | 'develop' | 'media') => void;
  dashboardExperience: DashboardExperience;
  onDashboardExperienceChange: (experience: DashboardExperience) => void;
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
  dashboardExperience,
  onDashboardExperienceChange,
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
  const navigate = useNavigate();
  const { user, userProfile } = useAuth();
  const currentSparkLocation = useStore(sparkLocation);
  const {
    chatScopeId,
    localChats, 
    activeChatId, 
    selectLocalFSInboxChat, 
    isLocalFolderConnected,
    isLocalFolderAuthorized,
    authorizeLocalFolder,
    deleteLocalFSChat,
    renameLocalFSChat,
    loadLocalFSChat,
    isInitializingLocalFS
  } = useLocalFS();

  const isChatOngoing = dashboardExperience === 'chat' && (!!activeChatId || hasActiveChat);

  const [isScrolled, setIsScrolled] = useState(false);
  const [, setCodeChatVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setCodeChatVersion((version) => version + 1);
    window.addEventListener('willow_code_chats_updated', refresh);
    return () => window.removeEventListener('willow_code_chats_updated', refresh);
  }, []);
  const codeChatScannedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    codeChatScannedRef.current.clear();
  }, [chatScopeId]);
  useEffect(() => {
    if (isInitializingLocalFS) return;
    let cancelled = false;
    let timer: number | undefined;
    const pending = localChats.filter((chatId) => !isCodeChat(chatScopeId, chatId) && !codeChatScannedRef.current.has(chatId));
    const scanNext = async () => {
      // Legacy marker migration is intentionally lazy and bounded: never load
      // every full chat body concurrently just to paint the sidebar.
      for (const chatId of pending.splice(0, 2)) {
        codeChatScannedRef.current.add(chatId);
        const messages = await loadLocalFSChat(chatId);
        if (cancelled) return;
        if (messages?.some((message: any) => message?.willowMode === 'code')) {
          // Old marker keys had no owner. The body check is the ownership
          // proof that makes adopting a matching legacy marker safe.
          if (!migrateVerifiedLegacyCodeChat(chatScopeId, chatId)) markCodeChat(chatScopeId, chatId);
        }
      }
      if (!cancelled && pending.length > 0) timer = window.setTimeout(() => { void scanNext(); }, 100);
    };
    timer = window.setTimeout(() => { void scanNext(); }, 250);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [localChats, loadLocalFSChat, isInitializingLocalFS, chatScopeId]);
  const [isAtScrollEnd, setIsAtScrollEnd] = useState(true);
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setIsScrolled(target.scrollTop > 5);
    setIsAtScrollEnd(target.scrollTop + target.clientHeight >= target.scrollHeight - 4);
  };

  // Pinned chats persistence
  const pinnedChatsKey = `willow_pinned_chats:v2:${encodeURIComponent(chatScopeId)}`;
  const [pinnedChatState, setPinnedChatState] = useState<{ scopeId: string; chats: string[] }>(() => ({
    scopeId: chatScopeId,
    chats: [],
  }));
  // Never render the previous scope's pins during the effect-sized window
  // between a user/root/workspace switch and loading the new scoped key.
  const pinnedChats = pinnedChatState.scopeId === chatScopeId ? pinnedChatState.chats : [];
  useEffect(() => {
    try {
      const stored = localStorage.getItem(pinnedChatsKey);
      const parsed = stored ? JSON.parse(stored) : [];
      setPinnedChatState({
        scopeId: chatScopeId,
        chats: Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [],
      });
    } catch {
      setPinnedChatState({ scopeId: chatScopeId, chats: [] });
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== pinnedChatsKey) return;
      try {
        const parsed = event.newValue ? JSON.parse(event.newValue) : [];
        setPinnedChatState({
          scopeId: chatScopeId,
          chats: Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [],
        });
      } catch {
        setPinnedChatState({ scopeId: chatScopeId, chats: [] });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [pinnedChatsKey]);

  const togglePinChat = (chatId: string) => {
    const next = pinnedChats.includes(chatId)
      ? pinnedChats.filter((c) => c !== chatId)
      : [...pinnedChats, chatId];
    setPinnedChatState({ scopeId: chatScopeId, chats: next });
    localStorage.setItem(pinnedChatsKey, JSON.stringify(next));
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
        setPinnedChatState({ scopeId: chatScopeId, chats: next });
        localStorage.setItem(pinnedChatsKey, JSON.stringify(next));
      }
      if (success) renameCodeChat(chatScopeId, editingChatId!, trimmed);
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
      if (success) unmarkCodeChat(chatScopeId, chatToDelete);
      if (!success) {
        alert("Failed to delete chat file.");
      }
      // Drop any pin pointing at the deleted chat so it can't linger as a
      // stale entry in the pinned list.
      if (pinnedChats.includes(chatToDelete)) {
        const next = pinnedChats.filter((c) => c !== chatToDelete);
        setPinnedChatState({ scopeId: chatScopeId, chats: next });
        localStorage.setItem(pinnedChatsKey, JSON.stringify(next));
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
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [recentsExpanded, setRecentsExpanded] = useState(true);

  const handleUserMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsUserMenuOpen(!isUserMenuOpen);
    setIsSettingsMenuOpen(false);
  };

  useEffect(() => {
    setIsSettingsMenuOpen(false);
  }, [isCollapsed]);

  // Dynamic logo color filter based on workspace color
  const getLogoFilter = (color: string | null | undefined) => {
    switch (color) {
      case 'pink': return 'hue-rotate(220deg)';
      case 'yellow': return 'hue-rotate(-64deg)';
      case 'orange': return 'hue-rotate(-84deg)';
      case 'green':
      default: return 'hue-rotate(30deg)';
    }
  };


  // Dynamically update favicon in the browser tab
  useEffect(() => {
    const updateFaviconColor = () => {
      const color = userProfile?.workspaceColor;
      const img = new Image();
      img.src = '/favicon-32x32.png';
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let filterStr = 'hue-rotate(30deg)';
        if (color === 'pink') filterStr = 'hue-rotate(220deg)';
        else if (color === 'yellow') filterStr = 'hue-rotate(-64deg)';
        else if (color === 'orange') filterStr = 'hue-rotate(-84deg)';

        ctx.filter = filterStr;
        ctx.drawImage(img, 0, 0, 32, 32);

        const dataURL = canvas.toDataURL('image/png');
        const links = document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]');
        links.forEach((link: any) => {
          link.href = dataURL;
        });
      };
    };

    updateFaviconColor();
  }, [userProfile?.workspaceColor]);

  // Gemini fades the expanded rail surface into the dashboard surface as it collapses.
  const expandedSidebarBgClass = backgroundType === 'waves'
    ? 'bg-[#1f1f1f]/90 backdrop-blur-xl'
    : 'bg-[#1f1f1f]';
  const sidebarBgClass = isCollapsed
    ? 'bg-[var(--dashboard-surface)]'
    : expandedSidebarBgClass;

  const expandedGlowGradient = backgroundType === 'waves'
    ? 'linear-gradient(to bottom, rgba(31, 31, 31, 0.9) 15%, rgba(31, 31, 31, 0))'
    : 'linear-gradient(to bottom, #1f1f1f 15%, rgba(31, 31, 31, 0))';
  const collapsedGlowGradient = 'linear-gradient(to bottom, var(--dashboard-surface) 15%, transparent)';

  return (
    <aside
      className={`dashboard-sidebar ${isCollapsed ? 'dashboard-sidebar--collapsed' : 'dashboard-sidebar--expanded'} group relative h-screen ${sidebarBgClass} flex flex-col shrink-0 z-50 font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]`}
      style={{
        width: isHidden ? '0px' : `${isCollapsed ? DASHBOARD_SIDEBAR_COLLAPSED_WIDTH : DASHBOARD_SIDEBAR_EXPANDED_WIDTH}px`,
        minWidth: isHidden ? '0px' : `${isCollapsed ? DASHBOARD_SIDEBAR_COLLAPSED_WIDTH : DASHBOARD_SIDEBAR_EXPANDED_WIDTH}px`,
        transform: isHidden ? 'translateX(-100%)' : 'translateX(0)',
        opacity: isHidden ? 0 : 1,
        transition: `width ${GEMINI_SIDEBAR_POSITION_MOTION}, transform ${GEMINI_SIDEBAR_POSITION_MOTION}, opacity ${GEMINI_SIDEBAR_POSITION_MOTION}, background-color ${GEMINI_SIDEBAR_SURFACE_MOTION}`,
        willChange: 'width, background-color',
        pointerEvents: isHidden ? 'none' : 'auto'
      }}
    >
      <div className="h-[52px] flex items-center relative min-w-[52px] shrink-0">
        <div className="w-[52px] flex items-center justify-center shrink-0">
          <button
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="w-9 h-9 flex items-center justify-center rounded-full transition-all duration-200 active:scale-95 cursor-pointer relative group/logo"
          >
            <div className={`transition-all duration-200 flex items-center justify-center
              ${isCollapsed ? 'group-hover:opacity-0 group-hover:scale-75' : 'opacity-100 scale-100'}`}>
              <img
                src={logo}
                alt="Logo"
                className="h-7 w-auto object-contain shrink-0 transition-all duration-300"
                style={{ filter: getLogoFilter(userProfile?.workspaceColor) }}
              />
            </div>
            {isCollapsed && (
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 transform scale-90 group-hover:scale-110 pointer-events-none">
                <span
                  className="luminous-symbols text-[24px] leading-none select-none text-[#e3e3e3]"
                  style={{
                    fontFamily: "'Luminous Symbols', 'Google Symbols', 'Material Symbols Rounded', sans-serif",
                    fontWeight: 300,
                    fontVariationSettings: '"FILL" 0, "wght" 300, "GRAD" 0, "opsz" 24, "ROND" 100'
                  }}
                >
                  side_nav_expand
                </span>
              </div>
            )}
          </button>
        </div>
        
        {!isCollapsed && (
          <div className="absolute right-[14px] top-1.5">
            <button
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="flex h-10 w-10 items-center justify-center rounded-full text-[#e3e3e3] hover:bg-white/[0.08] transition-colors"
            >
              <span
                className="luminous-symbols text-[24px] leading-none select-none text-[#e3e3e3]"
                style={{
                  fontFamily: "'Luminous Symbols', 'Google Symbols', 'Material Symbols Rounded', sans-serif",
                  fontWeight: 300,
                  fontVariationSettings: '"FILL" 0, "wght" 300, "GRAD" 0, "opsz" 24, "ROND" 100'
                }}
              >
                side_nav
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Gemini-style mode control: keep both presentations mounted so the control follows the rail as it animates. */}
      <div className="relative mt-1 mb-2 h-8 w-full shrink-0 overflow-hidden">
        <div
          aria-hidden={isCollapsed}
          className={`absolute inset-x-1.5 top-0 flex h-8 items-center transition-opacity duration-150 ease-[cubic-bezier(0,0,0,0)] ${isCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
        >
          <div className="bg-[#171717] p-[3px] rounded-full flex items-center w-full shadow-inner">
            <button
              type="button"
              onClick={() => onDashboardExperienceChange('chat')}
              aria-pressed={dashboardExperience === 'chat'}
              tabIndex={isCollapsed ? -1 : 0}
              className={`flex-1 py-1 rounded-full text-[13px] leading-[17px] font-normal transition-all duration-200 text-center select-none cursor-pointer ${
                dashboardExperience === 'chat'
                  ? 'bg-[#1f1f1f] text-white shadow-sm'
                  : 'text-[#a1a1aa] hover:text-white'
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => {
                goToSparkHome();
                onDashboardExperienceChange('spark');
              }}
              aria-pressed={dashboardExperience === 'spark'}
              tabIndex={isCollapsed ? -1 : 0}
              className={`flex-1 py-1 rounded-full text-[13px] leading-[17px] font-normal transition-all duration-200 text-center flex items-center justify-center gap-1 select-none cursor-pointer ${
                dashboardExperience === 'spark'
                  ? 'bg-[#1f1f1f] text-white shadow-sm'
                  : 'text-[#a1a1aa] hover:text-white'
              }`}
            >
              <span>Spark</span>
              <span className="text-[9px] font-semibold tracking-wider text-[#71717a] uppercase ml-0.5">BETA</span>
            </button>
          </div>
        </div>
        <div
          aria-hidden={!isCollapsed}
          className={`absolute top-0 flex h-8 items-center transition-opacity duration-100 ease-[cubic-bezier(0,0,0,0)] ${
            isCollapsed
              ? 'left-1.5 right-auto w-10 opacity-100'
              : 'inset-x-1.5 pointer-events-none opacity-0'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              if (dashboardExperience === 'chat') {
                goToSparkHome();
                onDashboardExperienceChange('spark');
              } else {
                onDashboardExperienceChange('chat');
              }
            }}
            aria-label={dashboardExperience === 'chat' ? 'Switch to Spark' : 'Switch to Chat'}
            aria-pressed={dashboardExperience === 'spark'}
            title={dashboardExperience === 'chat' ? 'Switch to Spark' : 'Switch to Chat'}
            tabIndex={isCollapsed ? 0 : -1}
            className="mx-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-1 text-[#e6e6e6] transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
          >
            <span
              className="luminous-symbols inline-flex h-5 w-5 items-center justify-center overflow-hidden text-[20px] leading-5 select-none"
              style={{
                fontFamily: "'Luminous Symbols', 'Google Symbols', 'Material Symbols Rounded', sans-serif",
                fontWeight: 320,
                fontVariationSettings: '"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320',
              }}
            >
              {dashboardExperience === 'chat' ? 'toggle_off' : 'toggle_on'}
            </span>
          </button>
        </div>
      </div>

      {dashboardExperience === 'spark' ? (
        <div className={`min-h-0 flex-1 pb-4 ${isCollapsed ? 'pt-2' : 'pt-[9px]'}`}>
          <SparkSidebarItem
            label="Tasks"
            symbol="edit_rectangle"
            isCollapsed={isCollapsed}
            active={
              currentSparkLocation.page === 'home'
              || currentSparkLocation.page === 'all-tasks'
              || currentSparkLocation.page === 'task'
            }
            onClick={() => {
              onDashboardExperienceChange('spark');
              onViewChange('home');
              goToAllSparkTasks();
            }}
          />

          {!isCollapsed && (
            <div className="mx-3 mt-3 flex h-8 items-center px-1.5 text-[13px] font-normal leading-[17px] text-white/55">
              Customise
            </div>
          )}

          <SparkSidebarItem
            label="Schedules"
            symbol="schedule"
            isCollapsed={isCollapsed}
            active={currentSparkLocation.page === 'schedules'}
            onClick={() => {
              onDashboardExperienceChange('spark');
              onViewChange('home');
              goToSparkSchedules();
            }}
          />
          <SparkSidebarItem
            label="Skills"
            symbol="contract"
            isCollapsed={isCollapsed}
            active={currentSparkLocation.page === 'skills'}
            onClick={() => {
              onDashboardExperienceChange('spark');
              onViewChange('home');
              goToSparkSkills();
            }}
          />
          <SparkSidebarItem
            label="Connected apps"
            symbol="extension"
            isCollapsed={isCollapsed}
            active={currentSparkLocation.page === 'apps'}
            onClick={() => {
              onDashboardExperienceChange('spark');
              onViewChange('home');
              goToSparkApps();
            }}
          />
        </div>
      ) : (
        <>
      {/* Fixed top-level navigation: Home & Search */}
      <div className="pt-2 space-y-0 shrink-0">
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
          className="h-full overflow-y-auto pt-0 pb-4 no-scrollbar"
        >
          <div className="space-y-0">
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
            <SidebarItem
              icon={AgentIcon}
              label="Agents"
              isCollapsed={isCollapsed}
              active={currentView === 'agents'}
              onClick={() => onViewChange('agents')}
            />
          </div>

          {(user || isLocalFolderConnected) && (
            <>
              <SectionHeader
                title="Projects"
                isCollapsed={isCollapsed}
                isExpanded={projectsExpanded}
                onToggle={() => setProjectsExpanded((expanded) => !expanded)}
                controlsId="willow-projects-section"
              />
              <div
                id="willow-projects-section"
                className="grid min-h-0"
                style={{
                  gridTemplateRows: projectsExpanded ? '1fr' : '0fr',
                  transition: 'grid-template-rows 200ms cubic-bezier(0.2, 0, 0, 1)',
                }}
              >
                <div className="min-h-0 overflow-hidden space-y-0">
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
              </div>

              {!isInitializingLocalFS && isLocalFolderConnected && (!isLocalFolderAuthorized || localChats.length > 0) && (
                <>
                  <SectionHeader
                    title="Recents"
                    isCollapsed={isCollapsed}
                    isExpanded={recentsExpanded}
                    onToggle={() => {
                      setRecentsExpanded((expanded) => {
                        if (expanded) {
                          if (shouldRenderMenu) triggerCloseMenu();
                          if (editingChatId) handleRenameSave();
                        }
                        return !expanded;
                      });
                    }}
                    controlsId="willow-recents-section"
                  />
                  <div
                    id="willow-recents-section"
                    className="grid min-h-0"
                    aria-hidden={isCollapsed || !recentsExpanded}
                    style={{
                      gridTemplateRows: !isCollapsed && recentsExpanded ? '1fr' : '0fr',
                      transition: 'grid-template-rows 200ms cubic-bezier(0.2, 0, 0, 1)',
                    }}
                  >
                    <div className="min-h-0 overflow-hidden space-y-0">
                    {!isCollapsed && recentsExpanded && localChats.length > 0 ? (
                      (() => {
                        // The context owns the deterministic newest-first
                        // order. Pinning is a stable partition only; the
                        // sidebar must not independently reinterpret mtimes.
                        const sortedChats = [
                          ...localChats.filter((chat) => pinnedChats.includes(chat)),
                          ...localChats.filter((chat) => !pinnedChats.includes(chat)),
                        ];
                        return sortedChats.map((chat) => {
                          const isTemp = isTempChatId(chat);
                          if (isTemp && activeChatId === chat) {
                            return <SidebarSkeleton key={chat} isCollapsed={isCollapsed} />;
                          }
                          const displayName = isTemp ? 'Untitled' : chat;
                          const startedInCode = isCodeChat(chatScopeId, chat);

                          return (
                            <SidebarItem 
                              key={chat}
                              label={displayName}
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
                                     <span className="truncate flex-1">{displayName}</span>
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
                              keepActionsVisible={menuActiveChat === chat || startedInCode}
                              actions={
                                <button
                                  onClick={(e) => handleMenuClick(e, chat)}
                                  aria-label={`More options for ${displayName}`}
                                  className={`relative flex h-[22px] w-[22px] items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white transition-colors shrink-0 ${
                                    menuActiveChat === chat || startedInCode ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'
                                  }`}
                                >
                                  {startedInCode && menuActiveChat !== chat && (
                                    <span
                                      title="Started in Code mode"
                                      className="absolute inset-0 flex items-center justify-center rounded-md bg-white/10 group-hover/item:opacity-0 group-hover/item:pointer-events-none transition-opacity"
                                    >
                                      <Terminal size={14} strokeWidth={2} aria-hidden="true" />
                                    </span>
                                  )}
                                  <MoreVertical
                                    size={14}
                                    aria-hidden="true"
                                    className={startedInCode && menuActiveChat !== chat ? 'opacity-0 group-hover/item:opacity-100 transition-opacity' : undefined}
                                  />
                                </button>
                              }
                            />
                          );
                        });
                      })()
                    ) : null}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Fancy top glow overlay matching sidebar background under Search tab */}
        <div
          className="absolute top-0 left-0 right-0 h-3 pointer-events-none z-10 transition-opacity duration-200"
          style={{ opacity: isScrolled ? 1 : 0 }}
        >
          <div
            className="absolute inset-0 transition-opacity duration-300 ease-out"
            style={{ background: expandedGlowGradient, opacity: isCollapsed ? 0 : 1 }}
          />
          <div
            className="absolute inset-0 transition-opacity duration-300 ease-out"
            style={{ background: collapsedGlowGradient, opacity: isCollapsed ? 1 : 0 }}
          />
        </div>

        {/* Gemini keeps the lower edge visually soft instead of exposing a
            hard scrollbar or a sharp content boundary. */}
        <div
          aria-hidden="true"
          className="absolute bottom-0 left-0 right-0 h-14 pointer-events-none z-10 transition-opacity duration-200"
          style={{
            opacity: isAtScrollEnd ? 0 : 1,
            background: `linear-gradient(to bottom, transparent, ${isCollapsed ? 'var(--dashboard-surface)' : '#1f1f1f'})`,
          }}
        />
      </div>
        </>
      )}

      {/* Gemini-style footer: account at the bottom, Settings beside it in
          the expanded rail, and above it in the compact rail. */}
      <div className={`relative mt-auto shrink-0 transition-[height] duration-200 ease-out ${isCollapsed ? 'h-[100px]' : 'h-[56px]'}`}>
        <div className={`absolute left-1.5 right-1.5 flex items-center ${isCollapsed ? 'bottom-1 h-10' : 'top-1 h-12'}`}>
          {user ? (
            <div className="relative flex h-10 min-w-0 flex-1 items-center">
              <UserMenu
                isOpen={isUserMenuOpen}
                isCollapsed={isCollapsed}
                onClose={() => setIsUserMenuOpen(false)}
                onSettingsClick={onSettingsClick}
                backgroundType={backgroundType}
              />
              <button
                type="button"
                aria-label="Open account menu"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={handleUserMenuToggle}
                className={`group/profile relative flex h-10 min-w-0 flex-1 items-center rounded-xl px-1.5 transition-colors hover:bg-white/[0.06] ${isUserMenuOpen ? 'bg-white/[0.06]' : ''}`}
              >
                {userProfile?.photoURL ? (
                  <img
                    src={userProfile.photoURL}
                    alt="User"
                    className={`h-[30px] w-[30px] rounded-full border border-white/10 object-cover transition-transform active:scale-90 ${isUserMenuOpen ? 'scale-105 border-white/20' : ''}`}
                  />
                ) : (
                  <span className={`flex h-[30px] w-[30px] items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-[#1e3a29] via-[#4a7c59] to-[#8fb896] text-[12px] font-medium text-white transition-transform active:scale-90 ${isUserMenuOpen ? 'scale-105 border-white/20' : ''}`}>
                    {userProfile?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || '?'}
                  </span>
                )}
                {!isCollapsed && <span className="ml-2 min-w-0 truncate text-[13px] text-white/80">{userProfile?.displayName || user?.email || 'Account'}</span>}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/login')}
              className={`flex h-10 min-w-0 flex-1 items-center rounded-xl px-1.5 text-white/80 transition-colors hover:bg-white/[0.06] ${isCollapsed ? 'justify-center' : 'gap-2'}`}
              title="Sign In"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10"><LogIn size={18} /></span>
              {!isCollapsed && <span className="text-[13px] font-medium">Sign In</span>}
            </button>
          )}

          {!isCollapsed && (
            <button
              type="button"
              aria-label="Settings"
              title="Settings"
              onClick={() => { setIsSettingsMenuOpen((open) => !open); setIsUserMenuOpen(false); }}
              className={`ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#e3e3e3] transition-colors hover:bg-white/[0.08] ${isSettingsMenuOpen ? 'bg-white/[0.08]' : ''}`}
            >
              <SidebarGlyph name="settings" className="h-5 w-5 text-[20px] leading-5" />
            </button>
          )}
        </div>

        {isCollapsed && (
          <button
            type="button"
            aria-label="Settings"
            title="Settings"
            onClick={() => { setIsSettingsMenuOpen((open) => !open); setIsUserMenuOpen(false); }}
            className={`absolute left-2 top-1 flex h-9 w-9 items-center justify-center rounded-full text-[#e3e3e3] transition-colors hover:bg-white/[0.08] ${isSettingsMenuOpen ? 'bg-white/[0.08]' : ''}`}
          >
            <SidebarGlyph name="settings" className="h-5 w-5 text-[20px] leading-5" />
          </button>
        )}

        {isCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            className="absolute inset-y-0 right-0 w-1 cursor-pointer transition-colors hover:bg-white/5 group/tab"
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 rounded-l-md border border-white/10 bg-[#1f1f1f] p-1 opacity-0 transition-opacity group-hover/tab:opacity-100">
              <PanelLeft size={14} className="text-white" />
            </div>
          </button>
        )}
      </div>

      <GeminiSettingsMenu
        isOpen={isSettingsMenuOpen}
        isCollapsed={isCollapsed}
        onClose={() => setIsSettingsMenuOpen(false)}
        onSettingsClick={onSettingsClick}
      />

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
