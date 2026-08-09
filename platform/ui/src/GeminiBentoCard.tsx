// ──────────────────────────────────────────────────────────────────────────────
// Gemini's `bento-card`, rebuilt element by element from the live app.
//
// DOM ORDER. The attribution comes FIRST inside the host, before the text —
// measured on the large card as `childOrder: [div.bg-image-attribution,
// div.text-content]`. It is absolutely positioned, so order only matters for
// how it stacks; keeping Gemini's order keeps the paint order identical. The
// image layer is prepended ahead of both, which has no Gemini counterpart to
// contradict: there the picture is a `background-image`, and a background paints
// beneath every child regardless of order. First child at `z-index: 0` is the
// position that reproduces that.
//
// TYPOGRAPHY, per size. The heading and subheading classes are bound in the
// component's own sub-templates (`Png` and `Qng` in the minified chunk):
//
//   heading:     _.Q("gds-headline-s", medium)("gds-emphasized-headline-l", large)("gds-body-l", small)
//   subheading:  _.Q("gds-body-l", large)("gds-body-m", medium)("gds-body-s", small)
//
// and the live computed values for those classes are:
//
//   gds-emphasized-headline-l  28px / 36px  wght 350  ROND 20  wdth 100
//   gds-headline-s             20px / 24px  wght 470  ROND 20  wdth  94
//   gds-body-l                 17px / 24px  wght 400  ROND  0  wdth  92
//   gds-body-m                 15px / 20px  wght 400  ROND  0  wdth  92
//   gds-body-s                 13px / 17px  wght 400  ROND  0  wdth  92
//
// A large card's subheading would be `gds-body-l`; the measured large card had
// none, so that pairing comes from the binding rather than from a measurement.
//
// COLOUR. `.has-background-image` sets `color: #fff`; otherwise the host
// inherits `--gem-sys-color--on-surface` = rgb(227,227,227). Both were read
// live on the two small cards, which differ only in that flag.
//
// THE SCRIM. `.has-background-image.has-text::after` lays a gradient under the
// text, with a stop that differs by size — 50% on large, 60% elsewhere:
//
//   linear-gradient(0deg in oklab, rgba(0,0,0,.82) 3%, transparent 60%)
//
// `in oklab` is Gemini's; it changes the midpoint ramp, so it is kept verbatim.
//
// NO MOTION. Confirmed by probe: `getAnimations({subtree:true})` on a card is
// empty, its computed `animation` is `none`, and its `transition` shorthand is
// the initial `all`. There is no hover state and no entrance animation — the
// only feedback is Material's ripple, which we do not reproduce here.
// ──────────────────────────────────────────────────────────────────────────────

import React from 'react';

import {
  BENTO_GAP,
  BentoCardContent,
  bentoAttribution,
  packBentoColumns,
} from './gemini-cards';
import { IMAGE_REFERRER_POLICY, resolveImageSource } from './image-source';

const HEADING_CLASS: Record<BentoCardContent['size'], string> = {
  small: 'gds-body-l',
  medium: 'gds-headline-s',
  large: 'gds-emphasized-headline-l',
};

const SUBHEADING_CLASS: Record<BentoCardContent['size'], string> = {
  small: 'gds-body-s',
  medium: 'gds-body-m',
  large: 'gds-body-l',
};

// WHERE GEMINI'S CARD IMAGES COME FROM, and why ours are usually absent.
// Every image on a live Gemini response page is served from a Google-owned host
// — measured across all 11 on the page: `encrypted-tbn{0,1,3}.gstatic.com`
// (card backgrounds and the hero), `lh3.googleusercontent.com`, `www.gstatic.com`.
// Not one third-party URL is hotlinked. The retrieval pipeline resolves a
// picture server-side and rewrites it through an image proxy before the payload
// ever reaches the browser, so the client only handles URLs that are guaranteed
// to load, carry no hotlink protection and leak no referer to a publisher.
//
// Willow has no such proxy, and no provider hands a model image URLs: Gemini's
// `googleSearch` grounding returns `web.uri`/`web.title` only. A card image
// therefore only appears when a model is given a genuine URL by some tool, and
// a raw publisher URL painted cross-origin is exactly the case that fails. The
// probe below is what keeps that failure from becoming a blank tile.
//
// A BROKEN IMAGE, and the ONE mechanism change we make deliberately. Gemini
// paints a card's picture as a CSS `background-image`. We paint it as an `<img>`
// layer instead, and that divergence is load-bearing rather than cosmetic:
//
//   • CSS has no error event. A URL that 404s or is refused leaves the box
//     painted with nothing — exactly the blank second card in the report. An
//     `<img>` fires `onError`, so the failure is observable at the moment it
//     happens instead of being inferred from a second, parallel fetch.
//   • A referrer policy can only be set per element. `referrerPolicy` is an
//     `<img>` attribute; a background fetch takes the document's policy and
//     cannot opt out. Sending no `Referer` is what gets a hotlink-protected
//     publisher to serve the picture at all (see `image-source.ts`), and it is
//     the single highest-value fix available without a server.
//
// The geometry is unchanged, which is what makes the swap safe: `object-fit:
// cover` + `object-position: 50%` on a layer stretched to `inset: 0` is the same
// used box as `background-size: cover` + `background-position: 50%`, confirmed by
// building both side by side and measuring them. It sits at `z-index: 0` so it
// stays UNDER the `::after` scrim (also `z-index: 0`, painted later) and under
// the text (`.smd-bento-card > *` is `z-index: 1`).
//
// A card whose image fails falls back to the no-image styling: `has-image` is
// dropped, so the host stops forcing `color: #fff` over an empty box and goes
// back to `--gem-sys-color--on-surface`, and the scrim (gated on that same class)
// stops painting a gradient over nothing. A failed image-only card with no text
// would still be an empty box, so it gets the same placeholder the hero uses
// rather than rendering a hole.
function useImageState(src: string | undefined) {
  // Optimistic: assume it loads, and correct on error. There is no flash to
  // avoid — the card's own `background-color` is rgb(23,23,23), so light text is
  // legible either way — and assuming success lets the picture paint the instant
  // it decodes instead of after a probe round trip.
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const failed = Boolean(src) && failedSrc === src;
  const onError = React.useCallback(() => {
    if (src) setFailedSrc(src);
  }, [src]);
  return { failed, onError };
}

function BentoCard({ card }: { card: BentoCardContent }) {
  const { failed, onError } = useImageState(card.image);
  const broken = Boolean(card.image) && failed;
  const image = broken ? undefined : card.image;
  const attribution = image ? bentoAttribution(card) : '';
  const clickable = Boolean(card.href);
  // `has-text` is `!(!heading && !iUa)` in the component, and the scrim selector
  // requires it — an image-only card is left ungradiented.
  const hasText = Boolean(card.heading || card.subheading);

  const open = () => {
    // `g3.execute` opens `HQa.url` with exactly these window features.
    if (!card.href || typeof window === 'undefined') return;
    window.open(card.href, '_blank', 'noopener,noreferrer');
  };

  const activate = (event: React.KeyboardEvent) => {
    // The component listens for `keydown.enter` and `keydown.space`.
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    open();
  };

  return (
    <div
      className={
        'smd-bento-card smd-bento-' + card.size +
        (image ? ' smd-bento-has-image' : '') +
        (hasText ? ' smd-bento-has-text' : '')
      }
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? open : undefined}
      onKeyDown={clickable ? activate : undefined}
    >
      {image ? (
        // `alt=""` and `aria-hidden`: the picture is decoration behind a heading
        // that already carries the meaning, which is what makes a bento tile a
        // card rather than an image. An image-only card is not renderable at all
        // (`normalizeCard` drops it), so there is no case where this is the
        // sole content and a description would be owed.
        <img
          className="smd-bento-image"
          src={resolveImageSource(image)}
          alt=""
          aria-hidden="true"
          draggable={false}
          loading="lazy"
          decoding="async"
          referrerPolicy={IMAGE_REFERRER_POLICY}
          onError={onError}
        />
      ) : null}
      {attribution ? (
        <div className="smd-bento-attribution" title={attribution}>
          {attribution}
        </div>
      ) : null}
      {broken && !hasText ? (
        <div className="smd-bento-broken" role="img" aria-label="Image unavailable" />
      ) : null}
      <div className="smd-bento-text">
        {card.heading ? (
          <div className={'smd-bento-heading ' + HEADING_CLASS[card.size]}>
            {card.heading}
          </div>
        ) : null}
        {card.subheading ? (
          <div className={'smd-bento-subheading ' + SUBHEADING_CLASS[card.size]}>
            {card.subheading}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The tiling tree. Reproduces the live nesting — an outer row of columns, each
 * column a stack of rows — so the flex arithmetic that sizes the cards is the
 * same arithmetic Gemini runs.
 *
 * Nothing here sets a width. The cards are rigid (`min-width` = `width` on each
 * size class), so the containers take their size from the cards rather than the
 * other way round. That is what the live app does: squeezing the container to
 * 420px and 300px, and emulating viewports down to 480px, left every measured
 * card box unchanged.
 */
export function BentoCardGroup({ cards }: { cards: BentoCardContent[] }) {
  const columns = packBentoColumns(cards);
  if (!columns.length) return null;

  return (
    <div className="smd-bento-root" style={{ gap: BENTO_GAP }}>
      {columns.map((column, columnIndex) => (
        <div className="smd-bento-column" key={columnIndex} style={{ gap: BENTO_GAP }}>
          {column.map((row, rowIndex) => (
            <div className="smd-bento-row" key={rowIndex} style={{ gap: BENTO_GAP }}>
              {row.map((card, cardIndex) => (
                <div className="smd-bento-slot" key={cardIndex}>
                  <BentoCard card={card} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default BentoCardGroup;
