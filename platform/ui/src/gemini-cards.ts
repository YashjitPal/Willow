// ──────────────────────────────────────────────────────────────────────────────
// Gemini's `bento-card` content, and the flex tree that tiles it.
//
// Every geometric constant here was measured off the running Gemini app over
// CDP; none of it is invented. See `bento-card-geometry` in the test suite for
// the capture each number came from.
//
// THE SIZE ENUM. Gemini's card component reads a numeric `TZa` off its input
// and derives three mutually exclusive host classes from it:
//
//   this.n5b = _.X(() => this.TZa() === 3)   // large
//   this.y5b = _.X(() => this.TZa() === 2)   // medium
//   this.S6b = _.X(() => this.TZa() === 1)   // small
//
// so 1/2/3 is small/medium/large. We take the names rather than the ordinals,
// because a model emitting JSON has no reason to know the enum.
//
// THE BOXES, from the authored sheet (`--gem-sys-spacing--s` = 8px):
//
//   .small  { min-width: calc((350px - 8px) / 2); height: calc((350px - 8px) / 2) }
//   .medium { min-width: 350px; height: calc((350px - 8px) / 2) }
//   .large  { min-width: 350px; height: 350px }
//
// i.e. small is 171, medium 350x171, large 350x350 — confirmed live as
// [350,350], [350,171], [171,171], [171,171] for the four cards on the page.
//
// THE TILING. The live tree is a recursive alternating flex, all gaps 8px:
//
//   div.flex-container-root  style="display:flex; flex-direction:row; gap:8px"
//     div.flex-container     style="display:flex; flex-grow:1; flex-direction:column; gap:8px"
//       div.flex-container   style="display:flex; flex-grow:1; flex-direction:row; gap:8px"
//         div                style="width:100%; height:100%"   -> one card
//
// WHO DECIDES THAT TREE — and this is the one place we knowingly diverge.
// Gemini does NOT pack on the client. The renderer is `vch` in chunk `UE0P2d`,
// and `I3` is a pure recursive serialiser over a node tree that arrives already
// shaped:
//
//   I3({node:a, jCb:b, yh:c, P1d:d="", isRoot:e=!1}) {
//     var f = och(a.layout);                       // direction/gap/justify/align
//     d = `style="${["display: flex;", d, f].filter(t=>t).join(" ")}"`;
//     f = a.children.map(t => this.jCb(t, b, c)).join("");
//     var g = ["flex-container"]; e && g.push("flex-container-root");
//     a.containerId && g.push(a.containerId);
//     return `<div ${...}>${f}</div>`;
//   }
//
// with `jCb` emitting `<div style="width:100%; height:100%">` for a leaf and
// recursing for a container, and `och` mapping enums to CSS (1=row, 2=column;
// gap 2 = `var(--gem-sys-spacing--s)`). There is no bin-packing anywhere in the
// bundle: `a.layout`, `a.cSc.grow`, `a.cSc.Hka` (shrink), `justifyContent` and
// `alignItems` all come off the server's node. The arrangement is authored
// server-side, exactly like the card payload itself.
//
// So `packBentoColumns` below is a RECONSTRUCTION, not a transcription. It is
// pinned to the one live arrangement we have measured (`lmss` -> two columns,
// `l` beside `m` over `s+s`) and derived from the box arithmetic: 171*2 + 8 =
// 350 is why two smalls share a row, and 171 + 8 + 171 = 350 is why two
// half-height rows fill a column. Those constants are measured; the packing
// order is inferred from them. Gemini's server can and does emit trees ours
// would never produce — per-container `justify-content`, non-uniform `flex-grow`
// — because it is placing cards by editorial intent, not by fitting boxes.
// ──────────────────────────────────────────────────────────────────────────────

/** Gemini's three card sizes, named after the host classes they set. */
export type BentoCardSize = 'small' | 'medium' | 'large';

export interface BentoCardContent {
  size: BentoCardSize;
  heading?: string;
  subheading?: string;
  /** Background image URL. Sets `has-background-image` when present. */
  image?: string;
  /** Image author, `V3d` in the component. Large cards only. */
  author?: string;
  /** Image provider, `W3d`. Falls back to the whole attribution string. */
  provider?: string;
  /** Opened in a new tab on click, mirroring the card's `HQa.url` action. */
  href?: string;
}

/** One 350px-wide column: rows of cards, top to bottom. */
export type BentoColumn = BentoCardContent[][];

export const BENTO_GAP = 8;
export const BENTO_COLUMN = 350;
/** `calc((350px - 8px) / 2)` from the sheet. */
export const BENTO_HALF = (BENTO_COLUMN - BENTO_GAP) / 2;

/**
 * Fence languages that carry a card payload instead of source code.
 *
 * Gemini's own cards arrive as a structured field on its internal response
 * envelope, which the public API does not expose — so there is no payload to
 * transcribe here, only a channel to choose. A fenced block is the one channel
 * that already survives Willow's stream intact: `renderBlockNode` receives
 * `node.lang` untouched, and an unrecognised fence degrades to a code block
 * rather than to broken markup.
 */
export const BENTO_FENCE_LANGUAGES = ['bento-cards', 'bento', 'cards'];

/** True when a fence's info string marks it as a card payload. */
export const isBentoFence = (language: string | undefined | null): boolean =>
  BENTO_FENCE_LANGUAGES.includes(String(language || '').trim().toLowerCase());

const SIZES: BentoCardSize[] = ['small', 'medium', 'large'];

/** Height a card occupies in its column, straight off the sheet. */
export const bentoCardHeight = (size: BentoCardSize) =>
  size === 'large' ? BENTO_COLUMN : BENTO_HALF;

/** Width a card occupies in its row. */
export const bentoCardWidth = (size: BentoCardSize) =>
  size === 'small' ? BENTO_HALF : BENTO_COLUMN;

/**
 * The attribution line, transcribed from the component's `attribution` signal:
 *
 *   if (this.S6b()) return "";                       // never on a small card
 *   this.n5b() && (author && provider
 *     ? "Credit {AUTHOR}/{PROVIDER}"
 *     : author ? "Credit {AUTHOR}" : "");            // large only
 *   if (!e || e.length > 40) e = provider ?? "";     // too long -> provider alone
 *
 * The 40-character cap and the provider fallback are both Gemini's.
 */
export const bentoAttribution = (card: BentoCardContent): string => {
  if (card.size === 'small') return '';
  const provider = card.provider || '';
  const author = card.author || '';
  let text = '';
  if (card.size === 'large') {
    if (author && provider) text = 'Credit ' + author + '/' + provider;
    else if (author) text = 'Credit ' + author;
  }
  if (!text || text.length > 40) text = provider;
  return text;
};

const asString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeCard = (raw: any): BentoCardContent | null => {
  if (!raw || typeof raw !== 'object') return null;
  const heading = asString(raw.heading ?? raw.title);
  const subheading = asString(raw.subheading ?? raw.subtitle);
  // `has-text` is `!(!heading && !iUa)`; a card with neither is not renderable.
  if (!heading && !subheading) return null;
  // The fallback is ours, not Gemini's: there, `size` is a required enum on the
  // server's envelope and cannot be absent. `medium` is the least destructive
  // guess — full column width, half height, so it tiles with anything — but a
  // whole set arriving without sizes comes out uniform, which Gemini's never is.
  // That is a prompt failure surfacing here, not a layout rule; the size guidance
  // in `CARD_SYSTEM_PROMPT` is what keeps it from happening. Deliberately not
  // inferred from heading length: that would be invented geometry.
  const requested = asString(raw.size)?.toLowerCase();
  const size = SIZES.includes(requested as BentoCardSize)
    ? (requested as BentoCardSize)
    : 'medium';
  return {
    size,
    heading,
    subheading,
    image: asString(raw.image ?? raw.imageUrl),
    author: asString(raw.author),
    provider: asString(raw.provider ?? raw.source),
    href: asString(raw.href ?? raw.url),
  };
};

/**
 * Parse the fenced payload. Tolerates a trailing comma-less truncation mid
 * stream by returning null until the JSON closes, so a half-arrived block
 * renders as nothing rather than as a broken card.
 */
export const parseBentoCards = (source: string): BentoCardContent[] | null => {
  const trimmed = source.trim();
  if (!trimmed) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.cards;
  if (!Array.isArray(list)) return null;
  const cards = list.map(normalizeCard).filter(Boolean) as BentoCardContent[];
  return cards.length ? cards : null;
};

/**
 * Pack cards into columns the way the live tree is shaped: a row of 350px
 * columns, each column a stack of rows, each row either one full-width card or
 * a pair of smalls. Driven entirely by the measured box sizes.
 *
 * A full column is never closed early. It is closed lazily, when the *next*
 * card is found not to fit — because "the column is 350 tall" and "the last row
 * is finished" are different facts. A lone small fills its column's height
 * (171 + 8 + 171 = 350) while still leaving a horizontal slot beside it, and
 * closing on height alone would push that slot's occupant into a column of its
 * own. Measured against the live `lmss` response, which Gemini lays out as two
 * columns — `l` beside `m` over `s+s` — not the three an eager close produces.
 */
export const packBentoColumns = (cards: BentoCardContent[]): BentoColumn[] => {
  const columns: BentoColumn[] = [];
  let column: BentoColumn = [];
  let used = 0;

  const closeColumn = () => {
    if (column.length) columns.push(column);
    column = [];
    used = 0;
  };

  for (const card of cards) {
    const height = bentoCardHeight(card.size);
    // A small can join the previous row if that row still has a slot.
    const lastRow = column[column.length - 1];
    if (
      card.size === 'small' &&
      lastRow &&
      lastRow.length === 1 &&
      lastRow[0].size === 'small'
    ) {
      lastRow.push(card);
      continue;
    }
    const needed = used ? used + BENTO_GAP + height : height;
    if (used && needed > BENTO_COLUMN) closeColumn();
    column.push([card]);
    used = used ? used + BENTO_GAP + height : height;
  }

  closeColumn();
  return columns;
};
