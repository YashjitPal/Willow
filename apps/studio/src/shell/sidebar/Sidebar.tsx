
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
import { GeminiDialog, GeminiDialogPill, GeminiOutlinedField } from '@willow/ui/GeminiDialog';
import { onChatActionIntent, pinnedChatsStorageKey } from '../chat-actions';

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

/*
 * The Recents row menu's five items, styled from Gemini measurement:
 *
 *   BUTTON 36px tall, 163.26 wide, radius 12px, padding `0 8px`, background
 *   transparent -> rgba(230, 230, 230, 0.08) on hover (the hover tint is the
 *   item's OWN background, unlike the trigger and the pill, which use ripples).
 *   Icons are "Luminous Symbols" 20px at the menu's variation settings
 *   ("FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320), rgb(230, 230, 230),
 *   inside a 24px box at dx 8. The label sits at dx 40 (8 pad + 24 icon + 8
 *   gap) in 13px/17px 400 at the row's width axis ("wdth" 92) — the same type
 *   as a Recents row, not the settings menu's.
 */
const GEMINI_MENU_ITEM_CLASS =
  'flex h-9 w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left text-[13px] leading-[17px] font-normal tracking-normal text-[#e6e6e6] transition-colors hover:bg-[rgba(230,230,230,0.08)]';
const GEMINI_MENU_LABEL_CLASS =
  'truncate text-[13px] leading-[17px] font-normal tracking-normal text-[#e6e6e6]';

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
  /* Opens a hover flyout instead of doing anything on click. Gemini's Theme row only. */
  submenu?: 'theme';
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
  { id: 'theme', label: 'Theme', icon: 'routine', iconFamily: 'google-symbols', trailingArrow: true, submenu: 'theme' },
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

/*
 * Angular Material's own `svg.mat-mdc-menu-submenu-icon`, read off Gemini's Theme row.
 * The triangle itself was already right; its BOX and COLOUR were not:
 *
 *   <svg viewBox="0 0 5 10"><polygon points="0,0 5,5 0,10"/></svg>
 *   width: 24px; padding: 0 0 0 12px;   -> 36px slot, measured x=256 right=292
 *   height: 10px
 *   fill: rgb(196, 199, 197)
 *
 * So it is a 24px-wide box with a 12px lead-in, not the 5px sliver this drew, and it is
 * DIMMER than the label beside it (#c4c7c5 against #e6e6e6) — which `fill-current` could
 * never produce, since it inherits the row's own colour.
 *
 * `box-content` is load-bearing: Tailwind's preflight makes every element `border-box`, so
 * `w-6 pl-3` alone would give a 24px total with 12px of padding eaten out of it (content 12)
 * instead of the measured 24 + 12 = 36.
 *
 * The viewBox stays 5x10 against a 24x10 box, so the glyph letterboxes to its natural 5px
 * width and centres in the slot — exactly as it does in Gemini, same svg, same box.
 */
const GeminiSubmenuArrow: React.FC = () => (
  <svg aria-hidden="true" focusable="false" className="box-content block h-[10px] w-6 shrink-0 pl-3 fill-[#c4c7c5]" viewBox="0 0 5 10">
    <polygon points="0,0 5,5 0,10" />
  </svg>
);

/*
 * Settings > Theme, measured off Gemini's live submenu.
 *
 * Unlike the top-right conversation menu (a `gem-menu` in a plain popover, which does NOT
 * animate), this one IS a `.mat-mdc-menu-panel` — `.lm-menu-theme` — so Material's own
 * enter/exit pair applies to it, the same pair the settings pane and the Recents row menu
 * already use here. Verified per-frame, not assumed:
 *
 *   enter  _mat-menu-enter  120ms cubic-bezier(0, 0, 0.2, 1)  scale(.8)/opacity 0 -> none/1
 *   exit   _mat-menu-exit   100ms linear, 25ms delay          opacity 1 -> 0, NO transform
 *
 * `transform-origin` measured `left top` here, NOT the settings pane's `0 100%`: this panel
 * hangs off the right of its trigger row and grows down-right, where the pane grows upward.
 *
 * Geometry, all of it authored rather than derived:
 *   panel   240x124 at (300, 373.21), radius 20, padding 8, bg rgb(31,31,31),
 *           shadow rgba(0,0,0,.28) 0 0 20px, colour rgb(227,227,227)
 *   rows    3 x `role="menuitemradio"`, 224x36, padding 0 8px, radius 12, gap 0
 *   hover   rgba(230,230,230,.08)
 *   label   13px/17px/400 rgb(230,230,230), flex 1 1 0%, white-space nowrap
 *   check   ONLY on the selected row: 24x24 box, 20px Luminous `check`, margin-right 8
 *
 * The 240px width is AUTHORED, not content-derived — the opposite of the conversation menu.
 * Proof: the three labels measure 44.13 / 30.31 / 28.31 natural against a 240px box, and
 * all three rows report clientWidth === scrollWidth === 224. Sizing this to its content
 * would collapse it to about a third of Gemini's.
 *
 * The check's 8px right margin is what makes the two label widths differ, and the
 * arithmetic closes exactly: content 208 = label 176 + icon 24 + margin 8 on the checked
 * row, and 208 = label alone on the other two.
 */
type GeminiThemeChoice = 'system' | 'light' | 'dark';

const GEMINI_THEME_STORAGE_KEY = 'willow_theme';

const GEMINI_THEME_OPTIONS: { id: GeminiThemeChoice; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/*
 * 25ms delay + 100ms duration. The panel must outlive `isOpen` by the FULL 125ms: at 100ms
 * the fade is only three-quarters done (opacity .25), so unmounting there pops it off screen
 * while it is still clearly visible. Gemini's own node was measured leaving the DOM 145ms
 * after the close was triggered — 125ms plus a frame.
 */
const GEMINI_MAT_MENU_EXIT_MS = 125;

const GeminiThemeSubmenu: React.FC<{
  phase: 'open' | 'closing';
  top: number;
  value: GeminiThemeChoice;
  onSelect: (value: GeminiThemeChoice) => void;
  onKeepOpen: () => void;
  onLeave: () => void;
}> = ({ phase, top, value, onSelect, onKeepOpen, onLeave }) => (
  <div
    role="menu"
    aria-label="Theme"
    onMouseEnter={onKeepOpen}
    onMouseLeave={onLeave}
    className={`${phase === 'closing' ? 'willow-mat-menu-exit' : 'willow-mat-menu-enter'} pointer-events-auto absolute z-[101] w-[240px] rounded-[20px] bg-[#1f1f1f] p-2 text-[#e3e3e3] shadow-[0_0_20px_rgba(0,0,0,0.28)]`}
    style={{
      top,
      /*
       * Measured left 300 against a parent whose right edge is 308 — an 8px overlap, which
       * is exactly the parent's padding. So the panel butts against the parent's CONTENT
       * edge, not its border edge, and the same 8px accounts for the -8px on `top`.
       */
      left: 'calc(100% - 8px)',
      transformOrigin: 'left top',
      pointerEvents: phase === 'closing' ? 'none' : undefined,
    }}
  >
    {GEMINI_THEME_OPTIONS.map((option) => (
      <button
        key={option.id}
        type="button"
        role="menuitemradio"
        aria-checked={value === option.id}
        onClick={() => onSelect(option.id)}
        className="flex h-9 w-full items-center rounded-xl px-2 text-left transition-colors hover:bg-[rgba(230,230,230,0.08)]"
      >
        {/*
          * `.gem-menu-item-label`: 13/17/400 at `"wdth" 92`, and `flex: 1 1 0%` — the label
          * absorbs the row, so the check is pushed to the trailing edge rather than being
          * positioned. Measured 176px wide on the checked row vs 208 unchecked; the 32px
          * difference IS the 24px glyph box plus its 8px margin.
          */}
        <span
          className="min-w-0 flex-1 whitespace-nowrap text-[13px] leading-[17px] font-normal text-[#e6e6e6]"
          style={{
            fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
            fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
          }}
        >
          {option.label}
        </span>
        {value === option.id && (
          <MaterialSymbol
            name="check"
            family="luminous"
            size={20}
            weight={320}
            roundness={100}
            opticalSize={20}
            className="mr-2 text-[#e6e6e6]"
            /* 20px glyph in a 24px box — MaterialSymbol ties the two together by default. */
            style={{ width: 24, height: 24, lineHeight: '24px' }}
          />
        )}
      </button>
    ))}
  </div>
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

  // Gemini's pane does not vanish on close: `_mat-menu-exit` fades it over 100ms while
  // Angular keeps the node mounted, then removes it. Unmounting on `!isOpen` skips that
  // entirely, so the close is tracked as a third state and the node outlives `isOpen`.
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>(isOpen ? 'open' : 'closed');
  const wasOpen = useRef(isOpen);

  /*
   * The Theme flyout gets the same three-phase treatment as the pane itself, and for the
   * same measured reason — it is a `.mat-mdc-menu-panel`, so it fades out over 100ms after
   * a 25ms delay rather than disappearing.
   *
   * `top` is carried in state because it is measured off the trigger ROW, not the pane:
   * Gemini put the panel at the row's top minus 8px, so it cannot be a constant here (the
   * Theme row's offset within the pane depends on how many rows precede it).
   */
  const [themePhase, setThemePhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const [themeTop, setThemeTop] = useState(0);
  const themeCloseTimer = useRef<number | null>(null);
  const [theme, setTheme] = useState<GeminiThemeChoice>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = window.localStorage.getItem(GEMINI_THEME_STORAGE_KEY);
    return stored === 'system' || stored === 'light' || stored === 'dark' ? stored : 'dark';
  });

  const cancelThemeClose = () => {
    if (themeCloseTimer.current !== null) {
      window.clearTimeout(themeCloseTimer.current);
      themeCloseTimer.current = null;
    }
  };

  /*
   * Opening is instant, closing is deferred by the exit's own length. Hovering off the
   * Theme row and onto the flyout would otherwise close it before the pointer arrives —
   * the two are separate elements with a gap between them, so a bare mouseleave/mouseenter
   * pair has no overlap. The flyout's own `onMouseEnter` cancels the pending close.
   */
  const openThemeSubmenu = (row: HTMLElement) => {
    cancelThemeClose();
    const pane = menuRef.current;
    /*
     * `offsetTop` rather than a client rect: the row's offsetParent is the wrapper (the pane
     * itself is static), and offsetTop is a LAYOUT value, so it is immune to the scale(.8)
     * the pane is still carrying if the pointer arrives mid-enter. A rect would be measured
     * against the shrunken pane and place the flyout too high. Scrolling is not in offsetTop
     * at all, hence the explicit scrollTop term.
     */
    setThemeTop(row.offsetTop - (pane ? pane.scrollTop : 0) - 8);
    setThemePhase('open');
  };

  const closeThemeSubmenu = () => {
    cancelThemeClose();
    setThemePhase((current) => (current === 'open' ? 'closing' : current));
    themeCloseTimer.current = window.setTimeout(() => {
      setThemePhase((current) => (current === 'closing' ? 'closed' : current));
      themeCloseTimer.current = null;
    }, GEMINI_MAT_MENU_EXIT_MS);
  };

  const keepThemeOpen = () => {
    cancelThemeClose();
    setThemePhase((current) => (current === 'closing' ? 'open' : current));
  };

  const handleThemeSelect = (next: GeminiThemeChoice) => {
    setTheme(next);
    try {
      window.localStorage.setItem(GEMINI_THEME_STORAGE_KEY, next);
    } catch {
      /* private mode / quota — the selection still applies for this session */
    }
  };

  useEffect(() => cancelThemeClose, []);

  useEffect(() => {
    if (isOpen) {
      setPhase('open');
    } else if (wasOpen.current) {
      setPhase('closing');
      // Matches the measured 100ms exit exactly. `animationend` would be more robust but
      // never fires under `prefers-reduced-motion`, where the animation is suppressed.
      const timer = window.setTimeout(() => setPhase('closed'), 100);
      wasOpen.current = false;
      // The flyout cannot outlive its own pane, and it has no exit of its own to play here
      // — the pane fading takes it with it.
      cancelThemeClose();
      setThemePhase('closed');
      return () => window.clearTimeout(timer);
    }
    wasOpen.current = isOpen;
  }, [isOpen]);

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

  if (phase === 'closed') return null;

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
    /*
     * The pane is `overflow-y-auto` (it can outgrow the viewport), and an overflow scroller
     * CLIPS its children — so a flyout rendered inside it would be cut off at the pane's
     * right edge, which is precisely where this one is supposed to start. Gemini sidesteps
     * this by putting the submenu in its own `.cdk-overlay-pane`, a sibling.
     *
     * Same shape here: a wrapper owns the placement, the pane and the flyout are siblings
     * inside it. The wrapper is a zero-size positioning anchor with no paint of its own, so
     * the pane's measured geometry is unchanged — `left`/`bottom` simply moved up one level,
     * and the flyout's `calc(100% - 8px)` resolves against the pane's width because the
     * wrapper is `w-[300px]` too.
     */
    <div
      className="pointer-events-none absolute z-[100] w-[300px]"
      style={{
        left: isCollapsed ? '52px' : 'calc(100% - 44px)',
        bottom: isCollapsed ? '94px' : '50px',
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label="Settings"
        className={`${phase === 'closing' ? 'willow-mat-menu-exit' : 'willow-mat-menu-enter'} pointer-events-auto absolute bottom-0 left-0 w-[300px] max-h-[calc(100vh-16px)] overflow-y-auto rounded-[20px] bg-[#1f1f1f] p-2 text-[#e6e6e6] shadow-[0_0_20px_rgba(0,0,0,0.28)]`}
        style={{
          // Measured `0px <height>` on Gemini's pane: bottom-left, matching its upward growth.
          transformOrigin: '0 100%',
          // The exit is opacity-only, so the pane must not swallow clicks while it fades.
          pointerEvents: phase === 'closing' ? 'none' : undefined,
        }}
      >
      {GEMINI_SETTINGS_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          aria-label={item.label}
          aria-haspopup={item.submenu ? 'menu' : undefined}
          aria-expanded={item.submenu ? themePhase === 'open' : undefined}
          onClick={() => handleItemClick(item)}
          /*
           * Hover, not click: Gemini's row is a `mat-mdc-menu-item-submenu-trigger`, which
           * opens on hover. Every OTHER row closes it, which is what makes moving down the
           * list dismiss the flyout — measured as `_mat-menu-exit` firing the moment the
           * pointer landed on the next row.
           */
          onMouseEnter={(event) => {
            if (item.submenu === 'theme') openThemeSubmenu(event.currentTarget);
            else closeThemeSubmenu();
          }}
          className="group/settings-item flex h-9 w-full items-center overflow-hidden rounded-xl px-2 text-left font-['Google_Sans_Flex','Google_Sans_Text','Google_Sans',sans-serif] text-[13px] font-normal text-[#e6e6e6] transition-colors hover:bg-[rgba(230,230,230,0.08)]"
        >
          <GeminiSettingsItemIcon item={item} />
          <span className="ml-2 min-w-0 flex-1 truncate">{item.label}</span>
          {item.trailingArrow && <GeminiSubmenuArrow />}
        </button>
      ))}
      {/*
        * Gemini's two location rows, measured off its own pane:
        *
        *   .location-menu-item-container .location-icon {
        *     width: .5625rem; height: .5625rem; font-size: .5625rem;   -> 9px
        *     color: var(--lumi-sys-color--on-surface);
        *     margin-inline-end: var(--gem-sys-spacing--m);             -> 12px
        *     flex-shrink: 0 }
        *   .location-update-item .location-icon-spacer { visibility: hidden }
        *
        * The glyph is `circle` in Google Symbols with `"FILL" 1` — a small SOLID dot,
        * not the 24px outlined ring this used to draw. The second row repeats the same
        * dot purely as a spacer and hides it, which is how "Update location" lines up
        * with the text above; an `ml-8` text indent was the previous stand-in and did
        * not actually match (dot 9 + gap 12 = 21px, measured x=260 -> text x=281).
        *
        * Rows: about-item 54px tall, padding 8px; update-item 36px, padding 0 8px;
        * both radius 12px, text 13px. Name is --gem-sys-color--primary (#a8c7fa),
        * source #e6e6e6.
        */}
      <div role="menuitem" className="flex h-[54px] items-center overflow-hidden rounded-xl p-2 text-[13px]">
        <span
          aria-hidden="true"
          className="mr-3 inline-flex h-[9px] w-[9px] shrink-0 items-center justify-center text-[9px] leading-[9px] text-[#e6e6e6]"
          style={{
            fontFamily: "'Google Symbols', 'Material Symbols Rounded', sans-serif",
            fontVariationSettings: '"FILL" 1',
          }}
        >
          circle
        </span>
        <span className="min-w-0 leading-[17px]">
          <span className="block truncate text-[#a8c7fa]">Kolkata, West Bengal, India</span>
          <span className="block truncate text-[#e6e6e6]">Based on your places (Home)</span>
        </span>
      </div>
      <button
        type="button"
        role="menuitem"
        aria-label="Update location"
        className="flex h-9 w-full items-center overflow-hidden rounded-xl px-2 text-left text-[13px] text-[#e6e6e6] hover:bg-[rgba(230,230,230,0.08)]"
      >
        {/* Hidden, not absent: it reserves the 9px + 12px the row above spends on its dot. */}
        <span
          aria-hidden="true"
          className="mr-3 inline-flex h-[9px] w-[9px] shrink-0 items-center justify-center text-[9px] leading-[9px]"
          style={{ visibility: 'hidden' }}
        />
        <span className="min-w-0 truncate">Update location</span>
      </button>
      </div>

      {/*
        * A sibling of the pane, not a child — see the wrapper's note. It is mounted only
        * while it has a phase to play, so the closed state costs nothing.
        */}
      {themePhase !== 'closed' && (
        <GeminiThemeSubmenu
          phase={themePhase}
          top={themeTop}
          value={theme}
          onSelect={handleThemeSelect}
          onKeepOpen={keepThemeOpen}
          onLeave={closeThemeSubmenu}
        />
      )}
    </div>
  );
};

export type ViewType = 'home' | 'agents' | 'projects' | 'workbench' | 'starred' | 'shared' | 'personal-intelligence' | 'saved-info' | 'memory' | 'connected-apps' | 'gems';

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
      className={`group/spark-item relative flex h-8 w-full items-center gap-2 rounded-full px-2 text-[#e6e6e6] outline-none transition-colors duration-150 hover:bg-[rgba(230,230,230,0.08)] focus-visible:ring-2 focus-visible:ring-white/25 ${
        active ? 'bg-[#171717]' : ''
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
        /* Same deliberate deviation as <SidebarItem>: Gemini keeps the active label at
         * weight 400 / #e6e6e6, but the weight bump was asked for back by name. */
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
  const { user, userProfile, loading: isAuthLoading } = useAuth();
  const currentSparkLocation = useStore(sparkLocation);
  const {
    chatScopeId,
    localChats, 
    activeChatId, 
    selectLocalFSInboxChat, 
    isLocalFolderConnected,
    authorizeLocalFolder,
    deleteLocalFSChat,
    renameLocalFSChat,
    loadLocalFSChat,
    isInitializingLocalFS,
    isChatListHydrated
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  useLayoutEffect(() => {
    const target = scrollContainerRef.current;
    if (!target) return;

    const checkState = () => {
      setIsScrolled(target.scrollTop > 5);
      setIsAtScrollEnd(target.scrollTop + target.clientHeight >= target.scrollHeight - 4);
    };

    checkState();
    const observer = new ResizeObserver(checkState);
    observer.observe(target);
    if (target.firstElementChild) observer.observe(target.firstElementChild);

    return () => observer.disconnect();
  }, [currentView]);

  // Pinned chats persistence. The key format comes from the shared builder so it
  // cannot drift from the read the top-right conversation-actions menu does —
  // that menu reads pins, and this component remains the only writer.
  const pinnedChatsKey = pinnedChatsStorageKey(chatScopeId);
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
  const [menuPosition, setMenuPosition] = useState<{ top?: number; bottom?: number; left: number; isAbove: boolean } | null>(null);
  const [shouldRenderMenu, setShouldRenderMenu] = useState(false);
  const [isMenuClosing, setIsMenuClosing] = useState(false);

  // Rename dialog state (replaced the inline row edit: Gemini's Recents menu
  // raises a "Rename this chat" dialog, measured 512 wide, field prefilled and
  // autofocused with the caret at the end, Rename pill disabled until the value
  // changes or is emptied).
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [shouldRenderRename, setShouldRenderRename] = useState(false);
  const [isRenameClosing, setIsRenameClosing] = useState(false);

  // Delete chat confirmation state
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);
  const [shouldRenderDelete, setShouldRenderDelete] = useState(false);
  const [isDeleteClosing, setIsDeleteClosing] = useState(false);

  const handleMenuClick = (e: React.MouseEvent, chat: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    // Measured: the pane butts directly against the trigger with NO gap. Opening
    // down, pane.y === trigger.bottom; opening up, pane.bottom === trigger.top
    // (transform-origin flips to `0px <height>px` accordingly). Anchoring the
    // upward case by `bottom` rather than `top - height` avoids guessing the
    // height, which is content-derived.
    const menuHeight = 196; // 5 rows x 36 + 2 x 8 padding — for the flip test only
    const spaceBelow = window.innerHeight - rect.bottom;
    const isAbove = spaceBelow < menuHeight;

    setMenuPosition({
      top: isAbove ? undefined : rect.bottom,
      bottom: isAbove ? window.innerHeight - rect.top : undefined,
      left: rect.left,
      isAbove,
    });
    setMenuActiveChat(chat);
    setShouldRenderMenu(true);
    setIsMenuClosing(false);
  };

  const triggerCloseMenu = () => {
    setIsMenuClosing(true);
    // Measured close: opacity hits 0 at ~118ms and the node is gone by ~125ms
    // (100ms linear + the 25ms delay the exit animation carries).
    setTimeout(() => {
      setShouldRenderMenu(false);
      setIsMenuClosing(false);
      setMenuActiveChat(null);
      setMenuPosition(null);
    }, 125);
  };

  const openRenameDialog = (chat: string) => {
    setEditingChatId(chat);
    setEditValue(chat);
    setShouldRenderRename(true);
    setIsRenameClosing(false);
  };

  /*
   * Measured close, sampled per frame off Gemini's own dialog: the surface never
   * animates out (`opacity: 1; transform: none` in every frame), only the backdrop
   * fades, and the node is removed mid-fade — long before the backdrop's 400ms
   * transition would finish.
   *
   * Bracketing the removal from both captures (frames straddle it, so each gives
   * an interval, not a point):
   *   Rename  fade starts 333.3-340.7, gone 407.4-434.5  ->  66.7-101.2ms
   *   Delete  fade starts 346.5-360.1, gone 410.0-428.8  ->  49.9- 82.3ms
   * The only span in both is 66.7-82.3, and MDC's authored
   * `$mdc-dialog-exit-duration` is 75ms — the counterpart of the 150ms
   * `$mdc-dialog-enter-duration` this dialog's surface transition already matches.
   * So 75, not a midpoint guess.
   */
  const triggerCloseRename = () => {
    setIsRenameClosing(true);
    setTimeout(() => {
      setShouldRenderRename(false);
      setIsRenameClosing(false);
      setEditingChatId(null);
    }, 75);
  };

  // handleRenameSave reads `editingChatId`/`editValue` off this render's closure,
  // so clearing the id in the same tick cannot disturb the in-flight save.
  const commitRename = () => {
    void handleRenameSave();
    triggerCloseRename();
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

  // Same 75ms measured hold as the Rename dialog — see triggerCloseRename.
  const triggerCloseDelete = () => {
    setIsDeleteClosing(true);
    setTimeout(() => {
      setShouldRenderDelete(false);
      setIsDeleteClosing(false);
      setChatToDelete(null);
    }, 75);
  };

  const confirmDeleteChat = async () => {
    if (chatToDelete) {
      // Dismiss first. Gemini's dialog node is gone ~75ms after the click, which
      // is nowhere near long enough to have waited on a disk delete — leaving it
      // up until `deleteLocalFSChat` resolves would read as a frozen dialog.
      // `chatToDelete` is read off this render's closure, so clearing the state
      // behind the 75ms hold cannot affect anything below.
      triggerCloseDelete();
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
    }
  };

  /*
   * Chat actions raised from outside the sidebar — currently the top-right
   * conversation-actions menu, which reproduces Gemini's Pin / Rename / Delete
   * rows for the open conversation.
   *
   * They are routed here rather than reimplemented there because this component
   * is the single writer for all of it: the scope-guarded pin list and its three
   * localStorage write sites, the rename dup-check and sanitizer, the pin carry
   * across a rename, and the Code-mode / scanned-chat id maps. A second writer
   * would have to keep every one of those in lock-step.
   *
   * The handlers are the same ones the row menu uses, unchanged.
   */
  useEffect(
    () =>
      onChatActionIntent(({ action, chatId }) => {
        if (action === 'pin') togglePinChat(chatId);
        else if (action === 'rename') openRenameDialog(chatId);
        else if (action === 'delete') handleDeleteChat(chatId);
      }),
    // `togglePinChat` closes over `pinnedChats`, so a stale subscription would
    // toggle against an out-of-date list and drop concurrent pins.
    [pinnedChats, chatScopeId, pinnedChatsKey],
  );

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
    //   editingChatId  — the row being renamed. The rename dialog is a portal so
    //                    it would survive the row unmounting, but the row is what
    //                    the user is looking at behind it, and it re-sorts to the
    //                    top the moment the rename lands.
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
      {/*
        * Header geometry, measured on Gemini's rail rather than centred by eye:
        *
        *   .lr26 .side-nav-menu-button { margin-top: 8px; margin-inline-start: 8px;
        *                                 min-height: 40px }          -> (8, 8, 101.01, 40)
        *   sparkle button                                            -> (14, 12, 95.01, 32)
        *   .sparkle-image { height: 22px; width: 22px }              -> (15, 17, 22, 22)
        *   .gemini-sidenav-text { margin-inline: 8px; font-size: 17px }
        *                          weight 470, line-height 24px       -> (46, 16, 55.01, 24)
        *
        * So the two numbers that matter are: the glyph occupies x 15..37 / y 17..39, and
        * the wordmark's box starts at x=46 and spans y 16..40. `ml-[10px] mt-3` on a
        * 32px button puts a centred 22px glyph at exactly (15, 17) — and, conveniently,
        * centres the button in the 52px rail too ((10+42)/2 = 26 = 52/2), so the same
        * offset is correct collapsed and expanded and the glyph never shifts.
        * `ml-1 mt-4` then lands the wordmark at (46, 16).
        *
        * This was a 36px button centred in a 52px box with a 28px glyph — 1px left and
        * 2px high of Gemini, with the wordmark 4px further right and half a pixel large.
        */}
      <div className="relative flex h-[52px] min-w-[52px] shrink-0 items-start">
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
          className="group/logo relative ml-[10px] mt-3 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-all duration-200 active:scale-95"
        >
          <div className={`transition-all duration-200 flex items-center justify-center
            ${isCollapsed ? 'group-hover:opacity-0 group-hover:scale-75' : 'opacity-100 scale-100'}`}>
            {/* 22x22, matching `.sparkle-image`. logo.png is 683x683, so squaring it
                does not distort. */}
            <img
              src={logo}
              alt="Logo"
              className="h-[22px] w-[22px] object-contain shrink-0 transition-all duration-300"
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

        {!isCollapsed && (
          <span
            className="willow-sidenav-text ml-1 mt-4 select-none overflow-hidden text-ellipsis whitespace-nowrap text-[17px] leading-6 text-[#e6e6e6]"
            style={{
              fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
              fontWeight: 470
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
              className="willow-sidenav-close-button flex h-10 w-10 items-center justify-center rounded-full text-[#e3e3e3] hover:bg-white/[0.08] transition-colors"
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
          {/*
            * Gemini's `.app-tabs-slider`, verbatim from its authored rule:
            *
            *   .app-tabs-slider { position:absolute; top:.125rem; bottom:.125rem;
            *     border-radius: corner-full; background: surface-bright; z-index:0;
            *     transition: inset-inline-start .4s cubic-bezier(.25,1,.5,1),
            *                 width           .4s cubic-bezier(.25,1,.5,1) }
            *   .app-tabs-slider--chat  { inset-inline-start:.125rem; width:calc(50% - .125rem) }
            *   .app-tabs-slider--agent { inset-inline-start:50%;     width:calc(50% - .125rem) }
            *
            * It animates its INSET, not a transform, and over 400ms on an ease-out-quart
            * curve — not the 200ms cubic-bezier(0.2,0,0,1) translate this used to run.
            * The distinction is visible: the authored curve overshoots toward the end of
            * its travel and settles, where the old one decelerated linearly into place.
            */}
          <div
            className="absolute top-[2px] bottom-[2px] w-[calc(50%-2px)] rounded-full bg-[#1f1f1f]"
            style={{
              left: studioExperience === 'spark' ? '50%' : '2px',
              opacity: isCollapsed ? 0 : 1,
              transition: 'left 400ms cubic-bezier(0.25, 1, 0.5, 1), width 400ms cubic-bezier(0.25, 1, 0.5, 1)',
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
              /* Mirrors the Spark tab: only the inactive tab carries a tooltip. Gemini's
               * active tab pairs `app-tab--active` with `mat-mdc-tooltip-disabled`.
               *
               * The shortcut belongs on BOTH tabs. Gemini's Chat tab is the active one, so
               * Material never built its describedby node and there was nothing to read —
               * but the bundle shows one computed string feeding both:
               *
               *   Aa  = shortcutEnabled ? ` (${mac ? "⇧⌘S" : "Ctrl+Shift+S"})` : ""
               *   Glb = () => "Switch to PLACEHOLDER_NAME"
               *                 .replace("PLACEHOLDER_NAME", mode === 0 ? sparkName : "Chat") + Aa
               *
               * The suffix is outside the ternary, so it is appended either way. */
              title={studioExperience === 'chat' ? undefined : 'Switch to Chat (Ctrl+Shift+S)'}
              tabIndex={isCollapsed ? -1 : 0}
              className={`flex-1 flex h-full items-center justify-center rounded-full text-[13px] font-normal transition-colors duration-150 select-none cursor-pointer ${
                studioExperience === 'chat'
                  ? 'text-[#e3e3e3]'
                  : 'text-white/55 hover:text-[#e3e3e3]'
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
              /* Read off Gemini's own tab: `aria-describedby` resolves to
               * "Switch to Spark (Ctrl+Shift+S)", and the button carries
               * `gemtooltipposition="below"` — which is Willow's default, so no
               * data-tooltip-position override here.
               *
               * Only the INACTIVE tab has one. Gemini's Chat tab (active) carries
               * `mat-mdc-tooltip-disabled` alongside `app-tab--active`, so the tooltip
               * describes where you would go, never where you are. */
              title={studioExperience === 'spark' ? undefined : 'Switch to Spark (Ctrl+Shift+S)'}
              tabIndex={isCollapsed ? -1 : 0}
              /* `.app-tab:hover:not(.app-tab--active) { color: var(--gem-sys-color--on-surface) }`
               * resolves to #e3e3e3, and there is NO background hover layer on Gemini's
               * tabs at all — hover recolours the inactive tab's text and nothing else.
               * Confirmed under forcePseudoState: the active tab's background stayed
               * rgba(0,0,0,0) and its colour never moved off rgb(227,227,227). */
              className={`flex-1 flex h-full items-center justify-center gap-1 rounded-full text-[13px] font-normal transition-colors duration-150 select-none cursor-pointer ${
                studioExperience === 'spark'
                  ? 'text-[#e3e3e3]'
                  : 'text-white/55 hover:text-[#e3e3e3]'
              }`}
            >
              <span>Spark</span>
              <span className="willow-beta-badge text-[7px] font-medium leading-none text-[#e3e3e3] opacity-70">beta</span>
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
          ref={scrollContainerRef}
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

              {/*
                * Gated on `isChatListHydrated`, NOT on `!isInitializingLocalFS`.
                * The list comes out of localStorage in one synchronous pass and
                * the titles are the filenames, so it is ready at the same moment
                * the nav rows above it are; the init flag additionally waits on
                * folder permission, a per-file disk reconcile, and a projects
                * scan. See the field's note in `LocalFSContext.tsx`.
                *
                * `localChats.length > 0` covers the HEADER too, deliberately.
                * This used to read `(!isLocalFolderAuthorized || localChats.length > 0)`,
                * which rendered a bare "Recents" heading with nothing beneath it
                * during the window where the folder is connected but permission
                * has not been re-granted — the body below is gated on the same
                * `length > 0`, so that branch could only ever produce a label
                * over empty space. A section heading is a promise that there is
                * a section; it now appears only once there is one.
                */}
              {isChatListHydrated && isLocalFolderConnected && localChats.length > 0 && (
                <>
                  <SectionHeader
                    title="Recents"
                    isCollapsed={isCollapsed}
                    isExpanded={recentsExpanded}
                    onToggle={() => {
                      setRecentsExpanded((expanded) => {
                        if (expanded) {
                          if (shouldRenderMenu) triggerCloseMenu();
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
                              isMenuOpen={menuActiveChat === chat}
                              onSelect={handleSelectChat}
                              onMenuClick={handleMenuClickStable}
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

      {/*
        * Gemini's `sidenav-mavatar-footer`, measured rather than composed.
        *
        *   .mavatar-footer-row { display:flex; align-items:center;
        *     justify-content:space-between; user-select:none; padding-block:4px }
        *   .mavatar-footer-row.collapsed { flex-direction:column-reverse;
        *     align-items:flex-start; justify-content:flex-start; gap:4px }
        *   .mavatar-footer-row.collapsed .mavatar-user-name { display:none }
        *
        * So: expanded is 48px (40px content + 4px block padding), collapsed is 92px
        * with the gear ABOVE the avatar — `column-reverse` reverses the DOM order, and
        * `.mavatar-footer-right { align-self: flex-end }` is what keeps the gear on the
        * right edge of the 52px rail. Both heights measured on the live app (expanded
        * host 276x48; collapsed clone at 52px rail => 92, gear at y=8, avatar at y=48).
        *
        * IMPORTANT — this row does NOT animate. Probe 20 walked all 883 nodes under
        * `sidenav-mavatar-footer` / `mat-action-list.desktop-controls` and found zero
        * with a non-zero transition-duration, zero with a CSS animation, and zero with
        * an Angular `ng-trigger-*` attribute. The layout swaps instantly and only the
        * rail's own 300ms width carries the motion. Our previous version animated
        * `right`, `top` and `max-width` on this subtree, which is precisely the
        * "behaves weirdly different while collapsing and expanding" that was reported.
        */}
      <div
        className="relative mt-auto flex shrink-0 select-none px-1.5 py-1"
        style={{
          height: isCollapsed ? '92px' : '48px',
          flexDirection: isCollapsed ? 'column-reverse' : 'row',
          alignItems: isCollapsed ? 'flex-start' : 'center',
          justifyContent: isCollapsed ? 'flex-start' : 'space-between',
          gap: isCollapsed ? '4px' : '0px',
        }}
      >
        <div className="flex h-10 min-w-0 items-center">
          {/*
           * Three states, not two. `loading` is true until Firebase has both
           * restored the session AND fetched the Firestore profile, so without
           * this branch the footer rendered "Sign In", then an email-initial
           * disc, then the real photo and name — the identity visibly changing
           * twice on every refresh.
           *
           * The placeholder is EMPTY ON PURPOSE — no shimmer, no grey discs.
           * The rest of the sidebar fills in element by element against the bare
           * surface, and a pulsing account row would be the one thing on the
           * rail drawing attention to itself while everything else quietly
           * arrives. It still reserves the exact 40px row height, so the real
           * avatar and name land without shifting anything.
           */}
          {isAuthLoading ? (
            <div className="flex h-10 min-w-0 items-center pl-[5px] pr-1.5" aria-hidden="true" />
          ) : user ? (
            <div className="relative flex h-10 min-w-0 items-center">
              <UserMenu
                isOpen={isUserMenuOpen}
                isCollapsed={isCollapsed}
                onClose={() => setIsUserMenuOpen(false)}
                onSettingsClick={onSettingsClick}
                backgroundType={backgroundType}
              />
              {/*
               * `.mavatar-footer-left { padding-inline: 5px 6px; gap: 8px }` — and it
               * is an <a>, with NO state layer. Probe 17 forced :hover on it and
               * re-read all seven descendants: not one changed background, ::before or
               * opacity. Gemini's account row simply does not highlight, so ours
               * doesn't either. (The gear does — see below.)
               */}
              <button
                type="button"
                aria-label="Open account menu"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={handleUserMenuToggle}
                className="group/profile relative flex h-10 min-w-0 items-center gap-2 pl-[5px] pr-1.5 text-left"
              >
                {userProfile?.photoURL ? (
                  <img
                    src={userProfile.photoURL}
                    alt="User"
                    className={`willow-profile-reveal h-[30px] w-[30px] shrink-0 rounded-full object-cover transition-transform active:scale-90 ${isUserMenuOpen ? 'scale-105' : ''}`}
                  />
                ) : (
                  <span className={`willow-profile-reveal flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1e3a29] via-[#4a7c59] to-[#8fb896] text-[12px] font-medium text-white transition-transform active:scale-90 ${isUserMenuOpen ? 'scale-105' : ''}`}>
                    {userProfile?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || '?'}
                  </span>
                )}
                {/*
                 * `display: none` when collapsed, not a width/opacity fade — measured
                 * as such, and it is why the collapsed rail reflows in one step.
                 * 15px/400/20px `--lumi-sys-color--on-surface`, measured at 66.31x20.
                 *
                 * DELIBERATELY NOT COPIED: Gemini nests this name in a
                 * `.mavatar-user-info` column (66.31x37) with a second line under it,
                 * `.mavatar-tier-label` — "Pro", 20.39x17, 13px/400/17px,
                 * rgba(255,255,255,0.55), at relY 25.5 sharing the name's left edge.
                 * That is a SUBSCRIPTION tier, and Willow has none: `UserProfile`
                 * carries no such field, and `features/chat/src/chat-model.ts` already
                 * drops tiers on purpose because Willow runs on the user's own API keys.
                 * Rendering "Pro" here would invent a subscription rather than extract
                 * a style, so the slot stays empty.
                 *
                 * The geometry is unaffected, which is why this is safe: the column's
                 * combined centre sits at y=24 and so does this single line (Gemini's
                 * name centres at 15.5 only because it is the top line of two). Avatar
                 * and name left edges match Gemini exactly at x=11 and x=49. If a tier
                 * ever exists, the numbers above are the measurement to build it from.
                 */}
                {!isCollapsed && (
                  <span className="willow-profile-reveal min-w-0 max-w-[180px] overflow-hidden truncate text-left text-[15px] font-normal leading-5 text-[#e6e6e6]">
                    {userProfile?.displayName || user?.email || 'Account'}
                  </span>
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="flex h-10 min-w-0 items-center gap-2 pl-[5px] pr-1.5 text-left text-white/80"
              title="Sign In"
            >
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-white/10"><LogIn size={18} /></span>
              {!isCollapsed && (
                <span className="min-w-0 max-w-[180px] overflow-hidden truncate text-[15px] font-normal leading-5">
                  Sign In
                </span>
              )}
            </button>
          )}
        </div>

        {/*
         * `.mavatar-footer-right { margin: 4px; align-self: flex-end; gap: 12px }`.
         * `align-self: flex-end` is doing the work in both states: expanded it is a
         * no-op on the cross axis, collapsed (column-reverse) it pins the gear to the
         * rail's right edge. Measured collapsed: 32x32 at (16,8) in a 52px rail.
         */}
        <div className="m-1 flex shrink-0 items-center gap-3 self-end">
          <button
            type="button"
            aria-label="Settings"
            title="Settings"
            /*
             * `.mavatar-settings-button { height: 32px; width: 32px; color:
             * var(--lumi-sys-color--on-surface) }` — a 32px host. Inside it Material
             * renders a 36px <button> (`--mat-icon-button-state-layer-size: 36px`,
             * padding 6px) whose state layer is NOT on the button: probe 17 found it
             * on the `.mat-mdc-button-persistent-ripple::before` child, at
             * `rgb(196,199,197)` / opacity 0 -> 0.08 on hover, radius 9999px, inset 0.
             * That is why the earlier probe of the button itself read "no hover".
             * Reproduced here as an inset-0 ::before-equivalent span so the 36px layer
             * overflows the 32px host exactly as Gemini's does.
             *
             * Pane placement measured on this same button: "top: 777.6px; left: 278px;
             * transform: translateX(8px)" against an anchor at (246, 777.6, 32) —
             * left == anchor.right and top == anchor.top, i.e. right, not below.
             */
            data-tooltip-position="right"
            onClick={() => { setIsSettingsMenuOpen((open) => !open); setIsUserMenuOpen(false); }}
            className="group/settings relative flex h-8 w-8 items-center justify-center text-[#e6e6e6]"
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute -inset-0.5 rounded-full bg-[rgb(196,199,197)] transition-opacity duration-150 group-hover/settings:opacity-[0.08] ${
                isSettingsMenuOpen ? 'opacity-[0.08]' : 'opacity-0'
              }`}
            />
            <SidebarGlyph name="settings" className="relative h-5 w-5 text-[20px] leading-5" />
          </button>
        </div>

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
        /*
         * Measured Gemini pane: 179.26x196 at the trigger's bottom-left with ZERO
         * gap, bg rgb(31,31,31), radius 20px, padding 8px, shadow
         * `rgba(0,0,0,0.28) 0 0 20px 0`, no border, min-width 150, max-width 280.
         *
         * The 179.26 is content-derived, NOT authored: the widest row is "Share
         * conversation" at labelDx 40 + labelW 115.26 + 8 right padding = 163.26,
         * plus 2x8 panel padding. So this shrink-wraps between the measured
         * min/max rather than pinning a width.
         *
         * transform-origin measured `0px 0px` opening down and `0px 196px`
         * opening up — i.e. the corner nearest the trigger.
         */
        <div
          className={`fixed z-[9999] box-border min-w-[150px] max-w-[280px] rounded-[20px] bg-[#1f1f1f] p-2 shadow-[0_0_20px_rgba(0,0,0,0.28)] ${
            menuPosition.isAbove ? 'origin-bottom-left' : 'origin-top-left'
          } ${isMenuClosing ? 'willow-mat-menu-exit' : 'willow-mat-menu-enter'}`}
          style={{
            ...(menuPosition.top !== undefined ? { top: `${menuPosition.top}px` } : {}),
            ...(menuPosition.bottom !== undefined ? { bottom: `${menuPosition.bottom}px` } : {}),
            left: `${menuPosition.left}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                triggerCloseMenu();
                alert("Sharing conversation link: " + window.location.origin + "/chat/" + menuActiveChat);
              }}
              className={GEMINI_MENU_ITEM_CLASS}
            >
              <MaterialSymbol name="share_2" family="luminous" size={20} weight={320} roundness={100} opticalSize={20} className="!w-6 shrink-0" />
              <span className={GEMINI_MENU_LABEL_CLASS}>Share conversation</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                togglePinChat(menuActiveChat);
                triggerCloseMenu();
              }}
              className={GEMINI_MENU_ITEM_CLASS}
            >
              {/* Measured `data-mat-icon-name`: `push_pin` when the chat is
                  unpinned, `unpin` when it is pinned. The label flips with it. */}
              <MaterialSymbol
                name={pinnedChats.includes(menuActiveChat) ? 'unpin' : 'push_pin'}
                family="luminous"
                size={20}
                weight={320}
                roundness={100}
                opticalSize={20}
                className="!w-6 shrink-0"
              />
              <span className={GEMINI_MENU_LABEL_CLASS}>{pinnedChats.includes(menuActiveChat) ? 'Unpin' : 'Pin'}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                openRenameDialog(menuActiveChat);
                triggerCloseMenu();
              }}
              className={GEMINI_MENU_ITEM_CLASS}
            >
              <MaterialSymbol name="edit" family="luminous" size={20} weight={320} roundness={100} opticalSize={20} className="!w-6 shrink-0" />
              <span className={GEMINI_MENU_LABEL_CLASS}>Rename</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                triggerCloseMenu();
                alert(`Added "${menuActiveChat}" to Notebook.`);
              }}
              className={GEMINI_MENU_ITEM_CLASS}
            >
              <MaterialSymbol name="notebook" family="luminous" size={20} weight={320} roundness={100} opticalSize={20} className="!w-6 shrink-0" />
              <span className={GEMINI_MENU_LABEL_CLASS}>Add to notebook</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const chatToDelete = menuActiveChat;
                triggerCloseMenu();
                handleDeleteChat(chatToDelete);
              }}
              className={GEMINI_MENU_ITEM_CLASS}
            >
              <MaterialSymbol name="delete" family="luminous" size={20} weight={320} roundness={100} opticalSize={20} className="!w-6 shrink-0" />
              <span className={GEMINI_MENU_LABEL_CLASS}>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/*
        * "Rename this chat", measured at 512 wide / 213 tall.
        *
        * The 24px gap above the field is Gemini's own: its inner `.dialog-content`
        * carries `padding: 24px 0 0` INSIDE the already-16px-padded dialog content
        * block, which is why the field sits at dy 89 rather than 65.
        *
        * The Rename pill is disabled at open (measured
        * `color(srgb 0.901961 ... / 0.12)` on a fresh dialog) and enables once the
        * value differs from the current name. An emptied field keeps it disabled.
        */}
      {shouldRenderRename && (
        <GeminiDialog
          headingAs="h2"
          title="Rename this chat"
          width={512}
          closing={isRenameClosing}
          onDismiss={triggerCloseRename}
          actions={
            <>
              <GeminiDialogPill onClick={triggerCloseRename}>Cancel</GeminiDialogPill>
              <GeminiDialogPill
                disabled={!editValue.trim() || editValue === editingChatId}
                onClick={commitRename}
              >
                Rename
              </GeminiDialogPill>
            </>
          }
        >
          <div style={{ paddingTop: 24 }}>
            <GeminiOutlinedField
              value={editValue}
              onChange={setEditValue}
              ariaLabel="Chat name"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && editValue.trim() && editValue !== editingChatId) commitRename();
              }}
            />
          </div>
        </GeminiDialog>
      )}

      {/*
        * "Delete chat?", measured at 600 wide. Same chrome as Rename — the only
        * structural difference is that the title is an H1 and the body has no
        * inner top padding, so the paragraph starts at dy 65 flush under the
        * content block's own 16px.
        *
        * Both pills are `rgb(23, 23, 23)` and both are ENABLED: Gemini does not
        * tint the destructive action red, and Delete is not gated behind anything.
        *
        * Gemini's body reads "...from your Gemini Apps Activity, plus any content
        * you created." with a "Learn more" link to
        * support.google.com/gemini?p=deleted_chats. Willow deletes one local chat
        * file and has no activity store and no support page, so the sentence names
        * what is actually deleted and the link is dropped rather than pointed at
        * Google's docs. Length is kept so the paragraph still wraps to the
        * measured two lines at 540px; the dialog height is content-derived, not
        * authored, so it settles ~20px shorter without the link line.
        */}
      {shouldRenderDelete && (
        <GeminiDialog
          headingAs="h1"
          title="Delete chat?"
          width={600}
          closing={isDeleteClosing}
          onDismiss={triggerCloseDelete}
          actions={
            <>
              <GeminiDialogPill onClick={triggerCloseDelete}>Cancel</GeminiDialogPill>
              <GeminiDialogPill onClick={() => { void confirmDeleteChat(); }}>Delete</GeminiDialogPill>
            </>
          }
        >
          <p>
            This will delete the prompts, responses, and attachments in this chat from this
            device, plus any content you created in it.
          </p>
        </GeminiDialog>
      )}
    </aside>
  );
};
