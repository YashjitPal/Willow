import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import type { SparkBrowserRequest } from '../spark-types';
import './SparkBrowserPermissionCard.css';

/**
 * Gemini Spark's `remy-confirmation-card`: the permission the first browser call
 * in a thread asks for.
 *
 * The copy is Gemini's with Willow's name, less two phrases that would be false
 * here — Willow's browser is a sandboxed tab in Willow, not "a secure browser in
 * the cloud", and it does not "work when you're away".
 *
 * Answered, the card stays in the thread as Gemini keeps it: the select and both
 * buttons disabled, the plan no longer expandable.
 */
export const SparkBrowserPermissionCard: React.FC<{
  request: SparkBrowserRequest;
  /** Omitted, or the request already answered: the card is read-only. */
  onRespond?: (allowed: boolean) => void;
}> = ({ request, onRespond }) => {
  const answered = request.status !== 'pending' || !onRespond;
  const titleId = useId();
  const planId = useId();
  const menuId = useId();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const planRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Only a plan longer than its three-line clamp gets the chevron.
  useLayoutEffect(() => {
    const plan = planRef.current;
    if (!plan || expanded) return;
    const measure = () => setOverflowing(plan.scrollHeight > plan.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(plan);
    return () => observer.disconnect();
  }, [expanded, request.task]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || selectRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      selectRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="option"]')?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const expandable = overflowing && !answered;
  const toggle = () => {
    if (expandable || expanded) setExpanded((open) => !open);
  };

  return (
    <section
      className={`spark-browser-card${answered ? ' is-answered' : ''}`}
      aria-labelledby={titleId}
      data-request-id={request.id}
    >
      <div className="spark-browser-card__surface">
        <div className="spark-browser-card__header">
          <span id={titleId} className="spark-browser-card__title">
            Let Willow Spark use a remote browser to interact with websites for you?
          </span>
        </div>
        <div className="spark-browser-card__body">
          <p>To work on your tasks, Willow Spark will need to use a secure browser.</p>
          <ul>
            <li>Willow Spark may make mistakes, including unexpected data sharing. Supervise sensitive tasks.</li>
            <li>
              <a href="https://support.google.com/gemini/answer/16596215" target="_blank" rel="noreferrer">Review risks</a>
              {' '}and manage browser data in Willow Spark Settings.
            </li>
          </ul>
          <p className="spark-browser-card__plan-heading">Review the plan:</p>
        </div>
        <div className="spark-browser-card__details">
          <div
            className={`spark-browser-card__detail${expandable || expanded ? ' is-expandable' : ''}${expanded ? ' is-expanded' : ''}`}
            onClick={toggle}
          >
            <div
              ref={planRef}
              id={planId}
              className={`spark-browser-card__plan${expanded ? '' : ' is-collapsed'}`}
            >
              <p>{request.task}</p>
            </div>
            {(expandable || expanded) && (
              <button
                type="button"
                className="spark-browser-card__chevron"
                aria-label={expanded ? 'Collapse text' : 'Expand text'}
                aria-expanded={expanded}
                aria-controls={planId}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpanded((open) => !open);
                }}
              >
                <MaterialSymbol
                  family="luminous"
                  name={expanded ? 'expand_less' : 'expand_more'}
                  size={24}
                  weight={300}
                  roundness={100}
                  opticalSize={24}
                />
              </button>
            )}
          </div>
        </div>
        <div className="spark-browser-card__actions">
          <div className="spark-browser-card__select-anchor">
            <button
              ref={selectRef}
              type="button"
              className={`spark-browser-card__select${menuOpen ? ' is-open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              disabled={answered}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="spark-browser-card__select-label">Remote browser</span>
              <span className="spark-browser-card__select-arrow" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="24" height="24" focusable="false"><path d="M7 10l5 5 5-5z" /></svg>
              </span>
            </button>
            {menuOpen && (
              <div ref={menuRef} id={menuId} className="spark-browser-card__menu" role="listbox" aria-label="Where Willow Spark runs the browser">
                <div
                  className="spark-browser-card__option"
                  role="option"
                  aria-selected="true"
                  tabIndex={0}
                  onClick={() => {
                    setMenuOpen(false);
                    selectRef.current?.focus();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    setMenuOpen(false);
                    selectRef.current?.focus();
                  }}
                >
                  <span className="spark-browser-card__option-icon">
                    <MaterialSymbol
                      family="google-symbols"
                      name="cloud"
                      size={20}
                      weight={320}
                      roundness={100}
                      variationSettings={'"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320'}
                    />
                  </span>
                  <span className="spark-browser-card__option-text">
                    <span className="spark-browser-card__option-label">Remote browser</span>
                    <span className="spark-browser-card__option-description">Runs while Willow is open</span>
                  </span>
                  <span className="spark-browser-card__option-check" aria-hidden="true" />
                </div>
              </div>
            )}
          </div>
          <div className="spark-browser-card__buttons">
            <button
              type="button"
              className="spark-browser-card__button"
              disabled={answered}
              onClick={() => onRespond?.(false)}
            >
              <span>Don&apos;t allow</span>
            </button>
            <button
              type="button"
              className="spark-browser-card__button"
              disabled={answered}
              onClick={() => onRespond?.(true)}
            >
              <span>Allow</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
