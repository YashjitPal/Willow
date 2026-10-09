// What each Willow TV page tells the remote, worked out from the library: Flow TV's server hands
// its pages these "channel props" and "generation props"; Willow TV makes them from its projects.
import { channelBySlug, formatFilmLength, usableUrl, type TvChannel, type TvGeneration, type TvLibrary, type TvShortFilm } from './tv-library';
import { SEARCH_SLUG, SHORT_FILMS_SLUG } from './tv-routes';
import type { ChannelLink, ChannelProps, GenerationProps } from './TvState';

const linkTo = (c: TvChannel | undefined): ChannelLink | null =>
  c && c.generations[0] ? { slug: c.slug, generationId: c.generations[0].id, thumb: c.cover } : null;

/** A project's cover, unless it is a stored `blob:` URL, which no longer opens. */
export const coverOf = (c: TvChannel): string | null => (usableUrl(c.cover) ? c.cover : null);

/** Channels sit in a ring, as a TV's do: past the last one is the first again. */
export function channelPropsFor(lib: TvLibrary, channel: TvChannel): ChannelProps {
  const n = lib.channels.length;
  const i = lib.channels.indexOf(channel);
  const gens = channel.generations;
  return {
    slug: channel.slug,
    name: channel.name,
    colorTheme: channel.theme,
    thumb: coverOf(channel),
    thumbMedia: gens[0]?.media ?? null,
    firstGenerationId: gens[0]?.id ?? null,
    lastGenerationId: gens[gens.length - 1]?.id ?? null,
    totalGenerations: gens.length,
    previousChannel: n > 1 ? linkTo(lib.channels[(i - 1 + n) % n]) : null,
    nextChannel: n > 1 ? linkTo(lib.channels[(i + 1) % n]) : null,
    hasAudio: gens.some((g) => g.hasAudio),
  };
}

/**
 * Where Mixing goes when a clip ends: a clip on another channel (any other clip when there is only
 * the one channel), picked once per clip so the choice holds while it plays.
 */
export function nextRandomFor(lib: TvLibrary, gen: TvGeneration, rng: () => number = Math.random): { slug: string; generationId: string } | null {
  const others = lib.channels.filter((c) => c.slug !== gen.channelSlug && c.generations.length);
  if (others.length) {
    const c = others[Math.floor(rng() * others.length)];
    const g = c.generations[Math.floor(rng() * c.generations.length)];
    return { slug: c.slug, generationId: g.id };
  }
  const own = channelBySlug(lib, gen.channelSlug)?.generations.filter((g) => g.id !== gen.id) ?? [];
  if (!own.length) return null;
  return { slug: gen.channelSlug, generationId: own[Math.floor(rng() * own.length)].id };
}

export function generationPropsFor(lib: TvLibrary, channel: TvChannel, gen: TvGeneration, nextRandom: GenerationProps['nextRandomChannelGeneration']): GenerationProps {
  const i = channel.generations.indexOf(gen);
  return {
    id: gen.id,
    description: gen.prompt,
    genType: gen.genType,
    modelName: gen.modelName,
    thumb: gen.inputImage,
    createdBy: null,
    hasFullVideo: false,
    videoHasControls: false,
    videoHasAudio: gen.hasAudio,
    previousGenerationId: channel.generations[i - 1]?.id ?? null,
    nextGenerationId: channel.generations[i + 1]?.id ?? null,
    nextRandomChannelGeneration: nextRandom,
    parentSlug: channel.slug,
    projectId: channel.projectId,
    shareMedia: gen.media,
  };
}

/** Search results play as a channel of their own, named for the search, in the clip's colours. */
export function searchChannelProps(lib: TvLibrary, results: TvGeneration[], gen: TvGeneration, query: string): ChannelProps {
  const home = channelBySlug(lib, gen.channelSlug);
  return {
    slug: SEARCH_SLUG,
    name: query,
    colorTheme: home?.theme ?? 'purple',
    thumb: home ? coverOf(home) : null,
    thumbMedia: home?.generations[0]?.media ?? gen.media,
    firstGenerationId: results[0]?.id ?? null,
    lastGenerationId: results[results.length - 1]?.id ?? null,
    totalGenerations: results.length,
    previousChannel: null,
    nextChannel: null,
    hasAudio: results.some((g) => g.hasAudio),
  };
}

export function searchGenerationProps(lib: TvLibrary, results: TvGeneration[], gen: TvGeneration): GenerationProps {
  const home = channelBySlug(lib, gen.channelSlug);
  const i = results.indexOf(gen);
  return {
    ...(home ? generationPropsFor(lib, home, gen, null) : {
      id: gen.id, description: gen.prompt, genType: gen.genType, modelName: gen.modelName, thumb: gen.inputImage, createdBy: null,
      hasFullVideo: false, videoHasControls: false, videoHasAudio: gen.hasAudio, nextRandomChannelGeneration: null,
      parentSlug: gen.channelSlug, projectId: '', shareMedia: gen.media,
    }),
    previousGenerationId: results[i - 1]?.id ?? null,
    nextGenerationId: results[i + 1]?.id ?? null,
  };
}

/** A film's picture: its scene's poster, or its first clip's opening frame. */
export const filmThumb = (film: TvShortFilm): string | null => {
  const poster = film.poster ?? film.clips[0]?.thumb;
  return usableUrl(poster) ? poster : null;
};

export function filmChannelProps(lib: TvLibrary, film: TvShortFilm): ChannelProps {
  const films = lib.shortFilms;
  return {
    slug: SHORT_FILMS_SLUG,
    name: 'Short Films',
    colorTheme: channelBySlug(lib, film.channelSlug)?.theme ?? 'purple',
    thumb: filmThumb(film),
    thumbMedia: film.media[film.clips[0]?.mediaId] ?? null,
    firstGenerationId: films[0]?.id ?? null,
    lastGenerationId: films[films.length - 1]?.id ?? null,
    totalGenerations: films.length,
    previousChannel: null,
    nextChannel: null,
    hasAudio: true,
  };
}

export function filmGenerationProps(lib: TvLibrary, film: TvShortFilm): GenerationProps {
  const films = lib.shortFilms;
  const i = films.indexOf(film);
  const clips = film.clips.length;
  return {
    id: film.id,
    description: `${clips} ${clips === 1 ? 'clip' : 'clips'} · ${formatFilmLength(film.duration)}`,
    genType: 'Short Film',
    modelName: '',
    thumb: filmThumb(film),
    createdBy: film.projectName,
    hasFullVideo: true,
    videoHasControls: true,
    videoHasAudio: true,
    previousGenerationId: films[i - 1]?.id ?? null,
    nextGenerationId: films[i + 1]?.id ?? null,
    nextRandomChannelGeneration: null,
    parentSlug: SHORT_FILMS_SLUG,
    projectId: film.projectId,
    title: film.name,
    shareMedia: null,
  };
}
