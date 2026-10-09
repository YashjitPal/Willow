import { map } from 'nanostores';
import { base64ToBlob } from '@willow/core/attachments';
import { onRemoteFrameEvent, disposeRemoteFrame, ensureRemoteFrame, remoteFrameState } from './remote-browser-frames';
import {
  keepRemoteBrowserShot,
  nextRemoteBrowserShot,
  readRemoteBrowserHistory,
  writeRemoteBrowserShotsToDisk,
  type RemoteBrowserShot,
} from './remote-browser-shots';
import { onSparkDiskAttached } from '../spark-disk';

export type { RemoteBrowserShot } from './remote-browser-shots';

/**
 * Gemini's pane has three looks: the "Preparing your computer…" loader while the
 * VM boots, the live stream while the agent works, and the same stream at rest
 * once it has finished.
 */
export type RemoteBrowserPhase = 'preparing' | 'live' | 'idle';

export interface RemoteBrowserSession {
  taskId: string;
  phase: RemoteBrowserPhase;
  /** The browser agent is acting on the page right now. */
  agentActive: boolean;
  url: string;
  title: string;
  favicon: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /**
   * What the agent saw, oldest first: the viewer's previous/next history. Kept in
   * IndexedDB and the task's folder (`./remote-browser-shots`), so it outlives a reload;
   * this list holds where each one is, and the viewer loads the one it shows.
   */
  shots: RemoteBrowserShot[];
  /** The agent's pointer, in page CSS px. */
  cursor: { x: number; y: number; at: number } | null;
  paneOpen: boolean;
  /** "Take over task": the user is driving and the agent waits. */
  inControl: boolean;
  /**
   * At 960px and below, Gemini opens the pane over the whole screen
   * (`computer-use-panel.fullscreen-panel`) and keeps it there until a take-over is
   * handed back, when it drops into the side panel's card. Opening it again fills the
   * screen again.
   */
  fullscreen: boolean;
}

export const remoteBrowserSessions = map<Record<string, RemoteBrowserSession>>({});

const unbind = new Map<string, () => void>();
/** Each session's saved history, read once when the session is made. */
const histories = new Map<string, Promise<void>>();

const restoreHistory = async (taskId: string): Promise<void> => {
  const saved = await readRemoteBrowserHistory(taskId);
  const current = remoteBrowserSessions.get()[taskId];
  if (!current || saved.length === 0) return;
  const restored = new Set(saved.map((shot) => shot.index));
  const shots = [...saved, ...current.shots.filter((shot) => !restored.has(shot.index))];
  updateRemoteBrowserSession(taskId, { shots });
  // An old task's screenshots reach a folder connected since they were taken.
  void writeRemoteBrowserShotsToDisk(taskId, shots, shots);
};

onSparkDiskAttached(() => {
  for (const session of Object.values(remoteBrowserSessions.get())) {
    if (session.shots.length) void writeRemoteBrowserShotsToDisk(session.taskId, session.shots, session.shots);
  }
});
const pageListeners = new Set<(taskId: string, page: { url: string; title: string; favicon: string }) => void>();

/** Told whenever a task's page changes, so the task can remember where its browser was. */
export const onRemoteBrowserPage = (listener: (taskId: string, page: { url: string; title: string; favicon: string }) => void): (() => void) => {
  pageListeners.add(listener);
  return () => {
    pageListeners.delete(listener);
  };
};

export const getRemoteBrowserSession = (taskId: string): RemoteBrowserSession | undefined => remoteBrowserSessions.get()[taskId];

export const updateRemoteBrowserSession = (taskId: string, patch: Partial<RemoteBrowserSession>) => {
  const current = remoteBrowserSessions.get()[taskId];
  if (!current) return;
  remoteBrowserSessions.setKey(taskId, { ...current, ...patch });
};

/**
 * The task's session, created idle (and its frame parked on `seed.url`) the first time.
 * `loadFrameAfterMs` holds the frame's first page back; see `ensureRemoteFrame`.
 */
export const ensureRemoteBrowserSession = (
  taskId: string,
  seed: Partial<Pick<RemoteBrowserSession, 'url' | 'title' | 'favicon'>> = {},
  { loadFrameAfterMs = 0 }: { loadFrameAfterMs?: number } = {},
): RemoteBrowserSession => {
  const existing = remoteBrowserSessions.get()[taskId];
  if (existing) return existing;
  ensureRemoteFrame(taskId, seed.url, { loadAfterMs: loadFrameAfterMs });
  const live = remoteFrameState(taskId);
  const session: RemoteBrowserSession = {
    taskId,
    phase: 'idle',
    agentActive: false,
    url: live?.url || seed.url || '',
    title: live?.title || seed.title || '',
    favicon: live?.favicon || seed.favicon || '',
    loading: live?.loading ?? Boolean(seed.url),
    canGoBack: live?.canGoBack ?? false,
    canGoForward: live?.canGoForward ?? false,
    shots: [],
    cursor: null,
    paneOpen: false,
    inControl: false,
    fullscreen: true,
  };
  remoteBrowserSessions.setKey(taskId, session);
  histories.set(taskId, restoreHistory(taskId).catch(() => undefined));
  unbind.set(taskId, onRemoteFrameEvent(taskId, (event) => {
    if (event.event === 'ready' || event.event === 'state') {
      const before = remoteBrowserSessions.get()[taskId];
      updateRemoteBrowserSession(taskId, {
        url: event.url,
        title: event.title,
        favicon: event.favicon,
        loading: event.loading,
        canGoBack: event.canGoBack,
        canGoForward: event.canGoForward,
      });
      if (event.event === 'state' && !event.loading && (before?.url !== event.url || before?.title !== event.title)) {
        pageListeners.forEach((listener) => listener(taskId, { url: event.url, title: event.title, favicon: event.favicon }));
      }
    } else if (event.event === 'unload') {
      updateRemoteBrowserSession(taskId, { loading: true });
    }
  }));
  return session;
};

/**
 * Adds what the agent just saw to the history and keeps it. Numbered after the saved
 * history, which is waited for, so a run after a reload continues it rather than
 * overwriting its first steps.
 */
export const pushRemoteBrowserShot = (taskId: string, shot: { dataUrl: string; url: string; title: string }) => {
  if (!remoteBrowserSessions.get()[taskId]) return;
  const at = Date.now();
  const mimeType = /^data:([^;,]+)/.exec(shot.dataUrl)?.[1] || 'image/jpeg';
  let blob: Blob;
  try {
    blob = base64ToBlob(shot.dataUrl, mimeType);
  } catch {
    return;
  }
  void (histories.get(taskId) ?? Promise.resolve()).then(() => {
    const current = remoteBrowserSessions.get()[taskId];
    if (!current) return;
    const next = nextRemoteBrowserShot(current.shots, { url: shot.url, title: shot.title, at });
    const shots = [...current.shots, next];
    updateRemoteBrowserSession(taskId, { shots });
    void keepRemoteBrowserShot(taskId, next, blob, shots);
  });
};

/**
 * A browser the page has not loaded yet starts loading once the pane has grown in
 * (450ms): loading on Willow's main thread, it would drop that motion's frames.
 */
export const openRemoteBrowserPane = (taskId: string, seed?: Partial<Pick<RemoteBrowserSession, 'url' | 'title' | 'favicon'>>) => {
  ensureRemoteBrowserSession(taskId, seed, { loadFrameAfterMs: 480 });
  updateRemoteBrowserSession(taskId, { paneOpen: true, fullscreen: true });
};

export const closeRemoteBrowserPane = (taskId: string) => {
  updateRemoteBrowserSession(taskId, { paneOpen: false, inControl: false });
};

export const setRemoteBrowserControl = (taskId: string, inControl: boolean) => {
  // Handing a take-over back leaves the narrow pane in the card, as Gemini's does.
  updateRemoteBrowserSession(taskId, inControl ? { inControl } : { inControl, fullscreen: false });
};

export const disposeRemoteBrowserSession = (taskId: string) => {
  unbind.get(taskId)?.();
  unbind.delete(taskId);
  histories.delete(taskId);
  disposeRemoteFrame(taskId);
  const next = { ...remoteBrowserSessions.get() };
  delete next[taskId];
  remoteBrowserSessions.set(next);
};
