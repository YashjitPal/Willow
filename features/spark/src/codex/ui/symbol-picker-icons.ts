import { defineMessages, type IntlShape, type MessageDescriptor } from "react-intl";
import { projectIconIds, type ProjectIconId } from "./project-appearance";
import type { SymbolSection, TeamIconChoice } from "./symbol-picker-types";

/** `fd`: icon names, also their accessible labels. */
export const projectIconLabels = defineMessages({
  "bar-chart": {
    id: "codex.projectAppearance.icon.option.bar_chart",
    defaultMessage: "Bar Chart",
    description: "Icon option name in the project marker popover.",
  },
  book: {
    id: "codex.projectAppearance.icon.option.book",
    defaultMessage: "Book",
    description: "Icon option name in the project marker popover.",
  },
  brain: {
    id: "codex.projectAppearance.icon.option.brain",
    defaultMessage: "Brain",
    description: "Icon option name in the project marker popover.",
  },
  "currency-dollar": {
    id: "codex.projectAppearance.icon.option.currency_dollar",
    defaultMessage: "Currency Dollar",
    description: "Icon option name in the project marker popover.",
  },
  customize: {
    id: "codex.projectAppearance.icon.option.customize",
    defaultMessage: "Customize",
    description: "Icon option name in the project marker popover.",
  },
  "desk-globe": {
    id: "codex.projectAppearance.icon.option.desk_globe",
    defaultMessage: "Globe Spin",
    description: "Icon option name in the project marker popover.",
  },
  dumbbell: {
    id: "codex.projectAppearance.icon.option.dumbbell",
    defaultMessage: "Dumbbell",
    description: "Icon option name in the project marker popover.",
  },
  edit: {
    id: "codex.projectAppearance.icon.option.edit",
    defaultMessage: "Pencil",
    description: "Icon option name in the project marker popover.",
  },
  flask: {
    id: "codex.projectAppearance.icon.option.flask",
    defaultMessage: "Flask",
    description: "Icon option name in the project marker popover.",
  },
  folder: {
    id: "codex.projectAppearance.icon.option.folder",
    defaultMessage: "Folder",
    description: "Icon option name in the project marker popover.",
  },
  function: {
    id: "codex.projectAppearance.icon.option.function",
    defaultMessage: "Code Brackets",
    description: "Icon option name in the project marker popover.",
  },
  globe: {
    id: "codex.projectAppearance.icon.option.globe",
    defaultMessage: "Globe",
    description: "Icon option name in the project marker popover.",
  },
  "graduation-cap": {
    id: "codex.projectAppearance.icon.option.graduation_cap",
    defaultMessage: "Graduation Cap",
    description: "Icon option name in the project marker popover.",
  },
  health: {
    id: "codex.projectAppearance.icon.option.health",
    defaultMessage: "Health",
    description: "Icon option name in the project marker popover.",
  },
  heart: {
    id: "codex.projectAppearance.icon.option.heart",
    defaultMessage: "Heart",
    description: "Icon option name in the project marker popover.",
  },
  kettlebell: {
    id: "codex.projectAppearance.icon.option.kettlebell",
    defaultMessage: "Kettlebell",
    description: "Icon option name in the project marker popover.",
  },
  logs: {
    id: "codex.projectAppearance.icon.option.logs",
    defaultMessage: "Logs",
    description: "Icon option name in the project marker popover.",
  },
  lotus: {
    id: "codex.projectAppearance.icon.option.lotus",
    defaultMessage: "Lotus",
    description: "Icon option name in the project marker popover.",
  },
  music: {
    id: "codex.projectAppearance.icon.option.music",
    defaultMessage: "Music",
    description: "Icon option name in the project marker popover.",
  },
  palette: {
    id: "codex.projectAppearance.icon.option.palette",
    defaultMessage: "Palette",
    description: "Icon option name in the project marker popover.",
  },
  paw: {
    id: "codex.projectAppearance.icon.option.paw",
    defaultMessage: "Paw",
    description: "Icon option name in the project marker popover.",
  },
  plane: {
    id: "codex.projectAppearance.icon.option.plane",
    defaultMessage: "Plane",
    description: "Icon option name in the project marker popover.",
  },
  plant: {
    id: "codex.projectAppearance.icon.option.plant",
    defaultMessage: "Plant",
    description: "Icon option name in the project marker popover.",
  },
  popcorn: {
    id: "codex.projectAppearance.icon.option.popcorn",
    defaultMessage: "Popcorn",
    description: "Icon option name in the project marker popover.",
  },
  scale: {
    id: "codex.projectAppearance.icon.option.scale",
    defaultMessage: "Balancing Scale",
    description: "Icon option name in the project marker popover.",
  },
  stethoscope: {
    id: "codex.projectAppearance.icon.option.stethoscope",
    defaultMessage: "Stethoscope",
    description: "Icon option name in the project marker popover.",
  },
  suitcase: {
    id: "codex.projectAppearance.icon.option.suitcase",
    defaultMessage: "Suitcase",
    description: "Icon option name in the project marker popover.",
  },
  terminal: {
    id: "codex.projectAppearance.icon.option.terminal",
    defaultMessage: "Terminal",
    description: "Icon option name in the project marker popover.",
  },
  wrench: {
    id: "codex.projectAppearance.icon.option.wrench",
    defaultMessage: "Wrench",
    description: "Icon option name in the project marker popover.",
  },
  writing: {
    id: "codex.projectAppearance.icon.option.writing",
    defaultMessage: "Writing",
    description: "Icon option name in the project marker popover.",
  },
}) satisfies Record<ProjectIconId, MessageDescriptor>;

type ProjectIconCategoryId = "work" | "learning" | "creative" | "wellbeing" | "travel" | "nature";

/** `_d`: search keywords per icon. */
const projectIconKeywords: Record<ProjectIconId, { categoryId: ProjectIconCategoryId; keywords: string[] }> = {
  folder: { categoryId: "work", keywords: ["files", "documents", "organize", "project", "workspace"] },
  "currency-dollar": { categoryId: "work", keywords: ["money", "finance", "budget", "bank", "payment", "business"] },
  book: { categoryId: "learning", keywords: ["reading", "study", "education", "library", "literature"] },
  "graduation-cap": { categoryId: "learning", keywords: ["school", "university", "college", "education", "degree", "study"] },
  edit: { categoryId: "creative", keywords: ["pencil", "writing", "drawing", "draft", "notes"] },
  writing: { categoryId: "creative", keywords: ["pen", "author", "journal", "essay", "story", "draft"] },
  function: { categoryId: "work", keywords: ["developer", "code", "programming", "software", "math", "formula"] },
  terminal: { categoryId: "work", keywords: ["developer", "code", "command", "console", "shell", "computer"] },
  music: { categoryId: "creative", keywords: ["audio", "sound", "song", "playlist", "instrument"] },
  popcorn: { categoryId: "creative", keywords: ["movie", "film", "cinema", "entertainment", "snack"] },
  customize: { categoryId: "creative", keywords: ["design", "drawing", "art", "tools", "pens", "personalize"] },
  palette: { categoryId: "creative", keywords: ["paint", "color", "art", "design", "drawing"] },
  stethoscope: { categoryId: "wellbeing", keywords: ["doctor", "medical", "medicine", "hospital", "care", "health"] },
  health: { categoryId: "wellbeing", keywords: ["medical", "medicine", "emergency", "ambulance", "care"] },
  lotus: { categoryId: "wellbeing", keywords: ["meditation", "mindfulness", "yoga", "calm", "relax", "wellness"] },
  suitcase: { categoryId: "travel", keywords: ["vacation", "trip", "luggage", "packing", "holiday", "business"] },
  "bar-chart": { categoryId: "work", keywords: ["analytics", "data", "statistics", "report", "growth", "business"] },
  kettlebell: { categoryId: "wellbeing", keywords: ["fitness", "exercise", "gym", "workout", "strength", "weight"] },
  dumbbell: { categoryId: "wellbeing", keywords: ["fitness", "exercise", "gym", "workout", "strength", "weight"] },
  logs: { categoryId: "work", keywords: ["notebook", "journal", "records", "notes", "list", "tracking"] },
  scale: { categoryId: "work", keywords: ["law", "legal", "justice", "balance", "decision", "weight"] },
  "desk-globe": { categoryId: "travel", keywords: ["world", "earth", "geography", "map", "countries", "explore"] },
  plane: { categoryId: "travel", keywords: ["vacation", "flight", "airport", "trip", "holiday", "airplane"] },
  globe: { categoryId: "travel", keywords: ["world", "earth", "internet", "website", "global", "language"] },
  wrench: { categoryId: "work", keywords: ["tools", "repair", "build", "maintenance", "settings", "engineering"] },
  paw: { categoryId: "nature", keywords: ["pet", "animal", "dog", "cat", "wildlife"] },
  flask: { categoryId: "learning", keywords: ["science", "chemistry", "experiment", "laboratory", "research"] },
  brain: { categoryId: "learning", keywords: ["thinking", "idea", "knowledge", "intelligence", "psychology", "mind"] },
  heart: { categoryId: "wellbeing", keywords: ["love", "care", "favorite", "relationship", "emotion"] },
  plant: { categoryId: "nature", keywords: ["garden", "growth", "leaves", "environment", "ecology", "green"] },
};

export interface ProjectIconOption {
  id: ProjectIconId;
  label: MessageDescriptor;
  categoryId: ProjectIconCategoryId;
  keywords: string[];
}

/** `vd`: the icon catalog in picker order. */
export const projectIconOptions: ProjectIconOption[] = projectIconIds.map((id) => ({ id, label: projectIconLabels[id], ...projectIconKeywords[id] }));

/** `gd` */
function normalizeIconQuery(value: string, locale: string) {
  return value.trim().toLocaleLowerCase(locale).replace(/[\s_-]+/g, " ");
}

/** `hd`: icons whose name, id or keywords match every word; exact name or id matches first. */
export function searchProjectIcons(query: string, intl: IntlShape) {
  const normalized = normalizeIconQuery(query, intl.locale);
  if (normalized.length === 0) return projectIconOptions;
  const terms = normalized.split(" ");
  return projectIconOptions
    .flatMap((icon) => {
      const label = normalizeIconQuery(intl.formatMessage(icon.label), intl.locale);
      const id = normalizeIconQuery(icon.id, intl.locale);
      if (terms.every((term) => label.includes(term) || id.includes(term) || icon.keywords.some((keyword) => keyword.includes(term)))) {
        return [{ icon, score: label === normalized || id === normalized ? 0 : 1 }];
      }
      return [];
    })
    .sort((a, b) => a.score - b.score)
    .map(({ icon }) => icon);
}

const teamIconCategoryMessages = defineMessages({
  people: {
    id: "symbolPicker.teamIcons.category.people",
    defaultMessage: "People and work",
    description: "Illustrated icon category for teamwork, office objects, productivity, and finance",
  },
  nature: {
    id: "symbolPicker.teamIcons.category.nature",
    defaultMessage: "Animals and nature",
    description: "Illustrated icon category for animals, weather, and the environment",
  },
  food: {
    id: "symbolPicker.teamIcons.category.food",
    defaultMessage: "Food and drink",
    description: "Illustrated icon category for food and drinks",
  },
  travel: {
    id: "symbolPicker.teamIcons.category.travel",
    defaultMessage: "Travel and places",
    description: "Illustrated icon category for travel, navigation, and places",
  },
  activities: {
    id: "symbolPicker.teamIcons.category.activities",
    defaultMessage: "Activities",
    description: "Illustrated icon category for art, design, games, music, celebrations, and sports",
  },
  technology: {
    id: "symbolPicker.teamIcons.category.technology",
    defaultMessage: "Technology and science",
    description: "Illustrated icon category for computers, software, artificial intelligence, data, security, and science",
  },
});

/** `bd`: team icon categories, in display order. */
const teamIconCategories = (["people", "nature", "food", "travel", "activities", "technology"] as const).map((id) => ({ id, label: teamIconCategoryMessages[id] }));

/** `Sd`: team icons grouped by category, or the matches of a query. */
export function teamIconSections({ choices, query, intl }: { choices: TeamIconChoice[]; query: string; intl: IntlShape }): SymbolSection[] {
  if (query.trim().length > 0) {
    const terms = query.trim().toLocaleLowerCase(intl.locale).split(/[\s_-]+/);
    return [
      {
        id: "results",
        heading: intl.formatMessage({
          id: "symbolPicker.teamIcons.search.results",
          defaultMessage: "Search results",
          description: "Heading above illustrated icons matching the search query",
        }),
        choices: choices.filter((choice) => {
          const text = [choice.value, choice.metadata.label, ...choice.metadata.keywords]
            .join(" ")
            .toLocaleLowerCase(intl.locale)
            .replace(/[_-]/g, " ");
          return terms.every((term) => text.includes(term));
        }),
      },
    ];
  }
  return teamIconCategories.flatMap((category) => {
    const categoryChoices = choices.filter((choice) => choice.metadata.categoryId === category.id);
    if (categoryChoices.length === 0) return [];
    return [{ id: category.id, heading: intl.formatMessage(category.label), choices: categoryChoices }];
  });
}
