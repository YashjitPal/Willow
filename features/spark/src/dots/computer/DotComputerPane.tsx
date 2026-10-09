import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { CHROME_HEIGHT, SCREEN_HEIGHT, SCREEN_WIDTH } from '../../remote-browser/remote-browser-frames';
import { RemoteBrowserChrome, ViewerIcon } from '../../remote-browser/SparkRemoteBrowserPane';
import '../../remote-browser/SparkRemoteBrowserPane.css';
import './DotComputerPane.css';
import { useDotAccentVars } from '../dot-tint';
import { sparkDots } from '../dots-store';
import type { DotMachineShot } from '../harness/runtime/machine-bridge';
import { DotAgentCursor } from './DotAgentCursor';
import {
  dotComputerFrames,
  dotComputers,
  dotComputerView,
  handBackDotComputer,
  loadDotShot,
  refreshDotComputer,
  resetDotComputer,
  sendDotInput,
  setUpDotComputer,
  takeOverDotComputer,
  turnOffDotComputer,
  turnOnDotComputer,
  watchDotComputer,
  type DotComputerView,
} from './dot-computer-store';

/*
 * A bot's own computer, drawn exactly as Spark draws a task's remote browser
 * (SparkRemoteBrowserPane: Gemini's `computer-use-panel` > `vnc-viewer`) — the
 * 5:4 viewer, the loader, the scrim with its history and "Take over", and the
 * full-screen takeover. What fills the viewer is the machine's own screen, its
 * whole 1280×1024 desktop, live while the pane watches and as the step images
 * it keeps for the history; taking over drives all of it. A machine that
 * cannot have a desktop shows its browser's page in Spark's Chrome frame.
 */

const googleSymbol = (fill: 0 | 1, size: number, weight: number) => (
  `"FILL" ${fill}, "GRAD" 0, "ROND" 100, "opsz" ${size}, "wght" ${weight}`
);

const disclaimer = (name: string) => `${name}'s computer is separate from yours. You can watch it, take it over or turn it off; manage it in ${name}'s profile.`;

/** Gemini's row of history bots, at most this many, around the step on screen. */
const MAX_HISTORY_DOTS = 15;

const MemoChrome = React.memo(RemoteBrowserChrome);

const useShotImage = (dotId: string, shot: DotMachineShot | null) => {
  const [state, setState] = useState<{ id: string | null; url: string | null; missing: boolean }>({ id: null, url: null, missing: false });
  const shotId = shot?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!shot) {
      setState({ id: null, url: null, missing: false });
      return undefined;
    }
    void loadDotShot(dotId, shot).then((url) => {
      if (!cancelled) setState({ id: shot.id, url, missing: !url });
    });
    return () => {
      cancelled = true;
    };
    // Keyed on the id: the shot object is rebuilt with every history update.
  }, [dotId, shotId]);
  return state.id === shotId ? state : { id: shotId, url: null, missing: false };
};

const BUTTONS = ['left', 'middle', 'right'] as const;
const modifiersOf = (event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);

/**
 * The user's mouse and keyboard on the screen, by pixel and by key: the
 * screen's own coordinates, worked out from where the picture is drawn and how
 * large — the desktop's, or the page's under the Chrome frame.
 */
const useHumanInput = (dotId: string, pageRef: React.RefObject<HTMLDivElement | null>, active: boolean) => {
  const lastMove = useRef(0);
  const clicks = useRef({ at: 0, x: 0, y: 0, count: 0 });
  const wheel = useRef({ x: 0, y: 0, dx: 0, dy: 0, timer: 0 });
  const pointOf = (event: { clientX: number; clientY: number }) => {
    const rect = pageRef.current!.getBoundingClientRect();
    const ratio = SCREEN_WIDTH / rect.width;
    return { x: Math.round((event.clientX - rect.left) * ratio), y: Math.round((event.clientY - rect.top) * ratio) };
  };

  useEffect(() => {
    const page = pageRef.current;
    if (!page || !active) return undefined;
    page.focus({ preventScroll: true });
    // Wheel events are cancellable only through a listener that is not passive.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = wheel.current;
      const point = pointOf(event);
      state.x = point.x;
      state.y = point.y;
      state.dx += event.deltaX;
      state.dy += event.deltaY;
      if (state.timer) return;
      state.timer = window.setTimeout(() => {
        void sendDotInput(dotId, '/human/mouse', { type: 'wheel', x: state.x, y: state.y, deltaX: Math.round(state.dx), deltaY: Math.round(state.dy) });
        state.dx = 0;
        state.dy = 0;
        state.timer = 0;
      }, 50);
    };
    page.addEventListener('wheel', onWheel, { passive: false });
    return () => page.removeEventListener('wheel', onWheel);
  }, [active, dotId]);

  if (!active) return {};
  return {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = pointOf(event);
      const previous = clicks.current;
      const repeat = Date.now() - previous.at < 450 && Math.abs(previous.x - point.x) < 6 && Math.abs(previous.y - point.y) < 6;
      clicks.current = { at: Date.now(), ...point, count: repeat ? Math.min(3, previous.count + 1) : 1 };
      void sendDotInput(dotId, '/human/mouse', { type: 'down', ...point, button: BUTTONS[event.button] ?? 'left', buttons: event.buttons, clickCount: clicks.current.count, modifiers: modifiersOf(event) });
    },
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      void sendDotInput(dotId, '/human/mouse', { type: 'up', ...pointOf(event), button: BUTTONS[event.button] ?? 'left', buttons: event.buttons, clickCount: clicks.current.count, modifiers: modifiersOf(event) });
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (Date.now() - lastMove.current < 40) return;
      lastMove.current = Date.now();
      void sendDotInput(dotId, '/human/mouse', { type: 'move', ...pointOf(event), buttons: event.buttons, modifiers: modifiersOf(event) });
    },
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Paste arrives as text: the clipboard is this computer's, the page is the bot's.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
      event.preventDefault();
      const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
      void sendDotInput(dotId, '/human/key', {
        type: 'keyDown',
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        modifiers: modifiersOf(event),
        ...(printable ? { text: event.key } : event.key === 'Enter' ? { text: '\r' } : {}),
      });
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      void sendDotInput(dotId, '/human/key', { type: 'keyUp', key: event.key, code: event.code, keyCode: event.keyCode, modifiers: modifiersOf(event) });
    },
    onPaste: (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const text = event.clipboardData.getData('text/plain');
      if (text) void sendDotInput(dotId, '/human/text', { text });
    },
  };
};

/** The computer is off, or not set up: what the page area says instead of a picture. */
const DotComputerOff: React.FC<{ dotId: string; name: string; view: DotComputerView }> = ({ dotId, name, view }) => {
  const state = view.summary?.state ?? 'none';
  const setUp = state === 'none' || state === 'creating';
  const working = view.busy === 'setting-up' || view.busy === 'starting' || state === 'creating' || state === 'resetting' || state === 'stopping';
  const title = state === 'creating' || view.busy === 'setting-up'
    ? `Setting up ${name}'s computer…`
    : state === 'resetting'
      ? `Resetting ${name}'s computer…`
      : state === 'stopping'
        ? 'Turning off…'
        : setUp ? `${name} doesn't have a computer yet` : `${name}'s computer is off`;
  const progress = view.progress && working ? Math.round(view.progress.fraction * 100) : null;
  return (
    <div className="dot-computer__off">
      <div className="dot-computer__off-body">
        <span className="dot-computer__off-icon">
          <MaterialSymbol family="google-symbols" name="monitor" size={20} weight={300} variationSettings={googleSymbol(0, 20, 300)} />
        </span>
        <span className="dot-computer__off-title">{title}</span>
        {progress !== null ? (
          <span className="dot-computer__off-text">{view.progress?.detail ?? ''} · {progress}%</span>
        ) : (
          <span className="dot-computer__off-text">{setUp ? 'Its own account on a Linux computer on this PC, with a desktop, a browser, files and a shell.' : 'It turns on by itself when it is needed.'}</span>
        )}
        {!working && (
          <button
            type="button"
            className="dot-computer__off-action"
            onClick={() => void (setUp ? setUpDotComputer(dotId) : turnOnDotComputer(dotId))}
          >
            {setUp ? 'Set up' : 'Turn on'}
          </button>
        )}
        {view.problem && <span className="dot-computer__off-problem" role="alert">{view.problem}</span>}
      </div>
    </div>
  );
};

/** `.iframe-container`: the 5:4 viewer with its scrim, history and loader, over the bot's screen. */
const DotComputerViewer: React.FC<{
  dotId: string;
  name: string;
  interactive: boolean;
  onTakeOver?: () => void;
}> = ({ dotId, name, interactive, onTakeOver }) => {
  const view = useStore(dotComputers, { keys: [dotId] })[dotId] ?? dotComputerView(dotId);
  const live = useStore(dotComputerFrames, { keys: [dotId] })[dotId];
  const viewerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(870.75 / SCREEN_WIDTH);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  // A finger has no hover: as in Spark's pane, the first tap only reveals the scrim.
  const [touchRevealed, setTouchRevealed] = useState(false);
  const swallowClickRef = useRef(false);
  const shots = view.shots;
  const input = useHumanInput(dotId, pageRef, interactive);

  useEffect(() => {
    if (!touchRevealed) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!viewerRef.current?.contains(event.target as Node)) setTouchRevealed(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [touchRevealed]);

  useLayoutEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    // `vnc-viewer` is 2px larger than its container in both directions.
    const measure = () => setScale((viewer.clientWidth + 2) / SCREEN_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (historyIndex !== null && historyIndex >= shots.length) setHistoryIndex(null);
  }, [historyIndex, shots.length]);

  const viewing = historyIndex !== null ? shots[historyIndex] ?? null : null;
  const shotImage = useShotImage(dotId, viewing);
  const state = view.summary?.state ?? 'none';
  const screen = view.screen;
  const on = state === 'running';
  // The whole desktop, as it is; the page alone — no desktop, or a step from before it — sits in the Chrome frame.
  const desktop = viewing ? viewing.display === 'desktop' : screen?.display !== 'browser';
  const liveIsDesktop = live?.height ? live.height === SCREEN_HEIGHT : desktop;
  const liveFrame = live?.frame && liveIsDesktop === desktop ? live.frame : null;
  const preparing = view.busy === 'starting' || state === 'starting' || (on && !liveFrame && (desktop || screen?.browser !== 'running'));
  const off = !on && !preparing;
  const hasShots = shots.length > 0 && !interactive;
  const picture = viewing ? shotImage.url : liveFrame;
  // On the desktop the picture has the real pointer in it.
  const cursor = !desktop && live?.cursor && screen?.agentActive && !viewing && !interactive ? live.cursor : null;
  const previous = () => setHistoryIndex((index) => (index === null ? shots.length - 1 : Math.max(0, index - 1)));
  const next = () => setHistoryIndex((index) => (index === null || index >= shots.length - 1 ? null : index + 1));
  const step = useCallback((op: 'back' | 'forward' | 'reload') => void sendDotInput(dotId, `/human/${op}`), [dotId]);
  const navigate = useCallback((url: string) => void sendDotInput(dotId, '/human/navigate', { url }), [dotId]);

  return (
    <div
      ref={viewerRef}
      className={`spark-remote-browser__viewer${interactive ? ' is-interactive' : ''}`}
      onPointerDownCapture={(event) => {
        if (interactive || event.pointerType === 'mouse' || touchRevealed) return;
        swallowClickRef.current = true;
        setTouchRevealed(true);
        window.setTimeout(() => { swallowClickRef.current = false; }, 700);
      }}
      onClickCapture={(event) => {
        if (!swallowClickRef.current) return;
        swallowClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className={`spark-remote-browser__screen${viewing ? ' is-history' : ''}`}>
        <div className="spark-remote-browser__display" style={{ transform: `scale(${scale})` }}>
          {!desktop && (
            <MemoChrome
              taskId={dotId}
              url={viewing?.url ?? screen?.url ?? ''}
              title={viewing?.title ?? screen?.title ?? ''}
              favicon={viewing ? '' : screen?.favicon ?? ''}
              loading={!viewing && Boolean(screen?.loading)}
              canGoBack={!viewing && Boolean(screen?.canGoBack)}
              canGoForward={!viewing && Boolean(screen?.canGoForward)}
              interactive={interactive}
              onStep={step}
              onNavigate={navigate}
            />
          )}
          <div
            ref={pageRef}
            className={`${desktop ? 'dot-computer__desktop' : 'spark-remote-browser__page'} dot-computer__page${interactive ? ' is-interactive' : ''}`}
            tabIndex={interactive ? 0 : -1}
            aria-label={interactive ? `${name}'s screen. Your mouse and keyboard drive it.` : undefined}
            {...input}
          >
            {picture && <img className={`dot-computer__frame${desktop ? ' is-desktop' : ''}`} src={picture} alt="" draggable={false} />}
          </div>
          {cursor && <DotAgentCursor dotId={dotId} x={cursor.x} y={cursor.y + CHROME_HEIGHT} scale={scale} />}
        </div>
        {preparing && (
          <div className="spark-remote-browser__loading">
            <span className="spark-remote-browser__loading-text">Preparing {name}&rsquo;s computer…</span>
          </div>
        )}
        {off && !viewing && <DotComputerOff dotId={dotId} name={name} view={view} />}
      </div>
      {!interactive && !preparing && (on || hasShots) && (
        <div className={`spark-remote-browser__scrim${hasShots ? ' has-screenshots' : ''}${touchRevealed ? ' is-revealed' : ''}`}>
          {hasShots && (
            <button type="button" className="spark-remote-browser__nav-button" aria-label="View previous" disabled={historyIndex === 0} onClick={previous}>
              <ViewerIcon name="previous" size={20} />
            </button>
          )}
          {viewing ? (
            <button type="button" className="spark-remote-browser__live-button" onClick={() => setHistoryIndex(null)}>
              <ViewerIcon name="live" size={18} />
              <span>View Live</span>
            </button>
          ) : on ? (
            <button type="button" className="spark-remote-browser__take-over" onClick={onTakeOver} disabled={view.busy === 'taking-over'}>
              <ViewerIcon name="takeOver" size={18} />
              <span>Take over</span>
            </button>
          ) : (
            <span />
          )}
          {hasShots && (
            <button type="button" className="spark-remote-browser__nav-button" aria-label="View next" disabled={historyIndex === null} onClick={next}>
              <ViewerIcon name="next" size={20} />
            </button>
          )}
          {viewing && historyIndex !== null && (
            <div className="spark-remote-browser__dots" aria-hidden="true">
              {(() => {
                const start = Math.max(0, Math.min(historyIndex - Math.floor(MAX_HISTORY_DOTS / 2), shots.length - MAX_HISTORY_DOTS));
                return shots.slice(start, start + MAX_HISTORY_DOTS).map((shot, offset) => (
                  <span key={shot.id} className={`spark-remote-browser__dot${start + offset === historyIndex ? ' is-active' : ''}`} />
                ));
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Spark's accent variables in the bot's colour, so the pane's own buttons — Take over, Turn on, Go back — wear the
 * bot's colour rather than the workspace's. Set on each root, the takeover's too, which is portalled out of the page.
 */
const useBotAccent = (dotId: string) => useDotAccentVars(useStore(sparkDots).dots.find((dot) => dot.id === dotId));

/** "Take over": the bot's computer full-screen, the user driving and the bot waiting. */
const DotComputerTakeover: React.FC<{ dotId: string; name: string; compact: boolean }> = ({ dotId, name, compact }) => {
  const accent = useBotAccent(dotId);
  return (
    <div className={`spark-remote-browser-takeover dot-computer-takeover${compact ? ' is-compact' : ''}`} style={accent} role="dialog" aria-modal="true" aria-label={`${name}'s computer`}>
      <div className="spark-remote-browser-takeover__header">
        <div className="spark-remote-browser-takeover__header-left">
          <MaterialSymbol family="google-symbols" name="monitor" size={20} weight={400} variationSettings={googleSymbol(0, 20, 400)} />
          <span className="spark-remote-browser-takeover__title">{name}&rsquo;s computer</span>
        </div>
        <button type="button" className="spark-remote-browser-takeover__give-back" onClick={() => void handBackDotComputer(dotId)}>
          Go back to {name}
        </button>
      </div>
      <div className="spark-remote-browser__floating spark-remote-browser-takeover__floating">
        <DotComputerViewer dotId={dotId} name={name} interactive />
      </div>
      <span className="spark-remote-browser__disclaimer">{disclaimer(name)}</span>
    </div>
  );
};

/**
 * Turn off and Reset, beside the header's close button, while the computer is
 * on; off, the screen itself offers to turn it on. Reset erases everything on
 * it, so it asks in place first.
 */
const DotComputerControls: React.FC<{ dotId: string; name: string }> = ({ dotId, name }) => {
  const view = useStore(dotComputers, { keys: [dotId] })[dotId] ?? dotComputerView(dotId);
  const [confirming, setConfirming] = useState(false);
  const on = view.summary?.state === 'running' && !view.busy;
  useEffect(() => {
    if (!on) setConfirming(false);
  }, [on]);
  if (!on) return null;
  if (confirming) {
    return (
      <>
        <span className="dot-computer__confirm">Erase everything on {name}&rsquo;s computer?</span>
        <button type="button" className="dot-computer__header-button" onClick={() => setConfirming(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="dot-computer__header-button is-destructive"
          onClick={() => {
            setConfirming(false);
            void resetDotComputer(dotId);
          }}
        >
          Reset
        </button>
      </>
    );
  }
  return (
    <>
      <button type="button" className="dot-computer__header-button" disabled={view.control?.holder === 'human'} onClick={() => void turnOffDotComputer(dotId)}>
        Turn off
      </button>
      <button type="button" className="dot-computer__header-button" onClick={() => setConfirming(true)}>
        Reset
      </button>
    </>
  );
};

/**
 * `compact` is Gemini's narrow layout: the same panel inside its full-screen
 * overlay, whose own bar carries the close button.
 */
export const DotComputerPane: React.FC<{
  dotId: string;
  name: string;
  onClose: () => void;
  compact?: boolean;
  /** Mounts the viewer this long after the pane, as Spark's does while its card grows. */
  viewerDelayMs?: number;
}> = ({ dotId, name, onClose, compact = false, viewerDelayMs = 0 }) => {
  const view = useStore(dotComputers, { keys: [dotId] })[dotId] ?? dotComputerView(dotId);
  const [viewerReady, setViewerReady] = useState(viewerDelayMs <= 0);
  useEffect(() => {
    if (viewerReady) return undefined;
    const timer = window.setTimeout(() => setViewerReady(true), viewerDelayMs);
    return () => window.clearTimeout(timer);
  }, [viewerReady, viewerDelayMs]);
  useEffect(() => watchDotComputer(dotId), [dotId]);
  useEffect(() => {
    void refreshDotComputer(dotId);
  }, [dotId]);
  const waiting = view.control?.request?.status === 'waiting' ? view.control.request.id : undefined;
  const accent = useBotAccent(dotId);

  return (
    <div className={`spark-remote-browser dot-computer-pane${compact ? ' is-compact' : ''}`} style={accent} data-remote-browser-pane>
      <div className="spark-remote-browser__header">
        <div className="spark-remote-browser__title-wrapper">
          <MaterialSymbol family="google-symbols" name="monitor" size={24} weight={300} variationSettings={googleSymbol(0, 24, 300)} />
          <span className="spark-remote-browser__title">{name}&rsquo;s computer</span>
        </div>
        <div className="spark-remote-browser__header-actions">
          <DotComputerControls dotId={dotId} name={name} />
          {!compact && (
            <button type="button" className="spark-remote-browser__close" aria-label={`Close ${name}'s computer`} onClick={onClose}>
              <MaterialSymbol family="luminous" name="close" size={24} weight={300} roundness={100} opticalSize={24} />
            </button>
          )}
        </div>
      </div>
      <div className="spark-remote-browser__content">
        <div className="spark-remote-browser__floating">
          {!view.inControl && viewerReady && (
            <DotComputerViewer dotId={dotId} name={name} interactive={false} onTakeOver={() => void takeOverDotComputer(dotId, waiting)} />
          )}
        </div>
        <span className="spark-remote-browser__disclaimer">{disclaimer(name)}</span>
      </div>
      {view.inControl && typeof document !== 'undefined' && createPortal(
        <DotComputerTakeover dotId={dotId} name={name} compact={compact} />,
        document.body,
      )}
    </div>
  );
};
