// Flow's "New character" page (/character): a hero line, six sample characters, and the prompt
// box with Upload and Add from project under it. Pressing a sample writes a description into the
// prompt (the card says "Generating..." and the others dim meanwhile); Start generation makes the
// character and opens its page while the portrait generates.
import React from 'react';
import { Tooltip } from '@willow/ui/Tooltip';
import type { MediaItem } from '../types';
import { FlowIcon } from '../scenes/flow-ui';
import { showSnack } from '../scenes/scene-store';
import { SceneMediaPicker } from '../scenes/SceneMediaPicker';
import { CHARACTER_PRESETS, type CharacterPreset } from './presets';
import { createCharacter, deleteCharacter, updateCharacter } from './character-store';
import type { CharacterHost } from './character-host';
import { CharacterPromptBox } from './CharacterPromptBox';
import '../scenes/scene-builder.css';
import './characters.css';
import './characters-responsive.css';

/** How long a sample takes to "write" — Flow's model takes about this long. */
const PRESET_WRITE_MS = 1400;

const uid = () => `${Date.now()}-character-${Math.random().toString(36).slice(2, 8)}`;

export const NewCharacterPage: React.FC<{
  host: CharacterHost;
  onClose: () => void;
  onCreated: (characterId: string) => void;
}> = ({ host, onClose, onCreated }) => {
  const [prompt, setPrompt] = React.useState('');
  const [refs, setRefs] = React.useState<MediaItem[]>([]);
  const [modelId, setModelId] = React.useState(host.defaultImageModelId);
  React.useEffect(() => {
    if (!host.imageModels.some((m) => m.id === modelId)) setModelId(host.defaultImageModelId);
  }, [host.imageModels, host.defaultImageModelId, modelId]);
  const [writing, setWriting] = React.useState<string | null>(null);
  const [picker, setPicker] = React.useState<null | 'ingredients' | 'portrait'>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape' && !typing && !picker) { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, picker]);

  const pickPreset = (preset: CharacterPreset) => {
    if (writing) return;
    setWriting(preset.title);
    window.setTimeout(() => {
      setPrompt(preset.samples[Math.floor(Math.random() * preset.samples.length)]);
      setWriting(null);
      textareaRef.current?.focus();
    }, PRESET_WRITE_MS);
  };

  const start = () => {
    const text = prompt.trim();
    if (!text) return;
    const character = createCharacter({ prompt: text });
    const pending = host.generate({ prompt: text, modelId, references: refs, characterId: character.id, slot: 'portrait' });
    if (!pending) { deleteCharacter(character.id); return; }
    updateCharacter(character.id, { portraitId: pending.id });
    onCreated(character.id);
  };

  /** A character whose portrait is an image the user already has. */
  const fromImage = (item: MediaItem) => {
    if (!item.url) return;
    const character = createCharacter({ prompt: '' });
    const portrait: MediaItem = {
      ...item,
      id: uid(),
      timestamp: Date.now(),
      characterId: character.id,
      historyGroupId: undefined,
      historyParentId: undefined,
      isSavedToFS: false,
      fsName: undefined,
    };
    host.addMediaItem(portrait);
    host.saveGenerated(portrait, item.url);
    updateCharacter(character.id, { portraitId: portrait.id });
    onCreated(character.id);
  };

  return (
    <div className="cp-page" role="region" aria-label="New character">
      <header className="cp-header">
        <div className="cp-header__left">
          <Tooltip content="Go back" className="sb-tooltip">
            <button type="button" aria-label="Go back" className="sb-icon-btn sb-icon-btn--lg cp-back" onClick={onClose}>
              <FlowIcon name="arrow_back" size={24} weight={300} />
            </button>
          </Tooltip>
          <span className="cp-header__title">New character</span>
        </div>
      </header>

      <main className="cn-body">
        <div className="cn-carousel-wrapper">
          <div className="cn-hero">
            <span className="cn-hero__line">Build and reuse characters for consistent videos.</span>
            <span className="cn-hero__line">Use a sample prompt below, or create from scratch.</span>
          </div>
          <div className="cn-grid">
            {CHARACTER_PRESETS.map((p) => (
              <button
                key={p.title}
                type="button"
                className={`cn-card${writing === p.title ? ' is-loading' : ''}${writing && writing !== p.title ? ' is-disabled' : ''}`}
                onClick={() => pickPreset(p)}
              >
                <img className="cn-card__thumb" src={p.image} alt="" draggable={false} />
                <span className="cn-card__text">
                  <span className="cn-card__title">{p.title}</span>
                  <span className="cn-card__desc">{p.description}</span>
                  {writing === p.title && <span className="cn-card__generating">Generating...</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      </main>

      <div className="cn-footer">
        {host.notice && <div className="cn-footer__wrapper">{host.notice}</div>}
        <div className="cn-footer__wrapper">
          <CharacterPromptBox
            value={prompt}
            onChange={setPrompt}
            placeholder="Describe your character…"
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
            onSubmit={start}
            busy={!!writing}
            textareaRef={textareaRef}
          />
        </div>
        <div className="cn-mode-row">
          <button type="button" className="cn-mode-btn" onClick={() => fileRef.current?.click()}>
            <FlowIcon name="upload" size={18} weight={300} className="cn-mode-btn__icon" />
            <span>Upload</span>
          </button>
          <button type="button" className="cn-mode-btn" onClick={() => setPicker('portrait')}>
            <FlowIcon name="add" size={18} weight={300} className="cn-mode-btn__icon" />
            <span>Add from project</span>
          </button>
        </div>
      </div>

      <p className="sb-footer-disclaimer">Willow can make mistakes, so double check it</p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (!files.length) return;
          void host.importFiles(files.slice(0, 1)).then((added) => {
            const item = added[0];
            if (!item) return;
            // The upload becomes the portrait only; it is not a gallery item of its own.
            host.removeMediaItem(item.id);
            fromImage(item);
          });
        }}
      />

      <SceneMediaPicker
        open={picker !== null}
        mode={picker === 'portrait' ? 'image' : 'prompt'}
        items={host.mediaItems.filter((m) => m.kind === 'image' && !m.characterId)}
        projectName={host.projectName}
        projectId={host.projectId}
        projects={picker ? host.listProjects() : []}
        loadProjectMedia={host.loadProjectMedia}
        adopt={(m) => m}
        onClose={() => setPicker(null)}
        onImport={(files) => host.importFiles(files)}
        onConfirm={(m) => {
          const mode = picker;
          setPicker(null);
          if (mode === 'portrait') { fromImage(m); return; }
          if (m.url && !refs.some((r) => r.id === m.id)) setRefs([...refs, m]);
        }}
      />
    </div>
  );
};

export default NewCharacterPage;
