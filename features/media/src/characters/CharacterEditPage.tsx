// Flow's character page (/character/<id>): the character's form on the left (name, voice, how it
// acts), its portrait — or its body — beside it with Portrait / Create body under it, the edit
// prompt below that, and the slot's history in a column on the right that Hide / Show history
// collapses (see character-page-prefs.ts for when it starts open). Hovering the image offers
// Download and Delete, Reroll and Try again. An edit or a reroll adds a version and opens it while
// it generates; a failed one hands the view back to the version it came from. Create body only
// opens the empty body slot with the portrait as the prompt's reference ("Describe body and
// outfit…"); generating from there makes the body. The layout is Flow's `flow-character-edit-page`,
// including its compact (short or narrow) and tablet arrangements.
import React from 'react';
import { useStore } from '@nanostores/react';
import { Tooltip } from '@willow/ui/Tooltip';
import type { MediaItem } from '../types';
import { GeneratingLayers } from '../GalleryTile';
import { FlowEditableText, FlowIcon, type MenuAnchor } from '../scenes/flow-ui';
import { showSnack } from '../scenes/scene-store';
import { SceneMediaPicker } from '../scenes/SceneMediaPicker';
import { imageVersions } from '../editor/ImageEditor';
import { ImageHistory } from '../editor/ImageHistory';
import { ConfirmDialog, DownloadMenu, FlagDialog } from '../editor/editor-overlays';
import { downloadMedia } from '../editor/media-download';
import { $characters, characterName, deleteCharacter, updateCharacter, UNTITLED_CHARACTER } from './character-store';
import type { CharacterHost, CharacterSlot } from './character-host';
import { CharacterPromptBox } from './CharacterPromptBox';
import { VoiceDialog } from './VoiceDialog';
import { VOICE_SAMPLE_URL, voiceByName, type CharacterVoice } from './voices';
import { readHistoryOpen, useTabletOrSmaller, writeHistoryOpen } from './character-page-prefs';
import { useMediaViewport } from '../use-media-viewport';
import '../scenes/scene-builder.css';
import '../editor/image-editor.css';
import './characters.css';
import './characters-responsive.css';

const uid = () => `${Date.now()}-character-${Math.random().toString(36).slice(2, 8)}`;

const ratioOf = (ratio: string | undefined) => {
  const [w, h] = (ratio || '').split(':').map(Number);
  return w > 0 && h > 0 ? w / h : 1;
};

/** Flow's `flow-character-voice-button`: Select a voice, or the chosen voice as a card that plays its sample. */
const CharacterVoiceButton: React.FC<{ voice?: CharacterVoice; sample?: string; onOpen: () => void; onRemove: () => void }> = ({ voice, sample, onOpen, onRemove }) => {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  if (!voice) {
    return (
      <button type="button" className="ce-voice-btn" onClick={onOpen}>
        <FlowIcon name="voice_selection" size={18} className="ce-voice-btn__icon" />
        <span className="ce-voice-btn__label">Select a voice</span>
      </button>
    );
  }
  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play().catch(() => setPlaying(false));
  };
  return (
    <div className="ce-voice-card">
      <button type="button" className="ce-voice-card__start" onClick={onOpen}>
        <div className="ce-voice-chip" style={{ background: `linear-gradient(${voice.from} 0%, ${voice.to} 100%)` }}>
          <FlowIcon name="voice_selection" size={20} />
        </div>
        <div className="ce-voice-card__info">
          <span className="ce-voice-card__name">{voice.name}</span>
          <span className="ce-voice-card__description">{voice.description}</span>
        </div>
      </button>
      <div className="ce-voice-card__end">
        <Tooltip content={playing ? 'Pause preview' : 'Play preview'} className="sb-tooltip">
          <button type="button" aria-label={playing ? 'Pause preview' : 'Play preview'} className="ce-voice-play" onClick={toggle}>
            <FlowIcon name={playing ? 'pause' : 'play_arrow'} size={20} />
          </button>
        </Tooltip>
        <button type="button" className="ce-voice-remove" onClick={onRemove}>Remove</button>
      </div>
      <audio
        ref={audioRef}
        src={sample || VOICE_SAMPLE_URL(voice.name)}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setPlaying(false)}
      />
    </div>
  );
};

/** Flow's `flow-slot-chip-button`. */
const SlotChip: React.FC<{
  icon: string;
  label: string;
  thumbnail?: string;
  active: boolean;
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}> = ({ icon, label, thumbnail, active, disabled, loading, onClick }) => (
  <button type="button" aria-label={label} className={`ce-slot${active ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`} disabled={disabled} onClick={onClick}>
    <span className={`ce-slot__thumb${active ? ' is-active' : ''}`}>
      {loading ? <GeneratingLayers isRevealing={false} /> : thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : <FlowIcon name={icon} size={18} />}
    </span>
    <span className="ce-slot__label">{label}</span>
  </button>
);

export const CharacterEditPage: React.FC<{ characterId: string; host: CharacterHost; onClose: () => void }> = ({ characterId, host, onClose }) => {
  const characters = useStore($characters);
  const character = characters.find((c) => c.id === characterId);
  const itemById = React.useCallback((id: string) => host.mediaItems.find((m) => m.id === id), [host.mediaItems]);

  const [slot, setSlot] = React.useState<CharacterSlot>('portrait');
  const slotKey = slot === 'portrait' ? 'portraitId' : 'bodyId';
  const currentId = character?.[slotKey];
  const current = currentId ? itemById(currentId) : undefined;
  const portrait = character?.portraitId ? itemById(character.portraitId) : undefined;
  const body = character?.bodyId ? itemById(character.bodyId) : undefined;
  const versions = React.useMemo(() => (current ? imageVersions(current, host.mediaItems) : []), [current, host.mediaItems]);

  // A failed edit gives the view back to the version it was made from.
  React.useEffect(() => {
    if (!character || current?.status !== 'failed' || !current.historyParentId) return;
    updateCharacter(character.id, { [slotKey]: current.historyParentId });
  }, [current?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flow's `isHistoryOpen`: closed on a tablet or smaller, else the remembered choice (open by
  // default), worked out again whenever the window crosses that breakpoint.
  const tablet = useTabletOrSmaller();
  // Below 961px the history is the version strip under the image (VersionStrip.tsx) rather than
  // Flow's column over the page, whose cards only act on hover.
  const narrow = useMediaViewport() !== 'desktop';
  const [historyOpen, setHistoryOpen] = React.useState(() => !tablet && readHistoryOpen());
  React.useEffect(() => { setHistoryOpen(!tablet && readHistoryOpen()); }, [tablet]);
  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!tablet) writeHistoryOpen(next);
  };
  // The column only opens onto a slot that has versions to list.
  const historyShown = historyOpen && versions.length > 0;

  const [prompt, setPrompt] = React.useState('');
  const [refs, setRefs] = React.useState<MediaItem[]>([]);
  const [modelId, setModelId] = React.useState(host.defaultImageModelId);
  React.useEffect(() => {
    if (!host.imageModels.some((m) => m.id === modelId)) setModelId(host.defaultImageModelId);
  }, [host.imageModels, host.defaultImageModelId, modelId]);
  const [picker, setPicker] = React.useState<null | 'ingredients' | 'slot'>(null);
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  const [download, setDownload] = React.useState<{ item: MediaItem; anchor: MenuAnchor } | null>(null);
  const [flagOpen, setFlagOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [imageHovered, setImageHovered] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [nameDraft, setNameDraft] = React.useState(character?.name ?? '');
  React.useEffect(() => { setNameDraft(character?.name ?? ''); }, [character?.name]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape' && !typing && !voiceOpen && !picker && !download && !flagOpen && !confirmDelete) { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, voiceOpen, picker, download, flagOpen, confirmDelete]);

  if (!character) return null;

  const pending = current?.status === 'generating';
  const portraitPending = portrait?.status === 'generating';
  const bodyPending = body?.status === 'generating';
  const voice = voiceByName(character.voice?.name);

  const startVersion = (text: string, references: MediaItem[], parent?: MediaItem) => {
    const created = host.generate({ prompt: text, modelId, references, characterId: character.id, slot, parent });
    if (created) updateCharacter(character.id, { [slotKey]: created.id });
    return created;
  };

  const submit = () => {
    const text = prompt.trim();
    if (!text || pending) return;
    const created = startVersion(text, current?.url ? [current, ...refs] : refs, current);
    if (!created) return;
    setPrompt('');
    setRefs([]);
  };

  /** Flow's slot chips: a switch clears the prompt box, and an empty body starts from the portrait. */
  const selectSlot = (next: CharacterSlot) => {
    if (next === slot) return;
    setPrompt('');
    setRefs(next === 'body' && !body && portrait?.url && !portraitPending ? [portrait] : []);
    setSlot(next);
  };

  const removeVersion = (m: MediaItem) => {
    const others = versions.filter((v) => v.id !== m.id && v.status !== 'failed');
    const fallback = (m.historyParentId && others.find((v) => v.id === m.historyParentId)) || others[others.length - 1];
    if (character[slotKey] === m.id) updateCharacter(character.id, { [slotKey]: fallback?.id });
    host.removeMediaItem(m.id);
  };

  /** Flow's Delete image: the slot loses its image and its history, and shows the empty state. */
  const clearSlot = () => {
    for (const m of versions) host.removeMediaItem(m.id);
    updateCharacter(character.id, { [slotKey]: undefined });
    showSnack({ icon: 'check_circle', text: 'Character image deleted', actions: [{ label: 'Dismiss' }] });
  };

  /** An image the user already has, as this slot's image: Upload and Add from project. */
  const fillSlot = (item: MediaItem) => {
    if (!item.url) return;
    const copy: MediaItem = { ...item, id: uid(), timestamp: Date.now(), characterId: character.id, historyGroupId: undefined, historyParentId: undefined, isSavedToFS: false, fsName: undefined };
    host.addMediaItem(copy);
    host.saveGenerated(copy, item.url);
    updateCharacter(character.id, { [slotKey]: copy.id });
  };

  const deleteWhole = () => {
    for (const m of host.mediaItems) if (m.characterId === character.id) host.removeMediaItem(m.id);
    deleteCharacter(character.id);
    onClose();
    showSnack({ icon: 'info', text: 'Character deleted', actions: [{ label: 'Dismiss' }] });
  };

  const saveToProject = (m: MediaItem) => {
    if (!m.url) return;
    const copy: MediaItem = { ...m, id: uid(), characterId: undefined, historyGroupId: undefined, historyParentId: undefined, timestamp: Date.now(), isSavedToFS: false, fsName: undefined };
    host.addMediaItem(copy);
    host.saveGenerated(copy, m.url);
    showSnack({ icon: 'check_circle', text: 'Added to project', actions: [{ label: 'Dismiss' }] });
  };

  const historyProps = {
    steps: versions,
    selectedId: currentId,
    hidden: !historyShown,
    itemById,
    downloadFor: download?.item.id ?? null,
    actions: {
      onSelect: (m: MediaItem) => updateCharacter(character.id, { [slotKey]: m.id }),
      onSave: saveToProject,
      onDownload: (m: MediaItem, anchor: MenuAnchor) => setDownload({ item: m, anchor }),
      onFlag: () => setFlagOpen(true),
      onReuse: (m: MediaItem) => { setPrompt(m.prompt); textareaRef.current?.focus(); },
      onRetry: (m: MediaItem) => {
        const parent = m.historyParentId ? itemById(m.historyParentId) : undefined;
        host.removeMediaItem(m.id);
        startVersion(m.prompt, parent?.url ? [parent] : [], parent);
      },
      onDelete: removeVersion,
      // Functional, as the narrow strip adds a version's ingredients all at once.
      onAddIngredient: (m: MediaItem) => setRefs((cur) => (cur.some((r) => r.id === m.id) ? cur : [...cur, m])),
    },
  };

  const historyLabel = historyOpen ? 'Hide history' : 'Show history';
  const imageReady = !!current?.url && !pending && current.status !== 'failed';
  const canTryAgain = imageReady && !!current?.prompt && current.modelId !== 'upload' && current.modelId !== 'external';

  return (
    <div className={`cp-page ce-page${tablet ? ' is-tablet-or-smaller' : ''}`} role="region" aria-label="Character">
      <header className="cp-header ce-header">
        <div className="cp-header__left">
          <Tooltip content="Go back" className="sb-tooltip">
            <button type="button" aria-label="Go back" className="sb-icon-btn sb-icon-btn--lg" onClick={onClose}>
              <FlowIcon name="arrow_back" size={24} weight={300} />
            </button>
          </Tooltip>
          <span className="sb-title">
            <FlowEditableText value={characterName(character)} onCommit={(name) => updateCharacter(character.id, { name: name === UNTITLED_CHARACTER ? '' : name })} />
          </span>
        </div>
        <div className="cp-header__right">
          <Tooltip content={character.favorite ? 'Remove favorite' : 'Favorite'} className="sb-tooltip">
            <button type="button" aria-label={character.favorite ? 'Remove favorite' : 'Favorite'} className="sb-icon-btn" onClick={() => updateCharacter(character.id, { favorite: !character.favorite })}>
              <FlowIcon name="favorite" size={18} fill={!!character.favorite} />
            </button>
          </Tooltip>
          <Tooltip content="Delete" className="sb-tooltip">
            <button type="button" aria-label="Delete" className="sb-icon-btn" onClick={deleteWhole}>
              <FlowIcon name="delete" size={18} />
            </button>
          </Tooltip>
          {tablet ? (
            <>
              <Tooltip content={historyLabel} className="sb-tooltip">
                <button type="button" aria-label={historyLabel} className="sb-icon-btn" onClick={toggleHistory}>
                  <FlowIcon name="history" size={18} />
                </button>
              </Tooltip>
              <Tooltip content="Done editing" className="sb-tooltip">
                <button type="button" aria-label="Done editing" className="sb-icon-btn sb-icon-btn--secondary" onClick={onClose}>
                  <FlowIcon name="check" size={18} />
                </button>
              </Tooltip>
            </>
          ) : (
            <>
              <button type="button" className="sb-btn ie-history-btn" onClick={toggleHistory}>
                <FlowIcon name="history" size={18} className="sb-btn__icon" />
                <span>{historyLabel}</span>
              </button>
              <button type="button" aria-label="Done" className="sb-btn sb-btn--tonal" onClick={onClose}>
                <span>Done</span>
              </button>
            </>
          )}
        </div>
      </header>

      <div className="ce-content">
        <main className={`ce-body${historyShown && tablet && !narrow ? ' is-hidden' : ''}`}>
          <div className="ce-layout">
            <div className="ce-form-column">
              <form className="ce-form" onSubmit={(e) => e.preventDefault()}>
                <div className="ce-form-section">
                  <div className="ce-title-row">
                    <input
                      ref={nameRef}
                      className="ce-name"
                      aria-label="Character name"
                      placeholder={UNTITLED_CHARACTER}
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onBlur={() => updateCharacter(character.id, { name: nameDraft.trim() })}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') { setNameDraft(character.name); (e.target as HTMLInputElement).blur(); }
                      }}
                    />
                    <Tooltip content="Edit name" className="sb-tooltip">
                      <button
                        type="button"
                        aria-label="Edit name"
                        className="sb-icon-btn ce-edit-name"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { nameRef.current?.focus(); nameRef.current?.select(); }}
                      >
                        <FlowIcon name="edit" size={18} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
                <div className="ce-form-section">
                  <CharacterVoiceButton
                    voice={voice}
                    sample={character.voice?.sample}
                    onOpen={() => setVoiceOpen(true)}
                    onRemove={() => updateCharacter(character.id, { voice: undefined })}
                  />
                </div>
                <div className="ce-personality">
                  <div className="ce-label-row"><span className="ce-field-label">Character info (optional)</span></div>
                  <textarea
                    className="ce-textarea"
                    aria-label="Character personality"
                    placeholder="Describe how your character acts..."
                    value={character.personality ?? ''}
                    onChange={(e) => updateCharacter(character.id, { personality: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <div className="ce-disclaimer-overflow">
                    <span className="ce-disclaimer">The Willow agent can use this information to help craft scenes with your character.</span>
                  </div>
                </div>
              </form>
            </div>

            <div className="ce-preview">
              {current?.status === 'failed' ? (
                <div className="ce-image-area">
                  <div className="ce-frame" style={{ '--ce-aspect': ratioOf(current.ratio) } as React.CSSProperties}>
                    <div className="ie-error"><div className="ie-error__message"><FlowIcon name="warning" size={16} /><div className="ie-error__title">Failed</div><div className="ie-error__subtitle"><span>{current.error}</span></div></div></div>
                  </div>
                </div>
              ) : current ? (
                <div className="ce-image-area">
                  <div
                    className="ce-frame"
                    style={{ '--ce-aspect': ratioOf(current.ratio) } as React.CSSProperties}
                    onMouseEnter={() => setImageHovered(true)}
                    onMouseLeave={() => setImageHovered(false)}
                  >
                    {pending ? (
                      <div className="ie-pending"><GeneratingLayers isRevealing={false} /></div>
                    ) : current.url ? (
                      <img className="ce-frame__img" src={current.url} alt="" draggable={false} />
                    ) : null}
                    {imageReady && (
                      <>
                        <div className={`ce-frame__top${imageHovered ? '' : ' is-hidden'}`}>
                          <Tooltip content="Download image" position="above" className="sb-tooltip">
                            <button type="button" aria-label="Download image" className="ce-frame-icon" onClick={() => { void downloadMedia(current, '1k'); }}>
                              <FlowIcon name="download" size={18} />
                            </button>
                          </Tooltip>
                          <Tooltip content="Delete image" position="above" className="sb-tooltip">
                            <button type="button" aria-label="Delete image" className="ce-frame-icon" onClick={() => setConfirmDelete(true)}>
                              <FlowIcon name="delete" size={18} />
                            </button>
                          </Tooltip>
                        </div>
                        <div className={`ce-frame__actions${imageHovered ? '' : ' is-hidden'}`}>
                          <button type="button" className="sb-btn ce-frame-btn" onClick={() => startVersion(current.prompt || character.prompt || '', [], current)}>
                            <FlowIcon name="replay" size={18} />
                            <span>Reroll</span>
                          </button>
                          {canTryAgain && (
                            <button type="button" className="sb-btn ce-frame-btn" onClick={() => { setPrompt(current.prompt || character.prompt || ''); textareaRef.current?.focus(); }}>
                              <FlowIcon name="text_analysis" size={18} />
                              <span>Try again</span>
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="ce-empty">
                  <span className="ce-empty__text">Generate or add an image of your character</span>
                  <div className="ce-empty__actions">
                    <button type="button" className="sb-btn ce-empty__btn" onClick={() => fileRef.current?.click()}>
                      <FlowIcon name="upload" size={16} className="sb-btn__icon" />
                      <span>Upload</span>
                    </button>
                    <button type="button" className="sb-btn ce-empty__btn" onClick={() => setPicker('slot')}>
                      <FlowIcon name="add" size={16} className="sb-btn__icon" />
                      <span>Add from project</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {narrow && historyShown && (
              <div className="ce-strip">
                <ImageHistory layout="strip" {...historyProps} />
              </div>
            )}

            <div className="ce-slots">
              <SlotChip
                icon="portrait"
                label={portrait ? 'Portrait' : 'Create portrait'}
                thumbnail={portrait?.status === 'completed' ? portrait.url : undefined}
                active={slot === 'portrait'}
                disabled={slot === 'body' && pending}
                loading={portraitPending}
                onClick={() => selectSlot('portrait')}
              />
              <SlotChip
                icon="accessibility_new"
                label={body ? 'Body' : 'Create body'}
                thumbnail={body?.status === 'completed' ? body.url : undefined}
                active={slot === 'body'}
                disabled={(slot === 'portrait' && pending) || portraitPending || (!portrait && !body)}
                loading={bodyPending}
                onClick={() => selectSlot('body')}
              />
            </div>
          </div>

          <div className="ce-footer">
            <div className="ce-footer__inner">
              {host.notice && <div style={{ marginBottom: 8 }}>{host.notice}</div>}
              <CharacterPromptBox
                value={prompt}
                onChange={setPrompt}
                placeholder={current ? 'What do you want to change?' : slot === 'body' ? 'Describe body and outfit\u2026' : 'Describe your character\u2026'}
                slot={slot}
                onClear={() => { setPrompt(''); setRefs([]); }}
                refs={refs}
                onRemoveRef={(id) => setRefs(refs.filter((r) => r.id !== id))}
                onAddIngredients={() => setPicker(picker ? null : 'ingredients')}
                ingredientsOpen={picker === 'ingredients'}
                models={host.imageModels}
                modelId={modelId}
                onModel={setModelId}
                onFormat={async () => {
                  try {
                    setPrompt(await host.formatPrompt(prompt));
                  } catch (error) {
                    showSnack({ icon: 'error', tone: 'error', text: error instanceof Error ? error.message : 'The prompt could not be formatted.', actions: [{ label: 'Dismiss' }] });
                  }
                }}
                onSubmit={submit}
                busy={pending}
                textareaRef={textareaRef}
              />
            </div>
          </div>
        </main>

        {!narrow && (
          <div className={`ce-history${historyShown ? '' : ' is-hidden'}`}>
            <ImageHistory {...historyProps} />
          </div>
        )}
      </div>

      <p className="sb-footer-disclaimer">Willow can make mistakes, so double check it</p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const [item] = await host.importFiles([file]);
          if (!item) return;
          // The upload becomes this slot's image only; it is not a gallery item of its own.
          host.removeMediaItem(item.id);
          fillSlot(item);
        }}
      />
      <VoiceDialog
        open={voiceOpen}
        projectName={host.projectName}
        current={character.voice}
        onClose={() => setVoiceOpen(false)}
        onAdd={(v) => { updateCharacter(character.id, { voice: v }); setVoiceOpen(false); }}
      />
      <DownloadMenu item={download?.item ?? null} anchor={download?.anchor ?? null} onClose={() => setDownload(null)} />
      <FlagDialog open={flagOpen} onClose={() => setFlagOpen(false)} />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this image?"
        message="This will remove the image from the character."
        confirmLabel="Delete"
        onConfirm={clearSlot}
        onClose={() => setConfirmDelete(false)}
      />
      <SceneMediaPicker
        open={!!picker}
        mode={picker === 'slot' ? 'image' : 'prompt'}
        items={host.mediaItems.filter((m) => m.kind === 'image' && !m.characterId)}
        projectName={host.projectName}
        projectId={host.projectId}
        projects={picker ? host.listProjects() : []}
        loadProjectMedia={host.loadProjectMedia}
        adopt={(m) => m}
        onClose={() => setPicker(null)}
        onImport={(files) => host.importFiles(files)}
        onConfirm={(m) => {
          const target = picker;
          setPicker(null);
          if (target === 'slot') fillSlot(m);
          else if (m.url && !refs.some((r) => r.id === m.id)) setRefs([...refs, m]);
        }}
      />
    </div>
  );
};

export default CharacterEditPage;
