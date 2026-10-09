/**
 * How a bot sees a screen — its own computer's, or the user's — and says where on it to act.
 *
 * Models do not point the same way. Gemini (and GLM) are trained to give positions on a 1000 × 1000 grid laid over a
 * picture, whatever its size. Claude and GPT give pixels of the picture as they received it — after their API has
 * shrunk anything larger than it takes: Anthropic's past about 1.15 megapixels or 1,568 pixels on a side, OpenAI's
 * to 768 on the short side. A screenshot sent larger than that, with positions asked for in its own pixels, is
 * clicked wrong by however much it was shrunk, worst towards the bottom right. So every picture goes at a size the
 * model's API keeps, the bot is told which space its positions are in, and each position it gives comes back to the
 * screen's own pixels here.
 *
 * Pictures are drawn with the window's canvas (`createImageBitmap`, `OffscreenCanvas`): scaled, marked where the bot
 * just acted, or cut down to a closer look with rulers in the bot's own positions. Where there is no canvas the
 * picture goes as it came, and its positions are its own pixels.
 */

/** How a model gives a position: on a 1000 × 1000 grid over the picture, or in the picture's pixels. */
export type PointSpace = 'grid' | 'pixels';

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface VisionProfile {
  space: PointSpace;
  /** The picture for a screen of this size: as large as the model's API takes without shrinking it. */
  fit: (screen: Size) => Size;
}

/** Where a picture of a screen stands: the screen's pixels, the picture the bot saw, and how it points on it. */
export interface ScreenGeometry {
  screen: Size;
  picture: Size;
  space: PointSpace;
}

export interface Picture {
  /** Base64. */
  data: string;
  width: number;
  height: number;
  mimeType?: string;
}

/** Something to draw on a picture, at a point on the screen: where a click landed, or where a drag began and ended. */
export interface Mark {
  at: Point;
  kind: 'point' | 'from';
}

export interface RenderPlan {
  /** The picture's size. */
  size: Size;
  /** The part of the screen shown, in its pixels; all of it when absent. */
  crop?: { left: number; top: number; width: number; height: number };
  marks?: Mark[];
  /** Rulers along the top and the left, labelled in the bot's own positions on the screen. */
  rulers?: ScreenGeometry;
}

export type RenderPicture = (source: Picture, plan: RenderPlan) => Promise<Picture | null>;

/** A bot's eyes for this turn: how its model points, and how pictures are drawn for it. */
export interface DotVision {
  profile: VisionProfile;
  render: RenderPicture;
}

export const GRID = 1000;

const shrink = (screen: Size, factor: number): Size => (factor >= 1
  ? { width: screen.width, height: screen.height }
  : { width: Math.max(1, Math.floor(screen.width * factor)), height: Math.max(1, Math.floor(screen.height * factor)) });

const PROFILES = {
  // A grid does not care about size; past 1920 a side only the upload grows.
  grid: { space: 'grid', fit: (screen) => shrink(screen, 1920 / Math.max(screen.width, screen.height)) },
  claude: { space: 'pixels', fit: (screen) => shrink(screen, Math.min(1568 / Math.max(screen.width, screen.height), Math.sqrt(1_150_000 / (screen.width * screen.height)))) },
  // OpenAI's, and the size any other API keeps: 768 on the short side.
  pixels: { space: 'pixels', fit: (screen) => shrink(screen, Math.min(2048 / Math.max(screen.width, screen.height), 768 / Math.min(screen.width, screen.height))) },
} satisfies Record<string, VisionProfile>;

/** How the model in use points, from its provider and its name (a gateway's model names its maker). */
export const visionProfile = (provider?: string, model?: string): VisionProfile => {
  const id = `${provider ?? ''} ${model ?? ''}`.toLowerCase();
  if (/claude|anthropic/.test(id)) return PROFILES.claude;
  if (/gemini|gemma|\bglm|zhipu/.test(id)) return PROFILES.grid;
  return PROFILES.pixels;
};

export const geometryFor = (profile: VisionProfile, screen: Size, picture: Size = profile.fit(screen)): ScreenGeometry => ({ screen, picture, space: profile.space });

/** A position the bot gave, as the screen's pixel; null when it is off the picture. */
export const toScreen = (geometry: ScreenGeometry, point: Point): Point | null => {
  const { screen, picture } = geometry;
  const span = geometry.space === 'grid' ? { width: GRID, height: GRID } : picture;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (point.x < 0 || point.y < 0 || point.x > span.width || point.y > span.height) return null;
  return {
    x: Math.min(screen.width - 1, Math.round((point.x * screen.width) / span.width)),
    y: Math.min(screen.height - 1, Math.round((point.y * screen.height) / span.height)),
  };
};

/** A pixel of the screen, as the bot would give it. */
export const fromScreen = (geometry: ScreenGeometry, point: Point): Point => {
  const span = geometry.space === 'grid' ? { width: GRID, height: GRID } : geometry.picture;
  return {
    x: Math.round((point.x * span.width) / geometry.screen.width),
    y: Math.round((point.y * span.height) / geometry.screen.height),
  };
};

/** The positions the bot uses, in words: for a tool's description, before it has seen a picture. */
export const pointsIn = (space: PointSpace): string => (space === 'grid'
  ? 'positions on a 1000 × 1000 grid over your latest screenshot: x from 0 at its left edge to 1000 at its right, y from 0 at the top to 1000 at the bottom'
  : 'positions in pixels of your latest screenshot as you received it, from its top left corner');

/** What a screenshot's result says about pointing on it. */
export const howToPoint = (geometry: ScreenGeometry): string => (geometry.space === 'grid'
  ? 'Give positions on it on a 1000 × 1000 grid: x from 0 at the left edge to 1000 at the right, y from 0 at the top to 1000 at the bottom.'
  : `It comes as a picture of ${geometry.picture.width}×${geometry.picture.height} pixels; give positions in its pixels, from its top left corner.`);

/** A region the bot named — its top left and its size, in its own positions — as screen pixels, kept on the screen. */
export const regionOnScreen = (geometry: ScreenGeometry, region: { x: number; y: number; width: number; height: number }) => {
  const from = toScreen(geometry, { x: region.x, y: region.y });
  const span = geometry.space === 'grid' ? GRID : undefined;
  const to = toScreen(geometry, {
    x: Math.min(region.x + region.width, span ?? geometry.picture.width),
    y: Math.min(region.y + region.height, span ?? geometry.picture.height),
  });
  if (!from || !to || to.x - from.x < 4 || to.y - from.y < 4) return null;
  return { left: from.x, top: from.y, width: to.x - from.x, height: to.y - from.y };
};

/* ------------------------------------------------------------------------ */
/* Drawing                                                                   */
/* ------------------------------------------------------------------------ */

const RULER = 26;

const decodeBase64 = (data: string): Uint8Array => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};

/** A step for ticks across `span` positions that leaves about eight of them, on a round number. */
const tickStep = (span: number): number => {
  const rough = span / 8;
  const power = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  return [1, 2, 5, 10].map((multiple) => multiple * power).find((step) => step >= rough) ?? 10 * power;
};

type Context2D = OffscreenCanvasRenderingContext2D;

/** A thin ring with a dot at its centre: plain enough to find, open enough not to hide what it landed on. */
const drawMark = (context: Context2D, at: Point, kind: Mark['kind'], scale: number) => {
  const radius = Math.max(6, Math.round((kind === 'from' ? 5 : 8) * scale));
  const line = Math.max(1.5, 2 * scale);
  context.save();
  context.lineWidth = line + 2;
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  context.beginPath();
  context.arc(at.x, at.y, radius, 0, Math.PI * 2);
  context.stroke();
  context.lineWidth = line;
  context.strokeStyle = 'rgb(255, 32, 200)';
  context.beginPath();
  context.arc(at.x, at.y, radius, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = 'rgb(255, 32, 200)';
  context.beginPath();
  context.arc(at.x, at.y, Math.max(1.25, 1.5 * scale), 0, Math.PI * 2);
  context.fill();
  context.restore();
};

/** Rulers along the top and left of a closer look, labelled in the bot's positions, with faint lines across. */
const drawRulers = (context: Context2D, plan: RenderPlan, crop: NonNullable<RenderPlan['crop']>) => {
  const geometry = plan.rulers!;
  const span = geometry.space === 'grid' ? { width: GRID, height: GRID } : geometry.picture;
  const toBot = (pixels: number, axis: 'x' | 'y') => (pixels * (axis === 'x' ? span.width / geometry.screen.width : span.height / geometry.screen.height));
  const toCanvas = (bot: number, axis: 'x' | 'y') => {
    const screen = axis === 'x' ? (bot * geometry.screen.width) / span.width : (bot * geometry.screen.height) / span.height;
    return axis === 'x'
      ? RULER + ((screen - crop.left) * plan.size.width) / crop.width
      : RULER + ((screen - crop.top) * plan.size.height) / crop.height;
  };
  context.fillStyle = 'rgb(24, 24, 28)';
  context.fillRect(0, 0, RULER + plan.size.width, RULER);
  context.fillRect(0, 0, RULER, RULER + plan.size.height);
  context.font = '600 12px system-ui, sans-serif';
  context.textBaseline = 'middle';
  for (const axis of ['x', 'y'] as const) {
    const start = toBot(axis === 'x' ? crop.left : crop.top, axis);
    const end = toBot(axis === 'x' ? crop.left + crop.width : crop.top + crop.height, axis);
    const step = tickStep(end - start);
    for (let value = Math.ceil(start / step) * step; value <= end; value += step) {
      const at = toCanvas(value, axis);
      context.strokeStyle = 'rgba(255, 32, 200, 0.38)';
      context.lineWidth = 1;
      context.beginPath();
      if (axis === 'x') {
        context.moveTo(at, RULER);
        context.lineTo(at, RULER + plan.size.height);
      } else {
        context.moveTo(RULER, at);
        context.lineTo(RULER + plan.size.width, at);
      }
      context.stroke();
      context.fillStyle = 'rgb(255, 255, 255)';
      const label = String(Math.round(value));
      if (axis === 'x') {
        context.textAlign = 'center';
        context.fillText(label, at, RULER / 2);
      } else {
        context.save();
        context.translate(RULER / 2, at);
        context.rotate(-Math.PI / 2);
        context.textAlign = 'center';
        context.fillText(label, 0, 0);
        context.restore();
      }
    }
  }
};

/** The window's canvas: a picture scaled, cut and marked as the plan says. Null where there is no canvas. */
export const canvasRender: RenderPicture = async (source, plan) => {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(new Blob([decodeBase64(source.data) as BlobPart], { type: source.mimeType ?? 'image/jpeg' }));
    const crop = plan.crop ?? { left: 0, top: 0, width: bitmap.width, height: bitmap.height };
    const margin = plan.rulers ? RULER : 0;
    const canvas = new OffscreenCanvas(plan.size.width + margin, plan.size.height + margin);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    // The source is the screen at its own size: a crop is in its pixels.
    const sx = bitmap.width / (source.width || bitmap.width);
    const sy = bitmap.height / (source.height || bitmap.height);
    context.drawImage(bitmap, crop.left * sx, crop.top * sy, crop.width * sx, crop.height * sy, margin, margin, plan.size.width, plan.size.height);
    bitmap.close();
    const scale = plan.size.width / crop.width;
    for (const mark of plan.marks ?? []) {
      const at = { x: margin + (mark.at.x - crop.left) * scale, y: margin + (mark.at.y - crop.top) * (plan.size.height / crop.height) };
      if (at.x < margin || at.y < margin || at.x > canvas.width || at.y > canvas.height) continue;
      drawMark(context, at, mark.kind, Math.max(1, Math.min(2, scale)));
    }
    if (plan.rulers) drawRulers(context, plan, crop);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
    return { data: encodeBase64(new Uint8Array(await blob.arrayBuffer())), width: canvas.width, height: canvas.height, mimeType: 'image/jpeg' };
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------------ */
/* Pictures for the bot                                                      */
/* ------------------------------------------------------------------------ */

/**
 * A screenshot as the bot is sent it — at the size its model's API keeps, marked where it just acted — and the
 * geometry its positions follow. Without a canvas it goes as it came, and its positions are its own pixels.
 */
export const viewOf = async (vision: DotVision | undefined, shot: Picture, marks: Mark[] = []): Promise<{ picture: Picture; geometry: ScreenGeometry; marked: boolean }> => {
  const screen = { width: shot.width, height: shot.height };
  if (!vision) return { picture: shot, geometry: { screen, picture: screen, space: 'pixels' }, marked: false };
  const size = vision.profile.fit(screen);
  const needed = size.width !== screen.width || size.height !== screen.height || marks.length > 0;
  const drawn = needed ? await vision.render(shot, { size, marks }) : null;
  if (drawn) return { picture: drawn, geometry: geometryFor(vision.profile, screen, size), marked: marks.length > 0 };
  // Not drawn: the picture is the screen as it is, and pixel positions are its own.
  return { picture: shot, geometry: geometryFor(vision.profile, screen, screen), marked: false };
};

/** The most a closer look magnifies, and the size it is drawn at. */
const ZOOM_MAX = 4;

/**
 * A closer look at part of a screen: that region magnified to the size the model's API keeps, with rulers in the
 * bot's own positions so it can act on what it sees there without leaving its usual space.
 */
export const closerLook = async (vision: DotVision, shot: Picture, geometry: ScreenGeometry, crop: NonNullable<RenderPlan['crop']>): Promise<{ picture: Picture; magnified: number } | null> => {
  const room = vision.profile.fit({ width: shot.width, height: shot.height });
  const factor = Math.min(ZOOM_MAX, (room.width - RULER) / crop.width, (room.height - RULER) / crop.height);
  if (!(factor > 0)) return null;
  const size = { width: Math.max(1, Math.floor(crop.width * factor)), height: Math.max(1, Math.floor(crop.height * factor)) };
  const drawn = await vision.render(shot, { size, crop, rulers: geometry });
  return drawn ? { picture: drawn, magnified: Math.round(factor * 10) / 10 } : null;
};
