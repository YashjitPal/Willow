/**
 * The two cards Deep Research puts in the thread.
 *
 * `ResearchPlanCard` is Gemini's `deep-research-confirmation-widget`: #171717, radius 28,
 * 24px in, a 17px title over three steps on 24px glyphs (the first carrying the plan's
 * numbered items, clamped to six lines behind "More"), "Ready in a few mins", and Edit
 * plan / Start research along the bottom right. Both buttons are spent once the run starts.
 *
 * `ResearchCard` is its `gem-processing-card`: #192967, radius 28, a 28px glyph beside the
 * title and a 13px status line; it opens the panel.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { researchStatusLine, type ResearchRecord } from './research-types';
import './research.css';

export const ResearchPlanCard: React.FC<{
  record: ResearchRecord;
  onStart: () => void;
  onEdit: () => void;
  /** No turn may start while another is running. */
  busy?: boolean;
}> = ({ record, onStart, onEdit, busy = false }) => {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const textRef = useRef<HTMLDivElement | null>(null);
  const spent = !!record.started;

  /* Re-measured as the column settles: the first layout of a new message is not its last. */
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return undefined;
    const measure = () => { if (!expanded) setClamped(el.scrollHeight > el.clientHeight + 1); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [record.steps, expanded]);

  return (
    <div className="dr-plan">
      <div className="dr-plan__title" role="heading" aria-level={3}>{record.title}</div>
      <div className="dr-plan__steps">
        <div className="dr-plan__step">
          <div className="dr-plan__step-title">
            <MaterialSymbol family="google-symbols" name="select_window_2" size={24} weight={300} aria-label={`The plan has 3 steps, 1st step`} />
            <span>Research Websites</span>
          </div>
          <div className="dr-plan__step-detail">
            <div ref={textRef} className={`dr-plan__step-text${expanded ? ' is-expanded' : ''}`}>
              {record.steps.map((step, i) => <div key={i}>({i + 1}) {step}</div>)}
            </div>
            {(clamped || expanded) && (
              <button
                type="button"
                className="dr-plan__more"
                aria-label={expanded ? 'Fewer research plan details' : 'More research plan details'}
                onClick={() => setExpanded((open) => !open)}
              >
                {expanded ? 'Less' : 'More'}
              </button>
            )}
          </div>
        </div>
        <div className="dr-plan__step">
          <div className="dr-plan__step-title">
            <MaterialSymbol family="luminous" name="sort" size={24} weight={300} roundness={100} opticalSize={24} aria-label="2nd step" />
            <span>Analyze Results</span>
          </div>
          <div className="dr-plan__step-detail dr-plan__step-detail--empty" />
        </div>
        <div className="dr-plan__step">
          <div className="dr-plan__step-title">
            <MaterialSymbol family="luminous" name="travel_explore" size={24} weight={300} roundness={100} opticalSize={24} aria-label="3rd step" />
            <span>Create Report</span>
          </div>
        </div>
      </div>
      <div className="dr-plan__time">
        <MaterialSymbol family="luminous" name="schedule" size={24} weight={300} roundness={100} opticalSize={24} aria-label="estimated time" />
        <span>Ready in a few mins</span>
      </div>
      <div className="dr-plan__actions">
        <button type="button" className="dr-plan__edit" aria-label="Edit the research plan" disabled={spent || busy} onClick={onEdit}>Edit plan</button>
        <button type="button" className={`dr-plan__start${spent ? ' is-spent' : ''}`} aria-label="Start research" disabled={spent || busy} onClick={onStart}>Start research</button>
      </div>
    </div>
  );
};

const cardGlyph = (record: ResearchRecord): string => {
  if (record.status === 'done') return 'travel_explore';
  if (record.status === 'error' || record.status === 'canceled') return 'error';
  return record.phase === 'writing' || record.phase === 'analyzing' ? 'article' : 'select_window_2';
};

export const ResearchCard: React.FC<{
  record: ResearchRecord;
  selected: boolean;
  onOpen: () => void;
}> = ({ record, selected, onOpen }) => {
  const glyph = cardGlyph(record);
  return (
    <button
      type="button"
      className={`dr-card${selected ? ' is-selected' : ''}`}
      role="status"
      aria-label={`${record.title}, ${researchStatusLine(record)}`}
      onClick={onOpen}
    >
      <span className="dr-card__icon">
        {glyph === 'select_window_2'
          ? <MaterialSymbol family="google-symbols" name={glyph} size={28} weight={260} />
          : <MaterialSymbol family="luminous" name={glyph} size={28} weight={260} roundness={100} opticalSize={24} />}
      </span>
      <span className="dr-card__title">{record.title}</span>
      <span className="dr-card__status">{researchStatusLine(record)}</span>
    </button>
  );
};
