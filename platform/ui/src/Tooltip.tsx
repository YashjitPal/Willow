import * as React from 'react';
import { createPortal } from 'react-dom';
import './Tooltip.css';

/**
 * Gemini's tooltip.
 *
 * Every visual value lives in `Tooltip.css` and was measured off
 * gemini.google.com rather than chosen — see the header comment there. This
 * file is the behaviour: what opens it, where it goes, and when it leaves.
 *
 * Two ways in:
 *
 *   <GlobalTooltips />                     mounted once, app-wide
 *
 * replaces the browser's native `title=` bubble everywhere, which is how the
 * ~230 existing call sites get it without being touched; and
 *
 *   <Tooltip content="Open sidebar" position="right"><button …/></Tooltip>
 *
 * for anything that needs an explicit placement or rich content.
 */

export type TooltipPosition = 'above' | 'below' | 'left' | 'right';

/**
 * Measured transform-origins, one per placement. Gemini sets these inline on
 * the wrapper from JS, so they are not in any stylesheet and cannot be read
 * from the CSSOM — these came off `getComputedStyle` on live tooltips:
 * left `167.113px 16px` on a 167.113 x 32 box (= right center), right
 * `0px 16px` (= left center), below `100px 0px` on a 200-wide box (= center
 * top), above `100px 48px` on a 48-tall box (= center bottom).
 */
const TRANSFORM_ORIGIN: Record<TooltipPosition, string> = {
  left: 'right center',
  right: 'left center',
  below: 'center top',
  above: 'center bottom',
};

const OPPOSITE: Record<TooltipPosition, TooltipPosition> = {
  left: 'right',
  right: 'left',
  below: 'above',
  above: 'below',
};

const POSITIONS = ['above', 'below', 'left', 'right'] as const;
const PANE_CLASSES = POSITIONS.map((p) => `willow-tooltip-pane--${p}`);

/** The measured gap between anchor edge and tooltip box, on all four sides. */
const OFFSET = 8;

/**
 * How close the box may sit to a viewport edge once centring would overrun it.
 *
 * Measured on Gemini by shifting a trigger past each edge with a temporary
 * inline transform and reading the pane's inline `left`. The two margins are
 * genuinely different, and that asymmetry is reproduced deliberately rather
 * than averaged away:
 *
 *   left  clamp  anchor.x=8  -> left: 8px      anchor.x=28 -> left: 8px
 *   right clamp  clientWidth 1536 -> left: 1325px   (= 1536 - 15 - 196)
 *                clientWidth 1200 -> left:  989px   (= 1200 - 15 - 196)
 *                clientWidth 1000 -> left:  789px   (= 1000 - 15 - 196)
 *
 * `clientWidth - MARGIN_FAR - paneOffsetWidth` reproduces all three exactly.
 * The clamp is a true clamp, not a nudge: pushing the anchor from 1400 to
 * 2000px off-screen left the pane pinned at 1325px every time.
 *
 * The asymmetry comes from CDK comparing overflow against the viewport's
 * *width* rather than its right edge, so the near margin is the viewport
 * margin and the far one is roughly double it. The vertical pair is the same
 * code path in CDK and is applied here by that reasoning — the horizontal pair
 * is what was measured.
 */
const MARGIN_NEAR = 8;
const MARGIN_FAR = 15;

const clamp = (value: number, min: number, max: number) =>
  max < min ? min : Math.min(Math.max(value, min), max);

/**
 * Measured hide duration. The overlay is torn down on `animationend`; the
 * timer only exists so a dropped animation event cannot strand it on screen.
 */
const HIDE_DURATION_MS = 75;

/**
 * Gemini left-aligns a tooltip that had to wrap and centres one that did not.
 *
 * The rule is Material's, read verbatim out of the shipped bundle rather than
 * inferred from how the bubbles look:
 *
 *   Sa() { var a = this.wc.Ua.getBoundingClientRect();
 *          return a.height > 24 && a.width >= 200 }
 *
 * feeding `_.Q("mdc-tooltip--multiline", b.eCc)` in the template. Both numbers
 * are the surface's own limits — `min-height: 24px` and `max-width: 200px` —
 * so the test really asks "is this taller than one line AND pinned at the
 * cap", which is the same as "did it wrap".
 *
 * Reproduced as a rule, not as a per-call-site flag: the sidebar tabs are
 * simply the first tooltips long enough to trip it.
 */
const isMultiline = (surface: HTMLElement) => {
  const box = surface.getBoundingClientRect();
  return box.height > 24 && box.width >= 200;
};

/**
 * One overlay host for the whole app, appended to `<body>` — Gemini does the
 * same with `.cdk-overlay-container`. Queried before creating so React's
 * StrictMode double-invoke cannot produce two.
 */
function getOverlayContainer(): HTMLElement {
  const existing = document.querySelector<HTMLElement>('.willow-tooltip-container');
  if (existing) return existing;
  const el = document.createElement('div');
  el.className = 'willow-tooltip-container';
  document.body.appendChild(el);
  return el;
}

type Phase = 'hidden' | 'shown' | 'hiding';

interface TooltipOverlayProps {
  anchor: HTMLElement | null;
  content: React.ReactNode;
  position: TooltipPosition;
  open: boolean;
  className?: string;
  /** Id for the visually-hidden description node, when the caller wires aria. */
  descriptionId?: string;
}

/**
 * The floating half: portal, placement, and the show/hide animation. Shared by
 * `Tooltip` and `GlobalTooltips` so there is exactly one implementation of the
 * measured geometry.
 */
function TooltipOverlay({
  anchor,
  content,
  position,
  open,
  className,
  descriptionId,
}: TooltipOverlayProps) {
  const [container] = React.useState(getOverlayContainer);
  const [phase, setPhase] = React.useState<Phase>('hidden');
  const paneRef = React.useRef<HTMLDivElement | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setPhase((p) => (open ? 'shown' : p === 'shown' ? 'hiding' : p));
  }, [open]);

  /**
   * Place the pane against the anchor.
   *
   * Measured, Gemini pins the pane flush to the anchor edge and lets the CSS
   * `translate` supply the 8px gap and the cross-axis centring, so the only
   * numbers written here are anchor coordinates. Which inset property is used
   * per side is also measured: `right` for left-placement and `bottom` for
   * above-placement, so the box grows away from the anchor, not toward it.
   */
  const reposition = React.useCallback(() => {
    const pane = paneRef.current;
    const wrapper = wrapperRef.current;
    if (!anchor || !anchor.isConnected || !pane || !wrapper) return;

    // Measure against the whole viewport first. The pane is absolutely
    // positioned with `width: auto`, so it shrink-to-fits into whatever space
    // is left of its own `left` — measuring it while it still sits at its
    // previous position near an edge reports a squeezed box (a right-edge
    // anchor produced 43x224 instead of 148x32) and every number after that is
    // computed from the wrong width.
    pane.style.top = '0px';
    pane.style.left = '0px';
    pane.style.right = '';
    pane.style.bottom = '';

    const a = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = pane.offsetWidth;
    const h = pane.offsetHeight;

    // Fall back to the opposite side when the preferred one does not fit —
    // measured on Gemini by shrinking the viewport until `below` became
    // `above` (pane flipped to "bottom: 92px; transform: translateY(-8px)").
    const fits: Record<TooltipPosition, boolean> = {
      below: a.bottom + OFFSET + h <= vh,
      above: a.top - OFFSET - h >= 0,
      right: a.right + OFFSET + w <= vw,
      left: a.left - OFFSET - w >= 0,
    };
    const placement = fits[position] || !fits[OPPOSITE[position]] ? position : OPPOSITE[position];

    pane.classList.remove(...PANE_CLASSES);
    pane.classList.add(`willow-tooltip-pane--${placement}`);
    pane.style.top = '';
    pane.style.right = '';
    pane.style.bottom = '';
    pane.style.left = '';

    // Cross-axis: centre on the anchor, then clamp inside the viewport. Written
    // as an absolute coordinate because a `translate(-50%)` cannot clamp.
    const centredLeft = clamp(a.left + a.width / 2 - w / 2, MARGIN_NEAR, vw - MARGIN_FAR - w);
    const centredTop = clamp(a.top + a.height / 2 - h / 2, MARGIN_NEAR, vh - MARGIN_FAR - h);

    switch (placement) {
      case 'below':
        pane.style.top = `${a.bottom}px`;
        pane.style.left = `${centredLeft}px`;
        break;
      case 'above':
        pane.style.bottom = `${vh - a.top}px`;
        pane.style.left = `${centredLeft}px`;
        break;
      case 'right':
        pane.style.left = `${a.right}px`;
        pane.style.top = `${centredTop}px`;
        break;
      case 'left':
        pane.style.right = `${vw - a.left}px`;
        pane.style.top = `${centredTop}px`;
        break;
    }

    wrapper.style.transformOrigin = TRANSFORM_ORIGIN[placement];

    // Alignment last, and imperatively, for the same reason Material does it in
    // its own post-show hook: the test reads the surface's rendered box, so it
    // can only run once the box exists and has been placed. It only changes
    // `text-align`, so it cannot invalidate the measurement it just made.
    const surface = surfaceRef.current;
    if (surface) {
      surface.classList.toggle('willow-tooltip-surface--multiline', isMultiline(surface));
    }
  }, [anchor, position]);

  /**
   * Position, then reveal — both before paint, so the corrected placement is
   * never a frame the user sees. The wrapper starts at `opacity: 0` (its
   * measured first frame), so even the intermediate state is invisible.
   *
   * The modifier classes are written imperatively rather than rendered: they
   * have to be applied *after* `reposition()` has measured the box, and React
   * only rewrites `className` when the prop value changes, so it never fights
   * this.
   */
  React.useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    if (phase === 'shown') {
      reposition();
      wrapper.classList.remove('willow-tooltip--hide');
      wrapper.classList.add('willow-tooltip--show');
    } else if (phase === 'hiding') {
      wrapper.classList.remove('willow-tooltip--show');
      wrapper.classList.add('willow-tooltip--hide');
    }
  }, [phase, reposition, content]);

  // Tear down when the hide animation ends, which is what Gemini does —
  // measured detach landed 92-105ms after mouseleave for a 75ms animation.
  React.useEffect(() => {
    if (phase !== 'hiding') return;
    const wrapper = wrapperRef.current;
    const done = () => setPhase('hidden');
    wrapper?.addEventListener('animationend', done);
    const timer = window.setTimeout(done, HIDE_DURATION_MS + 50);
    return () => {
      wrapper?.removeEventListener('animationend', done);
      window.clearTimeout(timer);
    };
  }, [phase]);

  // Follow the anchor while visible; the overlay is fixed to the viewport, so a
  // scroll anywhere in the ancestor chain moves the anchor out from under it.
  React.useEffect(() => {
    if (phase !== 'shown') return;
    const onMove = () => reposition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [phase, reposition]);

  return createPortal(
    <>
      {/*
        The accessible name lives here, off-screen and always present, exactly
        as Gemini does it: a visually-hidden `role="tooltip"` node the trigger
        points at with aria-describedby, while the visible tooltip carries
        aria-hidden so it is not announced twice. It sits in the overlay
        container rather than beside the trigger so it can never become a flex
        or grid item in the caller's layout.
      */}
      {descriptionId && (
        <span id={descriptionId} role="tooltip" className="willow-tooltip-description">
          {content}
        </span>
      )}
      {phase !== 'hidden' && (
        <div ref={paneRef} className={`willow-tooltip-pane willow-tooltip-pane--${position}`}>
          <div ref={wrapperRef} className="willow-tooltip" aria-hidden="true">
            <div
              ref={surfaceRef}
              className={
                className ? `willow-tooltip-surface ${className}` : 'willow-tooltip-surface'
              }
            >
              {content}
            </div>
          </div>
        </div>
      )}
    </>,
    container,
  );
}

export interface TooltipProps {
  /** Tooltip text. Empty content renders no tooltip, matching MatTooltip. */
  content: React.ReactNode;
  /** Preferred side. Flips to the opposite side when there is no room. */
  position?: TooltipPosition;
  /** Suppresses the tooltip without unmounting the child. */
  disabled?: boolean;
  /** Extra classes on the painted surface. */
  className?: string;
  children: React.ReactElement;
}

/**
 * Explicit tooltip. The child must be a single element that forwards `ref` and
 * DOM handlers; it gets `aria-describedby` and the enter/leave/focus listeners
 * cloned onto it.
 */
export function Tooltip({
  content,
  position = 'below',
  disabled = false,
  className,
  children,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const descriptionId = React.useId();

  const active = !disabled && content !== null && content !== undefined && content !== '';

  React.useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);

  // Escape dismisses, matching MatTooltip's overlay keydown handler.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const child = React.Children.only(children) as React.ReactElement<
    Record<string, unknown> & { ref?: React.Ref<HTMLElement> }
  >;

  // The child's own ref, kept in a ref so `attachAnchor` can stay stable — a
  // ref callback whose identity changes every render is detached and
  // reattached on every render.
  const childRef = React.useRef<React.Ref<HTMLElement> | undefined>(undefined);
  childRef.current = child.props.ref;

  const attachAnchor = React.useCallback((node: HTMLElement | null) => {
    setAnchor(node);
    const forwarded = childRef.current;
    if (typeof forwarded === 'function') forwarded(node);
    else if (forwarded && typeof forwarded === 'object') {
      (forwarded as React.RefObject<HTMLElement | null>).current = node;
    }
  }, []);

  if (!active) return children;

  const chain = (existing: unknown, ours: () => void) => (event: React.SyntheticEvent) => {
    (existing as ((e: React.SyntheticEvent) => void) | undefined)?.(event);
    ours();
  };

  const describedBy = [child.props['aria-describedby'], descriptionId].filter(Boolean).join(' ');

  const trigger = React.cloneElement(child, {
    ref: attachAnchor,
    'aria-describedby': describedBy,
    onMouseEnter: chain(child.props.onMouseEnter, () => setOpen(true)),
    onMouseLeave: chain(child.props.onMouseLeave, () => setOpen(false)),
    // Keyboard focus opens it — verified by dispatching a real Tab over CDP
    // (a synthetic FocusEvent never reaches Angular's FocusMonitor, so the
    // obvious test says "no" and is wrong). `:focus-visible` is the browser's
    // own keyboard-vs-pointer heuristic, which is what FocusMonitor emulates.
    onFocus: chain(child.props.onFocus, () => {
      if (anchor?.matches(':focus-visible')) setOpen(true);
    }),
    onBlur: chain(child.props.onBlur, () => setOpen(false)),
  });

  return (
    <>
      {trigger}
      <TooltipOverlay
        anchor={anchor}
        content={content}
        position={position}
        open={open}
        className={className}
        descriptionId={descriptionId}
      />
    </>
  );
}

/** Where the stripped `title` is parked while the Gemini tooltip stands in. */
const STASH_ATTR = 'data-willow-tooltip';
/** Marks an `aria-label` this component added, so it is removed again. */
const OWNED_LABEL_ATTR = 'data-willow-tooltip-label';
/** Opt-in placement override, e.g. `data-tooltip-position="right"`. */
const POSITION_ATTR = 'data-tooltip-position';

function readPosition(el: HTMLElement): TooltipPosition {
  const raw = el.getAttribute(POSITION_ATTR);
  return (POSITIONS as readonly string[]).includes(raw ?? '')
    ? (raw as TooltipPosition)
    : 'below';
}

/**
 * Swap the native `title` bubble for Gemini's, everywhere, without touching the
 * ~230 call sites that use it.
 *
 * The browser will only stop drawing its own tooltip if the attribute is gone,
 * so the title is moved to `data-willow-tooltip` on the way in and put back on
 * the way out. Chrome shows the native bubble after a hover dwell of several
 * hundred ms, and this fires on `mouseover`, so the swap always wins the race.
 *
 * `title` also contributes an accessible name when nothing else does, so if the
 * element has no name of its own the text is mirrored into `aria-label` while
 * the attribute is away — tagged, so only labels this added get cleaned up.
 */
export function GlobalTooltips() {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [text, setText] = React.useState('');
  const [position, setPosition] = React.useState<TooltipPosition>('below');
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    const restore = (el: HTMLElement | null) => {
      if (!el) return;
      const stashed = el.getAttribute(STASH_ATTR);
      if (stashed !== null) {
        // Only put it back if nothing re-set `title` in the meantime.
        if (!el.hasAttribute('title')) el.setAttribute('title', stashed);
        el.removeAttribute(STASH_ATTR);
      }
      if (el.hasAttribute(OWNED_LABEL_ATTR)) {
        el.removeAttribute('aria-label');
        el.removeAttribute(OWNED_LABEL_ATTR);
      }
    };

    const close = () => {
      setOpen(false);
      restore(anchorRef.current);
      anchorRef.current = null;
    };

    const openFor = (el: HTMLElement) => {
      if (anchorRef.current === el) return;
      restore(anchorRef.current);

      const title = el.getAttribute('title');
      if (title === null || title.trim() === '') return;

      el.setAttribute(STASH_ATTR, title);
      el.removeAttribute('title');
      // `title` was the accessible name only if nothing else provides one.
      if (
        !el.getAttribute('aria-label') &&
        !el.getAttribute('aria-labelledby') &&
        !el.textContent?.trim()
      ) {
        el.setAttribute('aria-label', title);
        el.setAttribute(OWNED_LABEL_ATTR, '');
      }

      anchorRef.current = el;
      setAnchor(el);
      setText(title);
      setPosition(readPosition(el));
      setOpen(true);
    };

    // Capture phase: the attribute has to be gone before anything else can
    // react to the hover, and `closest` still needs to find the element the
    // title is actually on, not whichever child the pointer landed in.
    const onOver = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[title]');
      if (el) openFor(el);
      else if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) close();
    };

    const onOut = (e: MouseEvent) => {
      const current = anchorRef.current;
      if (!current) return;
      const next = e.relatedTarget as Node | null;
      if (!next || !current.contains(next)) close();
    };

    const onFocusIn = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[title]');
      if (el && el.matches(':focus-visible')) openFor(el);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    /*
     * A click on the anchor itself must NOT restore `title`. The pointer is
     * still sitting on the button, so putting the attribute back hands the
     * native bubble straight to Chrome — and on a toggle it is worse: the label
     * changes ("Temporary chat" -> "Exit temporary chat"), React sees a changed
     * prop and re-adds the attribute we had removed, so the native tooltip
     * appears even though nothing restored it. Both paths end in the same flash.
     *
     * So keep the tooltip anchored and re-strip on the next frame, adopting
     * whatever label the click produced. `isConnected` is the guard the plain
     * `close` used to provide: a click that unmounts or navigates leaves no
     * mouseout behind, and that tooltip still has to go.
     */
    const onClick = (e: MouseEvent) => {
      const el = anchorRef.current;
      if (!el || !el.contains(e.target as Node)) {
        close();
        return;
      }
      requestAnimationFrame(() => {
        if (anchorRef.current !== el) return;
        if (!el.isConnected) {
          close();
          return;
        }
        const next = el.getAttribute('title');
        if (next !== null && next.trim() !== '') {
          el.setAttribute(STASH_ATTR, next);
          el.removeAttribute('title');
          setText(next);
        }
      });
    };

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', close, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('blur', close);

    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', close, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('blur', close);
      close();
    };
  }, []);

  // Close if the anchor leaves the DOM while shown — a button that unmounts
  // mid-hover fires no mouseout.
  React.useEffect(() => {
    if (!open || !anchor) return;
    const observer = new MutationObserver(() => {
      if (!anchor.isConnected) setOpen(false);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open, anchor]);

  return (
    <TooltipOverlay
      // Remounting on anchor change replays the 150ms show animation when the
      // pointer moves between two adjacent tooltipped buttons, which is what
      // Gemini does — there, each trigger owns a separate overlay.
      key={text}
      anchor={anchor}
      content={text}
      position={position}
      open={open}
    />
  );
}

export default Tooltip;
