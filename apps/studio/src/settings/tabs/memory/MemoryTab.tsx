/**
 * Settings → Personal Intelligence → Memory.
 *
 * The notes Willow has written about the user, one claim per row with the
 * receipt for it, plus the three things that manage them: add, refresh, delete
 * all. Everything else about this feature — the master toggle's home, Connected
 * Apps, Saved Info — lives on the pages around this one.
 *
 * The rows, the status copy and the page shell are three files rather than one.
 * The list alone is four sections of rows each with a menu and a provenance
 * line, and the copy is the part most likely to be wrong, so it is a pure
 * function that can be checked without rendering anything.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
  addUserBullet,
  buildDecision,
  buildProfileNow,
  clearProfile,
  isBuildRunning,
  profileStore,
  PROFILE_SECTIONS,
  removeBullet,
  setProfileEnabled,
  updateBullet,
  type ProfileBullet,
  type ProfileSectionId,
  type RebuildOutcome,
  type ScheduleDecision,
} from '@willow/personal';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { MemoryList } from './MemoryList';
import { describeOutcome, describeSchedule, formatLastBuilt } from './build-status';
import './MemoryTab.css';

/** Where the Add dialog starts. Interests is the section that fills up first. */
const DEFAULT_SECTION: ProfileSectionId = 'interests';

/** How often the page re-checks for a build the idle timer started. */
const RUN_POLL_MS = 5_000;

export const MemoryTab: React.FC = () => {
  const { enabled, bullets, lastBuiltAt } = useStore(profileStore);
  // `buildProfileNow` reads chats out of the user's folder, so the copy has to
  // know whether there is one — "nothing new to read" without a folder is a lie.
  const { isLocalFolderConnected: hasFolder } = useLocalFS();

  const [decision, setDecision] = useState<ScheduleDecision | null>(null);
  const [isRunning, setIsRunning] = useState(isBuildRunning());
  const [outcome, setOutcome] = useState<RebuildOutcome | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalAnimateState, setModalAnimateState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [section, setSection] = useState<ProfileSectionId>(DEFAULT_SECTION);
  const [inputValue, setInputValue] = useState('');
  const [dateValue, setDateValue] = useState('');

  /**
   * Why an automatic build is, or is not, due.
   *
   * Re-asked whenever `lastBuiltAt` moves, because a completed build starts a
   * cooldown and that changes the answer. Renders as nothing until it resolves —
   * it has to list the folder's chats first.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await buildDecision();
      if (!cancelled) setDecision(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [lastBuiltAt, enabled, hasFolder]);

  // A build also runs off the idle timer, and this page should show that rather
  // than sit on a stale "Refresh now" while one is already going.
  useEffect(() => {
    const poll = window.setInterval(() => setIsRunning(isBuildRunning()), RUN_POLL_MS);
    return () => window.clearInterval(poll);
  }, []);

  const openModal = () => {
    setIsModalOpen(true);
    setModalAnimateState('opening');
    // Two frames so the browser paints the initial scale(0.8) before the
    // 'open' class starts the transition. Same trick as Saved Info.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setModalAnimateState('open'));
    });
  };

  const handleOpenAddModal = () => {
    setModalMode('add');
    setEditingId(null);
    setSection(DEFAULT_SECTION);
    setInputValue('');
    setDateValue('');
    openModal();
  };

  /**
   * Edit reuses the same dialog, minus the category picker.
   *
   * `updateBullet` patches text and date only — moving a bullet between sections
   * would have to re-run the caps, and a picker that silently did nothing is
   * worse than no picker.
   */
  const handleOpenEditModal = (bullet: ProfileBullet) => {
    setModalMode('edit');
    setEditingId(bullet.id);
    setSection(bullet.section);
    setInputValue(bullet.text);
    setDateValue(bullet.date ?? '');
    openModal();
  };

  const handleCloseModal = () => {
    setModalAnimateState('closing');
    setTimeout(() => {
      setIsModalOpen(false);
      setModalAnimateState('closed');
    }, 75);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = inputValue.trim();
    if (!text) return;

    if (modalMode === 'add') {
      addUserBullet({ section, text, ...(dateValue ? { date: dateValue } : {}) });
    } else if (editingId) {
      // `date: null` is how `updateBullet` is told to drop a date, as distinct
      // from `undefined`, which means "leave whatever is there".
      updateBullet(editingId, { text, date: dateValue || null });
    }
    handleCloseModal();
  };

  const handleDeleteAll = () => {
    if (window.confirm('Delete every note Willow has written about you?')) clearProfile();
  };

  const handleRefresh = useCallback(async () => {
    if (isBuildRunning()) return;
    setIsRunning(true);
    setOutcome(null);
    const result = await buildProfileNow();
    // Re-asked after the run, and this is what lets the failure copy tell a
    // "nothing changed" apart from a missing API key: both come back as the same
    // `nothing-to-do`, and only the decision knows which one happened.
    setDecision(await buildDecision());
    setOutcome(result);
    setIsRunning(false);
  }, []);

  const statusLine = isRunning
    ? 'Reading your chats and updating notes…'
    : outcome
      ? describeOutcome(outcome, { hasFolder, decisionReason: decision?.run ? undefined : decision?.reason })
      : decision
        ? describeSchedule(decision, { hasFolder, hasBuilt: Boolean(lastBuiltAt) })
        : '';

  return (
    <div className="mem-container gemini-chat-scrollbar">
      <div className="mem-window">
        <header className="mem-header">
          <div className="mem-header-top">
            <h2 className="mem-display-s">Your memory</h2>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Whether Willow uses what it remembers"
              className={`mem-switch ${enabled ? 'mem-switch-on' : ''}`}
              onClick={() => setProfileEnabled(!enabled)}
            >
              <span className="mem-switch-track" />
              <span className="mem-switch-handle" />
            </button>
          </div>

          <p className="mem-subtitle mem-body-l">
            Notes about you, gathered from your saved chats and any connected apps, that Willow uses
            to tailor its answers. Edit or delete anything here, and it stays edited or deleted.
          </p>
          <p className="mem-last-built mem-body-m">{formatLastBuilt(lastBuiltAt)}</p>
        </header>

        <div className="mem-actions">
          <button type="button" className="mem-button mem-button-filled" onClick={handleOpenAddModal}>
            <span className="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color">add</span>
            Add
          </button>
          <button
            type="button"
            className="mem-button mem-button-outlined"
            disabled={isRunning || !enabled}
            onClick={() => void handleRefresh()}
          >
            <span className="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color">
              {isRunning ? 'hourglass_empty' : 'refresh'}
            </span>
            {isRunning ? 'Updating…' : 'Refresh now'}
          </button>
          {bullets.length > 0 && (
            <button
              type="button"
              className="mem-button mem-button-outlined mem-button-trailing"
              onClick={handleDeleteAll}
            >
              <span className="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color">delete</span>
              Delete all
            </button>
          )}
        </div>

        <p className="mem-status mem-body-m" role="status" aria-live="polite">
          {statusLine}
        </p>

        <MemoryList bullets={bullets} onEdit={handleOpenEditModal} onDelete={removeBullet} />

        {bullets.length === 0 && (
          <p className="mem-empty mem-body-l">
            {enabled
              ? 'Nothing here yet. Willow writes this page from your saved chats once you have had a few, or you can add a note yourself.'
              : 'Memory is off, so Willow is not adding anything. Turn it on and it will start from your saved chats.'}
          </p>
        )}
      </div>

      {isModalOpen && (
        <>
          <div
            className={`mem-dialog-backdrop ${
              modalAnimateState === 'open' || modalAnimateState === 'closing' ? 'mem-backdrop-show' : ''
            }`}
            onClick={handleCloseModal}
          />
          <div className="mem-dialog-overlay">
            <form
              onSubmit={handleSubmit}
              className={`mem-dialog ${modalAnimateState === 'open' ? 'mem-dialog-open' : ''} ${
                modalAnimateState === 'closing' ? 'mem-dialog-closing' : ''
              }`}
            >
              <h1 className="mem-dialog-title">
                {modalMode === 'add' ? 'What should Willow remember about you?' : 'Edit note'}
              </h1>

              <div className="mem-dialog-content">
                <div className="mem-dialog-field">
                  <textarea
                    className="mem-dialog-input"
                    placeholder="For example, “Prefers short, direct answers over essays”"
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    autoFocus
                  />
                </div>

                <div className="mem-dialog-meta">
                  {modalMode === 'add' ? (
                    <label className="mem-dialog-label">
                      Category
                      <select
                        className="mem-dialog-select"
                        value={section}
                        onChange={(event) => setSection(event.target.value as ProfileSectionId)}
                      >
                        {PROFILE_SECTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.heading}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="mem-dialog-static">
                      Category
                      <strong>{PROFILE_SECTIONS.find((entry) => entry.id === section)?.heading}</strong>
                    </span>
                  )}

                  <label className="mem-dialog-label">
                    Date {section === 'events' ? '' : '(optional)'}
                    <input
                      type="date"
                      className="mem-dialog-date"
                      value={dateValue}
                      onChange={(event) => setDateValue(event.target.value)}
                    />
                  </label>
                </div>

                {section === 'events' && (
                  <p className="mem-dialog-hint">
                    Notes in this category are dropped 60 days after their date, so a finished trip
                    does not keep shaping answers. Without a date this one is kept indefinitely.
                  </p>
                )}
              </div>

              <div className="mem-dialog-actions">
                <button type="button" className="mem-dialog-cancel" onClick={handleCloseModal}>
                  Cancel
                </button>
                <button type="submit" className="mem-dialog-submit" disabled={!inputValue.trim()}>
                  {modalMode === 'add' ? 'Add' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
};
