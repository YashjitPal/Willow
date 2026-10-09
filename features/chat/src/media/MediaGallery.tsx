/**
 * The zero state a creation tool opens on — Gemini's `media-gen-zero-state-shell`.
 *
 * Filter chips over a grid of template cards: 36px pills (primary-container when selected),
 * then cards 140 tall with radius 40 whose art scales to 1.1 under the pointer and whose name
 * sits on a 50px black fade. Four columns past 1200px, three from 768, two below — video keeps
 * three. A video card swaps to its animated art on hover; a music card carries a 24px "Preview
 * track" button. Picking a card hands it to the prompt box.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { MEDIA_GALLERY, type GalleryTool, type MediaTemplate } from './media-templates';
import './media.css';

const TemplateCard: React.FC<{
  template: MediaTemplate;
  playing: boolean;
  onPick: () => void;
  onTogglePreview: () => void;
}> = ({ template, playing, onPick, onTogglePreview }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="gm-template"
      role="button"
      tabIndex={0}
      aria-label={template.name}
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(); }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <img src={hover && template.hoverImage ? template.hoverImage : template.image} alt="" loading="lazy" draggable={false} />
      <div className="gm-template__overlay">
        <div className="gm-template__info">
          <span className="gm-template__label">{template.name}</span>
        </div>
        <div className="gm-template__controls">
          {template.audio && (
            <button
              type="button"
              className="gm-template__play"
              aria-label="Play or pause audio preview"
              title="Preview track"
              aria-pressed={playing}
              onClick={(event) => { event.stopPropagation(); onTogglePreview(); }}
            >
              <MaterialSymbol family="luminous" name={playing ? 'pause' : 'play_arrow'} size={28} weight={260} roundness={100} opticalSize={24} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const MediaGallery: React.FC<{
  tool: GalleryTool;
  onPick: (template: MediaTemplate) => void;
}> = ({ tool, onPick }) => {
  const { tabs, templates } = MEDIA_GALLERY[tool];
  const [tab, setTab] = useState('All');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { setTab('All'); }, [tool]);
  useEffect(() => () => { audioRef.current?.pause(); }, []);
  useEffect(() => { audioRef.current?.pause(); setPlayingId(null); }, [tool]);

  const shown = useMemo(
    () => (tab === 'All' ? templates : templates.filter((t) => t.tabs.includes(tab))),
    [tab, templates],
  );

  const togglePreview = (template: MediaTemplate) => {
    if (!template.audio) return;
    if (playingId === template.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(template.audio);
    audio.onended = () => setPlayingId((id) => (id === template.id ? null : id));
    audioRef.current = audio;
    void audio.play().then(() => setPlayingId(template.id)).catch(() => setPlayingId(null));
  };

  return (
    <div className="gm-gallery">
      <div className="gm-gallery__chips" role="tablist" aria-label="Template categories">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`gm-gallery__chip${tab === name ? ' is-selected' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className={`gm-gallery__grid gm-gallery__grid--${tool}`}>
        {shown.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            playing={playingId === template.id}
            onPick={() => {
              audioRef.current?.pause();
              setPlayingId(null);
              onPick(template);
            }}
            onTogglePreview={() => togglePreview(template)}
          />
        ))}
      </div>
    </div>
  );
};
