// Flow TV's channel pages: a clip big (the lightbox), a channel's clips together (the grid), and
// how one becomes the next: a fade within a channel, Flow TV's shader when the channel changes,
// the grid tile growing into the lightbox. Short films play through Scenebuilder's ScenePlayer.
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import noiseUrl from '@willow/assets/tv/noise.png';
import { ScenePlayer, type PlayerClip } from '../scenes/scene-player';
import { channelBySlug, searchGenerations, type TvChannel, type TvGeneration, type TvLibrary, type TvMediaRef, type TvShortFilm } from './tv-library';
import { EASE_IN_OUT_1, EASE_IN_OUT_2, EASE_LINEAR, CSS_EASE_OUT, TweenValue } from './tv-motion';
import {
  channelPropsFor, filmChannelProps, filmGenerationProps, generationPropsFor, nextRandomFor, searchChannelProps, searchGenerationProps,
} from './tv-props';
import { PARAM_FILTER, PARAM_QUERY, PARAM_RANDOM, SEARCH_SLUG, SHORT_FILMS_SLUG, parseTvPath, tvClipPath, type TvRoute } from './tv-routes';
import { ChannelShaderRenderer } from './tv-shader';
import { AssertiveAlert, TvButtonIcon, TvButtonOutline, TvIcon, TvLink, TvVideo } from './TvPrimitives';
import { TvRemote } from './TvRemote';
import {
  formatChannelName, isTyping, useHotkey, useMediaQuery, useMediaUrl, useTvFullscreen, useTvIdle, useTvLibrary, useTvRemote, useTvShaderTransition,
  type ChannelProps, type GenerationProps, type TvView,
} from './TvState';

/* ---- presence: each route's page stays until its way out is done ---- */

type PresenceHandler = (current: TvRoute, previous: TvRoute | null) => Promise<void> | void;

interface PresenceValue {
  present: boolean;
  current: TvRoute;
  previous: TvRoute | null;
  onExit: (h: PresenceHandler) => () => void;
}

const PresenceContext = createContext<PresenceValue | null>(null);

const usePresence = (): PresenceValue => {
  const v = useContext(PresenceContext);
  if (!v) throw new Error('usePresence outside ChannelRouterTransition');
  return v;
};

/** Runs once the page is in, with the route it came from (Flow TV's enter hook). */
function useEnter(handler: PresenceHandler) {
  const ctx = usePresence();
  const done = useRef(false);
  const latest = useRef(handler);
  latest.current = handler;
  useLayoutEffect(() => {
    if (!ctx.present) {
      done.current = false;
      return;
    }
    if (done.current) return;
    done.current = true;
    void latest.current(ctx.current, ctx.previous);
  }, [ctx.present, ctx.current, ctx.previous]);
}

/** Runs when the page is on its way out; it stays until the promise settles (Flow TV's exit hook). */
function useExit(handler: PresenceHandler) {
  const ctx = usePresence();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => ctx.onExit((c, p) => latest.current(c, p)), [ctx]);
}

interface Slot {
  key: string;
  location: Location;
  present: boolean;
}

const PresenceSlot: React.FC<{ present: boolean; current: TvRoute; previous: TvRoute | null; onRemoved: () => void; children: React.ReactNode }> = ({ present, current, previous, onRemoved, children }) => {
  const handlers = useRef(new Set<PresenceHandler>());
  const value = useMemo<PresenceValue>(() => ({
    present,
    current,
    previous,
    onExit: (h) => {
      handlers.current.add(h);
      return () => { handlers.current.delete(h); };
    },
  }), [present, current, previous]);
  const removed = useRef(onRemoved);
  removed.current = onRemoved;
  useEffect(() => {
    if (present) return;
    let live = true;
    void Promise.all([...handlers.current].map((h) => Promise.resolve(h(current, previous)).catch(() => undefined))).then(() => {
      if (live) removed.current();
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
};

/** Flow TV's ChannelRouterTransition: the old page and the new one share a grid cell until the old has gone. */
const ChannelRouterTransition: React.FC<{ render: (location: Location) => React.ReactNode }> = ({ render }) => {
  const location = useLocation();
  const [slots, setSlots] = useState<Slot[]>(() => [{ key: `${Date.now()}-${location.pathname}`, location, present: true }]);
  const [routes, setRoutes] = useState<{ current: TvRoute; previous: TvRoute | null }>(() => ({ current: parseTvPath(location.pathname), previous: null }));
  const live = slots.find((s) => s.present);
  if (live && live.location.pathname !== location.pathname) {
    setSlots((prev) => [...prev.map((s) => (s.present ? { ...s, present: false } : s)), { key: `${Date.now()}-${location.pathname}`, location, present: true }]);
    setRoutes({ current: parseTvPath(location.pathname), previous: parseTvPath(live.location.pathname) });
  } else if (live && live.location !== location) {
    setSlots((prev) => prev.map((s) => (s.present ? { ...s, location } : s)));
  }
  const remove = useCallback((key: string) => setSlots((prev) => prev.filter((s) => s.key !== key)), []);
  return (
    <div className="wtv-channel-router-transition__container">
      {slots.map((s) => (
        <PresenceSlot key={s.key} present={s.present} current={routes.current} previous={routes.previous} onRemoved={() => remove(s.key)}>
          {render(s.location)}
        </PresenceSlot>
      ))}
    </div>
  );
};

const clipOf = (r: TvRoute | null) => (r && r.kind === 'clip' ? r : null);

/** Flow TV's shader runs when a channel changes, from one clip to another, unless it is Mixing. */
const changesChannel = (current: TvRoute, previous: TvRoute | null) => {
  const to = clipOf(current);
  const from = clipOf(previous);
  return !!to && !!from && to.slug !== from.slug && new URLSearchParams(window.location.search).get(PARAM_RANDOM) !== 'true';
};

/* ---- the grid tile that grows into the lightbox ---- */

interface Flip {
  from: HTMLElement;
  loaded: Set<() => void>;
}

const FlipContext = createContext<React.MutableRefObject<Flip | null> | null>(null);
const useFlip = () => {
  const v = useContext(FlipContext);
  if (!v) throw new Error('useFlip outside TvChannelLayout');
  return v;
};

/** Sets the remote's view and props while this page is the one showing (Flow TV's props setters). */
function useRemoteProps(view: TvView, channel: ChannelProps, gen: GenerationProps | null) {
  const { present } = usePresence();
  const { setView, setChannelProps, setChannelGenerationProps } = useTvRemote();
  useEffect(() => {
    if (!present) return;
    setView(view);
    setChannelProps(channel);
    setChannelGenerationProps(gen);
  }, [present, view, channel, gen, setView, setChannelProps, setChannelGenerationProps]);
}

/* ---- the shader ---- */

/** Flow TV's ChannelShaderTransition: swirl and blur the old clip, dissolve into the new, settle. */
const ChannelShaderTransition: React.FC<{ className: string; onTransitionComplete: () => void; children: React.ReactNode }> = ({ className, onTransitionComplete, children }) => {
  const { currentVideo, nextVideo } = useTvShaderTransition();
  const { setDisableChannelNavigation } = useTvRemote();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nextRef = useRef(nextVideo);
  nextRef.current = nextVideo;
  const values = useMemo(() => ({ blur: new TweenValue(0), strength: new TweenValue(0), crossFade: new TweenValue(0) }), []);
  const [dissolving, setDissolving] = useState(false);
  const [settling, setSettling] = useState(false);
  const complete = useRef(onTransitionComplete);
  complete.current = onTransitionComplete;
  const finishing = settling && !!nextVideo;

  useEffect(() => () => { values.blur.stop(); values.strength.stop(); values.crossFade.stop(); }, [values]);

  useEffect(() => {
    if (!currentVideo || !containerRef.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    const waitForNext = (src: string | undefined) => {
      if (!live) return;
      if (src && nextRef.current?.src && src === nextRef.current.src) setDissolving(true);
      else {
        const now = nextRef.current?.src;
        timer = setTimeout(() => waitForNext(now), 750);
      }
    };
    values.blur.set(0);
    const startSrc = nextRef.current?.src;
    void values.strength.to(1, { duration: 2, delay: 0.05, ease: EASE_IN_OUT_1 });
    void values.blur.to(1, { duration: 1, ease: EASE_IN_OUT_2 }).then(() => waitForNext(startSrc));
    const raf = requestAnimationFrame(() => { if (containerRef.current) containerRef.current.style.opacity = '1'; });
    return () => {
      live = false;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [currentVideo, values]);

  useEffect(() => {
    if (!dissolving) return;
    setDisableChannelNavigation(true);
    void values.crossFade.to(1, { duration: 2.5, ease: EASE_LINEAR });
    const t = setTimeout(() => setSettling(true), 500);
    return () => clearTimeout(t);
  }, [dissolving, values, setDisableChannelNavigation]);

  useEffect(() => {
    if (!finishing) return;
    let live = true;
    void values.strength.to(0, { duration: 2.5, ease: EASE_IN_OUT_1 });
    void values.blur.to(0, { duration: 1, delay: 1.5, ease: EASE_LINEAR }).then(() => {
      if (!live) return;
      complete.current();
      setDisableChannelNavigation(false);
    });
    return () => { live = false; };
  }, [finishing, values, setDisableChannelNavigation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !currentVideo || !nextVideo) return;
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;
    let renderer: ChannelShaderRenderer;
    try {
      renderer = new ChannelShaderRenderer(canvas, currentVideo, () => nextRef.current, () => ({
        strength: values.strength.value,
        crossFade: values.crossFade.value,
        blur: values.blur.value,
      }), noiseUrl);
    } catch (e) {
      console.error(e);
      return;
    }
    renderer.start();
    return () => renderer.dispose();
  }, [currentVideo, nextVideo, values]);

  return (
    <div ref={containerRef} data-step-2-complete={settling} className={`wtv-channel-shader-transition__container ${className}`}>
      <canvas ref={canvasRef} className="wtv-channel-shader-transition__canvas" />
      {children}
    </div>
  );
};

/* ---- what sits on the video ---- */

/** Shows `render`'s element, fading it in and out (motion's presence around an opacity animation). */
const FadePresence: React.FC<{ show: boolean; enterDelay?: number; render: (ref: React.Ref<HTMLElement>) => React.ReactNode }> = ({ show, enterDelay = 0, render }) => {
  const ref = useRef<HTMLElement>(null);
  const [rendered, setRendered] = useState(show);
  if (show && !rendered) setRendered(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (show) {
      el.getAnimations().forEach((a) => a.cancel());
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: enterDelay, easing: 'linear', fill: 'backwards' });
      return;
    }
    const out = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'linear', fill: 'forwards' });
    let live = true;
    void out.finished.then(() => { if (live) setRendered(false); }, () => undefined);
    return () => { live = false; };
  }, [show, rendered, enterDelay]);
  return rendered ? <>{render(ref)}</> : null;
};

/** The big play/pause in the middle: on a mouse while paused, on touch while the remote shows. */
const PlaybackOverlayButton: React.FC = () => {
  const { paused, setPaused } = useTvRemote();
  const { isIdle, checkIfIdle } = useTvIdle();
  const coarse = useMediaQuery('coarse');
  return (
    <FadePresence
      show={(coarse && !isIdle) || (!coarse && paused)}
      render={(ref) => (
        <TvButtonIcon
          ref={ref}
          className="wtv-button-playback__button"
          icon={paused ? 'play' : 'pause'}
          animateIconChanges
          colorIcon="white"
          colorBackground="off-black"
          colorBackgroundAlpha={0.25}
          colorBackgroundHover="white"
          colorBackgroundHoverAlpha={0.15}
          colorBackgroundPressedAlpha={0.25}
          containerSize={100}
          containerSizeMobile={60}
          iconSize={60}
          iconSizeMobile={38}
          title={paused ? 'Play' : 'Pause'}
          onClick={(e) => {
            e.stopPropagation();
            setPaused((p) => !p);
            checkIfIdle();
          }}
        />
      )}
    />
  );
};

const UnmuteButton: React.FC<{ show: boolean; hasControls: boolean }> = ({ show, hasControls }) => {
  const { enableAudio } = useTvRemote();
  return (
    <FadePresence
      show={show}
      render={(ref) => (
        <TvButtonOutline
          ref={ref}
          className="wtv-video__buttonUnmuteToPlayAudio"
          data-video-has-controls={hasControls}
          height={40}
          heightMobile={32}
          fontMobile="sans-text-6"
          colorText="neutral-100"
          colorTextHover="neutral-100"
          colorBorder="white"
          colorBorderAlpha={0.05}
          colorBackground="off-black"
          colorBackgroundAlpha={0.25}
          colorBorderHover="white"
          colorBorderHoverAlpha={0.05}
          colorBackgroundPressedAlpha={0.05}
          colorBackgroundHover="off-black"
          colorBackgroundHoverAlpha={0.15}
          hasBackdropFilterBlur
          onClick={enableAudio}
        >
          Unmute to hear audio
        </TvButtonOutline>
      )}
    />
  );
};

/** On a phone, a small fullscreen button sits on the video itself. */
const VideoFullscreenButton: React.FC = () => {
  const { fullscreen, toggleFullscreen } = useTvFullscreen();
  return (
    <TvButtonIcon
      className="wtv-button-fullscreen__button"
      shape="circle"
      icon="fullscreen-expand"
      colorIcon="white"
      colorBackground="off-black"
      colorBackgroundAlpha={0.25}
      colorBackgroundHover="off-black"
      colorBackgroundHoverAlpha={0.15}
      colorBackgroundPressedAlpha={0.05}
      containerSize={32}
      iconSize={18}
      title={fullscreen ? 'Exit fullscreen' : 'Go fullscreen'}
      onClick={toggleFullscreen}
    />
  );
};

/** What the scrub bar needs of a player: a <video>, or a short film's ScenePlayer. */
interface Playable {
  currentTime: number;
  readonly duration: number;
}

const pad = (n: number) => n.toString().padStart(2, '0');
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Flow TV's video controls: the time, and a scrub bar to click, drag, or step with the arrow keys. */
const VideoControls: React.FC<{ mediaRef: React.RefObject<Playable | null>; isVisible: boolean }> = ({ mediaRef, isVisible }) => {
  const { paused } = useTvRemote();
  const { isIdle, checkIfIdle } = useTvIdle();
  const { fullscreen } = useTvFullscreen();
  const coarse = useMediaQuery('coarse');
  const barRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const hoverRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const circleContainerRef = useRef<HTMLSpanElement>(null);
  const circleRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const fraction = useCallback((clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return clamp((clientX - r.x) / r.width);
  }, []);
  const stepBy = (seconds: number) => (e: KeyboardEvent) => {
    e.stopPropagation();
    checkIfIdle();
    const m = mediaRef.current;
    if (m) m.currentTime += e.shiftKey ? seconds * 2 : seconds;
  };
  useHotkey('ArrowLeft', stepBy(-5), { target: circleRef });
  useHotkey('ArrowRight', stepBy(5), { target: circleRef });
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 1000 / 30) return;
      last = now;
      const m = mediaRef.current;
      if (!m || !m.duration || !labelRef.current || !progressRef.current || !circleContainerRef.current) return;
      const t = m.currentTime;
      const d = m.duration;
      labelRef.current.textContent = `${pad(Math.floor(t / 60))}:${pad(Math.floor(t % 60))} / ${pad(Math.floor(d / 60))}:${pad(Math.floor(d % 60))}`;
      const p = t / d;
      progressRef.current.style.transform = `scaleX(${p})`;
      circleContainerRef.current.style.transform = `translateX(${100 * p}%)`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mediaRef]);
  const move = useCallback((e: PointerEvent) => {
    e.stopPropagation();
    checkIfIdle();
    const m = mediaRef.current;
    if (!m || !hoverRef.current) return;
    hoverRef.current.style.transform = `scaleX(${fraction(e.clientX)})`;
    if (dragging.current) m.currentTime = fraction(e.clientX) * m.duration;
  }, [checkIfIdle, mediaRef, fraction]);
  const stop = useCallback(() => {
    dragging.current = false;
    setIsDragging(false);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
  }, [move]);
  useEffect(() => stop, [stop]);
  return (
    <div className="wtv-video-controls__container" data-is-visible={coarse || fullscreen ? !isIdle : isVisible || isDragging || paused} style={{ animation: 'wtv-fade-in 0.2s linear 0.2s backwards' }}>
      <div className="wtv-video-controls__scrubBarAndVideoLengthContainer" aria-hidden>
        <span ref={labelRef} className="wtv-video-controls__videoLengthLabel">00:00 / 00:00</span>
        <span
          ref={barRef}
          className="wtv-video-controls__scrubBarContainer"
          onPointerMove={(e) => move(e.nativeEvent)}
          onPointerDown={(e) => {
            const m = mediaRef.current;
            if (!m) return;
            e.stopPropagation();
            checkIfIdle();
            m.currentTime = fraction(e.clientX) * m.duration;
            dragging.current = true;
            setIsDragging(true);
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', stop);
          }}
          onPointerUp={stop}
        >
          <span className="wtv-video-controls__scrubBar">
            <span ref={progressRef} className="wtv-video-controls__progressBar" />
            <span ref={hoverRef} className="wtv-video-controls__hoverBar" />
          </span>
          <span ref={circleContainerRef} className="wtv-video-controls__progressCircleContainer">
            <span ref={circleRef} className="wtv-video-controls__progressCircle" tabIndex={0} />
          </span>
        </span>
      </div>
    </div>
  );
};

/** Flow TV's WithAspectRatio: a 16:9 box as big as the space between the header and the remote allows. */
const AspectFrame = React.forwardRef<HTMLDivElement, { isIdle: boolean; onHover: (v: boolean) => void; children: React.ReactNode }>(({ isIdle, onHover, children }, ref) => (
  <div
    className="wtv-with-aspect-ratio__outerContainer wtv-video__outerContainer"
    data-is-idle={String(isIdle)}
    style={{
      '--aspect-ratio-width': 16,
      '--aspect-ratio-height': 9,
      '--max-height': 'var(--container-max-height)',
      '--min-height': '160px',
      '--max-width': 'var(--container-max-width)',
    } as React.CSSProperties}
  >
    <div className="wtv-with-aspect-ratio__middleContainer">
      <div ref={ref} className="wtv-with-aspect-ratio__innerContainer wtv-video__innerContainer" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
        {children}
      </div>
    </div>
  </div>
));
AspectFrame.displayName = 'AspectFrame';

const fadeIn = (el: HTMLElement) => {
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'linear' });
  el.style.opacity = '1';
};

const fadeOut = (el: HTMLElement) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'linear', fill: 'forwards' }).finished.catch(() => undefined);

/* ---- a clip ---- */

/** Flow TV's Video: one clip in the lightbox, and the way it comes and goes. */
const ClipVideo: React.FC<{ gen: GenerationProps; media: TvMediaRef; loops: boolean }> = ({ gen, media, loops }) => {
  const remote = useTvRemote();
  const { canPlayAudio, paused, loop, muted, channelProps, blockRoutingRef, isTransitioning, isShareDialogOpen, replayToken, setPaused, setIsTransitioning, goToNextChannelGeneration } = remote;
  const { isIdle } = useTvIdle();
  const { fullscreen } = useTvFullscreen();
  const shader = useTvShaderTransition();
  const flip = useFlip();
  const src = useMediaUrl(media);
  const innerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const loaded = useRef(false);
  const ended = useRef(false);
  const [showShader, setShowShader] = useState(false);
  const [hasFlip] = useState(() => flip.current !== null);
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [finishExit, setFinishExit] = useState<(() => void) | null>(null);
  const tablet = useMediaQuery('tablet');
  const fine = useMediaQuery('fine');
  const transitioning = useRef(isTransitioning);
  transitioning.current = isTransitioning;
  const looping = loop === 'loop-generation' || loops;

  const onLoad = useCallback(() => {
    if (loaded.current) return;
    loaded.current = true;
    setPaused(false);
    setReady(true);
    const f = flip.current;
    if (f) {
      for (const l of f.loaded) l();
      f.loaded.clear();
    }
  }, [setPaused, flip]);

  useEnter(async (current, previous) => {
    blockRoutingRef.current = false;
    const inner = innerRef.current;
    const v = videoRef.current;
    if (!inner || !v) return;
    const f = flip.current;
    if (f) {
      const from = f.from.getBoundingClientRect();
      await new Promise<void>((resolve) => {
        if (loaded.current) resolve();
        else f.loaded.add(resolve);
      });
      flip.current = null;
      const to = inner.getBoundingClientRect();
      f.from.style.visibility = 'hidden';
      inner.style.opacity = '1';
      inner.style.transformOrigin = 'top left';
      const grow = inner.animate([
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})` },
        { transform: 'translate(0px, 0px) scale(1, 1)' },
      ], { duration: 800, easing: CSS_EASE_OUT });
      await grow.finished.catch(() => undefined);
      inner.style.transformOrigin = '';
      return;
    }
    if (changesChannel(current, previous)) {
      shader.setNextVideo(v);
      setTimeout(() => { if (innerRef.current) innerRef.current.style.opacity = '1'; }, 1000);
      return;
    }
    fadeIn(inner);
  });

  useExit(async (current, previous) => {
    const inner = innerRef.current;
    const v = videoRef.current;
    if (!inner || !v || transitioning.current) return;
    if (changesChannel(current, previous)) {
      setIsTransitioning(true);
      setShowShader(true);
      shader.setCurrentVideo(v);
      await new Promise<void>((resolve) => setFinishExit(() => resolve));
      return;
    }
    await fadeOut(inner);
    v.removeAttribute('src');
    v.load();
  });

  const onTransitionComplete = useCallback(() => {
    setIsTransitioning(false);
    finishExit?.();
  }, [setIsTransitioning, finishExit]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !ready) return;
    if (paused || isShareDialogOpen) v.pause();
    else void v.play().catch(() => undefined);
  }, [ready, paused, isShareDialogOpen]);

  const silent = isTransitioning || !canPlayAudio || !gen.videoHasAudio || muted;
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = silent;
  }, [silent]);

  const firstReplay = useRef(replayToken);
  useEffect(() => {
    if (replayToken === firstReplay.current) return;
    const v = videoRef.current;
    if (!v) return;
    ended.current = false;
    v.currentTime = 0;
    void v.play().catch(() => undefined);
  }, [replayToken]);

  const name = useMemo(() => (channelProps ? formatChannelName(channelProps.name) : ''), [channelProps]);
  return (
    <AspectFrame ref={innerRef} isIdle={isIdle} onHover={setHovered}>
      {showShader && finishExit && shader.currentVideo && shader.currentVideo === videoRef.current && (
        <ChannelShaderTransition className="wtv-video__channelShaderTransition" onTransitionComplete={onTransitionComplete}>
          <p className="wtv-video__channelName">{name}</p>
        </ChannelShaderTransition>
      )}
      <TvVideo
        ref={videoRef}
        className="wtv-video__video"
        data-has-flip-transition={hasFlip}
        data-show-captions={false}
        loop={looping}
        src={src ?? undefined}
        muted={silent}
        autoPlay={false}
        onLoaded={onLoad}
        onTimeUpdate={(e) => {
          if (looping) return;
          const v = e.currentTarget;
          if (v.duration && v.currentTime >= v.duration - 0.5 && !ended.current) {
            ended.current = true;
            goToNextChannelGeneration(true);
          }
        }}
        onClick={() => { if (fine) setPaused((p) => !p); }}
      />
      <PlaybackOverlayButton />
      {gen.videoHasControls && <VideoControls mediaRef={videoRef} isVisible={hovered} />}
      {!tablet && !fullscreen && <VideoFullscreenButton />}
      <UnmuteButton show={!canPlayAudio && gen.videoHasAudio && !isTransitioning} hasControls={gen.videoHasControls} />
    </AspectFrame>
  );
};

/* ---- a short film ---- */

/** A scene, played as Flow TV plays a short film: through Scenebuilder's player, onto a canvas. */
const FilmVideo: React.FC<{ film: TvShortFilm; gen: GenerationProps }> = ({ film, gen }) => {
  const { canPlayAudio, paused, loop, muted, blockRoutingRef, isTransitioning, isShareDialogOpen, replayToken, setPaused, goToNextChannelGeneration } = useTvRemote();
  const { resolveUrl } = useTvLibrary();
  const { isIdle } = useTvIdle();
  const { fullscreen } = useTvFullscreen();
  const innerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const player = useMemo(() => new ScenePlayer(), []);
  const [clips, setClips] = useState<PlayerClip[] | null>(null);
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ended = useRef(false);
  const fine = useMediaQuery('fine');
  const tablet = useMediaQuery('tablet');
  const looping = loop === 'loop-generation';
  const playable = useMemo<Playable>(() => ({
    get currentTime() { return player.$time.get(); },
    set currentTime(t: number) { player.seek(t); },
    get duration() { return player.$state.get().duration; },
  }), [player]);
  const playableRef = useRef<Playable | null>(playable);

  useLayoutEffect(() => {
    player.attach(canvasRef.current);
    player.setAspect(film.aspectRatio);
    return () => player.dispose();
  }, [player, film.aspectRatio]);

  useEffect(() => {
    let live = true;
    void Promise.all(film.clips.map(async (c) => {
      const ref = film.media[c.mediaId];
      const url = ref ? await resolveUrl(ref) : null;
      return { id: c.id, trimStart: c.trimStart, trimEnd: c.trimEnd, url: url ?? undefined };
    })).then((list) => { if (live) setClips(list); });
    return () => { live = false; };
  }, [film, resolveUrl]);

  useEffect(() => {
    if (!clips) return;
    player.setClips(clips);
    setPaused(false);
    setReady(true);
  }, [clips, player, setPaused]);

  useEffect(() => {
    if (!ready) return;
    if (paused || isShareDialogOpen) player.pause();
    else player.play();
  }, [ready, paused, isShareDialogOpen, player]);

  useEffect(() => { player.setMuted(isTransitioning || !canPlayAudio || muted); }, [player, isTransitioning, canPlayAudio, muted]);
  useEffect(() => { player.setLoop(looping); }, [player, looping]);

  useEffect(() => player.$time.subscribe((t) => {
    const { duration } = player.$state.get();
    if (looping || !duration || ended.current || t < duration - 0.5) return;
    ended.current = true;
    goToNextChannelGeneration(true);
  }), [player, looping, goToNextChannelGeneration]);

  const firstReplay = useRef(replayToken);
  useEffect(() => {
    if (replayToken === firstReplay.current) return;
    ended.current = false;
    player.seek(0);
    player.play();
  }, [replayToken, player]);

  useEnter(() => {
    blockRoutingRef.current = false;
    if (innerRef.current) fadeIn(innerRef.current);
  });
  useExit(async () => {
    if (innerRef.current) await fadeOut(innerRef.current);
    player.pause();
  });

  return (
    <AspectFrame ref={innerRef} isIdle={isIdle} onHover={setHovered}>
      <canvas
        ref={canvasRef}
        className="wtv-asset__asset wtv-video__video"
        data-has-flip-transition={false}
        data-is-loaded={ready}
        style={{ objectFit: film.aspectRatio === '9:16' ? 'contain' : 'cover' }}
        onClick={() => { if (fine) setPaused((p) => !p); }}
      />
      <PlaybackOverlayButton />
      {gen.videoHasControls && <VideoControls mediaRef={playableRef} isVisible={hovered} />}
      {!tablet && !fullscreen && <VideoFullscreenButton />}
      <UnmuteButton show={!canPlayAudio && !isTransitioning} hasControls={gen.videoHasControls} />
    </AspectFrame>
  );
};

/* ---- the pages ---- */

const ClipPage: React.FC<{ channel: TvChannel; gen: TvGeneration }> = ({ channel, gen }) => {
  const { library } = useTvLibrary();
  const nextRandom = useMemo(() => (library ? nextRandomFor(library, gen) : null), [library, gen]);
  const channelProps = useMemo(() => channelPropsFor(library!, channel), [library, channel]);
  const genProps = useMemo(() => generationPropsFor(library!, channel, gen, nextRandom), [library, channel, gen, nextRandom]);
  useRemoteProps('channel-generation', channelProps, genProps);
  const lone = library!.channels.length === 1 && channel.generations.length === 1;
  return (
    <>
      <AssertiveAlert alert={`Navigated to video '${gen.prompt}'`} />
      <ClipVideo gen={genProps} media={gen.media} loops={lone} />
    </>
  );
};

const SearchClipPage: React.FC<{ results: TvGeneration[]; gen: TvGeneration; query: string }> = ({ results, gen, query }) => {
  const { library } = useTvLibrary();
  const channelProps = useMemo(() => searchChannelProps(library!, results, gen, query), [library, results, gen, query]);
  const genProps = useMemo(() => searchGenerationProps(library!, results, gen), [library, results, gen]);
  useRemoteProps('channel-search-generation', channelProps, genProps);
  return (
    <>
      <AssertiveAlert alert={`Navigated to video '${gen.prompt}'`} />
      <ClipVideo gen={genProps} media={gen.media} loops={results.length === 1} />
    </>
  );
};

const FilmPage: React.FC<{ film: TvShortFilm }> = ({ film }) => {
  const { library } = useTvLibrary();
  const channelProps = useMemo(() => filmChannelProps(library!, film), [library, film]);
  const genProps = useMemo(() => filmGenerationProps(library!, film), [library, film]);
  useRemoteProps('channel-short-film-generation', channelProps, genProps);
  return (
    <>
      <AssertiveAlert alert={`Navigated to short film '${film.name}'`} />
      <FilmVideo film={film} gen={genProps} />
    </>
  );
};

const GridItem: React.FC<{ channel: TvChannel; gen: TvGeneration; active: boolean; onActive: (id: string | null) => void }> = ({ channel, gen, active, onActive }) => {
  const { canPlayAudio, muted, paused, isShareDialogOpen } = useTvRemote();
  const flip = useFlip();
  const src = useMediaUrl(gen.media);
  const videoRef = useRef<HTMLVideoElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused || isShareDialogOpen) v.pause();
    else void v.play().catch(() => undefined);
  }, [paused, isShareDialogOpen, src]);
  const silent = !(active && canPlayAudio && !muted && gen.hasAudio);
  useEffect(() => { if (videoRef.current) videoRef.current.muted = silent; }, [silent]);
  return (
    <li
      className="wtv-grid-generations__gridItemContainer"
      data-is-active={active}
      data-modal-name={gen.hasAudio ? 'veo3' : 'veo2'}
      onMouseEnter={() => onActive(gen.id)}
      onMouseLeave={() => onActive(null)}
    >
      <TvLink
        ref={linkRef}
        className="wtv-grid-generations__videoContainer"
        href={tvClipPath(channel.slug, gen.id)}
        onClick={() => { if (linkRef.current) flip.current = { from: linkRef.current, loaded: new Set() }; }}
      >
        {src && <TvVideo ref={videoRef} className="wtv-grid-generations__video" src={src} muted={silent} />}
        {(paused || !gen.hasAudio) && <TvIcon className="wtv-grid-generations__playIcon" id="play" />}
      </TvLink>
    </li>
  );
};

/** A channel's clips together, in Flow TV's 3x3 grid (which scrolls when a project has more than nine). */
const GridPage: React.FC<{ channel: TvChannel }> = ({ channel }) => {
  const { library } = useTvLibrary();
  const { blockRoutingRef, paused } = useTvRemote();
  const flip = useFlip();
  const navigate = useNavigate();
  const mobile = useMediaQuery('mobile');
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const channelProps = useMemo(() => channelPropsFor(library!, channel), [library, channel]);
  useRemoteProps('channel-grid', channelProps, null);
  useEnter(() => { blockRoutingRef.current = false; });
  useExit(async () => {
    const el = ref.current;
    if (!el) return;
    const f = flip.current;
    if (f) await new Promise<void>((resolve) => f.loaded.add(resolve));
    await fadeOut(el);
  });
  useEffect(() => {
    if (mobile && channel.generations[0]) navigate(tvClipPath(channel.slug, channel.generations[0].id), { replace: true });
  }, [mobile, channel, navigate]);
  const rows = Math.ceil(channel.generations.length / 3);
  const scrolls = rows > 3;
  return (
    <>
      <AssertiveAlert alert={`Navigated to ${channel.name}`} />
      <div ref={ref} className="wtv-channel-grid__container" data-is-scrollable={scrolls}>
        {!mobile && (
          <ul
            className="wtv-grid-generations__container"
            data-has-active={active !== null}
            data-is-paused={paused}
            style={scrolls ? { gridTemplateRows: `repeat(${rows}, calc((100% - 10px) / 3))` } : undefined}
          >
            {channel.generations.map((g) => (
              <GridItem key={g.id} channel={channel} gen={g} active={active === g.id} onActive={setActive} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
};

type ChannelTarget =
  | { kind: 'grid'; channel: TvChannel }
  | { kind: 'clip'; channel: TvChannel; gen: TvGeneration }
  | { kind: 'search'; results: TvGeneration[]; gen: TvGeneration; query: string }
  | { kind: 'film'; film: TvShortFilm };

/** What a channel route shows, or null when there is no such channel, clip or film (a 404). */
export function resolveChannelRoute(library: TvLibrary, route: TvRoute, search: string): ChannelTarget | null {
  if (route.kind === 'grid') {
    const channel = channelBySlug(library, route.slug);
    return channel ? { kind: 'grid', channel } : null;
  }
  if (route.kind !== 'clip') return null;
  if (route.slug === SEARCH_SLUG) {
    const params = new URLSearchParams(search);
    const query = params.get(PARAM_QUERY) ?? '';
    const results = searchGenerations(library, query, params.get(PARAM_FILTER) ?? undefined);
    const gen = results.find((g) => g.id === route.id);
    return gen ? { kind: 'search', results, gen, query } : null;
  }
  if (route.slug === SHORT_FILMS_SLUG) {
    const film = library.shortFilms.find((f) => f.id === route.id);
    return film ? { kind: 'film', film } : null;
  }
  const channel = channelBySlug(library, route.slug);
  const gen = channel?.generations.find((g) => g.id === route.id);
  return channel && gen ? { kind: 'clip', channel, gen } : null;
}

const ChannelRoutePage: React.FC<{ location: Location }> = ({ location }) => {
  const { library } = useTvLibrary();
  const target = useMemo(
    () => (library ? resolveChannelRoute(library, parseTvPath(location.pathname), location.search) : null),
    [library, location.pathname, location.search],
  );
  if (!target) return null;
  if (target.kind === 'grid') return <GridPage channel={target.channel} />;
  if (target.kind === 'search') return <SearchClipPage results={target.results} gen={target.gen} query={target.query} />;
  if (target.kind === 'film') return <FilmPage film={target.film} />;
  return <ClipPage channel={target.channel} gen={target.gen} />;
};

/** Flow TV's channel layout: the page in the middle, the remote under it, kept while the clips change. */
export const TvChannelLayout: React.FC = () => {
  const flip = useRef<Flip | null>(null);
  const { setView, setChannelProps, setChannelGenerationProps } = useTvRemote();
  useEffect(() => () => {
    setView(null);
    setChannelProps(null);
    setChannelGenerationProps(null);
  }, [setView, setChannelProps, setChannelGenerationProps]);
  return (
    <FlipContext.Provider value={flip}>
      <div className="wtv-channel-layout__channelLayout">
        <ChannelRouterTransition render={(location) => <ChannelRoutePage location={location} />} />
        <TvRemote />
      </div>
    </FlipContext.Provider>
  );
};
