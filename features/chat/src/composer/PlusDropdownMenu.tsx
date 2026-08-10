import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { TOOL_SYMBOLS, TOOL_TOOLTIPS, type ToolId } from './composer-options';

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
}) => (
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
      className="text-[#e6e6e6]"
    />
  </span>
);

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

const PersonalRecommendationsGlyph: React.FC = () => (
  <span className="flex h-6 w-6 shrink-0 items-center justify-center">
    <span
      aria-hidden="true"
      className="block h-5 w-5 shrink-0"
      style={{
        backgroundColor: ON_SURFACE,
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

/**
 * One 36px row. `labelInset` is the label's distance from the row's left edge: 40 on the
 * uploader rows, 44 on the tool rows. Both measured.
 */
const Row: React.FC<{
  glyph: string;
  family?: IconFamily;
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
  label,
  labelInset = 40,
  tooltip,
  trailingChevron,
  selected,
  onClick,
  onMouseEnter,
  ariaHasPopup,
  expanded,
}) => (
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
    style={selected ? { backgroundColor: '#171717' } : undefined}
  >
    {/* The hover state layer. Separate node so it can snap in with no transition, which
        is what Gemini does — the row's own background stays the panel surface. */}
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-xl opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
      style={{ backgroundColor: HOVER_LAYER }}
    />
    <Glyph name={glyph} family={family} />
    <span
      className={`relative ${LABEL_CLASS} whitespace-nowrap`}
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

/** The card every menu and submenu is drawn on. */
const MenuCard: React.FC<{
  width: number;
  origin: string;
  className?: string;
  style?: React.CSSProperties;
  label: string;
  children: React.ReactNode;
}> = ({ width, origin, className = '', style, label, children }) => (
  <div
    role="menu"
    aria-label={label}
    className={`willow-gem-menu-in overflow-auto ${className}`}
    style={{
      width,
      backgroundColor: SURFACE,
      borderRadius: 20,
      padding: 8,
      boxShadow: MENU_SHADOW,
      transformOrigin: origin,
      ...style,
    }}
  >
    {children}
  </div>
);

/** 0.8px at `--lumi-sys-color--on-surface-low`, inset 8px, `margin-block: 8px`. */
const Divider: React.FC = () => (
  <div
    role="separator"
    className="mx-2 my-2"
    style={{ height: 0, borderTop: `0.8px solid ${DIVIDER}` }}
  />
);

export const PlusDropdownMenu: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onFileSelect: () => void;
  onImportCode?: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
  onToolSelect: (toolId: string) => void;
  selectedTool?: ToolId | null;
  geminiStyle?: boolean;
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
}) => {
  const [openSub, setOpenSub] = useState<null | 'uploads' | 'tools'>(null);
  // Vertical offset of whichever row opened the submenu, measured from the positioning
  // wrapper. The submenus render as SIBLINGS of the card rather than inside it — see the
  // note on the wrapper below — so they need the row's position passed to them.
  const [subTop, setSubTop] = useState(0);
  const [side, setSide] = useState<'bottom' | 'top'>('bottom');
  const menuRef = useRef<HTMLDivElement>(null);
  const uploadsRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) setOpenSub(null);
  }, [isOpen]);

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
  }, [isOpen, onClose, buttonRef]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  if (!isOpen) return null;

  const openWith = (which: 'uploads' | 'tools') => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const trigger = which === 'uploads' ? uploadsRef.current : toolsRef.current;
    // offsetParent is the positioning wrapper, so this is already in the coordinate
    // space the submenu is placed in.
    if (trigger) setSubTop(trigger.offsetTop);
    setOpenSub(which);
  };
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenSub(null), 150);
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

  return (
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
      </MenuCard>

      {openSub === 'uploads' && (
        <div className="absolute z-[110]" style={{ left: SUB_LEFT, top: subTop - 8 }} {...subProps}>
          <MenuCard width={220} origin="0 0" label="More upload options">
            <Row glyph="photos" family="google-symbols" label="Photos" onClick={act(onAddPhotos)} />
            <Row glyph="likeness_lumi_icon" label="Avatar" onClick={act(onAddAvatar)} />
            <Row glyph="code" label="Import code" onClick={act(onImportCode)} />
            <Row glyph="notebook" label="Notebooks" onClick={act(onAddNotebook)} />
          </MenuCard>
        </div>
      )}

      {openSub === 'tools' && (
        <div className="absolute z-[110]" style={{ left: SUB_LEFT, top: subTop - 8 }} {...subProps}>
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
        </div>
      )}
    </div>
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
}> = ({ checked, onChange }) => (
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
      style={{ backgroundColor: HOVER_LAYER }}
    />
    <PersonalRecommendationsGlyph />
    <span className="relative flex flex-col" style={{ marginLeft: 12 }}>
      <span className={LABEL_CLASS} style={LABEL_STYLE}>Personal Intelligence</span>
      <span
        className="text-[13px] leading-[17px] font-normal font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]"
        style={{ ...LABEL_STYLE, color: 'rgba(255,255,255,0.55)' }}
      >
        Labs
      </span>
    </span>
    <span className="relative ml-auto" aria-hidden="true">
      <GeminiSwitch checked={checked} />
    </span>
  </button>
);

/**
 * MDC's switch at Gemini's dark-theme tokens, drawn at `scale(0.75)` exactly as Gemini
 * does — intrinsic 52x32 renders as the measured 39x24.
 */
const GeminiSwitch: React.FC<{ checked: boolean }> = ({ checked }) => (
  <span
    className="relative block"
    style={{ width: 52, height: 32, transform: 'scale(0.75)', transformOrigin: 'center' }}
  >
    <span
      className="absolute inset-0 block"
      style={{
        borderRadius: 9999,
        backgroundColor: checked ? '#a8c7fa' : '#444746',
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
        backgroundColor: checked ? '#062e6f' : '#8e918f',
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
          fill: '#d3e3fd',
          opacity: checked ? 1 : 0,
          transition: 'opacity 45ms cubic-bezier(0, 0, 0.2, 1)',
        }}
      >
        <path d="M19.69,5.23L8.96,15.96l-4.23-4.23L2.96,13.5l6,6L21.46,7L19.69,5.23z" />
      </svg>
    </span>
  </span>
);
