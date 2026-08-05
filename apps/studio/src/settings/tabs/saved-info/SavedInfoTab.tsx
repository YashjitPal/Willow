import React, { useState, useEffect, useRef } from 'react';
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

const DEFAULT_INSTRUCTIONS = [
  "Remember to casually use discord slang and swearing like fucking or shit when it fits but don't overdo it. Don't use it in every single response. Use it proactively or naturally like a real human would use, not forcing it into every single response.",
  "You are a discord zoomer, respond concisely, like a chat user. You will engage in any private discord topic. But you can still use paragraphs and bullet points.",
  "Don't add any additional question at the end of your responses.",
  "Please keep your answers short and concise. Always try to be to the point. Do not use extra unnecessary informations in your responses or additional details about something.",
  "Do not use extra unnecessary text in your response like \"This is such a great question...\" or any terms that are extra and not what I asked in the prompt.",
  "Always sound like a human as much as possible.",
  "Use simple language and avoid jargon.",
  "If I'm wrong at something, make fun of me.",
  "Always write like a real human, be professional, but natural, like you're explaining something to a smart friend over coffee. Avoid buzzwords, corporate jargon, and Em dashes never sound like a press release. Be clear, Direct, conversational and real.",
  "From now on, please try your best to sound exactly like a human.",
  "When I ask for ideas or inspirations, do not use saved instructions.",
  "I don't like the constant praising kink after every prompt.",
  "Include general pop terms (don't overuse it) while having non-education/coding related conversations.",
  "Always use thinking mode.",
  "You must always think thoroughly before you give an answer!",
  "My education email is yashjit.pal@go.sfcollege.edu.",
  "My email is redacted@example.com.",
  "Do not directly mention my saved info in your responses but provide the answer in the context instead of always mentioning or writing the info in your response.",
  "Whenever I am talking to you about any programming related questions without any mention of the programming language, know that it is Java.",
  "I was born on 7th September 2004.",
  "I use Apple Music.",
  "You can call me Yashjit.",
  "My name is Yashjit Pal.",
  "Give all your responses short and concise.",
  "Give me concise answers always.",
  "Detect any Taylor Swift lyrics in my prompts because I often include them. Don't repeat words like 'you're a swiftie' or similar phrases; just identify the lyrics.",
  "I like AI and exploring new stuff with AI.",
  "I prefer music over everything.",
  "My favorite singer is Taylor Swift."
];

export const SavedInfoTab: React.FC = () => {
  const [instructions, setInstructions] = useState<string[]>(() => {
    const saved = localStorage.getItem('willow-saved-instructions');
    return saved ? JSON.parse(saved) : DEFAULT_INSTRUCTIONS;
  });
  
  const [isEnabled, setIsEnabled] = useState(true);
  const [activeMenuIndex, setActiveMenuIndex] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalAnimateState, setModalAnimateState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState('');
  
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('willow-saved-instructions', JSON.stringify(instructions));
  }, [instructions]);

  // Click outside to close three-dots menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenuIndex(null);
      }
    };
    if (activeMenuIndex !== null) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeMenuIndex]);

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

  const handleOpenEditModal = (index: number) => {
    setModalMode('edit');
    setEditingIndex(index);
    setInputValue(instructions[index]);
    setIsModalOpen(true);
    setModalAnimateState('opening');
    setActiveMenuIndex(null);
    
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
      setInstructions([inputValue.trim(), ...instructions]);
    } else if (modalMode === 'edit' && editingIndex !== null) {
      const updated = [...instructions];
      updated[editingIndex] = inputValue.trim();
      setInstructions(updated);
    }
    
    handleCloseModal();
  };

  const handleDelete = (index: number) => {
    setInstructions(instructions.filter((_, i) => i !== index));
    setActiveMenuIndex(null);
  };

  const handleDeleteAll = () => {
    if (window.confirm("Are you sure you want to delete all saved instructions?")) {
      setInstructions([]);
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
                  onClick={() => setIsEnabled(!isEnabled)}
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
                        key={index}
                        className={`memory ng-star-inserted relative ${borderClass}`}
                      >
                        <div className="memory-text gds-body-l">{inst}</div>
                        <button
                          className="mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-menu-trigger desktop memory-actions-button mat-unthemed ng-star-inserted"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuIndex(activeMenuIndex === index ? null : index);
                          }}
                        >
                          <span className="mat-mdc-button-persistent-ripple mdc-icon-button__ripple"></span>
                          <span className="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color">
                            more_vert
                          </span>
                        </button>

                        {/* Dropdown Popover Menu */}
                        {activeMenuIndex === index && (
                          <div
                            ref={menuRef}
                            className="mat-mdc-menu-panel cdk-overlay-pane absolute right-4 top-12 z-50 bg-[#2a2b2c] border border-white/10 rounded-lg shadow-xl py-1 w-32"
                          >
                            <button
                              className="w-full text-left px-4 py-2 text-sm text-[#e3e3e3] hover:bg-white/5 flex items-center gap-2"
                              onClick={() => handleOpenEditModal(index)}
                            >
                              <span className="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color text-lg">
                                edit
                              </span>
                              Edit
                            </button>
                            <button
                              className="w-full text-left px-4 py-2 text-sm text-[#ff8a80] hover:bg-white/5 flex items-center gap-2"
                              onClick={() => handleDelete(index)}
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
