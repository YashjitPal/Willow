/**
 * Gemini's /images page, the sidebar's Images entry: a hero over the composer and the template
 * carousel under it — five cards and a 2x2 "see more" tile that opens the whole set as a grid,
 * with a Close card at its end. A card opens a dialog whose "Choose photo" sends the template's
 * prompt with the photo, Images picked. Measured off the live app (discovery-images-page,
 * carousel-image-layout, grid-image-layout, attachment-picker-dialog).
 *
 * The composer is the chat's one InputBar, which ChatView places in the space this leaves for it
 * (`composerSpace`) on desktop and tablet. On a phone Gemini docks it at the bottom instead.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { IMAGES_PAGE_TEMPLATES, type ImagesPageTemplate } from './images-page-templates';
import './media.css';

const HERO_ICON = 'https://www.gstatic.com/bard-robin-zs/discovery/discosurf/image_create_color_dark.svg';
const CAROUSEL_CARDS = 5;

/* Gemini deals the set afresh on every visit. */
const shuffled = <T,>(items: T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const TemplateCard: React.FC<{ template: ImagesPageTemplate; onOpen: (t: ImagesPageTemplate) => void }> = ({ template, onOpen }) => (
  <button type="button" className="gm-images-card" onClick={() => onOpen(template)} aria-label={template.name}>
    <img className="gm-images-card__img" src={template.image} alt="" draggable={false} />
    <span className="gm-images-card__scrim" aria-hidden="true" />
    <span className="gm-images-card__title">{template.name}</span>
  </button>
);

const TemplateDialog: React.FC<{
  template: ImagesPageTemplate;
  onChoose: (file: File) => void;
  onCancel: () => void;
}> = ({ template, onChoose, onCancel }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    chooseRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return createPortal(
    <div className="gm-images-dialog-layer">
      <div className="gm-images-dialog-backdrop" onClick={onCancel} aria-hidden="true" />
      <div className="gm-images-dialog" role="dialog" aria-modal="true" aria-label={template.name}>
        <img className="gm-images-dialog__img" src={template.preview} alt="" draggable={false} />
        <p className="gm-images-dialog__text">
          {template.line}
          <br />
          Add a photo to see it transform.
        </p>
        <div className="gm-images-dialog__actions">
          <button ref={chooseRef} type="button" className="gm-images-dialog__btn gm-images-dialog__btn--choose" onClick={() => fileRef.current?.click()}>
            Choose photo
          </button>
          <button type="button" className="gm-images-dialog__btn" onClick={onCancel}>Cancel</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onChoose(file);
          }}
        />
      </div>
    </div>,
    document.body,
  );
};

export const ImagesPage: React.FC<{
  /** The height to leave between the hero and the templates for the composer: 52 above it,
   *  its own height, and 32 under it. Just the 32 on a phone, where the composer docks. */
  composerSpace: number;
  onChoosePhoto: (template: ImagesPageTemplate, file: File) => void;
}> = ({ composerSpace, onChoosePhoto }) => {
  const deck = useMemo(() => shuffled(IMAGES_PAGE_TEMPLATES), []);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<ImagesPageTemplate | null>(null);
  const carousel = deck.slice(0, CAROUSEL_CARDS);
  const peek = deck.slice(CAROUSEL_CARDS, CAROUSEL_CARDS + 4);

  return (
    <div className={`gm-images-page${open ? ' is-dialog-open' : ''}`}>
      <header className="gm-images-hero">
        <img className="gm-images-hero__icon" src={HERO_ICON} alt="" width={28} height={28} />
        <h1 className="gm-images-hero__title">Create images</h1>
        <h2 className="gm-images-hero__subtitle">Try a template or describe an idea in chat. Create with Nano Banana.</h2>
      </header>
      <div className="gm-images-page__composer-space" style={{ height: composerSpace }} aria-hidden="true" />
      <div className="gm-images-page__content">
        {expanded ? (
          <div className="gm-images-grid" key="grid">
            {deck.map((t) => <TemplateCard key={t.id} template={t} onOpen={setOpen} />)}
            <button type="button" className="gm-images-close" onClick={() => setExpanded(false)}>
              <MaterialSymbol family="luminous" name="close" size={28} opticalSize={24} />
              <span className="gm-images-close__label">Close</span>
            </button>
          </div>
        ) : (
          <div className="gm-images-carousel" key="carousel">
            {carousel.map((t) => <TemplateCard key={t.id} template={t} onOpen={setOpen} />)}
            <button type="button" className="gm-images-more" onClick={() => setExpanded(true)} aria-label="See more templates">
              <span className="gm-images-more__grid">
                {peek.map((t) => (
                  <span key={t.id} className="gm-images-more__thumb">
                    <img src={t.image} alt="" draggable={false} />
                  </span>
                ))}
              </span>
            </button>
          </div>
        )}
      </div>
      {open && (
        <TemplateDialog
          template={open}
          onCancel={() => setOpen(null)}
          onChoose={(file) => {
            const template = open;
            setOpen(null);
            onChoosePhoto(template, file);
          }}
        />
      )}
    </div>
  );
};
