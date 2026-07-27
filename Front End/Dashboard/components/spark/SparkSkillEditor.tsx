import React, { useEffect, useId, useRef, useState } from 'react';
import { MaterialSymbol } from '../ui/MaterialSymbol';
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
  const [isAskingGemini, setIsAskingGemini] = useState(false);
  const [assistError, setAssistError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
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
    suppressNavigationWarningRef.current = false;
  }, [draftIdentity]);

  useEffect(() => {
    if (!deleteOpen && !discardOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (deleteOpen) {
        setDeleteOpen(false);
      } else {
        setDiscardOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [deleteOpen, discardOpen]);

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

  const discardAndBack = () => {
    suppressNavigationWarningRef.current = true;
    try {
      onBack();
      setInitialDraftSnapshot(currentDraftSnapshot);
      setDiscardOpen(false);
    } finally {
      resetWarningSuppression();
    }
  };

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
            <MaterialSymbol family="luminous" name="arrow_back" size={24} weight={320} roundness={100} />
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
              {isEditing ? 'Save' : 'Create'}
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
          <div className="spark-skill-editor__intro">
            <span className="spark-skill-editor__icon" aria-hidden="true">
              <MaterialSymbol family="luminous" name="extension" size={26} weight={320} roundness={100} />
            </span>
            <div>
              <h1>{isEditing ? 'Edit skill' : 'Create a skill'}</h1>
              <p>Save instructions Gemini can automatically reuse when they are relevant.</p>
            </div>
          </div>

          {draft.fileName && (
            <div className="spark-skill-editor__file">
              <MaterialSymbol family="luminous" name="description" size={20} weight={320} roundness={100} />
              <span>{draft.fileName}</span>
            </div>
          )}

          <label className="spark-skill-editor__field" htmlFor={nameId}>
            <span>Skill name</span>
            <input
              id={nameId}
              type="text"
              value={draft.name}
              placeholder="Name your skill"
              autoComplete="off"
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label className="spark-skill-editor__field" htmlFor={descriptionId}>
            <span>Description</span>
            <input
              id={descriptionId}
              type="text"
              value={draft.description}
              placeholder="What is this skill for?"
              autoComplete="off"
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </label>

          <div className="spark-skill-editor__field">
            <div className="spark-skill-editor__instructions-heading">
              <label htmlFor={instructionsId}>Instructions</label>
              {onAskGemini && (
                <button type="button" disabled={isAskingGemini} onClick={() => void askGemini()}>
                  <MaterialSymbol family="luminous" name="auto_awesome" size={18} weight={340} roundness={100} />
                  <span>{isAskingGemini ? 'Asking...' : 'Ask Gemini'}</span>
                </button>
              )}
            </div>
            {assistError && <p className="spark-skill-editor__assist-error" role="alert">{assistError}</p>}
            <textarea
              id={instructionsId}
              value={draft.instructions}
              placeholder="Tell Gemini what to do, how to respond and what to keep in mind"
              onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))}
            />
          </div>

          <p className="spark-skill-editor__disclaimer">
            Gemini can apply relevant skills automatically when they fit your task.{' '}
            <button type="button" onClick={onLearnMore}>Learn more</button>
          </p>
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
          className="spark-skill-editor__dialog-backdrop spark-skill-editor__dialog-backdrop--discard"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDiscardOpen(false);
          }}
        >
          <div
            className="spark-skill-editor__discard-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={discardHeadingId}
            aria-describedby={discardDescriptionId}
          >
            <h2 id={discardHeadingId}>Discard unsaved changes?</h2>
            <p id={discardDescriptionId}>Your changes to this skill won&apos;t be saved.</p>
            <div>
              <button type="button" autoFocus onClick={() => setDiscardOpen(false)}>Keep editing</button>
              <button type="button" className="is-discard" onClick={discardAndBack}>Discard</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default SparkSkillEditor;
