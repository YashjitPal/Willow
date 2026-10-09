/**
 * A picture of what the preview shows right now.
 *
 * The browser has no API for screenshotting a frame, so the frame's DOM is
 * rendered to a canvas — it is same-origin, so its live styles are readable.
 * `html2canvas` does that for most apps; it cannot parse some newer CSS
 * (`oklch()`, `color-mix()`), and for those `html-to-image`, which lets the
 * browser itself render through an SVG, is the fallback. Only the visible
 * viewport is captured, downscaled so the longest side is at most 1280px: the
 * size vision models read best, and small enough to send every step.
 */

export interface Screenshot {
  /** Base64 JPEG, without the data-URL prefix. */
  data: string;
  mimeType: 'image/jpeg';
  /** Size of the image in pixels. */
  width: number;
  height: number;
  /** Image pixels per CSS pixel of the frame. */
  scale: number;
}

const MAX_SIDE = 1280;
const QUALITY = 0.82;

const isTransparent = (color: string): boolean =>
  !color || color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color);

/** What the page paints behind its content, for the canvas to start from. */
function pageBackground(win: Window, doc: Document): string {
  const body = doc.body ? win.getComputedStyle(doc.body).backgroundColor : '';
  if (!isTransparent(body)) return body;
  const html = win.getComputedStyle(doc.documentElement).backgroundColor;
  return isTransparent(html) ? '#ffffff' : html;
}

async function withHtml2Canvas(doc: Document, win: Window, width: number, height: number, scale: number, background: string): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas');
  return html2canvas(doc.documentElement, {
    x: win.scrollX,
    y: win.scrollY,
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    scale,
    backgroundColor: background,
    useCORS: true,
    allowTaint: false,
    logging: false,
    imageTimeout: 4000,
  });
}

async function withHtmlToImage(doc: Document, win: Window, width: number, height: number, scale: number, background: string): Promise<HTMLCanvasElement> {
  const { toCanvas } = await import('html-to-image');
  const root = doc.body ?? doc.documentElement;
  return toCanvas(root, {
    width,
    height,
    canvasWidth: Math.round(width * scale),
    canvasHeight: Math.round(height * scale),
    pixelRatio: 1,
    backgroundColor: background,
    skipFonts: true,
    style: { transform: `translate(${-win.scrollX}px, ${-win.scrollY}px)`, transformOrigin: '0 0' },
  });
}

export async function captureFrame(iframe: HTMLIFrameElement): Promise<Screenshot | null> {
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc?.documentElement || !win) return null;
  const width = win.innerWidth || iframe.clientWidth;
  const height = win.innerHeight || iframe.clientHeight;
  if (width < 16 || height < 16) return null;

  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const background = pageBackground(win, doc);

  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = await withHtml2Canvas(doc, win, width, height, scale, background);
  } catch {
    try {
      canvas = await withHtmlToImage(doc, win, width, height, scale, background);
    } catch {
      canvas = null;
    }
  }
  if (!canvas || canvas.width < 2 || canvas.height < 2) return null;

  let url: string;
  try {
    url = canvas.toDataURL('image/jpeg', QUALITY);
  } catch {
    // A cross-origin image tainted the canvas.
    return null;
  }
  return {
    data: url.slice(url.indexOf(',') + 1),
    mimeType: 'image/jpeg',
    width: canvas.width,
    height: canvas.height,
    scale: canvas.width / width,
  };
}
