// Flow TV's other pages: Channels (and Shuffle All), Short Films, search results, the FAQ, and its
// 404; plus the one Flow TV never needs, for a Willow with no finished video yet.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import shuffleAllImage from '@willow/assets/tv/shuffle-all.png';
import { ALL_VIDEOS, formatFilmLength, randomInChannel, searchGenerations, type TvChannel, type TvMediaRef, type TvShortFilm } from './tv-library';
import { coverOf, filmThumb } from './tv-props';
import {
  PARAM_FILM, PARAM_FILTER, PARAM_QUERY, SEARCH_SLUG, SHORT_FILMS_SLUG, TV_BASE, tvClipPath, tvShortFilmsPath,
} from './tv-routes';
import { TvHtml } from './TvDialogs';
import { AssertiveAlert, TvButtonIcon, TvButtonOutline, TvIcon, TvImage, TvLink, TvTooltip, TvVideo, cx } from './TvPrimitives';
import { useMediaUrl, useTvLibrary, useTvShell } from './TvState';

/** A video's opening frame, held still: Willow's clips have no separate thumbnails. */
const FirstFrame: React.FC<{ media: TvMediaRef | null; objectFit?: React.CSSProperties['objectFit']; onLoad?: () => void }> = ({ media, objectFit = 'cover', onLoad }) => {
  const src = useMediaUrl(media);
  if (!src) return null;
  return (
    <TvVideo
      src={src}
      autoPlay={false}
      loop={false}
      objectFit={objectFit}
      onLoaded={onLoad}
      onLoadedMetadata={(e) => { e.currentTarget.currentTime = Math.min(0.1, e.currentTarget.duration || 0); }}
    />
  );
};

/**
 * Flow TV's VideoWithPoster: the picture until the pointer is on it, then the video, playing. A
 * channel without a cover shows its first clip's opening frame instead.
 */
const PosterVideo: React.FC<{ poster: string | null; media: TvMediaRef | null; objectFit: React.CSSProperties['objectFit']; className: string; onLoad: () => void; hovered: boolean }> = ({ poster, media, objectFit, className, onLoad, hovered }) => {
  const src = useMediaUrl(media);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (hovered) void v.play().catch(() => undefined);
    else {
      v.pause();
      v.currentTime = poster ? 0 : Math.min(0.1, v.duration || 0);
    }
  }, [hovered, poster]);
  return (
    <span className={cx('wtv-asset__container', className)} data-has-poster="true">
      {src && (
        <TvVideo
          ref={videoRef}
          src={src}
          autoPlay={false}
          objectFit={objectFit}
          style={{ opacity: hovered || !poster ? 1 : 0, transition: `opacity 0.2s linear ${hovered ? '0s' : '0.2s'}` }}
          onLoaded={poster ? undefined : onLoad}
        />
      )}
      {poster && (
        <img
          className="wtv-asset__asset"
          src={poster}
          alt=""
          draggable={false}
          style={{ objectFit, opacity: hovered ? 0 : 1, transition: `opacity 0.2s linear ${hovered ? '0.2s' : '0s'}` }}
          onLoad={onLoad}
          ref={(el) => { if (el?.complete && el.naturalWidth) onLoad(); }}
        />
      )}
    </span>
  );
};

/** Flow TV's ListItem: a square tile and its name under it. */
const ListItem: React.FC<{
  text: string;
  poster: string | null;
  media: TvMediaRef | null;
  objectFit: React.CSSProperties['objectFit'];
  isTwoColumnsWide?: boolean;
  hasAudio?: boolean;
  label: string;
  onClick: () => void;
}> = ({ text, poster, media, objectFit, isTwoColumnsWide = false, hasAudio = false, label, onClick }) => {
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <button type="button" className="wtv-list-item__container" aria-label={label} onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <span className="wtv-list-item__videoOuterContainer" data-is-two-columns-wide={isTwoColumnsWide}>
        <span className="wtv-list-item__videoInnerContainer" data-has-loaded={loaded}>
          <PosterVideo className="wtv-list-item__video" poster={poster} media={media} objectFit={objectFit} hovered={hovered} onLoad={() => setLoaded(true)} />
        </span>
      </span>
      <span className="wtv-list-item__text" aria-hidden data-is-veo3={hasAudio}>
        {text}
        {hasAudio && (
          <span className="wtv-list-item__iconAndTooltipContainer">
            <TvIcon id="volume-up" className="wtv-list-item__icon" />
            <TvTooltip className="wtv-list-item__tooltip" height={34}>With Audio</TvTooltip>
          </span>
        )}
      </span>
    </button>
  );
};

/** Home again with a fresh `h`, which picks a channel at random (Flow TV's random-channel button). */
const useShuffle = () => {
  const navigate = useNavigate();
  return () => navigate(`${TV_BASE}?h=${Math.random().toString(36).substring(2, 7)}`);
};

export const TvChannelsPage: React.FC = () => {
  const { library } = useTvLibrary();
  const navigate = useNavigate();
  const shuffle = useShuffle();
  if (library && !library.channels.length) return <TvEmptyPage />;
  const open = (c: TvChannel) => {
    const g = randomInChannel(c);
    navigate(g ? tvClipPath(c.slug, g.id, { randomGeneration: true }) : `${TV_BASE}/channel/${c.slug}`);
  };
  return (
    <>
      <AssertiveAlert alert="Navigated to channels" />
      <ul className="wtv-channels-grid__container">
        <li className="wtv-channels-grid__shuffleAllContainer">
          <ListItem text="Shuffle All" label="Play random channel" poster={shuffleAllImage} media={null} objectFit="contain" isTwoColumnsWide onClick={shuffle} />
        </li>
        {library?.channels.map((c) => (
          <li key={c.slug}>
            <ListItem
              text={c.name}
              label={`Go to random video on channel: ${c.name}`}
              poster={coverOf(c)}
              media={c.generations[0]?.media ?? null}
              objectFit="cover"
              hasAudio={c.generations.some((g) => g.hasAudio)}
              onClick={() => open(c)}
            />
          </li>
        ))}
      </ul>
    </>
  );
};

const OUTLINE = {
  colorText: 'neutral-100',
  colorTextHover: 'neutral-100',
  colorBorder: 'white',
  colorBorderAlpha: 0.15,
  colorBackground: 'white',
  colorBackgroundAlpha: 0.05,
  colorBorderHover: 'white',
  colorBorderHoverAlpha: 0.15,
  colorBackgroundPressedAlpha: 0.25,
  colorBackgroundHover: 'white',
  colorBackgroundHoverAlpha: 0.15,
};

const filmLine = (film: TvShortFilm) => `${film.clips.length} ${film.clips.length === 1 ? 'clip' : 'clips'} · ${formatFilmLength(film.duration)}`;

const SelectedShortFilm: React.FC<{ film: TvShortFilm }> = ({ film }) => {
  const first = film.media[film.clips[0]?.mediaId] ?? null;
  const src = useMediaUrl(first);
  return (
    <div className="wtv-selected-short-film__container">
      <span className="wtv-asset__container wtv-selected-short-film__video">
        {src && <TvVideo key={src} src={src} onLoadedMetadata={(e) => { e.currentTarget.currentTime = film.clips[0]?.trimStart ?? 0; }} />}
      </span>
      <span className="wtv-selected-short-film__contentBackdrop">
        <span className="wtv-selected-short-film__blur" />
        <span className="wtv-selected-short-film__blur" />
        <span className="wtv-selected-short-film__blur" />
      </span>
      <div className="wtv-selected-short-film__contentAndButtonContainer">
        <div className="wtv-selected-short-film__contentContainer">
          <h2 className="wtv-selected-short-film__title">{film.name}</h2>
          <p className="wtv-selected-short-film__description">{filmLine(film)}</p>
          <h3 className="wtv-selected-short-film__authorLabel">From the project</h3>
          <div className="wtv-selected-short-film__author">{film.projectName}</div>
        </div>
        <TvButtonOutline element="link" href={tvClipPath(SHORT_FILMS_SLUG, film.id)} className="wtv-selected-short-film__buttonWatch" height={42} hasBackdropFilterBlur {...OUTLINE}>
          Watch
        </TvButtonOutline>
      </div>
    </div>
  );
};

const SelectorCarousel: React.FC<{ films: TvShortFilm[]; selectedId: string; onSelect: (id: string) => void }> = ({ films, selectedId, onSelect }) => {
  const outer = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const i = films.findIndex((f) => f.id === selectedId);
  const measure = () => {
    const el = outer.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 0, right: el.scrollLeft < el.scrollWidth - el.clientWidth - 1 });
  };
  useLayoutEffect(() => {
    const el = outer.current;
    const active = el?.querySelector<HTMLElement>('[data-is-active="true"]');
    if (el && active) {
      const target = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
      el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
    }
    const t = setTimeout(measure, 350);
    return () => clearTimeout(t);
  }, [selectedId]);
  const arrow = {
    shape: 'circle' as const,
    colorIcon: 'white',
    colorBackgroundHover: 'white',
    colorBackgroundHoverAlpha: 0.15,
    colorBackgroundPressedAlpha: 0.25,
    containerSize: 32,
    iconSize: 20,
    iconProps: { className: 'wtv-selector-carousel__icon' },
  };
  return (
    <div className="wtv-selector-carousel__container">
      <TvButtonIcon {...arrow} className="wtv-selector-carousel__buttonPrev" icon="chevron-left" title="Previous short film" isDisabled={i <= 0} onClick={() => { if (i > 0) onSelect(films[i - 1].id); }} />
      <div ref={outer} className="wtv-selector-carousel__carouselOuterContainer" data-can-drag={false} data-is-left-blur-visible={edges.left} data-is-right-blur-visible={edges.right} onScroll={measure}>
        <ul className="wtv-selector-carousel__carouselInnerContainer">
          {films.map((f) => {
            const thumb = filmThumb(f);
            return (
              <li key={f.id} className="wtv-selector-carousel__carouselSlide">
                <button type="button" className="wtv-selector-carousel__carouselButton" data-is-active={f.id === selectedId} aria-label={f.name} onClick={() => onSelect(f.id)}>
                  {thumb ? <TvImage className="wtv-selector-carousel__carouselAsset" src={thumb} /> : (
                    <span className="wtv-asset__container wtv-selector-carousel__carouselAsset"><FirstFrame media={f.media[f.clips[0]?.mediaId] ?? null} /></span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <TvButtonIcon {...arrow} className="wtv-selector-carousel__buttonNext" icon="chevron-right" title="Next short film" isDisabled={i >= films.length - 1} onClick={() => { if (i < films.length - 1) onSelect(films[i + 1].id); }} />
    </div>
  );
};

export const TvShortFilmsPage: React.FC = () => {
  const { library } = useTvLibrary();
  const navigate = useNavigate();
  const location = useLocation();
  const films = library?.shortFilms ?? [];
  const asked = new URLSearchParams(location.search).get(PARAM_FILM);
  const selected = films.find((f) => f.id === asked) ?? films[0];
  return (
    <>
      <AssertiveAlert alert="Navigated to short films" />
      <div className="wtv-content__container">
        {selected ? (
          <>
            <SelectedShortFilm key={selected.id} film={selected} />
            <SelectorCarousel films={films} selectedId={selected.id} onSelect={(id) => navigate(tvShortFilmsPath(id), { replace: true })} />
          </>
        ) : library && (
          <div className="wtv-page-error__contentContainer">
            <TvIcon className="wtv-page-error__errorIcon" id="no-results" />
            <h1 className="wtv-page-error__errorMessage">No short films yet. Put clips together in Scenebuilder and they play here.</h1>
          </div>
        )}
        <span className="wtv-content__disclaimerContainer">
          <span className="wtv-content__disclaimer">Short films are the scenes you&apos;ve made in Scenebuilder, played clip by clip from your projects.</span>
        </span>
      </div>
    </>
  );
};

const LoadingOrbs: React.FC = () => (
  <div className="wtv-loading-orbs__container">
    <span className="wtv-loading-orbs__orb" />
    <span className="wtv-loading-orbs__orb" />
    <span className="wtv-loading-orbs__orb" />
  </div>
);

export const TvSearchPage: React.FC = () => {
  const { library } = useTvLibrary();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const query = params.get(PARAM_QUERY) ?? '';
  const filter = params.get(PARAM_FILTER) ?? ALL_VIDEOS;
  const results = useMemo(() => (library ? searchGenerations(library, query, filter) : []), [library, query, filter]);
  return (
    <>
      <AssertiveAlert alert={`Showing search results for '${query}'`} />
      <div className="wtv-page-search__container">
        {!library ? (
          <div className="wtv-page-search__loadingContainer"><LoadingOrbs /></div>
        ) : results.length ? (
          <ul className="wtv-page-search__resultsContainer">
            {results.map((g) => (
              <li key={g.id}>
                <TvLink className="wtv-page-search__resultLink" href={tvClipPath(SEARCH_SLUG, g.id, { query, filter: filter === ALL_VIDEOS ? null : filter })} aria-label={g.prompt}>
                  <span className="wtv-asset__container wtv-page-search__resultAsset"><FirstFrame media={g.media} /></span>
                </TvLink>
              </li>
            ))}
          </ul>
        ) : (
          <div className="wtv-page-search__errorContainer">
            <TvIcon className="wtv-page-search__errorIcon" id="no-results" />
            <p className="wtv-page-search__errorDescription">No results found. Please try another search.</p>
          </div>
        )}
      </div>
    </>
  );
};

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is Willow TV?',
    a: "Willow TV is an ever-growing showcase of the clips you've made in Willow. Every Media project with a finished video is a channel, and every scene you've put together in Scenebuilder is a short film.",
  },
  {
    q: 'Where do the videos come from?',
    a: "From your own projects, on this device. Willow TV doesn't fetch anything: it plays the videos already in your gallery, and the ones in your project folder when one is connected.",
  },
  {
    q: 'How do I add a channel?',
    a: 'Generate or upload a video in a Media project. The next time Willow TV opens, the project is a channel, in colours of its own.',
  },
  {
    q: 'What do Mixing and Loop do?',
    a: 'With the loop button off, Willow TV mixes: when a clip ends it plays one from another channel. Loop Channel keeps it to the channel you are on, and Repeat Video plays the one clip over and over.',
  },
  {
    q: 'Can I reuse a prompt?',
    a: 'Yes. Reuse Prompt, beside the prompt on the remote, opens the clip\'s project in Willow with that prompt ready to go. <a href="/media" target="_blank">Create with Willow</a>.',
  },
];

export const TvFaqPage: React.FC = () => {
  const { pageTheme } = useTvShell();
  return (
    <>
      <AssertiveAlert alert="Navigated to FAQ" />
      <div className="wtv-page-faq__container">
        <ol className="wtv-page-faq__questionsContainer">
          {FAQ.map((item) => (
            <li key={item.q} className="wtv-page-faq__questionContainer">
              <h2 className="wtv-page-faq__question">{item.q}</h2>
              <TvHtml className="wtv-page-faq__answer" html={item.a} theme={pageTheme ?? 'purple'} />
            </li>
          ))}
        </ol>
      </div>
    </>
  );
};

export const TvErrorPage: React.FC<{ message?: string }> = ({ message = '404. Page not found.' }) => (
  <>
    <AssertiveAlert alert={message} />
    <div className="wtv-page-error__container">
      <div className="wtv-page-error__contentContainer">
        <TvIcon className="wtv-page-error__errorIcon" id="error" />
        <h1 className="wtv-page-error__errorMessage" aria-hidden>{message}</h1>
      </div>
    </div>
  </>
);

/** No finished video in any project yet: Willow TV has nothing to play until there is one. */
export const TvEmptyPage: React.FC = () => (
  <>
    <AssertiveAlert alert="No videos yet" />
    <div className="wtv-page-error__container">
      <div className="wtv-page-error__contentContainer">
        <TvIcon className="wtv-page-error__errorIcon" id="no-results" />
        <h1 className="wtv-page-error__errorMessage">No videos yet. Make one in Willow and it plays here.</h1>
        <TvButtonOutline element="link" href="/media" isExternal height={40} {...OUTLINE}>Create with Willow</TvButtonOutline>
      </div>
    </div>
  </>
);
