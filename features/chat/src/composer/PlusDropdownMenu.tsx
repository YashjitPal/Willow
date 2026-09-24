import React, { useEffect, useLayoutEffect, useRef, useState, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { useThemeMode } from '@willow/core/theme-mode';
import { TOOL_SYMBOLS, TOOL_TOOLTIPS, type ToolId } from './composer-options';
import {
  CodexGoalIcon,
  CodexPetIcon,
  CodexPlanIcon,
  CodexSideChatIcon,
} from './composer-icons';

const PlusMenuThemeContext = createContext<{ isLight: boolean }>({ isLight: false });
const usePlusMenuTheme = () => useContext(PlusMenuThemeContext);

/**
 * Gemini's plus menu, transcribed rather than designed.
 *
 * Every value below was read off the running gemini.google.com over CDP — the panel, the
 * rows, both submenus, the enter animation and the Personal Intelligence switch. The
 * authored CSS and the live computed styles agree on all of it, so nothing here is a
 * design choice and "tidying" a number will break the match.
 *
 * THE PANEL. `mat-card.card-container.lm-menu-theme`, measured 249x320.8 with the root
 * menu's eight rows. Surface `--lumi-sys-color--surface-bright` = #1f1f1f, radius
 * `--gem-sys-shape--corner-large-increased` = 20px, padding `--gem-sys-spacing--s` = 8px,
 * shadow `0 0 20px rgba(0,0,0,0.28)` (elevation level 1). Submenu cards are the same
 * surface at different widths: More uploads 220px, More tools 253px.
 *
 * THE ROWS, from the authored rule:
 *
 *   .mat-mdc-list-item.lm-menu-item-theme {
 *     padding: 0 var(--gem-sys-spacing--s); gap: 0;
 *     min-height: 36px; border-radius: var(--gem-sys-shape--corner-medium); }
 *
 * i.e. 36px tall, 8px inline padding, 12px corners. Hover is an MDC state layer measured
 * at `rgba(230,230,230,0.08)` with `transition: all 0s` — Gemini SNAPS it in, so a fade
 * here would be wrong. Pressed is `rgba(230,230,230,0.12)`; a selected tool row is
 * `--lumi-sys-color--surface-dim` = #171717.
 *
 * THE ICON COLUMN. Each glyph sits in a 24x24 box at 8px from the row's left edge, with
 * the glyph itself rendered at 20px. The label then starts at 40px on the uploader rows
 * but 44px on the tool rows — a real 4px difference between Gemini's two row templates,
 * measured on every row of each, not an artefact.
 *
 * TWO ICON FONTS, and they are not interchangeable. Luminous Symbols carries
 * attach_file / image_create / movie / music / canvas / deep_research / guided_learning /
 * chevron_right at `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320`; Google Symbols
 * carries drive (`"wght" 330`) and more_horiz (no variation settings).
 *
 * THE ENTER ANIMATION, from the authored keyframes:
 *
 *   @keyframes expand-in { 0% { opacity:.25; transform:scale(.5) } to { opacity:1; transform:scale(1) } }
 *   .card-container { animation: expand-in .1s ease-in-out }
 *
 * Note it starts at HALF SCALE and QUARTER opacity, not from zero — that is why it reads
 * as a quick pop rather than a fade. The same animation plays on both submenus. Transform
 * origin differs: the root menu computes `0 <height>` (bottom-left) because it opens
 * upward, while both submenus compute `0 0` (top-left).
 *
 * There is no leave animation. The panes are removed outright, consistent with everything
 * else in Gemini's composer computing `transition: all 0s`.
 */

/** Measured surface tokens. */
const SURFACE = '#1f1f1f';
const ON_SURFACE = '#e6e6e6';
const HOVER_LAYER = 'rgba(230,230,230,0.08)';
const DIVIDER = 'rgba(255,255,255,0.12)';
const MENU_SHADOW = '0 0 20px rgba(0,0,0,0.28)';

/** 13px/17px Google Sans Flex at `"wdth" 92`, colour #e6e6e6. */
const LABEL_CLASS =
  "text-[13px] leading-[17px] font-normal text-[#e6e6e6] font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]";
const LABEL_STYLE: React.CSSProperties = {
  fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
};

type IconFamily = 'luminous' | 'google-symbols';

/** A glyph in Gemini's 24x24 icon box, rendered at 20px. */
const Glyph: React.FC<{ name: string; family?: IconFamily; className?: string }> = ({
  name,
  family = 'luminous',
  className = '',
}) => {
  const { isLight } = usePlusMenuTheme();
  return (
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${className}`}>
      <MaterialSymbol
        name={name}
        family={family}
        size={20}
        weight={family === 'luminous' ? 320 : 330}
        variationSettings={
          family === 'luminous'
            ? '"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320'
            : name === 'more_horiz'
              ? undefined
              : '"wght" 330'
        }
        className={isLight ? 'text-[#000000]' : 'text-[#e6e6e6]'}
      />
    </span>
  );
};

/**
 * Gemini's Personal Intelligence icon, which is NOT a font ligature.
 *
 * Every other glyph in this menu is a `mat-icon` whose text is the icon name. This one is
 * a masked span, captured verbatim off the live row:
 *
 *   <span class="icon lm-icon-m gem-menu-item-icon"
 *         style="mask-image: url(https://fonts.gstatic.com/render/v1/Luminous+Symbols/28px/
 *                personal_recommendations.svg?var=opsz,wght@28,260)">
 *
 * with `mask-size: contain` and `background-color: #e6e6e6` — the mask cuts the shape out
 * of a solid fill. Note the real name is **personal_recommendations**, not
 * `personal_intelligence`: this file previously guessed the latter from the label, and it
 * rendered as nothing because no such ligature exists. That is why it must be a mask here
 * rather than a `MaterialSymbol` — the SVG is a separate asset from the variable font, and
 * the font has no glyph for it.
 *
 * `wght@28,260` in the URL is Gemini's own request (260, lighter than the 320 its font
 * glyphs use); the rendered box is 20x20 from a 28px source.
 */
const PERSONAL_RECOMMENDATIONS_MASK =
  'url("https://fonts.gstatic.com/render/v1/Luminous+Symbols/28px/personal_recommendations.svg?var=opsz,wght@28,260")';

const PersonalRecommendationsGlyph: React.FC = () => {
  const { isLight } = usePlusMenuTheme();
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center">
      <span
        aria-hidden="true"
        className="block h-5 w-5 shrink-0"
        style={{
          backgroundColor: isLight ? '#000000' : ON_SURFACE,
          maskImage: PERSONAL_RECOMMENDATIONS_MASK,
          WebkitMaskImage: PERSONAL_RECOMMENDATIONS_MASK,
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
        }}
      />
    </span>
  );
};

/**
 * One 36px row. `labelInset` is the label's distance from the row's left edge: 40 on the
 * uploader rows, 44 on the tool rows. Both measured.
 */
const Row: React.FC<{
  glyph?: string;
  family?: IconFamily;
  icon?: React.ReactNode;
  label: string;
  labelInset?: 40 | 44;
  /**
   * Tooltip text, and only the TOOL rows have one — see `TOOL_TOOLTIPS`.
   *
   * Passed as `title`, which is Willow's app-wide opt-in: `GlobalTooltips` swaps every
   * `title=` for Gemini's tooltip component. See platform/ui/AGENTS.md.
   *
   * Placement is `right`, set per-row rather than by changing the global default, which is
   * `below` and correct everywhere else in the app. Gemini's own panes for these rows are
   * `cdk-overlay-pane mat-mdc-tooltip-panel-right` — CDK's flexible strategy picks the
   * right edge because a menu row is wide and short, and `below` would land the bubble on
   * the next row down.
   */
  tooltip?: string;
  trailingChevron?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  ariaHasPopup?: boolean;
  expanded?: boolean;
}> = ({
  glyph,
  family,
  icon,
  label,
  labelInset = 40,
  tooltip,
  trailingChevron,
  selected,
  onClick,
  onMouseEnter,
  ariaHasPopup,
  expanded,
}) => {
  const { isLight } = usePlusMenuTheme();
  return (
    <button
      type="button"
      role={ariaHasPopup ? undefined : 'menuitem'}
      aria-haspopup={ariaHasPopup ? 'menu' : undefined}
      aria-expanded={ariaHasPopup ? !!expanded : undefined}
      title={tooltip}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      data-tooltip-position="right"
      className="group/row relative flex h-9 w-full items-center rounded-xl px-2 text-left"
      style={selected ? { backgroundColor: isLight ? '#f2f0f0' : '#171717' } : undefined}
    >
      {/* The hover state layer. Separate node so it can snap in with no transition, which
          is what Gemini does — the row's own background stays the panel surface. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-xl opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
        style={{ backgroundColor: isLight ? 'rgba(0, 0, 0, 0.08)' : HOVER_LAYER }}
      />
      {icon ?? (glyph ? <Glyph name={glyph} family={family} /> : null)}
      <span
        className={`relative ${LABEL_CLASS} ${isLight ? '!text-[#1f1f1f]' : ''} whitespace-nowrap`}
        style={{ ...LABEL_STYLE, marginLeft: labelInset - 32 }}
      >
        {label}
      </span>
      {trailingChevron && (
        <span className="relative ml-auto">
          <Glyph name="chevron_right" family="luminous" />
        </span>
      )}
    </button>
  );
};

/** The card every menu and submenu is drawn on. */
const MenuCard: React.FC<{
  width: number;
  origin: string;
  className?: string;
  style?: React.CSSProperties;
  label: string;
  children: React.ReactNode;
}> = ({ width, origin, className = '', style, label, children }) => {
  const { isLight } = usePlusMenuTheme();
  return (
    <div
      role="menu"
      aria-label={label}
      className={`willow-gem-menu-in overflow-auto ${className}`}
      style={{
        width,
        backgroundColor: isLight ? '#ffffff' : SURFACE,
        borderRadius: 20,
        padding: 8,
        boxShadow: isLight ? '0 0 20px rgba(0,0,0,0.04)' : MENU_SHADOW,
        transformOrigin: origin,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** 0.8px at `--lumi-sys-color--on-surface-low`, inset 8px, `margin-block: 8px`. */
const Divider: React.FC = () => {
  const { isLight } = usePlusMenuTheme();
  return (
    <div
      role="separator"
      className="mx-2 my-2"
      style={{ height: 0, borderTop: `0.8px solid ${isLight ? 'rgba(0, 0, 0, 0.08)' : DIVIDER}` }}
    />
  );
};

/**
 * Gemini's Avatar icon (likeness), captured from live SVG on Gemini.
 */
const LikenessAvatarIcon: React.FC<{ size?: number; className?: string }> = ({ size = 26, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 28 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M14,24.5C8.201,24.5 3.5,19.799 3.5,14C3.5,8.201 8.201,3.5 14,3.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <circle cx="17.281" cy="11.666" r="1" fill="currentColor" />
    <circle cx="19.25" cy="4.907" r="1" fill="currentColor" />
    <circle cx="23.093" cy="8.751" r="1" fill="currentColor" />
    <circle cx="24.499" cy="14" r="1" fill="currentColor" />
    <circle cx="23.092" cy="19.249" r="1" fill="currentColor" />
    <circle cx="19.249" cy="23.091" r="1" fill="currentColor" />
    <circle cx="10.719" cy="11.666" r="1" fill="currentColor" />
    <path
      d="M17.5,16.916C15.469,18.472 12.531,18.472 10.5,16.916"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Gemini's square squircle upload button used in compact tablet card & mobile bottom sheet.
 */
/**
 * Gemini's square squircle upload button used in compact tablet card & mobile bottom sheet.
 * Measured off live Gemini over CDP:
 *   width: 95.575px (~96px), height: 95.575px, min-width: 95.575px
 *   border-radius: 40px
 *   background-color: rgb(20, 20, 20) in dark theme, #f2f2f2 in light theme
 *   gap: 4px between buttons, row horizontal padding: 0 16px (px-4)
 *   label: 14px "Google Sans Flex", multiline wrapping (e.g. "Google Photos" on 2 lines)
 */
const SquircleUploadButton: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}> = ({ label, icon, onClick }) => {
  const { isLight } = usePlusMenuTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex min-w-[95.6px] w-[95.6px] h-[95.6px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[40px] transition-all outline-none select-none ${
        isLight
          ? 'bg-[#f2f2f2] hover:bg-[#e8e8e8] text-[#1f1f1f] active:scale-[0.96]'
          : 'bg-[#141414] hover:bg-[#252525] text-[#e6e6e6] active:scale-[0.96]'
      }`}
    >
      <span className="flex h-8 w-8 items-center justify-center text-current">
        {icon}
      </span>
      <span
        className="text-[13px] sm:text-[14px] font-normal leading-[16px] text-center px-1.5 line-clamp-2 max-w-[84px]"
        style={{
          fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
          fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
          color: isLight ? '#1f1f1f' : '#e0e0e0',
        }}
      >
        {label}
      </span>
    </button>
  );
};

/**
 * Gemini's compact tool row for reduced-width / tablet card and mobile bottom sheet.
 * Measured live on Gemini:
 *   height: 64px, min-height: 48px, padding: 12px 8px
 *   border-radius: 16px
 *   font-size: 16px, line-height: 24px, color: #e3e3e3
 *   icon: 28px in 40x40 container
 */
const CompactToolRow: React.FC<{
  glyph?: string;
  family?: IconFamily;
  icon?: React.ReactNode;
  label: string;
  tooltip?: string;
  selected?: boolean;
  onClick?: () => void;
}> = ({ glyph, family, icon, label, tooltip, selected, onClick }) => {
  const { isLight } = usePlusMenuTheme();
  return (
    <button
      type="button"
      role="menuitem"
      title={tooltip}
      onClick={onClick}
      className="group/row relative flex h-16 w-full items-center rounded-2xl px-2 text-left transition-colors outline-none"
      style={selected ? { backgroundColor: isLight ? '#f2f0f0' : '#171717' } : undefined}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
        style={{ backgroundColor: isLight ? 'rgba(0, 0, 0, 0.06)' : HOVER_LAYER }}
      />
      <span className="flex h-10 w-10 shrink-0 items-center justify-center">
        {icon ?? (
          glyph ? (
            <MaterialSymbol
              name={glyph}
              family={family ?? 'luminous'}
              size={28}
              weight={family === 'google-symbols' ? 330 : 320}
              variationSettings={
                family === 'google-symbols'
                  ? undefined
                  : '"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 28, "wght" 320'
              }
              className={isLight ? 'text-[#1f1f1f]' : 'text-[#e0e0e0]'}
            />
          ) : null
        )}
      </span>
      <span
        className={`relative ml-2 text-[16px] leading-6 font-normal ${
          isLight ? 'text-[#1f1f1f]' : 'text-[#e3e3e3]'
        } font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]`}
        style={{
          fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
        }}
      >
        {label}
      </span>
    </button>
  );
};

const CompactPersonalIntelligenceRow: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
}> = ({ checked, onChange }) => {
  const { isLight } = usePlusMenuTheme();
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group/row relative flex h-16 w-full items-center rounded-2xl px-2 text-left transition-colors outline-none"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
        style={{ backgroundColor: isLight ? 'rgba(0, 0, 0, 0.06)' : HOVER_LAYER }}
      />
      <span className="flex h-10 w-10 shrink-0 items-center justify-center">
        <span
          aria-hidden="true"
          className="block h-7 w-7 shrink-0"
          style={{
            backgroundColor: isLight ? '#1f1f1f' : '#e0e0e0',
            maskImage: PERSONAL_RECOMMENDATIONS_MASK,
            WebkitMaskImage: PERSONAL_RECOMMENDATIONS_MASK,
            maskSize: 'contain',
            WebkitMaskSize: 'contain',
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
            maskPosition: 'center',
            WebkitMaskPosition: 'center',
          }}
        />
      </span>
      <span className="relative ml-2 flex flex-col">
        <span
          className={`text-[16px] leading-tight font-normal ${
            isLight ? 'text-[#1f1f1f]' : 'text-[#e3e3e3]'
          } font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]`}
          style={{
            fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
          }}
        >
          Personal Intelligence
        </span>
        <span
          className="text-[13px] leading-tight font-normal font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]"
          style={{
            fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
            color: isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)',
          }}
        >
          Labs
        </span>
      </span>
      <span className="relative ml-auto" aria-hidden="true">
        <GeminiSwitch checked={checked} />
      </span>
    </button>
  );
};

type DeviceMode = 'desktop' | 'compact' | 'mobile';

function useDeviceMode(): DeviceMode {
  const [deviceMode, setDeviceMode] = useState<DeviceMode>(() => {
    if (typeof window === 'undefined') return 'desktop';
    const width = window.innerWidth;
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const hasForceMobile = typeof window !== 'undefined' && (
      window.location.search.includes('mode=mobile') ||
      window.location.search.includes('view=mobile')
    );
    const isTouch = isCoarse || isMobileUA || hasForceMobile;
    if (isTouch && width <= 960) return 'mobile';
    if (width <= 960) return 'compact';
    return 'desktop';
  });

  useEffect(() => {
    const compute = () => {
      const width = window.innerWidth;
      const isCoarse = window.matchMedia('(pointer: coarse)').matches;
      const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const hasForceMobile = typeof window !== 'undefined' && (
        window.location.search.includes('mode=mobile') ||
        window.location.search.includes('view=mobile')
      );
      const isTouch = isCoarse || isMobileUA || hasForceMobile;
      if (isTouch && width <= 960) {
        setDeviceMode('mobile');
      } else if (width <= 960) {
        setDeviceMode('compact');
      } else {
        setDeviceMode('desktop');
      }
    };

    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  return deviceMode;
}

export const PlusDropdownMenu: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onFileSelect: () => void;
  onImportCode?: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
  onToolSelect: (toolId: string) => void;
  selectedTool?: ToolId | null;
  geminiStyle?: boolean;
  /** Spark uses Gemini's upload menu plus its opt-in agent-mode catalog; normal Chat keeps the full tool set. */
  sparkMode?: boolean;
  /** Adds Spark's optional agent-mode catalog. Leave false to retain upload-only Spark. */
  sparkToolsEnabled?: boolean;
  /**
   * Gemini's full upload set. Every row renders whether or not Willow can serve it yet,
   * because the menu is a clone of Gemini's and a missing row is a visible difference.
   * A row with no handler closes the menu and does nothing else; wiring one is a single
   * prop. Currently only Upload files and Import code are backed.
   */
  onAddFromDrive?: () => void;
  onAddPhotos?: () => void;
  onAddAvatar?: () => void;
  onAddNotebook?: () => void;
  personalIntelligence?: boolean;
  onTogglePersonalIntelligence?: (next: boolean) => void;
}> = ({
  isOpen,
  onClose,
  onFileSelect,
  onImportCode,
  buttonRef,
  onToolSelect,
  selectedTool,
  onAddFromDrive,
  onAddPhotos,
  onAddAvatar,
  onAddNotebook,
  personalIntelligence = false,
  onTogglePersonalIntelligence,
  sparkMode = false,
  sparkToolsEnabled = false,
}) => {
  const { isLight } = useThemeMode();
  const [openSub, setOpenSub] = useState<null | 'uploads' | 'tools'>(null);
  // Vertical offset of whichever row opened the submenu, measured from the positioning
  // wrapper. The submenus render as SIBLINGS of the card rather than inside it — see the
  // note on the wrapper below — so they need the row's position passed to them.
  const [subTop, setSubTop] = useState(0);
  const [side, setSide] = useState<'bottom' | 'top'>('bottom');
  const [isSubPositionReady, setIsSubPositionReady] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const uploadsRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deviceMode = useDeviceMode();
  const [cardLeftOffset, setCardLeftOffset] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const currentY = e.touches[0].clientY;
    const delta = currentY - startYRef.current;
    if (delta > 0) {
      setDragOffset(delta);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (dragOffset > 75) {
      onClose();
    }
    setDragOffset(0);
  };

  useLayoutEffect(() => {
    if (!isOpen || deviceMode !== 'compact') return;
    const btn = buttonRef.current;
    if (!btn) return;
    const btnRect = btn.getBoundingClientRect();
    const composerBox = btn.closest('.willow-gemini-composer') || btn.closest('.relative.w-full') || btn.parentElement;
    const composerLeft = composerBox ? composerBox.getBoundingClientRect().left : btnRect.left;
    const cardWidth = Math.min(375, typeof window !== 'undefined' ? window.innerWidth - 32 : 375);

    let targetOffset = composerLeft - btnRect.left;
    const screenRight = btnRect.left + targetOffset + cardWidth;
    const maxScreenRight = window.innerWidth - 16;
    if (screenRight > maxScreenRight) {
      targetOffset -= (screenRight - maxScreenRight);
    }
    const screenLeft = btnRect.left + targetOffset;
    if (screenLeft < 16) {
      targetOffset += (16 - screenLeft);
    }
    setCardLeftOffset(targetOffset);
  }, [isOpen, deviceMode, buttonRef]);

  useEffect(() => {
    if (!isOpen) {
      setOpenSub(null);
      setIsSubPositionReady(false);
      setDragOffset(0);
      setIsDragging(false);
    }
  }, [isOpen]);

  // Calculatively clamp submenu to viewport bounds so it never overflows off-screen vertically.
  useLayoutEffect(() => {
    if (!openSub) {
      setIsSubPositionReady(false);
      return;
    }

    const clampSubmenu = () => {
      const subEl = submenuRef.current;
      const trigger = openSub === 'uploads' ? uploadsRef.current : toolsRef.current;
      if (!subEl || !trigger) return false;

      const subRect = subEl.getBoundingClientRect();
      const subHeight = subEl.offsetHeight;
      const VIEWPORT_MARGIN = 8;
      const subBottomInViewport = subRect.top + subHeight;
      const spaceBelow = window.innerHeight - subBottomInViewport;

      if (spaceBelow < VIEWPORT_MARGIN) {
        const overflowBottom = VIEWPORT_MARGIN - spaceBelow;
        const maxShift = Math.max(0, subRect.top - VIEWPORT_MARGIN);
        const shift = Math.min(overflowBottom, maxShift);
        if (shift > 0.5) {
          setSubTop((prev) => prev - shift);
          return true;
        }
      } else if (subRect.top < VIEWPORT_MARGIN) {
        const overflowTop = VIEWPORT_MARGIN - subRect.top;
        const maxShift = Math.max(0, spaceBelow - VIEWPORT_MARGIN);
        const shift = Math.min(overflowTop, maxShift);
        if (shift > 0.5) {
          setSubTop((prev) => prev + shift);
          return true;
        }
      }
      return false;
    };

    const checkReady = () => {
      const shifted = clampSubmenu();
      if (!shifted) {
        const isAnimating = menuRef.current?.getAnimations().some((a) => a.playState === 'running');
        if (!isAnimating) {
          setIsSubPositionReady(true);
        }
      }
    };

    const handleMenuAnimationEnd = (e: AnimationEvent) => {
      if (e.target !== menuRef.current) return;
      clampSubmenu();
      setIsSubPositionReady(true);
    };

    menuRef.current?.addEventListener('animationend', handleMenuAnimationEnd);
    window.addEventListener('resize', clampSubmenu);

    checkReady();

    const frameId = window.requestAnimationFrame(() => {
      checkReady();
      setIsSubPositionReady(true);
    });

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          clampSubmenu();
          setIsSubPositionReady(true);
        });
    if (submenuRef.current) observer?.observe(submenuRef.current);

    return () => {
      window.cancelAnimationFrame(frameId);
      menuRef.current?.removeEventListener('animationend', handleMenuAnimationEnd);
      window.removeEventListener('resize', clampSubmenu);
      observer?.disconnect();
    };
  }, [openSub, subTop]);

  // Flip above or below the trigger depending on room. Gemini's own menu opened upward
  // from a bottom-docked composer, which is why the measured transform-origin is
  // bottom-left; ours picks the origin to match whichever side it lands on.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const recompute = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 320;
      const spaceBelow = window.innerHeight - rect.bottom;
      setSide(spaceBelow < menuH + 8 && rect.top > spaceBelow ? 'top' : 'bottom');
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [isOpen, buttonRef]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (deviceMode === 'mobile') return;
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node)
        && buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose, buttonRef, deviceMode]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  if (!isOpen) return null;

  const openWith = (which: 'uploads' | 'tools') => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (openSub !== which) {
      setIsSubPositionReady(false);
    }
    const trigger = which === 'uploads' ? uploadsRef.current : toolsRef.current;
    // offsetParent is the positioning wrapper, so this is already in the coordinate
    // space the submenu is placed in.
    if (trigger) setSubTop(trigger.offsetTop);
    setOpenSub(which);
  };
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpenSub(null);
      setIsSubPositionReady(false);
    }, 150);
  };

  const pickTool = (id: ToolId) => { onToolSelect(id); onClose(); };
  const act = (fn?: () => void) => () => { fn?.(); onClose(); };

  /**
   * Submenu placement. Measured: the submenu card's CONTENT edge lands exactly on the
   * parent card's content edge — parent card right 851, submenu card x 843, and 843 + its
   * own 8px padding = 851. So the card is offset -8px, not flush, which is why `left` is
   * the parent width less 8 and `top` is the row's offset less 8.
   *
   * The vertical anchor is CDK's flexible strategy picking whatever fits the viewport;
   * ours top-aligns to the row, which matches in the common case without pretending to
   * reproduce CDK's search.
   *
   * THE SUBMENUS MUST NOT LIVE INSIDE THE CARD. Gemini puts each one in its own
   * `cdk-overlay-pane` on the body, so the parent's `overflow: auto` never sees them.
   * Nesting them made the card clip the submenu and grow both scrollbars — the submenu
   * counted as overflow, so the card scrolled sideways and cut its own labels off. They
   * are siblings of the card here, positioned against the shared wrapper.
   */
  const subProps = {
    onMouseEnter: () => { if (closeTimer.current) clearTimeout(closeTimer.current); },
    onMouseLeave: closeSoon,
  };
  const SUB_LEFT = 249 - 8;

  const renderUploadButtonsRow = () => (
    <div className="flex items-center gap-1 overflow-x-auto px-4 py-1 no-scrollbar">
      <SquircleUploadButton
        label="Files"
        icon={<MaterialSymbol family="luminous" name="attach_file" size={28} weight={320} />}
        onClick={act(onFileSelect)}
      />
      <SquircleUploadButton
        label="Avatar"
        icon={<LikenessAvatarIcon size={28} />}
        onClick={act(onAddAvatar)}
      />
      <SquircleUploadButton
        label="Drive"
        icon={<MaterialSymbol family="google-symbols" name="drive" size={28} weight={330} />}
        onClick={act(onAddFromDrive)}
      />
      <SquircleUploadButton
        label="Google Photos"
        icon={<MaterialSymbol family="google-symbols" name="photos" size={28} weight={330} />}
        onClick={act(onAddPhotos)}
      />
      <SquircleUploadButton
        label="Notebooks"
        icon={<MaterialSymbol family="luminous" name="notebook" size={28} weight={320} />}
        onClick={act(onAddNotebook)}
      />
      <SquircleUploadButton
        label="Code"
        icon={<MaterialSymbol family="luminous" name="code" size={28} weight={320} />}
        onClick={act(onImportCode)}
      />
    </div>
  );

  const renderToolsList = () => {
    if (sparkMode && sparkToolsEnabled) {
      return (
        <div className="flex flex-col">
          <CompactToolRow
            icon={<span className={`flex h-10 w-10 shrink-0 items-center justify-center ${isLight ? 'text-[#1f1f1f]' : 'text-[#e0e0e0]'}`}><CodexPlanIcon size={24} strokeWidth={2} /></span>}
            label="Plan"
            selected={selectedTool === 'plan'}
            onClick={() => pickTool('plan')}
          />
          <CompactToolRow
            icon={<span className={`flex h-10 w-10 shrink-0 items-center justify-center ${isLight ? 'text-[#1f1f1f]' : 'text-[#e0e0e0]'}`}><CodexGoalIcon size={24} strokeWidth={2} /></span>}
            label="Goal"
            selected={selectedTool === 'goal'}
            onClick={() => pickTool('goal')}
          />
          <CompactToolRow
            glyph={TOOL_SYMBOLS['computer-use']}
            family="google-symbols"
            label="Computer Use"
            selected={selectedTool === 'computer-use'}
            onClick={() => pickTool('computer-use')}
          />
          <CompactToolRow
            icon={<span className={`flex h-10 w-10 shrink-0 items-center justify-center ${isLight ? 'text-[#1f1f1f]' : 'text-[#e0e0e0]'}`}><CodexSideChatIcon size={24} strokeWidth={2} /></span>}
            label="Side chat"
            onClick={onClose}
          />
          <CompactToolRow
            glyph={TOOL_SYMBOLS['create-skill']}
            family="google-symbols"
            label="Create skill"
            selected={selectedTool === 'create-skill'}
            onClick={() => pickTool('create-skill')}
          />
          <CompactToolRow
            icon={<span className={`flex h-10 w-10 shrink-0 items-center justify-center ${isLight ? 'text-[#1f1f1f]' : 'text-[#e0e0e0]'}`}><CodexPetIcon size={24} strokeWidth={2} /></span>}
            label="Create pet"
            selected={selectedTool === 'create-pet'}
            onClick={() => pickTool('create-pet')}
          />
          {onTogglePersonalIntelligence && (
            <CompactPersonalIntelligenceRow
              checked={personalIntelligence}
              onChange={onTogglePersonalIntelligence}
            />
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col">
        <CompactToolRow
          glyph={TOOL_SYMBOLS.images}
          label="Create image"
          tooltip={TOOL_TOOLTIPS.images}
          selected={selectedTool === 'images'}
          onClick={() => pickTool('images')}
        />
        <CompactToolRow
          glyph={TOOL_SYMBOLS.video}
          label="Create video"
          tooltip={TOOL_TOOLTIPS.video}
          selected={selectedTool === 'video'}
          onClick={() => pickTool('video')}
        />
        <CompactToolRow
          glyph={TOOL_SYMBOLS.music}
          label="Create music"
          tooltip={TOOL_TOOLTIPS.music}
          selected={selectedTool === 'music'}
          onClick={() => pickTool('music')}
        />
        <CompactToolRow
          glyph={TOOL_SYMBOLS.canvas}
          label="Canvas"
          tooltip={TOOL_TOOLTIPS.canvas}
          selected={selectedTool === 'canvas'}
          onClick={() => pickTool('canvas')}
        />
        <CompactToolRow
          glyph={TOOL_SYMBOLS.research}
          label="Deep research"
          tooltip={TOOL_TOOLTIPS.research}
          selected={selectedTool === 'research'}
          onClick={() => pickTool('research')}
        />
        <CompactToolRow
          glyph={TOOL_SYMBOLS.learn}
          label="Guided learning"
          tooltip={TOOL_TOOLTIPS.learn}
          selected={selectedTool === 'learn'}
          onClick={() => pickTool('learn')}
        />
        {onTogglePersonalIntelligence && (
          <CompactPersonalIntelligenceRow
            checked={personalIntelligence}
            onChange={onTogglePersonalIntelligence}
          />
        )}
      </div>
    );
  };

  if (deviceMode === 'mobile') {
    if (typeof document === 'undefined') return null;
    return createPortal(
      <PlusMenuThemeContext.Provider value={{ isLight }}>
        <div className="willow-bottom-sheet-overlay fixed inset-0 z-[1000] flex flex-col justify-end">
          {/* Dark backdrop */}
          <div
            className="fixed inset-0 backdrop-blur-[0.5px] willow-backdrop-fade-in"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.32)' }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Bottom sheet container */}
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Upload & tools"
            className="relative z-10 w-full flex flex-col willow-bottom-sheet-enter select-none"
            style={{
              backgroundColor: isLight ? '#ffffff' : '#1c1c1c',
              borderTopLeftRadius: 36,
              borderTopRightRadius: 36,
              boxShadow: '0 -8px 24px rgba(0, 0, 0, 0.24)',
              maxHeight: '82vh',
              transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
              transition: isDragging ? 'none' : 'transform 200ms cubic-bezier(0, 0, 0.2, 1)',
            }}
          >
            {/* Drag handle */}
            <div
              className="flex items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <div
                className="w-[54px] h-[5px] rounded-full"
                style={{
                  backgroundColor: isLight ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.55)',
                }}
              />
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-6 no-scrollbar">
              {renderUploadButtonsRow()}
              {renderToolsList()}
            </div>
          </div>
        </div>
      </PlusMenuThemeContext.Provider>,
      document.body
    );
  }

  if (deviceMode === 'compact') {
    return (
      <PlusMenuThemeContext.Provider value={{ isLight }}>
        <div
          ref={menuRef}
          className={`absolute z-[100] ${side === 'top' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'}`}
          style={{ left: cardLeftOffset }}
        >
          <div
            role="menu"
            aria-label="Upload and tools"
            className="willow-gem-menu-in overflow-y-auto no-scrollbar"
            style={{
              width: Math.min(375, typeof window !== 'undefined' ? window.innerWidth - 32 : 375),
              maxHeight: 360,
              backgroundColor: isLight ? '#ffffff' : '#1c1c1c',
              borderRadius: 20,
              padding: 8,
              boxShadow: isLight ? '0 0 20px rgba(0,0,0,0.06)' : MENU_SHADOW,
              transformOrigin: side === 'top' ? '0 100%' : '0 0',
            }}
          >
            {renderUploadButtonsRow()}
            {renderToolsList()}
          </div>
        </div>
      </PlusMenuThemeContext.Provider>
    );
  }

  return (
    <PlusMenuThemeContext.Provider value={{ isLight }}>
      <div
        ref={menuRef}
        className={`absolute left-0 z-[100] ${side === 'top' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'}`}
      >
        <MenuCard
          width={249}
          origin={side === 'top' ? '0 100%' : '0 0'}
          label="Upload and tools"
        >
          <Row glyph="attach_file" label="Upload files" onClick={act(onFileSelect)} onMouseEnter={() => setOpenSub(null)} />
          <Row glyph="drive" family="google-symbols" label="Add from Drive" onClick={act(onAddFromDrive)} onMouseEnter={() => setOpenSub(null)} />

          <div ref={uploadsRef} onMouseEnter={() => openWith('uploads')} onMouseLeave={closeSoon}>
            <Row
              glyph="more_horiz"
              family="google-symbols"
              label="More uploads"
              trailingChevron
              ariaHasPopup
              expanded={openSub === 'uploads'}
              onClick={() => openWith('uploads')}
            />
          </div>

          {!sparkMode && (
            <>
              <Divider />

              <Row glyph={TOOL_SYMBOLS.images} label="Create image" tooltip={TOOL_TOOLTIPS.images} labelInset={44} selected={selectedTool === 'images'} onClick={() => pickTool('images')} onMouseEnter={() => setOpenSub(null)} />
              <Row glyph={TOOL_SYMBOLS.video} label="Create video" tooltip={TOOL_TOOLTIPS.video} labelInset={44} selected={selectedTool === 'video'} onClick={() => pickTool('video')} onMouseEnter={() => setOpenSub(null)} />
              <Row glyph={TOOL_SYMBOLS.music} label="Create music" tooltip={TOOL_TOOLTIPS.music} labelInset={44} selected={selectedTool === 'music'} onClick={() => pickTool('music')} onMouseEnter={() => setOpenSub(null)} />
              <Row glyph={TOOL_SYMBOLS.canvas} label="Canvas" tooltip={TOOL_TOOLTIPS.canvas} labelInset={44} selected={selectedTool === 'canvas'} onClick={() => pickTool('canvas')} onMouseEnter={() => setOpenSub(null)} />

              <div ref={toolsRef} onMouseEnter={() => openWith('tools')} onMouseLeave={closeSoon}>
                <Row
                  glyph="more_horiz"
                  family="google-symbols"
                  label="More tools"
                  trailingChevron
                  ariaHasPopup
                  expanded={openSub === 'tools'}
                  onClick={() => openWith('tools')}
                />
              </div>
            </>
          )}
          {sparkMode && sparkToolsEnabled && (
            <>
              <Divider />
              <Row icon={<span className={`flex h-6 w-6 shrink-0 items-center justify-center ${isLight ? 'text-[#1f1f1f]' : 'text-[#e6e6e6]'}`}><CodexPlanIcon size={18} strokeWidth={2} /></span>} label="Plan" labelInset={44} selected={selectedTool === 'plan'} onClick={() => pickTool('plan')} onMouseEnter={() => setOpenSub(null)} />
              <Row icon={<span className={`flex h-6 w-6 shrink-0 items-center justify-center ${isLight ? 'text-[#1f1f1f]' : 'text-[#e6e6e6]'}`}><CodexGoalIcon size={18} strokeWidth={2} /></span>} label="Goal" labelInset={44} selected={selectedTool === 'goal'} onClick={() => pickTool('goal')} onMouseEnter={() => setOpenSub(null)} />
              <Row glyph={TOOL_SYMBOLS['computer-use']} family="google-symbols" label="Computer Use" labelInset={44} selected={selectedTool === 'computer-use'} onClick={() => pickTool('computer-use')} onMouseEnter={() => setOpenSub(null)} />
              <Row icon={<span className={`flex h-6 w-6 shrink-0 items-center justify-center ${isLight ? 'text-[#1f1f1f]' : 'text-[#e6e6e6]'}`}><CodexSideChatIcon size={18} strokeWidth={2} /></span>} label="Side chat" labelInset={44} onClick={onClose} onMouseEnter={() => setOpenSub(null)} />
              <div ref={toolsRef} onMouseEnter={() => openWith('tools')} onMouseLeave={closeSoon}>
                <Row
                  glyph="more_horiz"
                  family="google-symbols"
                  label="More tools"
                  trailingChevron
                  ariaHasPopup
                  expanded={openSub === 'tools'}
                  onClick={() => openWith('tools')}
                />
              </div>
            </>
          )}
        </MenuCard>

        {openSub === 'uploads' && (
          <div ref={submenuRef} className={`absolute z-[110] ${!isSubPositionReady ? 'invisible' : ''}`} style={{ left: SUB_LEFT, top: subTop - 8 }} {...subProps}>
            <MenuCard width={220} origin="0 0" label="More upload options">
              {sparkMode ? (
                <>
                  <Row glyph="code" label="Code" onClick={act(onImportCode)} />
                  <Row glyph="photos" family="google-symbols" label="Photos" onClick={act(onAddPhotos)} />
                </>
              ) : (
                <>
                  <Row glyph="photos" family="google-symbols" label="Photos" onClick={act(onAddPhotos)} />
                  <Row glyph="likeness_lumi_icon" label="Avatar" onClick={act(onAddAvatar)} />
                  <Row glyph="code" label="Import code" onClick={act(onImportCode)} />
                  <Row glyph="notebook" label="Notebooks" onClick={act(onAddNotebook)} />
                </>
              )}
            </MenuCard>
          </div>
        )}

        {openSub === 'tools' && (
          <div ref={submenuRef} className={`absolute z-[110] ${!isSubPositionReady ? 'invisible' : ''}`} style={{ left: SUB_LEFT, top: subTop - 8 }} {...subProps}>
            {sparkMode && sparkToolsEnabled ? (
              <MenuCard width={253} origin="0 0" label="More tools">
                <Row glyph={TOOL_SYMBOLS['create-skill']} family="google-symbols" label="Create skill" labelInset={44} selected={selectedTool === 'create-skill'} onClick={() => pickTool('create-skill')} />
                <Row icon={<span className={`flex h-6 w-6 shrink-0 items-center justify-center ${isLight ? 'text-[#1f1f1f]' : 'text-[#e6e6e6]'}`}><CodexPetIcon size={18} strokeWidth={2} /></span>} label="Create pet" labelInset={44} selected={selectedTool === 'create-pet'} onClick={() => pickTool('create-pet')} />
                <Row icon={<PersonalRecommendationsGlyph />} label="Personal Intelligence" labelInset={44} selected={selectedTool === 'personal-intelligence'} onClick={() => pickTool('personal-intelligence')} />
              </MenuCard>
            ) : (
              <MenuCard width={253} origin="0 0" label="More tools">
                <Row glyph={TOOL_SYMBOLS.research} label="Deep research" tooltip={TOOL_TOOLTIPS.research} labelInset={44} selected={selectedTool === 'research'} onClick={() => pickTool('research')} />
                <Row glyph={TOOL_SYMBOLS.learn} label="Guided learning" tooltip={TOOL_TOOLTIPS.learn} labelInset={44} selected={selectedTool === 'learn'} onClick={() => pickTool('learn')} />
                {onTogglePersonalIntelligence && (
                  <PersonalIntelligenceRow
                    checked={personalIntelligence}
                    onChange={onTogglePersonalIntelligence}
                  />
                )}
              </MenuCard>
            )}
          </div>
        )}
      </div>
    </PlusMenuThemeContext.Provider>
  );
};

/**
 * Gemini's Personal Intelligence row: 48px tall rather than 36, a two-line label, and an
 * MDC switch on the right.
 *
 * Measured: container 237.1x48, title 13px/17px #e6e6e6, subtitle "Labs" 13px/17px at
 * `rgba(255,255,255,0.55)`, switch rendered 39x24 — which is MDC's intrinsic 52x32 under
 * `transform: scale(0.75)`.
 *
 * Switch tokens, from the authored dark theme:
 *   selected handle   #062e6f      unselected handle   #8e918f
 *   selected track    #a8c7fa      unselected track    #444746   (both measured live)
 *   selected icon     #d3e3fd      handle 24px selected / 16px unselected
 *   handle motion     75ms cubic-bezier(0.4, 0, 0.2, 1)
 *
 * THE GLYPH IS A MASK, NOT A LIGATURE — see `PersonalRecommendationsGlyph` above. The
 * real name is `personal_recommendations`; an earlier version of this file guessed
 * `personal_intelligence` from the label and rendered nothing at all, because the font has
 * no such glyph. Both the name and the mask URL are now captured from the live row.
 */
const PersonalIntelligenceRow: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
}> = ({ checked, onChange }) => {
  const { isLight } = usePlusMenuTheme();
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group/row relative flex h-12 w-full items-center rounded-xl px-2 text-left"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-xl opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
        style={{ backgroundColor: isLight ? 'rgba(0, 0, 0, 0.08)' : HOVER_LAYER }}
      />
      <PersonalRecommendationsGlyph />
      <span className="relative flex flex-col" style={{ marginLeft: 12 }}>
        <span className={`${LABEL_CLASS} ${isLight ? '!text-[#1f1f1f]' : ''}`} style={LABEL_STYLE}>Personal Intelligence</span>
        <span
          className="text-[13px] leading-[17px] font-normal font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]"
          style={{ ...LABEL_STYLE, color: isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)' }}
        >
          Labs
        </span>
      </span>
      <span className="relative ml-auto" aria-hidden="true">
        <GeminiSwitch checked={checked} />
      </span>
    </button>
  );
};

/**
 * MDC's switch at Gemini's dark-theme tokens, drawn at `scale(0.75)` exactly as Gemini
 * does — intrinsic 52x32 renders as the measured 39x24.
 */
const GeminiSwitch: React.FC<{ checked: boolean }> = ({ checked }) => {
  const { isLight } = usePlusMenuTheme();
  return (
    <span
      className="relative block"
      style={{ width: 52, height: 32, transform: 'scale(0.75)', transformOrigin: 'center' }}
    >
      <span
        className="absolute inset-0 block"
        style={{
          borderRadius: 9999,
          backgroundColor: checked ? 'var(--studio-toggle-track, #a8c7fa)' : (isLight ? '#e1e3e1' : '#444746'),
          transition: 'background-color 75ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
      <span
        className="absolute flex items-center justify-center"
        style={{
          top: '50%',
          left: 0,
          width: checked ? 24 : 16,
          height: checked ? 24 : 16,
          marginLeft: checked ? 24 : 8,
          borderRadius: 9999,
          backgroundColor: checked ? 'var(--studio-toggle-thumb, #062e6f)' : (isLight ? '#747775' : '#8e918f'),
          transform: 'translateY(-50%)',
          transition:
            'width 75ms cubic-bezier(0.4, 0, 0.2, 1), height 75ms cubic-bezier(0.4, 0, 0.2, 1), margin-left 75ms cubic-bezier(0.4, 0, 0.2, 1), background-color 75ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* The check, measured at 16px with fill #d3e3fd and its own 45ms opacity ramp. */}
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          style={{
            fill: 'var(--studio-notice-text, #d3e3fd)',
            opacity: checked ? 1 : 0,
            transition: 'opacity 45ms cubic-bezier(0, 0, 0.2, 1)',
          }}
        >
          <path d="M19.69,5.23L8.96,15.96l-4.23-4.23L2.96,13.5l6,6L21.46,7L19.69,5.23z" />
        </svg>
      </span>
    </span>
  );
};
