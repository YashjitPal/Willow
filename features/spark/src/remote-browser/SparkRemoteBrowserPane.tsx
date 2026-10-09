import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { displayUrl, normalizeBrowseTarget } from './browse-url';
import {
  adoptRemoteFrame,
  callRemoteFrame,
  CHROME_HEIGHT,
  navigateRemoteFrame,
  SCREEN_WIDTH,
  stepRemoteFrame,
} from './remote-browser-frames';
import {
  remoteBrowserSessions,
  setRemoteBrowserControl,
  type RemoteBrowserSession,
} from './remote-browser-store';
import { loadRemoteBrowserShot, type RemoteBrowserShot } from './remote-browser-shots';
import { useSparkAccentVars } from '../spark-accent';
import './SparkRemoteBrowserPane.css';

/*
 * Gemini Spark's `remy-side-panel.showing-computer-use` > `computer-use-panel` >
 * `vnc-viewer`, with the VNC stream replaced by an iframe.
 *
 * Gemini's stream is a 1280×1024 Linux desktop showing a maximised Chrome window,
 * scaled into a 5:4 box. Willow draws the same screen: a Chrome frame cloned from
 * the stream at 1:1, with the page iframe filling the 1280×937 below it, the whole
 * scaled exactly as the canvas is. Captures and measurements:
 * tools/ui-research/captures/spark/134-remote-browser/.
 */

const DISCLAIMER = "You've allowed Willow to interact with websites for this thread. Manage permissions in Skills and apps.";
/** Gemini's narrow layout writes the page's name its own way. */
const COMPACT_DISCLAIMER = "You've allowed Willow to interact with websites for this thread. Manage permissions in Skills & apps.";

const googleSymbol = (fill: 0 | 1, size: number, weight: number) => (
  `"FILL" ${fill}, "GRAD" 0, "ROND" 100, "opsz" ${size}, "wght" ${weight}`
);

/** Gemini's narrow controls draw Google Symbols on the face's own axes; a few are filled. */
const NarrowGlyph: React.FC<{ name: string; size: number; filled?: boolean }> = ({ name, size, filled = false }) => (
  <MaterialSymbol
    family="google-symbols"
    name={name}
    size={size}
    weight={400}
    variationSettings={filled ? '"FILL" 1, "ROND" 0, "slnt" 0, "wght" 400' : undefined}
  />
);

/*
 * Chrome's own toolbar icons, as Material paths on a 24px grid. Drawn as SVG rather
 * than from Willow's icon fonts: those are subsets, and a missing ligature prints its
 * name — `visibility_off` came out as an eye followed by "_OFF".
 */
const CHROME_ICONS = {
  chevronDown: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  globe: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  forward: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
  reload: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  eyeOff: 'M12 6c3.79 0 7.17 2.13 8.82 5.5-.59 1.22-1.42 2.27-2.41 3.12l1.41 1.41c1.39-1.23 2.49-2.77 3.18-4.53C21.27 7.11 17 4 12 4c-1.27 0-2.49.2-3.64.57l1.65 1.65C10.66 6.09 11.32 6 12 6zm-1.07 1.14L13 9.21c.57.25 1.03.71 1.28 1.28l2.07 2.07c.08-.34.14-.7.14-1.07C16.5 9.01 14.48 7 12 7c-.37 0-.72.05-1.07.14zM2.01 3.87l2.68 2.68A11.738 11.738 0 0 0 1 11.5C2.73 15.89 7 19 12 19c1.52 0 2.98-.29 4.32-.82l3.42 3.42 1.41-1.41L3.42 2.45 2.01 3.87zm7.5 7.5 2.61 2.61c-.04.01-.08.02-.12.02a2.5 2.5 0 0 1-2.5-2.5c0-.05.01-.08.01-.13zm-3.4-3.4 1.75 1.75a4.6 4.6 0 0 0-.36 1.78 4.507 4.507 0 0 0 6.27 4.14l.98.98c-.88.24-1.8.38-2.75.38-3.79 0-7.17-2.13-8.82-5.5.7-1.43 1.72-2.61 2.93-3.53z',
  extension: 'M10.5 4.5c.28 0 .5.22.5.5v2h6v6h2c.28 0 .5.22.5.5s-.22.5-.5.5h-2v6h-2.12c-.68-1.75-2.39-3-4.38-3s-3.7 1.25-4.38 3H4v-2.12c1.75-.68 3-2.39 3-4.38 0-1.99-1.24-3.7-2.99-4.38L4 7h6V5c0-.28.22-.5.5-.5m0-2C9.12 2.5 8 3.62 8 5H4c-1.1 0-1.99.9-1.99 2v3.8h.29c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-.3c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7v.3H17c1.1 0 2-.9 2-2v-4c1.38 0 2.5-1.12 2.5-2.5S20.38 11 19 11V7c0-1.1-.9-2-2-2h-4c0-1.38-1.12-2.5-2.5-2.5z',
  account: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM7.07 18.28c.43-.9 3.05-1.78 4.93-1.78s4.51.88 4.93 1.78A7.893 7.893 0 0 1 12 20c-1.86 0-3.57-.64-4.93-1.72zm11.29-1.45c-1.43-1.74-4.9-2.33-6.36-2.33s-4.93.59-6.36 2.33A7.95 7.95 0 0 1 4 12c0-4.41 3.59-8 8-8s8 3.59 8 8c0 1.82-.62 3.49-1.64 4.83zM12 6c-1.94 0-3.5 1.56-3.5 3.5S10.06 13 12 13s3.5-1.56 3.5-3.5S13.94 6 12 6zm0 5c-.83 0-1.5-.67-1.5-1.5S11.17 8 12 8s1.5.67 1.5 1.5S12.83 11 12 11z',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
} as const;

export const ChromeIcon: React.FC<{ name: keyof typeof CHROME_ICONS; size: number }> = ({ name, size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <path d={CHROME_ICONS[name]} />
  </svg>
);

/*
 * The viewer's own Google Symbols glyphs — `chevron_left`, `chevron_right`,
 * `youtube_live` and `web_traffic` — none of which Willow's symbol subsets carry.
 */
export const ViewerIcon: React.FC<{ name: 'previous' | 'next' | 'live' | 'takeOver'; size: number }> = ({ name, size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    {name === 'previous' && <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />}
    {name === 'next' && <path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />}
    {name === 'live' && (
      <path d="M7.76 16.24A5.98 5.98 0 0 1 6 12c0-1.66.67-3.16 1.76-4.24l1.42 1.42A3.97 3.97 0 0 0 8 12c0 1.1.45 2.1 1.17 2.83zm8.48 0A5.98 5.98 0 0 0 18 12c0-1.66-.67-3.16-1.76-4.24l-1.42 1.42C15.55 9.9 16 10.9 16 12c0 1.1-.45 2.1-1.17 2.83zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 2c0 2.21-.9 4.21-2.35 5.65l1.42 1.42A9.95 9.95 0 0 0 22 12c0-2.76-1.12-5.26-2.93-7.07l-1.42 1.42A7.94 7.94 0 0 1 20 12zM6.35 6.35 4.93 4.93A9.95 9.95 0 0 0 2 12c0 2.76 1.12 5.26 2.93 7.07l1.42-1.42A7.94 7.94 0 0 1 4 12c0-2.21.9-4.21 2.35-5.65z" />
    )}
    {name === 'takeOver' && (
      <>
        <path d="M9.5 9.5 20 13.4l-4.2 1.5 3.9 3.9-1.6 1.6-3.9-3.9-1.5 4.2z" />
        <path d="M3.8 9.5h2.6M9.5 3.8v2.6M5.4 5.4l1.8 1.8M5.4 13.6l1.8-1.8M13.6 5.4l-1.8 1.8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </>
    )}
  </svg>
);

/** The host of a URL, emphasised the way Chrome's omnibox draws it, the rest dimmed. */
const OmniboxText: React.FC<{ url: string }> = ({ url }) => {
  const shown = displayUrl(url);
  const slash = shown.search(/[/?#]/);
  const host = slash === -1 ? shown : shown.slice(0, slash);
  const rest = slash === -1 ? '' : shown.slice(slash);
  return (
    <>
      <span className="spark-remote-browser__omnibox-host">{host}</span>
      {rest && <span className="spark-remote-browser__omnibox-rest">{rest}</span>}
    </>
  );
};

/**
 * Chrome's tab, toolbar and window controls, as the remote desktop shows them.
 * The toolbar drives the task's frame unless `onStep` and `onNavigate` say
 * where else its buttons and omnibox go (a dot's own computer).
 */
export const RemoteBrowserChrome: React.FC<{
  taskId: string;
  url: string;
  title: string;
  favicon: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Taken over: the toolbar and omnibox work, as they would on the remote desktop. */
  interactive: boolean;
  onStep?: (op: 'back' | 'forward' | 'reload') => void;
  onNavigate?: (url: string) => void;
}> = ({ taskId, url, title, favicon, loading, canGoBack, canGoForward, interactive, onStep, onNavigate }) => {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(url);
  useEffect(() => setFaviconFailed(false), [favicon]);
  useEffect(() => {
    if (!editing) setDraft(url);
  }, [editing, url]);
  const tabTitle = title || displayUrl(url) || 'New Tab';
  const act = (op: 'back' | 'forward' | 'reload') => {
    if (!interactive) return;
    if (onStep) onStep(op);
    else void stepRemoteFrame(taskId, op).catch(() => undefined);
  };
  return (
    <div className="spark-remote-browser__chrome" aria-hidden={!interactive || undefined}>
      <div className="spark-remote-browser__tabstrip">
        <span className="spark-remote-browser__tab-search">
          <ChromeIcon name="chevronDown" size={20} />
        </span>
        <span className="spark-remote-browser__pinned-tab">
          <ChromeIcon name="globe" size={16} />
        </span>
        <div className="spark-remote-browser__tab">
          <span className="spark-remote-browser__tab-icon">
            {loading ? (
              <span className="spark-remote-browser__throbber" />
            ) : favicon && !faviconFailed && !favicon.startsWith('data:,') ? (
              <img src={favicon} alt="" width={16} height={16} onError={() => setFaviconFailed(true)} />
            ) : (
              <ChromeIcon name="globe" size={16} />
            )}
          </span>
          <span className="spark-remote-browser__tab-title">{tabTitle}</span>
          <span className="spark-remote-browser__tab-close">
            <ChromeIcon name="close" size={16} />
          </span>
        </div>
        <span className="spark-remote-browser__new-tab" />
        <span className="spark-remote-browser__window-controls">
          <span className="spark-remote-browser__window-minimize" />
          <span className="spark-remote-browser__window-restore" />
          <span className="spark-remote-browser__window-close" />
        </span>
      </div>
      <div className="spark-remote-browser__toolbar">
        <button type="button" tabIndex={interactive ? 0 : -1} className="spark-remote-browser__toolbar-button" disabled={!canGoBack} aria-label="Back" onClick={() => act('back')}>
          <ChromeIcon name="back" size={20} />
        </button>
        <button type="button" tabIndex={interactive ? 0 : -1} className="spark-remote-browser__toolbar-button" disabled={!canGoForward} aria-label="Forward" onClick={() => act('forward')}>
          <ChromeIcon name="forward" size={20} />
        </button>
        <button type="button" tabIndex={interactive ? 0 : -1} className="spark-remote-browser__toolbar-button" aria-label="Reload" onClick={() => act('reload')}>
          <ChromeIcon name="reload" size={20} />
        </button>
        <form
          className="spark-remote-browser__omnibox"
          onSubmit={(event) => {
            event.preventDefault();
            const target = normalizeBrowseTarget(draft);
            if (!target) return;
            if (onNavigate) onNavigate(target);
            else navigateRemoteFrame(taskId, target);
            setEditing(false);
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
          {/* Chrome's page-info chip: two sliders, ring left above and ring right below. */}
          <span className="spark-remote-browser__site-info">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
              <circle cx="8.9" cy="8.4" r="1.9" />
              <path d="M13.6 8.6H19M6.4 14.9H12" strokeLinecap="butt" />
              <circle cx="16.1" cy="14.9" r="2.2" />
            </svg>
          </span>
          {interactive && editing ? (
            <input
              autoFocus
              className="spark-remote-browser__omnibox-input"
              value={draft}
              aria-label="Address and search bar"
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(false);
              }}
            />
          ) : (
            <span
              className="spark-remote-browser__omnibox-text"
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : -1}
              onClick={() => interactive && setEditing(true)}
              onKeyDown={(event) => {
                if (interactive && (event.key === 'Enter' || event.key === ' ')) setEditing(true);
              }}
            >
              <OmniboxText url={url} />
            </span>
          )}
          <span className="spark-remote-browser__omnibox-end">
            <ChromeIcon name="eyeOff" size={20} />
          </span>
        </form>
        <span className="spark-remote-browser__toolbar-icon">
          <ChromeIcon name="extension" size={20} />
        </span>
        <span className="spark-remote-browser__toolbar-separator" />
        <span className="spark-remote-browser__toolbar-icon is-profile">
          <ChromeIcon name="account" size={20} />
        </span>
        <span className="spark-remote-browser__toolbar-icon">
          <ChromeIcon name="more" size={20} />
        </span>
      </div>
    </div>
  );
};

/*
 * The viewer redraws on every change of its scale — each frame while the card is
 * still growing — and the frame around the page is the bulk of it, with nothing of
 * its own changed.
 */
const MemoRemoteBrowserChrome = React.memo(RemoteBrowserChrome);

/** Gemini's row of history dots, at most this many, around the step on screen. */
const MAX_HISTORY_DOTS = 15;

/**
 * The image of one step of the history. It comes from this session, IndexedDB or the
 * task's folder, so it can take a moment, and can be gone: then `missing` is set and
 * the viewer says so instead of showing a broken image. The previous step's image
 * stays up until the next one is ready, so stepping through never flashes empty.
 */
const useRemoteBrowserShotImage = (taskId: string, shot: RemoteBrowserShot | null) => {
  const [state, setState] = useState<{ id: string | null; url: string | null; missing: boolean }>({ id: null, url: null, missing: false });
  const urlRef = useRef<string | null>(null);
  const shotId = shot?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    const show = (url: string | null, missing: boolean) => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setState({ id: shotId, url, missing });
    };
    if (!shot) {
      show(null, false);
      return undefined;
    }
    void loadRemoteBrowserShot(taskId, shot).then((blob) => {
      if (!cancelled) show(blob ? URL.createObjectURL(blob) : null, !blob);
    });
    return () => {
      cancelled = true;
    };
    // Keyed on the id: the shot object is rebuilt with every history update.
  }, [taskId, shotId]);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const fail = useCallback(() => setState((current) => ({ ...current, url: null, missing: true })), []);
  return {
    url: state.url,
    missing: state.missing && state.id === shotId,
    fail,
  };
};

const shotHost = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const shotTime = (at: number): string => {
  if (!at) return '';
  const when = new Date(at);
  const today = new Date();
  return when.toDateString() === today.toDateString()
    ? when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : when.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/**
 * A step whose image is in neither the browser nor the task's folder. It covers the
 * page only, under the frame's address bar, which still names the step.
 */
const RemoteBrowserShotUnavailable: React.FC<{ shot: RemoteBrowserShot; top: number }> = ({ shot, top }) => {
  const details = [shotHost(shot.url), shotTime(shot.at)].filter(Boolean).join(' · ');
  return (
    <div className="spark-remote-browser__unavailable" style={{ top }} role="img" aria-label={`Screenshot unavailable${details ? `, ${details}` : ''}`}>
      <div className="spark-remote-browser__unavailable-body" aria-hidden="true">
        <span className="spark-remote-browser__unavailable-icon">
          {/* `hide_image` is in Willow's Luminous subset, not its Google Symbols one. */}
          <MaterialSymbol family="luminous" name="hide_image" size={20} weight={300} />
        </span>
        <span className="spark-remote-browser__unavailable-title">Screenshot unavailable</span>
        <span className="spark-remote-browser__unavailable-text">This step’s image is no longer on this device.</span>
        {details && <span className="spark-remote-browser__unavailable-details">{details}</span>}
      </div>
    </div>
  );
};

/**
 * `.iframe-container`: the 5:4 viewer with its scrim, history and loader.
 *
 * `interactive` is the taken-over view: the page and toolbar take input and there
 * is no scrim, because the user is the one driving.
 *
 * `narrow` is Gemini's phone and tablet viewer: "Take over task" and "View Live" sit
 * under it (`RemoteBrowserActions`), so the scrim keeps only previous, next and the
 * dots, and only while a step of the history is on screen. The pane then holds the
 * history step (`history`), since those buttons change it too.
 */
const RemoteBrowserViewer: React.FC<{
  taskId: string;
  session: RemoteBrowserSession;
  interactive: boolean;
  onTakeOver?: () => void;
  narrow?: boolean;
  history?: { index: number | null; set: React.Dispatch<React.SetStateAction<number | null>> };
}> = ({ taskId, session, interactive, onTakeOver, narrow = false, history }) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(870.75 / SCREEN_WIDTH);
  const [ownHistoryIndex, setOwnHistoryIndex] = useState<number | null>(null);
  const historyIndex = history ? history.index : ownHistoryIndex;
  const setHistoryIndex = history ? history.set : setOwnHistoryIndex;
  /*
   * A finger has no hover, so the scrim's buttons would take the very tap meant to
   * show them — a tap on the middle of the screen took the task over. As in
   * Gemini, the first tap only reveals the scrim; a tap outside hides it again.
   */
  const [touchRevealed, setTouchRevealed] = useState(false);
  const swallowClickRef = useRef(false);
  const shots = session.shots;

  useEffect(() => {
    if (!touchRevealed) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!viewerRef.current?.contains(event.target as Node)) setTouchRevealed(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [touchRevealed]);

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return undefined;
    return adoptRemoteFrame(taskId, page);
  }, [taskId]);

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

  // A history index past the end (the list was trimmed) falls back to live.
  useEffect(() => {
    if (historyIndex !== null && historyIndex >= shots.length) setHistoryIndex(null);
  }, [historyIndex, shots.length, setHistoryIndex]);

  const viewing = historyIndex !== null ? shots[historyIndex] ?? null : null;
  const shotImage = useRemoteBrowserShotImage(taskId, viewing);
  const preparing = session.phase === 'preparing';
  const hasShots = shots.length > 0 && !interactive && (!narrow || viewing !== null);
  const previous = () => setHistoryIndex((index) => (index === null ? shots.length - 1 : Math.max(0, index - 1)));
  const next = () => setHistoryIndex((index) => (index === null || index >= shots.length - 1 ? null : index + 1));
  const cursor = session.cursor && session.agentActive && !viewing && !interactive ? session.cursor : null;

  return (
    <div
      ref={viewerRef}
      className={`spark-remote-browser__viewer${interactive ? ' is-interactive' : ''}`}
      onPointerDownCapture={(event) => {
        if (interactive || event.pointerType === 'mouse' || touchRevealed) return;
        swallowClickRef.current = true;
        setTouchRevealed(true);
        // A press that turns into a scroll never clicks; do not eat the next real tap.
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
          <MemoRemoteBrowserChrome
            taskId={taskId}
            url={viewing?.url ?? session.url}
            title={viewing?.title ?? session.title}
            favicon={viewing ? '' : session.favicon}
            loading={!viewing && session.loading}
            canGoBack={!viewing && session.canGoBack}
            canGoForward={!viewing && session.canGoForward}
            interactive={interactive}
          />
          <div ref={pageRef} className="spark-remote-browser__page" />
          {viewing && shotImage.url && !shotImage.missing && (
            <img className="spark-remote-browser__screenshot" src={shotImage.url} alt="" draggable={false} onError={shotImage.fail} />
          )}
          {cursor && (
            <span
              className="spark-remote-browser__cursor"
              style={{ transform: `translate(${cursor.x}px, ${cursor.y + CHROME_HEIGHT}px)` }}
              aria-hidden="true"
            />
          )}
        </div>
        {viewing && shotImage.missing && <RemoteBrowserShotUnavailable shot={viewing} top={CHROME_HEIGHT * scale} />}
        {preparing && (
          <div className="spark-remote-browser__loading">
            <span className="spark-remote-browser__loading-text">Preparing your computer…</span>
          </div>
        )}
      </div>
      {!interactive && !preparing && (
        <div className={`spark-remote-browser__scrim${hasShots ? ' has-screenshots' : ''}${touchRevealed ? ' is-revealed' : ''}`}>
          {hasShots && (
            <button
              type="button"
              className="spark-remote-browser__nav-button"
              aria-label="View previous"
              disabled={historyIndex === 0}
              onClick={previous}
            >
              <ViewerIcon name="previous" size={20} />
            </button>
          )}
          {narrow ? null : viewing ? (
            <button type="button" className="spark-remote-browser__live-button" onClick={() => setHistoryIndex(null)}>
              <ViewerIcon name="live" size={18} />
              <span>View Live</span>
            </button>
          ) : (
            <button type="button" className="spark-remote-browser__take-over" onClick={onTakeOver}>
              <ViewerIcon name="takeOver" size={18} />
              <span>Take over task</span>
            </button>
          )}
          {hasShots && (
            <button
              type="button"
              className="spark-remote-browser__nav-button"
              aria-label="View next"
              disabled={historyIndex === null}
              onClick={next}
            >
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

/** "Take over task": the remote desktop full-screen, the user driving and the agent waiting. */
const RemoteBrowserTakeover: React.FC<{ taskId: string; session: RemoteBrowserSession; compact: boolean }> = ({ taskId, session, compact }) => {
  const giveBack = useCallback(() => setRemoteBrowserControl(taskId, false), [taskId]);
  return (
    <div className={`spark-remote-browser-takeover${compact ? ' is-compact' : ''}`} role="dialog" aria-modal="true" aria-label="Remote computer">
      <div className="spark-remote-browser-takeover__header">
        <div className="spark-remote-browser-takeover__header-left">
          <MaterialSymbol family="google-symbols" name="monitor" size={20} weight={400} variationSettings={googleSymbol(0, 20, 400)} />
          <span className="spark-remote-browser-takeover__title">Remote computer</span>
        </div>
        <button type="button" className="spark-remote-browser-takeover__give-back" onClick={giveBack}>
          Go back to Willow
        </button>
      </div>
      <div className="spark-remote-browser__floating spark-remote-browser-takeover__floating">
        <RemoteBrowserViewer taskId={taskId} session={session} interactive />
      </div>
      <span className="spark-remote-browser__disclaimer">{compact ? COMPACT_DISCLAIMER : DISCLAIMER}</span>
    </div>
  );
};

/**
 * Gemini's `bottom-container` on phones and tablets: the scrim's buttons, under the viewer.
 * Live, "Take over task" and, once there is a history, "View history"; on a step of the
 * history, "View Live".
 */
const RemoteBrowserActions: React.FC<{
  session: RemoteBrowserSession;
  historyIndex: number | null;
  setHistoryIndex: React.Dispatch<React.SetStateAction<number | null>>;
  onTakeOver: () => void;
}> = ({ session, historyIndex, setHistoryIndex, onTakeOver }) => (
  <div className="spark-remote-browser__actions">
    {historyIndex !== null ? (
      <button type="button" className="spark-remote-browser__action is-tonal" onClick={() => setHistoryIndex(null)}>
        <NarrowGlyph name="youtube_live" size={18} filled />
        <span>View Live</span>
      </button>
    ) : session.phase !== 'preparing' && (
      <>
        <button type="button" className="spark-remote-browser__action is-tonal" onClick={onTakeOver}>
          <NarrowGlyph name="web_traffic" size={18} />
          <span>Take over task</span>
        </button>
        {session.shots.length > 0 && (
          <button type="button" className="spark-remote-browser__action" onClick={() => setHistoryIndex(session.shots.length - 1)}>
            <NarrowGlyph name="history" size={18} />
            <span>View history</span>
          </button>
        )}
      </>
    )}
  </div>
);

/**
 * Gemini's `keyboard-input-bar`: text for the page, for a screen with no keyboard of its own.
 * Typing here takes the focus out of the page, so the bridge sends it to the field the page
 * last had focused, at that field's caret (`keyboard`); backspace deletes there.
 */
const RemoteBrowserKeyboardBar: React.FC<{ taskId: string; onHide: () => void }> = ({ taskId, onHide }) => {
  const [text, setText] = useState('');
  const send = () => {
    if (!text) return;
    void callRemoteFrame(taskId, 'keyboard', { text }).catch(() => undefined);
    setText('');
  };
  return (
    <div className="spark-remote-browser__keyboard">
      <div className="spark-remote-browser__keyboard-field">
        <button type="button" className="spark-remote-browser__keyboard-button" aria-label="Hide keyboard" onClick={onHide}>
          <NarrowGlyph name="keyboard_hide" size={24} />
        </button>
        <input
          autoFocus
          className="spark-remote-browser__keyboard-input"
          value={text}
          placeholder="Send text"
          aria-label="Send text"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            send();
          }}
        />
        <button
          type="button"
          className="spark-remote-browser__keyboard-button"
          aria-label="Send backspace"
          onClick={() => { void callRemoteFrame(taskId, 'keyboard', { backspace: true }).catch(() => undefined); }}
        >
          <NarrowGlyph name="backspace" size={24} filled />
        </button>
        <button type="button" className="spark-remote-browser__keyboard-button" aria-label="Send text to the page" onClick={send}>
          <NarrowGlyph name="send" size={24} filled />
        </button>
      </div>
    </div>
  );
};

/**
 * "Take over task" at 960px and below: Gemini's `computer-use-panel.fullscreen-panel.in-control`.
 * The header loses its button; under the viewer, a bar holds the keyboard and click switches and
 * "Go back to Willow". The two switches are one toggle, as in Gemini: either of them turns the
 * keyboard bar on, and "Hide keyboard" turns it off. The portal is outside Spark's pages, so it
 * declares Spark's accent itself.
 */
const RemoteBrowserNarrowTakeover: React.FC<{ taskId: string; session: RemoteBrowserSession }> = ({ taskId, session }) => {
  const accent = useSparkAccentVars();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const toggleKeyboard = useCallback(() => setKeyboardOpen((open) => !open), []);
  const giveBack = useCallback(() => setRemoteBrowserControl(taskId, false), [taskId]);
  return (
    <div className="spark-remote-browser-takeover is-compact is-narrow" style={accent} role="dialog" aria-modal="true" aria-label="Remote computer">
      <div className="spark-remote-browser-takeover__header">
        <div className="spark-remote-browser-takeover__header-left">
          <NarrowGlyph name="monitor" size={20} />
          <span className="spark-remote-browser-takeover__title">Remote computer</span>
        </div>
      </div>
      <div className="spark-remote-browser__floating spark-remote-browser-takeover__floating">
        <RemoteBrowserViewer taskId={taskId} session={session} interactive />
      </div>
      <div className="spark-remote-browser__actions is-in-control">
        {!keyboardOpen && (
          <div className="spark-remote-browser__control-bar">
            <div className="spark-remote-browser__control-group">
              <button
                type="button"
                className={`spark-remote-browser__control${keyboardOpen ? ' is-selected' : ''}`}
                aria-label="Keyboard"
                aria-pressed={keyboardOpen}
                onClick={toggleKeyboard}
              >
                <NarrowGlyph name="keyboard" size={18} />
              </button>
              <button
                type="button"
                className={`spark-remote-browser__control${keyboardOpen ? '' : ' is-selected'}`}
                aria-label="Click"
                aria-pressed={!keyboardOpen}
                onClick={toggleKeyboard}
              >
                <NarrowGlyph name="web_traffic" size={18} />
              </button>
            </div>
            <div className="spark-remote-browser__control-group">
              <button type="button" className="spark-remote-browser-takeover__give-back" onClick={giveBack}>
                Go back to Willow
              </button>
            </div>
          </div>
        )}
      </div>
      <span className="spark-remote-browser__disclaimer">{COMPACT_DISCLAIMER}</span>
      {keyboardOpen && <RemoteBrowserKeyboardBar taskId={taskId} onHide={toggleKeyboard} />}
    </div>
  );
};

/**
 * `compact` is Gemini's narrow layout (960px and below). The pane fills the screen there
 * (`fullscreen`, Gemini's `computer-use-panel.fullscreen-panel`) with a close of its own,
 * until a take-over is handed back; then it is the card in the full-screen
 * `mobile-side-panel-overlay`, whose bar carries the close. Either way its buttons sit
 * under the viewer.
 */
export const SparkRemoteBrowserPane: React.FC<{
  taskId: string;
  onClose: () => void;
  compact?: boolean;
  fullscreen?: boolean;
  /** Mounts the viewer this long after the pane. The page stays alive, parked, meanwhile. */
  viewerDelayMs?: number;
}> = ({ taskId, onClose, compact = false, fullscreen = false, viewerDelayMs = 0 }) => {
  const session = useStore(remoteBrowserSessions)[taskId];
  const [viewerReady, setViewerReady] = useState(viewerDelayMs <= 0);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  useEffect(() => {
    if (viewerReady) return undefined;
    const timer = window.setTimeout(() => setViewerReady(true), viewerDelayMs);
    return () => window.clearTimeout(timer);
  }, [viewerReady, viewerDelayMs]);
  if (!session) return null;
  const filling = compact && fullscreen;
  const takeOver = () => {
    setHistoryIndex(null);
    setRemoteBrowserControl(taskId, true);
  };
  return (
    <div className={`spark-remote-browser${compact ? ' is-compact' : ''}${filling ? ' is-fullscreen' : ''}`} data-remote-browser-pane>
      <div className="spark-remote-browser__header">
        <div className="spark-remote-browser__title-wrapper">
          {filling ? (
            <NarrowGlyph name="monitor" size={20} />
          ) : (
            <MaterialSymbol family="google-symbols" name="monitor" size={24} weight={300} variationSettings={googleSymbol(0, 24, 300)} />
          )}
          <span className="spark-remote-browser__title">{filling ? 'Remote computer' : 'Remote browser'}</span>
        </div>
        {(!compact || filling) && (
          <div className="spark-remote-browser__header-actions">
            {filling ? (
              <button type="button" className="spark-remote-browser__close" aria-label="Close panel" onClick={onClose}>
                <NarrowGlyph name="close" size={20} />
              </button>
            ) : (
              <button type="button" className="spark-remote-browser__close" aria-label="Close remote browser" onClick={onClose}>
                <MaterialSymbol family="luminous" name="close" size={24} weight={300} roundness={100} opticalSize={24} />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="spark-remote-browser__content">
        <div className="spark-remote-browser__floating">
          {!session.inControl && viewerReady && (
            <RemoteBrowserViewer
              taskId={taskId}
              session={session}
              interactive={false}
              onTakeOver={() => setRemoteBrowserControl(taskId, true)}
              {...(compact ? { narrow: true, history: { index: historyIndex, set: setHistoryIndex } } : {})}
            />
          )}
        </div>
        {compact && !session.inControl && (
          <RemoteBrowserActions session={session} historyIndex={historyIndex} setHistoryIndex={setHistoryIndex} onTakeOver={takeOver} />
        )}
        <span className="spark-remote-browser__disclaimer">{compact ? COMPACT_DISCLAIMER : DISCLAIMER}</span>
      </div>
      {session.inControl && typeof document !== 'undefined' && createPortal(
        compact
          ? <RemoteBrowserNarrowTakeover taskId={taskId} session={session} />
          : <RemoteBrowserTakeover taskId={taskId} session={session} compact={compact} />,
        document.body,
      )}
    </div>
  );
};
