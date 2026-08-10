
import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
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
  Share2,
  Pin,
  Pencil,
  BookOpen,
  Trash2,
  Github,
} from 'lucide-react';
import { DiscordIcon } from './SidebarIcons';
import logo from '@willow/assets/brand/logo.png';
import './Sidebar.css';
import { useAuth } from '@willow/auth/AuthContext';
import { useLocalFS, isTempChatId } from '@willow/storage/local-fs/LocalFSContext';
import { useBackground, BackgroundType } from '../BackgroundContext';
import { forgetScannedCodeChat, hasScannedCodeChat, isCodeChat, markCodeChat, markScannedCodeChat, migrateVerifiedLegacyCodeChat, readCodeChats, renameCodeChat, renameScannedCodeChat, unmarkCodeChat } from '@willow/storage/code-chat-storage';
import {
  STUDIO_SIDEBAR_COLLAPSED_WIDTH,
  STUDIO_SIDEBAR_EXPANDED_WIDTH,
} from '@willow/core/layout';
import {
  goToAllSparkTasks,
  goToSparkApps,
  goToSparkHome,
  goToSparkSchedules,
  goToSparkSkills,
  sparkLocation,
} from '@willow/spark/spark-store';
import type { StudioExperience } from '@willow/core/types';
// NOTE: import from './index' (not './sidebar'). On a case-insensitive
// filesystem (Windows/macOS) './sidebar' can resolve to THIS file (Sidebar.tsx),
// causing a circular self-import whose named exports are undefined — which crashed
// the whole app to a black screen. '/index' forces the folder to resolve.
import { MediaIcon, SidebarItem, SidebarSkeleton, SectionHeader, UserMenu, RecentChatRow } from './index';
import { AgentIcon } from '@willow/ui/AgentIcon';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

// Recents renders a window over the chat list rather than the whole thing, and
// grows it as you scroll. The full id list is already in memory (localStorage),
// so this is purely a render budget — nothing is fetched on scroll.
const RECENTS_INITIAL_COUNT = 30;
const RECENTS_CHUNK_SIZE = 25;
// Grow before the user reaches the floor, so the next rows are usually already
// there. The scroller also holds Projects and the fixed nav items above Recents.
const RECENTS_GROW_THRESHOLD_PX = 240;
// How long the "loading more" spinner stays up. The rows are already in memory,
// so this is presentation, not work — it exists so the indicator is legible
// rather than a one-frame flash. Mirrors the top progress bar's 280ms floor.
const RECENTS_SPINNER_MIN_MS = 280;

// Stable identity for the "no pins yet" case, so the memos below don't churn
// during the effect-sized window after a scope switch.
const NO_PINNED_CHATS: string[] = [];

// Returns a function whose identity never changes but which always invokes the
// latest render's implementation. Lets the memoized Recents rows receive stable
// handler props (so React.memo actually holds) without freezing any state they
// read. Same helper as MediaView's, for the same reason.
function useEventCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useMemo(() => ((...args: any[]) => ref.current(...args)) as T, []);
}

// ── Inline menus (used once, kept here) ──────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

type GeminiSettingsMenuProps = {
  isOpen: boolean;
  isCollapsed: boolean;
  onClose: () => void;
  onSettingsClick?: (tabId?: string) => void;
};

type GeminiSettingsItem = {
  id: string;
  label: string;
  icon: string;
  iconFamily?: 'luminous' | 'google-symbols' | 'avatar' | 'spark-settings' | 'custom';
  trailingArrow?: boolean;
  action?: 'settings';
  url?: string;
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
  { id: 'agents-settings', label: 'Agents Settings', icon: 'agent', iconFamily: 'custom', action: 'settings' },
  { id: 'models', label: 'Models', icon: 'spark', iconFamily: 'luminous', action: 'settings' },
  { id: 'notebook', label: 'Willow Notebook', icon: 'notebook_lm', iconFamily: 'luminous', action: 'settings' },
  { id: 'github', label: 'Github Repository', icon: 'github', iconFamily: 'custom', trailingArrow: true, url: 'https://github.com/YashjitPal/Willow-Code' },
  { id: 'discord', label: 'Discord', icon: 'discord', iconFamily: 'custom', trailingArrow: true },
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
  if (item.iconFamily === 'custom') {
    if (item.icon === 'agent') return <AgentIcon size={19} className="ml-[2px] mr-[2px] shrink-0" />;
    if (item.icon === 'github') return <Github size={20} strokeWidth={2.2} className="ml-[2px] mr-[2px]" />;
    if (item.icon === 'discord') return <DiscordIcon size={21} strokeWidth={1.8} className="ml-[1px] mr-[2px]" />;
  }

  return (
    <MaterialSymbol
      name={item.icon}
      family={(item.iconFamily ?? 'luminous') as any}
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
    if (item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
      onClose();
      return;
    }
    if (item.action === 'settings') {
      onClose();
      onSettingsClick?.(item.id);
    }
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Settings"
      className="willow-gem-menu-in absolute z-[100] w-[300px] max-h-[calc(100vh-16px)] overflow-y-auto rounded-[20px] bg-[#1f1f1f] p-2 text-[#e6e6e6] shadow-[0_0_20px_rgba(0,0,0,0.28)]"
      style={{
        left: isCollapsed ? '52px' : 'calc(100% - 44px)',
        bottom: isCollapsed ? '94px' : '50px',
        // Anchored bottom-left, so it grows up and to the right from the gear — the
        // same relationship Gemini's plus menu has to its own trigger, where the
        // measured transform-origin was `0px <height>`.
        transformOrigin: '0 100%',
      }}
    >
      {GEMINI_SETTINGS_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          aria-label={item.label}
          onClick={() => handleItemClick(item)}
          className="group/settings-item flex h-9 w-full items-center overflow-hidden rounded-xl px-2 text-left font-['Google_Sans_Flex','Google_Sans_Text','Google_Sans',sans-serif] text-[13px] font-normal text-[#e6e6e6] transition-colors hover:bg-[rgba(230,230,230,0.08)]"
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

export type ViewType = 'home' | 'agents' | 'projects' | 'workbench' | 'starred' | 'shared' | 'personal-intelligence' | 'saved-info' | 'gems';

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
      /*
       * `title` routes the collapsed label through <GlobalTooltips>, i.e.
       * Gemini's tooltip. `right` is measured: Gemini's bottom-left rail button
       * put its pane at "top: 777.6px; left: 278px; transform: translateX(8px)"
       * — left == anchor.right, so a left-edge icon button places right.
       */
      title={isCollapsed ? label : undefined}
      data-tooltip-position="right"
      className={`group/spark-item relative flex h-8 w-full items-center gap-2 rounded-full px-2 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-white/25 ${
        active ? 'bg-[#171717] text-white font-medium' : 'text-[#e6e6e6] hover:bg-[rgba(230,230,230,0.08)]'
      }`}
    >
      <div className={`${isCollapsed ? 'h-5 w-5' : 'h-7 w-7'} flex items-center justify-center shrink-0`}>
        <MaterialSymbol
          family="luminous"
          name={symbol}
          size={20}
          opticalSize={20}
          fill={active}
          className="transition-transform duration-200 group-active/spark-item:scale-90"
        />
      </div>
      {!isCollapsed && (
        <span className={`min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left text-[13px] leading-[17px] ${active ? 'font-medium text-white' : 'font-normal text-[#e6e6e6]'}`}>
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
  studioMode?: 'chat' | 'develop' | 'media';
  onModeChange?: (mode: 'chat' | 'develop' | 'media') => void;
  studioExperience: StudioExperience;
  onStudioExperienceChange: (experience: StudioExperience) => void;
  onSettingsClick?: (tabId?: string) => void;
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
  studioMode,
  onModeChange,
  studioExperience,
  onStudioExperienceChange,
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

  const isChatOngoing = studioExperience === 'chat' && (!!activeChatId || hasActiveChat);

  const [isScrolled, setIsScrolled] = useState(false);
  const [codeChatVersion, setCodeChatVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setCodeChatVersion((version) => version + 1);
    window.addEventListener('willow_code_chats_updated', refresh);
    return () => window.removeEventListener('willow_code_chats_updated', refresh);
  }, []);
  // Resolve the Code-mode map ONCE per render. Asking per chat re-derived it per
  // row, and each derivation walks all of localStorage — the dominant cost of
  // painting a long Recents list. `codeChatVersion` is the invalidation signal.
  const codeChats = useMemo(
    () => readCodeChats(chatScopeId),
    [chatScopeId, codeChatVersion]
  );
  // Chats whose body has been examined for a legacy Code-mode marker. Backed by
  // localStorage via has/markScannedCodeChat, so the scan is once per chat EVER.
  // It used to live only in this ref, which meant every launch re-read every
  // chat body from disk — the "app lags while the chats load" symptom.
  const codeChatScannedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    codeChatScannedRef.current.clear();
  }, [chatScopeId]);
  const [isAtScrollEnd, setIsAtScrollEnd] = useState(true);
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setIsScrolled(target.scrollTop > 5);
    setIsAtScrollEnd(target.scrollTop + target.clientHeight >= target.scrollHeight - 4);
    // Grow Recents as the floor comes into view. `growRecents` is declared below
    // but only ever invoked from a real scroll event, which is long after this
    // component has finished its first render.
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom <= RECENTS_GROW_THRESHOLD_PX) growRecents();
  };

  // Pinned chats persistence
  const pinnedChatsKey = `willow_pinned_chats:v2:${encodeURIComponent(chatScopeId)}`;
  const [pinnedChatState, setPinnedChatState] = useState<{ scopeId: string; chats: string[] }>(() => ({
    scopeId: chatScopeId,
    chats: [],
  }));
  // Never render the previous scope's pins during the effect-sized window
  // between a user/root/workspace switch and loading the new scoped key.
  const pinnedChats = pinnedChatState.scopeId === chatScopeId ? pinnedChatState.chats : NO_PINNED_CHATS;
  // A Set because the partition below tests membership once per chat, and the
  // rows test it again — O(n) `.includes()` per row made that quadratic.
  const pinnedChatSet = useMemo(() => new Set(pinnedChats), [pinnedChats]);
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
      if (success) {
        renameCodeChat(chatScopeId, editingChatId!, trimmed);
        // Carry the scan verdict to the new id, or the renamed chat's body gets
        // re-read from disk on the next launch for no reason.
        renameScannedCodeChat(chatScopeId, editingChatId!, trimmed);
      }
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
      if (success) {
        unmarkCodeChat(chatScopeId, chatToDelete);
        // Also drop scan bookkeeping, so a future chat that reuses this id gets
        // examined rather than inheriting this one's "already scanned" verdict.
        forgetScannedCodeChat(chatScopeId, chatToDelete);
      }
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

  // ── Recents windowing ──────────────────────────────────────────────────────
  // The context owns the deterministic newest-first order. Pinning is a stable
  // partition only; the sidebar must not independently reinterpret mtimes.
  const sortedChats = useMemo(() => {
    const pinned: string[] = [];
    const rest: string[] = [];
    for (const chat of localChats) (pinnedChatSet.has(chat) ? pinned : rest).push(chat);
    return [...pinned, ...rest];
  }, [localChats, pinnedChatSet]);

  const [recentsLimit, setRecentsLimit] = useState(RECENTS_INITIAL_COUNT);
  const [isGrowingRecents, setIsGrowingRecents] = useState(false);
  const growRecentsTimerRef = useRef<number | undefined>(undefined);

  // Reset the window when the list identity changes underneath us — a scope
  // switch shows a different user's chats, and leaving it grown would render
  // hundreds of rows on the first paint of the new scope. Deliberately NOT reset
  // on `localChats`: a rename or a new chat would collapse a list the user had
  // scrolled open.
  useEffect(() => {
    setRecentsLimit(RECENTS_INITIAL_COUNT);
  }, [chatScopeId]);

  // Pins are all hoisted to the front, so a user with 40 pins would otherwise see
  // a first window made entirely of pins and no actual recents.
  const effectiveRecentsLimit = recentsLimit + pinnedChatSet.size;
  const hasMoreRecents = effectiveRecentsLimit < sortedChats.length;

  const windowedChats = useMemo(() => {
    if (!hasMoreRecents) return sortedChats;
    // Rows that must stay mounted regardless of where they sort:
    //   editingChatId  — the rename <input> lives inside the row, and React does
    //                    not fire blur on unmount, so windowing it away would
    //                    silently discard the rename and strand `editingChatId`.
    //   menuActiveChat — the menu is NOT a portal but it IS rendered outside the
    //                    map, so it would survive as a menu floating next to
    //                    nothing.
    //   activeChatId   — otherwise the open chat loses its active highlight.
    const forced = new Set(
      [editingChatId, menuActiveChat, activeChatId].filter((id): id is string => !!id)
    );
    // filter, not slice+concat: it preserves the context-owned order with no re-sort.
    return sortedChats.filter((chat, index) => index < effectiveRecentsLimit || forced.has(chat));
  }, [sortedChats, effectiveRecentsLimit, hasMoreRecents, editingChatId, menuActiveChat, activeChatId]);

  const growRecents = useEventCallback(() => {
    if (!hasMoreRecents || growRecentsTimerRef.current !== undefined) return;
    setIsGrowingRecents(true);
    // Appending is synchronous — the rows are already in memory, so there is
    // nothing to await. The delay is what makes the indicator legible: without
    // it the spinner would mount and unmount inside one frame and never be seen.
    // Same reasoning as the top progress bar's 280ms floor. The 240px threshold
    // above means the next chunk is requested well before the user reaches it.
    growRecentsTimerRef.current = window.setTimeout(() => {
      growRecentsTimerRef.current = undefined;
      setRecentsLimit((limit) => limit + RECENTS_CHUNK_SIZE);
      setIsGrowingRecents(false);
    }, RECENTS_SPINNER_MIN_MS);
  });
  useEffect(() => () => {
    if (growRecentsTimerRef.current !== undefined) window.clearTimeout(growRecentsTimerRef.current);
  }, []);

  // Stable handler identities for the memoized rows. Every one of these closes
  // over state that changes, so a plain arrow would defeat React.memo on the
  // whole list — which is the entire point of extracting RecentChatRow.
  const handleSelectChat = useEventCallback((chatId: string) => {
    onViewChange('home');
    onModeChange?.('chat');
    selectLocalFSInboxChat(chatId);
  });
  const handleRenameSaveStable = useEventCallback(() => { void handleRenameSave(); });
  const handleRenameCancel = useEventCallback(() => setEditingChatId(null));
  const handleMenuClickStable = useEventCallback(handleMenuClick);

  // Legacy Code-mode marker backfill.
  //
  // This reads FULL chat bodies, so it is scoped to the rows actually on screen
  // (plus the active chat) and grows with the window. It used to walk the entire
  // history: on the same per-chat operation queue the user's own click waits on,
  // that meant a large workspace spent minutes reading bodies nobody asked for,
  // and every chat open queued behind it. Chats below the fold are scanned when
  // the user scrolls to them.
  const scanCandidates = useMemo(() => {
    const visible = sortedChats.slice(0, effectiveRecentsLimit);
    if (activeChatId && !visible.includes(activeChatId) && sortedChats.includes(activeChatId)) {
      visible.push(activeChatId);
    }
    return visible;
  }, [sortedChats, effectiveRecentsLimit, activeChatId]);

  useEffect(() => {
    if (isInitializingLocalFS) return;
    let cancelled = false;
    let timer: number | undefined;
    // The id whose body read is in flight. On cancellation it is rolled back out
    // of `codeChatScannedRef` below — without that, a restart would filter it out
    // as "already scanned" while localStorage never recorded it, and its
    // Code-mode marker would be lost for the rest of the session. That matters
    // now in a way it did not before, because this effect legitimately restarts
    // whenever the window grows.
    let inFlight: string | null = null;
    // Deliberately NOT the memoized `codeChats`. This effect marks chats, which
    // invalidates that memo — depending on it would restart the scan on every
    // mark. The module-level cache makes this per-chat call O(1) anyway.
    const pending = scanCandidates.filter((chatId) =>
      !isCodeChat(chatScopeId, chatId) &&
      !codeChatScannedRef.current.has(chatId) &&
      !hasScannedCodeChat(chatScopeId, chatId)
    );
    const scanNext = async () => {
      // Legacy marker migration is intentionally lazy and bounded: never load
      // every full chat body concurrently just to paint the sidebar.
      for (const chatId of pending.splice(0, 2)) {
        codeChatScannedRef.current.add(chatId);
        inFlight = chatId;
        const messages = await loadLocalFSChat(chatId);
        if (cancelled) return;
        inFlight = null;
        if (messages?.some((message: any) => message?.willowMode === 'code')) {
          // Old marker keys had no owner. The body check is the ownership
          // proof that makes adopting a matching legacy marker safe.
          if (!migrateVerifiedLegacyCodeChat(chatScopeId, chatId)) markCodeChat(chatScopeId, chatId);
        }
        // Record only AFTER the body was actually read. Marking before the await
        // would persist "scanned" for a chat whose read was cancelled mid-flight,
        // and its Code-mode marker would then never be recovered.
        markScannedCodeChat(chatScopeId, chatId);
      }
      if (!cancelled && pending.length > 0) timer = window.setTimeout(() => { void scanNext(); }, 100);
    };
    // Longer than the old 250ms: a chat opened right after mount should reach the
    // shared operation queue before any background body read does.
    timer = window.setTimeout(() => { void scanNext(); }, 1000);
    return () => {
      cancelled = true;
      if (inFlight) codeChatScannedRef.current.delete(inFlight);
      if (timer) window.clearTimeout(timer);
    };
  }, [scanCandidates, loadLocalFSChat, isInitializingLocalFS, chatScopeId]);

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
      case 'blue': return 'hue-rotate(160deg)';
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
        if (color === 'blue') filterStr = 'hue-rotate(160deg)';
        else if (color === 'pink') filterStr = 'hue-rotate(220deg)';
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

  // Gemini fades the expanded rail surface into the studio surface as it collapses.
  const expandedSidebarBgClass = backgroundType === 'waves'
    ? 'bg-[#1f1f1f]/90 backdrop-blur-xl'
    : 'bg-[#1f1f1f]';
  const sidebarBgClass = isCollapsed
    ? 'bg-[var(--studio-surface)]'
    : expandedSidebarBgClass;

  const expandedGlowGradient = backgroundType === 'waves'
    ? 'linear-gradient(to bottom, rgba(31, 31, 31, 0.9) 15%, rgba(31, 31, 31, 0))'
    : 'linear-gradient(to bottom, #1f1f1f 15%, rgba(31, 31, 31, 0))';
  const collapsedGlowGradient = 'linear-gradient(to bottom, var(--studio-surface) 15%, transparent)';

  return (
    <aside
      className={`studio-sidebar ${isCollapsed ? 'studio-sidebar--collapsed' : 'studio-sidebar--expanded'} group relative h-screen ${sidebarBgClass} flex flex-col shrink-0 z-50 font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]`}
      style={{
        width: isHidden ? '0px' : `${isCollapsed ? STUDIO_SIDEBAR_COLLAPSED_WIDTH : STUDIO_SIDEBAR_EXPANDED_WIDTH}px`,
        // Keep min-width constant. A state-dependent min-width clamps the
        // interpolated width on expansion and makes the rail snap open.
        minWidth: '0px',
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
            /*
             * Collapsed, this is a row of the 52px rail, so it places `right`
             * like every other rail row (measured on Gemini: surface x=284
             * against a trigger ending at 276, gap 8, vertically centred).
             * Inferred for this particular button rather than measured — Gemini
             * shows no tooltip on its expanded sidebar at all, so the collapsed
             * top button could not be sampled directly. Left `below` when
             * expanded, where that is what was measured.
             */
            data-tooltip-position={isCollapsed ? 'right' : 'below'}
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
          <span
            className="gemini-sidenav-text text-[17.5px] leading-6 text-[#e0e0e0] select-none -ml-0.5 whitespace-nowrap overflow-hidden text-ellipsis transition-opacity duration-200"
            style={{
              fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
              fontWeight: 470,
              fontVariationSettings: '"wght" 470'
            }}
          >
            Willow
          </span>
        )}
        
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

      {/* One persistent pill follows the rail width, so Chat/Spark visibly
          compresses into the compact switch instead of swapping in place. */}
      <div className="relative mt-1 mb-[12px] h-8 w-full shrink-0 overflow-hidden px-1.5">
        <div
          className={`relative flex h-8 w-full items-center rounded-full p-[2px] ${isCollapsed ? 'bg-transparent' : 'bg-[#171717]'}`}
          style={{ transition: `background-color ${GEMINI_SIDEBAR_SURFACE_MOTION}` }}
        >
          {/* Sliding active pill indicator - matches sidebar surface color (#1f1f1f) */}
          <div
            className="absolute top-[2px] bottom-[2px] w-[calc(50%-2px)] rounded-full bg-[#1f1f1f] transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]"
            style={{
              transform: studioExperience === 'spark' ? 'translateX(calc(100%))' : 'translateX(0px)',
              opacity: isCollapsed ? 0 : 1,
            }}
          />

          <div
            aria-hidden={isCollapsed}
            className={`relative z-10 flex h-full w-full items-center ${isCollapsed ? 'pointer-events-none' : ''}`}
            style={{
              opacity: isCollapsed ? 0 : 1,
              transform: isCollapsed ? 'scaleX(0.2)' : 'scaleX(1)',
              transformOrigin: 'left center',
              transition: `transform ${GEMINI_SIDEBAR_POSITION_MOTION}, opacity ${isCollapsed ? '100ms' : '150ms'} cubic-bezier(0, 0, 0, 1)`,
            }}
          >
            <button
              type="button"
              onClick={() => onStudioExperienceChange('chat')}
              aria-pressed={studioExperience === 'chat'}
              tabIndex={isCollapsed ? -1 : 0}
              className={`flex-1 flex h-full items-center justify-center rounded-full text-[13px] font-normal transition-colors duration-150 select-none cursor-pointer ${
                studioExperience === 'chat'
                  ? 'text-[#e3e3e3]'
                  : 'text-white/55 hover:text-white'
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => {
                goToSparkHome();
                onStudioExperienceChange('spark');
              }}
              aria-pressed={studioExperience === 'spark'}
              tabIndex={isCollapsed ? -1 : 0}
              className={`flex-1 flex h-full items-center justify-center gap-1 rounded-full text-[13px] font-normal transition-colors duration-150 select-none cursor-pointer ${
                studioExperience === 'spark'
                  ? 'text-[#e3e3e3]'
                  : 'text-white/55 hover:text-white'
              }`}
            >
              <span>Spark</span>
              <span className="text-[7px] font-medium leading-none text-[#e3e3e3] opacity-70">beta</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (studioExperience === 'chat') {
                goToSparkHome();
                onStudioExperienceChange('spark');
              } else {
                onStudioExperienceChange('chat');
              }
            }}
            aria-label={studioExperience === 'chat' ? 'Switch to Spark' : 'Switch to Chat'}
            aria-pressed={studioExperience === 'spark'}
            title={studioExperience === 'chat' ? 'Switch to Spark' : 'Switch to Chat'}
            /* Only reachable collapsed (opacity 0 + pointer-events-none when
             * expanded), so it is always a rail row — placed `right` like the
             * rest of the rail. See the expand button above for the evidence. */
            data-tooltip-position="right"
            tabIndex={isCollapsed ? 0 : -1}
            className={`absolute left-1 top-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-1 text-[#e6e6e6] hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${isCollapsed ? '' : 'pointer-events-none'}`}
            style={{
              opacity: isCollapsed ? 1 : 0,
              transform: isCollapsed ? 'scale(1)' : 'scale(0.72)',
              transition: `transform ${GEMINI_SIDEBAR_POSITION_MOTION}, opacity ${isCollapsed ? '100ms' : '150ms'} cubic-bezier(0, 0, 0, 1), background-color 150ms ease`,
            }}
          >
            <span
              className="luminous-symbols inline-flex h-5 w-5 items-center justify-center overflow-hidden text-[20px] leading-5 select-none"
              style={{
                fontFamily: "'Luminous Symbols', 'Google Symbols', 'Material Symbols Rounded', sans-serif",
                fontWeight: 320,
                fontVariationSettings: '"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320',
              }}
            >
              {studioExperience === 'spark' ? 'toggle_on' : 'toggle_off'}
            </span>
          </button>
        </div>
      </div>

      {studioExperience === 'spark' ? (
        <div className={`min-h-0 flex-1 pb-4 ${isCollapsed ? 'pt-2' : 'pt-0'}`}>
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
              onStudioExperienceChange('spark');
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
              onStudioExperienceChange('spark');
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
              onStudioExperienceChange('spark');
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
              onStudioExperienceChange('spark');
              onViewChange('home');
              goToSparkApps();
            }}
          />
        </div>
      ) : (
        <>
      {/* Fixed top-level navigation: Home & Search */}
      <div className="pt-0 space-y-0 shrink-0">
        <SidebarItem 
          symbol="gemini_chat" 
          label="New chat" 
          isCollapsed={isCollapsed} 
          active={currentView === 'home' && studioMode === 'chat' && !isChatOngoing}
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
            symbol="search" 
            label="Search" 
            isCollapsed={isCollapsed} 
            onClick={onSearchClick}
          />
        )}
      </div>

      {/*
        * Scrollable lower navigation. The soft lower edge is the `.bottom-gradient`
        * overlay below, NOT a mask here — Gemini fades the list with a sticky gradient
        * element and leaves the scroller itself unmasked. This carried both, so the last
        * row was dimmed twice: once by a mask fading it to 20% over the final 10px, and
        * again by the overlay.
        */}
      <div className="flex-1 relative min-h-0">
        <div
          onScroll={handleScroll}
          className="h-full overflow-y-auto pt-0 pb-0 gemini-chat-scrollbar"
        >
          <div className="space-y-0">
            <SidebarItem 
              flushRight
              icon={Terminal} 
              label="Code" 
              isCollapsed={isCollapsed} 
              active={currentView === 'home' && studioMode === 'develop'}
              onClick={() => {
                onViewChange('home');
                onModeChange?.('develop');
              }}
            />
            <SidebarItem 
              flushRight
              icon={MediaIcon} 
              label="Media" 
              isCollapsed={isCollapsed} 
              active={currentView === 'home' && studioMode === 'media'}
              onClick={() => {
                onViewChange('home');
                onModeChange?.('media');
              }}
            />
            <SidebarItem
              flushRight
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
                  flushRight
                  icon={LayoutGrid} 
                  label="All projects" 
                  isCollapsed={isCollapsed} 
                  active={currentView === 'projects'}
                  onClick={() => onViewChange('projects')}
                />
                <SidebarItem 
                  flushRight
                  icon={Star} 
                  label="Starred" 
                  isCollapsed={isCollapsed} 
                  active={currentView === 'starred'}
                  onClick={() => onViewChange('starred')} 
                />
                <SidebarItem 
                  flushRight
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
                        } else {
                          // Re-opening the section is a fresh start, so don't
                          // re-mount however many rows were grown before it was
                          // collapsed.
                          setRecentsLimit(RECENTS_INITIAL_COUNT);
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
                      <>
                        {windowedChats.map((chat) => {
                          const isTemp = isTempChatId(chat);
                          if (isTemp && activeChatId === chat) {
                            return <SidebarSkeleton key={chat} isCollapsed={isCollapsed} />;
                          }
                          return (
                            <RecentChatRow
                              key={chat}
                              chatId={chat}
                              displayName={isTemp ? 'Untitled' : chat}
                              isCollapsed={isCollapsed}
                              isActive={currentView === 'home' && studioMode === 'chat' && activeChatId === chat}
                              isPinned={pinnedChatSet.has(chat)}
                              startedInCode={codeChats[chat] === true}
                              isEditing={editingChatId === chat}
                              isMenuOpen={menuActiveChat === chat}
                              editValue={editValue}
                              onSelect={handleSelectChat}
                              onMenuClick={handleMenuClickStable}
                              onEditValueChange={setEditValue}
                              onEditCommit={handleRenameSaveStable}
                              onEditCancel={handleRenameCancel}
                            />
                          );
                        })}
                        {/* Gemini shows a small indeterminate spinner under the
                            list while the next chunk arrives. Ours is gated on a
                            transition, because appending rows is synchronous —
                            a plain flag would mount and unmount inside one frame
                            and never actually be seen. */}
                        {isGrowingRecents && hasMoreRecents && (
                          <div className="flex items-center justify-center py-2.5" aria-hidden="true">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/15 border-t-white/55" />
                          </div>
                        )}
                      </>
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

        {/*
          * Gemini's `.bottom-gradient`, from its authored rule:
          *
          *   .bottom-gradient-container { position: sticky; height: 0; opacity: 0;
          *     pointer-events: none; z-index: 1; transition: opacity .15s linear }
          *   .bottom-gradient-container.visible { opacity: 1 }
          *   .bottom-gradient { height: var(--bottom-gradient-height, 16px); bottom: 0;
          *     background: linear-gradient(to top, var(--bottom-gradient-color), transparent) }
          *
          * `--bottom-gradient-color` is `--lumi-sys-color--surface-bright` on the
          * sidenav, which resolves to #1f1f1f — the sidebar's own background, so the
          * fade reads as the list dissolving into the panel rather than as a scrim.
          *
          * 16px and 150ms linear, both measured. This was 56px on a 200ms default ease,
          * which is why the fade looked like a much heavier wash than Gemini's.
          */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-4"
          style={{
            opacity: isAtScrollEnd ? 0 : 1,
            transition: 'opacity 150ms linear',
            background: `linear-gradient(to top, ${isCollapsed ? 'var(--studio-surface)' : '#1f1f1f'}, transparent)`,
          }}
        />
      </div>
        </>
      )}

      {/* Keep the account bottom-anchored and animate one Settings control
          between its expanded and compact coordinates. */}
      <div
        className="relative mt-auto shrink-0"
        style={{
          height: isCollapsed ? '100px' : '46px',
          transition: `height ${GEMINI_SIDEBAR_POSITION_MOTION}`,
        }}
      >
        <div
          className="absolute left-1.5 flex h-10 items-center"
          style={{
            top: isCollapsed ? 'auto' : '0px',
            bottom: isCollapsed ? '4px' : 'auto',
            right: isCollapsed ? '6px' : '48px',
            transition: `right ${GEMINI_SIDEBAR_POSITION_MOTION}, top ${GEMINI_SIDEBAR_POSITION_MOTION}`,
          }}
        >
          {user ? (
            <div className="relative flex h-10 w-full min-w-0 items-center">
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
                className={`group/profile relative flex h-10 w-full min-w-0 items-center rounded-xl px-[5px] text-left transition-colors hover:bg-white/[0.06] ${isUserMenuOpen ? 'bg-white/[0.06]' : ''}`}
              >
                {userProfile?.photoURL ? (
                  <img
                    src={userProfile.photoURL}
                    alt="User"
                    className={`h-[30px] w-[30px] shrink-0 rounded-full border border-white/10 object-cover transition-transform active:scale-90 ${isUserMenuOpen ? 'scale-105 border-white/20' : ''}`}
                  />
                ) : (
                  <span className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-[#1e3a29] via-[#4a7c59] to-[#8fb896] text-[12px] font-medium text-white transition-transform active:scale-90 ${isUserMenuOpen ? 'scale-105 border-white/20' : ''}`}>
                    {userProfile?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || '?'}
                  </span>
                )}
                <span
                  aria-hidden={isCollapsed}
                  className="min-w-0 flex-1 overflow-hidden truncate text-left text-[13px] text-[#e6e6e6]"
                  style={{
                    maxWidth: isCollapsed ? '0px' : '180px',
                    marginLeft: isCollapsed ? '0px' : '8px',
                    opacity: isCollapsed ? 0 : 1,
                    transition: `max-width ${GEMINI_SIDEBAR_POSITION_MOTION}, margin-left ${GEMINI_SIDEBAR_POSITION_MOTION}, opacity ${isCollapsed ? '100ms' : '150ms'} cubic-bezier(0, 0, 0, 1)`,
                  }}
                >
                  {userProfile?.displayName || user?.email || 'Account'}
                </span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="flex h-10 w-full min-w-0 items-center rounded-xl px-1 text-left text-white/80 transition-colors hover:bg-white/[0.06]"
              title="Sign In"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10"><LogIn size={18} /></span>
              <span
                aria-hidden={isCollapsed}
                className="min-w-0 flex-1 overflow-hidden truncate text-[13px] font-medium"
                style={{
                  maxWidth: isCollapsed ? '0px' : '180px',
                  marginLeft: isCollapsed ? '0px' : '8px',
                  opacity: isCollapsed ? 0 : 1,
                  transition: `max-width ${GEMINI_SIDEBAR_POSITION_MOTION}, margin-left ${GEMINI_SIDEBAR_POSITION_MOTION}, opacity ${isCollapsed ? '100ms' : '150ms'} cubic-bezier(0, 0, 0, 1)`,
                }}
              >
                Sign In
              </span>
            </button>
          )}
        </div>

        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          /*
           * Measured on Gemini's bottom-left rail button — the direct analogue,
           * same corner, same 32px box at x=246. Its pane read
           * "top: 777.6px; left: 278px; transform: translateX(8px)" against an
           * anchor at x=246 y=777.6 w=32, i.e. left == anchor.right and
           * top == anchor.top: right placement, not below.
           *
           * The box is 32px (h-8), not 36 — Gemini's authored rule is
           * `.mavatar-settings-button { height: 32px; width: 32px; color:
           * var(--lumi-sys-color--on-surface) }`, and on-surface resolves to
           * #e6e6e6 in the dark theme. This carried `h-9` and `#e3e3e3` for a
           * while, contradicting the measurement the comment above already recorded.
           */
          data-tooltip-position="right"
          onClick={() => { setIsSettingsMenuOpen((open) => !open); setIsUserMenuOpen(false); }}
          className={`absolute flex h-8 w-8 items-center justify-center rounded-full text-[#e6e6e6] hover:bg-white/[0.08] ${isSettingsMenuOpen ? 'bg-white/[0.08]' : ''}`}
          style={{
            right: isCollapsed ? '8px' : '6px',
            top: isCollapsed ? '4px' : '2px',
            transition: `right ${GEMINI_SIDEBAR_POSITION_MOTION}, top ${GEMINI_SIDEBAR_POSITION_MOTION}, background-color 150ms ease`,
          }}
        >
          <SidebarGlyph name="settings" className="h-5 w-5 text-[20px] leading-5" />
        </button>

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
