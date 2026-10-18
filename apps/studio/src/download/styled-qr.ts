import { createQrModules, type QrModules } from '@willow/spark/codex/ui/qr-code-encoder';

/**
 * Gemini's download QR, drawn the way its SVG is (qr-code-styling): a lone module is a dot, one
 * at the end of a run gets a half-round cap, one at a bend gets its outer corner rounded, the rest
 * are squares; the finder rings are rounded 2.5 modules out and 1.5 in, around square centres;
 * there is no quiet zone (the card around it is the margin). 37 modules a side, as Gemini's.
 *
 * Shapes are in module units. `dots` is meant as one clip path, so touching modules show no seams.
 */
export interface StyledQr {
  size: number;
  dots: string;
  /** The three finder rings and their centres, drawn with `fill-rule: evenodd`. */
  finders: string;
}

export const GEMINI_QR_VERSION = 5;

/** Gemini's density when the address fits it (error correction Q, as qr-code-styling defaults to); larger otherwise. */
export const qrModulesFor = (value: string): QrModules => {
  try {
    return createQrModules(value, { errorCorrectionLevel: 'Q', version: GEMINI_QR_VERSION });
  } catch {
    return createQrModules(value, { errorCorrectionLevel: 'Q' });
  }
};

const inFinder = (size: number, x: number, y: number): boolean =>
  (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);

const dotShape = (x: number, y: number, left: boolean, right: boolean, top: boolean, bottom: boolean): string => {
  const neighbours = +left + +right + +top + +bottom;
  if (neighbours === 0) return `M${x} ${y + 0.5}a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0z`;
  if (neighbours > 2 || (left && right) || (top && bottom)) return `M${x} ${y}h1v1h-1z`;
  if (neighbours === 2) {
    if (left && bottom) return `M${x} ${y}v1h1v-.5a.5 .5 0 0 0 -.5 -.5z`;
    if (left && top) return `M${x} ${y}h1v.5a.5 .5 0 0 1 -.5 .5h-.5z`;
    if (top && right) return `M${x + 1} ${y}v1h-.5a.5 .5 0 0 1 -.5 -.5v-.5z`;
    return `M${x + 1} ${y + 1}h-1v-.5a.5 .5 0 0 1 .5 -.5h.5z`;
  }
  if (left) return `M${x} ${y}v1h.5a.5 .5 0 0 0 0 -1z`;
  if (right) return `M${x + 1} ${y}v1h-.5a.5 .5 0 0 1 0 -1z`;
  if (top) return `M${x} ${y}h1v.5a.5 .5 0 0 1 -1 0z`;
  return `M${x} ${y + 1}h1v-.5a.5 .5 0 0 0 -1 0z`;
};

const finderShape = (x: number, y: number): string =>
  `M${x} ${y + 2.5}v2a2.5 2.5 0 0 0 2.5 2.5h2a2.5 2.5 0 0 0 2.5 -2.5v-2a2.5 2.5 0 0 0 -2.5 -2.5h-2a2.5 2.5 0 0 0 -2.5 2.5z`
  + `M${x + 2.5} ${y + 1}h2a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1 -1.5 1.5h-2a1.5 1.5 0 0 1 -1.5 -1.5v-2a1.5 1.5 0 0 1 1.5 -1.5z`
  + `M${x + 2} ${y + 2}h3v3h-3z`;

export const styledQr = ({ size, data }: QrModules): StyledQr => {
  const dark = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < size && y < size && !inFinder(size, x, y) && data[y * size + x];
  let dots = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (dark(x, y)) dots += dotShape(x, y, dark(x - 1, y), dark(x + 1, y), dark(x, y - 1), dark(x, y + 1));
    }
  }
  return { size, dots, finders: finderShape(0, 0) + finderShape(size - 7, 0) + finderShape(0, size - 7) };
};
