import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useCompactViewport } from '@willow/chat/use-compact-viewport';
import { CustomizeIcon } from './CustomizeIcon';
import { CustomizeCardMenu, cardMenuExitMs } from './CustomizeCardMenu';
import { LmIcon } from './custom-app/LmIcon';
import { canSaveSkill, skillErrors, slugSkillName } from './skill-name';
import { CONNECTORS_DATA, type CustomizeItem } from './customize-data';
import { GeminiDialog, GeminiDialogPill } from '@willow/ui/GeminiDialog';

interface CustomizeDetailViewProps {
  item: CustomizeItem;
  fromTab?: string;
  onBack: () => void;
  onSelect: (item: CustomizeItem) => void;
  isDisconnected?: boolean;
  /** A connector's setup notices and controls (GitHub's token field), under its header. */
  connectControl?: React.ReactNode;
  onDisconnect?: (item: CustomizeItem) => void;
  onReconnect?: (item: CustomizeItem) => void;
  onSaveSkill?: (
    item: CustomizeItem,
    data: { title: string; description: string; instructions: string },
    isNew: boolean,
  ) => void;
  onDeleteSkill?: (skillId: string) => void;
  onUseNow?: (item: CustomizeItem) => void;
  /** A connector's "prompt to try", sent into a new chat. */
  onUsePrompt?: (item: CustomizeItem, prompt: string) => void;
  onEditWithGemini?: (item: CustomizeItem) => void;
  onDownloadSkill?: (item: CustomizeItem) => void;
  onReplaceSkill?: (item: CustomizeItem, fileContent?: string) => void;
  onToggleActiveSkill?: (item: CustomizeItem) => void;
  isInactive?: boolean;
  /** The names of the user's other skills, which a skill may not take. */
  existingSkillNames?: readonly string[];
}

const NO_NAMES: readonly string[] = [];

export const CustomizeDetailView: React.FC<CustomizeDetailViewProps> = ({
  item,
  fromTab = 'connectors',
  onBack,
  onSelect,
  isDisconnected = false,
  connectControl,
  onDisconnect,
  onReconnect,
  onSaveSkill,
  onDeleteSkill,
  onUseNow,
  onUsePrompt,
  onEditWithGemini,
  onDownloadSkill,
  onReplaceSkill,
  onToggleActiveSkill,
  isInactive = false,
  existingSkillNames = NO_NAMES,
}) => {
  const isCompact = useCompactViewport();

  useLayoutEffect(() => {
    const root = document.querySelector('.customize-page-root');
    if (root) {
      root.scrollTop = 0;
    }
  }, [item.id]);

  const isConnector = item.type === 'connector';
  const isEditing =
    !item.hasAddButton &&
    item.id !== 'new-skill' &&
    !item.id.startsWith('create-') &&
    !item.id.startsWith('new-');
  const backLabel =
    fromTab === 'skills'
      ? 'Skills'
      : fromTab === 'discover'
        ? 'Discover'
        : fromTab === 'connectors'
          ? 'Connectors'
          : fromTab;

  const initialTitle =
    item.id.startsWith('new-') || item.id.startsWith('create-')
      ? ''
      : item.slug ||
        (item.hasAddButton
          ? item.slug || item.title.toLowerCase().replace(/\s+/g, '-')
          : item.title);
  const initialDesc = item.description || item.subtitle || '';
  const initialInstructions = item.instructions || '';

  const [skillTitle, setSkillTitle] = useState(initialTitle);
  const [skillDesc, setSkillDesc] = useState(initialDesc);
  const [skillInstructions, setSkillInstructions] = useState(initialInstructions);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardClosing, setDiscardClosing] = useState(false);
  // Set by the first Create or Save that could not go through; from then on each field says what it lacks.
  const [validated, setValidated] = useState(false);

  const [cardMenu, setCardMenu] = useState<{
    triggerRect: DOMRect;
    isClosing: boolean;
  } | null>(null);
  const cardMenuTimeoutRef = useRef<number | null>(null);

  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectClosing, setDisconnectClosing] = useState(false);

  useEffect(() => {
    return () => {
      if (cardMenuTimeoutRef.current) {
        clearTimeout(cardMenuTimeoutRef.current);
      }
    };
  }, []);

  const openCardMenu = (rect: DOMRect) => {
    if (cardMenuTimeoutRef.current) {
      clearTimeout(cardMenuTimeoutRef.current);
      cardMenuTimeoutRef.current = null;
    }
    setCardMenu({ triggerRect: rect, isClosing: false });
  };

  const closeCardMenu = () => {
    if (!cardMenu || cardMenu.isClosing) return;
    setCardMenu((prev) => (prev ? { ...prev, isClosing: true } : null));
    cardMenuTimeoutRef.current = window.setTimeout(() => {
      setCardMenu(null);
      cardMenuTimeoutRef.current = null;
    }, cardMenuExitMs(isCompact));
  };

  const handleDisconnectClick = () => {
    closeCardMenu();
    setDisconnectOpen(true);
  };

  const closeDisconnectDialog = () => {
    if (!disconnectOpen || disconnectClosing) return;
    setDisconnectClosing(true);
    setTimeout(() => {
      setDisconnectOpen(false);
      setDisconnectClosing(false);
    }, 125);
  };

  const handleConfirmDisconnect = () => {
    if (!disconnectOpen || disconnectClosing) return;
    setDisconnectClosing(true);
    setTimeout(() => {
      setDisconnectOpen(false);
      setDisconnectClosing(false);
      onDisconnect?.(item);
    }, 125);
  };

  const isDirty =
    skillTitle !== initialTitle ||
    skillDesc !== initialDesc ||
    skillInstructions !== initialInstructions;

  const draft = { name: skillTitle, description: skillDesc, instructions: skillInstructions };
  // A skill's own name never counts against it, whether the list shows its slug or a name it was given.
  const otherNames = isEditing ? existingSkillNames.filter((name) => name !== item.title) : existingSkillNames;
  const canSubmit = canSaveSkill(draft, initialTitle, otherNames);
  const errors = skillErrors(draft, initialTitle, otherNames, validated);

  const handleBack = () => {
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    onBack();
  };

  const closeDiscardDialog = (leave = false) => {
    if (!discardOpen || discardClosing) return;
    setDiscardClosing(true);
    setTimeout(() => {
      setDiscardOpen(false);
      setDiscardClosing(false);
      if (leave) {
        onBack();
      }
    }, 125);
  };

  const handleSave = () => {
    if (!canSubmit) {
      setValidated(true);
      return;
    }
    if (!isEditing) {
      onSaveSkill?.(
        item,
        {
          title: skillTitle,
          description: skillDesc,
          instructions: skillInstructions,
        },
        true,
      );
    } else {
      if (!isDirty) return;
      onSaveSkill?.(
        item,
        {
          title: skillTitle,
          description: skillDesc,
          instructions: skillInstructions,
        },
        false,
      );
    }
  };

  const relatedItems = React.useMemo(() => {
    if (!item.relatedIds || item.relatedIds.length === 0) return [];
    return item.relatedIds
      .map((id) => CONNECTORS_DATA.find((c) => c.id === id))
      .filter((c): c is CustomizeItem => Boolean(c));
  }, [item]);

  return (
    <div className="customize-detail-page">
      {isConnector ? (
        <div className="page-wrapper">
          <nav aria-label="Breadcrumb navigation" className="top-nav-bar">
            <button
              type="button"
              className="back-button gds-label-l"
              onClick={onBack}
              aria-label={`Back to ${backLabel}`}
            >
              <LmIcon name="arrow_back" size={20} className="back-icon" />
              <span className="back-button-text gds-label-l">{backLabel}</span>
            </button>
          </nav>

          <main className="details-content-column">
            <header className="app-header">
              <div className="app-icon-container">
                {item.logoSrc ? (
                  <img
                    src={item.logoSrc}
                    alt=""
                    aria-hidden="true"
                    className="app-icon-img"
                  />
                ) : (
                  <div className="app-icon-placeholder">
                    <CustomizeIcon
                      name={item.symbol || 'edit_note'}
                      size={28}
                    />
                  </div>
                )}
              </div>

              <div className="app-header-main">
                <div className="app-title-group">
                  <div className="app-title-row">
                    <h1 className="app-title gds-headline-m">{item.title}</h1>
                  </div>
                  <div className="app-subtitle gds-body-m">{item.subtitle}</div>
                </div>

                <div className="app-header-action">
                  {isDisconnected ? (
                    <button
                      type="button"
                      className="use-in-chat-button"
                      aria-label={`Connect ${item.title}`}
                      onClick={() => onReconnect?.(item)}
                    >
                      <span className="gds-body-m">Connect</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="use-in-chat-button"
                        aria-label={`Disconnect ${item.title}`}
                        onClick={handleDisconnectClick}
                      >
                        <span className="gds-body-m">Disconnect</span>
                      </button>
                      <button
                        type="button"
                        className="overflow-menu-button"
                        aria-label="More options"
                        aria-haspopup="menu"
                        aria-expanded={Boolean(cardMenu && !cardMenu.isClosing)}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (cardMenu) {
                            closeCardMenu();
                          } else {
                            openCardMenu(e.currentTarget.getBoundingClientRect());
                          }
                        }}
                      >
                        <LmIcon name="more_horiz" size={24} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </header>

            {connectControl}

            {item.capabilities && item.capabilities.length > 0 && (
              <section className="capabilities-section">
                <h2 className="section-title gds-body-l">
                  {item.capTitle || `Using ${item.title}, Gemini can:`}
                </h2>
                <ul className="capabilities-list">
                  {item.capabilities.map((cap, idx) => (
                    <li key={idx} className="capability-item">
                      <CustomizeIcon
                        name="check"
                        size={16}
                        className="check-icon"
                      />
                      <span className="capability-text gds-body-m">{cap}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {item.prompts && item.prompts.length > 0 && (
              <section className="prompts-section" aria-label="Suggested starter prompts">
                <div className="prompts-row">
                  {item.prompts.map((prompt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="prompt-card"
                      onClick={() => onUsePrompt?.(item, prompt)}
                    >
                      <span className="prompt-text gds-body-m">{prompt}</span>
                      <span className="prompt-icon-container">
                        <CustomizeIcon
                          name="prompt_suggestion"
                          size={16}
                          className="prompt-icon"
                        />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {(item.category || item.signInRequired || item.description) && (
              <section className="info-section">
                <h2 className="section-title gds-body-l">Information</h2>
                <dl className="info-list">
                  {item.category && (
                    <div className="info-row">
                      <dt className="info-label gds-body-m">Categories</dt>
                      <dd className="info-value gds-body-m">
                        <span className="info-interactive-text">
                          {item.category}
                        </span>
                      </dd>
                    </div>
                  )}
                  {item.signInRequired && (
                    <div className="info-row">
                      <dt className="info-label gds-body-m">Sign in</dt>
                      <dd className="info-value gds-body-m">
                        {item.signInRequired}
                      </dd>
                    </div>
                  )}
                </dl>

                {item.description && (
                  <div className="details-description gds-body-m">
                    {item.description}
                  </div>
                )}
              </section>
            )}

            {relatedItems.length > 0 && (
              <section className="related-apps-section">
                <h2 className="section-title gds-body-l">Related apps</h2>
                <div className="related-apps-grid">
                  {relatedItems.map((rel) => (
                    <button
                      key={rel.id}
                      type="button"
                      className="related-app-card"
                      onClick={() => onSelect(rel)}
                      aria-label={rel.title}
                    >
                      <div className="related-app-icon-container">
                        {rel.logoSrc ? (
                          <img
                            src={rel.logoSrc}
                            alt=""
                            aria-hidden="true"
                            className="app-icon-img"
                          />
                        ) : (
                          <CustomizeIcon
                            name={rel.symbol || 'edit_note'}
                            size={20}
                          />
                        )}
                      </div>
                      <div className="related-app-content">
                        <div className="related-app-title gds-body-l">{rel.title}</div>
                        <div className="related-app-subtitle gds-body-s">{rel.subtitle}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </main>
        </div>
      ) : (
        <div className="skill-folder-manager">
          <div className="manager-header">
            <button
              type="button"
              className="back-to-skills-btn"
              onClick={handleBack}
              aria-label={`Back to ${backLabel}`}
            >
              <LmIcon name="arrow_back" size={20} className="back-icon" />
              <span className="back-button-text">{backLabel}</span>
            </button>
            <div className="editor-actions">
              <button
                type="button"
                className="save-button"
                aria-label="Save skill"
                disabled={isEditing && !isDirty}
                onClick={handleSave}
              >
                <span className="save-label">
                  {!isEditing ? 'Create' : isDirty ? 'Save' : 'Saved'}
                </span>
              </button>
              {isEditing && (
                <button
                  type="button"
                  className="overflow-menu-button"
                  aria-label="Skill actions"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    openCardMenu(rect);
                  }}
                >
                  <LmIcon name="more_horiz" size={20} />
                </button>
              )}
            </div>
          </div>

          <div className="folder-manager-container">
            <div className="skill-detail-panel">
              <div className="editor-body">
                <div className="editor-new-content">
                  <div className="editor-section title-section">
                    <div className="title-container">
                      <input
                        type="text"
                        className="editor-title-input gds-body-m"
                        placeholder='Name your skill. For example: "meeting-notes-summarizer"'
                        aria-label="Skill name"
                        aria-invalid={Boolean(errors.name || errors.taken)}
                        value={skillTitle}
                        onChange={(e) => {
                          const input = e.target;
                          const caret = input.selectionStart ?? input.value.length;
                          const next = slugSkillName(input.value);
                          const at = slugSkillName(input.value.slice(0, caret)).length;
                          input.value = next;
                          input.setSelectionRange(at, at);
                          setSkillTitle(next);
                        }}
                      />
                      {errors.name && <span className="error-message gds-body-s">{errors.name}</span>}
                      {errors.taken && <span className="error-message gds-body-s">{errors.taken}</span>}
                    </div>
                  </div>

                  <div className="editor-section">
                    <span className="editor-section-label gds-body-s">
                      Description
                    </span>
                    <textarea
                      className="description-text gds-body-m gemini-chat-scrollbar"
                      rows={2}
                      placeholder='Describe what your skill should do and when to use it. For example: "Use when asked to summarize meeting notes or transcripts. Starts running on prompts like &apos;recap this call&apos;, &apos;what are the action items&apos; or &apos;find key decisions&apos;."'
                      aria-label="Skill description"
                      aria-invalid={Boolean(errors.description)}
                      value={skillDesc}
                      onChange={(e) => setSkillDesc(e.target.value)}
                    />
                    {errors.description && <span className="error-message gds-body-s">{errors.description}</span>}
                  </div>

                  <div className="editor-section">
                    <span className="editor-section-label gds-body-s">
                      Instructions
                    </span>
                    <textarea
                      className="content-editable gds-body-m gemini-chat-scrollbar"
                      rows={14}
                      placeholder='Describe what you want Gemini to do. For example: "Extract key decisions, list action items with owners, and highlight unresolved questions using bullet points."'
                      aria-label="Skill instructions"
                      aria-invalid={Boolean(errors.instructions)}
                      value={skillInstructions}
                      onChange={(e) => setSkillInstructions(e.target.value)}
                    />
                    {errors.instructions && <span className="error-message gds-body-s">{errors.instructions}</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {discardOpen && (
            <GeminiDialog
              headingAs="h1"
              title={isEditing ? 'Leave without saving?' : 'Leave without creating?'}
              width={512}
              message
              closing={discardClosing}
              onDismiss={() => closeDiscardDialog(false)}
              actions={(
                <>
                  <GeminiDialogPill
                    className="willow-gdlg-pill--text"
                    disabled={discardClosing}
                    onClick={() => closeDiscardDialog(false)}
                  >
                    Cancel
                  </GeminiDialogPill>
                  <GeminiDialogPill
                    disabled={discardClosing}
                    onClick={() => closeDiscardDialog(true)}
                  >
                    Leave
                  </GeminiDialogPill>
                </>
              )}
            >
              <p>You&apos;ll lose any recent changes</p>
            </GeminiDialog>
          )}
        </div>
      )}

      {cardMenu && (
        <CustomizeCardMenu
          item={item}
          triggerRect={cardMenu.triggerRect}
          isOpen={!cardMenu.isClosing}
          isClosing={cardMenu.isClosing}
          onClose={closeCardMenu}
          onDeleteSkill={() => {
            closeCardMenu();
            onDeleteSkill?.(item.id);
            onBack();
          }}
          onUseNow={onUseNow}
          onEditWithGemini={onEditWithGemini}
          onDownloadSkill={onDownloadSkill}
          onReplaceSkill={(it, content) => {
            onReplaceSkill?.(it, content);
            if (content) {
              try {
                const parsed = JSON.parse(content);
                if (parsed.title) setSkillTitle(parsed.title);
                if (parsed.description) setSkillDesc(parsed.description);
                if (parsed.instructions) setSkillInstructions(parsed.instructions);
              } catch {
                setSkillInstructions(content);
              }
            }
          }}
          onToggleActiveSkill={onToggleActiveSkill}
          isInactive={isInactive}
        />
      )}

      {disconnectOpen && (
        <GeminiDialog
          headingAs="h2"
          title={`Disconnect ${item.title} from Willow?`}
          width={512}
          message
          closing={disconnectClosing}
          onDismiss={closeDisconnectDialog}
          actions={(
            <>
              <GeminiDialogPill
                className="willow-gdlg-pill--text"
                disabled={disconnectClosing}
                onClick={closeDisconnectDialog}
              >
                Cancel
              </GeminiDialogPill>
              <GeminiDialogPill
                disabled={disconnectClosing}
                onClick={handleConfirmDisconnect}
              >
                Disconnect
              </GeminiDialogPill>
            </>
          )}
        >
          <div className="customize-disconnect-dialog-content">
            <div className="customize-disconnect-section">
              <h3 className="customize-disconnect-section-title">
                Disconnecting apps and deleting data
              </h3>
              <p className="customize-disconnect-section-text">
                Disconnecting an app or deleting data in a Connected App doesn&apos;t delete any data from Willow Activity. You can manage and delete your Willow activity anytime. Deleting Willow activity also doesn&apos;t delete data in other services.
              </p>
            </div>
            <div className="customize-disconnect-section">
              <h3 className="customize-disconnect-section-title">
                What&apos;s not changing
              </h3>
              <p className="customize-disconnect-section-text">
                Your choices here don&apos;t change other personalization settings. For example, if your memory setting is on, Willow still uses your past chats to personalize your experience. Also, your choices here don&apos;t change whether other services exchange data and whether Connected Apps use data to improve their own services. Other services continue personalizing and sharing data according to their own settings.
              </p>
              <p className="customize-disconnect-section-text" style={{ marginTop: '12px' }}>
                Your choices here don&apos;t change Willow&apos;s ability to use public data to respond to you. For example, if YouTube isn&apos;t connected, Willow can still use public videos on YouTube to respond to you.
              </p>
            </div>
          </div>
        </GeminiDialog>
      )}
    </div>
  );
};
