/**
 * The app rail: Codex's navigation rail, outside Willow's own sidebar. Home,
 * Code, Media and Bots are fixed. Code and Media are reached from here alone —
 * the sidebar has no rows for them in the desktop app — and have the page to
 * themselves, with no sidebar beside them. Customize, Spark and the coding agents
 * (`@willow/harness`) live in Explore (the "…"), from where they can be pinned
 * into the rail below a divider, reordered by dragging and unpinned from their
 * context menu, as in Codex. Claude Code, Codex and Cursor start pinned.
 * Timings, offsets and sizes are Codex's (see AppRail.css); its tooltips and its
 * context menu are Willow's own (TooltipOverlay, MenuPanel), as Willow's buttons
 * and menus have them.
 */
import React, { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { TooltipOverlay } from '@willow/ui/Tooltip';
import { DotsLogo } from '@willow/spark/DotsLogo';
import { HARNESSES, type HarnessId } from '@willow/harness/harnesses';
import { harnessRailGlyph } from '@willow/harness/HarnessLogos';
import {
  EllipsisIcon,
  HomeFilledIcon,
  HomeIcon,
  PhotosFilledIcon,
  PhotosIcon,
  PinFilledIcon,
  PinIcon,
  PluginFilledIcon,
  PluginIcon,
  PluginSmallIcon,
  SparklesIcon,
  SparklesSmallIcon,
  TerminalIcon,
} from './rail-icons';
import {
  $railCustomization,
  RAIL_PIN_LIMIT,
  moveRailPin,
  saveRailCustomization,
  splitRailDestinations,
  toggleRailPin,
} from './rail-pins';
import { MenuPanel } from './MenuPanel';
import './AppRail.css';

export type RailDestinationId = 'home' | 'code' | 'media' | 'dots' | 'customize' | 'spark' | HarnessId;

type Icon = (props: React.SVGProps<SVGSVGElement>) => React.ReactElement;

interface RailDestination {
  id: RailDestinationId;
  label: string;
  icon: Icon;
  /** Codex's filled variant, shown while this is the current destination. */
  selectedIcon?: Icon;
}

interface ExploreDestination extends RailDestination {
  rowIcon: Icon;
  visibleByDefault: boolean;
}

const HOME: RailDestination = { id: 'home', label: 'Home', icon: HomeIcon, selectedIcon: HomeFilledIcon };

const PRIMARY: RailDestination[] = [
  { id: 'code', label: 'Code', icon: TerminalIcon },
  { id: 'media', label: 'Media', icon: PhotosIcon, selectedIcon: PhotosFilledIcon },
  { id: 'dots', label: 'Bots', icon: DotsLogo },
];

const EXPLORE: ExploreDestination[] = [
  { id: 'customize', label: 'Customize', icon: PluginIcon, selectedIcon: PluginFilledIcon, rowIcon: PluginSmallIcon, visibleByDefault: false },
  { id: 'spark', label: 'Spark', icon: SparklesIcon, rowIcon: SparklesSmallIcon, visibleByDefault: false },
  ...HARNESSES.map((harness): ExploreDestination => ({
    id: harness.id,
    label: harness.label,
    icon: harnessRailGlyph(harness.id, 20),
    rowIcon: harnessRailGlyph(harness.id, 16),
    visibleByDefault: harness.pinnedByDefault,
  })),
];

const EXPLORE_HOVER_OPEN_MS = 150;
const EXPLORE_CLOSE_MS = 100;
const EXPLORE_TOWARD_MENU_CLOSE_MS = 1000;
const EXPLORE_EXIT_MS = 200;
const EXPLORE_SIDE_OFFSET = 4;
const EXPLORE_ALIGN_OFFSET = -2;
const EXPLORE_MARGIN = 1;
const DRAG_ACTIVATION_PX = 6;
/** One 36px button plus the rail's 8px gap. */
const RAIL_STEP_PX = 44;
const VIEWPORT_PADDING = 8;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/* ------------------------------------------------------------------------ */
/* Tooltips                                                                  */
/* ------------------------------------------------------------------------ */

type TooltipSide = 'right' | 'above';

interface TooltipState {
  anchor: HTMLElement;
  label: string;
  side: TooltipSide;
}

interface TooltipController {
  show: (anchor: HTMLElement, label: string, side?: TooltipSide) => void;
  hide: () => void;
}

const RailTooltipContext = React.createContext<TooltipController>({ show: () => {}, hide: () => {} });

/** One tooltip for the whole rail, shown as soon as an item is hovered, as Willow's are. */
function useTooltipController() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const show = useCallback((anchor: HTMLElement, label: string, side: TooltipSide = 'right') => {
    setTooltip({ anchor, label, side });
  }, []);
  const hide = useCallback(() => setTooltip(null), []);
  return { tooltip, show, hide };
}

const tooltipTrigger = (tooltip: TooltipController, label: string, side: TooltipSide = 'right') => ({
  onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse') tooltip.show(event.currentTarget, label, side);
  },
  onPointerLeave: () => tooltip.hide(),
  onFocus: (event: React.FocusEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).matches(':focus-visible')) tooltip.show(event.currentTarget, label, side);
  },
  onBlur: () => tooltip.hide(),
});

/** Willow's tooltip, beside the rail item (above an Explore row's pin). */
function RailTooltip({ tooltip }: { tooltip: TooltipState | null }) {
  // The last one stays drawn while it plays its hide.
  const last = useRef<TooltipState | null>(null);
  if (tooltip) last.current = tooltip;
  const shown = tooltip ?? last.current;
  return (
    <TooltipOverlay
      key={shown?.label}
      anchor={shown?.anchor ?? null}
      content={shown?.label ?? ''}
      position={shown?.side ?? 'right'}
      open={tooltip !== null}
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Rail buttons                                                              */
/* ------------------------------------------------------------------------ */

interface RailButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  destination: RailDestination;
  current: boolean;
  /** Held while being dragged: drawn selected, as Codex does. */
  lifted?: boolean;
}

const RailButton = React.forwardRef<HTMLButtonElement, RailButtonProps>(({ destination, current, lifted, ...props }, ref) => {
  const Glyph = current && destination.selectedIcon ? destination.selectedIcon : destination.icon;
  return (
    <button
      ref={ref}
      type="button"
      className="willow-rail__item"
      data-selected={current || lifted ? '' : undefined}
      data-rail-destination={destination.id}
      aria-current={current ? 'page' : undefined}
      aria-label={destination.label}
      {...props}
    >
      <Glyph />
    </button>
  );
});
RailButton.displayName = 'RailButton';

/* ------------------------------------------------------------------------ */
/* Explore                                                                   */
/* ------------------------------------------------------------------------ */

interface ExploreProps {
  current: RailDestinationId;
  pinnedIds: string[];
  onNavigate: (id: RailDestinationId) => void;
  onTogglePin: (id: RailDestinationId) => void;
  theme: string;
}

function ExploreMenu({ current, pinnedIds, onNavigate, onTogglePin, theme }: ExploreProps) {
  const tooltip = useContext(RailTooltipContext);
  const rowId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  /** Opened by hovering, so leaving closes it; a click or a key makes it stay. */
  const hoverOpenRef = useRef(false);
  const openTimerRef = useRef<number | undefined>(undefined);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const exitTimerRef = useRef<number | undefined>(undefined);
  const focusOnOpenRef = useRef<'first' | 'last' | 'menu' | null>(null);

  const clearTimers = () => {
    window.clearTimeout(openTimerRef.current);
    window.clearTimeout(closeTimerRef.current);
  };

  const place = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const height = contentRef.current?.offsetHeight ?? 0;
    setPosition({
      left: trigger.right + EXPLORE_SIDE_OFFSET + EXPLORE_MARGIN,
      top: clamp(trigger.top + EXPLORE_ALIGN_OFFSET + EXPLORE_MARGIN, VIEWPORT_PADDING, window.innerHeight - VIEWPORT_PADDING - height),
    });
  }, []);

  const openMenu = (byPointer: boolean) => {
    clearTimers();
    window.clearTimeout(exitTimerRef.current);
    hoverOpenRef.current = byPointer;
    setAnimated(byPointer);
    setLeaving(false);
    setOpen(true);
    tooltip.hide();
  };

  const closeMenu = useCallback(() => {
    window.clearTimeout(openTimerRef.current);
    window.clearTimeout(closeTimerRef.current);
    hoverOpenRef.current = false;
    if (!open) return;
    if (animated) {
      setLeaving(true);
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = window.setTimeout(() => {
        setOpen(false);
        setLeaving(false);
      }, EXPLORE_EXIT_MS);
    } else {
      setOpen(false);
    }
  }, [animated, open]);

  const scheduleClose = (delay: number) => {
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(closeMenu, delay);
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const target = focusOnOpenRef.current;
    focusOnOpenRef.current = null;
    if (target === 'menu') contentRef.current?.focus({ preventScroll: true });
    else if (target) {
      const rows = contentRef.current?.querySelectorAll<HTMLElement>('[data-explore-row]');
      rows?.[target === 'last' ? rows.length - 1 : 0]?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
  }, [open, place]);

  useEffect(() => {
    if (!open || leaving) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (contentRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeMenu();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (contentRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeMenu();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('resize', place);
    window.addEventListener('blur', closeMenu);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('resize', place);
      window.removeEventListener('blur', closeMenu);
    };
  }, [closeMenu, leaving, open, place]);

  useEffect(() => () => {
    window.clearTimeout(openTimerRef.current);
    window.clearTimeout(closeTimerRef.current);
    window.clearTimeout(exitTimerRef.current);
  }, []);

  const isShown = open && !leaving;
  const exploreCurrent = EXPLORE.some(({ id }) => id === current && !pinnedIds.includes(id));

  const onContentKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      triggerRef.current?.focus();
      return;
    }
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-explore-row]'));
    const rowIndex = rows.findIndex((row) => row.contains(target));
    if (rows.length === 0 || (rowIndex === -1 && target !== event.currentTarget)) return;
    const buttons = Array.from(rows[rowIndex]?.querySelectorAll('button') ?? []);
    let nextRow = rowIndex;
    let column = Math.max(0, buttons.indexOf(target as HTMLButtonElement));
    switch (event.key) {
      case 'ArrowDown':
        nextRow = (rowIndex + 1) % rows.length;
        break;
      case 'ArrowUp':
        nextRow = rowIndex <= 0 ? rows.length - 1 : rowIndex - 1;
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (rowIndex === -1) return;
        const forward = (event.key === 'ArrowRight') !== (getComputedStyle(event.currentTarget).direction === 'rtl');
        column = clamp(column + (forward ? 1 : -1), 0, buttons.length - 1);
        break;
      }
      case 'Home':
      case 'End':
        nextRow = event.key === 'Home' ? 0 : rows.length - 1;
        column = 0;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    const candidate = rows[nextRow].querySelectorAll('button')[column];
    (candidate && !candidate.disabled ? candidate : rows[nextRow].querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="willow-rail__item"
        data-selected={exploreCurrent ? '' : undefined}
        aria-current={exploreCurrent ? 'page' : undefined}
        aria-expanded={isShown}
        aria-haspopup="dialog"
        aria-label="Explore"
        onPointerEnter={(event) => {
          if (event.pointerType !== 'mouse') return;
          window.clearTimeout(closeTimerRef.current);
          if (isShown) return;
          window.clearTimeout(openTimerRef.current);
          openTimerRef.current = window.setTimeout(() => openMenu(true), EXPLORE_HOVER_OPEN_MS);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'mouse') return;
          window.clearTimeout(openTimerRef.current);
          if (!isShown || !hoverOpenRef.current) return;
          const towardMenu = event.clientX >= event.currentTarget.getBoundingClientRect().right - 1;
          scheduleClose(towardMenu ? EXPLORE_TOWARD_MENU_CLOSE_MS : EXPLORE_CLOSE_MS);
        }}
        onClick={() => {
          if (isShown && hoverOpenRef.current) {
            clearTimers();
            hoverOpenRef.current = false;
            contentRef.current?.focus({ preventScroll: true });
            return;
          }
          if (isShown) closeMenu();
          else {
            focusOnOpenRef.current = 'menu';
            openMenu(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.shiftKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
          event.preventDefault();
          event.stopPropagation();
          if (isShown) {
            hoverOpenRef.current = false;
            const rows = contentRef.current?.querySelectorAll<HTMLElement>('[data-explore-row]');
            rows?.[event.key === 'ArrowUp' ? rows.length - 1 : 0]?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
            return;
          }
          focusOnOpenRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
          openMenu(false);
        }}
      >
        <EllipsisIcon />
      </button>
      {open && createPortal(
        <div
          ref={contentRef}
          role="dialog"
          aria-label="Explore"
          tabIndex={-1}
          className={`willow-rail-explore ${theme}`}
          data-state={leaving ? 'closed' : 'open'}
          data-animated={animated ? '' : undefined}
          style={position}
          onPointerEnter={() => window.clearTimeout(closeTimerRef.current)}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse' && hoverOpenRef.current) scheduleClose(EXPLORE_CLOSE_MS);
          }}
          onKeyDown={onContentKeyDown}
          onContextMenu={(event) => event.preventDefault()}
        >
          {EXPLORE.map((destination) => {
            const pinned = pinnedIds.includes(destination.id);
            const limited = !pinned && pinnedIds.length >= RAIL_PIN_LIMIT;
            const pinLabel = limited ? `Up to ${RAIL_PIN_LIMIT} pins allowed` : pinned ? 'Unpin from sidebar' : 'Pin to sidebar';
            const isCurrent = destination.id === current;
            const RowIcon = destination.rowIcon;
            return (
              <div
                key={destination.id}
                role="group"
                aria-labelledby={`${rowId}-${destination.id}`}
                className="willow-rail-explore__row"
                data-explore-row=""
                data-current={isCurrent ? '' : undefined}
                onPointerMove={(event) => {
                  const row = event.currentTarget;
                  if (event.pointerType === 'mouse' && !row.contains(document.activeElement)) {
                    row.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
                  }
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType === 'mouse' && event.currentTarget.contains(document.activeElement)) {
                    contentRef.current?.focus({ preventScroll: true });
                  }
                }}
              >
                <button
                  id={`${rowId}-${destination.id}`}
                  type="button"
                  className="willow-rail-explore__open"
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={() => {
                    closeMenu();
                    onNavigate(destination.id);
                  }}
                >
                  <RowIcon />
                  <span className="willow-rail-explore__label">{destination.label}</span>
                </button>
                <span className="willow-rail-explore__pin-slot" data-reveal={pinned ? undefined : ''} {...tooltipTrigger(tooltip, pinLabel, 'above')}>
                  <button
                    type="button"
                    className="willow-rail-explore__pin"
                    aria-label={pinLabel}
                    disabled={limited}
                    onClick={(event) => {
                      event.stopPropagation();
                      tooltip.hide();
                      onTogglePin(destination.id);
                    }}
                  >
                    {pinned ? <PinFilledIcon /> : <PinIcon />}
                  </button>
                </span>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Pinned destinations                                                       */
/* ------------------------------------------------------------------------ */

interface DragState {
  id: string;
  from: number;
  to: number;
  offset: number;
}

interface PinnedRailProps {
  items: ExploreDestination[];
  current: RailDestinationId;
  onNavigate: (id: RailDestinationId) => void;
  onMove: (fromId: string, toId: string) => void;
  onContextMenu: (destination: ExploreDestination, x: number, y: number) => void;
}

function PinnedRail({ items, current, onNavigate, onMove, onContextMenu }: PinnedRailProps) {
  const tooltip = useContext(RailTooltipContext);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const detachRef = useRef<(() => void) | null>(null);
  const draggable = items.length > 1;

  useEffect(() => () => detachRef.current?.(), []);

  const startPress = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (!draggable || event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    const id = items[index].id;
    let active = false;

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== start.pointerId) return;
      const dy = moveEvent.clientY - start.y;
      if (!active) {
        if (Math.hypot(moveEvent.clientX - start.x, dy) < DRAG_ACTIVATION_PX) return;
        active = true;
        tooltip.hide();
      }
      const offset = clamp(dy, -index * RAIL_STEP_PX, (items.length - 1 - index) * RAIL_STEP_PX);
      const next = { id, from: index, to: index + Math.round(offset / RAIL_STEP_PX), offset };
      dragRef.current = next;
      setDrag(next);
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== start.pointerId) return;
      detach();
      if (!active) return;
      suppressClickRef.current = true;
      const settled = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (endEvent.type === 'pointerup' && settled && settled.to !== settled.from) onMove(settled.id, items[settled.to].id);
    };
    const detach = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      detachRef.current = null;
    };
    detachRef.current?.();
    detachRef.current = detach;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const shiftOf = (index: number) => {
    if (!drag || index === drag.from) return 0;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -RAIL_STEP_PX;
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return RAIL_STEP_PX;
    return 0;
  };

  return (
    <div className="willow-rail__pins" data-dragging={drag ? '' : undefined}>
      {items.map((destination, index) => {
        const dragged = drag?.id === destination.id;
        return (
          <RailButton
            key={destination.id}
            destination={destination}
            current={destination.id === current}
            lifted={dragged}
            data-draggable={draggable ? '' : undefined}
            style={{
              transform: drag ? `translate3d(0, ${dragged ? drag.offset : shiftOf(index)}px, 0)` : undefined,
              transition: dragged ? 'none' : undefined,
              zIndex: dragged ? 10 : undefined,
            }}
            {...(drag ? {} : tooltipTrigger(tooltip, destination.label))}
            onPointerDown={(event) => {
              tooltip.hide();
              startPress(event, index);
            }}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              onNavigate(destination.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              tooltip.hide();
              onContextMenu(destination, event.clientX, event.clientY);
            }}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Context menu                                                              */
/* ------------------------------------------------------------------------ */

interface ContextMenuState {
  destination: ExploreDestination;
  x: number;
  y: number;
}

/** Willow's menu at the pointer, as the page's right-click menu is (ContextMenu). */
function RailContextMenu({ menu, closing, onUnpin, onClose, isLight }: { menu: ContextMenuState; closing: boolean; onUnpin: () => void; onClose: () => void; isLight: boolean }) {
  return (
    <MenuPanel
      entries={[{ label: 'Unpin', icon: { name: 'unpin', family: 'luminous' }, run: () => { onClose(); onUnpin(); } }]}
      label={menu.destination.label}
      isLight={isLight}
      at={{ x: menu.x, y: menu.y }}
      from="pointer"
      closing={closing}
      onClose={onClose}
    />
  );
}

/* ------------------------------------------------------------------------ */
/* The rail                                                                  */
/* ------------------------------------------------------------------------ */

export interface AppRailProps {
  current: RailDestinationId;
  onNavigate: (destination: RailDestinationId) => void;
  isLight: boolean;
}

export function AppRail({ current, onNavigate, isLight }: AppRailProps) {
  const customization = useStore($railCustomization);
  const tooltipController = useTooltipController();
  const { hide: hideTooltip } = tooltipController;
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [menuClosing, setMenuClosing] = useState(false);
  const theme = isLight ? 'willow-rail-theme willow-rail-theme--light' : 'willow-rail-theme';
  const { pinnedIds } = splitRailDestinations(customization, EXPLORE);
  const pinned = pinnedIds.flatMap((id) => EXPLORE.filter((destination) => destination.id === id));

  const go = (id: RailDestinationId) => {
    hideTooltip();
    onNavigate(id);
  };
  const togglePin = (id: RailDestinationId) => {
    const result = toggleRailPin($railCustomization.get(), EXPLORE, id);
    if (!result.limited) saveRailCustomization(result.state);
  };
  // Willow's menus fade out over 100ms after 25ms (`willow-mat-menu-exit`).
  const closeMenu = useCallback(() => setMenuClosing(true), []);
  useEffect(() => {
    if (!menuClosing) return undefined;
    const timer = window.setTimeout(() => {
      setMenu(null);
      setMenuClosing(false);
    }, 125);
    return () => window.clearTimeout(timer);
  }, [menuClosing]);

  return (
    <RailTooltipContext.Provider value={tooltipController}>
      <nav
        className={`willow-rail ${theme}`}
        aria-label="App navigation"
        data-app-navigation-rail=""
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="willow-rail__list">
          {[HOME, ...PRIMARY].map((destination) => (
            <RailButton
              key={destination.id}
              destination={destination}
              current={destination.id === current}
              onPointerDown={hideTooltip}
              onClick={() => go(destination.id)}
              {...tooltipTrigger(tooltipController, destination.label)}
            />
          ))}
          <ExploreMenu current={current} pinnedIds={pinnedIds} onNavigate={go} onTogglePin={togglePin} theme={theme} />
          {pinned.length > 0 && (
            <>
              <div className="willow-rail__separator" aria-hidden="true" />
              <PinnedRail
                items={pinned}
                current={current}
                onNavigate={go}
                onMove={(fromId, toId) => saveRailCustomization(moveRailPin($railCustomization.get(), EXPLORE, fromId, toId))}
                onContextMenu={(destination, x, y) => {
                  setMenu({ destination, x, y });
                  setMenuClosing(false);
                }}
              />
            </>
          )}
        </div>
      </nav>
      <RailTooltip tooltip={tooltipController.tooltip} />
      {menu && <RailContextMenu key={`${menu.destination.id}-${menu.x}-${menu.y}`} menu={menu} closing={menuClosing} isLight={isLight} onClose={closeMenu} onUnpin={() => togglePin(menu.destination.id)} />}
    </RailTooltipContext.Provider>
  );
}
