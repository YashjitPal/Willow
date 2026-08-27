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
  Layers,
  Lightbulb,
  MessageSquare,
  Music,
  Palette,
  Rocket,
  Smartphone,
  SquarePen,
  Telescope,
  Video,
  Zap,
} from "lucide-react";
import {
  CodexGoalIcon,
  CodexPetIcon,
  CodexPlanIcon,
  StitchComponentsIcon,
  StitchIdeateIcon,
} from './composer-icons';

/**
 * The selectable tools for Design mode's plus menu.
 *
 * Offers Create image / Create video / Plan (Ideate lightbulb) / Mobile on the root,
 * and Components / Guided learning under "More tools".
 */
export type ToolId =
  | 'images' | 'video' | 'plan' | 'mobile' | 'components' | 'learn'
  | 'music' | 'canvas' | 'research'
  | 'goal' | 'computer-use' | 'create-pet' | 'create-skill'
  | 'sub-agents' | 'personal-intelligence';

export interface ToolMetadata {
  id: ToolId;
  label: string;
  chipLabel: string;
  icon: React.ElementType;
}

export const TOOLS: Record<string, ToolMetadata> = {
  images: { id: 'images', label: 'Create image', chipLabel: 'Images', icon: ImagePlus },
  video: { id: 'video', label: 'Create video', chipLabel: 'Videos', icon: Video },
  plan: { id: 'plan', label: 'Plan', chipLabel: 'Plan', icon: StitchIdeateIcon },
  mobile: { id: 'mobile', label: 'Mobile', chipLabel: 'Mobile', icon: Smartphone },
  components: { id: 'components', label: 'Components', chipLabel: 'Components', icon: StitchComponentsIcon },
  learn: { id: 'learn', label: 'Guided learning', chipLabel: 'Learn', icon: BookOpen },
  music: { id: 'music', label: 'Create music', chipLabel: 'Music', icon: Music },
  canvas: { id: 'canvas', label: 'Canvas', chipLabel: 'Canvas', icon: SquarePen },
  research: { id: 'research', label: 'Deep research', chipLabel: 'Deep research', icon: Telescope },
};

/** Spark-only composer tools. The catalog controls menu placement and chips; Plan,
 * Goal and Sub-agents have runtime semantics in the Spark harness today. */
export const SPARK_TOOLS: Record<Extract<ToolId, 'plan' | 'goal' | 'computer-use' | 'create-pet' | 'create-skill' | 'sub-agents' | 'personal-intelligence'>, ToolMetadata> = {
  plan: { id: 'plan', label: 'Plan', chipLabel: 'Plan', icon: CodexPlanIcon },
  goal: { id: 'goal', label: 'Goal', chipLabel: 'Goal', icon: CodexGoalIcon },
  'computer-use': { id: 'computer-use', label: 'Computer Use', chipLabel: 'Computer Use', icon: Zap },
  'create-pet': { id: 'create-pet', label: 'Create pet', chipLabel: 'Create pet', icon: CodexPetIcon },
  'create-skill': { id: 'create-skill', label: 'Create skill', chipLabel: 'Create skill', icon: BookOpen },
  'sub-agents': { id: 'sub-agents', label: 'Sub-agents', chipLabel: 'Sub-agents', icon: MessageSquare },
  'personal-intelligence': { id: 'personal-intelligence', label: 'Personal Intelligence', chipLabel: 'Personal Intelligence', icon: Zap },
};

/**
 * Tool glyph mapping for Design mode.
 *
 * Plan uses Google Material Symbol 'lightbulb' (matching Stitch's Ideate icon).
 * Mobile uses 'smartphone'.
 * Components uses 'widgets'.
 */
export const TOOL_SYMBOLS: Record<ToolId, string> = {
  images: 'image_create',
  video: 'movie',
  plan: 'lightbulb',
  mobile: 'smartphone',
  components: 'widgets',
  learn: 'guided_learning',
  music: 'music',
  canvas: 'canvas',
  research: 'deep_research',
  goal: 'flag',
  'computer-use': 'computer',
  'create-pet': 'pets',
  'create-skill': 'school',
  'sub-agents': 'group',
  'personal-intelligence': 'person',
};

/**
 * Tooltips for Design mode tools.
 */
export const TOOL_TOOLTIPS: Record<string, string> = {
  images: 'Visualize and edit',
  video: 'Bring ideas to life',
  plan: 'Plan and ideate designs',
  mobile: 'Design mobile applications',
  components: 'Design reusable UI components',
  learn: 'Study and learn new things',
  music: 'Make audio tracks',
  canvas: 'Code, write, or make slides',
  research: 'Get detailed reports',
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
