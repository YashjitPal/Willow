import { useEffect, useRef, useState } from 'react';
import { MAX_INSTRUCTIONS, setDotInstructions } from '../harness/dot-runtime';
import type { DotThread } from '../harness/thread/thread-types';
import { M3_SCOPE } from '../m3/m3';
import './DotPacing.css';

/**
 * The profile's "Instructions": how the bot should work with the user, in their words — what to always do, never
 * do, or check with them first. It is the prompt's "Standing instructions from the user", read every turn, and
 * outranks the bot's defaults though never its safety rules.
 */
export function DotInstructionsSection({ dotId, name, thread }: { dotId: string; name: string; thread: DotThread | undefined }) {
  const saved = thread?.runtime.instructions ?? '';
  const [draft, setDraft] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = draft.trim() !== saved.trim();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    setDraft(thread?.runtime.instructions ?? '');
    setJustSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dotId]);

  // Changed in another window: taken up unless this one holds unsaved words.
  useEffect(() => {
    if (!dirtyRef.current) setDraft(saved);
  }, [saved]);

  return (
    <section className={`spark-task-detail__progress-panel-section ${M3_SCOPE}`}>
      <div className="spark-task-detail__progress-panel-header is-static">
        <span className="spark-task-detail__progress-panel-title-wrapper">
          <span className="spark-task-detail__progress-panel-title">Instructions</span>
        </span>
      </div>
      <div className="spark-task-detail__progress-panel-content dot-instructions">
        <md-outlined-text-field
          className="dot-instructions__field"
          type="textarea"
          rows={4}
          label={`How ${name} should work with you`}
          value={draft}
          maxLength={MAX_INSTRUCTIONS}
          supportingText="What to always do, never do, or check with you first."
          onInput={(event) => {
            setDraft((event.target as HTMLInputElement).value);
            setJustSaved(false);
          }}
        />
        <div className="dot-instructions__actions">
          {justSaved && !dirty && <span className="spark-dots-profile__muted" role="status">Saved</span>}
          {dirty && (
            <md-text-button onClick={() => setDraft(saved)}>Discard</md-text-button>
          )}
          <md-filled-tonal-button
            disabled={!dirty}
            onClick={() => {
              setDotInstructions(dotId, draft);
              setJustSaved(true);
            }}
          >
            Save
          </md-filled-tonal-button>
        </div>
      </div>
    </section>
  );
}
