// Flow TV's remote: Home and the playback buttons, the prompt behind the clip, the lightbox/grid
// toggle, and the channel changer, in the channel's colours (its palette's 700 to 500 shades).
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TV_CHANNELS, TV_SHORT_FILMS, PARAM_FILTER, PARAM_QUERY, tvClipPath, tvGridPath, tvSearchPath } from './tv-routes';
import { themeVars, type TvPaletteName } from './tv-theme';
import { CSS_EASE_OUT } from './tv-motion';
import type { TvMediaRef } from './tv-library';
import {
  PoliteAlert, SwapPresence, SyncPresence, TvButtonIcon, TvButtonOutline, TvIcon, TvImage, TvLink, TvVideo, WidthPresence, cx,
  type ButtonIconProps,
} from './TvPrimitives';
import {
  LOOP_ORDER, blurActive, formatChannelName, isTyping, useHotkey, useMediaQuery, useMediaUrl, useTvFullscreen, useTvIdle, useTvRemote, useTvShell,
  type ChannelLink, type TvView,
} from './TvState';

type RemoteColors = Pick<ButtonIconProps, 'colorIcon' | 'colorBackground' | 'colorBackgroundAlpha' | 'colorBackgroundHover' | 'colorBackgroundHoverAlpha' | 'colorBackgroundPressed' | 'colorBackgroundPressedAlpha'>;

/** The colours every remote button wears: the channel's, or translucent black over fullscreen video. */
function remoteColors(theme: TvPaletteName, fullscreen: boolean): RemoteColors {
  return {
    colorIcon: 'white',
    colorBackground: fullscreen ? 'off-black' : `${theme}-700`,
    colorBackgroundAlpha: fullscreen ? 0.25 : undefined,
    colorBackgroundHover: fullscreen ? 'white' : `${theme}-600`,
    colorBackgroundHoverAlpha: fullscreen ? 0.05 : undefined,
    colorBackgroundPressed: fullscreen ? 'white' : `${theme}-500`,
    colorBackgroundPressedAlpha: fullscreen ? 0.1 : undefined,
  };
}

const SMALL = { containerSize: 38, containerSizeMobileLarge: 37, containerSizeMobile: 30 } as const;

const HomeButton: React.FC<{ theme: TvPaletteName; view: TvView }> = ({ theme, view }) => {
  const { blockRoutingRef } = useTvRemote();
  const { fullscreen } = useTvFullscreen();
  const films = view === 'channel-short-film-generation';
  return (
    <TvButtonIcon
      className="wtv-controls__button"
      data-is-home
      element="link"
      shape="oval"
      href={films ? TV_SHORT_FILMS : TV_CHANNELS}
      {...remoteColors(theme, fullscreen)}
      colorIcon="white"
      containerSize={87}
      containerSizeMobileLarge={64}
      containerSizeMobile={48}
      containerHeight={83}
      containerHeightMobileLarge={64}
      containerHeightMobile={48}
      containerBorderRadius={37}
      containerBorderRadiusMobileLarge={28}
      containerBorderRadiusMobile={20}
      iconSize={42}
      iconSizeMobileLarge={38}
      iconSizeMobile={28}
      icon="home"
      tooltip={films ? 'All Short Films' : 'All Channels'}
      title={films ? 'Go to all short films' : 'Go to all channels'}
      onClick={() => { blockRoutingRef.current = true; }}
    />
  );
};

const StepButton: React.FC<{ theme: TvPaletteName; view: TvView; dir: 1 | -1 }> = ({ theme, view, dir }) => {
  const { isTransitioning, channelGenerationProps: gen, goToNextChannelGeneration, goToPreviousChannelGeneration } = useTvRemote();
  const { hasOpenDialog } = useTvShell();
  const { fullscreen } = useTvFullscreen();
  const step = useCallback(() => (dir > 0 ? goToNextChannelGeneration() : goToPreviousChannelGeneration()), [dir, goToNextChannelGeneration, goToPreviousChannelGeneration]);
  useHotkey(dir > 0 ? 'ArrowRight' : 'ArrowLeft', () => {
    if (isTyping()) return;
    step();
    blurActive();
  }, { isEnabled: !hasOpenDialog });
  const films = view === 'channel-short-film-generation';
  const lone = view === 'channel-search-generation' && !gen?.previousGenerationId && !gen?.nextGenerationId;
  return (
    <TvButtonIcon
      className="wtv-controls__button"
      {...(dir > 0 ? { 'data-is-next': true } : { 'data-is-previous': true })}
      shape="circle"
      {...remoteColors(theme, fullscreen)}
      isDisabled={isTransitioning || lone}
      colorIconDisabled="white"
      colorIconDisabledAlpha={0.25}
      colorBackgroundDisabled={fullscreen ? 'off-black' : `${theme}-700`}
      colorBackgroundDisabledAlpha={fullscreen ? 0.25 : 0.3}
      {...SMALL}
      iconSize={20}
      iconSizeMobileLarge={20}
      iconSizeMobile={16}
      icon={dir > 0 ? 'skip-next' : 'skip-previous'}
      tooltip={dir > 0 ? (films ? 'Next Short Film' : 'Next Clip') : films ? 'Previous Short Film' : 'Previous Clip'}
      title={dir > 0 ? (films ? 'Go to next short film' : 'Go to next video') : films ? 'Go to previous short film' : 'Go to previous video'}
      onClick={step}
    />
  );
};

const PlaybackButton: React.FC<{ theme: TvPaletteName }> = ({ theme }) => {
  const { paused, setPaused } = useTvRemote();
  const { hasOpenDialog } = useTvShell();
  const { fullscreen } = useTvFullscreen();
  const toggle = useCallback(() => setPaused((p) => !p), [setPaused]);
  useHotkey('Space', (e) => {
    if (isTyping()) return;
    e.preventDefault();
    toggle();
    blurActive();
  }, { isEnabled: !hasOpenDialog });
  return (
    <>
      <TvButtonIcon
        className="wtv-controls__button"
        data-is-playback
        shape="circle"
        {...remoteColors(theme, fullscreen)}
        {...SMALL}
        iconSize={20}
        iconSizeMobileLarge={20}
        iconSizeMobile={16}
        icon={paused ? 'play' : 'pause'}
        animateIconChanges
        tooltip={paused ? 'Play' : 'Pause'}
        title={paused ? 'Play video' : 'Pause video'}
        onClick={toggle}
      />
      <PoliteAlert alert={paused ? 'Paused' : 'Playing'} />
    </>
  );
};

function loopFace(view: TvView, loop: string): { icon: 'laps' | 'repeat-one'; tooltip: string; title: string } {
  if (view === 'channel-grid') return { icon: 'laps', tooltip: loop === 'off' ? 'Loop Channel' : 'Unloop', title: loop === 'off' ? 'Loop all channel videos' : 'Unloop channel videos' };
  if (view === 'channel-short-film-generation') {
    return { icon: 'laps', tooltip: loop === 'off' ? 'Loop Short Film' : 'Play All Short Films', title: loop === 'off' ? 'Loop current short film' : 'Unloop current short film' };
  }
  if (view === 'channel-search-generation') return { icon: 'repeat-one', tooltip: loop === 'off' ? 'Repeat Video' : 'Unloop', title: loop === 'off' ? 'Loop current video' : 'Unloop current video' };
  if (loop === 'loop-channel') return { icon: 'laps', tooltip: 'Repeat Video', title: 'Loop current video' };
  if (loop === 'loop-generation') return { icon: 'repeat-one', tooltip: 'Unloop', title: 'Unloop current video' };
  return { icon: 'laps', tooltip: 'Loop Channel', title: 'Loop all channel videos' };
}

const LoopButton: React.FC<{ theme: TvPaletteName; view: TvView }> = ({ theme, view }) => {
  const { loop, setLoop } = useTvRemote();
  const { fullscreen: fs } = useTvFullscreen();
  const { icon, tooltip, title } = loopFace(view, loop);
  const on = loop !== 'off';
  const toggle = useCallback(() => {
    setLoop((prev) => {
      if (view === 'channel-grid' || view === 'channel-short-film-generation') return prev === 'off' ? 'loop-generation' : 'off';
      if (view === 'channel-generation') return LOOP_ORDER[(LOOP_ORDER.indexOf(prev) + 1) % LOOP_ORDER.length] ?? 'off';
      return prev === 'loop-generation' ? 'off' : 'loop-generation';
    });
  }, [setLoop, view]);
  return (
    <>
      <TvButtonIcon
        className="wtv-controls__button"
        data-is-loop
        shape="circle"
        colorIcon={on ? (fs ? 'off-black' : `${theme}-700`) : 'white'}
        colorIconAlpha={fs ? 0.9 : undefined}
        colorBackground={on ? (fs ? 'white' : `${theme}-200`) : fs ? 'off-black' : `${theme}-700`}
        colorBackgroundAlpha={on ? (fs ? 0.75 : undefined) : fs ? 0.25 : undefined}
        colorBackgroundHover={on ? (fs ? 'white' : `${theme}-100`) : fs ? 'white' : `${theme}-600`}
        colorBackgroundHoverAlpha={on ? (fs ? 0.9 : undefined) : fs ? 0.05 : undefined}
        colorBackgroundPressed={on ? (fs ? 'white' : `${theme}-200`) : fs ? 'white' : `${theme}-500`}
        colorBackgroundPressedAlpha={on ? (fs ? 1 : undefined) : fs ? 0.1 : undefined}
        {...SMALL}
        iconSize={icon === 'repeat-one' ? 22 : 20}
        iconSizeMobileLarge={icon === 'repeat-one' ? 22 : 20}
        iconSizeMobile={icon === 'repeat-one' ? 18 : 16}
        icon={icon}
        animateIconChanges
        tooltip={tooltip}
        title={title}
        onClick={toggle}
      />
      <PoliteAlert alert={loop === 'off' ? 'Mixing' : 'Looping'} />
    </>
  );
};

const AudioButton: React.FC<{ theme: TvPaletteName; channelHasAudio: boolean }> = ({ theme, channelHasAudio }) => {
  const { channelGenerationProps: gen, muted, setMuted } = useTvRemote();
  const { fullscreen } = useTvFullscreen();
  const voiced = (gen ? gen.videoHasAudio : false) || channelHasAudio;
  return (
    <>
      <TvButtonIcon
        className="wtv-controls__button"
        data-is-audio
        shape="circle"
        {...remoteColors(theme, fullscreen)}
        {...SMALL}
        iconSize={voiced ? 26 : 22}
        iconSizeMobileLarge={voiced ? 26 : 22}
        iconSizeMobile={voiced ? 22 : 18}
        icon={muted ? (voiced ? 'volume-off-spark' : 'music-off') : voiced ? 'volume-up-spark' : 'music-on'}
        tooltip={muted ? 'Unmute' : 'Mute'}
        title={muted ? 'Unmute video' : 'Mute video'}
        onClick={() => setMuted((m) => !m)}
      />
      <PoliteAlert alert={muted ? 'Muted' : 'Unmuted'} />
    </>
  );
};

const FullscreenButton: React.FC<{ theme: TvPaletteName }> = ({ theme }) => {
  const { fullscreen, toggleFullscreen } = useTvFullscreen();
  return (
    <>
      <TvButtonIcon
        className="wtv-controls__button"
        data-is-fullscreen
        shape="circle"
        {...remoteColors(theme, fullscreen)}
        {...SMALL}
        iconSize={20}
        iconSizeMobileLarge={20}
        iconSizeMobile={16}
        icon={fullscreen ? 'fullscreen-collapse' : 'fullscreen-expand'}
        animateIconChanges
        tooltip={fullscreen ? 'Exit Full Screen' : 'Full Screen'}
        title={fullscreen ? 'Exit fullscreen' : 'Go fullscreen'}
        onClick={toggleFullscreen}
      />
      <PoliteAlert alert={fullscreen ? 'Now fullscreen' : 'Exited fullscreen'} />
    </>
  );
};

const ShareButton: React.FC<{ theme: TvPaletteName }> = ({ theme }) => {
  const { setIsShareDialogOpen } = useTvRemote();
  const { fullscreen } = useTvFullscreen();
  return (
    <TvButtonIcon
      className="wtv-controls__button"
      data-is-share
      shape="circle"
      {...remoteColors(theme, fullscreen)}
      {...SMALL}
      iconSize={22}
      iconSizeMobileLarge={22}
      iconSizeMobile={18}
      icon="share"
      iconProps={{ className: 'wtv-controls__shareIcon' }}
      animateIconChanges
      tooltip="Share"
      title="Share"
      onClick={() => setIsShareDialogOpen(true)}
    />
  );
};

const Controls: React.FC<{ isVisible: boolean; theme: TvPaletteName; view: TvView; channelHasAudio: boolean }> = ({ isVisible, theme, view, channelHasAudio }) => {
  const { channelGenerationProps: gen } = useTvRemote();
  return (
    <WidthPresence show={isVisible} className="wtv-controls__container">
      <HomeButton theme={theme} view={view} />
      <div className="wtv-controls__controlsContainer" data-is-view-channels-grid={view === 'channel-grid'}>
        {gen && <StepButton theme={theme} view={view} dir={-1} />}
        <PlaybackButton theme={theme} />
        {gen && <StepButton theme={theme} view={view} dir={1} />}
        <LoopButton theme={theme} view={view} />
        <AudioButton theme={theme} channelHasAudio={channelHasAudio} />
        {gen && <FullscreenButton theme={theme} />}
        <ShareButton theme={theme} />
      </div>
    </WidthPresence>
  );
};

const ControlCheckbox: React.FC<{ theme: TvPaletteName; value: boolean; ariaLabel: string; onChange: (v: boolean) => void }> = ({ theme, value, ariaLabel, onChange }) => (
  <button
    className="wtv-control-checkbox__button"
    type="button"
    id="checkbox"
    role="checkbox"
    aria-checked={value}
    onClick={() => onChange(!value)}
    style={themeVars(theme, [100, 200, 600, 700]) as React.CSSProperties}
    aria-label={ariaLabel}
  >
    <span className="wtv-control-checkbox__toggleCircle" />
    <span className="wtv-control-checkbox__toggleCircleShadow" />
  </button>
);

/** Willow's Reuse Prompt opens the clip's project with its prompt in the composer, as Flow TV's opens Flow. */
const reusePromptHref = (projectId: string, prompt: string) =>
  `/media?${new URLSearchParams({ projectId, prompt }).toString()}`;

/** The scroll edges the prompt's blurred bands fade in at. */
function usePromptScroll(description: string, isEnabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);
  const [more, setMore] = useState(false);
  const check = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setMore(!(Math.ceil(el.scrollTop) >= el.scrollHeight - el.clientHeight));
  }, []);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [description]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !isEnabled) return;
    const onScroll = () => {
      setAtTop(!(el.scrollTop > 0));
      check();
    };
    el.addEventListener('scroll', onScroll);
    const ro = new ResizeObserver(() => {
      setMore(el.clientHeight < el.scrollHeight && !(Math.ceil(el.scrollTop) >= el.scrollHeight - el.clientHeight));
    });
    ro.observe(el);
    check();
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [isEnabled, check]);
  return { ref, scrolledFromTop: !atTop, canScrollMore: more, check };
}

const Blurs: React.FC = () => (
  <>
    <span className="wtv-video-data__blur" />
    <span className="wtv-video-data__blur" />
    <span className="wtv-video-data__blur" />
  </>
);

const VideoData: React.FC<{ show: boolean; theme: TvPaletteName; showReusePromptButton: boolean }> = ({ show, theme, showReusePromptButton }) => {
  const { channelGenerationProps: gen, isDataVisible, setIsDataVisible } = useTvRemote();
  const { fullscreen } = useTvFullscreen();
  const description = gen?.description ?? '';
  const hasFullVideo = gen?.hasFullVideo ?? false;
  const { ref, scrolledFromTop, canScrollMore, check } = usePromptScroll(description, isDataVisible);
  return (
    <WidthPresence show={show} className="wtv-video-data__container">
      <div className="wtv-video-data__toggleContainer">
        <SwapPresence as="span" swapKey={String(hasFullVideo)} className="wtv-video-data__toggleLabel" aria-hidden>
          {isDataVisible ? (hasFullVideo ? 'Hide Data' : 'Hide Prompt') : hasFullVideo ? 'Show Data' : 'Show Prompt'}
        </SwapPresence>
        <ControlCheckbox theme={theme} value={isDataVisible} ariaLabel="Show additional data" onChange={setIsDataVisible} />
      </div>
      <WidthPresence show={isDataVisible} className="wtv-video-data__promptContainer">
        {showReusePromptButton && description && gen && (
          <TvButtonIcon
            element="link"
            href={reusePromptHref(gen.projectId, description)}
            isExternal
            className="wtv-video-data__reusePromptButton"
            shape="oval"
            {...remoteColors(theme, fullscreen)}
            containerSize={28}
            containerHeight={34}
            containerBorderRadius={28}
            iconSize={18}
            icon="new-window"
            animateIconChanges
            tooltip="Reuse Prompt"
            title="Reuse Prompt"
          />
        )}
        <span className="wtv-video-data__backdropTop" data-is-visible={scrolledFromTop}><Blurs /></span>
        <span className="wtv-video-data__backdropBottom" data-is-visible={canScrollMore}><Blurs /></span>
        <div ref={ref} className="wtv-video-data__scrollContainer">
          <div className="wtv-video-data__contentOuterContainer">
            <SwapPresence swapKey={description} slide={10} className="wtv-video-data__contentInnerContainer" onEntered={() => requestAnimationFrame(check)}>
              <div className="wtv-video-data__contentHeaderContainer" data-has-full-video={hasFullVideo}>
                {hasFullVideo ? (
                  gen?.createdBy && <span className="wtv-video-data__author">{gen.createdBy}</span>
                ) : (
                  <>
                    {gen?.genType === 'Image to Video' && gen.thumb && <TvImage className="wtv-video-data__thumb" src={gen.thumb} />}
                    <span className="wtv-video-data__genType">
                      {gen?.genType ?? ''}
                      {gen?.modelName && <span className="wtv-tag__tag">{gen.modelName}</span>}
                    </span>
                  </>
                )}
              </div>
              <div className="wtv-video-data__description">{description}</div>
            </SwapPresence>
          </div>
        </div>
      </WidthPresence>
    </WidthPresence>
  );
};

/** On a phone held upright the prompt sits above the remote instead of in it. */
const VideoDataMobile: React.FC<{ theme: TvPaletteName; showReusePromptButton: boolean }> = ({ theme, showReusePromptButton }) => {
  const { channelGenerationProps: gen, isDataVisible, setIsDataVisible } = useTvRemote();
  const description = gen?.description ?? '';
  const hasFullVideo = gen?.hasFullVideo ?? false;
  const { ref, canScrollMore } = usePromptScroll(description, true);
  const style = { '--theme-background': themeVars(theme, [700])['--theme-700'], '--theme-text': '255,255,255' } as React.CSSProperties;
  return (
    <div className="wtv-video-data-mobile__container" style={style}>
      <button type="button" className="wtv-video-data-mobile__buttonToggle" onClick={() => setIsDataVisible((v) => !v)}>
        <TvIcon className="wtv-video-data-mobile__icon" id="chevron-up-small" data-is-prompt-visible={isDataVisible} />
        <span aria-hidden>{isDataVisible ? (hasFullVideo ? 'Hide Data' : 'Hide Prompt') : hasFullVideo ? 'Show Data' : 'Show Prompt'}</span>
      </button>
      {showReusePromptButton && description && isDataVisible && gen && (
        <TvButtonOutline
          element="link"
          href={reusePromptHref(gen.projectId, description)}
          isExternal
          className="wtv-video-data-mobile__reusePromptButton"
          height={40}
          heightMobile={32}
          fontMobile="sans-text-5"
          colorText="neutral-100"
          colorTextHover="neutral-100"
          colorBorder="white"
          colorBorderAlpha={0}
          colorBackground="white"
          colorBackgroundAlpha={0.05}
          colorBorderHover="white"
          colorBorderHoverAlpha={0}
          colorBackgroundPressedAlpha={0.05}
          colorBackgroundHover="white"
          colorBackgroundHoverAlpha={0.15}
          hasBackdropFilterBlur
        >
          <TvIcon className="wtv-video-data-mobile__icon" id="new-window" width={15} height={15} data-is-prompt-visible={isDataVisible} /> Reuse Prompt
        </TvButtonOutline>
      )}
      <div ref={ref} className="wtv-video-data-mobile__scrollContainer">
        {isDataVisible && (
          <div className="wtv-video-data-mobile__contentContainer" key={description} style={{ animation: 'wtv-fade-in 0.3s linear' }}>
            <div className="wtv-video-data-mobile__contentHeaderContainer" data-has-full-video={hasFullVideo}>
              {hasFullVideo ? (
                gen?.createdBy && <span className="wtv-video-data-mobile__author">{gen.createdBy}</span>
              ) : (
                <span className="wtv-video-data-mobile__genType">
                  {gen?.genType ?? ''}
                  {gen?.modelName && <span className="wtv-tag__tag">{gen.modelName}</span>}
                </span>
              )}
            </div>
            <div className="wtv-video-data-mobile__description">{description}</div>
          </div>
        )}
      </div>
      <div className="wtv-video-data-mobile__backdropTop"><span className="wtv-video-data-mobile__blur" /><span className="wtv-video-data-mobile__blur" /><span className="wtv-video-data-mobile__blur" /></div>
      <div className="wtv-video-data-mobile__backdropBottom" data-is-visible={canScrollMore}><span className="wtv-video-data-mobile__blur" /><span className="wtv-video-data-mobile__blur" /><span className="wtv-video-data-mobile__blur" /></div>
    </div>
  );
};

const ViewToggle: React.FC<{ show: boolean; view: TvView; slug: string; firstGenerationId: string }> = ({ show, view, slug, firstGenerationId }) => {
  const { blockRoutingRef, randomGenerationLoopRef } = useTvRemote();
  const common = {
    className: 'wtv-view-toggle__button',
    shape: 'circle' as const,
    element: 'link' as const,
    colorIcon: 'white',
    colorIconAlpha: 0.5,
    colorBackgroundHover: 'white',
    colorBackgroundHoverAlpha: 0.15,
    colorBackgroundPressedAlpha: 0.25,
    colorIconDisabled: 'white',
    containerSize: 38,
    iconSize: 22,
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (blockRoutingRef.current) e.preventDefault();
      blockRoutingRef.current = true;
      randomGenerationLoopRef.current = null;
    },
  };
  return (
    <WidthPresence show={show} className="wtv-view-toggle__outerContainer">
      <div className="wtv-view-toggle__innerContainer" data-view={view}>
        <TvButtonIcon {...common} href={tvClipPath(slug, firstGenerationId)} isDisabled={view === 'channel-generation'} icon="lightbox" tooltip="Lightbox View" title="Enter lightbox view" />
        <TvButtonIcon {...common} href={tvGridPath(slug)} isDisabled={view === 'channel-grid'} icon="grid" tooltip="Grid View" title="Enter grid view" />
      </div>
    </WidthPresence>
  );
};

/** A channel's thumbnail: its project's cover, or its first clip's first frame when it has none. */
export const ThumbAsset = React.forwardRef<HTMLSpanElement, { image: string | null; media: TvMediaRef | null; className?: string; style?: React.CSSProperties }>(
  ({ image, media, className, style }, ref) => {
    const src = useMediaUrl(image ? null : media);
    if (image) return <TvImage ref={ref} className={className} src={image} style={style} />;
    return (
      <span ref={ref} className={cx('wtv-asset__container', className)} style={style}>
        {src && (
          <TvVideo
            src={src}
            autoPlay={false}
            loop={false}
            onLoadedMetadata={(e) => { e.currentTarget.currentTime = Math.min(0.1, e.currentTarget.duration || 0); }}
          />
        )}
      </span>
    );
  },
);
ThumbAsset.displayName = 'ThumbAsset';

/** Flow TV's channel name: two lines, or a ticker when it is wider than the remote allows. */
const ChannelName: React.FC<{ channelName: string; updateWidth: (w: number) => void; containerRef: React.RefObject<HTMLDivElement | null> }> = ({ channelName, updateWidth, containerRef }) => {
  const measurer = useRef<HTMLSpanElement>(null);
  const [ticker, setTicker] = useState(false);
  const text = formatChannelName(channelName);
  useLayoutEffect(() => {
    if (!measurer.current || !containerRef.current) return;
    const w = measurer.current.offsetWidth;
    updateWidth(w);
    setTicker(w > containerRef.current.offsetWidth);
  }, [text, updateWidth, containerRef]);
  return (
    <div className={cx('wtv-channel-name__channelName', ticker && 'wtv-channel-name__ticker')}>
      <div>
        <span className="wtv-channel-name__nameMeasurer" ref={measurer}>{text}</span>
        {ticker && (
          <>
            <span className="wtv-channel-name__tickerText" aria-hidden>{text}</span>
            <span className="wtv-channel-name__tickerText" aria-hidden>{text}</span>
          </>
        )}
      </div>
    </div>
  );
};

const slideOut = (el: HTMLElement, down: boolean) => [
  el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: CSS_EASE_OUT, fill: 'forwards' }),
  el.animate([{ transform: 'translateY(0px)' }, { transform: `translateY(${down ? 10 : -10}px)` }], { duration: 500, easing: CSS_EASE_OUT, fill: 'forwards' }),
];
const slideIn = (el: HTMLElement, down: boolean) => [
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 250, easing: 'linear', fill: 'backwards' }),
  el.animate([{ transform: `translateY(${down ? -10 : 10}px)` }, { transform: 'translateY(0px)' }], { duration: 500, delay: 250, easing: CSS_EASE_OUT, fill: 'backwards' }),
];

const linkTo = (view: TvView, c: ChannelLink) => (view === 'channel-grid' ? tvGridPath(c.slug) : tvClipPath(c.slug, c.generationId));

const ChannelNav: React.FC<{
  view: TvView;
  previousChannel: ChannelLink | null;
  nextChannel: ChannelLink | null;
  thumb: string | null;
  thumbMedia: TvMediaRef | null;
  channelName: string;
  hasBackgroundBlur: boolean;
}> = ({ view, previousChannel, nextChannel, thumb, thumbMedia, channelName, hasBackgroundBlur }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { blockRoutingRef, randomGenerationLoopRef, disableChannelNavigation } = useTvRemote();
  const { hasOpenDialog } = useTvShell();
  const mobile = useMediaQuery('mobile');
  const inner = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [dir, setDir] = useState<'up' | 'down'>('up');
  const dirRef = useRef(dir);
  dirRef.current = dir;
  const params = new URLSearchParams(location.search);
  const changes = view === 'channel-grid' || view === 'channel-generation';
  const step = useCallback((to: ChannelLink | null, d: 'up' | 'down') => {
    if (isTyping()) return;
    blockRoutingRef.current = true;
    setDir(d);
    if (to) navigate(linkTo(view, to));
    blurActive();
  }, [blockRoutingRef, navigate, view]);
  useHotkey('ArrowUp', () => step(previousChannel, 'down'), { isEnabled: !hasOpenDialog && changes });
  useHotkey('ArrowDown', () => step(nextChannel, 'up'), { isEnabled: !hasOpenDialog && changes });
  const onArrow = (d: 'up' | 'down') => (e: React.MouseEvent<HTMLElement>) => {
    if (blockRoutingRef.current) e.preventDefault();
    blockRoutingRef.current = true;
    randomGenerationLoopRef.current = null;
    setDir(d);
  };
  const header = { 'channel-grid': 'CHANNEL', 'channel-generation': 'CHANNEL', 'channel-short-film-generation': 'SHORT FILM', 'channel-search-generation': 'SEARCH' }[view];
  const query = params.get(PARAM_QUERY);
  const viewAll = view === 'channel-short-film-generation' ? TV_SHORT_FILMS
    : view === 'channel-search-generation' ? (query ? tvSearchPath(query, params.get(PARAM_FILTER)) : TV_CHANNELS)
      : TV_CHANNELS;
  const leave = useCallback((el: HTMLElement) => slideOut(el, dirRef.current === 'down'), []);
  const enter = useCallback((el: HTMLElement) => {
    const anims = slideIn(el, dirRef.current === 'down');
    void Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => setDir('up'));
    return anims;
  }, []);
  const arrow = {
    shape: 'circle' as const,
    element: 'link' as const,
    iconProps: { className: 'wtv-channel-nav__icon' },
    colorIcon: 'white',
    colorIconDisabled: 'white',
    colorIconDisabledAlpha: 0.25,
    containerSize: 20,
    containerSizeMobileLarge: 24,
    containerSizeMobile: 20,
    iconSize: 18,
    iconSizeMobileLarge: 18,
    iconSizeMobile: 16,
  };
  const thumbKey = thumb ?? thumbMedia?.id ?? 'none';
  return (
    <div className="wtv-channel-nav__container" data-view={view} data-has-background-blur={hasBackgroundBlur}>
      <p className="wtv-channel-nav__header">{header}</p>
      <div className="wtv-channel-nav__thumbContainer">
        <TvLink className="wtv-channel-nav__thumbLink" href={viewAll} aria-label="View all" onClick={() => { blockRoutingRef.current = true; }}>
          <span className="wtv-channel-nav__thumbText" aria-hidden>
            {view === 'channel-short-film-generation' ? 'View All' : <>View<br />All</>}
          </span>
        </TvLink>
        <SyncPresence
          itemKey={thumbKey}
          leave={leave}
          enter={(el) => slideIn(el, dirRef.current === 'down')}
          render={(_key, ref) => (
            <ThumbAsset
              ref={ref}
              className={cx('wtv-channel-nav__thumb', dir === 'up' ? 'wtv-channel-nav__up' : 'wtv-channel-nav__down')}
              image={thumb}
              media={thumbMedia}
              style={{ opacity: 1, transform: 'translateY(0px)' }}
            />
          )}
        />
      </div>
      <div className="wtv-channel-nav__nameOuterContainer" style={{ width: mobile ? width + 58 : width, transition: 'width 0.5s cubic-bezier(0.26, 1, 0.48, 1)' }}>
        {changes && (
          <TvButtonIcon
            {...arrow}
            className="wtv-channel-nav__buttonPrev"
            href={previousChannel ? linkTo(view, previousChannel) : undefined}
            title="Go to previous channel"
            isDisabled={!previousChannel || disableChannelNavigation}
            icon={mobile ? 'chevron-left' : 'chevron-up'}
            onClick={onArrow('down')}
          />
        )}
        <div ref={inner} className="wtv-channel-nav__nameInnerContainer">
          <SyncPresence
            itemKey={channelName}
            leave={leave}
            enter={enter}
            render={(key, ref) => (
              <div ref={ref as React.Ref<HTMLDivElement>} className="wtv-channel-nav__name">
                <ChannelName channelName={key} updateWidth={setWidth} containerRef={inner} />
              </div>
            )}
          />
        </div>
        {changes && (
          <TvButtonIcon
            {...arrow}
            className="wtv-channel-nav__buttonNext"
            href={nextChannel ? linkTo(view, nextChannel) : undefined}
            title="Go to next channel"
            isDisabled={!nextChannel || disableChannelNavigation}
            icon={mobile ? 'chevron-right' : 'chevron-down'}
            onClick={onArrow('up')}
          />
        )}
      </div>
    </div>
  );
};

const ShareTablet: React.FC<{ theme: TvPaletteName }> = ({ theme }) => {
  const { setIsShareDialogOpen } = useTvRemote();
  const { fullscreen } = useTvFullscreen();
  return (
    <div className="wtv-button-share-tablet__container">
      <TvButtonIcon
        shape="oval"
        {...remoteColors(theme, fullscreen)}
        containerSize={38}
        containerHeight={50}
        containerBorderRadius={28}
        iconSize={22}
        icon="share"
        iconProps={{ className: 'wtv-button-share-tablet__icon' }}
        animateIconChanges
        tooltip="Share"
        title="Share"
        onClick={() => setIsShareDialogOpen(true)}
      />
    </div>
  );
};

/** Flow TV's remote, for whichever channel is showing. */
export const TvRemote: React.FC = () => {
  const { view, channelProps: ch, channelGenerationProps: gen } = useTvRemote();
  const { isIdle } = useTvIdle();
  const { fullscreen } = useTvFullscreen();
  const { setPageTheme } = useTvShell();
  const [collapsed, setCollapsed] = useState(false);
  const mobile = useMediaQuery('mobile');
  const portrait = useMediaQuery('portrait');
  if (!fullscreen && collapsed) setCollapsed(false);
  const theme = ch?.colorTheme ?? 'purple';
  useEffect(() => {
    if (!ch) return;
    setPageTheme(ch.colorTheme);
    return () => setPageTheme(null);
  }, [ch, setPageTheme]);
  if (!view || !ch) return null;
  const films = view === 'channel-short-film-generation';
  return (
    <>
      {!fullscreen && mobile && portrait && gen && <VideoDataMobile theme={theme} showReusePromptButton={!films} />}
      <div
        className="wtv-tv-remote__outerContainer"
        data-is-idle={isIdle}
        data-is-collapsed={collapsed}
        data-video-has-controls={gen ? gen.videoHasControls : undefined}
        style={themeVars(theme, [100, 500, 600, 700]) as React.CSSProperties}
        onMouseEnter={() => setCollapsed(false)}
        onMouseLeave={() => setCollapsed(true)}
      >
        <div className="wtv-tv-remote__innerContainer">
          <Controls isVisible={(fullscreen && !collapsed) || !fullscreen} theme={theme} view={view} channelHasAudio={ch.hasAudio} />
          <VideoData show={(fullscreen && !collapsed) || (!fullscreen && view !== 'channel-grid')} theme={theme} showReusePromptButton={!films} />
          {ch.firstGenerationId && (
            <ViewToggle
              show={(view === 'channel-grid' || view === 'channel-generation') && !fullscreen && !mobile}
              view={view}
              slug={ch.slug}
              firstGenerationId={ch.firstGenerationId}
            />
          )}
          <ChannelNav
            view={view}
            previousChannel={ch.previousChannel}
            nextChannel={ch.nextChannel}
            thumb={films && gen?.thumb ? gen.thumb : ch.thumb}
            thumbMedia={ch.thumbMedia}
            channelName={films ? gen?.title ?? '' : ch.name}
            hasBackgroundBlur={collapsed && fullscreen}
          />
        </div>
        <ShareTablet theme={theme} />
      </div>
      {fullscreen && (
        <div className="wtv-tv-remote__exitFullScreenOverlay">
          <TvButtonIcon
            className="wtv-tv-remote__buttonArrowBack"
            shape="circle"
            icon="arrow-back"
            colorIcon="white"
            colorBackgroundHover="white"
            colorBackgroundHoverAlpha={0.15}
            colorBackgroundPressedAlpha={0.25}
            hasBackdropFilterBlurOnHover
            containerSize={40}
            iconSize={24}
            title="Exit fullscreen"
            onClick={() => void document.exitFullscreen().catch(() => undefined)}
          />
        </div>
      )}
    </>
  );
};
