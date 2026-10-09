/**
 * The card the video tool opens with the first time — Gemini's `video-creation-discovery-card`.
 *
 * A dialog centred on the screen, at most 420 wide, surface-bright, radius 28: three 148x111
 * clips fanned 8 degrees either way behind each other, "Create videos" / "With Gemini Omni",
 * three feature rows on 40px icon wells, and a full-width tonal "Try it". Dismissing it is
 * remembered, as Gemini's localStorage flag is.
 */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { MEDIA_GALLERY } from './media-templates';
import './media.css';

const SEEN_KEY = 'willow.videoDiscoverySeen';

export const videoDiscoverySeen = (): boolean => {
  try { return window.localStorage.getItem(SEEN_KEY) === 'true'; } catch { return true; }
};

export const markVideoDiscoverySeen = (): void => {
  try { window.localStorage.setItem(SEEN_KEY, 'true'); } catch { /* storage unavailable */ }
};

const FEATURES = [
  { icon: 'videocam', title: 'Create from anything', description: 'Combine images, text, and videos' },
  { icon: 'gen_media', title: 'Put yourself into any scene', description: 'Create an avatar to use in videos' },
  { icon: 'edit', title: 'Refine with Gemini', description: 'Want to make a change? Just ask' },
];

/** The fan is three of the gallery's own clips, as Gemini's is. */
const heroArt = (name: string): string =>
  MEDIA_GALLERY.video.templates.find((t) => t.name === name)?.image ?? '';

export const VideoDiscoveryCard: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => {
  const ctaRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    ctaRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return createPortal(
    <>
      <div className="gm-discovery-backdrop" onClick={onDismiss} />
      <div
        className="gm-discovery"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gm-discovery-title"
        aria-describedby="gm-discovery-subtitle"
      >
        <div className="gm-discovery__inner" tabIndex={0}>
          <div className="gm-discovery__header">
            <div className="gm-discovery__hero">
              <img className="gm-discovery__left" src={heroArt('Indie pastel')} alt="" aria-hidden="true" />
              <img className="gm-discovery__middle" src={heroArt('Anime')} alt="" aria-hidden="true" />
              <img className="gm-discovery__right" src={heroArt('Origami')} alt="" aria-hidden="true" />
            </div>
            <div className="gm-discovery__titles">
              <h2 id="gm-discovery-title" className="gm-discovery__title">Create videos</h2>
              <p id="gm-discovery-subtitle" className="gm-discovery__subtitle">With Gemini Omni</p>
            </div>
          </div>
          <div className="gm-discovery__features">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="gm-discovery__feature">
                <div className="gm-discovery__icon">
                  <MaterialSymbol family="luminous" name={feature.icon} size={32} weight={300} roundness={100} opticalSize={24} />
                </div>
                <div className="gm-discovery__text">
                  <div className="gm-discovery__feature-title">{feature.title}</div>
                  <div className="gm-discovery__feature-description">{feature.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="gm-discovery__actions">
          <button ref={ctaRef} type="button" className="gm-discovery__cta" onClick={onDismiss}>Try it</button>
        </div>
      </div>
    </>,
    document.body,
  );
};
