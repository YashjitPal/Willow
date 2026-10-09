/**
 * The chat composer's "@" and "/" mentions, as plain text logic. Gemini's prompt box behaves as
 * its Spark composer does (Spark's measured copy is `features/spark/src/composer/spark-mentions.ts`;
 * chat cannot import a feature that imports it), re-read off gemini.google.com/app in Oct 2026:
 *
 * - "@" lists the models (picking one switches to it) and the apps; Gemini adds the apps it cannot
 *   reach at 0.38 opacity, which Willow leaves out. "/" lists the skills, and with none there is
 *   no menu at all.
 * - Typed at the start of the box or after a space. What follows filters by a case-insensitive
 *   substring of the name, spaces included, the match drawn bold; the menu closes when nothing does.
 * - Picking one replaces the trigger and its query with the name and a space. Gemini writes it as
 *   bold text and sends it as plain text in the message.
 * - Backspace at the end of a mention takes the whole mention.
 */

export type MentionTrigger = '@' | '/';

export interface MentionOption {
  id: string;
  trigger: MentionTrigger;
  kind: 'model' | 'app' | 'skill';
  /** The model id, the connector id or the skill id. */
  value: string;
  label: string;
  /** A logo image, or a Luminous glyph and its size. */
  icon: { kind: 'img'; src: string } | { kind: 'glyph'; name: string; size: 16 | 20 };
  /** A skill's description, shown on hover. */
  description?: string;
}

export interface MentionQuery {
  trigger: MentionTrigger;
  /** Where the trigger character is. */
  start: number;
  /** The caret, where the query ends. */
  end: number;
  query: string;
}

/** The trigger and query the caret is in, if any. */
export const mentionQueryAt = (text: string, caret: number): MentionQuery | null => {
  for (let index = caret - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === '\n') return null;
    if (char !== '@' && char !== '/') continue;
    if (index > 0 && !/\s/.test(text[index - 1])) continue;
    return { trigger: char, start: index, end: caret, query: text.slice(index + 1, caret) };
  }
  return null;
};

/** The options a query keeps, in their order: models, then apps. */
export const filterMentionOptions = (options: readonly MentionOption[], query: MentionQuery): MentionOption[] => {
  const needle = query.query.toLowerCase();
  return options.filter((option) => option.trigger === query.trigger && option.label.toLowerCase().includes(needle));
};

/** A label split around the query's match, for drawing the match bold. */
export const labelParts = (label: string, query: string): { before: string; match: string; after: string } => {
  const at = query ? label.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return { before: label, match: '', after: '' };
  return { before: label.slice(0, at), match: label.slice(at, at + query.length), after: label.slice(at + query.length) };
};

/** The text after picking an option, and where the caret goes. */
export const applyMention = (text: string, query: MentionQuery, option: MentionOption): { text: string; caret: number } => {
  const mention = `${query.trigger}${option.label}`;
  const after = text.slice(query.end);
  const spacer = after.startsWith(' ') ? '' : ' ';
  return { text: `${text.slice(0, query.start)}${mention}${spacer}${after}`, caret: query.start + mention.length + 1 };
};

const tokensOf = (options: readonly MentionOption[]) => [...new Map(options.map((option) => [`${option.trigger}${option.label}`, option])).entries()]
  .sort((a, b) => b[0].length - a[0].length);

/** Every mention of a known option in the text, with the option it names. */
export const mentionsIn = (text: string, options: readonly MentionOption[]): { start: number; end: number; option: MentionOption }[] => {
  const tokens = tokensOf(options);
  const found: { start: number; end: number; option: MentionOption }[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if ((char !== '@' && char !== '/') || (index > 0 && !/\s/.test(text[index - 1]))) continue;
    const hit = tokens.find(([token]) => text.startsWith(token, index) && (index + token.length === text.length || /\s/.test(text[index + token.length])));
    if (!hit) continue;
    found.push({ start: index, end: index + hit[0].length, option: hit[1] });
    index += hit[0].length - 1;
  }
  return found;
};

/** Backspace with the caret right after a mention: the text without the whole mention. */
export const deleteMentionBefore = (text: string, caret: number, options: readonly MentionOption[]): { text: string; caret: number } | null => {
  const range = mentionsIn(text, options).find((candidate) => candidate.end === caret);
  if (!range) return null;
  return { text: `${text.slice(0, range.start)}${text.slice(range.end)}`, caret: range.start };
};

/** Arrow-key movement through the list, wrapping. The menu opens on its first row, highlighted. */
export const stepHighlight = (current: number, count: number, direction: 1 | -1): number => {
  if (count === 0) return -1;
  return (current + direction + count) % count;
};

/** The row's content box a skill's description is anchored to. */
export interface TooltipAnchor {
  left: number;
  right: number;
  top: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
  maxWidth: number;
}

const TOOLTIP_MIN_WIDTH = 150;
const TOOLTIP_MAX_WIDTH = 250;
const TOOLTIP_MIN_HEIGHT = 10;
const TOOLTIP_ABOVE_OFFSET = 4;

/**
 * Where a skill's description goes, decided as Gemini's CDK overlay does: right of the anchor with
 * tops aligned, then above it from its centre with the bottom 4px into it. The first that fits whole
 * wins; failing that, the one that fits once narrowed (150px at least) with more room; failing both,
 * the first pushed on screen. `heightAt` measures the tooltip at a narrower width.
 */
export const placeMentionTooltip = (
  anchor: TooltipAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  heightAt: (maxWidth: number) => number,
): TooltipPlacement => {
  const centre = (anchor.left + anchor.right) / 2;
  const bottom = anchor.top + TOOLTIP_ABOVE_OFFSET;
  if (anchor.right + size.width <= viewport.width && anchor.top + size.height <= viewport.height) {
    return { left: anchor.right, top: anchor.top, maxWidth: TOOLTIP_MAX_WIDTH };
  }
  if (centre + size.width <= viewport.width && bottom - size.height >= 0) {
    return { left: centre, top: bottom - size.height, maxWidth: TOOLTIP_MAX_WIDTH };
  }
  const right = { width: viewport.width - anchor.right, height: viewport.height - anchor.top };
  const above = { width: viewport.width - centre, height: anchor.top };
  const fitsRight = right.width >= TOOLTIP_MIN_WIDTH && right.height >= TOOLTIP_MIN_HEIGHT;
  const fitsAbove = above.width >= TOOLTIP_MIN_WIDTH && above.height >= TOOLTIP_MIN_HEIGHT;
  if (fitsAbove && (!fitsRight || above.width * above.height > right.width * right.height)) {
    const maxWidth = Math.min(TOOLTIP_MAX_WIDTH, above.width);
    return { left: centre, top: bottom - heightAt(maxWidth), maxWidth };
  }
  if (fitsRight) return { left: anchor.right, top: anchor.top, maxWidth: Math.min(TOOLTIP_MAX_WIDTH, right.width) };
  return {
    left: Math.max(0, Math.min(anchor.right, viewport.width - size.width)),
    top: Math.max(0, Math.min(anchor.top, viewport.height - size.height)),
    maxWidth: TOOLTIP_MAX_WIDTH,
  };
};
