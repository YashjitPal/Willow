// The cards in an agent reply for the characters and scenes it made or changed, each where the
// reply made it (AgentSidebar splits the reply's text there). Each reads its store live, so a
// rename or a finished portrait shows at once; a character card keeps the image version that
// reply made.
import React from 'react';
import { useStore } from '@nanostores/react';
import { Clapperboard, UserRound } from 'lucide-react';
import { TextShimmer } from '@willow/ui/text-shimmer';
import type { MediaItem } from '../types';
import { MediaTilePreview } from '../GalleryTile';
import { $characters, characterName, openCharacter } from '../characters/character-store';
import { voiceByName } from '../characters/voices';
import { $scenePhases, $scenes, openScene } from '../scenes/scene-store';
import type { AgentLink } from './agent-session';
import { formatSeconds } from './agent-tools';

const CharacterLinkCard: React.FC<{ id: string; mediaId?: string; mediaItems?: MediaItem[] }> = ({ id, mediaId, mediaItems }) => {
  const character = useStore($characters).find((c) => c.id === id);
  if (!character) return null;
  const image = mediaItems?.find((m) => m.id === mediaId) ?? mediaItems?.find((m) => m.id === character.portraitId);
  const voice = voiceByName(character.voice?.name);
  return (
    <button
      type="button"
      onClick={() => openCharacter(character.id)}
      className="group w-full text-left rounded-[18px] overflow-hidden bg-[#232426] border border-white/[0.06] hover:border-white/[0.14] transition-colors cursor-pointer outline-none"
      aria-label={`Open ${characterName(character)}`}
    >
      <span className="relative block w-full overflow-hidden rounded-[18px]" style={{ aspectRatio: image?.ratio?.replace(':', ' / ') || '16 / 9' }}>
        <MediaTilePreview item={image} />
      </span>
      <span className="flex items-center gap-2 px-3 py-2.5 min-w-0">
        <UserRound size={14} className="text-zinc-400 shrink-0" />
        <span className="text-[12.5px] font-medium text-white truncate">{characterName(character)}</span>
        <span className="text-[11.5px] text-[#8c8c8c] shrink-0">Character{voice ? ` · ${voice.name}` : ''}</span>
      </span>
    </button>
  );
};

const SceneLinkCard: React.FC<{ id: string }> = ({ id }) => {
  const scene = useStore($scenes).find((s) => s.id === id);
  const phase = useStore($scenePhases)[id];
  if (!scene) return null;
  if (scene.trashedAt) {
    return <div className="text-[12px] text-zinc-500">"{scene.name}" is in the trash.</div>;
  }
  const seconds = scene.clips.reduce((total, c) => total + Math.max(0, c.trimEnd - c.trimStart), 0);
  const portrait = scene.aspectRatio === '9:16';
  const thumbs = scene.clips.slice(0, 5).map((c) => c.thumb);
  return (
    <button
      type="button"
      onClick={() => openScene(scene.id)}
      className="w-full flex items-stretch gap-3 text-left rounded-[18px] bg-[#232426] border border-white/[0.06] hover:border-white/[0.14] transition-colors p-2 cursor-pointer outline-none"
      aria-label={`Open ${scene.name} in the Scenebuilder`}
    >
      <span
        className="relative shrink-0 overflow-hidden rounded-[12px] bg-[#0c0c0c]"
        style={{ width: portrait ? 54 : 112, aspectRatio: portrait ? '9 / 16' : '16 / 9' }}
      >
        {scene.poster && <img src={scene.poster} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />}
        {!scene.poster && <span className="absolute inset-0 flex items-center justify-center"><Clapperboard size={18} className="text-zinc-500" /></span>}
      </span>
      <span className="flex flex-col justify-center gap-1 min-w-0 flex-1 py-0.5">
        <span className="flex items-center gap-1.5 min-w-0">
          <Clapperboard size={13} className="text-zinc-400 shrink-0" />
          <span className="text-[12.5px] font-medium text-white truncate">{scene.name}</span>
        </span>
        {phase === 'creating' ? (
          <TextShimmer className="text-[11.5px] font-medium" duration={1.5}>Creating...</TextShimmer>
        ) : (
          <span className="text-[11.5px] text-[#8c8c8c]">
            {scene.clips.length} clip{scene.clips.length === 1 ? '' : 's'} · {formatSeconds(seconds)} · Open in Scenebuilder
          </span>
        )}
        {thumbs.length > 0 && phase !== 'creating' && (
          <span className="flex gap-1 mt-0.5">
            {thumbs.map((thumb, i) => (
              <span key={i} className="block h-[22px] w-[34px] rounded-[5px] overflow-hidden bg-[#0c0c0c]">
                {thumb && <img src={thumb} alt="" className="w-full h-full object-cover" draggable={false} />}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
};

export const AgentLinkCards: React.FC<{ links?: AgentLink[]; mediaItems?: MediaItem[] }> = ({ links, mediaItems }) => {
  if (!links?.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {links.map((link) => (link.kind === 'scene'
        ? <SceneLinkCard key={`scene:${link.id}`} id={link.id} />
        : <CharacterLinkCard key={`character:${link.id}`} id={link.id} mediaId={link.mediaId} mediaItems={mediaItems} />))}
    </div>
  );
};
