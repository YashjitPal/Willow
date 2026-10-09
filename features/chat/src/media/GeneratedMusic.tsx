/**
 * Gemini's `generated-music`: a 420px square of cover art (the title set large on it) that plays
 * the track through the luminous player, with Show subtitles, Download, Share and Mute along the
 * top. Subtitles lay the lyrics over the art.
 */
import React, { useCallback, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import type { GeneratedMedia } from './generated-media';
import { downloadMedia, shareMedia } from './GeneratedImage';
import { MediaPlayer, PlayerActionButton, PlayerMenu } from './MediaPlayer';
import './media.css';

const audioExtension = (mimeType: string) => (mimeType.includes('wav') ? 'wav' : mimeType.includes('ogg') ? 'ogg' : 'mp3');
const slug = (title: string) => title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'track';

export const GeneratedMusic: React.FC<{ item: GeneratedMedia }> = ({ item }) => {
  const [subtitles, setSubtitles] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);

  if (item.status === 'generating') return null;
  const url = item.attachment?.url;
  if (item.status === 'error' || !url) {
    return (
      <div className="gm-media-error" role="status">
        <MaterialSymbol name="music_off" size={24} />
        <span>{item.error || "Your track couldn't be created."}</span>
      </div>
    );
  }
  const base = slug(item.title ?? '');
  const audioName = `${base}.${audioExtension(item.attachment?.mimeType ?? '')}`;
  const cover = item.cover?.url;
  const lyrics = item.lyrics?.trim();

  return (
    <div className="gm-music">
      <MediaPlayer
        kind="audio"
        src={url}
        cover={cover}
        aspectRatio="1 / 1"
        playLabel="Play music"
        pauseLabel="Pause music"
        muteNoun="track"
        overlay={subtitles && lyrics ? (
          <div className="gm-music__lyrics" aria-label="Lyrics">
            {lyrics.split('\n').map((line, i) => <p key={i}>{line || '\u00a0'}</p>)}
          </div>
        ) : null}
        actions={(
          <>
            {lyrics && (
              <PlayerActionButton
                icon="subtitles"
                label={subtitles ? 'Hide subtitles' : 'Show subtitles'}
                pressed={subtitles}
                onClick={() => setSubtitles((on) => !on)}
              />
            )}
            <PlayerActionButton
              icon="download"
              label="Download track"
              expanded={Boolean(menuAnchor)}
              onClick={(event) => {
                const button = event.currentTarget;
                setMenuAnchor((open) => (open ? null : button));
              }}
            />
            {menuAnchor && (
              <PlayerMenu anchor={menuAnchor} onClose={closeMenu}>
                <button type="button" role="menuitem" onClick={() => { closeMenu(); downloadMedia(url, audioName); }}>
                  <MaterialSymbol family="luminous" name="music_note" size={24} weight={300} roundness={100} opticalSize={24} />
                  <span className="gm-player-menu__text">
                    <span className="gm-player-menu__label">Audio only</span>
                    <span className="gm-player-menu__sub">{audioExtension(item.attachment?.mimeType ?? '').toUpperCase()}</span>
                  </span>
                </button>
                {cover && (
                  <button type="button" role="menuitem" onClick={() => { closeMenu(); downloadMedia(cover, `${base}-cover.png`); }}>
                    <MaterialSymbol family="luminous" name="image" size={24} weight={300} roundness={100} opticalSize={24} />
                    <span className="gm-player-menu__text">
                      <span className="gm-player-menu__label">Cover art</span>
                      <span className="gm-player-menu__sub">PNG</span>
                    </span>
                  </button>
                )}
              </PlayerMenu>
            )}
            <PlayerActionButton icon="share_1" label="Share track" onClick={() => { void shareMedia(url, audioName, item.attachment?.mimeType ?? 'audio/mpeg'); }} />
          </>
        )}
      />
    </div>
  );
};
