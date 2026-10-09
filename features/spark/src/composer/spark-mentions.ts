/**
 * The composer's "@" and "/" mentions, as plain text logic, measured off Gemini Spark's own
 * composer (`tools/ui-research/scrapers/spark/135-skills-connectors/06-picker-behaviour.cjs`):
 *
 * - "@" lists apps, "/" lists skills, typed at the start of the box or after a space, mid-sentence
 *   too. What follows the trigger filters the list as a case-insensitive substring of the name,
 *   spaces included ("@Google D" keeps Docs and Drive), and the list closes when nothing matches.
 * - Picking one replaces the trigger and its query with the name and one space. Gemini writes it
 *   as bold text, not a chip, and sends it as plain text in the message.
 * - Backspace at the end of a mention takes the whole mention, as Gemini's editor does.
 */

export type MentionTrigger = '@' | '/';

export interface MentionOption {
  id: string;
  trigger: MentionTrigger;
  label: string;
  /** A logo image, or a glyph from Luminous Symbols. */
  icon: { kind: 'img'; src: string } | { kind: 'glyph'; name: string; family: 'luminous' | 'google-symbols' };
  /** An app that is not connected: listed after the connected ones at 0.38 opacity. */
  dimmed?: boolean;
  /** A skill that is switched off: still listed, at 0.63 opacity. */
  disabledSkill?: boolean;
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

/** The options a query keeps, connected apps first, in their own order. */
export const filterMentionOptions = (options: readonly MentionOption[], query: MentionQuery): MentionOption[] => {
  const needle = query.query.toLowerCase();
  const matches = options.filter((option) => option.trigger === query.trigger && option.label.toLowerCase().includes(needle));
  return [...matches.filter((option) => !option.dimmed), ...matches.filter((option) => option.dimmed)];
};

/** The text after picking an option, and where the caret goes. */
export const applyMention = (text: string, query: MentionQuery, option: MentionOption): { text: string; caret: number } => {
  const mention = `${query.trigger}${option.label}`;
  const after = text.slice(query.end);
  const spacer = after.startsWith(' ') ? '' : ' ';
  return { text: `${text.slice(0, query.start)}${mention}${spacer}${after}`, caret: query.start + mention.length + 1 };
};

/** Every mention of a known option in the text, for drawing them bold. */
export const mentionRanges = (text: string, options: readonly MentionOption[]): { start: number; end: number }[] => {
  const tokens = [...new Set(options.map((option) => `${option.trigger}${option.label}`))].sort((a, b) => b.length - a.length);
  const ranges: { start: number; end: number }[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if ((char !== '@' && char !== '/') || (index > 0 && !/\s/.test(text[index - 1]))) continue;
    const token = tokens.find((candidate) => text.startsWith(candidate, index) && (index + candidate.length === text.length || /\s/.test(text[index + candidate.length])));
    if (!token) continue;
    ranges.push({ start: index, end: index + token.length });
    index += token.length - 1;
  }
  return ranges;
};

/** Backspace with the caret right after a mention: the text without the whole mention. */
export const deleteMentionBefore = (text: string, caret: number, options: readonly MentionOption[]): { text: string; caret: number } | null => {
  const range = mentionRanges(text, options).find((candidate) => candidate.end === caret);
  if (!range) return null;
  return { text: `${text.slice(0, range.start)}${text.slice(range.end)}`, caret: range.start };
};

/** Arrow-key movement through the list. The first Down lands on the first row; Up wraps from the top. */
export const stepHighlight = (current: number, count: number, direction: 1 | -1, activated: boolean): number => {
  if (count === 0) return -1;
  if (!activated) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
};

/** The row's content box the skill tooltip is anchored to. */
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
 * Where a skill's description goes, decided as Gemini's CDK overlay does. Its positions, in order:
 * right of the anchor with tops aligned, then above it from its centre with the bottom 4px into it.
 * The first that fits whole wins. Failing that, a position that fits once narrowed to the space left
 * (150px at least) wins, the one with more room first. Failing both, the first is pushed on screen.
 * `heightAt` measures the tooltip's height at a narrower width.
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
