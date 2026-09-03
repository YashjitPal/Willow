import { useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  dismissSparkQuestion,
  draftSparkQuestionAnswer,
  skipSparkQuestion,
  sparkPendingQuestions,
  stepSparkQuestion,
  submitSparkQuestion,
} from './spark-store';
import './SparkQuestionPanel.css';

/**
 * `request_user_input`, rendered where the composer's input goes.
 *
 * ## Why it replaces the input rather than sitting above it
 *
 * Because that is what the Codex app does. Its composer row component takes a
 * `composerInput` prop, and while a request is pending it is called with
 * `composerInput: null` — the surrounding controls stay, the text input is
 * swapped out, and the question panel renders as a sibling inside the same
 * composer body. The panel itself carries no `absolute`, `fixed` or `sticky`
 * positioning at all; it is an ordinary in-flow block placed by the composer.
 *
 * That also happens to be the cheapest option here: Spark's follow-up composer
 * is already disabled while a task runs, so there is no lock to fight.
 *
 * ## What the shape is copied from
 *
 * Upstream's panel steps through questions one at a time with an `N of M`
 * indicator and chevron buttons, renders options as selectable rows, and
 * **pre-selects the first option** — which is why the tool's schema tells the
 * model to put the recommended choice first and suffix it "(Recommended)".
 * A freeform field is always present, because the handler forces `isOther` on
 * every question and the option schema tells the model not to invent an
 * "Other" choice itself.
 *
 * ## Three exits, not one
 *
 * `onSubmit`, `onSkip` and `onEscapeDismiss` are separate handlers upstream,
 * and they mean different things to the model: answers, an empty set
 * ("carry on without me"), and a cancellation. Collapsing skip into dismiss
 * would tell the model the turn was interrupted when the user merely shrugged.
 */
export function SparkQuestionPanel({ taskId }: { taskId: string }): React.ReactElement | null {
  const pending = useStore(sparkPendingQuestions)[taskId];
  const freeformRef = useRef<HTMLTextAreaElement>(null);

  // Escape dismisses, matching `onEscapeDismiss`. Bound on the document because
  // focus may sit on an option row rather than the text field.
  useEffect(() => {
    if (!pending) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissSparkQuestion(taskId);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pending, taskId]);

  if (!pending) return null;

  const question = pending.questions[pending.index];
  if (!question) return null;

  const draft = pending.drafts[pending.index] ?? { optionLabel: null, freeformText: '' };
  const multiple = pending.questions.length > 1;
  const hasPrevious = multiple && pending.index > 0;
  const hasNext = multiple && pending.index < pending.questions.length - 1;

  /**
   * Whether anything at all has been filled in, across every question.
   *
   * Deliberately not "is the question on screen answered". A round of three
   * questions where you answer the first two and leave the third blank is a
   * legitimate submission — unanswered ones are reported as such — so gating
   * Send on the *current* question would strand you on a question you had
   * decided not to answer.
   */
  const anyAnswered = pending.drafts.some(
    (entry) => Boolean(entry.optionLabel) || entry.freeformText.trim().length > 0,
  );

  /**
   * The primary button advances while there are questions left, and only
   * submits on the last one.
   *
   * This was the bug: the label switched to "Next" but the handler always
   * submitted, so pressing it resolved the whole round and tore the panel down
   * — which looked like the panel flickering rather than a wrong action.
   */
  const commit = () => {
    if (hasNext) stepSparkQuestion(taskId, 1);
    else submitSparkQuestion(taskId);
  };

  return (
    <div className="spark-question" role="group" aria-label={question.header}>
      <div className="spark-question__head">
        <span className="spark-question__header">{question.header}</span>
        {multiple && (
          <span className="spark-question__stepper">
            <button
              type="button"
              className="spark-question__step"
              disabled={!hasPrevious}
              onClick={() => stepSparkQuestion(taskId, -1)}
              aria-label="Previous question"
            >
              {/*
                * `expand_more` rotated, rather than `chevron_left`.
                *
                * Two reasons and they agree: the Codex app draws its own
                * stepper arrows as one chevron rotated ±90°, and Willow's icon
                * fonts do not all carry every named glyph — a missing ligature
                * renders the glyph *name* clipped to the icon box, which reads
                * as a broken character rather than a missing one. `expand_more`
                * is already proven in this feature at 20px.
                */}
              <MaterialSymbol name="expand_more" size={16} weight={400} className="spark-question__chevron--prev" />
            </button>
            {/* Upstream renders `${index + 1} of ${length}`. */}
            <span className="spark-question__count">
              {pending.index + 1} of {pending.questions.length}
            </span>
            <button
              type="button"
              className="spark-question__step"
              disabled={!hasNext}
              onClick={() => stepSparkQuestion(taskId, 1)}
              aria-label="Next question"
            >
              <MaterialSymbol name="expand_more" size={16} weight={400} className="spark-question__chevron--next" />
            </button>
          </span>
        )}
      </div>

      {/*
        * Keyed on the index so stepping remounts this block and replays its
        * entrance. The drafts live in the store, so a remount costs nothing —
        * what you typed or picked survives it.
        */}
      <div className="spark-question__body" key={pending.index}>
        <p className="spark-question__prompt">{question.question}</p>

        <div className="spark-question__options">
          {question.options.map((option) => {
            const selected = draft.optionLabel === option.label;
            return (
              <button
                type="button"
                key={option.label}
                className={`spark-question__option${selected ? ' spark-question__option--selected' : ''}`}
                aria-pressed={selected}
                onClick={() => draftSparkQuestionAnswer(taskId, { optionLabel: option.label })}
              >
                <span className="spark-question__option-label">{option.label}</span>
                {option.description && (
                  <span className="spark-question__option-description">{option.description}</span>
                )}
              </button>
            );
          })}
        </div>

        <textarea
          ref={freeformRef}
          className="spark-question__freeform"
          placeholder="Something else…"
          rows={1}
          value={draft.freeformText}
          onChange={(event) => draftSparkQuestionAnswer(taskId, { freeformText: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              commit();
            }
          }}
        />
      </div>

      <div className="spark-question__actions">
        <button
          type="button"
          className="spark-question__skip"
          onClick={() => skipSparkQuestion(taskId)}
        >
          Skip
        </button>
        <button
          type="button"
          className="spark-question__submit"
          // Advancing is always allowed; a question you choose not to answer is
          // reported as unanswered rather than blocking the round. Only the
          // final Send needs something to send.
          disabled={!hasNext && !anyAnswered}
          onClick={commit}
        >
          {hasNext ? 'Next' : 'Send'}
        </button>
      </div>
    </div>
  );
}

export default SparkQuestionPanel;
