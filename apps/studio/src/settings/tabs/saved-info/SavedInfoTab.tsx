/**
 * Settings → Personal Intelligence → Saved Info.
 *
 * The list itself lives in `@willow/core/saved-info-store`, not in this
 * component. A chat turn has to read it, and a chat turn is nowhere near this
 * part of the tree — before the store existed this page wrote localStorage and
 * nothing on the other side ever read it back, so every instruction typed here
 * was decoration.
 *
 * There is no seed data, on purpose. This file used to ship thirty entries
 * containing one specific person's name, birthdate and email addresses, handed
 * to every install.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import {
  savedInfoStore,
  setSavedInfoEnabled,
  addSavedInstruction,
  updateSavedInstruction,
  removeSavedInstruction,
  clearSavedInstructions,
} from '@willow/core/saved-info-store';
import './SavedInfoTab.css';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'gem-icon': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { fonticonname?: string };
      'mat-icon': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { fonticon?: string };
      'mat-slide-toggle': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export const SavedInfoTab: React.FC = () => {
  const { enabled: isEnabled, instructions } = useStore(savedInfoStore);

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalAnimateState, setModalAnimateState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');

  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside to close three-dots menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenuId(null);
      }
    };
    if (activeMenuId !== null) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeMenuId]);

  const handleOpenAddModal = () => {
    setModalMode('add');
    setInputValue('');
    setIsModalOpen(true);
    setModalAnimateState('opening');

    // Force a reflow so the browser applies the initial 'scale(0.8)' state
    // before we apply the 'dialog-open' class which triggers the CSS transition.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setModalAnimateState('open');
      });
    });
  };

  const handleOpenEditModal = (id: string, text: string) => {
    setModalMode('edit');
    setEditingId(id);
    setInputValue(text);
    setIsModalOpen(true);
    setModalAnimateState('opening');
    setActiveMenuId(null);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setModalAnimateState('open');
      });
    });
  };

  const handleCloseModal = () => {
    setModalAnimateState('closing');
    setTimeout(() => {
      setIsModalOpen(false);
      setModalAnimateState('closed');
    }, 75); // Exactly 75ms exit fade duration
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    if (modalMode === 'add') {
      addSavedInstruction(inputValue);
    } else if (modalMode === 'edit' && editingId !== null) {
      updateSavedInstruction(editingId, inputValue);
    }

    handleCloseModal();
  };

  const handleDelete = (id: string) => {
    removeSavedInstruction(id);
    setActiveMenuId(null);
  };

  const handleDeleteAll = () => {
    if (window.confirm("Are you sure you want to delete all saved instructions?")) {
      clearSavedInstructions();
    }
  };

  return (
    <div className="w-full h-full overflow-y-auto bg-[#0f0f0f] saved-info-container gemini-chat-scrollbar">
      <div className="page-content">
        {/* Header Section */}
        <div className="header desktop">
          <div className="page-title">
            <h2 className="gds-display-s ng-star-inserted">Your instructions for Willow</h2>
          </div>
          <div className="toggle-container">
            <div
              className={`mat-mdc-slide-toggle mat-accent ${
                isEnabled ? 'mat-mdc-slide-toggle-checked' : ''
              }`}
              id="mat-mdc-slide-toggle-0"
            >
              <div className="mdc-form-field mat-internal-form-field">
                <button
                  role="switch"
                  type="button"
                  className={`mdc-switch ${
                    isEnabled ? 'mdc-switch--selected mdc-switch--checked' : ''
                  }`}
                  tabIndex={0}
                  id="mat-mdc-slide-toggle-0-button"
                  aria-label="Enables or disables the saved info feature"
                  aria-checked={isEnabled}
                  onClick={() => setSavedInfoEnabled(!isEnabled)}
                >
                  <div className="mat-mdc-slide-toggle-touch-target"></div>
                  <span className="mdc-switch__track"></span>
                  <span className="mdc-switch__handle-track">
                    <span className="mdc-switch__handle">
                      <span className="mdc-switch__shadow">
                        <span className="mdc-elevation-overlay"></span>
                      </span>
                      <span className="mdc-switch__ripple">
                        <span className="mat-ripple mat-mdc-slide-toggle-ripple mat-focus-indicator"></span>
                      </span>
                      <span className="mdc-switch__icons">
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="mdc-switch__icon mdc-switch__icon--on">
                          <path d="M19.69,5.23L8.96,15.96l-4.23-4.23L2.96,13.5l6,6L21.46,7L19.69,5.23z"></path>
                        </svg>
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="mdc-switch__icon mdc-switch__icon--off">
                          <path d="M20 13H4v-2h16v2z"></path>
                        </svg>
                      </span>
                    </span>
                  </span>
                </button>
                <label
                  className="mdc-label"
                  htmlFor="mat-mdc-slide-toggle-0-button"
                  id="mat-mdc-slide-toggle-0-label"
                ></label>
              </div>
            </div>
          </div>

          {/* Intro Text */}
          <div className="intro-text gds-body-l ng-star-inserted">
            <span>
              Customize your Willow experience by giving it instructions.{' '}
              <a href="https://support.google.com/gemini?p=saved_info_instructions" target="_blank" rel="noopener noreferrer">
                Learn more
              </a>
              <br /> Examples:{' '}
            </span>
            <ul>
              <li>Start responses with a TL;DR summary</li>
              <li>Use bullet points for long paragraphs</li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="action-buttons-container no-examples-button">
            <button
              className="mdc-button mat-mdc-button-base create-memory-button mdc-button--unelevated mat-mdc-unelevated-button mat-primary"
              onClick={handleOpenAddModal}
            >
              <span className="mat-mdc-button-persistent-ripple mdc-button__ripple"></span>
              <span className="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color">
                add
              </span>
              <span className="mdc-button__label">
                <span>Add</span>
              </span>
            </button>

            {instructions.length > 0 && (
              <button
                className="mdc-button mat-mdc-button-base delete-all-memories-button mdc-button--outlined mat-mdc-outlined-button desktop mat-unthemed ng-star-inserted"
                onClick={handleDeleteAll}
              >
                <span className="mat-mdc-button-persistent-ripple mdc-button__ripple"></span>
                <span className="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color">
                  delete
                </span>
                <span className="mdc-button__label">
                  <span>Delete all</span>
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Memories / Instructions List */}
        {isEnabled && instructions.length > 0 && (
          <div className="ng-star-inserted">
            <div className="memories-groups ng-star-inserted">
              <div className="memories-group ng-star-inserted">
                <div className="memories-container">
                  {instructions.map((inst, index) => {
                    let borderClass = 'middle-item';
                    if (instructions.length === 1) {
                      borderClass = 'single-item';
                    } else if (index === 0) {
                      borderClass = 'first-item';
                    } else if (index === instructions.length - 1) {
                      borderClass = 'last-item';
                    }

                    return (
                      <div
                        key={inst.id}
                        className={`memory ng-star-inserted relative ${borderClass}`}
                      >
                        <div className="memory-text gds-body-l">{inst.text}</div>
                        <button
                          className="mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-menu-trigger desktop memory-actions-button mat-unthemed ng-star-inserted"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(activeMenuId === inst.id ? null : inst.id);
                          }}
                        >
                          <span className="mat-mdc-button-persistent-ripple mdc-icon-button__ripple"></span>
                          <span className="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color">
                            more_vert
                          </span>
                        </button>

                        {/* Dropdown Popover Menu */}
                        {activeMenuId === inst.id && (
                          <div
                            ref={menuRef}
                            className="mat-mdc-menu-panel cdk-overlay-pane absolute right-4 top-12 z-50 bg-[#2a2b2c] border border-white/10 rounded-lg shadow-xl py-1 w-32"
                          >
                            <button
                              className="w-full text-left px-4 py-2 text-sm text-[#e3e3e3] hover:bg-white/5 flex items-center gap-2"
                              onClick={() => handleOpenEditModal(inst.id, inst.text)}
                            >
                              <span className="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color text-lg">
                                edit
                              </span>
                              Edit
                            </button>
                            <button
                              className="w-full text-left px-4 py-2 text-sm text-[#ff8a80] hover:bg-white/5 flex items-center gap-2"
                              onClick={() => handleDelete(inst.id)}
                            >
                              <span className="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color text-lg">
                                delete
                              </span>
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal Dialog for Add / Edit */}
      {isModalOpen && (
        <>
          {/* Backdrop Overlay */}
          <div
            className={`dialog-backdrop ${
              modalAnimateState === 'open' || modalAnimateState === 'closing' ? 'backdrop-show' : ''
            }`}
            onClick={handleCloseModal}
          />
          {/* Global Container Wrapper */}
          <div className="dialog-overlay-wrapper">
            <form
              onSubmit={handleSubmit}
              className={`mat-mdc-dialog-container mdc-dialog cdk-dialog-container mat-mdc-dialog-container-with-actions ${
                modalAnimateState === 'open' ? 'dialog-open' : ''
              } ${modalAnimateState === 'closing' ? 'dialog-closing' : ''}`}
            >
              <h1 className="mat-mdc-dialog-title gds-title-l">
                {modalMode === 'add' ? 'What do you want Willow to remember?' : 'Edit saved instruction'}
              </h1>
              <div className="mat-mdc-dialog-content">
                <div className="edit-memory-field-wrapper">
                  <textarea
                    className="edit-memory-input"
                    placeholder="For example, “I prefer short, concise responses”"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>
              <div className="mat-mdc-dialog-actions">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={handleCloseModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="submit-btn"
                  disabled={!inputValue.trim()}
                >
                  Submit
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
};
