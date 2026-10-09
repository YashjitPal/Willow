// The Media header's popover menus: View Settings, More, and Sort & Filter.
//
// Structure, copy, glyphs, metrics and both animations are Flow's, captured off the live app
// with `tools/ui-research/scrapers/flow/56-menus.cjs`. The styling lives in `flow-menu.css` next
// to this file; the header comment there records where the values came from.
//
// `FlowMenuItem` and `FlowMenuSeparator` are exported because a gallery tile's menu is the same
// component in Flow and should stay the same component here.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCompactViewport } from '@willow/chat/use-compact-viewport';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { Avatar } from '@willow/ui/Avatar';
import { FlowMatDivider, FlowMatMenu, FlowMatMenuItem, type MenuAnchor } from './scenes/flow-ui';
import { openWillowTv } from './tv/tv-routes';
import './flow-menu.css';
import './header-panels.css';

/** Flow's header and menu glyph axes: unfilled, weight axis 300. */
const AXES = '"FILL" 0, "wght" 300';

/** The tile menu's own weight with the fill on, for a row that reads as a state (Favorite). */
const AXES_FILLED = '"FILL" 1, "wght" 400';

/** Gap between the trigger's bottom edge and the surface: Flow's More menu sits 5.2px below. */
const SIDE_OFFSET = 5;

/** Must match `flow-menu-out` in `flow-menu.css`. */
export const MENU_EXIT_MS = 100;
const EXIT_MS = MENU_EXIT_MS;

type Align = 'start' | 'end';

/**
 * A menu surface anchored under a trigger.
 *
 * Stays mounted through its exit animation: the close is 100ms of `flow-menu-out`, and
 * unmounting on the click instead would make the menu vanish with no animation at all.
 */
export const FlowMenu: React.FC<{
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  align?: Align;
  panel?: boolean;
  width?: number;
  children: React.ReactNode;
}> = ({ open, onClose, anchorRef, align = 'end', panel = false, width, children }) => {
  const [mounted, setMounted] = useState(open);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const exitTimer = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      if (exitTimer.current) { window.clearTimeout(exitTimer.current); exitTimer.current = null; }
      setMounted(true);
      return undefined;
    }
    if (!mounted) return undefined;
    exitTimer.current = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => { if (exitTimer.current) window.clearTimeout(exitTimer.current); };
  }, [open, mounted]);

  /* Positioned before paint, from the trigger's box: measuring in a plain effect lets the menu
   * paint once at 0,0 first, which reads as a flash in the corner. */
  useLayoutEffect(() => {
    if (!mounted || !anchorRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const w = width ?? surfaceRef.current?.offsetWidth ?? 192;
    setPosition({
      top: a.bottom + SIDE_OFFSET,
      left: align === 'end' ? a.right - w : a.left,
    });
  }, [mounted, align, width, anchorRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (surfaceRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return; // the trigger toggles itself
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown, { capture: true });
    };
  }, [open, onClose, anchorRef]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={surfaceRef}
      role="menu"
      data-state={open ? 'open' : 'closed'}
      className={`flow-menu${panel ? ' flow-menu--panel' : ''}`}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        width,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
};

/**
 * One row of a menu. The overlay child is half of what paints hover — see the CSS.
 *
 * `body` and the default axes go together: Flow's tile menu sets its rows at 14px/20px and lets
 * the glyph keep the font's own weight, where the header's rows stay at 11px/16px with the
 * lighter 300 axis. `icon` takes a node instead of a ligature for the few actions Willow draws
 * itself, since not every one of them has a Google Symbols counterpart. `fill` is for the one
 * row that carries a state rather than an action: a favorited tile shows a solid heart.
 */
export const FlowMenuItem: React.FC<{
  glyph?: string;
  icon?: React.ReactNode;
  label: string;
  body?: boolean;
  danger?: boolean;
  fill?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
}> = ({ glyph, icon, label, body = false, danger = false, fill = false, onSelect }) => (
  <button
    type="button"
    role="menuitem"
    className={`flow-menu-item${body ? ' flow-menu-item--body' : ''}${danger ? ' flow-menu-item--danger' : ''}`}
    onClick={onSelect}
  >
    {icon ?? (glyph && (
      <MaterialSymbol
        name={glyph}
        family="google-symbols"
        size={20}
        weight={400}
        variationSettings={fill ? AXES_FILLED : (body ? undefined : AXES)}
      />
    ))}
    <span className="flow-menu-item__label">{label}</span>
    <span className="flow-menu-item__overlay" />
  </button>
);

export const FlowMenuSeparator: React.FC = () => <div role="separator" className="flow-menu-separator" />;

/** Flow's segmented control, used for every choice in the settings panel. */
export const FlowTabs = <T extends string>({ value, onChange, options, compact = false }: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string; glyph?: string }[];
  compact?: boolean;
}) => (
  <div className={`flow-tabs${compact ? ' flow-tabs--compact' : ''}`}>
    <div role="tablist" className="flow-tabs__list">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          data-state={value === o.value ? 'active' : 'inactive'}
          className="flow-tab"
          onClick={() => onChange(o.value)}
        >
          {o.glyph && <MaterialSymbol name={o.glyph} family="google-symbols" size={16} weight={400} variationSettings={AXES} />}
          {o.label}
        </button>
      ))}
    </div>
  </div>
);

export type ViewSettings = {
  viewMode: 'grid' | 'batch';
  gridSize: 'S' | 'M' | 'L';
  soundOnHover: boolean;
  silentVideos: boolean;
  tileDetails: boolean;
  clearPromptOnSubmit: boolean;
};

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  viewMode: 'grid',
  gridSize: 'M',
  soundOnHover: false,
  silentVideos: false,
  tileDetails: true,
  clearPromptOnSubmit: true,
};

const VIEW_SETTINGS_KEY = 'willow-media-view-settings';

/** Flow keeps these per account, across projects and visits; Willow keeps them in this browser. */
export function loadViewSettings(): ViewSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEW_SETTINGS_KEY) || 'null') as Partial<ViewSettings> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_VIEW_SETTINGS;
    const flag = (key: 'soundOnHover' | 'silentVideos' | 'tileDetails' | 'clearPromptOnSubmit') =>
      (typeof raw[key] === 'boolean' ? raw[key] as boolean : DEFAULT_VIEW_SETTINGS[key]);
    return {
      viewMode: raw.viewMode === 'batch' ? 'batch' : 'grid',
      gridSize: raw.gridSize === 'S' || raw.gridSize === 'L' ? raw.gridSize : 'M',
      soundOnHover: flag('soundOnHover'),
      silentVideos: flag('silentVideos'),
      tileDetails: flag('tileDetails'),
      clearPromptOnSubmit: flag('clearPromptOnSubmit'),
    };
  } catch {
    return DEFAULT_VIEW_SETTINGS;
  }
}

export function saveViewSettings(settings: ViewSettings): void {
  try {
    localStorage.setItem(VIEW_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or a full quota: the settings still apply for this visit.
  }
}

/** A trigger's box as a FlowMatMenu anchor, while the menu is open. */
const belowAnchor = (open: boolean, ref: React.RefObject<HTMLElement | null>): MenuAnchor | null =>
  (open && ref.current ? { kind: 'below', rect: ref.current.getBoundingClientRect() } : null);

/** flow-toggles: a segmented row of choices. */
const Toggles = <T extends string>({ value, onChange, options, label }: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string; glyph?: string }[];
  label: string;
}) => (
  <div className="hp-toggles" role="radiogroup" aria-label={label}>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        role="radio"
        aria-checked={value === o.value}
        className={`hp-toggle${value === o.value ? ' is-checked' : ''}`}
        onClick={() => onChange(o.value)}
      >
        {o.glyph && <MaterialSymbol name={o.glyph} family="google-symbols" size={18} weight={400} variationSettings='"FILL" 0, "wght" 400' />}
        {o.label}
      </button>
    ))}
  </div>
);

/** A labelled mat-slide-toggle row. */
const SwitchRow: React.FC<{ glyph: string; label: string; value: boolean; onChange: (v: boolean) => void }> = ({ glyph, label, value, onChange }) => (
  <div className="hp-row">
    <div className="hp-row__left">
      <MaterialSymbol name={glyph} family="google-symbols" size={24} weight={400} variationSettings='"FILL" 0, "wght" 400' />
      <span>{label}</span>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={`${label} toggle`}
      className={`hp-switch${value ? ' is-on' : ''}`}
      onClick={() => onChange(!value)}
    >
      <span className="hp-switch__track" />
      <span className="hp-switch__handle" />
    </button>
  </div>
);

/**
 * Flow's tile view settings: view mode and grid size as segmented rows, then four switches, in a
 * wide mat-menu under the gear. (Willow's own settings moved to the More menu, which keeps this
 * panel Flow's.)
 */
export const ViewSettingsMenu: React.FC<{
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  settings: ViewSettings;
  onChange: (next: ViewSettings) => void;
}> = ({ open, onClose, anchorRef, settings, onChange }) => {
  const set = useCallback(<K extends keyof ViewSettings>(key: K, value: ViewSettings[K]) => {
    onChange({ ...settings, [key]: value });
  }, [settings, onChange]);

  return (
    <FlowMatMenu open={open} onClose={onClose} anchor={belowAnchor(open, anchorRef)} ignoreRefs={[anchorRef]} ariaLabel="View settings">
      <div className="hp-view">
        <div className="hp-view__label">View mode</div>
        <Toggles
          label="Display mode toggle"
          value={settings.viewMode}
          onChange={(v) => set('viewMode', v)}
          options={[
            { value: 'grid', label: 'Grid', glyph: 'dashboard' },
            { value: 'batch', label: 'Batch', glyph: 'campaign_all' },
          ]}
        />
        <div className="hp-view__label">Grid size</div>
        <Toggles
          label="Grid size toggle"
          value={settings.gridSize}
          onChange={(v) => set('gridSize', v)}
          options={[{ value: 'S', label: 'S' }, { value: 'M', label: 'M' }, { value: 'L', label: 'L' }]}
        />
        <SwitchRow glyph="volume_up" label="Sound on hover" value={settings.soundOnHover} onChange={(v) => set('soundOnHover', v)} />
        <SwitchRow glyph="mic" label="Return silent videos" value={settings.silentVideos} onChange={(v) => set('silentVideos', v)} />
        <SwitchRow glyph="visibility" label="Show tile details" value={settings.tileDetails} onChange={(v) => set('tileDetails', v)} />
        <SwitchRow glyph="ink_eraser" label="Clear prompt on submit" value={settings.clearPromptOnSubmit} onChange={(v) => set('clearPromptOnSubmit', v)} />
      </div>
    </FlowMatMenu>
  );
};

/* Flow's own list, in its order, with Willow's names. Two entries share the `info` glyph and two
 * the `help` glyph, which is Flow's doing; Flow Music has no Willow counterpart. */
const MORE_ITEMS: { glyph: string; label: string; onSelect?: () => void }[] = [
  { glyph: 'download', label: 'Download project' },
  { glyph: 'help', label: 'Product help' },
  { glyph: 'help', label: 'Willow help center' },
  { glyph: 'list_alt', label: 'View all changelogs' },
  { glyph: 'tv', label: 'Willow TV', onSelect: openWillowTv },
  { glyph: 'info', label: 'About Willow' },
  { glyph: 'smart_display', label: 'Learn Willow' },
  { glyph: 'feedback', label: 'Send app feedback' },
  { glyph: 'flag', label: 'Report legal issue' },
  { glyph: 'info', label: 'Privacy notice' },
];

/** The top-right More options menu. Willow's own settings close the list. */
export const MoreMenu: React.FC<{
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  onSettings?: () => void;
  /** Rows above Flow's list, for the controls a phone's header has no room for. */
  leading?: React.ReactNode;
}> = ({ open, onClose, anchorRef, onSettings, leading }) => (
  <FlowMatMenu open={open} onClose={onClose} anchor={belowAnchor(open, anchorRef)} ignoreRefs={[anchorRef]}>
    {leading}
    {leading && <FlowMatDivider />}
    {MORE_ITEMS.map((item) => (
      <FlowMatMenuItem key={item.label} icon={item.glyph} label={item.label} onSelect={item.onSelect} />
    ))}
    {onSettings && <FlowMatMenuItem icon="settings" label="Willow settings" onSelect={onSettings} />}
  </FlowMatMenu>
);

/** Flow's top-right account surface, with avatar/legal/build rows omitted for Willow. */
export const AccountMenu: React.FC<{
  open: boolean;
  onClose: () => void;
  isAuthenticated: boolean;
  displayName: string;
  email: string;
  photoURL?: string | null;
  onSignIn: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
}> = ({ open, onClose, isAuthenticated, displayName, email, photoURL, onSignIn, onSignOut }) => {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  const [surfaceHeight, setSurfaceHeight] = useState(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [watermarkOn, setWatermarkOn] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setEntered(false);
      return undefined;
    }
    setEntered(false);
    const timer = window.setTimeout(() => setMounted(false), 200);
    return () => window.clearTimeout(timer);
  }, [open]);

  useLayoutEffect(() => {
    if (!mounted || !surfaceRef.current) return undefined;
    const measure = () => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const renderedHeight = surface.style.height;
      surface.style.height = 'auto';
      setSurfaceHeight(surface.scrollHeight);
      surface.style.height = renderedHeight;
    };
    measure();
    if (open) {
      const frame = window.requestAnimationFrame(() => setEntered(true));
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [mounted, open, isAuthenticated]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!(target instanceof Element) || !target.closest('[data-willow-account-menu]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, onClose]);

  if (!mounted) return null;
  const name = isAuthenticated ? (displayName || 'Willow user') : 'Not signed in';
  const accountEmail = isAuthenticated ? (email || 'user@example.com') : 'Log in to access your Willow account';
  return createPortal(
    <div
      ref={surfaceRef}
      data-willow-account-menu
      role="dialog"
      aria-label="Account"
      data-state={entered ? 'open' : 'closed'}
      className="flow-account-menu"
      style={{ height: entered ? `${surfaceHeight}px` : 0, opacity: entered ? 1 : 0, transform: entered ? 'translateY(0)' : 'translateY(-16px)', pointerEvents: entered ? 'auto' : 'none' }}
    >
      <button type="button" aria-label="Close this modal" className="flow-account-menu__close" onClick={onClose}>
        <MaterialSymbol name="close" family="google-symbols" size={24} weight={400} variationSettings={AXES} />
      </button>
      <div className="flow-account-menu__content">
        <div className="flow-account-menu__logo-wrap">
          <span className="flow-account-menu__logo">Willow</span>
        </div>
        {isAuthenticated && (
          <div className="flow-account-menu__identity">
            <Avatar src={photoURL || undefined} name={name} size={36} />
            <div className="flow-account-menu__identity-copy"><span className="flow-account-menu__name">{name}</span><span className="flow-account-menu__email">{accountEmail}</span></div>
          </div>
        )}
        <div className="flow-account-menu__body">
          {isAuthenticated ? (
            <>
              <div className="flow-account-menu__credits-card">
                <div className="flow-account-menu__credits-line"><MaterialSymbol name="movie_filter_auto" family="google-symbols" size={20} weight={400} variationSettings={AXES} /><span>1022 Willow credits</span></div>
                <button type="button" className="flow-account-menu__credits-button">Get AI credits</button>
              </div>
              <button type="button" className="flow-account-menu__action">Manage membership</button>
              <button type="button" className="flow-account-menu__action" onClick={() => { onClose(); void onSignOut(); }}>Sign out</button>
              <div className="flow-account-menu__watermark">
                <div className="flow-account-menu__watermark-label"><MaterialSymbol name="frame_spark" family="google-symbols" size={24} weight={400} variationSettings={AXES} /><span>Visible watermarking</span></div>
                <div className="flow-account-menu__toggle" role="tablist" aria-label="Visible watermarking">
                  <button type="button" role="tab" aria-selected={!watermarkOn} data-state={!watermarkOn ? 'active' : 'inactive'} onClick={() => setWatermarkOn(false)}>Off</button>
                  <button type="button" role="tab" aria-selected={watermarkOn} data-state={watermarkOn ? 'active' : 'inactive'} onClick={() => setWatermarkOn(true)}>On</button>
                </div>
              </div>
            </>
          ) : (
            <button type="button" className="flow-account-menu__login-button" onClick={() => { onClose(); void onSignIn(); }}>
              <span>Log in</span>
            </button>
          )}
        </div>
        <div className="flow-account-menu__legal">
          <a href="#privacy" onClick={(event) => event.preventDefault()}>Privacy</a>
          <span aria-hidden="true">·</span>
          <a href="#terms" onClick={(event) => event.preventDefault()}>Terms of Service</a>
          <span aria-hidden="true">·</span>
          <a href="#licenses" onClick={(event) => event.preventDefault()}>Licenses</a>
        </div>
        <div className="flow-account-menu__build">Willow build — local development</div>
      </div>
    </div>, document.body,
  );
};

/** Flow's project menu, anchored to the project title's three-dot control. */
export const ProjectMenu: React.FC<{
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  onRename: () => void;
  onViewTrash: () => void;
  onDelete: () => void;
}> = ({ open, onClose, anchorRef, onRename, onViewTrash, onDelete }) => (
  <FlowMatMenu open={open} onClose={onClose} anchor={belowAnchor(open, anchorRef)} ignoreRefs={[anchorRef]}>
    <FlowMatMenuItem icon="edit" label="Rename" onSelect={onRename} />
    <FlowMatMenuItem icon="delete" label="View trash" onSelect={onViewTrash} />
    <FlowMatDivider />
    <FlowMatMenuItem icon="delete" label="Delete" danger onSelect={onDelete} />
  </FlowMatMenu>
);

/** The search bar's filters. Each list is "any of"; an empty list doesn't filter. */
export type SortFilter = {
  types: string[];
  ratios: string[];
  created: string[];
  durations: string[];
  resolutions: string[];
  sort: 'newest' | 'oldest';
};

export const DEFAULT_SORT_FILTER: SortFilter = { types: [], ratios: [], created: [], durations: [], resolutions: [], sort: 'newest' };

export const FILTER_TYPES = [
  { value: 'images', label: 'Images' },
  { value: 'videos', label: 'Videos' },
  { value: 'collections', label: 'Collections' },
  { value: 'scenes', label: 'Scenes' },
  { value: 'characters', label: 'Characters' },
];
const FILTER_RATIOS = [{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }, { value: 'freeform', label: 'Freeform' }];
const FILTER_CREATED = [{ value: 'generated', label: 'Generated' }, { value: 'uploaded', label: 'Uploaded' }, { value: 'favorites', label: 'Favorites' }];
const FILTER_DURATIONS = ['4s', '6s', '8s', '10s'];
const FILTER_RESOLUTIONS = ['720p', '360p'];

const CheckMark = () => (
  <svg className="hp-check__mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="3.12" d="M1.73,12.91 8.1,19.28 22.79,4.59" /></svg>
);

/** mat-checkbox. */
const Check: React.FC<{ label: string; checked: boolean; onToggle: () => void; initialFocus?: boolean; buttonRef?: React.Ref<HTMLButtonElement> }> = ({ label, checked, onToggle, initialFocus, buttonRef }) => (
  <button ref={buttonRef} type="button" role="checkbox" aria-checked={checked} className={`hp-check${initialFocus ? ' is-initial-focus' : ''}`} onClick={onToggle}>
    <span className="hp-check__target"><span className="hp-check__box">{checked && <CheckMark />}</span></span>
    <span className="hp-check__label">{label}</span>
  </button>
);

/** mat-radio-button. */
const Radio: React.FC<{ label: string; checked: boolean; onSelect: () => void }> = ({ label, checked, onSelect }) => (
  <button type="button" role="radio" aria-checked={checked} className="hp-check" onClick={onSelect}>
    <span className="hp-check__target"><span className="hp-radio__ring" /></span>
    <span className="hp-check__label">{label}</span>
  </button>
);

const PANEL_WIDTH = 405.188;

/**
 * Flow's filter panel (`search-bar-filter-panel`): Type, Aspect ratio, Created, Duration,
 * Resolution and Sort by, with the result count and Clear in the footer. It hangs 8px under the
 * filter button, right edges aligned, and opens with its first box focused, as Flow's does.
 */
export const SortFilterMenu: React.FC<{
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  value: SortFilter;
  onChange: (next: SortFilter) => void;
  resultCount: number;
}> = ({ open, onClose, anchorRef, value, onChange, resultCount }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const [initialFocus, setInitialFocus] = useState(true);
  // Below 961px the panel is a bottom sheet, placed by media-responsive.css: a phone opens it from
  // the More menu, with no trigger in the header to hang it from.
  const sheet = useCompactViewport();

  useLayoutEffect(() => {
    if (!open) return;
    if (sheet) {
      setPosition({ top: 0, left: 0, maxHeight: 0 });
      setInitialFocus(false);
      return;
    }
    if (!anchorRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    setPosition({ top: a.bottom + 8, left: Math.max(8, a.right - PANEL_WIDTH), maxHeight: window.innerHeight - 80 });
    setInitialFocus(true);
    window.setTimeout(() => firstRef.current?.focus({ preventScroll: true }), 0);
  }, [open, anchorRef, sheet]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return; // the trigger toggles itself
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown, { capture: true });
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  const toggle = (key: 'types' | 'ratios' | 'created' | 'durations' | 'resolutions', entry: string) => {
    setInitialFocus(false);
    const list = value[key];
    onChange({ ...value, [key]: list.includes(entry) ? list.filter((x) => x !== entry) : [...list, entry] });
  };

  return createPortal(
    <>
    {sheet && <div className="media-sheet-backdrop hp-filter-backdrop" aria-hidden="true" />}
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Filtering and sorting options"
      className={`hp-filter${sheet ? ' is-sheet' : ''}`}
      style={sheet ? undefined : { top: position?.top ?? 0, left: position?.left ?? 0, maxHeight: position?.maxHeight, visibility: position ? 'visible' : 'hidden' }}
      onPointerDown={() => setInitialFocus(false)}
    >
      <div className="hp-filter__title">
        <MaterialSymbol name="filter_list" family="google-symbols" size={24} weight={400} variationSettings='"FILL" 0, "wght" 400' />
        <span>Filters</span>
      </div>
      <div className="hp-filter__rule" role="separator" />
      <div className="hp-filter__body">
        <div className="hp-filter__groups">
          <div className="hp-filter__group hp-filter__group--wide">
            <div className="hp-filter__subtitle">Type</div>
            <div className="hp-filter__grid" role="group" aria-label="Select media types">
              {FILTER_TYPES.map((t, i) => (
                <Check key={t.value} label={t.label} checked={value.types.includes(t.value)} onToggle={() => toggle('types', t.value)} initialFocus={i === 0 && initialFocus} buttonRef={i === 0 ? firstRef : undefined} />
              ))}
            </div>
          </div>
          <div className="hp-filter__group">
            <div className="hp-filter__subtitle">Aspect ratio</div>
            <div className="hp-filter__list" role="group" aria-label="Select aspect ratios">
              {FILTER_RATIOS.map((r) => <Check key={r.value} label={r.label} checked={value.ratios.includes(r.value)} onToggle={() => toggle('ratios', r.value)} />)}
            </div>
          </div>
        </div>
        <div className="hp-filter__rule" role="separator" />
        <div className="hp-filter__groups">
          <div className="hp-filter__group hp-filter__group--created">
            <div className="hp-filter__subtitle">Created</div>
            <div className="hp-filter__list" role="group" aria-label="Select creation types">
              {FILTER_CREATED.map((c) => <Check key={c.value} label={c.label} checked={value.created.includes(c.value)} onToggle={() => toggle('created', c.value)} />)}
            </div>
          </div>
          <div className="hp-filter__group">
            <div className="hp-filter__subtitle">Duration</div>
            <div className="hp-filter__list" role="group" aria-label="Select durations">
              {FILTER_DURATIONS.map((d) => <Check key={d} label={d} checked={value.durations.includes(d)} onToggle={() => toggle('durations', d)} />)}
            </div>
          </div>
          <div className="hp-filter__group">
            <div className="hp-filter__subtitle">Resolution</div>
            <div className="hp-filter__list" role="group" aria-label="Select resolutions">
              {FILTER_RESOLUTIONS.map((r) => <Check key={r} label={r} checked={value.resolutions.includes(r)} onToggle={() => toggle('resolutions', r)} />)}
            </div>
          </div>
        </div>
        <div className="hp-filter__rule" role="separator" />
        <div className="hp-filter__groups">
          <div className="hp-filter__group">
            <div className="hp-filter__subtitle">Sort by</div>
            <div className="hp-filter__list" role="radiogroup" aria-label="Sort by option">
              <Radio label="Newest" checked={value.sort === 'newest'} onSelect={() => { setInitialFocus(false); onChange({ ...value, sort: 'newest' }); }} />
              <Radio label="Oldest" checked={value.sort === 'oldest'} onSelect={() => { setInitialFocus(false); onChange({ ...value, sort: 'oldest' }); }} />
            </div>
          </div>
        </div>
      </div>
      <div className="hp-filter__footer">
        <span>{resultCount} result{resultCount === 1 ? '' : 's'}</span>
        <button type="button" className="hp-filter__clear" aria-label="Clear all filters" onClick={() => onChange(DEFAULT_SORT_FILTER)}>Clear</button>
      </div>
    </div>
    </>,
    document.body,
  );
};
