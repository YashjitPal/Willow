/**
 * An agent tab: T3 Code's page, restyled for Willow (vendor/t3code/apps/web), from the agents'
 * server the desktop app runs (on Willow's Android app, the computer's, through the app). One
 * frame serves every agent tab and stays loaded while Willow's own destinations are in front;
 * switching tabs tells it which agent to show.
 *
 * The page signs in with the token in its address fragment, which never reaches the server, and
 * asks this page for what only the desktop app can do (a folder from the system picker) over
 * `postMessage`, answered here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getHarnessConnection,
  getHarnessExposure,
  getHarnessTailscale,
  hasHarnessPreview,
  hasStripPanelTabs,
  harnessSnapShot,
  notificationsAllowed,
  onDesktopMessage,
  pickDirectory,
  pickFile,
  requestNotificationPermission,
  setHarnessBadge,
  setHarnessExposure,
  setHarnessTailscaleServe,
  setStripPanelTabs,
  showNotification,
  type HarnessConnection,
  type HarnessExposure,
  type PickFileOptions,
  type StripPanelTab,
} from '@willow/core/desktop-bridge';
import { isAndroidApp } from '@willow/core/android-bridge';
import { FlowLoadingPage } from '@willow/media/FlowLoadingPage';
import { createPreviewHost, type PreviewHost } from './harness-preview';
import { $harnessLast, openHarnessTab } from './harness-store';
import { harnessPalette } from './harness-theme';
import { harnessById, type HarnessId } from './harnesses';
import { HARNESS_MARKS } from './HarnessLogos';
import './HarnessView.css';

const SOURCE = 'willow-agents';

/** The side panel's tabs as the agents' page reports them, in its own pixels (its willow/stripTabs.ts). */
interface FramePanelTabs {
  left: number;
  tabs: StripPanelTab[];
  add: boolean;
}

const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

function readPanelTabs(data: { left?: unknown; tabs?: unknown; add?: unknown }): FramePanelTabs | null {
  if (typeof data.left !== 'number' || !Number.isFinite(data.left) || !Array.isArray(data.tabs)) return null;
  const tabs = data.tabs.flatMap((tab: unknown): StripPanelTab[] => {
    if (!tab || typeof tab !== 'object') return [];
    const { id, title, active, pending, image, mask } = tab as Record<string, unknown>;
    if (!isText(id, 300) || !isText(title, 300)) return [];
    return [
      {
        id,
        title,
        active: active === true,
        pending: pending === true,
        ...(isText(image, 100_000) ? { image } : {}),
        ...(isText(mask, 100_000) ? { mask } : {}),
      },
    ];
  });
  return { left: data.left, tabs, add: data.add === true };
}

/** The strip's panel tabs are one agent tab's at a time: the one on show. */
let stripOwner: symbol | null = null;

interface HarnessViewProps {
  harness: HarnessId;
  isLight: boolean;
  visible: boolean;
}

type Status = { kind: 'starting' } | { kind: 'failed'; message: string } | { kind: 'ready'; connection: HarnessConnection };

/** A phone reaches the server over the network, which only the computer may close. */
const PHONE_EXPOSURE: HarnessExposure = {
  mode: 'network-accessible',
  endpointUrl: null,
  advertisedHost: null,
  tailscaleServeEnabled: false,
  tailscaleServePort: 443,
  port: null,
};
const ON_THE_COMPUTER = 'Change network access on the computer: this phone reaches the agents through it.';

/** What the agents' page may ask of this one. */
const answer = async (method: string, args: unknown[]): Promise<unknown> => {
  switch (method) {
    case 'pickFolder': {
      const options = (args[0] ?? {}) as { title?: string };
      return pickDirectory(options.title ?? 'Add a project');
    }
    case 'pickFile': {
      const options = (args[0] ?? {}) as Partial<PickFileOptions>;
      return pickFile({
        title: typeof options.title === 'string' ? options.title : 'Choose a file',
        ...(Array.isArray(options.filters) ? { filters: options.filters } : {}),
        ...(typeof options.defaultPath === 'string' ? { defaultPath: options.defaultPath } : {}),
      });
    }
    case 'getServerExposure':
      return isAndroidApp() ? PHONE_EXPOSURE : getHarnessExposure();
    case 'setServerExposure':
      if (isAndroidApp()) throw new Error(ON_THE_COMPUTER);
      return setHarnessExposure(args[0] === 'network-accessible' ? 'network-accessible' : 'local-only');
    case 'setTailscaleServe': {
      if (isAndroidApp()) throw new Error(ON_THE_COMPUTER);
      const input = (args[0] ?? {}) as { enabled?: boolean; port?: number };
      return setHarnessTailscaleServe(input.enabled === true, typeof input.port === 'number' ? input.port : undefined);
    }
    case 'getTailscale':
      return isAndroidApp() ? null : getHarnessTailscale();
    case 'setBadge': {
      const input = (args[0] ?? {}) as { count?: number; rgba?: number[]; size?: number };
      const count = typeof input.count === 'number' ? Math.max(0, Math.floor(input.count)) : 0;
      const icon = Array.isArray(input.rgba) && typeof input.size === 'number' ? { rgba: input.rgba, size: input.size } : undefined;
      return setHarnessBadge(count, icon);
    }
    case 'notificationsAllowed':
      return notificationsAllowed();
    case 'requestNotifications':
      return requestNotificationPermission();
    case 'notify': {
      const input = (args[0] ?? {}) as { title?: string; body?: string; tag?: string };
      return showNotification({ title: String(input.title ?? ''), body: String(input.body ?? ''), tag: input.tag });
    }
    case 'snapShotConfigure': {
      const input = (args[0] ?? {}) as { enabled?: boolean; shortcut?: unknown; includeAccessibility?: boolean };
      return harnessSnapShot.configure(
        input.enabled === true,
        input.shortcut ?? { kind: 'both-shift-keys' },
        input.includeAccessibility !== false,
      );
    }
    case 'snapShotState':
      return harnessSnapShot.state();
    case 'snapShotCheckShortcut':
      return harnessSnapShot.checkShortcut(args[0]);
    case 'snapShotSuppress':
      return harnessSnapShot.suppress(args[0] === true);
    case 'snapShotPending':
      return harnessSnapShot.pending();
    case 'snapShotRead':
      return harnessSnapShot.read(String(args[0] ?? ''));
    case 'snapShotAck':
      return harnessSnapShot.acknowledge(String(args[0] ?? ''));
    default:
      throw new Error(`Willow does not answer ${method} for the agents' page.`);
  }
};

/** How long the agents' page may take to say it is up before it is loaded again. */
const PAGE_READY_TIMEOUT_MS = 20_000;

export function HarnessView({ harness, isLight, visible }: HarnessViewProps) {
  const [status, setStatus] = useState<Status>({ kind: 'starting' });
  const [shown, setShown] = useState(false);
  // A page whose server restarted while it loaded never says it is up; it is loaded again.
  const [attempt, setAttempt] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  // The tab's agent's colours, not Willow's workspace colour: each agent tab is that agent's.
  const palette = useMemo(() => harnessPalette(harness), [harness]);
  // What the frame's address starts it with, fixed: a new address would load the page again.
  const initial = useRef({ harness, isLight, palette, viewportWidth: window.innerWidth });
  const previews = useRef<PreviewHost | null>(null);
  const panelTabs = useRef<FramePanelTabs | null>(null);
  const stripToken = useRef(Symbol('agents-strip-tabs'));
  const stripSent = useRef('');

  // The side panel's tabs, in the strip over the panel while this tab is on show (the desktop app).
  const syncStrip = useCallback(() => {
    if (!hasStripPanelTabs()) return;
    const reported = panelTabs.current;
    const element = frame.current;
    if (visible && shown && reported && element) {
      if (stripOwner !== stripToken.current) stripSent.current = '';
      stripOwner = stripToken.current;
      const left = Math.round((element.getBoundingClientRect().left + reported.left) * window.devicePixelRatio);
      const tabs = { left, tabs: reported.tabs, add: reported.add };
      const sent = JSON.stringify(tabs);
      if (sent === stripSent.current) return;
      stripSent.current = sent;
      setStripPanelTabs(tabs);
    } else if (stripOwner === stripToken.current) {
      stripOwner = null;
      stripSent.current = '';
      setStripPanelTabs(null);
    }
  }, [visible, shown]);
  const syncStripRef = useRef(syncStrip);
  syncStripRef.current = syncStrip;

  // The agents' browser tabs, where the app gives them webviews of their own.
  useEffect(() => {
    if (!hasHarnessPreview()) return;
    const host = createPreviewHost(() => frame.current);
    previews.current = host;
    return () => {
      host.dispose();
      if (previews.current === host) previews.current = null;
    };
  }, []);

  const connect = useCallback(() => {
    setStatus({ kind: 'starting' });
    setShown(false);
    getHarnessConnection().then(
      (connection) => setStatus({ kind: 'ready', connection }),
      (error: unknown) => setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
    );
  }, []);

  useEffect(connect, [connect]);

  const origin = status.kind === 'ready' ? new URL(status.connection.url).origin : null;

  useEffect(() => {
    if (!origin || shown) return;
    const timer = window.setTimeout(() => setAttempt((count) => count + 1), PAGE_READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [origin, shown, attempt]);

  const post = useCallback(
    (message: Record<string, unknown>) => {
      if (origin) frame.current?.contentWindow?.postMessage({ source: SOURCE, ...message }, origin);
    },
    [origin],
  );

  useEffect(() => {
    if (!origin) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data as { source?: string; kind?: string; id?: string; method?: string; args?: unknown[]; message?: unknown } | null;
      if (!data || data.source !== SOURCE) return;
      if (data.kind === 'ready') {
        setShown(true);
        // A page that loaded again by itself takes the window's width as it is now.
        post({ kind: 'viewport', width: window.innerWidth });
        return;
      }
      if (data.kind === 'failed') {
        const detail = typeof data.message === 'string' && data.message ? ` ${data.message}` : '';
        setStatus({ kind: 'failed', message: `The agents' page could not start.${detail}` });
        return;
      }
      if (data.kind === 'panel-tabs') {
        panelTabs.current = readPanelTabs(data as { left?: unknown; tabs?: unknown; add?: unknown });
        syncStripRef.current();
        return;
      }
      if (data.kind === 'request' && typeof data.id === 'string' && typeof data.method === 'string') {
        const id = data.id;
        const args = Array.isArray(data.args) ? data.args : [];
        const asked = data.method === 'preview' && previews.current ? previews.current.ask(args[0]) : answer(data.method, args);
        asked.then(
          (value) => post({ kind: 'response', id, ok: true, value }),
          (error: unknown) => post({ kind: 'response', id, ok: false, error: error instanceof Error ? error.message : String(error) }),
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, post]);

  useEffect(() => {
    if (shown) post({ kind: 'scope', driver: harnessById(harness).driver });
  }, [harness, shown, post]);

  // A window captured with the agents' shortcut lands in an agent tab's composer, so one comes to the front.
  useEffect(
    () =>
      onDesktopMessage((message) => {
        if (message.kind !== 'snapshot') return;
        post({ kind: 'snapshot', event: message.event });
        if (message.event.type === 'ready') openHarnessTab($harnessLast.get() ?? harness);
      }),
    [harness, post],
  );

  useEffect(() => {
    if (shown) post({ kind: 'theme', isLight, palette });
  }, [isLight, palette, shown, post]);

  // Willow's breakpoints are its window's width, rail included, which the frame is narrower than:
  // the agents' page lays itself out by this width, so the two change layout at the same sizes.
  useEffect(() => {
    if (!shown) return;
    const tell = () => post({ kind: 'viewport', width: window.innerWidth });
    tell();
    window.addEventListener('resize', tell);
    return () => window.removeEventListener('resize', tell);
  }, [shown, post]);

  useEffect(() => previews.current?.setShown(visible && shown), [visible, shown]);

  // A loaded page reports its tabs again; until then the last page's have gone with it.
  useEffect(() => {
    panelTabs.current = null;
  }, [attempt, status]);

  // The panel's left edge moves with the frame (the sidebar, the window), and the tabs go with
  // this tab when another destination comes to the front.
  useEffect(() => {
    syncStrip();
    if (!hasStripPanelTabs()) return;
    const element = frame.current;
    const observer = new ResizeObserver(() => syncStripRef.current());
    if (element) observer.observe(element);
    window.addEventListener('resize', syncStrip);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncStrip);
    };
  }, [syncStrip, attempt, status]);

  // Willow's destinations slide in, which moves the frame without resizing it: its edge is
  // followed while the tab comes to the front, and again whenever a transition settles.
  useEffect(() => {
    if (!visible || !hasStripPanelTabs()) return;
    let frames = 0;
    let request = 0;
    const follow = () => {
      syncStripRef.current();
      frames += 1;
      if (frames < 45) request = requestAnimationFrame(follow);
    };
    request = requestAnimationFrame(follow);
    const settled = () => syncStripRef.current();
    document.addEventListener('transitionend', settled, true);
    document.addEventListener('animationend', settled, true);
    return () => {
      cancelAnimationFrame(request);
      document.removeEventListener('transitionend', settled, true);
      document.removeEventListener('animationend', settled, true);
    };
  }, [visible]);

  useEffect(() => {
    const token = stripToken.current;
    return () => {
      if (stripOwner !== token) return;
      stripOwner = null;
      setStripPanelTabs(null);
    };
  }, []);

  useEffect(
    () =>
      onDesktopMessage((message) => {
        if (message.kind !== 'panel-tab' || stripOwner !== stripToken.current) return;
        const box = frame.current?.getBoundingClientRect();
        if (!box) return;
        const inFrame = (x: number) => x / window.devicePixelRatio - box.left;
        post({ kind: 'panel-tab', action: message.action, id: message.id, left: inFrame(message.left), right: inFrame(message.right) });
      }),
    [post],
  );

  // A page loaded in place of the frame's opens its own browser tabs.
  useEffect(() => () => previews.current?.reset(), [attempt, status]);

  useEffect(
    () =>
      onDesktopMessage((message) => {
        if (message.kind !== 'harness-preview') return;
        // A click in a browser tab never reaches this page: Willow's menus close as on any click away.
        if (message.focused) frame.current?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        post({ kind: 'preview', id: message.id, state: message.state, focused: message.focused === true });
      }),
    [post],
  );

  const src =
    status.kind === 'ready'
      ? `${status.connection.url}/#willow=${encodeURIComponent(
          JSON.stringify({
            token: status.connection.token,
            driver: harnessById(initial.current.harness).driver,
            isLight: initial.current.isLight,
            palette: initial.current.palette,
            nativePreview: hasHarnessPreview(),
            stripTabs: hasStripPanelTabs(),
            viewportWidth: initial.current.viewportWidth,
          }),
        )}`
      : null;

  return (
    <div className={`willow-harness${isLight ? ' willow-harness--light' : ''}`} style={{ display: visible ? undefined : 'none' }}>
      {src && (
        <iframe
          key={attempt}
          ref={frame}
          className="willow-harness__frame"
          title={harnessById(harness).label}
          src={src}
          allow="clipboard-read; clipboard-write; microphone; camera; fullscreen; display-capture"
          style={{ visibility: shown ? 'visible' : 'hidden' }}
        />
      )}
      {!shown && <HarnessCover harness={harness} isLight={isLight} status={status} onRetry={connect} />}
    </div>
  );
}

/** What the tab shows until the agents' page is up: Media's loading page while it starts (every tab
 *  loads behind it), and the agent with what went wrong if it could not. */
function HarnessCover({ harness, isLight, status, onRetry }: { harness: HarnessId; isLight: boolean; status: Status; onRetry: () => void }) {
  const Mark = HARNESS_MARKS[harness];
  const { label } = harnessById(harness);
  if (status.kind !== 'failed') return <FlowLoadingPage disclaimer="Starting the agents. The first time takes a little longer." />;
  return (
    <div className="willow-harness__cover" role="status" aria-live="polite">
      <Mark size={40} brand isLight={isLight} />
      <div className="willow-harness__cover-title">{label}</div>
      <p className="willow-harness__cover-text">{status.message}</p>
      <button type="button" className="willow-harness__retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
