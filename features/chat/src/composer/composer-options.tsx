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
 * The selectable tools, matching Gemini's plus menu exactly.
 *
 * Gemini's menu offers Create image / Create video / Create music / Canvas on the root,
 * and Deep research / Guided learning under "More tools". Nothing else is selectable, so
 * Willow's former `thinking`, `web`, `quizzes` and `spotify` entries are gone — none of
 * them exist in Gemini's menu, which is what this is a clone of.
 */
export type ToolId = 'images' | 'video' | 'music' | 'canvas' | 'research' | 'learn';

export interface ToolMetadata {
  id: ToolId;
  label: string;
  chipLabel: string;
  icon: React.ElementType;
}

export const TOOLS: Record<ToolId, ToolMetadata> = {
  images: { id: 'images', label: 'Create image', chipLabel: 'Image', icon: ImagePlus },
  video: { id: 'video', label: 'Create video', chipLabel: 'Video', icon: Video },
  music: { id: 'music', label: 'Create music', chipLabel: 'Music', icon: Music },
  canvas: { id: 'canvas', label: 'Canvas', chipLabel: 'Canvas', icon: SquarePen },
  research: { id: 'research', label: 'Deep research', chipLabel: 'Research', icon: Telescope },
  learn: { id: 'learn', label: 'Guided learning', chipLabel: 'Learn', icon: BookOpen },
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
