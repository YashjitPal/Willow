import React, { useState } from 'react';
import { fileTypeIcon } from '@willow/core/gemini-file-icon';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import type { NotebookSource } from './notebook-types';

/**
 * A source's type mark, in the sources chip and on the source tiles.
 *
 * Three cases, and each one is what Gemini serves for that kind of source:
 *
 *   file      Drive's third-party type icon — the red PDF badge, the blue Docs page.
 *             Measured on Gemini's chip as an `<img>` with
 *             `src=".../32/type/application/pdf"`. The same PNGs are vendored in
 *             `platform/core`, so `fileTypeIcon` resolves one locally and the filename
 *             never leaves the browser.
 *   website   THE PAGE'S OWN FAVICON, through Google's `s2/favicons` service, which is
 *             the service and the parameters Gemini itself uses. A generic `web` glyph
 *             stands in when the fetch fails, which is the common case for a site with
 *             no icon.
 *   text      the `text/plain` type icon — the blue page. NOT `content_paste`: Gemini
 *             uses the clipboard glyph on the dialog's rail, where it labels the *action*,
 *             and the type icon on the source itself. Measured on a copied-text source,
 *             which asks for `.../32/type/text/plain` in the chip and on the tile alike.
 *
 * Neither image is a font ligature, and that matters beyond fidelity. Both icon faces are
 * subsetted to the ligatures Willow names, and a name the subset lacks renders as its own
 * letters — the letters ARE in the face, so nothing falls through to another font and
 * there is no blank box to notice. The chip asked Luminous for `description` and the rows
 * asked Google Symbols for `picture_as_pdf`; neither was present, so both drew stray
 * glyphs. Measure before trusting a name (`tools/scratch/lig-probe.cjs`): a present
 * ligature collapses to one advance width, a missing one measures as the sum of its
 * letters.
 */

/**
 * Gemini's favicon URL, parameters included: the WHOLE page URL goes in `domain`
 * (encoded), not just the host, and `sz=32` matches the 32px asset the type icons use.
 * Verified against its own tiles, e.g.
 * `s2/favicons?domain=https%3A%2F%2Fai.google.dev%2Fgemini-api%2Fdocs&sz=32`.
 *
 * This does hand the URL to Google, which the vendored type icons deliberately avoid for
 * filenames. It is not avoidable in the same way: a favicon has to be fetched from
 * somewhere, and asking the site directly means guessing at `/favicon.ico`, following
 * whatever `<link rel="icon">` says, and handling every failure by hand — all of it
 * cross-origin. The URL is one the user chose to add and Gemini sends the same request.
 */
const faviconUrl = (url: string): string =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url)}&sz=32`;

export const SourceIcon: React.FC<{
  source: NotebookSource;
  /** Box size in px. The remote assets are 32px, so anything below that stays crisp. */
  size?: number;
  className?: string;
}> = ({ source, size = 20, className }) => {
  const [faviconFailed, setFaviconFailed] = useState(false);

  const glyph = (name: string) => (
    <MaterialSymbol
      name={name}
      family="google-symbols"
      size={size}
      weight={320}
      roundness={100}
      opticalSize={size}
      className={className}
    />
  );

  if (source.kind === 'website') {
    if (!source.url || faviconFailed) return glyph('web');
    return (
      <img
        src={faviconUrl(source.url)}
        alt=""
        aria-hidden="true"
        onError={() => setFaviconFailed(true)}
        className={`shrink-0 object-cover ${className ?? ''}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <img
      src={fileTypeIcon({
        name: source.title,
        mimeType: source.mimeType || (source.kind === 'text' ? 'text/plain' : ''),
      })}
      alt=""
      aria-hidden="true"
      /* `cover`, matching Gemini's `object-fit` on the same image. */
      className={`shrink-0 object-cover ${className ?? ''}`}
      style={{ width: size, height: size }}
    />
  );
};
