// ──────────────────────────────────────────────────────────────────────────────
// Gemini's plain in-chat image — the `.inline-image-container` treatment.
//
// Gemini has three separate image components (`single-image`, `inline-image`,
// and this one). This is the one its *markdown renderer* emits, so it is the
// one that maps onto Willow's markdown pipeline. Its emitter, verbatim from the
// bundle (method `Yb`, with `_.X1` = escape):
//
//   Yb(a, b) {
//     var c = _.X1(a.alt),
//       d = `<div class="inline-image-wrapper">${
//         `<img class="inline-img" src="${_.X1(a.url)}" alt="${c}" />`}</div>`,
//       e = "", f = !(!a.Af || !a.Sh), g = !!c;
//     if (f || g) {
//       e = "";
//       f && (e += `<span class="credit-line">${_.X1(a.Sh)}</span>`);
//       f && g && (e += '<span class="caption-separator"> · </span>');
//       g && (e += c);
//       e = `<span class="inline-image-caption gds-extended-caption">${e}</span>`;
//     }
//     return V3({ tag: "div", classes: ["inline-image-container", a.orientation],
//                 content: d + e });
//   }
//
// Three things follow from that source, and they are why this file is not just
// the stylesheet transcribed:
//
//  1. The wrapper holds the `<img>` ALONE. The sheet also defines
//     `.inline-image-source` and `.inline-expand-button` inside the wrapper,
//     but this emitter never produces them — they belong to another host that
//     shares the sheet. Building them here would add chrome Gemini does not
//     show on a markdown image, so they are deliberately omitted.
//  2. The caption is a single line: credit, then " · ", then the alt text, and
//     it only exists if there is a credit or an alt. Separator only when both.
//  3. `orientation` is a class on the container, and the sheet keys the width
//     off it: `.landscape { max-width: 362px }`, `.portrait { max-width: 300px }`.
//
// GEOMETRY, measured with a probe node injected into the live markdown panel at
// a 1536px viewport (removed again in a `finally`):
//
//   container  float:right  max-width:362px  margin-inline-start:16px  overflow:hidden
//   wrapper    position:relative  overflow:hidden  border-radius:28px
//              margin-block-start:24px  cursor:pointer
//
// The wrapper's `cursor: pointer` is Gemini's, so the image has to actually do
// something on click or the cursor lies. Gemini opens its own lightbox; we have
// no equivalent for a cited image (the fullscreen viewer is for canvas media
// with a status and a ratio), so it opens the source in a new tab.
//   img        display:block  width:100%  height:auto
//   caption    display:block  padding-block:8px 24px  padding-inline-start:16px
//              color:rgb(227,227,227)  ellipsis  nowrap
//              "Google Sans Code", monospace  13px/20px  italic  MONO 0, wght 400
//
// The float is inside `@media (min-width: 768px)`; below that the container is
// static and full width. That media block also sets `max-width: 40%`, but the
// authored sheet puts `.landscape`/`.portrait` AFTER it, so the orientation cap
// wins — which is why the probe measured 362px and not 40% of the 708px panel.
// Source order is therefore load-bearing and is preserved.
//
// A `@media (max-width: 959.98px)` override that undoes the float exists in the
// captured CSS, but it targets `.hero-overlay-container` / `.hero-image` — the
// separate `single-image` component. It never applies to this path, so it is
// deliberately NOT reproduced here.
//
// The float is not contained: probed with a tall image plus a short following
// paragraph, the panel grew to 766px while the float's bottom reached 1255px,
// 559px past the panel bottom. Gemini lets it overhang. We match that rather
// than adding a clearfix Gemini does not have.
// ──────────────────────────────────────────────────────────────────────────────

import React from 'react';

import { IMAGE_REFERRER_POLICY, resolveImageSource } from './image-source';

export type InlineImageOrientation = 'landscape' | 'portrait';

export interface GeminiInlineImageProps {
  src: string;
  /** Becomes the caption's trailing text, exactly as `alt` does in Gemini. */
  alt?: string;
  /** `Sh` in the emitter — the credit, shown before the separator. */
  credit?: string;
  orientation?: InlineImageOrientation;
}

/**
 * Orientation is a class rather than a measured ratio, so it has to be decided
 * before the image loads. Gemini's own value arrives with the payload; when we
 * have no metadata we settle it from the natural size on load, defaulting to
 * landscape (the wider cap) so a late correction only ever narrows the box.
 */
export function GeminiInlineImage({
  src,
  alt,
  credit,
  orientation,
}: GeminiInlineImageProps) {
  const [measured, setMeasured] = React.useState<InlineImageOrientation | null>(null);
  const [failed, setFailed] = React.useState(false);
  const resolved = orientation || measured || 'landscape';

  const hasCredit = Boolean(credit);
  const hasAlt = Boolean(alt);
  const showCaption = hasCredit || hasAlt;

  // A refused or missing image renders nothing at all, container and caption
  // included. Gemini has no failure treatment on this path to copy — the hero's
  // `.placeholder.error` is a 200px centred block measured on a 263px-wide
  // attachment, and stretching it to a 362px floated box would be inventing
  // geometry. Nothing is also the least disruptive outcome here specifically:
  // the container floats, so its absence just lets the prose reflow, whereas a
  // placeholder would push a paragraph around an image that does not exist.
  // The credit line goes with it, since a credit for an unshown picture is noise.
  if (failed) return null;

  return (
    <div className={'smd-inline-image-container smd-inline-' + resolved}>
      <div
        className="smd-inline-image-wrapper"
        onClick={() => {
          if (typeof window === 'undefined') return;
          window.open(src, '_blank', 'noopener,noreferrer');
        }}
      >
        <img
          className="smd-inline-img"
          src={resolveImageSource(src)}
          alt={alt || ''}
          loading="lazy"
          decoding="async"
          referrerPolicy={IMAGE_REFERRER_POLICY}
          onError={() => setFailed(true)}
          onLoad={
            orientation
              ? undefined
              : (event) => {
                  const image = event.currentTarget;
                  if (!image.naturalWidth || !image.naturalHeight) return;
                  setMeasured(
                    image.naturalHeight > image.naturalWidth ? 'portrait' : 'landscape'
                  );
                }
          }
        />
      </div>
      {showCaption ? (
        <span className="smd-inline-image-caption">
          {hasCredit ? <span className="smd-inline-credit">{credit}</span> : null}
          {hasCredit && hasAlt ? (
            <span className="smd-inline-caption-separator">{' · '}</span>
          ) : null}
          {hasAlt ? alt : null}
        </span>
      ) : null}
    </div>
  );
}

export default GeminiInlineImage;
