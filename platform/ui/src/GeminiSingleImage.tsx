// ──────────────────────────────────────────────────────────────────────────────
// Gemini's `single-image` — the centred "hero" image host.
//
// This is a DIFFERENT component from `GeminiInlineImage`. Gemini ships both:
//
//   • `.inline-image-container` — emitted by the *markdown* renderer for an
//     image written into prose. Floated right, capped at 362px. That is
//     `GeminiInlineImage`.
//   • `single-image` — emitted for an image *attachment* on the response
//     (`data-image-attachment-index="0"`). Centred, up to 580px, with a
//     "Source: …" caption beside it. That is this file.
//
// When the user asks Gemini for pictures, it answers with attachments, so this
// is the treatment they actually see. Willow's model speaks markdown, so the
// closest structural analogue is an image alone in its own paragraph — which is
// what `StreamingMarkdown` routes here.
//
// LIVE DOM, captured from a real "images of …" response (viewport 1536×826):
//
//   single-image.spark-licensed-center-host.luminous-layout   263×432  inline
//     div.image-container.spark-licensed-center               263×432  flex column
//         [data-full-size-image-uri="https://upload.wikimedia.org/…"]
//       div.overlay-container.hero-overlay-container          263×432  position:relative
//           style="--hero-declared-width: 263px"
//         button.image-button                                 263×384  display:block
//           img.spark-licensed-portrait.hero-image.loaded     263×380  radius:40px
//               width="263" height="380" loading="lazy"
//         div.hero-caption-row                                263×40   margin-top:8px
//           div.caption.gds-extended-caption.hero-caption     231×40   margin-inline:16px
//             #text  " Sabrina Carpenter performing live. "   230.8×16.8
//             span   "Source: Wikipedia"                      116×16.8
//
// The caption is deliberately two nodes. The description is a BARE TEXT NODE
// with a leading and trailing space; only the attribution is wrapped in a
// `<span>`, and that span computes identically to its parent (13px/20px
// "Google Sans Code", rgb(227,227,227), no margin or padding) — so it carries
// no styling and exists purely as a seam. The trailing space on the text node
// is what separates the two halves, which is why it is written explicitly
// rather than left to JSX, which strips source whitespace.
//
// Four measured facts that are NOT guessable from the stylesheet, each of which
// changes the rendering:
//
//  1. The `<img>` computes `display: inline` / `vertical-align: baseline`. That
//     is why the button is 384px tall around a 380px image — a 4px line-box
//     descender gap, not padding (no author rule sets the button's height at
//     all, and its computed padding and border are both 0; the 384 is a used
//     value from layout). Setting `display: block` here would silently lose
//     those 4px, so we do not. Rebuilt under this file's own stylesheet the
//     numbers land on Gemini's exactly: button 384, image 380, 0 above, 4
//     below. Note when re-probing that the gap only exists in standards mode —
//     a doctype-less `about:blank` renders BackCompat, which drops the line-box
//     strut and reports 0.
//  2. `--hero-declared-width` equals the image's intrinsic width exactly
//     (263 = the `width` attribute = `naturalWidth`). It is the natural width,
//     published as a custom property so the CSS can cap against it.
//  3. `.spark-licensed-center` *declares* `margin-block: var(--gem-sys-spacing--m)`
//     (12px), but the live node computes `margin-top: 0px; margin-bottom: 0px`.
//     The measurement wins; we emit no vertical margin.
//  4. Height arithmetic closes on the measured numbers: 384 + 8 + 40 = 432.
//
// The button is a real `<button>` in Gemini and opens its lightbox. We have no
// lightbox for a cited image, so it opens `data-full-size-image-uri` — the
// original, not the `encrypted-tbn0.gstatic.com` thumbnail that is in `src`.
// Keeping it a `<button>` also keeps it keyboard-reachable, which a bare `<img>`
// with a click handler would not be.
// ──────────────────────────────────────────────────────────────────────────────

import React from 'react';

import { IMAGE_REFERRER_POLICY, resolveImageSource } from './image-source';

/** Gemini's three orientation classes, which drive the width cap. */
export type SingleImageOrientation = 'portrait' | 'landscape' | 'square';

export interface GeminiSingleImageProps {
  src: string;
  alt?: string;
  /**
   * The description half of the caption — Gemini's " Sabrina Carpenter
   * performing live. ", emitted as a bare text node. Defaults to `alt`, which
   * is where a markdown image carries the same sentence.
   */
  caption?: string;
  /**
   * The attribution half — "Source: Wikipedia" — which Gemini wraps in its own
   * `<span>`. Rendered only when present; see the caption note in the header.
   */
  captionSource?: string;
  /** `data-full-size-image-uri` — the original behind a thumbnail `src`. */
  fullSizeUri?: string;
  /** Supplied when known; otherwise measured from the natural size on load. */
  orientation?: SingleImageOrientation;
  /**
   * Gemini publishes the image's intrinsic width as `--hero-declared-width`.
   * Pass it when the payload carries it; otherwise it is read on load.
   */
  declaredWidth?: number;
}

const orientationClass = (o: SingleImageOrientation) => 'smd-spark-licensed-' + o;

export function GeminiSingleImage({
  src,
  alt,
  caption,
  captionSource,
  fullSizeUri,
  orientation,
  declaredWidth,
}: GeminiSingleImageProps) {
  const [measured, setMeasured] = React.useState<SingleImageOrientation | null>(null);
  const [naturalWidth, setNaturalWidth] = React.useState<number | null>(null);
  // Gemini adds `loaded` once the image decodes; `.smd-hero-image.loaded` is what
  // drives the 200ms zoom-in, so a cached image that never fires onLoad simply
  // appears without the animation rather than staying hidden.
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const resolved = orientation || measured;
  const width = declaredWidth != null ? declaredWidth : naturalWidth;

  const onLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    setLoaded(true);
    if (!image.naturalWidth || !image.naturalHeight) return;
    if (declaredWidth == null) setNaturalWidth(image.naturalWidth);
    if (orientation) return;
    setMeasured(
      image.naturalHeight > image.naturalWidth
        ? 'portrait'
        : image.naturalHeight === image.naturalWidth
          ? 'square'
          : 'landscape'
    );
  };

  // A failed image is the case in the report: a card-shaped hole where a picture
  // should be. Gemini's own `.placeholder.error` is a 200px block with a centred
  // message, so that is what replaces the hero rather than an empty box.
  if (failed) {
    return (
      <div className="smd-single-image smd-hero-failed">
        <div className="smd-hero-placeholder smd-hero-error" role="img" aria-label={alt || 'Image unavailable'}>
          <div className="smd-hero-message">
            <svg className="smd-hero-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M21 5v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Zm-2 0H5v14h14V5Zm-7 2.5a1 1 0 0 1 1 1v5a1 1 0 0 1-2 0v-5a1 1 0 0 1 1-1Zm0 8a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z"
              />
            </svg>
            <div className="smd-hero-message-text">Image unavailable</div>
          </div>
        </div>
      </div>
    );
  }

  const openTarget = fullSizeUri || src;
  // Gemini's caption is two nodes, not one: a bare text node carrying the
  // description, then a `<span>` carrying only the attribution. The span has no
  // styling of its own (identical font, colour and metrics to its parent), so it
  // is purely structural — but the description's trailing space is what puts a
  // gap between the two, and JSX would strip it from source, so both padding
  // spaces are written as explicit string children.
  const captionText = caption || alt || '';
  const hasCaption = Boolean(captionText || captionSource);

  return (
    <div className="smd-single-image">
      <div className="smd-image-container" data-full-size-image-uri={fullSizeUri || undefined}>
        <div
          className="smd-hero-overlay-container"
          style={
            width != null
              ? ({ ['--hero-declared-width' as any]: width + 'px' } as React.CSSProperties)
              : undefined
          }
        >
          <button
            type="button"
            className="smd-image-button"
            aria-label={alt ? 'Open image: ' + alt : 'Open image'}
            onClick={() => {
              if (typeof window === 'undefined') return;
              window.open(openTarget, '_blank', 'noopener,noreferrer');
            }}
          >
            <img
              className={
                'smd-hero-image' +
                (resolved ? ' ' + orientationClass(resolved) : '') +
                (loaded ? ' loaded' : '')
              }
              src={resolveImageSource(src)}
              alt={alt || ''}
              loading="lazy"
              decoding="async"
              referrerPolicy={IMAGE_REFERRER_POLICY}
              onLoad={onLoad}
              onError={() => setFailed(true)}
            />
          </button>
          {hasCaption ? (
            <div className="smd-hero-caption-row">
              <div className="smd-hero-caption">
                {captionText ? ' ' + captionText + ' ' : null}
                {captionSource ? <span>{captionSource}</span> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default GeminiSingleImage;
