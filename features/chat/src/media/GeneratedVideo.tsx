/**
 * Gemini's `generated-video`: nothing while it renders (the status row above says so), then the
 * luminous player — 740 wide for 16:9, bleeding 16px past the text column on both sides, with
 * Download, Share and Mute along the top.
 */
import React from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import type { GeneratedMedia } from './generated-media';
import { cssAspectRatio } from './generated-media';
import { downloadMedia, shareMedia } from './GeneratedImage';
import { MediaPlayer, PlayerActionButton } from './MediaPlayer';
import './media.css';

const extensionFor = (mimeType: string) => (mimeType.includes('webm') ? 'webm' : mimeType.includes('quicktime') ? 'mov' : 'mp4');

export const GeneratedVideo: React.FC<{ item: GeneratedMedia }> = ({ item }) => {
  if (item.status === 'generating') return null;
  const url = item.attachment?.url;
  if (item.status === 'error' || !url) {
    return (
      <div className="gm-media-error" role="status">
        <MaterialSymbol name="hide_image" size={24} />
        <span>{item.error || "Your video couldn't be created."}</span>
      </div>
    );
  }
  const name = `video-${item.id.slice(-6)}.${extensionFor(item.attachment?.mimeType ?? '')}`;
  const portrait = item.aspectRatio === '9:16';
  return (
    <div className={`gm-video${portrait ? ' gm-video--portrait' : ''}`}>
      <MediaPlayer
        kind="video"
        src={url}
        aspectRatio={cssAspectRatio(item.aspectRatio ?? '16:9')}
        playLabel="Play video"
        pauseLabel="Pause video"
        muteNoun="video"
        actions={(
          <>
            <PlayerActionButton icon="download" label="Download video" onClick={() => downloadMedia(url, name)} />
            <PlayerActionButton icon="share_1" label="Share video" onClick={() => { void shareMedia(url, name, item.attachment?.mimeType ?? 'video/mp4'); }} />
          </>
        )}
      />
    </div>
  );
};
