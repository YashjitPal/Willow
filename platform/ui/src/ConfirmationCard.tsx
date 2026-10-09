import React, { useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './ConfirmationCard.css';

/**
 * Gemini's `remy-confirmation-card.draft-approval`: how a schedule or a skill reads once it
 * is saved, in a Spark task and in a chat alike. A 28px headline, then the body — Markdown,
 * every heading at the body's own size — clamped to five lines behind "See more", and an
 * optional disclaimer under a hairline. Measured off Gemini at 1536×826, 800×1280 and
 * 390×844 (`tools/ui-research/captures/spark/137-create-with-gemini/`).
 *
 * "See more" shows only when the clamp hides something: a body that fits has nothing more.
 */
export const ConfirmationCard: React.FC<{
  title: string;
  /** Markdown. */
  body: string;
  disclaimer?: string;
  className?: string;
}> = ({ title, body, disclaimer, className = '' }) => {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element || expanded) return undefined;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [body, expanded]);

  return (
    <div className={`willow-confirmation-card${className ? ` ${className}` : ''}`}>
      <div className="willow-confirmation-card__header">
        <span className="willow-confirmation-card__title">{title}</span>
      </div>
      <div ref={bodyRef} className={`willow-confirmation-card__body${expanded ? '' : ' is-collapsed'}`}>
        <ReactMarkdown>{body}</ReactMarkdown>
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          className="willow-confirmation-card__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
      {disclaimer && (
        <div className="willow-confirmation-card__disclaimer">
          <p>{disclaimer}</p>
        </div>
      )}
    </div>
  );
};
