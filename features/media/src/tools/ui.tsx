/**
 * The Material pieces the Tools pages are built from, as Flow's DOM: the same elements and
 * classes Angular Material renders (`mdc-button mat-mdc-button-base mat-tonal-button
 * flow-button-secondary …`), so `flow-tools.css` — Flow's own stylesheets — styles them. Tags
 * Flow uses are classes here (`mat-icon` is `<span class="mat-icon">`), as the port rewrote its
 * selectors.
 *
 * Overlays (dialogs, tooltips) render into one portal root that carries `ng-flow-tools`, the
 * scope every ported rule sits under, inside a `.cdk-overlay-container` as Flow's do.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ *
 * Icon and buttons
 * ------------------------------------------------------------------ */

export const MatIcon: React.FC<{ name: string; className?: string; fill?: boolean; style?: React.CSSProperties }> = ({ name, className, fill, style }) => (
  <span
    role="img"
    aria-hidden="true"
    data-mat-icon-type="font"
    className={cx('mat-icon notranslate google-symbols mat-icon-no-color', fill && 'fill', className)}
    style={style}
  >
    {name}
  </span>
);

export type FlowVariant = 'primary' | 'secondary' | 'transparent' | 'outlined';
export type FlowSize = 'small' | 'medium' | 'large';

/** Material's appearance for each variant: Flow's flow-button sets it from the variant alone. */
const APPEARANCE: Record<FlowVariant, string> = {
  primary: 'mdc-button--unelevated mat-mdc-unelevated-button',
  secondary: 'mat-tonal-button',
  transparent: 'mat-mdc-button',
  outlined: 'mdc-button--outlined mat-mdc-outlined-button',
};

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  variant?: FlowVariant;
  size?: FlowSize;
  icon?: string;
  iconClassName?: string;
  /** Stands where the icon goes when it is not a glyph (Restore's spinner). */
  leading?: React.ReactNode;
  tooltip?: string;
  tooltipPosition?: TooltipPosition;
  /** The label is wrapped in a span, as Flow's Copy link and Restore are. */
  wrapLabel?: boolean;
  submit?: boolean;
};

export const FlowButton = React.forwardRef<HTMLButtonElement, ButtonProps>(function FlowButton(
  { variant = 'secondary', size = 'medium', icon, iconClassName, leading, tooltip, tooltipPosition, wrapLabel, submit, className, children, ...rest },
  ref,
) {
  const tip = useTooltip(tooltip, tooltipPosition);
  return (
    <button
      ref={ref}
      type={submit ? 'submit' : 'button'}
      className={cx(
        'mdc-button mat-mdc-button-base',
        tooltip && 'mat-mdc-tooltip-trigger',
        className,
        APPEARANCE[variant],
        rest.disabled && 'mat-mdc-button-disabled',
        'mat-unthemed',
        `flow-button-${variant}`,
        `flow-button-${size}`,
        'flow-button-no-touch-target',
      )}
      {...rest}
      onMouseEnter={(e) => { tip.onMouseEnter(e); rest.onMouseEnter?.(e); }}
      onMouseLeave={(e) => { tip.onMouseLeave(); rest.onMouseLeave?.(e); }}
      onMouseDown={(e) => { tip.onMouseDown(); rest.onMouseDown?.(e); }}
    >
      <span className="mat-mdc-button-persistent-ripple mdc-button__ripple" />
      {leading ?? (icon && <MatIcon name={icon} className={iconClassName} />)}
      <span className="mdc-button__label">{wrapLabel ? <span>{children}</span> : children}</span>
      <span className="mat-focus-indicator" />
      <span className="mat-mdc-button-touch-target" />
    </button>
  );
});

type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  icon: string;
  label: string;
  variant?: FlowVariant;
  size?: FlowSize;
  iconClassName?: string;
  fill?: boolean;
  tooltip?: string | null;
  tooltipPosition?: TooltipPosition;
  menuTrigger?: boolean;
};

export const FlowIconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function FlowIconButton(
  { icon, label, variant = 'transparent', size = 'small', iconClassName, fill, tooltip, tooltipPosition, menuTrigger, className, ...rest },
  ref,
) {
  const tip = useTooltip(tooltip === undefined ? label : tooltip ?? undefined, tooltipPosition);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cx(
        'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base',
        menuTrigger && 'mat-mdc-menu-trigger',
        tooltip !== null && 'mat-mdc-tooltip-trigger',
        className,
        rest.disabled && 'mat-mdc-button-disabled',
        'mat-unthemed',
        `flow-icon-button-${variant}`,
        `flow-button-${size}`,
        'flow-icon-button-no-touch-target',
      )}
      {...rest}
      onMouseEnter={(e) => { tip.onMouseEnter(e); rest.onMouseEnter?.(e); }}
      onMouseLeave={(e) => { tip.onMouseLeave(); rest.onMouseLeave?.(e); }}
      onMouseDown={(e) => { tip.onMouseDown(); rest.onMouseDown?.(e); }}
    >
      <span className="mat-mdc-button-persistent-ripple mdc-icon-button__ripple" />
      <MatIcon name={icon} className={iconClassName} fill={fill} />
      <span className="mat-focus-indicator" />
      <span className="mat-mdc-button-touch-target" />
    </button>
  );
});

/* ------------------------------------------------------------------ *
 * flow-toggles (mat-button-toggle-group)
 * ------------------------------------------------------------------ */

export function FlowToggles<T extends string>({ options, value, onChange, className, ariaLabel }: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}): React.ReactElement {
  return (
    <div className={cx('ng-flow-toggles', className)}>
      <div role="group" aria-label={ariaLabel} className="mat-button-toggle-group toggle-group mat-button-toggle-group-appearance-standard">
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <div
              key={o.value}
              className={cx('mat-button-toggle toggle flex-toggle', checked && 'mat-button-toggle-checked', 'mat-button-toggle-appearance-standard mat-button-toggle-animations-enabled')}
            >
              <button
                type="button"
                aria-pressed={checked}
                className="mat-button-toggle-button mat-focus-indicator"
                onClick={() => { if (!checked) onChange(o.value); }}
              >
                <span className="mat-button-toggle-label-content">
                  <span className="toggle-label"><span className="toggle-text">{o.label}</span></span>
                </span>
              </button>
              <span className="mat-button-toggle-focus-overlay" />
              <span className="mat-ripple mat-button-toggle-ripple" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * flow-editable-text: the tool's name in the viewer header
 * ------------------------------------------------------------------ */

export interface EditableTextHandle {
  /** The More options menu's Rename. */
  startEditing(): void;
}

/**
 * Reads as text until focused. Enter commits a changed, non-empty value; Escape or losing focus
 * cancels; Done and Cancel show while editing. The input is as wide as its text plus one.
 */
export const EditableText = React.forwardRef<EditableTextHandle, {
  text: string;
  placeholder?: string;
  onSubmit: (text: string) => void;
}>(function EditableText({ text, placeholder, onSubmit }, ref) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const editing = draft !== null;
  const shown = editing ? draft : text;
  React.useImperativeHandle(ref, () => ({
    startEditing() {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    },
  }), []);
  const cancel = () => { setDraft(null); inputRef.current?.blur(); };
  const commit = () => {
    const next = draft?.trim();
    if (next && next !== text) onSubmit(next);
    cancel();
  };
  return (
    <div className="ng-flow-editable-text">
      <div className="editable-text-container">
        <input
          ref={inputRef}
          type="text"
          aria-label="Editable text"
          className={cx('editable-text-input', editing && 'editing')}
          value={shown}
          size={Math.max(1, (shown || placeholder || '').length + 1)}
          placeholder={placeholder}
          onFocus={() => { if (!editing) setDraft(text); }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') cancel();
          }}
        />
        {editing && (
          <div className="edit-mode-buttons-group" onMouseDown={(e) => e.preventDefault()}>
            <FlowIconButton icon="done" label="Done" iconClassName="flow-icon-s" onClick={commit} />
            <FlowIconButton icon="close" label="Cancel" iconClassName="flow-icon-s" onClick={cancel} />
          </div>
        )}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ *
 * mat-slide-toggle
 * ------------------------------------------------------------------ */

export const SlideToggle: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; label: React.ReactNode; disabled?: boolean; className?: string }> = ({ checked, onChange, label, disabled, className }) => {
  const id = React.useId();
  return (
    <div className={cx('mat-mdc-slide-toggle mat-accent', checked && 'mat-mdc-slide-toggle-checked', disabled && 'mat-mdc-slide-toggle-disabled', className)}>
      <div className="mdc-form-field mat-internal-form-field">
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          className={cx('mdc-switch', checked ? 'mdc-switch--selected mdc-switch--checked' : 'mdc-switch--unselected')}
          onClick={() => onChange(!checked)}
        >
          <div className="mat-mdc-slide-toggle-touch-target" />
          <span className="mdc-switch__track" />
          <span className="mdc-switch__handle-track">
            <span className="mdc-switch__handle">
              <span className="mdc-switch__shadow"><span className="mdc-elevation-overlay" /></span>
              <span className="mdc-switch__ripple"><span className="mat-ripple mat-mdc-slide-toggle-ripple mat-focus-indicator" /></span>
            </span>
          </span>
        </button>
        <label className="mdc-label" htmlFor={id}>{label}</label>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * The overlay root
 * ------------------------------------------------------------------ */

let overlayRoot: HTMLElement | null = null;

/** One `.ng-flow-tools` element on <body> holding the CDK overlay container. */
export function toolsOverlayContainer(): HTMLElement {
  if (overlayRoot && document.body.contains(overlayRoot)) return overlayRoot.firstElementChild as HTMLElement;
  overlayRoot = document.createElement('div');
  overlayRoot.className = 'ng-flow-tools ng-flow-tools-overlays';
  const container = document.createElement('div');
  container.className = 'cdk-overlay-container';
  overlayRoot.appendChild(container);
  document.body.appendChild(overlayRoot);
  return container;
}

/* ------------------------------------------------------------------ *
 * Tooltip (matTooltip): one at a time, below its trigger unless told otherwise
 * ------------------------------------------------------------------ */

export type TooltipPosition = 'below' | 'above' | 'left' | 'right';

interface TooltipState {
  text: string;
  rect: DOMRect;
  position: TooltipPosition;
  id: number;
}

const $tooltip = atom<TooltipState | null>(null);
let tooltipSeq = 0;
/** Material's gap between a trigger and its tooltip. */
const TOOLTIP_GAP = 8;

export function useTooltip(text: string | undefined, position: TooltipPosition = 'below') {
  const shown = React.useRef<number | null>(null);
  const hide = React.useCallback(() => {
    if (shown.current !== null && $tooltip.get()?.id === shown.current) $tooltip.set(null);
    shown.current = null;
  }, []);
  React.useEffect(() => hide, [hide]);
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      if (!text) return;
      tooltipSeq += 1;
      shown.current = tooltipSeq;
      $tooltip.set({ text, rect: e.currentTarget.getBoundingClientRect(), position, id: tooltipSeq });
    },
    onMouseLeave: hide,
    onMouseDown: hide,
  };
}

export const TooltipHost: React.FC = () => {
  const tip = useStore($tooltip);
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  React.useLayoutEffect(() => {
    if (!tip || !ref.current) { setPos(null); return; }
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    const r = tip.rect;
    const clampX = (x: number) => Math.max(8, Math.min(window.innerWidth - w - 8, x));
    if (tip.position === 'right') setPos({ left: r.right + TOOLTIP_GAP, top: r.top + r.height / 2 - h / 2 });
    else if (tip.position === 'left') setPos({ left: r.left - TOOLTIP_GAP - w, top: r.top + r.height / 2 - h / 2 });
    else if (tip.position === 'above') setPos({ left: clampX(r.left + r.width / 2 - w / 2), top: r.top - TOOLTIP_GAP - h });
    else setPos({ left: clampX(r.left + r.width / 2 - w / 2), top: r.bottom + TOOLTIP_GAP });
  }, [tip]);
  if (!tip) return null;
  return createPortal(
    <div
      ref={ref}
      className={`cdk-overlay-pane mat-mdc-tooltip-panel-${tip.position} mat-mdc-tooltip-panel mat-mdc-tooltip-panel-non-interactive`}
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div className="mat-mdc-tooltip-component">
        <div key={tip.id} className="mdc-tooltip mat-mdc-tooltip mat-mdc-tooltip-show">
          <div className="mat-mdc-tooltip-surface mdc-tooltip__surface">{tip.text}</div>
        </div>
      </div>
    </div>,
    toolsOverlayContainer(),
  );
};

/* ------------------------------------------------------------------ *
 * MatDialog
 * ------------------------------------------------------------------ */

const DIALOG_MS = 150;
const DIALOG_EXIT_MS = 75;

/** The dialogs open now, topmost last, so Escape closes only the top one. */
const openDialogs: number[] = [];
let dialogSeq = 0;

export const FlowDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  /** The pane's class, e.g. `flow-share-dialog-panel`. */
  panelClass: string;
  /** The component's host class, e.g. `ng-flow-applet-share-dialog`. */
  hostClass: string;
  backdropClass?: string;
  width?: string;
  maxWidth?: string;
  ariaLabel?: string;
  /** Closing on the backdrop or Escape (Flow's dialogs close on both unless told not to). */
  dismissible?: boolean;
  /** `top-end`: under the page header's right end (Edit description sits at 60px, 16px in). */
  placement?: 'center' | 'top-end';
  children: React.ReactNode;
}> = ({ open, onClose, panelClass, hostClass, backdropClass = 'blurred-backdrop', width, maxWidth, ariaLabel, dismissible = true, placement = 'center', children }) => {
  const [mounted, setMounted] = React.useState(open);
  const [phase, setPhase] = React.useState<'opening' | 'open' | 'closing'>('opening');
  const idRef = React.useRef(0);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) {
      setMounted(true);
      setPhase('opening');
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')));
      return () => cancelAnimationFrame(raf);
    }
    if (!mounted) return undefined;
    setPhase('closing');
    const timer = window.setTimeout(() => setMounted(false), DIALOG_MS);
    return () => window.clearTimeout(timer);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!open) return undefined;
    dialogSeq += 1;
    const id = dialogSeq;
    idRef.current = id;
    openDialogs.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openDialogs[openDialogs.length - 1] !== id) return;
      e.stopPropagation();
      e.preventDefault();
      if (dismissible) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    containerRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const at = openDialogs.indexOf(id);
      if (at >= 0) openDialogs.splice(at, 1);
    };
  }, [open, onClose, dismissible]);

  if (!mounted) return null;
  return createPortal(
    <div
      className="cdk-overlay-popover cdk-global-overlay-wrapper"
      dir="ltr"
      style={placement === 'top-end' ? { justifyContent: 'flex-end', alignItems: 'flex-start' } : { justifyContent: 'center', alignItems: 'center' }}
    >
      <div
        className={cx('cdk-overlay-backdrop', backdropClass, phase === 'open' && 'cdk-overlay-backdrop-showing')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { if (dismissible) onClose(); }}
      />
      <div
        className={cx('cdk-overlay-pane', panelClass, 'mat-mdc-dialog-panel')}
        style={{ position: 'static', width, maxWidth, ...(placement === 'top-end' ? { marginTop: 60, marginRight: 24 } : {}) }}
      >
        <div
          ref={containerRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          className={cx('mat-mdc-dialog-container mdc-dialog cdk-dialog-container', phase === 'open' && 'mdc-dialog--open', phase === 'closing' && 'mdc-dialog--closing')}
          style={{ ['--mat-dialog-transition-duration' as string]: `${phase === 'closing' ? DIALOG_EXIT_MS : DIALOG_MS}ms` }}
        >
          <div className="mat-mdc-dialog-inner-container mdc-dialog__container">
            <div className="mat-mdc-dialog-surface mdc-dialog__surface">
              <div className={cx(hostClass, 'mat-mdc-dialog-component-host')}>{children}</div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    toolsOverlayContainer(),
  );
};
