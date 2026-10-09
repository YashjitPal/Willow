/**
 * The background browser agent behind Spark's `computer` tool.
 *
 * The main agent hands over one instruction; this runs Willow's computer-use loop
 * (`runComputerUseTask`) against the task's remote-browser frame until the
 * instruction is done, then hands back a report for the main agent to answer from.
 * The pane shows it happening: the loader while the first page loads, then the
 * live page, the agent's pointer and the screenshots it acted on.
 */

import {
  runComputerUseTask,
  type ComputerUseAction,
  type ComputerUseDriver,
} from '@willow/ai/computer-use/session';
import { displayUrl, normalizeBrowseTarget, SEARCH_HOME } from './browse-url';
import {
  callRemoteFrame,
  isRemoteFrameUnbridged,
  navigateRemoteFrame,
  remoteFrameDocumentVersion,
  remoteFrameState,
  SCREEN_WIDTH,
  stepRemoteFrame,
  VIEWPORT_HEIGHT,
} from './remote-browser-frames';
import {
  ensureRemoteBrowserSession,
  getRemoteBrowserSession,
  pushRemoteBrowserShot,
  updateRemoteBrowserSession,
} from './remote-browser-store';

export interface RemoteBrowserRequest {
  /** The short label the thread shows for this step. */
  title: string;
  /** The instruction the user approved and the browser agent follows. */
  task: string;
  /** Where to start, when the main agent knows. */
  url?: string;
}

export interface RemoteBrowserResult {
  completed: boolean;
  report: string;
  url: string;
  title: string;
}

export const REMOTE_BROWSER_SYSTEM_PROMPT = `You are the browser agent for Willow Spark. Spark's main agent gave you one task to carry out in a web browser. It will read your final report and answer the user from it, so the report is the only thing that leaves this browser.

How to work:
- The screenshot is the browser's viewport. Use exactly one action per turn, then wait for the next screenshot.
- Coordinates are normalized to a 1000x1000 grid over the screenshot.
- Go straight to the most direct page: use navigate with a full URL when you know it. Use search to open a search engine when you need to find a page, then type the query into its search box.
- To fill a field, use type_text_at on it; set press_enter to submit a search.
- Scroll to find content that is not visible. If an action did not change the page, do not repeat it; try something else.
- Do not sign in, buy, book, post, send, delete, or change any setting or data unless the task explicitly asks for it. Never type a password or payment details.
- If the page shows a CAPTCHA, a sign-in wall, or an error you cannot get past, stop and say so. Never try to solve or bypass a CAPTCHA.

When the task is done, or cannot be done, stop calling tools and write your report:
- Lead with the answer or the outcome, then the specific facts you found (names, numbers, dates, prices), as the page states them.
- Name the page or pages you used, with their URLs.
- Say plainly what you could not do and why.
Keep it short: a few sentences or a compact list.`;

/** Gemini's loader covers a VM boot. Ours covers one page load, held long enough not to flash. */
const MIN_PREPARING_MS = 1_400;
const PAGE_LOAD_TIMEOUT_MS = 20_000;
/**
 * How long a parsed page's images and trackers may hold back `load` before the
 * agent looks anyway. Wikipedia through the proxy can take over 20s to fire it.
 */
const LOAD_GRACE_MS = 3_000;
/** How long the pointer takes to glide to a target before the action lands. */
const POINTER_TRAVEL_MS = 320;

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(new DOMException('Browser task stopped.', 'AbortError'));
    return;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    reject(new DOMException('Browser task stopped.', 'AbortError'));
  };
  signal?.addEventListener('abort', onAbort, { once: true });
});

const waitUntil = async (predicate: () => boolean, timeoutMs: number, signal?: AbortSignal) => {
  const started = Date.now();
  while (!predicate() && Date.now() - started < timeoutMs) await sleep(100, signal);
  return predicate();
};

const pageLoaded = (taskId: string) => {
  const state = remoteFrameState(taskId);
  return Boolean(state && !state.loading);
};

const pageParsed = (taskId: string) => Boolean(remoteFrameState(taskId)?.parsed);

/** Until the page can be read, then a short grace for the rest of it to arrive. */
const waitForPage = async (taskId: string, signal?: AbortSignal) => {
  await waitUntil(() => pageParsed(taskId), PAGE_LOAD_TIMEOUT_MS, signal);
  await waitUntil(() => pageLoaded(taskId), LOAD_GRACE_MS, signal);
};

/** Normalized 0-1000 action coordinates as page CSS px. */
const pagePoint = (taskId: string, args: Record<string, unknown>, xKey = 'x', yKey = 'y') => {
  const x = Number(args[xKey]);
  const y = Number(args[yKey]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const state = remoteFrameState(taskId);
  const width = state?.width || SCREEN_WIDTH;
  const height = state?.height || VIEWPORT_HEIGHT;
  return { x: (x / 1000) * width, y: (y / 1000) * height };
};

/** Actions with no point of their own, so the pointer stays where it was. */
const POINTERLESS = new Set(['scroll_document', 'key_combination']);

const BRIDGE_OPS: Record<string, string> = {
  click_at: 'click',
  type_text_at: 'type',
  hover_at: 'hover',
  scroll_at: 'scroll',
  scroll_document: 'scroll',
  drag_and_drop: 'drag',
  key_combination: 'key',
};

const wrapText = (context: CanvasRenderingContext2D, text: string, width: number): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
};

/**
 * What the agent sees when a page cannot be captured: a stand-in laid out like
 * Chrome's own error page, so it still knows where it is and that it can leave.
 * `unbridged` is a page the proxy never reached (an error page, a PDF, a
 * download); otherwise the page is there but its capture kept failing.
 */
export const unreachablePageShot = (url: string, unbridged: boolean): string => {
  const canvas = document.createElement('canvas');
  canvas.width = SCREEN_WIDTH;
  canvas.height = VIEWPORT_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The page could not be captured.');
  const address = displayUrl(url) || 'This page';
  const shown = address.length > 72 ? `${address.slice(0, 71)}…` : address;
  const heading = unbridged ? 'This page can’t be shown in the remote browser' : 'This page couldn’t be captured';
  const body = unbridged
    ? `${shown} opened as something Willow can’t read or control, such as a PDF, a download or a browser error page.`
    : `${shown} is open, but Willow couldn’t take a picture of it.`;
  const left = (SCREEN_WIDTH - 600) / 2;
  let y = Math.round(VIEWPORT_HEIGHT * 0.14);

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, SCREEN_WIDTH, VIEWPORT_HEIGHT);
  context.strokeStyle = '#5f6368';
  context.fillStyle = '#5f6368';
  context.lineWidth = 4;
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(left + 12, y + 4);
  context.lineTo(left + 44, y + 4);
  context.lineTo(left + 60, y + 20);
  context.lineTo(left + 60, y + 68);
  context.lineTo(left + 12, y + 68);
  context.closePath();
  context.moveTo(left + 44, y + 4);
  context.lineTo(left + 44, y + 20);
  context.lineTo(left + 60, y + 20);
  context.stroke();
  for (const eye of [27, 45]) {
    context.beginPath();
    context.arc(left + eye, y + 38, 3, 0, Math.PI * 2);
    context.fill();
  }
  context.beginPath();
  context.arc(left + 36, y + 60, 8, Math.PI * 1.2, Math.PI * 1.8);
  context.stroke();
  y += 72 + 40;

  const family = '"Segoe UI", Roboto, Arial, sans-serif';
  context.textBaseline = 'top';
  context.fillStyle = '#202124';
  context.font = `500 24px ${family}`;
  for (const line of wrapText(context, heading, 600)) {
    context.fillText(line, left, y);
    y += 32;
  }
  y += 16;
  context.fillStyle = '#5f6368';
  context.font = `400 15px ${family}`;
  for (const paragraph of [body, 'Go back, or navigate to another page.']) {
    for (const line of wrapText(context, paragraph, 600)) {
      context.fillText(line, left, y);
      y += 23;
    }
    y += 15;
  }
  return canvas.toDataURL('image/jpeg', 0.82);
};

/** Willow's computer-use loop, pointed at the task's remote-browser frame. */
export const createRemoteBrowserDriver = (taskId: string, signal?: AbortSignal): ComputerUseDriver => {
  let versionAtAction = remoteFrameDocumentVersion(taskId);

  const waitWhileUserDrives = async () => {
    while (getRemoteBrowserSession(taskId)?.inControl) await sleep(300, signal);
  };

  const movePointer = async (point: { x: number; y: number } | null) => {
    if (!point) return;
    updateRemoteBrowserSession(taskId, { cursor: { x: point.x, y: point.y, at: Date.now() } });
    await sleep(POINTER_TRAVEL_MS, signal);
  };

  return {
    async settle(afterNavigation) {
      await waitWhileUserDrives();
      if (afterNavigation) {
        await waitUntil(() => remoteFrameDocumentVersion(taskId) > versionAtAction, 3_000, signal);
      } else {
        // A click can start a navigation a moment after it lands.
        await sleep(350, signal);
      }
      await waitForPage(taskId, signal);
      await sleep(400, signal);
    },

    async screenshot() {
      await waitWhileUserDrives();
      let shot: { dataUrl: string; url: string; title: string } | null = null;
      for (let attempt = 0; attempt < 3 && !shot && !isRemoteFrameUnbridged(taskId); attempt += 1) {
        try {
          shot = await callRemoteFrame<{ dataUrl: string; url: string; title: string }>(taskId, 'screenshot', {}, 25_000);
        } catch {
          if (attempt < 2 && !isRemoteFrameUnbridged(taskId)) {
            await waitUntil(() => pageParsed(taskId), PAGE_LOAD_TIMEOUT_MS, signal);
            await sleep(500, signal);
          }
        }
      }
      // A page that cannot be captured must not end the task: the agent is shown
      // where it is instead, and can go back or elsewhere.
      if (!shot) {
        const url = remoteFrameState(taskId)?.url || '';
        shot = { dataUrl: unreachablePageShot(url, isRemoteFrameUnbridged(taskId)), url, title: displayUrl(url) };
      }
      pushRemoteBrowserShot(taskId, { dataUrl: shot.dataUrl, url: shot.url, title: shot.title });
      const comma = shot.dataUrl.indexOf(',');
      const mimeType = /^data:([^;,]+)/.exec(shot.dataUrl)?.[1] || 'image/jpeg';
      return { data: shot.dataUrl.slice(comma + 1), mimeType };
    },

    async execute(action: ComputerUseAction) {
      await waitWhileUserDrives();
      versionAtAction = remoteFrameDocumentVersion(taskId);
      const args = action.args ?? {};
      try {
        switch (action.name) {
          case 'navigate': {
            const target = normalizeBrowseTarget(String(args.url ?? ''));
            if (!target) return { success: false, error: 'Only http and https pages can be opened.' };
            navigateRemoteFrame(taskId, target);
            return { success: true };
          }
          case 'search':
            navigateRemoteFrame(taskId, SEARCH_HOME);
            return { success: true };
          case 'go_back':
          case 'go_forward':
            return await stepRemoteFrame(taskId, action.name === 'go_back' ? 'back' : 'forward');
          case 'open_web_browser':
            return { success: true };
          case 'wait_5_seconds':
            await sleep(5_000, signal);
            return { success: true };
          default: {
            const op = BRIDGE_OPS[action.name];
            if (!op) return { success: false, error: `Unknown action ${action.name}.` };
            if (!POINTERLESS.has(action.name)) await movePointer(pagePoint(taskId, args));
            const result = await callRemoteFrame<{ success: boolean; error?: string }>(
              taskId,
              op,
              action.name === 'scroll_document' ? { direction: args.direction } : args,
              15_000,
            );
            if (action.name === 'drag_and_drop') await movePointer(pagePoint(taskId, args, 'destination_x', 'destination_y'));
            return { success: Boolean(result?.success), error: result?.error };
          }
        }
      } catch (error) {
        // A click that navigated takes its page, and the reply, with it.
        if (remoteFrameDocumentVersion(taskId) > versionAtAction) return { success: true };
        return { success: false, error: error instanceof Error ? error.message : 'The page did not respond.' };
      }
    },

    url: () => remoteFrameState(taskId)?.url || getRemoteBrowserSession(taskId)?.url || '',
  };
};

export interface RunRemoteBrowserOptions {
  taskId: string;
  request: RemoteBrowserRequest;
  apiKey: string | undefined;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

/** Opens the pane, runs the request to completion, and returns the agent's report. */
export const runRemoteBrowserTask = async ({
  taskId,
  request,
  apiKey,
  signal,
  onProgress,
}: RunRemoteBrowserOptions): Promise<RemoteBrowserResult> => {
  const session = ensureRemoteBrowserSession(taskId);
  const startUrl = (request.url && normalizeBrowseTarget(request.url))
    || (session.url && session.url !== 'about:blank' ? session.url : '')
    || SEARCH_HOME;
  updateRemoteBrowserSession(taskId, {
    phase: 'preparing',
    agentActive: true,
    paneOpen: true,
    inControl: false,
    fullscreen: true,
    cursor: null,
  });
  const finish = (result: RemoteBrowserResult): RemoteBrowserResult => {
    updateRemoteBrowserSession(taskId, { phase: 'idle', agentActive: false, cursor: null });
    return result;
  };
  if (!apiKey) {
    return finish({
      completed: false,
      report: 'The remote browser needs a Gemini API key. Add one in Settings > Models, then try again.',
      url: startUrl,
      title: '',
    });
  }
  const preparedFrom = Date.now();
  try {
    if (remoteFrameState(taskId)?.url !== startUrl) navigateRemoteFrame(taskId, startUrl);
    await waitForPage(taskId, signal);
    await sleep(Math.max(0, preparedFrom + MIN_PREPARING_MS - Date.now()), signal);
    updateRemoteBrowserSession(taskId, { phase: 'live' });
    const result = await runComputerUseTask(
      apiKey,
      request.task,
      createRemoteBrowserDriver(taskId, signal),
      (update) => {
        if (update.type === 'action' || update.type === 'thinking') onProgress?.(update.message);
      },
      [],
      undefined,
      signal,
      { systemPrompt: REMOTE_BROWSER_SYSTEM_PROMPT, maxTurns: 24 },
    );
    const state = remoteFrameState(taskId);
    if (signal?.aborted) throw new DOMException('Browser task stopped.', 'AbortError');
    return finish({
      completed: result.completed,
      report: result.explanation,
      url: state?.url || startUrl,
      title: state?.title || '',
    });
  } catch (error) {
    finish({ completed: false, report: '', url: startUrl, title: '' });
    throw error;
  }
};
