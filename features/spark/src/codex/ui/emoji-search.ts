import { defineMessages, type IntlShape, type MessageDescriptor } from "react-intl";
import {
  carLight16,
  emojiFaceSmileMouthLight16,
  flagLight16,
  handLight16,
  heartLight16,
  lightbulbLight16,
  pawLight16,
  soccerballLight16,
  wineAndClocheLight16,
  type IconAsset,
} from "../icons";
import emojiData from "./emoji-data.json";
import type { EmojiCapability, EmojiChoice, SymbolSection } from "./symbol-picker-types";

interface EmojiDataEntry {
  /** Names, the last one being the canonical name. */
  n: string[];
  /** Code points, dash-separated hex. */
  u: string;
}

interface EmojiDataset {
  emojis: Record<string, EmojiDataEntry[]>;
  /** Emoji 16/17 additions, keyed by the code points of the emoji they follow. */
  additions: Record<string, EmojiDataEntry>;
  /** Slack-style shortcodes. */
  shortcodes: Record<string, string>;
}

const dataset = emojiData as EmojiDataset;

export const emojiMessages = defineMessages({
  choices: {
    id: "emoji.choices.heading",
    defaultMessage: "Emojis",
    description: "Heading above the emoji available to select in a picker",
  },
  recent: {
    id: "emoji.category.recent",
    defaultMessage: "Recently used",
    description: "Emoji browser category containing recent selections",
  },
  suggested: {
    id: "emoji.category.suggested",
    defaultMessage: "Suggested",
    description: "Emoji browser category containing common emoji before any have been selected",
  },
  results: {
    id: "emoji.search.results",
    defaultMessage: "Search results",
    description: "Heading above emoji matching the search query",
  },
});

const categoryMessages = defineMessages({
  smileys: {
    id: "emoji.category.smileys",
    defaultMessage: "Smileys and emotion",
    description: "Emoji browser category for faces and emotions",
  },
  people: {
    id: "emoji.category.people",
    defaultMessage: "People and body",
    description: "Emoji browser category for people, gestures, and body parts",
  },
  nature: {
    id: "emoji.category.nature",
    defaultMessage: "Animals and nature",
    description: "Emoji browser category for animals and nature",
  },
  food: {
    id: "emoji.category.food",
    defaultMessage: "Food and drink",
    description: "Emoji browser category for food and drinks",
  },
  travel: {
    id: "emoji.category.travel",
    defaultMessage: "Travel and places",
    description: "Emoji browser category for travel, vehicles, and places",
  },
  activities: {
    id: "emoji.category.activities",
    defaultMessage: "Activities",
    description: "Emoji browser category for sports, games, and activities",
  },
  objects: {
    id: "emoji.category.objects",
    defaultMessage: "Objects",
    description: "Emoji browser category for everyday objects",
  },
  symbols: {
    id: "emoji.category.symbols",
    defaultMessage: "Symbols",
    description: "Emoji browser category for signs and symbols",
  },
  flags: {
    id: "emoji.category.flags",
    defaultMessage: "Flags",
    description: "Emoji browser category for flags",
  },
});

export type EmojiCategoryId =
  | "Smileys & Emotion"
  | "People & Body"
  | "Animals & Nature"
  | "Food & Drink"
  | "Travel & Places"
  | "Activities"
  | "Objects"
  | "Symbols"
  | "Flags";

/** `q`: the emoji categories in browsing order. */
export const emojiCategories: { id: EmojiCategoryId; icon: IconAsset; label: MessageDescriptor }[] = [
  { id: "Smileys & Emotion", icon: emojiFaceSmileMouthLight16, label: categoryMessages.smileys },
  { id: "People & Body", icon: handLight16, label: categoryMessages.people },
  { id: "Animals & Nature", icon: pawLight16, label: categoryMessages.nature },
  { id: "Food & Drink", icon: wineAndClocheLight16, label: categoryMessages.food },
  { id: "Travel & Places", icon: carLight16, label: categoryMessages.travel },
  { id: "Activities", icon: soccerballLight16, label: categoryMessages.activities },
  { id: "Objects", icon: lightbulbLight16, label: categoryMessages.objects },
  { id: "Symbols", icon: heartLight16, label: categoryMessages.symbols },
  { id: "Flags", icon: flagLight16, label: categoryMessages.flags },
];

export interface EmojiShortcode {
  shortcode: string;
  emoji: string;
}

const SHORTCODE_SUGGESTION_LIMIT = 8;

/** `Ku`: shortcode suggestions before anything is typed. */
const defaultEmojiShortcodes: EmojiShortcode[] = [
  { shortcode: "smile", emoji: "😄" },
  { shortcode: "thumbsup", emoji: "👍" },
  { shortcode: "heart", emoji: "❤️" },
  { shortcode: "tada", emoji: "🎉" },
  { shortcode: "rocket", emoji: "🚀" },
  { shortcode: "eyes", emoji: "👀" },
  { shortcode: "pray", emoji: "🙏" },
  { shortcode: "fire", emoji: "🔥" },
  { shortcode: "thinking_face", emoji: "🤔" },
  { shortcode: "white_check_mark", emoji: "✅" },
  { shortcode: "wave", emoji: "👋" },
  { shortcode: "sparkles", emoji: "✨" },
];

function emojiFromCodePoints(unified: string) {
  return String.fromCodePoint(...unified.split("-").map((part) => Number.parseInt(part, 16))).replace(/(\p{Emoji_Presentation})\uFE0F/gu, "$1");
}

function emojiKey(emoji: string) {
  return emoji.replaceAll("\uFE0F", "");
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

const knownCodePoints = new Set(Object.values(dataset.emojis).flatMap((entries) => entries.map(({ u }) => u)));

/** `at`: the dataset with each addition placed after the emoji it follows. */
const emojisByCategory: Record<string, EmojiDataEntry[]> = Object.fromEntries(
  Object.entries(dataset.emojis).map(([category, entries]) => [
    category,
    entries.flatMap((entry) => {
      const addition = dataset.additions[entry.u];
      return addition == null || knownCodePoints.has(addition.u) ? [entry] : [entry, addition];
    }),
  ]),
);

/** `Hu` */
function normalizeShortcode(value: string) {
  return value
    .trim()
    .replace(/^:+|:+$/g, "")
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
}

/** `qu` */
const shortcodeIndex = [
  ...Object.entries(dataset.shortcodes).map(([shortcode, emoji]) => ({ shortcode, emoji })),
  ...defaultEmojiShortcodes,
  { shortcode: "+1", emoji: "👍" },
  { shortcode: "-1", emoji: "👎" },
  ...Object.values(emojisByCategory).flatMap((entries) => entries.map(({ n, u }) => ({ shortcode: normalizeShortcode(n[n.length - 1]), emoji: emojiFromCodePoints(u) }))),
].map(({ shortcode, emoji }) => {
  const searchShortcode = normalizeShortcode(shortcode);
  return { compactShortcode: searchShortcode.replaceAll("_", ""), emoji, searchShortcode, shortcode };
});

type ShortcodeIndexEntry = (typeof shortcodeIndex)[number];

interface ScoredShortcode extends EmojiShortcode {
  emojiKey: string;
  score: number;
}

/** `Uu` */
function shortcodeScore(entry: ShortcodeIndexEntry, query: string, compactQuery: string) {
  if (entry.searchShortcode === query) return 0;
  if (entry.searchShortcode.startsWith(query)) return 10;
  if (entry.searchShortcode.includes(`_${query}`)) return 20;
  if (entry.compactShortcode.startsWith(compactQuery)) return 30;
  if (entry.searchShortcode.includes(query)) return 40;
  if (entry.compactShortcode.includes(compactQuery)) return 50;
  return Infinity;
}

/** `Wu` */
function compareShortcodes(a: ScoredShortcode, b: ScoredShortcode) {
  return a.score - b.score || a.shortcode.length - b.shortcode.length || a.shortcode.localeCompare(b.shortcode);
}

/** `Vu`: the best shortcode per emoji for a typed shortcode, best match first. */
export function searchEmojiShortcodes(query: string, limit = SHORTCODE_SUGGESTION_LIMIT): EmojiShortcode[] {
  const normalized = normalizeShortcode(query);
  if (normalized.length === 0) return defaultEmojiShortcodes.slice(0, limit);
  const compact = normalized.replaceAll("_", "");
  const best = new Map<string, ScoredShortcode>();
  for (const entry of shortcodeIndex) {
    const score = shortcodeScore(entry, normalized, compact);
    if (score === Infinity) continue;
    const candidate = { emoji: entry.emoji, emojiKey: emojiKey(entry.emoji), score, shortcode: entry.shortcode };
    const current = best.get(candidate.emojiKey);
    if (current == null || compareShortcodes(candidate, current) < 0) best.set(candidate.emojiKey, candidate);
  }
  return Array.from(best.values())
    .sort(compareShortcodes)
    .slice(0, limit)
    .map(({ emoji, shortcode }) => ({ emoji, shortcode }));
}

export interface EmojiRecord {
  emoji: string;
  name: string;
  category: EmojiCategoryId;
  keywords: string[];
}

const datasetCategories: Partial<Record<string, EmojiCategoryId>> = {
  animals_nature: "Animals & Nature",
  food_drink: "Food & Drink",
  travel_places: "Travel & Places",
  activities: "Activities",
  objects: "Objects",
  symbols: "Symbols",
  flags: "Flags",
};

const peopleStart = emojisByCategory.smileys_people.findIndex(({ u }) => u === "1f44b");
const crustaceans = new Set(["🦀", "🦞", "🦐", "🦑", "🦪"]);

/** `Zu` */
function emojiCategory(datasetCategory: string, emoji: string, index: number): EmojiCategoryId | undefined {
  if (datasetCategory === "smileys_people") return index < peopleStart ? "Smileys & Emotion" : "People & Body";
  if (crustaceans.has(emoji)) return "Animals & Nature";
  return datasetCategories[datasetCategory];
}

/** `nd` */
const emojiRecords: EmojiRecord[] = Object.entries(emojisByCategory).flatMap(([datasetCategory, entries]) =>
  entries.flatMap(({ u, n }, index) => {
    const emoji = emojiFromCodePoints(u);
    const category = emojiCategory(datasetCategory, emoji, index);
    if (category == null) return [];
    return [{ emoji, name: n[n.length - 1].toLowerCase(), category, keywords: n }];
  }),
);

const emojiRecordsByKey = new Map(emojiRecords.map((record) => [emojiKey(record.emoji), record]));

/** `Yu`: the catalog entry of an emoji, ignoring variation selectors. */
export function findEmoji(emoji: string) {
  return emojiRecordsByKey.get(emojiKey(emoji));
}

/** `Xu`: emoji whose shortcode, name or keywords match every word of the query. */
export function searchEmoji(query: string) {
  const terms = query
    .trim()
    .replace(/^:+|:+$/g, "")
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return emojiRecords;
  const byShortcode = searchEmojiShortcodes(query, Infinity).flatMap(({ emoji }) => findEmoji(emoji) ?? []);
  return uniqueBy(
    [...byShortcode, ...emojiRecords.filter((record) => terms.every((term) => record.name.includes(term) || record.keywords.some((keyword) => keyword.includes(term))))],
    (record) => record.emoji,
  );
}

/** `sd` */
function emojiChoice(record: EmojiRecord, getEmojiLabel?: (emoji: string) => string): EmojiChoice {
  return { kind: "emoji", value: record.emoji, metadata: { label: getEmojiLabel?.(record.emoji) ?? record.name, categoryId: record.category } };
}

/** `ld` */
const categorySections = emojiCategories.map((category) => ({
  id: category.id,
  heading: category.label,
  choices: searchEmoji("")
    .filter((record) => record.category === category.id)
    .map((record) => emojiChoice(record)),
}));

/** `ud` */
const defaultSuggestions = searchEmojiShortcodes("", Infinity).flatMap(({ emoji }) => findEmoji(emoji) ?? []);

/** `od`: "Recently used" once a known emoji was picked, "Suggested" before. */
export function suggestedEmojiHeading(recentEmojis: string[], intl: IntlShape) {
  return intl.formatMessage(recentEmojis.some((emoji) => findEmoji(emoji) != null) ? emojiMessages.recent : emojiMessages.suggested);
}

/** `ad`: the emoji grid sections for a query. */
export function emojiSections({ capability, query, recentEmojis, intl }: { capability: EmojiCapability; query: string; recentEmojis: string[]; intl: IntlShape }): SymbolSection[] {
  const { getEmojiLabel } = capability;
  const hasQuery = query.trim().length > 0;
  if (capability.allowedEmojis != null) {
    const matches = new Set(searchEmoji(query).map(({ emoji }) => emojiKey(emoji)));
    return [
      {
        id: "allowed",
        heading: intl.formatMessage(emojiMessages.choices),
        choices: capability.allowedEmojis.flatMap((emoji): EmojiChoice[] => {
          const record = findEmoji(emoji);
          const name = record?.name ?? emoji;
          if (hasQuery && !matches.has(emojiKey(emoji)) && !name.includes(query.trim().toLowerCase())) return [];
          return [{ kind: "emoji", value: emoji, metadata: { label: getEmojiLabel?.(emoji) ?? name, categoryId: record?.category } }];
        }),
      },
    ];
  }
  if (hasQuery) {
    return [{ id: "results", heading: intl.formatMessage(emojiMessages.results), choices: searchEmoji(query).map((record) => emojiChoice(record, getEmojiLabel)) }];
  }
  const recent = recentEmojis.flatMap((emoji) => findEmoji(emoji) ?? []);
  const suggested = uniqueBy(recent.length > 0 ? recent : defaultSuggestions, (record) => record.emoji).slice(0, 8);
  return [
    { id: "suggested", heading: suggestedEmojiHeading(recentEmojis, intl), choices: suggested.map((record) => emojiChoice(record, getEmojiLabel)) },
    ...categorySections.map((section) => ({
      id: section.id,
      heading: intl.formatMessage(section.heading),
      choices: getEmojiLabel == null ? section.choices : section.choices.map((choice) => ({ ...choice, metadata: { ...choice.metadata, label: getEmojiLabel(choice.value) } })),
    })),
  ];
}
