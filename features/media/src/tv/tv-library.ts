// Willow TV's library: Flow TV's channels, clips and short films, made from what this Willow has.
// Flow TV streams a curated catalogue; Willow is offline, so every Media project with a finished
// video is a channel (its videos the clips, oldest first, as a channel plays them), and every
// scene is a short film. Pure: the storage reads come in through `TvLibrarySources`.
import type { StoredScene, StoredSceneClip } from '@willow/storage/media-scenes';
import { RESERVED_SLUGS } from './tv-routes';
import { channelTheme, type TvPaletteName } from './tv-theme';

/** Flow TV's label above a prompt ("Text to Video"); Willow adds one for uploads. */
export type TvGenType = 'Text to Video' | 'Image to Video' | 'Upload';

/** What playing a gallery video needs: its URL, or where its file is in the project folder. */
export interface TvMediaRef {
  id: string;
  url: string;
  projectName: string;
  fsName?: string;
  /** The collection folder its file is in, when it is in one. */
  folder?: string;
}

export interface TvGeneration {
  id: string;
  channelSlug: string;
  prompt: string;
  /** The tag beside the label: the model's name, as Flow TV shows "Veo 3". */
  modelName: string;
  genType: TvGenType;
  /** Flow TV draws the mute button's speaker for clips with sound, a music note otherwise. */
  hasAudio: boolean;
  ratio: string;
  createdAt: number;
  media: TvMediaRef;
  /** The picture an image-to-video clip was made from, shown beside its prompt as Flow TV does. */
  inputImage: string | null;
}

export interface TvChannel {
  slug: string;
  name: string;
  projectId: string;
  projectName: string;
  theme: TvPaletteName;
  /** The project's cover image, the channel's thumbnail; null draws its first clip instead. */
  cover: string | null;
  generations: TvGeneration[];
}

export interface TvShortFilm {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  channelSlug: string;
  aspectRatio: '16:9' | '9:16';
  poster?: string;
  clips: StoredSceneClip[];
  /** The clips' videos, by media id, from the scene's project. */
  media: Record<string, TvMediaRef>;
  duration: number;
  updatedAt: number;
}

export interface TvLibrary {
  channels: TvChannel[];
  shortFilms: TvShortFilm[];
}

export interface TvLibrarySources {
  projects: readonly { id: string; name: string }[];
  /** Whether files in the project folder can be read (a folder is connected and allowed). */
  canReadDisk: boolean;
  loadMedia(projectId: string): Promise<any[]>;
  loadScenes(projectId: string): Promise<StoredScene[]>;
  loadCover(projectId: string): Promise<string | null>;
  /** Collection folder paths by collection id: where a clip's file is when it is in one. */
  loadFolders(projectId: string): Promise<Record<string, string>>;
}

export const slugify = (name: string): string =>
  name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'channel';

const isUpload = (m: any) => m.modelId === 'upload' || m.modelId === 'external' || /^(upload|external source)$/i.test(m.modelName || '');

export function genTypeOf(m: any): TvGenType {
  if (isUpload(m)) return 'Upload';
  return Array.isArray(m.attachments) && m.attachments.length > 0 ? 'Image to Video' : 'Text to Video';
}

/** Veo 2 made silent clips; everything Willow generates since speaks, and uploads may. */
export const hasAudioOf = (m: any): boolean => !/veo\s*2(?![.\d])/i.test(m.modelName || '');

/** A stored `blob:` URL died with the tab that made it; the file, if there is one, is read again. */
export const usableUrl = (url: unknown): url is string => typeof url === 'string' && url.length > 0 && !url.startsWith('blob:');

const isPlayableVideo = (m: any, canReadDisk: boolean) =>
  m && m.kind === 'video' && m.status === 'completed' && !m.characterId && (usableUrl(m.url) || (canReadDisk && !!m.fsName));

const clipLength = (c: StoredSceneClip) => Math.max(0, c.trimEnd - c.trimStart);

export async function loadTvLibrary(src: TvLibrarySources): Promise<TvLibrary> {
  const channels: TvChannel[] = [];
  const shortFilms: TvShortFilm[] = [];
  const taken = new Set<string>(RESERVED_SLUGS);
  for (const project of src.projects) {
    let items: any[] = [];
    try { items = await src.loadMedia(project.id); } catch { continue; }
    const videos = items.filter((m) => isPlayableVideo(m, src.canReadDisk)).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    if (!videos.length) continue;
    const [cover, folders] = await Promise.all([
      src.loadCover(project.id).catch(() => null),
      src.loadFolders(project.id).catch((): Record<string, string> => ({})),
    ]);
    const media: Record<string, TvMediaRef> = {};
    for (const v of videos) {
      media[v.id] = {
        id: v.id,
        url: usableUrl(v.url) ? v.url : '',
        projectName: project.name,
        fsName: v.fsName,
        folder: v.collectionId ? folders[v.collectionId] : undefined,
      };
    }
    const base = slugify(project.name);
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
    taken.add(slug);
    channels.push({
      slug,
      name: project.name,
      projectId: project.id,
      projectName: project.name,
      theme: channelTheme(project.id),
      cover,
      generations: videos.map((v) => ({
        id: v.id,
        channelSlug: slug,
        prompt: v.prompt || v.shortenedPrompt || '',
        modelName: v.modelName || '',
        genType: genTypeOf(v),
        hasAudio: hasAudioOf(v),
        ratio: v.ratio || '16:9',
        createdAt: v.timestamp || 0,
        media: media[v.id],
        inputImage: (Array.isArray(v.attachments) ? v.attachments : []).find((a: any) => a && a.kind !== 'video' && usableUrl(a.url))?.url ?? null,
      })),
    });
    let scenes: StoredScene[] = [];
    try { scenes = await src.loadScenes(project.id); } catch { /* none */ }
    for (const scene of scenes) {
      if (scene.trashedAt) continue;
      const clips = scene.clips.filter((c) => media[c.mediaId]);
      if (!clips.length) continue;
      shortFilms.push({
        id: scene.id,
        name: scene.name,
        projectId: project.id,
        projectName: project.name,
        channelSlug: slug,
        aspectRatio: scene.aspectRatio,
        poster: scene.poster,
        clips,
        media,
        duration: clips.reduce((t, c) => t + clipLength(c), 0),
        updatedAt: scene.updatedAt,
      });
    }
  }
  const latest = (c: TvChannel) => c.generations[c.generations.length - 1]?.createdAt ?? 0;
  channels.sort((a, b) => latest(b) - latest(a));
  shortFilms.sort((a, b) => b.updatedAt - a.updatedAt);
  return { channels, shortFilms };
}

/* ---- finding things ---- */

export const channelBySlug = (lib: TvLibrary, slug: string): TvChannel | undefined => lib.channels.find((c) => c.slug === slug);

export const allGenerations = (lib: TvLibrary): TvGeneration[] => lib.channels.flatMap((c) => c.generations);

/** Any clip of any channel, as Flow TV's Shuffle All and its logo pick one; not `exceptId` when there is another. */
export function randomGeneration(lib: TvLibrary, exceptId?: string, rng: () => number = Math.random): TvGeneration | null {
  const all = allGenerations(lib);
  const pool = all.length > 1 && exceptId ? all.filter((g) => g.id !== exceptId) : all;
  return pool.length ? pool[Math.floor(rng() * pool.length)] : null;
}

/** A clip of `channel` at random: where a channel's tile on the Channels page plays from. */
export function randomInChannel(channel: TvChannel, rng: () => number = Math.random): TvGeneration | null {
  return channel.generations.length ? channel.generations[Math.floor(rng() * channel.generations.length)] : null;
}

/** The clip before or after `id` in its channel, wrapping at the ends (Flow TV's Previous and Next Clip). */
export function stepInChannel(channel: TvChannel, id: string, dir: 1 | -1): TvGeneration | null {
  const n = channel.generations.length;
  if (!n) return null;
  const at = channel.generations.findIndex((g) => g.id === id);
  return channel.generations[((at < 0 ? 0 : at) + dir + n) % n];
}

/** The channel above or below `slug` in the channel list, wrapping (Flow TV's channel up and down). */
export function stepChannel(lib: TvLibrary, slug: string, dir: 1 | -1): TvChannel | null {
  const n = lib.channels.length;
  if (!n) return null;
  const at = lib.channels.findIndex((c) => c.slug === slug);
  return lib.channels[((at < 0 ? 0 : at) + dir + n) % n];
}

/* ---- search ---- */

export const ALL_VIDEOS = 'all';

export interface TvSearchFilter {
  value: string;
  label: string;
}

/** Flow TV filters by model ("Veo 3 (With Audio)", "Veo 2"); Willow's options are the models it has clips from. */
export function searchFilters(lib: TvLibrary): TvSearchFilter[] {
  const models = new Map<string, boolean>();
  for (const g of allGenerations(lib)) if (g.modelName) models.set(g.modelName, (models.get(g.modelName) ?? false) || g.hasAudio);
  return [
    { value: ALL_VIDEOS, label: 'All Videos' },
    ...[...models].sort(([a], [b]) => a.localeCompare(b)).map(([name, audio]) => ({ value: slugify(name), label: audio ? `${name} (With Audio)` : name })),
  ];
}

/** Clips whose prompt (or channel name) has every word of `query`, in the filter's model. */
export function searchGenerations(lib: TvLibrary, query: string, filter = ALL_VIDEOS): TvGeneration[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const names = new Map(lib.channels.map((c) => [c.slug, c.name.toLowerCase()]));
  return allGenerations(lib).filter((g) => {
    if (filter !== ALL_VIDEOS && slugify(g.modelName) !== filter) return false;
    const text = `${g.prompt.toLowerCase()} ${names.get(g.channelSlug) ?? ''}`;
    return words.every((w) => text.includes(w));
  });
}

/** Flow TV's channel-name layout: two balanced lines, with non-breaking spaces and hyphens in each. */
export function formatChannelName(name: string): string {
  const words = name.split(' ');
  const join = (part: string[]) => part.join('\u00a0').replace('-', '\u2011');
  const a1 = join(words.slice(0, Math.floor(words.length / 2)));
  const a2 = join(words.slice(Math.floor(words.length / 2)));
  const b1 = join(words.slice(0, Math.ceil(words.length / 2)));
  const b2 = join(words.slice(Math.ceil(words.length / 2)));
  return Math.abs(a1.length - a2.length) < Math.abs(b1.length - b2.length) ? `${a1}\n${a2}` : `${b1}\n${b2}`;
}

export const formatFilmLength = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
