import React, { useEffect, useId, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import type { SparkSkillSource } from './spark-types';
import './SparkSkillEditor.css';

export interface SparkSkillDraft {
  name: string;
  description: string;
  instructions: string;
  source: SparkSkillSource;
  fileName?: string;
}

export interface SparkSkillEditorProps {
  className?: string;
  initialDraft?: Partial<SparkSkillDraft>;
  isEditing?: boolean;
  mode?: SparkSkillSource;
  recordKey?: string;
  onAskGemini?: (
    draft: SparkSkillDraft,
  ) => Promise<Partial<SparkSkillDraft> | void> | Partial<SparkSkillDraft> | void;
  onBack: () => void;
  onDelete?: () => void;
  onLearnMore?: () => void;
  onSubmit: (draft: SparkSkillDraft) => void;
}

const DEFAULT_DRAFT: SparkSkillDraft = {
  name: '',
  description: '',
  instructions: '',
  source: 'manual',
};

const createEditorDraft = (
  initialDraft: Partial<SparkSkillDraft> | undefined,
  mode: SparkSkillSource,
): SparkSkillDraft => ({
  ...DEFAULT_DRAFT,
  ...initialDraft,
  source: initialDraft?.source ?? mode,
});

const normalizeDraftValue = (value: string | undefined) => (value ?? '').replace(/\r\n?/g, '\n');

const getDraftSnapshot = (draft: Partial<SparkSkillDraft>) => JSON.stringify([
  normalizeDraftValue(draft.name),
  normalizeDraftValue(draft.description),
  normalizeDraftValue(draft.instructions),
  draft.source ?? 'manual',
  normalizeDraftValue(draft.fileName),
]);

export const SparkSkillEditor: React.FC<SparkSkillEditorProps> = ({
  className = '',
  initialDraft,
  isEditing = false,
  mode = 'manual',
  recordKey,
  onAskGemini,
  onBack,
  onDelete,
  onLearnMore,
  onSubmit,
}) => {
  const [draft, setDraft] = useState<SparkSkillDraft>(() => createEditorDraft(initialDraft, mode));
  const [initialDraftSnapshot, setInitialDraftSnapshot] = useState(() => (
    getDraftSnapshot(createEditorDraft(initialDraft, mode))
  ));
  const headingId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const instructionsId = useId();
  const deleteHeadingId = useId();
  const discardHeadingId = useId();
  const discardDescriptionId = useId();
  const suppressNavigationWarningRef = useRef(false);
  const discardCloseTimerRef = useRef<number | null>(null);
  const [isAskingGemini, setIsAskingGemini] = useState(false);
  const [assistError, setAssistError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardClosing, setDiscardClosing] = useState(false);
  const canSubmit = Boolean(draft.name.trim() && draft.instructions.trim());
  const currentDraftSnapshot = getDraftSnapshot(draft);
  const isDirty = currentDraftSnapshot !== initialDraftSnapshot;
  const draftIdentity = recordKey ?? getDraftSnapshot(createEditorDraft(initialDraft, mode));

  useEffect(() => {
    const nextDraft = createEditorDraft(initialDraft, mode);
    setDraft(nextDraft);
    setInitialDraftSnapshot(getDraftSnapshot(nextDraft));
    setAssistError('');
    setDeleteOpen(false);
    setDiscardOpen(false);
    setDiscardClosing(false);
    if (discardCloseTimerRef.current !== null) {
      window.clearTimeout(discardCloseTimerRef.current);
      discardCloseTimerRef.current = null;
    }
    suppressNavigationWarningRef.current = false;
  }, [draftIdentity]);

  useEffect(() => () => {
    if (discardCloseTimerRef.current !== null) {
      window.clearTimeout(discardCloseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!deleteOpen && !discardOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (deleteOpen) {
        setDeleteOpen(false);
      } else {
        closeDiscardDialog();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [deleteOpen, discardOpen, discardClosing]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (suppressNavigationWarningRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;

    const editorHistoryState = window.history.state;
    const editorUrl = window.location.href;
    const interceptHistoryNavigation = (event: PopStateEvent) => {
      if (suppressNavigationWarningRef.current) return;

      try {
        window.history.pushState(editorHistoryState, '', editorUrl);
      } catch {
        return;
      }

      event.stopImmediatePropagation();
      setDeleteOpen(false);
      setDiscardClosing(false);
      setDiscardOpen(true);
    };

    window.addEventListener('popstate', interceptHistoryNavigation, true);
    return () => window.removeEventListener('popstate', interceptHistoryNavigation, true);
  }, [isDirty]);

  const resetWarningSuppression = () => {
    window.setTimeout(() => {
      suppressNavigationWarningRef.current = false;
    }, 0);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    const submittedDraft = {
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      instructions: draft.instructions.trim(),
    };
    suppressNavigationWarningRef.current = true;
    try {
      onSubmit(submittedDraft);
      setDraft(submittedDraft);
      setInitialDraftSnapshot(getDraftSnapshot(submittedDraft));
      setDiscardOpen(false);
    } finally {
      resetWarningSuppression();
    }
  };

  const back = () => {
    if (isDirty) {
      setDeleteOpen(false);
      setDiscardClosing(false);
      setDiscardOpen(true);
      return;
    }
    suppressNavigationWarningRef.current = true;
    try {
      onBack();
    } finally {
      resetWarningSuppression();
    }
  };

  function closeDiscardDialog(leaveEditor = false) {
    if (!discardOpen || discardClosing) return;

    setDiscardClosing(true);
    discardCloseTimerRef.current = window.setTimeout(() => {
      discardCloseTimerRef.current = null;
      setDiscardOpen(false);
      setDiscardClosing(false);

      if (!leaveEditor) return;

      suppressNavigationWarningRef.current = true;
      setInitialDraftSnapshot(currentDraftSnapshot);
      try {
        onBack();
      } finally {
        resetWarningSuppression();
      }
    }, 125);
  }

  const deleteSkill = () => {
    if (!onDelete) return;
    suppressNavigationWarningRef.current = true;
    try {
      onDelete();
      setInitialDraftSnapshot(currentDraftSnapshot);
      setDeleteOpen(false);
      setDiscardOpen(false);
    } finally {
      resetWarningSuppression();
    }
  };

  const askGemini = async () => {
    if (!onAskGemini) return;
    setIsAskingGemini(true);
    setAssistError('');
    try {
      const suggestion = await onAskGemini({ ...draft });
      if (suggestion) setDraft((current) => ({ ...current, ...suggestion }));
    } catch (error) {
      setAssistError(error instanceof Error
        ? error.message
        : 'Gemini could not update this skill. Try again.');
    } finally {
      setIsAskingGemini(false);
    }
  };

  return (
    <main className={`spark-skill-editor ${className}`.trim()} aria-labelledby={headingId}>
      <form className="spark-skill-editor__content" onSubmit={submit}>
        <header className="spark-skill-editor__header">
          <button type="button" className="spark-skill-editor__back" onClick={back}>
            <MaterialSymbol family="luminous" name="arrow_back" size={28} weight={260} roundness={100} />
            <span id={headingId}>Skills</span>
          </button>
          <div className="spark-skill-editor__header-actions">
            {isEditing && onDelete && (
              <button
                type="button"
                className="spark-skill-editor__delete"
                aria-label="Delete skill"
                title="Delete skill"
                onClick={() => setDeleteOpen(true)}
              >
                <MaterialSymbol family="luminous" name="delete" size={20} weight={320} roundness={100} />
              </button>
            )}
            <button type="submit" className="spark-skill-editor__create" disabled={!canSubmit}>
              <span>{isEditing ? 'Save' : 'Create'}</span>
            </button>
          </div>
        </header>

        {mode === 'gemini' && (
          <div className="spark-skill-editor__gemini-note">
            <MaterialSymbol family="luminous" name="auto_awesome" size={22} weight={340} roundness={100} />
            <div>
              <strong>Create with Gemini</strong>
              <span>Describe the reusable guidance you want Gemini to follow.</span>
            </div>
          </div>
        )}

        <section className="spark-skill-editor__panel" aria-label="Skill details">
          {/* Gemini's skill editor has no in-card header — the card opens straight
            * onto the name field. The page's own back-nav supplies the context. */}
          {/* Gemini's `.title-section` is an unlabelled input. */}
          <div className="spark-skill-editor__field spark-skill-editor__field--title">
            <input
              id={nameId}
              type="text"
              value={draft.name}
              placeholder="Name your skill"
              aria-label="Skill name"
              autoComplete="off"
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </div>

          <label className="spark-skill-editor__field spark-skill-editor__field--description" htmlFor={descriptionId}>
            <span>Description</span>
            <textarea
              id={descriptionId}
              rows={1}
              value={draft.description}
              placeholder="Give your skill a description"
              autoComplete="off"
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </label>

          <div className="spark-skill-editor__field">
            <div className="spark-skill-editor__instructions-heading">
              <label htmlFor={instructionsId}>Instructions</label>
            </div>
            {assistError && <p className="spark-skill-editor__assist-error" role="alert">{assistError}</p>}
            <textarea
              id={instructionsId}
              value={draft.instructions}
              placeholder="Describe what you want Gemini to do"
              onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))}
            />
          </div>
        </section>
      </form>
      {deleteOpen && onDelete && (
        <div
          className="spark-skill-editor__dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDeleteOpen(false);
          }}
        >
          <div className="spark-skill-editor__delete-dialog" role="dialog" aria-modal="true" aria-labelledby={deleteHeadingId}>
            <h2 id={deleteHeadingId}>Delete skill?</h2>
            <p>This skill will be permanently removed.</p>
            <div>
              <button type="button" autoFocus onClick={() => setDeleteOpen(false)}>Cancel</button>
              <button type="button" className="is-danger" onClick={deleteSkill}>Delete</button>
            </div>
          </div>
        </div>
      )}
      {discardOpen && (
        <div
          className={`spark-skill-editor__dialog-backdrop spark-skill-editor__dialog-backdrop--discard${discardClosing ? ' is-closing' : ''}`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeDiscardDialog();
          }}
        >
          <div
            className={`spark-skill-editor__discard-dialog${discardClosing ? ' is-closing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={discardHeadingId}
            aria-describedby={discardDescriptionId}
          >
            <div className="spark-skill-editor__discard-copy">
              <h2 id={discardHeadingId}>Leave without saving?</h2>
              <p id={discardDescriptionId}>You&apos;ll lose any recent changes</p>
            </div>
            <div className="spark-skill-editor__discard-actions">
              <button type="button" autoFocus disabled={discardClosing} onClick={() => closeDiscardDialog()}>
                <span>Cancel</span>
              </button>
              <button
                type="button"
                className="is-discard"
                disabled={discardClosing}
                onClick={() => closeDiscardDialog(true)}
              >
                <span>Leave</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default SparkSkillEditor;
