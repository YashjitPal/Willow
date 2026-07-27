/**
 * Willow Figma — canvas text measurement & line layout.
 *
 * A single shared offscreen 2D context measures text. `layoutText` produces
 * positioned lines for a TEXT node; the renderer, hit-testing and the text
 * editing overlay all use the same layout so what you see is what you edit.
 */

import type { SceneNode, TextStyleProps } from './types';

export const FONT_FAMILIES = [
  'Inter',
  'Arial',
  'Helvetica',
  'Segoe UI',
  'Roboto',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
  'Impact',
  'Comic Sans MS',
];

export const FONT_WEIGHTS: Array<{ value: number; label: string }> = [
  { value: 100, label: 'Thin' },
  { value: 200, label: 'Extra Light' },
  { value: 300, label: 'Light' },
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semi Bold' },
  { value: 700, label: 'Bold' },
  { value: 800, label: 'Extra Bold' },
  { value: 900, label: 'Black' },
];

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    measureCtx = canvas.getContext('2d')!;
  }
  return measureCtx;
}

/** CSS font shorthand for a text style. */
export function fontString(style: TextStyleProps): string {
  const italic = style.italic ? 'italic ' : '';
  const family = /\s/.test(style.fontFamily) ? `"${style.fontFamily}"` : style.fontFamily;
  return `${italic}${style.fontWeight} ${style.fontSize}px ${family}, sans-serif`;
}

export function lineHeightPx(style: TextStyleProps): number {
  const lh = style.lineHeight;
  if (lh.unit === 'PIXELS') return lh.value;
  if (lh.unit === 'PERCENT') return (style.fontSize * lh.value) / 100;
  return Math.round(style.fontSize * 1.21); // AUTO ≈ Figma's default
}

export function letterSpacingPx(style: TextStyleProps): number {
  const ls = style.letterSpacing;
  if (ls.unit === 'PIXELS') return ls.value;
  return (style.fontSize * ls.value) / 100;
}

export function applyTextCase(text: string, style: TextStyleProps): string {
  switch (style.textCase) {
    case 'UPPER':
      return text.toUpperCase();
    case 'LOWER':
      return text.toLowerCase();
    case 'TITLE':
      return text.replace(/\b\w/g, (ch) => ch.toUpperCase());
    default:
      return text;
  }
}

export function measureTextWidth(text: string, style: TextStyleProps): number {
  const ctx = getMeasureCtx();
  ctx.font = fontString(style);
  const base = ctx.measureText(text).width;
  const ls = letterSpacingPx(style);
  return base + (text.length > 0 ? ls * text.length : 0);
}

export interface TextLine {
  text: string;
  /** X offset inside the node (alignment applied). */
  x: number;
  /** Baseline-less: top of the line box inside the node. */
  y: number;
  width: number;
}

export interface TextLayout {
  lines: TextLine[];
  /** Natural (unwrapped or wrapped) content extents. */
  width: number;
  height: number;
  lineHeight: number;
  fontAscentRatio: number; // approx: where to place the baseline within a line box
}

/**
 * Wrap `characters` into lines for the given box width. When
 * `textAutoResize === 'WIDTH_AND_HEIGHT'` no wrapping occurs (width grows).
 */
export function layoutText(node: Pick<SceneNode, 'characters' | 'textStyle' | 'width' | 'height'>): TextLayout {
  const style = node.textStyle;
  const lh = lineHeightPx(style);
  const cased = applyTextCase(node.characters ?? '', style);
  const paragraphs = cased.split('\n');
  const noWrap = style.textAutoResize === 'WIDTH_AND_HEIGHT';
  const maxWidth = noWrap ? Infinity : Math.max(node.width, 1);

  const rawLines: string[] = [];
  for (const para of paragraphs) {
    if (noWrap || measureTextWidth(para, style) <= maxWidth) {
      rawLines.push(para);
      continue;
    }
    // Greedy word wrap with mid-word breaking for oversize words.
    const words = para.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (measureTextWidth(candidate, style) <= maxWidth || line === '') {
        if (line === '' && measureTextWidth(word, style) > maxWidth && word.trim() !== '') {
          // Break the long word by characters.
          let chunk = '';
          for (const ch of word) {
            if (measureTextWidth(chunk + ch, style) > maxWidth && chunk !== '') {
              rawLines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
        } else {
          line = candidate;
        }
      } else {
        rawLines.push(line.replace(/\s+$/, ''));
        line = word.trimStart();
      }
    }
    rawLines.push(line.replace(/\s+$/, ''));
  }

  const measured = rawLines.map((text) => ({ text, width: measureTextWidth(text, style) }));
  const contentWidth = Math.max(1, ...measured.map((l) => l.width));
  const paraSpacingTotal = 0; // paragraphSpacing folded into line advance below for simplicity
  const contentHeight = Math.max(lh, measured.length * lh + paraSpacingTotal);

  const boxWidth = noWrap ? contentWidth : Math.max(node.width, 1);
  const boxHeight = style.textAutoResize === 'NONE' ? Math.max(node.height, 1) : contentHeight;

  // Vertical alignment of the whole block inside the box.
  let offsetY = 0;
  if (style.textAlignVertical === 'CENTER') offsetY = (boxHeight - contentHeight) / 2;
  else if (style.textAlignVertical === 'BOTTOM') offsetY = boxHeight - contentHeight;

  const lines: TextLine[] = measured.map((l, i) => {
    let x = 0;
    if (style.textAlignHorizontal === 'CENTER') x = (boxWidth - l.width) / 2;
    else if (style.textAlignHorizontal === 'RIGHT') x = boxWidth - l.width;
    return { text: l.text, x, y: offsetY + i * lh, width: l.width };
  });

  return { lines, width: contentWidth, height: contentHeight, lineHeight: lh, fontAscentRatio: 0.8 };
}

/** Size a TEXT node according to its auto-resize mode. Returns [w, h]. */
export function autoSizeText(node: Pick<SceneNode, 'characters' | 'textStyle' | 'width' | 'height'>): {
  width: number;
  height: number;
} {
  const layout = layoutText(node);
  const style = node.textStyle;
  if (style.textAutoResize === 'WIDTH_AND_HEIGHT') {
    return { width: Math.max(4, Math.ceil(layout.width)), height: Math.max(style.fontSize, Math.ceil(layout.height)) };
  }
  if (style.textAutoResize === 'HEIGHT') {
    return { width: node.width, height: Math.max(style.fontSize, Math.ceil(layout.height)) };
  }
  return { width: node.width, height: node.height };
}
