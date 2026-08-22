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
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { Avatar } from '@willow/ui/Avatar';
import './flow-menu.css';

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

const OFF_ON = [{ value: 'off' as const, label: 'Off' }, { value: 'on' as const, label: 'On' }];

const ToggleRow: React.FC<{ glyph: string; label: string; value: boolean; onChange: (v: boolean) => void }> = ({ glyph, label, value, onChange }) => (
  <div className="flow-menu-row">
    <div className="flow-menu-row__left">
      <MaterialSymbol name={glyph} family="google-symbols" size={24} weight={400} variationSettings={AXES} />
      <span className="flow-menu-row__label">{label}</span>
    </div>
    <FlowTabs
      compact
      value={value ? 'on' : 'off'}
      options={OFF_ON}
      onChange={(next) => onChange(next === 'on')}
    />
  </div>
);

export const ViewSettingsMenu: React.FC<{
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  settings: ViewSettings;
  onChange: (next: ViewSettings) => void;
  onMoreSettings: () => void;
}> = ({ open, onClose, anchorRef, settings, onChange, onMoreSettings }) => {
  const set = useCallback(<K extends keyof ViewSettings>(key: K, value: ViewSettings[K]) => {
    onChange({ ...settings, [key]: value });
  }, [settings, onChange]);

  return (
    <FlowMenu open={open} onClose={onClose} anchorRef={anchorRef} panel width={292}>
      <div className="flow-menu-heading">View Mode</div>
      <FlowTabs
        value={settings.viewMode}
        onChange={(v) => set('viewMode', v)}
        options={[
          { value: 'grid', label: 'Grid', glyph: 'dashboard' },
          { value: 'batch', label: 'Batch', glyph: 'campaign_all' },
        ]}
      />
      <div className="flow-menu-heading">Grid Size</div>
      <FlowTabs
        value={settings.gridSize}
        onChange={(v) => set('gridSize', v)}
        options={[{ value: 'S', label: 'S' }, { value: 'M', label: 'M' }, { value: 'L', label: 'L' }]}
      />
      <ToggleRow glyph="volume_up" label="Sound on hover" value={settings.soundOnHover} onChange={(v) => set('soundOnHover', v)} />
      <ToggleRow glyph="mic" label="Return silent videos" value={settings.silentVideos} onChange={(v) => set('silentVideos', v)} />
      <ToggleRow glyph="visibility" label="Show tile details" value={settings.tileDetails} onChange={(v) => set('tileDetails', v)} />
      <ToggleRow glyph="ink_eraser" label="Clear prompt on submit" value={settings.clearPromptOnSubmit} onChange={(v) => set('clearPromptOnSubmit', v)} />
      <div className="flow-more-settings">
        <button type="button" className="flow-more-settings__button" onClick={() => { onClose(); onMoreSettings(); }}>
          More settings
        </button>
      </div>
    </FlowMenu>
  );
};

/* Flow's own list, in its order. Two entries share the `info` glyph, which is Flow's doing. */
const MORE_ITEMS: { glyph: string; label: string }[] = [
  { glyph: 'download', label: 'Download Project' },
  { glyph: 'help_guide', label: 'Product Help' },
  { glyph: 'help', label: 'Help Center' },
  { glyph: 'list_alt', label: 'View all changelogs' },
  { glyph: 'tv', label: 'Willow TV' },
  { glyph: 'info', label: 'About Willow' },
  { glyph: 'smart_display', label: 'Learn Willow' },
  { glyph: 'feedback', label: 'Send app feedback' },
  { glyph: 'flag', label: 'Report legal issue' },
  { glyph: 'info', label: 'Privacy Notice' },
];

export const MoreMenu: React.FC<{
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}> = ({ open, onClose, anchorRef }) => (
  <FlowMenu open={open} onClose={onClose} anchorRef={anchorRef} width={192}>
    {MORE_ITEMS.map((item) => (
      <FlowMenuItem key={item.label} glyph={item.glyph} label={item.label} onSelect={onClose} />
    ))}
  </FlowMenu>
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
  <FlowMenu open={open} onClose={onClose} anchorRef={anchorRef} width={192}>
    <FlowMenuItem glyph="edit" label="Rename" onSelect={() => { onClose(); onRename(); }} />
    <FlowMenuItem glyph="delete" label="View Trash" onSelect={() => { onClose(); onViewTrash(); }} />
    <FlowMenuItem glyph="delete" label="Delete" danger onSelect={() => { onClose(); onDelete(); }} />
  </FlowMenu>
);

export type SortFilter = {
  types: string[];
  ratios: string[];
  sort: 'newest' | 'oldest';
};

export const DEFAULT_SORT_FILTER: SortFilter = { types: [], ratios: [], sort: 'newest' };

const TYPE_OPTIONS = ['Images', 'Videos', 'Characters', 'Scenes', 'Uploads'];
const RATIO_OPTIONS = ['16:9', '9:16', '1:1'];

/** A checkbox row. Flow draws the box as a glyph rather than a styled input. */
const CheckRow: React.FC<{ label: string; checked: boolean; onToggle: () => void }> = ({ label, checked, onToggle }) => (
  <button type="button" role="menuitemcheckbox" aria-checked={checked} className="flow-menu-item" onClick={onToggle}>
    <MaterialSymbol
      name={checked ? 'check_box' : 'check_box_outline_blank'}
      family="google-symbols"
      size={20}
      weight={400}
      variationSettings={AXES}
    />
    <span className="flow-menu-item__label">{label}</span>
    <span className="flow-menu-item__overlay" />
  </button>
);

const RadioRow: React.FC<{ label: string; checked: boolean; onSelect: () => void }> = ({ label, checked, onSelect }) => (
  <button type="button" role="menuitemradio" aria-checked={checked} className="flow-menu-item" onClick={onSelect}>
    <MaterialSymbol
      name={checked ? 'radio_button_checked' : 'radio_button_unchecked'}
      family="google-symbols"
      size={20}
      weight={400}
      variationSettings={AXES}
    />
    <span className="flow-menu-item__label">{label}</span>
    <span className="flow-menu-item__overlay" />
  </button>
);

export const SortFilterMenu: React.FC<{
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  value: SortFilter;
  onChange: (next: SortFilter) => void;
}> = ({ open, onClose, anchorRef, value, onChange }) => {
  const toggle = (list: string[], entry: string) =>
    (list.includes(entry) ? list.filter((x) => x !== entry) : [...list, entry]);

  return (
    <FlowMenu open={open} onClose={onClose} anchorRef={anchorRef} panel width={240}>
      <div className="flow-menu-heading">Type</div>
      {TYPE_OPTIONS.map((t) => (
        <CheckRow key={t} label={t} checked={value.types.includes(t)} onToggle={() => onChange({ ...value, types: toggle(value.types, t) })} />
      ))}
      <div className="flow-menu-heading">Aspect Ratio</div>
      {RATIO_OPTIONS.map((r) => (
        <CheckRow key={r} label={r} checked={value.ratios.includes(r)} onToggle={() => onChange({ ...value, ratios: toggle(value.ratios, r) })} />
      ))}
      <div className="flow-menu-heading">Sort by</div>
      <RadioRow label="Newest first" checked={value.sort === 'newest'} onSelect={() => onChange({ ...value, sort: 'newest' })} />
      <RadioRow label="Oldest first" checked={value.sort === 'oldest'} onSelect={() => onChange({ ...value, sort: 'oldest' })} />
    </FlowMenu>
  );
};
