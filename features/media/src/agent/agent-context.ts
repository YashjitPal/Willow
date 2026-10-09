// The Media agent's view of the project: what goes into its system prompt and its tool
// results, worked out from the host's current state. Pure; the turn loop lives in agent-session.ts.

import type { MediaItem } from '../types';
import { findVoice } from '../characters/voices';
import { UNTITLED_CHARACTER } from '../characters/character-store';
import type { InventoryEntry, PromptCharacter, PromptFocus, PromptScene } from './agent-tools';
import type { AgentCharacterRecord, AgentSceneClip, AgentSceneRecord, MediaAgentHost, SceneClipPlan } from './agent-session';

export const itemName = (item: MediaItem): string =>
  (item.shortenedPrompt || item.prompt || 'Untitled').replace(/\s+/g, ' ').replace(/"/g, "'").trim().slice(0, 80);

/** Per edit history, its newest finished version: what the grid shows in the original's place. */
export const latestVersionsOf = (items: MediaItem[]): Map<string, MediaItem> => {
  const latest = new Map<string, MediaItem>();
  for (const item of items) {
    if (!item.historyGroupId || item.status !== 'completed' || !item.url) continue;
    const current = latest.get(item.historyGroupId);
    if (!current || item.timestamp > current.timestamp) latest.set(item.historyGroupId, item);
  }
  return latest;
};

/** The gallery as the grid shows it: no character images, each edit history as its newest version. */
export const galleryItems = (items: MediaItem[]): MediaItem[] => {
  const latest = latestVersionsOf(items);
  return items
    .filter((item) => !item.historyParentId && !item.characterId && item.id !== 'new-music-button')
    .map((item) => latest.get(item.historyGroupId || item.id) ?? item)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
};

export const inventoryEntry = (item: MediaItem, collections: Map<string, string>): InventoryEntry => ({
  id: item.id,
  kind: item.kind,
  name: itemName(item),
  ratio: item.ratio,
  status: item.status,
  favorite: item.favorite,
  ...(item.collectionId && collections.has(item.collectionId) ? { collection: collections.get(item.collectionId) } : {}),
});

export const toInventory = (items: MediaItem[], collections: Map<string, string>): InventoryEntry[] =>
  galleryItems(items).map((item) => inventoryEntry(item, collections));

export const collectionNames = (host: MediaAgentHost): Map<string, string> =>
  new Map(host.collections.map((c) => [c.id, c.name.trim() || 'Untitled collection']));

export const itemById = (host: MediaAgentHost, id: string | undefined): MediaItem | undefined =>
  (id ? host.mediaItems.find((m) => m.id === id) : undefined);

export const isReadyImage = (item: MediaItem | undefined): item is MediaItem =>
  !!item && item.kind === 'image' && item.status === 'completed' && !!item.url;

export const characterName = (c: AgentCharacterRecord): string => c.name.trim() || UNTITLED_CHARACTER;

export const voiceLabel = (c: AgentCharacterRecord): string | undefined => {
  const voice = findVoice(c.voice?.name);
  return voice ? `${voice.name} (${voice.description.toLowerCase()})` : undefined;
};

export const slotState = (item: MediaItem | undefined): PromptCharacter['portrait'] => {
  if (!item) return 'none';
  if (item.status === 'completed' && item.url) return 'ready';
  return item.status === 'failed' ? 'failed' : 'generating';
};

export const toPromptCharacters = (host: MediaAgentHost): PromptCharacter[] =>
  [...host.characters]
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .map((c) => {
      const portrait = itemById(host, c.portraitId);
      return {
        id: c.id,
        name: characterName(c),
        look: c.prompt || portrait?.prompt || '',
        info: c.personality || '',
        voice: voiceLabel(c),
        portrait: slotState(portrait),
        fullBody: slotState(itemById(host, c.bodyId)) === 'ready',
        favorite: c.favorite,
      };
    });

export const clipSeconds = (clip: AgentSceneClip): number => Math.max(0, clip.trimEnd - clip.trimStart);

export const liveScenes = (host: MediaAgentHost): AgentSceneRecord[] =>
  host.scenes.filter((s) => !s.trashedAt).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

export const toPromptScenes = (host: MediaAgentHost): PromptScene[] =>
  liveScenes(host).map((s) => ({
    id: s.id,
    name: s.name,
    ratio: s.aspectRatio,
    seconds: s.clips.reduce((total, c) => total + clipSeconds(c), 0),
    clips: s.clips.map((c) => {
      const item = itemById(host, c.mediaId);
      return { mediaId: c.mediaId, name: item ? itemName(item) : 'missing video', seconds: clipSeconds(c) };
    }),
  }));

export interface CastMember {
  character: AgentCharacterRecord;
  name: string;
  /** Its portrait and full-body shot, whichever are finished. */
  images: MediaItem[];
}

export const resolveCast = (host: MediaAgentHost, ids: string[]): { members: CastMember[]; unknown: string[] } => {
  const members: CastMember[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const character = host.characters.find((c) => c.id === id);
    if (!character) {
      unknown.push(id);
      continue;
    }
    if (members.some((m) => m.character.id === character.id)) continue;
    const images = [itemById(host, character.portraitId), itemById(host, character.bodyId)].filter(isReadyImage);
    members.push({ character, name: characterName(character), images });
  }
  return { members, unknown };
};

export const flat = (value: string, limit: number): string => {
  const one = value.replace(/\s+/g, ' ').trim();
  return one.length > limit ? `${one.slice(0, limit - 1).trimEnd()}…` : one;
};

/**
 * What the image or video model is told about the cast, after the agent's own prompt. With
 * images, each member points at its references by number, counted from `firstIndex` in the
 * order they are sent; without, its looks go in as words. A video also gets how each one acts
 * and sounds.
 */
export const castNote = (members: CastMember[], kind: 'image' | 'video', withImages: boolean, firstIndex: number): string => {
  let next = firstIndex;
  const lines = members.map((m) => {
    const parts: string[] = [];
    const count = withImages ? m.images.length : 0;
    if (count === 1) parts.push(`reference image ${next}`);
    if (count > 1) parts.push(`reference images ${next}–${next + count - 1}`);
    next += count;
    if (!count && m.character.prompt) parts.push(flat(m.character.prompt, 320));
    if (kind === 'video' && m.character.personality) parts.push(`acts: ${flat(m.character.personality, 200)}`);
    const voice = voiceLabel(m.character);
    if (kind === 'video' && voice) parts.push(`voice: ${voice}`);
    return `- ${m.name}${parts.length ? `: ${parts.join('; ')}` : ''}.`;
  });
  const head = withImages && members.some((m) => m.images.length)
    ? 'Characters. Keep each one exactly as in their reference images: face, hair, build and clothing.'
    : 'Characters:';
  return `${head}\n${lines.join('\n')}`;
};

/** The selection oldest first, so "these, in order" reads as the order they were made. */
export const toPromptFocus = (host: MediaAgentHost, collections: Map<string, string>): PromptFocus => {
  const focus = host.focus;
  const latest = latestVersionsOf(host.mediaItems);
  const shown = (item: MediaItem) => latest.get(item.historyGroupId || item.id) ?? item;
  const media: MediaItem[] = [];
  const others: InventoryEntry[] = [];
  for (const entry of focus.selection) {
    if (entry.kind === 'media') {
      const item = itemById(host, entry.id);
      if (item && !media.some((m) => m.id === shown(item).id)) media.push(shown(item));
    } else if (entry.kind === 'scene') {
      const scene = host.scenes.find((s) => s.id === entry.id && !s.trashedAt);
      if (scene) others.push({ id: scene.id, kind: 'scene', name: scene.name, ratio: scene.aspectRatio, status: 'completed' });
    } else if (collections.has(entry.id)) {
      others.push({ id: entry.id, kind: 'collection', name: collections.get(entry.id)!, ratio: '', status: 'completed' });
    }
  }
  media.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const viewer = itemById(host, focus.viewerId);
  const scene = focus.sceneId ? host.scenes.find((s) => s.id === focus.sceneId) : undefined;
  const character = focus.characterId ? host.characters.find((c) => c.id === focus.characterId) : undefined;
  return {
    tab: focus.tab,
    ...(focus.collectionId && collections.has(focus.collectionId) ? { collection: { id: focus.collectionId, name: collections.get(focus.collectionId)! } } : {}),
    ...(viewer ? { viewer: inventoryEntry(viewer, collections) } : {}),
    ...(scene ? { scene: { id: scene.id, name: scene.name } } : {}),
    ...(character ? { character: { id: character.id, name: characterName(character) } } : {}),
    selection: [...media.map((m) => inventoryEntry(m, collections)), ...others],
  };
};

/**
 * A scene's new clip list from gallery video IDs. With `order`, the scene becomes exactly those
 * videos in that order: one already in it keeps its clip, trims and all, each use taking the
 * next, and anything left out is dropped. `additions` go on the end as whole new clips.
 * `videoFor` returns the video for an ID, or why it can't go in a scene.
 */
export function planSceneClips(
  clips: AgentSceneClip[],
  order: string[] | null,
  additions: string[],
  videoFor: (id: string) => MediaItem | string,
): { plan: SceneClipPlan; skipped: { id: string; reason: string }[] } {
  const skipped: { id: string; reason: string }[] = [];
  const unused = [...clips];
  const fresh = (id: string): SceneClipPlan[number] | null => {
    const video = videoFor(id);
    if (typeof video === 'string') {
      skipped.push({ id, reason: video });
      return null;
    }
    return { video };
  };
  const plan: SceneClipPlan = order
    ? order.flatMap((id) => {
        const index = unused.findIndex((c) => c.mediaId === id);
        if (index >= 0) return [{ clip: unused.splice(index, 1)[0] }];
        const entry = fresh(id);
        return entry ? [entry] : [];
      })
    : clips.map((clip) => ({ clip }));
  for (const id of additions) {
    const entry = fresh(id);
    if (entry) plan.push(entry);
  }
  return { plan, skipped };
}

/**
 * A reply cut where its cards go, so a character or scene sits where the reply made it, as its
 * media does: text, a card, more text. A card saved before cards had a place (`at`) goes last.
 */
export function splitReplyAtCards<C extends { at?: number }>(content: string, cards: C[] | undefined): ({ text: string } | { card: C })[] {
  const placed = (cards ?? []).filter((c) => typeof c.at === 'number').sort((a, b) => a.at! - b.at!);
  const parts: ({ text: string } | { card: C })[] = [];
  let from = 0;
  for (const card of placed) {
    const at = Math.min(Math.max(from, card.at!), content.length);
    if (at > from) parts.push({ text: content.slice(from, at) });
    parts.push({ card });
    from = at;
  }
  if (from < content.length) parts.push({ text: content.slice(from) });
  for (const card of cards ?? []) if (typeof card.at !== 'number') parts.push({ card });
  return parts;
}

const brief = (value: unknown, max = 80): string => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * One line on what a tool call did, kept with the reply: a later turn then knows what an earlier
 * one made and found even when that turn's own history is gone, as a stopped turn's is, and every
 * turn's after a reload.
 */
export function describeToolCall(name: string, args: Record<string, unknown> | undefined, result: Record<string, unknown>): string {
  const named = (thing: unknown) => {
    const t = thing as { id?: unknown; name?: unknown } | undefined;
    return t?.id ? ` ${String(t.id)}${t.name ? ` "${brief(t.name, 40)}"` : ''}` : '';
  };
  let what: string;
  switch (name) {
    case 'generate_image':
    case 'generate_video': {
      const items = Array.isArray(result.items) ? (result.items as { id?: unknown; status?: unknown }[]) : [];
      const made = items.filter((i) => i.status === 'completed').map((i) => String(i.id));
      // A stop leaves started generations running in the gallery.
      const started = Array.isArray(result.started) ? result.started.map(String) : [];
      what = `${name} "${brief(args?.prompt)}"${made.length ? `, made ${made.join(', ')}` : ''}${started.length ? `, started ${started.join(', ')}, still generating in the gallery` : ''}`;
      break;
    }
    case 'create_character':
    case 'update_character':
      what = `${name}${named(result.character) || (args?.name ? ` "${brief(args.name, 40)}"` : '')}`;
      break;
    case 'create_scene':
    case 'update_scene':
      what = `${name}${named(result.scene) || (args?.name ? ` "${brief(args.name, 40)}"` : '')}`;
      break;
    case 'analyze_media':
      what = `analyze_media ${String(result.id ?? args?.media_id ?? '')}${result.answer ? `, found: ${brief(result.answer, 200)}` : ''}`;
      break;
    default:
      what = name;
  }
  const error = result.error ? `: ${brief(result.error, 160)}` : '';
  return `${what} (${String(result.status ?? 'done')}${error})`;
}

/**
 * An earlier reply as the model reads it when that reply's own history is gone: what it wrote,
 * what its tools did, and whether it finished, so a "continue" can pick up where it stopped.
 * `text` is the reply's words, its media cards left out.
 */
export function replyForHistory(reply: { status?: string; error?: string; actions?: string[] }, text: string): string {
  const notes: string[] = [];
  if (reply.actions?.length) notes.push(`[What this reply did: ${reply.actions.join('; ')}]`);
  if (reply.status === 'stopped') notes.push('[This reply did not finish: it was stopped before the end.]');
  if (reply.status === 'error') notes.push(`[This reply did not finish: it failed${reply.error ? ` (${brief(reply.error, 160)})` : ''}.]`);
  return [text || '(No reply.)', ...notes].join('\n\n');
}
