/**
 * Inline source-attribution chip and its hover card.
 *
 * Every dimension, colour, easing and delay here was extracted from the live
 * Gemini app over CDP rather than authored. The comments record which measured
 * value each rule reproduces, so a future edit can tell an extracted constant
 * from a preference.
 *
 * Structure mirrors Gemini's, minus the Angular host elements:
 *
 *   sources-carousel-inline  →  span.smd-src            (carrier, holds "  ")
 *     source-inline-chip     →  span.smd-src-chip       (position: relative)
 *       button               →  button.smd-src-btn
 *         .source-label-...  →  span.smd-src-label
 *           .source-title    →  span.smd-src-title
 *           .source-count    →  span.smd-src-count
 *       cdk-overlay-pane     →  div.smd-src-pane        (absolute, in-subtree)
 *
 * The pane is a child of the chip, not a portal. Measured: Gemini's own pane
 * lives at `.source-inline-chip-container > .cdk-overlay-popover > .cdk-overlay-pane`,
 * inside the chip's subtree, with `.cdk-overlay-container` holding zero children.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SourceChipItem {
  uri: string;
  title: string;
  domain: string;
  /**
   * Excerpt of the cited page, when the provider sends one. Structurally
   * optional: it mirrors `GroundingSource.snippet`, and only some providers can
   * supply it. See `SourceCard` for which.
   */
  snippet?: string;
}

/**
 * Measured on Gemini: hover opens at 1ms, closes 94ms after the pointer leaves.
 *
 * The open delay is a deliberate local divergence -- 250ms, not Gemini's 1ms --
 * so the card only appears on an intentional dwell instead of flashing whenever
 * the pointer crosses a chip on its way somewhere else. The close delay is still
 * the measured 94ms.
 *
 * Keyboard focus is exempt and keeps the measured value: a focus is already
 * deliberate, and making Tab wait a quarter-second would be a pointless delay
 * for anyone not using a mouse.
 */
const OPEN_DELAY_MS = 250;
const FOCUS_OPEN_DELAY_MS = 1;
const CLOSE_DELAY_MS = 94;

/**
 * The publisher host for a source.
 *
 * `domain` first and `uri` last: the captured payload's `uri` is a redirect, so
 * its hostname is Google's, never the publisher's. The URL branch survives only
 * for sources that predate `domain` (see `readSource` in grounding.ts, which
 * leaves `domain` empty on the 1.5-era payload) — for those, `title` is
 * host-shaped and is the better guess.
 */
const hostFor = (source: SourceChipItem): string => {
  if (source.domain) return source.domain;
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(source.title)) return source.title;
  try {
    const host = new URL(source.uri).hostname;
    return host.endsWith('.google.com') ? '' : host;
  } catch {
    return '';
  }
};

/**
 * Gemini's favicons come from `encrypted-tbn0.gstatic.com/favicon-tbn?q=tbn:…`,
 * whose token is minted server-side per source and cannot be derived from a URL.
 * Google's public favicon endpoint is the closest reproducible equivalent and
 * renders the same 32px source image the extraction showed (`naturalWidth: 32`).
 *
 * Takes the source, NOT its `uri`, because `uri` is a
 * `vertexaisearch.cloud.google.com/grounding-api-redirect/…` link on every
 * grounded chunk — captured live off `streamGenerateContent`, where all five
 * chunks carried one. Asking the endpoint for that host returns HTTP 404 and a
 * 726-byte generic globe, which is exactly the globe that showed on every card.
 * `domain` ("nasa.gov") returns HTTP 200 and the real icon.
 */
const faviconUrl = (source: SourceChipItem): string | null => {
  const host = hostFor(source);
  if (!host) return null;
  return `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(host)}`;
};

/** Chip label: the provider's title, else the bare host. Matches Gemini's mix
 *  of publisher names ("NDTV") and hosts ("www.hindustantimes.com"). */
const labelFor = (source: SourceChipItem): string => {
  if (source.title) return source.title;
  return hostFor(source) || source.uri;
};

/**
 * Row 1 of a card.
 *
 * Gemini shows a publisher NAME here ("Wikipedia", "Rolling Stone India"),
 * measured off its open sidebar. We show a host ("wikipedia.org") because that
 * is all the API sends: a live capture of `groundingChunks` returned exactly
 * `uri`, `title`, `domain` and `searchResultMapping`, with `title` itself set to
 * the host. Gemini resolves its redirects server-side and reads the real page;
 * that name is not derivable from this payload, and inventing one would put a
 * wrong publisher under a real link.
 */
const pathFor = (source: SourceChipItem): string => hostFor(source) || source.uri;

/**
 * Exported because Gemini reuses this exact component in two places: the chip's
 * hover pane and the "View sources" sidebar (`side-bar-sources >
 * inline-source-card`). Measuring the sidebar card returned the same padding
 * (8px), radius (8px), header gap (4px), favicon box (9px content + 1.5px
 * padding), path (13/17, #c4c7c5) and clamped title (15/20, #e3e3e3) already
 * extracted here, so the sidebar renders this rather than a parallel copy.
 *
 * Gemini's sidebar card carries a third row -- a 2-line clamped snippet at
 * 13/17 #c4c7c5 -- which is why its card measures 98.4px tall against our
 * 56.4px.
 *
 * That row renders only when the provider actually sends an excerpt, which is
 * per-provider and not a preference:
 *
 *  - Anthropic sends `cited_text`, up to 150 characters of the cited page. Three
 *    rows, matching Gemini's own card.
 *  - Gemini sends none. A live capture of `streamGenerateContent` showed each
 *    `groundingChunks[].web` carrying exactly four fields -- `uri`, `title`,
 *    `domain`, `searchResultMapping` -- so no snippet and no publisher name.
 *    Gemini's own app fills both by resolving its redirect server-side and
 *    reading the destination page, which the public API does not do for us.
 *  - OpenAI sends a real page title but no excerpt; xAI sends a bare URL.
 *
 * A source with no snippet renders the two-row card unchanged rather than an
 * empty third row, so a provider that cannot supply one degrades to exactly what
 * shipped before instead of showing a gap where text should be.
 */
export const SourceCard: React.FC<{ source: SourceChipItem }> = ({ source }) => {
  const [iconFailed, setIconFailed] = useState(false);
  const icon = iconFailed ? null : faviconUrl(source);
  const path = pathFor(source);
  // On the captured payload `title` IS the host, identical to `domain`, so
  // rendering both rows would print the same string twice -- something Gemini's
  // card never does, since its rows hold a publisher name and a page headline.
  // Drop the row when it would only repeat row 1.
  const title = source.title && source.title !== path ? source.title : '';
  // Clamping is left to CSS (`-webkit-line-clamp: 2`), which cuts at the exact
  // pixel the second line ends and appends a real ellipsis. Trimming to a
  // character count here would break mid-word at a different place for every
  // card width, and the card is fluid.
  const snippet = (source.snippet || '').trim();
  return (
    <a
      className="smd-src-card"
      href={source.uri}
      target="_blank"
      rel="noreferrer noopener"
    >
      <div className="smd-src-card-inner">
        <div className="smd-src-card-header">
          <span className="smd-src-card-icon">
            {icon
              ? <img className="smd-src-card-img" alt="" src={icon} onError={() => setIconFailed(true)} />
              : <span className="smd-src-card-img smd-src-card-img-fallback" />}
          </span>
          <span className="smd-src-card-path">{path}</span>
        </div>
        {title && <div className="smd-src-card-title">{title}</div>}
        {/* The two spans are Gemini's, verbatim. Its live snippet row read
            `<span>“</span>Lyrically, Swift was…<span>”</span>`, so the
            quotation marks are template chrome and not part of the excerpt --
            they sit inside the clamped box and are styled by inheritance, which
            is why neither span carries a class. Reproduced as spans rather than
            folded into the string so the structure matches what was measured. */}
        {snippet && (
          <div className="smd-src-card-snippet">
            <span>{'“'}</span>{snippet}<span>{'”'}</span>
          </div>
        )}
      </div>
    </a>
  );
};

/**
 * The pointer notch. Path and viewBox are Gemini's verbatim:
 * `d="M 0,12 C 4,12 10,0 14,0 C 18,0 24,12 28,12 Z"`, viewBox `0 0 28 12`.
 */
const PointerNotch: React.FC = () => (
  <svg className="smd-src-pointer" viewBox="0 0 28 12" aria-hidden="true">
    <path d="M 0,12 C 4,12 10,0 14,0 C 18,0 24,12 28,12 Z" />
  </svg>
);

/** How long each chip's entrance takes, and the gap between consecutive ones.
 *  Both are local additions, not measured from Gemini -- see the note on
 *  `.smd-src-chip-enter` in streaming-markdown-styles.ts. */
const ENTER_STAGGER_MS = 70;

export interface SourceChipProps {
  sources: SourceChipItem[];
  /** Position of this chip among all chips in the answer, in document order.
   *  Drives the entrance stagger; 0 starts immediately. */
  ordinal?: number;
}

export const SourceChip: React.FC<SourceChipProps> = ({ sources, ordinal = 0 }) => {
  const [open, setOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [shift, setShift] = useState(0);
  /** Viewport coordinates for the portalled pane; null until first measured, so
   *  it is never painted at the top-left corner for a frame before positioning. */
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const chipRef = useRef<HTMLSpanElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const paneId = useId();
  const enterDelay = useRef(ordinal * ENTER_STAGGER_MS).current;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const schedule = useCallback((next: boolean, delay: number) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setOpen(next);
    }, delay);
  }, []);

  useEffect(() => clearTimer, []);

  // Escape closes. Gemini leaves aria-expanded="true" behind when it does this,
  // which is a bug in their implementation; the state is reset here instead.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearTimer();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  /**
   * Gemini centres the pane on the chip and pins its top to the chip's bottom
   * (measured `offsetFromAnchor.anchorBottomToPaneTop: 0`, `dx: -157.74` for a
   * 64.54px chip and a 380px pane — exactly (64.54 - 380) / 2).
   *
   * Their clamp lives in the arrow's `left`; here the pane is clamped to the
   * viewport instead and the arrow is offset by the same amount, which keeps the
   * notch on the chip. Equivalent result, one fewer nested custom property.
   *
   * Coordinates are absolute (viewport) rather than percentage offsets because
   * the pane is portalled to <body> to escape the chat scroller's stacking
   * context -- it no longer shares a containing block with the chip, so it has
   * to be told where the chip is, and re-told whenever the chip moves.
   */
  useEffect(() => {
    if (!open) return;
    const chip = chipRef.current;
    const pane = paneRef.current;
    if (!chip || !pane) return;

    // Last written values, so the per-frame loop below only causes a render when
    // something actually moved.
    let lastTop = NaN;
    let lastLeft = NaN;
    let lastShift = NaN;
    let lastFlipped: boolean | null = null;

    const measure = () => {
      const chipRect = chip.getBoundingClientRect();
      const paneWidth = pane.offsetWidth || 380;
      const centre = chipRect.left + chipRect.width / 2;
      // 20px = --gem-sys-spacing--xl, the viewport gutter Gemini uses in
      // `max-width: calc(100vw - var(--gem-sys-spacing--xl))`.
      const gutter = 20;
      const ideal = centre - paneWidth / 2;
      const clamped = Math.max(gutter, Math.min(ideal, window.innerWidth - paneWidth - gutter));
      const nextShift = Number.isFinite(clamped - ideal) ? clamped - ideal : 0;
      // Flip above the chip when the card would overflow the viewport bottom.
      const paneHeight = pane.offsetHeight || 0;
      const flipUp = chipRect.bottom + paneHeight > window.innerHeight && chipRect.top - paneHeight > 0;
      const nextTop = flipUp ? chipRect.top - paneHeight : chipRect.bottom;
      const nextLeft = Number.isFinite(clamped) ? clamped : 0;

      if (nextShift !== lastShift) {
        lastShift = nextShift;
        setShift(nextShift);
      }
      if (flipUp !== lastFlipped) {
        lastFlipped = flipUp;
        setFlipped(flipUp);
      }
      if (nextTop !== lastTop || nextLeft !== lastLeft) {
        lastTop = nextTop;
        lastLeft = nextLeft;
        setPosition({ top: nextTop, left: nextLeft });
      }
    };

    // A per-frame loop rather than scroll + resize listeners. Those two cover
    // only some of the ways the chip moves: a measured 16.51px drift came from a
    // late webfont swap reflowing the paragraph, with no scroll and no resize
    // involved. A loading image, a streaming token, or the sources sidebar
    // opening would each do the same, and the pane would sit visibly off its
    // chip -- the failure the absolute-inside-the-chip version could not have.
    // Re-measuring every frame restores that always-attached behaviour; state is
    // written only when a value changes, and the loop exists only while the pane
    // is open, which is a hover at a time.
    let frame = window.requestAnimationFrame(function tick() {
      measure();
      frame = window.requestAnimationFrame(tick);
    });
    measure();
    return () => window.cancelAnimationFrame(frame);
  }, [open, sources.length]);

  if (!sources.length) return null;

  const primary = labelFor(sources[0]);
  const extra = sources.length - 1;
  const ariaLabel = sources.length === 1
    ? `View source details for citation from ${primary}. Press Enter to open sources dialog.`
    : `View source details for citations from ${sources.map(labelFor).join(' and ')}. Press Enter to open sources dialog.`;

  return (
    // The two spaces are content, not margin — Gemini emits a literal two-space
    // text node here (measured 7.47px at 17px), preserved by `white-space: pre-wrap`.
    <span className="smd-src">
      {'  '}
      <span
        ref={chipRef}
        className="smd-src-chip smd-src-chip-enter"
        // Frozen at mount, matching `Word`'s settledAtMount idiom: if a later
        // render shifts this chip's ordinal, the delay must not change
        // mid-flight and restart the fade on an already-visible chip.
        style={{ animationDelay: enterDelay + 'ms' }}
        onMouseEnter={() => schedule(true, OPEN_DELAY_MS)}
        onMouseLeave={() => schedule(false, CLOSE_DELAY_MS)}
      >
        <button
          type="button"
          className="smd-src-btn"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? paneId : undefined}
          aria-label={ariaLabel}
          onFocus={() => schedule(true, FOCUS_OPEN_DELAY_MS)}
          onBlur={() => schedule(false, CLOSE_DELAY_MS)}
          onClick={() => {
            clearTimer();
            setOpen((value) => !value);
          }}
        >
          <span className="smd-src-label">
            <span className="smd-src-title">{primary}</span>
            {extra > 0 && <span className="smd-src-count">{`+ ${extra}`}</span>}
          </span>
        </button>
        {open && typeof document !== 'undefined' && createPortal(
          <div
            ref={paneRef}
            id={paneId}
            role="dialog"
            className={'smd-src-pane' + (flipped ? ' smd-src-pane-above' : '')}
            style={{
              ['--smd-src-shift' as any]: `${shift}px`,
              top: position ? position.top : 0,
              left: position ? position.left : 0,
              // Hidden for the single frame before the first measurement, so the
              // pane never flashes at the viewport's top-left corner.
              visibility: position ? undefined : 'hidden',
            }}
            // The hover bridge, re-established. Inside the chip the pane was a
            // descendant, so the pointer never left the chip on its way down;
            // portalled to <body> it is not, and moving onto the pane fires the
            // chip's mouseleave. These re-open on entry and re-arm the close on
            // exit, restoring the behaviour the DOM used to give for free.
            onMouseEnter={() => {
              clearTimer();
              setOpen(true);
            }}
            onMouseLeave={() => schedule(false, CLOSE_DELAY_MS)}
          >
            <div className="smd-src-card-shell">
              <PointerNotch />
              <div className="smd-src-stack">
                {sources.map((source, index) => (
                  <SourceCard key={`${source.uri}-${index}`} source={source} />
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
      </span>
    </span>
  );
};
