/**
 * Gemini's `video-player.luminous`, which plays both generated videos and generated tracks.
 *
 * One grid cell holds everything: the media, a bottom scrim, the 48px translucent action row
 * (12px down, 24px in, 12px apart), the 68px play button in the middle, the frosted time pill
 * 20px in and 28px up, and the seek slider 20px in along the bottom. Controls appear while the
 * pointer moves over the player; before the first play the play button always shows. A track
 * plays as audio over its cover art.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import './media.css';

/** `video-player-download-menu`, portalled so the player's rounded clip can't cut it off. */
export const PlayerMenu: React.FC<{
  anchor: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ anchor, onClose, children }) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPlace({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
  }, [anchor]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  if (!place) return null;
  return createPortal(
    <div ref={menuRef} className="gm-player-menu" role="menu" style={{ top: place.top, right: place.right }}>
      {children}
    </div>,
    document.body,
  );
};

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const spoken = (seconds: number) => {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(s / 60);
  const parts = [m ? `${m} minute${m === 1 ? '' : 's'}` : '', s % 60 || !m ? `${s % 60} second${s % 60 === 1 ? '' : 's'}` : ''];
  return parts.filter(Boolean).join(' ');
};

export const PlayerActionButton: React.FC<{
  icon: string;
  label: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  pressed?: boolean;
  expanded?: boolean;
  className?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}> = ({ icon, label, onClick, pressed, expanded, className = '', buttonRef }) => (
  <button
    ref={buttonRef}
    type="button"
    className={`gm-translucent-btn gm-translucent-btn--48 gm-player__action ${className}`}
    aria-label={label}
    title={label}
    aria-pressed={pressed}
    aria-expanded={expanded}
    onClick={onClick}
  >
    <MaterialSymbol family="luminous" name={icon} size={28} weight={300} roundness={100} opticalSize={24} />
  </button>
);

export const MediaPlayer: React.FC<{
  src: string;
  kind: 'video' | 'audio';
  cover?: string;
  aspectRatio: string;
  playLabel: string;
  pauseLabel: string;
  muteNoun: string;
  /** Buttons before Mute in the action row. */
  actions?: React.ReactNode;
  /** Shown over the media while subtitles are on. */
  overlay?: React.ReactNode;
  className?: string;
}> = ({ src, kind, cover, aspectRatio, playLabel, pauseLabel, muteNoun, actions, overlay, className = '' }) => {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const idleRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [active, setActive] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const wake = useCallback(() => {
    setActive(true);
    if (idleRef.current) window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => setActive(false), 2500);
  }, []);
  useEffect(() => () => { if (idleRef.current) window.clearTimeout(idleRef.current); }, []);

  const toggle = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused || media.ended) void media.play().catch(() => undefined);
    else media.pause();
  };

  const seekTo = (clientX: number) => {
    const media = mediaRef.current;
    const box = sliderRef.current?.getBoundingClientRect();
    if (!media || !box || !duration) return;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    media.currentTime = ratio * duration;
    setCurrent(media.currentTime);
  };

  const ratio = duration ? Math.min(1, current / duration) : 0;
  const mediaProps = {
    ref: mediaRef,
    src,
    preload: 'metadata' as const,
    onPlay: () => { setPlaying(true); setStarted(true); },
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: () => setCurrent(mediaRef.current?.currentTime ?? 0),
    onDurationChange: () => setDuration(mediaRef.current?.duration ?? 0),
    onLoadedMetadata: () => setDuration(mediaRef.current?.duration ?? 0),
    onVolumeChange: () => setMuted(Boolean(mediaRef.current?.muted)),
  };

  return (
    <div className={`gm-player ${className}`} style={{ aspectRatio }}>
      {kind === 'video'
        ? <video {...mediaProps} className="gm-player__media" playsInline />
        : (
          <>
            {cover ? <img className="gm-player__media" src={cover} alt="" draggable={false} /> : <div className="gm-player__media gm-player__media--blank" />}
            <audio {...mediaProps} />
          </>
        )}
      <div
        className={`gm-player__controls${active ? ' is-active' : ''}${playing ? ' is-playing' : ''}${seeking ? ' is-seeking' : ''}`}
        onPointerMove={wake}
        onPointerDown={wake}
        onPointerLeave={(event) => { if (!seeking && event.pointerType === 'mouse') setActive(false); }}
        onClick={(event) => { if (event.target === event.currentTarget) toggle(); }}
      >
        {overlay}
        <div className="gm-player__scrim" />
        <div className="gm-player__actions">
          {actions}
          <PlayerActionButton
            icon={muted ? 'volume_off' : 'volume_up'}
            label={muted ? `Unmute ${muteNoun}` : `Mute ${muteNoun}`}
            className={muted ? 'is-muted' : ''}
            onClick={() => { if (mediaRef.current) mediaRef.current.muted = !mediaRef.current.muted; }}
          />
        </div>
        <button
          type="button"
          className={`gm-translucent-btn gm-player__play${started ? '' : ' show-initially'}`}
          aria-label={playing ? pauseLabel : playLabel}
          onClick={toggle}
        >
          <MaterialSymbol className="gm-player__play-icon" family="google-symbols" name="play_arrow" size={28} fill />
          <MaterialSymbol className="gm-player__pause-icon" family="google-symbols" name="pause" size={28} fill />
        </button>
        <span
          className="gm-player__time"
          role="group"
          aria-label={`${spoken(current)} elapsed, ${spoken(Math.max(0, duration - current))} remaining`}
        >
          <span aria-hidden="true">{clock(current)}</span>
          <span aria-hidden="true">/</span>
          <span aria-hidden="true">{clock(duration)}</span>
        </span>
        <div
          ref={sliderRef}
          className="gm-player__slider"
          style={{ '--gm-ratio': ratio } as React.CSSProperties}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setSeeking(true);
            seekTo(event.clientX);
          }}
          onPointerMove={(event) => { if (seeking) seekTo(event.clientX); }}
          onPointerUp={() => setSeeking(false)}
          onPointerCancel={() => setSeeking(false)}
        >
          <div className="gm-player__track">
            <div className="gm-player__fill">
              <div className={`gm-player__thumb${seeking ? ' is-dragging' : ''}`} />
            </div>
          </div>
          <input
            className="gm-player__range"
            type="range"
            aria-label="Seek slider"
            min={0}
            max={duration || 0}
            step={0.1}
            value={current}
            onChange={(event) => {
              if (!mediaRef.current) return;
              mediaRef.current.currentTime = event.target.valueAsNumber;
            }}
          />
        </div>
      </div>
    </div>
  );
};
