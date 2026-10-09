/**
 * The agents' browser tabs on Windows (apps/desktop src-tauri/src/harness_preview.rs): webviews
 * of their own over this page, where the agents' page draws them. That page says where in its
 * own pixels, and what it draws over them there; this adds where its frame is, what Willow draws
 * over it (its menus, dialogs and tooltips), and whether the agent tabs are in front at all.
 */
import { harnessPreview, type HarnessPreviewArea } from '@willow/core/desktop-bridge';

/** An area of the agents' page, in its CSS pixels. */
interface FrameArea {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

interface Placement {
  bounds: FrameArea | null;
  holes: FrameArea[];
  zoom: number;
}

/** What Willow opens over the agents' page. */
const OVER_FRAME = '[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="tooltip"]';

/** How long after this page changes its surfaces are followed every frame: their opening motion. */
const FOLLOW_MS = 400;

export interface PreviewHost {
  /** A request from the agents' page. */
  ask(request: unknown): Promise<void>;
  /** Whether the agent tabs are in front, with the agents' page up. */
  setShown(shown: boolean): void;
  /** The agents' page went away: its tabs go with it. */
  reset(): void;
  dispose(): void;
}

const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const area = (value: unknown): FrameArea | null => {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const width = number(input.width);
  const height = number(input.height);
  if (width <= 0 || height <= 0) return null;
  return { x: number(input.x), y: number(input.y), width, height, radius: Math.max(0, number(input.radius)) };
};

const overlap = (rect: DOMRect, over: FrameArea): FrameArea | null => {
  const left = Math.max(rect.left, over.x);
  const top = Math.max(rect.top, over.y);
  const right = Math.min(rect.right, over.x + over.width);
  const bottom = Math.min(rect.bottom, over.y + over.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top, radius: 0 };
};

/** Willow's own surfaces over `over` (in this page's CSS pixels), each once, with their corners. */
const willowOver = (over: FrameArea): FrameArea[] => {
  const holes: FrameArea[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(OVER_FRAME)) {
    if (element.closest('.willow-harness') || element.parentElement?.closest(OVER_FRAME)) continue;
    const rect = element.getBoundingClientRect();
    const hole = overlap(rect, over);
    if (!hole) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const whole = hole.width === rect.width && hole.height === rect.height;
    holes.push({ ...hole, radius: whole ? Number.parseFloat(style.borderTopLeftRadius) || 0 : 0 });
  }
  return holes;
};

export function createPreviewHost(frame: () => HTMLIFrameElement | null): PreviewHost {
  const placements = new Map<string, Placement>();
  const sent = new Map<string, string>();
  let shown = false;
  let scheduled = 0;
  let followUntil = 0;

  const flush = () => {
    scheduled = 0;
    const element = frame();
    const box = element?.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const toPage = (from: FrameArea): HarnessPreviewArea => ({
      x: from.x * scale,
      y: from.y * scale,
      width: from.width * scale,
      height: from.height * scale,
      radius: from.radius * scale,
    });
    for (const [id, placement] of placements) {
      let bounds: HarnessPreviewArea | null = null;
      let holes: HarnessPreviewArea[] = [];
      if (shown && element && box && box.width > 0 && placement.bounds) {
        const left = box.left + element.clientLeft;
        const top = box.top + element.clientTop;
        const inPage = (from: FrameArea): FrameArea => ({ ...from, x: left + from.x, y: top + from.y });
        const at = inPage(placement.bounds);
        bounds = toPage(at);
        holes = [...placement.holes.map(inPage), ...willowOver(at)].map(toPage);
      }
      const request = { action: 'place', id, bounds, holes, zoom: placement.zoom * scale } as const;
      const key = JSON.stringify(request);
      if (sent.get(id) === key) continue;
      sent.set(id, key);
      void harnessPreview(request).catch(() => sent.delete(id));
    }
    if (performance.now() < followUntil) schedule();
  };

  const schedule = () => {
    if (!scheduled && placements.size > 0) scheduled = window.requestAnimationFrame(flush);
  };

  const follow = () => {
    followUntil = performance.now() + FOLLOW_MS;
    schedule();
  };

  // Willow's menus, dialogs and tooltips are mounted to open and unmounted once closed.
  const observer = new MutationObserver(follow);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);

  const reset = () => {
    placements.clear();
    sent.clear();
    void harnessPreview({ action: 'closeAll' }).catch(() => undefined);
  };

  return {
    ask(input) {
      const request = (input ?? {}) as Record<string, unknown>;
      const id = typeof request.id === 'string' ? request.id : '';
      switch (request.action) {
        case 'open':
          if (!id || typeof request.url !== 'string') return Promise.reject(new Error('Willow needs a tab and an address to open.'));
          return harnessPreview({ action: 'open', id, url: request.url });
        case 'place':
          if (!id) return Promise.resolve();
          placements.set(id, {
            bounds: area(request.bounds),
            holes: Array.isArray(request.holes) ? request.holes.map(area).filter((hole): hole is FrameArea => hole !== null) : [],
            zoom: number(request.zoom) || 1,
          });
          follow();
          return Promise.resolve();
        case 'back':
        case 'forward':
        case 'reload':
        case 'stop':
          return id ? harnessPreview({ action: request.action, id }) : Promise.resolve();
        case 'close':
          placements.delete(id);
          sent.delete(id);
          return id ? harnessPreview({ action: 'close', id }) : Promise.resolve();
        case 'closeAll':
          reset();
          return Promise.resolve();
        default:
          return Promise.reject(new Error("Willow's browser does not do that."));
      }
    },
    setShown(next) {
      shown = next;
      schedule();
    },
    reset,
    dispose() {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (scheduled) window.cancelAnimationFrame(scheduled);
      reset();
    },
  };
}
