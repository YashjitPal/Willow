// Flow's "Select a voice" dialog: its media-picker frame with Gemini's voices in the list and a
// voice preview pane — a card in the voice's colours that plays its sample, the sample dialogue
// (120 characters) and the performance notes — and Add to character.
import React from 'react';
import { createPortal } from 'react-dom';
import { Tooltip } from '@willow/ui/Tooltip';
import { FlowIcon } from '../scenes/flow-ui';
import type { StoredCharacterVoice } from '@willow/storage/media-characters';
import { CHARACTER_VOICES, DEFAULT_SAMPLE_DIALOGUE, SAMPLE_DIALOGUE_MAX, VOICE_SAMPLE_URL, type CharacterVoice } from './voices';
import '../editor/image-editor.css';
import './characters.css';

export const VoiceAvatar: React.FC<{ voice: CharacterVoice; size?: number; radius?: number }> = ({ voice, size = 40, radius = 12 }) => (
  <span className="cv-avatar" style={{ width: size, height: size, borderRadius: radius, backgroundImage: `linear-gradient(${voice.from} 0%, ${voice.to} 100%)` }}>
    <FlowIcon name="voice_selection" size={Math.round(size * 0.45)} />
  </span>
);

export const VoiceDialog: React.FC<{
  open: boolean;
  projectName: string;
  current?: StoredCharacterVoice;
  onClose: () => void;
  onAdd: (voice: StoredCharacterVoice) => void;
}> = ({ open, projectName, current, onClose, onAdd }) => {
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<CharacterVoice>(CHARACTER_VOICES[0]);
  const [sample, setSample] = React.useState('');
  const [performance, setPerformance] = React.useState('');
  const [playing, setPlaying] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(CHARACTER_VOICES.find((v) => v.name === current?.name) ?? CHARACTER_VOICES[0]);
    setSample(current?.sample ?? '');
    setPerformance(current?.performance ?? '');
  }, [open, current]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  React.useEffect(() => () => { audioRef.current?.pause(); }, []);
  React.useEffect(() => { audioRef.current?.pause(); setPlaying(false); }, [selected, open]);

  if (!open) return null;
  const q = query.trim().toLowerCase();
  const voices = q ? CHARACTER_VOICES.filter((v) => `${v.name} ${v.description}`.toLowerCase().includes(q)) : CHARACTER_VOICES;

  const play = () => {
    if (playing) { audioRef.current?.pause(); setPlaying(false); return; }
    const audio = new Audio(VOICE_SAMPLE_URL(selected.name));
    audioRef.current?.pause();
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    setPlaying(true);
    void audio.play().catch(() => setPlaying(false));
  };

  return createPortal(
    <div onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      <div className="ie-dialog-backdrop" onClick={onClose} />
      <div className="ie-dialog-wrap">
        <div role="dialog" aria-modal="true" aria-labelledby="cv-title" className="ie-dialog cv-dialog">
          <div className="cv-header">
            <h2 id="cv-title" className="cv-title">Select a voice</h2>
            <Tooltip content="Close" className="sb-tooltip">
              <button type="button" aria-label="Close" className="sb-icon-btn" onClick={onClose}>
                <FlowIcon name="close" size={18} />
              </button>
            </Tooltip>
          </div>
          <div className="cv-panels">
            <div className="cv-search-row">
              <div className="cv-project" role="combobox" aria-label="Select project" aria-expanded={false}>
                <span>{projectName}</span>
                <span className="cv-project__arrow" />
              </div>
              <label className="cv-search">
                <FlowIcon name="search" size={17.6} />
                <input type="text" aria-label="Search assets" placeholder="Search assets" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
              </label>
            </div>
            <div className="cv-content">
              <div className="cv-list" role="listbox" aria-label="Asset list">
                {voices.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    role="option"
                    aria-selected={v.name === selected.name}
                    className={`cv-row${v.name === selected.name ? ' is-selected' : ''}`}
                    onClick={() => setSelected(v)}
                  >
                    <VoiceAvatar voice={v} />
                    <span className="cv-row__text">
                      <span className="cv-row__name">{v.name}</span>
                      <span className="cv-row__desc">{v.description}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="cv-detail">
                <div className="cv-preview-pane">
                  <button
                    type="button"
                    aria-label={playing ? 'Stop preview' : 'Play preview'}
                    className="cv-audio-card"
                    style={{ backgroundImage: `linear-gradient(${selected.from} 0%, ${selected.to} 100%)` }}
                    onClick={play}
                  >
                    <span className="cv-play">
                      <span className="cv-play__icon"><FlowIcon name={playing ? 'pause' : 'play_arrow'} size={16} fill /></span>
                      <span>Preview</span>
                    </span>
                  </button>
                  <label className="cv-field">
                    <span className="cv-field__head">
                      <span>Sample dialogue</span>
                      <span>{sample.length} / {SAMPLE_DIALOGUE_MAX}</span>
                    </span>
                    <textarea
                      value={sample}
                      maxLength={SAMPLE_DIALOGUE_MAX}
                      placeholder={DEFAULT_SAMPLE_DIALOGUE}
                      onChange={(e) => setSample(e.target.value)}
                    />
                  </label>
                  <label className="cv-field">
                    <span className="cv-field__head"><span>Customize performance</span></span>
                    <textarea value={performance} placeholder="Describe the voice performance style..." onChange={(e) => setPerformance(e.target.value)} />
                  </label>
                </div>
                <div className="cv-actions">
                  <button
                    type="button"
                    className="sb-btn cv-add"
                    onClick={() => onAdd({ name: selected.name, sample: sample.trim() || undefined, performance: performance.trim() || undefined })}
                  >
                    Add to character
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
