/**
 * The static catalogs the composer menus render from: tools, themes, modes.
 *
 * Data only — no state, no handlers. Kept together because all three are the
 * same kind of thing (a fixed list of options the user picks from) and all three
 * were previously wedged between the composer imports and its components.
 */

import React from 'react';
import {
  BookOpen,
  ImagePlus,
  MessageSquare,
  Music,
  Palette,
  Rocket,
  SquarePen,
  Telescope,
  Video,
  Zap,
} from "lucide-react";

/**
 * The selectable tools for normal Chat, matching Gemini's plus menu exactly.
 *
 * Gemini's menu offers Create image / Create video / Create music / Canvas on the root,
 * and Deep research / Guided learning under "More tools". Nothing else is selectable, so
 * Willow's former `thinking`, `web`, `quizzes` and `spotify` entries are gone — none of
 * them exist in Gemini's menu, which is what the normal Chat catalog clones.
 */
export type ToolId =
  | 'images' | 'video' | 'music' | 'canvas' | 'research' | 'learn'
  | 'plan' | 'goal' | 'computer-use' | 'create-pet' | 'create-skill'
  | 'sub-agents' | 'personal-intelligence';

export interface ToolMetadata {
  id: ToolId;
  label: string;
  chipLabel: string;
  icon: React.ElementType;
}

export const TOOLS: Record<Exclude<ToolId, 'plan' | 'goal' | 'computer-use' | 'create-pet' | 'create-skill' | 'sub-agents' | 'personal-intelligence'>, ToolMetadata> = {
  // chipLabel is what Gemini's own chip shows (read off the live chip, not the menu row):
  // "Create image" -> "Images", "Create video" -> "Videos", "Music" -> "Music",
  // "Canvas" -> "Canvas", "Deep research" -> "Deep research", "Guided learning" -> "Learn".
  images: { id: 'images', label: 'Create image', chipLabel: 'Images', icon: ImagePlus },
  video: { id: 'video', label: 'Create video', chipLabel: 'Videos', icon: Video },
  music: { id: 'music', label: 'Create music', chipLabel: 'Music', icon: Music },
  canvas: { id: 'canvas', label: 'Canvas', chipLabel: 'Canvas', icon: SquarePen },
  research: { id: 'research', label: 'Deep research', chipLabel: 'Deep research', icon: Telescope },
  learn: { id: 'learn', label: 'Guided learning', chipLabel: 'Learn', icon: BookOpen },
};

/** Spark-only composer tools. The catalog controls menu placement and chips; Plan,
 * Goal and Sub-agents have runtime semantics in the Spark harness today. */
export const SPARK_TOOLS: Record<Extract<ToolId, 'plan' | 'goal' | 'computer-use' | 'create-pet' | 'create-skill' | 'sub-agents' | 'personal-intelligence'>, ToolMetadata> = {
  plan: { id: 'plan', label: 'Plan', chipLabel: 'Plan', icon: SquarePen },
  goal: { id: 'goal', label: 'Goal', chipLabel: 'Goal', icon: Telescope },
  'computer-use': { id: 'computer-use', label: 'Computer Use', chipLabel: 'Computer Use', icon: Zap },
  'create-pet': { id: 'create-pet', label: 'Create pet', chipLabel: 'Create pet', icon: Rocket },
  'create-skill': { id: 'create-skill', label: 'Create skill', chipLabel: 'Create skill', icon: BookOpen },
  'sub-agents': { id: 'sub-agents', label: 'Sub-agents', chipLabel: 'Sub-agents', icon: MessageSquare },
  'personal-intelligence': { id: 'personal-intelligence', label: 'Personal Intelligence', chipLabel: 'Personal Intelligence', icon: Zap },
};

/**
 * Gemini's own glyph for each tool, read off the live menu.
 *
 * Two icon fonts are in play and they are NOT interchangeable — every tool glyph is
 * Luminous Symbols, while `drive` and `more_horiz` (below, in the menu itself) are Google
 * Symbols. Names come from each `mat-icon`'s `data-mat-icon-name`.
 */
export const TOOL_SYMBOLS: Record<ToolId, string> = {
  images: 'image_create',
  video: 'movie',
  music: 'music',
  canvas: 'canvas',
  research: 'deep_research',
  learn: 'guided_learning',
  plan: 'edit_note',
  goal: 'flag',
  'computer-use': 'computer',
  'create-pet': 'pets',
  'create-skill': 'school',
  'sub-agents': 'group',
  'personal-intelligence': 'person',
};

/**
 * Gemini's tooltip for each tool row.
 *
 * Only the TOOL rows have a tooltip. Every row in the menu carries
 * `mat-mdc-tooltip-trigger`, but the uploader rows ("Upload files", "Add from Drive") also
 * carry `mat-mdc-tooltip-disabled` and show nothing — their `aria-label` reads like a
 * description ("Upload files. Documents, data, code files") but that is an accessible
 * name, not a tooltip, and wiring it up as one is wrong. The "More uploads" and "More
 * tools" rows have no tooltip either; their submenu is the affordance.
 *
 * Each string is the authored literal from Gemini's bundle, not a transcription off the
 * rendered bubble. Two of these had drifted when they were read off screen: Canvas lost
 * its Oxford comma, and Deep research was recorded as "Create detailed reports" when the
 * source says "Get detailed reports".
 */
export const TOOL_TOOLTIPS: Record<Exclude<ToolId, 'plan' | 'goal' | 'computer-use' | 'create-pet' | 'create-skill' | 'sub-agents' | 'personal-intelligence'>, string> = {
  images: 'Visualize and edit',
  video: 'Bring ideas to life',
  music: 'Make audio tracks',
  canvas: 'Code, write, or make slides',
  research: 'Get detailed reports',
  learn: 'Study and learn new things',
};

export interface Theme {
  id: string;
  name: string;
  colors: string[];
}

export const THEMES: Theme[] = [
  { id: "default", name: "Default", colors: ["#ffffff", "#a78bfa", "#94a3b8"] },
  { id: "glacier", name: "Glacier", colors: ["#38bdf8", "#94a3b8", "#bae6fd"] },
  { id: "harvest", name: "Harvest", colors: ["#fb923c", "#fcd34d", "#fef08a"] },
  {
    id: "lavender",
    name: "Lavender",
    colors: ["#c084fc", "#e879f9", "#ddd6fe"],
  },
  {
    id: "brutalist",
    name: "Brutalist",
    colors: ["#ffffff", "#3b82f6", "#10b981"],
  },
  {
    id: "obsidian",
    name: "Obsidian",
    colors: ["#94a3b8", "#cbd5e1", "#f1f5f9"],
  },
  { id: "orchid", name: "Orchid", colors: ["#f47226", "#fb7185", "#fbcfe8"] },
  { id: "solar", name: "Solar", colors: ["#facc15", "#fde047", "#fef9c3"] },
];

export type Mode = "ship" | "design" | "proto" | "chat";

export interface ModeOption {
  id: Mode;
  label: string;
  icon: React.ElementType;
}

export const MODES: ModeOption[] = [
  { id: "ship", label: "Ship", icon: Rocket },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "design", label: "Design", icon: Palette },
  { id: "proto", label: "Proto", icon: Zap },
];
