import React from 'react';
import { fileTypeOf, tileDisplayName } from '@willow/core/gemini-file-info';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { SourceIcon } from './SourceIcon';
import type { NotebookSource } from './notebook-types';

/**
 * Material's indeterminate circular progress, at the 20px Gemini asks for.
 *
 * Not an approximation of it — the structure and every duration are MDC's own, read off
 * Gemini's stylesheets (`tools/scratch/gemini-spinner-css.cjs`), and the `diameter` of 20
 * out of its compiled template, where `gem-attachment-loading-spinner` is bound to
 * `["aria-label","Loading attachment",1,"gem-attachment-loading-spinner",3,"diameter"]`.
 *
 * The arc is one circle drawn three times: a left clipper, a right clipper, and the
 * `gap-patch` that covers the seam between them. The container spins at a constant rate
 * while the two halves counter-rotate, and that is what makes the arc grow and shrink —
 * a single rotating element cannot do it. MDC layers four of these to cross-fade colours;
 * with one colour they are identical, so one layer is all this needs.
 *
 * Geometry follows Angular Material's arithmetic for `diameter: 20, strokeWidth: 4`:
 * r = (20-4)/2 = 8, circumference = 2πr, `stroke-dasharray` the circumference and
 * `stroke-dashoffset` half of it, stroke width as a percentage of the box.
 */
const SPINNER_DIAMETER = 20;
const SPINNER_STROKE = 4;
const SPINNER_RADIUS = (SPINNER_DIAMETER - SPINNER_STROKE) / 2;
const SPINNER_CIRCUMFERENCE = 2 * Math.PI * SPINNER_RADIUS;

const SpinnerArc: React.FC = () => (
  <svg className="nb-spinner-graphic" viewBox={`0 0 ${SPINNER_DIAMETER} ${SPINNER_DIAMETER}`}>
    <circle
      cx="50%"
      cy="50%"
      r={SPINNER_RADIUS}
      style={{
        strokeDasharray: `${SPINNER_CIRCUMFERENCE}px`,
        strokeDashoffset: `${SPINNER_CIRCUMFERENCE / 2}px`,
        strokeWidth: `${(SPINNER_STROKE / SPINNER_DIAMETER) * 100}%`,
      }}
    />
  </svg>
);

const TileSpinner: React.FC = () => (
  <span
    className="nb-src-tile-spinner"
    role="progressbar"
    aria-label="Loading attachment"
    style={{ width: SPINNER_DIAMETER, height: SPINNER_DIAMETER }}
  >
    <span className="nb-spinner-rotator">
      <span className="nb-spinner-layer">
        <span className="nb-spinner-clip nb-spinner-clip-left"><SpinnerArc /></span>
        <span className="nb-spinner-gap"><SpinnerArc /></span>
        <span className="nb-spinner-clip nb-spinner-clip-right"><SpinnerArc /></span>
      </span>
    </span>
  </span>
);

/**
 * One source in the Sources dialog, as a 112px tile.
 *
 * Gemini lists sources as TILES, not rows — `project-file-upload-item` wrapping a
 * `gem-attachment`, laid out in a grid. Measured off the live panel with four sources in
 * it (computed values, since every rect in that window came back at 0.8x):
 *
 *   tile        112x112, radius 20, `rgba(255,255,255,0.12)`, `overflow: hidden`
 *   content     88x88 absolute, i.e. inset 12, column, `justify-content: flex-end`
 *   icon        24x24, absolute at the content's top-left
 *   name        13px/17px w400 `wdth 92`, `rgb(227,227,227)`, clamped to 3 lines
 *   close       20px white circle, 12px in from the tile's top-right, hidden at rest
 *
 * This is the same tile `platform/ui/GeminiAttachmentCard` draws for composer
 * attachments, down to the fill and the radius — but it is NOT that component, because
 * Gemini's own differs here. Its class list carries a `gem-attachment-notebook` modifier,
 * and the PDF renders as an ICON where the composer variant shows the word "PDF"
 * (`showsExtensionLabel` is true for PDF, text, audio and unknown). Reusing the composer
 * card would put that label on half the sources in a notebook.
 */
export const SourceTile: React.FC<{
  source: NotebookSource;
  /**
   * Still being read. The spinner takes the icon's place and the remove button is gone —
   * there is nothing stored yet to remove. Gemini has the same pairing, an `isLoading`
   * input beside a `hideCloseWhileLoading` one.
   */
  loading?: boolean;
  onRemove?: () => void;
}> = ({ source, loading = false, onRemove }) => {
  /*
   * Gemini labels a website tile with its URL, not the page title — measured
   * "https://en...a_Showgirl" on a Wikipedia source. Willow has the title too (the fetch
   * keeps it) and it reads better, but the URL is what Gemini shows, so the title becomes
   * the tooltip instead.
   */
  const fullName = source.kind === 'website' ? (source.url ?? source.title) : source.title;

  /*
   * `tileDisplayName` is Gemini's own name arithmetic, already ported: strip a known
   * extension, then middle-truncate to 20 characters. It reproduces the measured labels
   * exactly — "Electrochemistry Lecture 1.pdf" becomes "Electroche... Lecture 1" and the
   * Wikipedia URL becomes "https://en...a_Showgirl".
   */
  const label = tileDisplayName(fullName, fileTypeOf(source.mimeType ?? '', fullName));

  return (
    <div className="nb-src-tile" title={source.title}>
      <span className="nb-src-tile-content">
        {loading ? (
          <TileSpinner />
        ) : (
          <span className="nb-src-tile-icon">
            <SourceIcon source={source} size={24} />
          </span>
        )}
        <span className="nb-src-tile-name">{label}</span>
      </span>
      {!loading && onRemove && (
        <button
          type="button"
          aria-label={`Remove ${source.title}`}
          onClick={onRemove}
          className="nb-src-tile-remove"
        >
          <MaterialSymbol name="close" family="luminous" size={16} weight={330} roundness={100} />
        </button>
      )}
    </div>
  );
};
