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
  Copy,
  Globe,
  ImagePlus,
  Lightbulb,
  MessageSquare,
  Palette,
  Rocket,
  SquarePen,
  Telescope,
  Zap,
} from "lucide-react";
import { SpotifyIcon } from './composer-icons';

export type ToolId = 'thinking' | 'images' | 'research' | 'web' | 'learn' | 'canvas' | 'quizzes' | 'spotify';

export interface ToolMetadata {
  id: ToolId;
  label: string;
  chipLabel: string;
  icon: React.ElementType;
}

export const TOOLS: Record<ToolId, ToolMetadata> = {
  thinking: { id: 'thinking', label: 'Thinking', chipLabel: 'Think', icon: Lightbulb },
  images: { id: 'images', label: 'Create image', chipLabel: 'Image', icon: ImagePlus },
  research: { id: 'research', label: 'Deep research', chipLabel: 'Research', icon: Telescope },
  web: { id: 'web', label: 'Web search', chipLabel: 'Search', icon: Globe },
  learn: { id: 'learn', label: 'Study and learn', chipLabel: 'Learn', icon: BookOpen },
  canvas: { id: 'canvas', label: 'Canvas', chipLabel: 'Canvas', icon: SquarePen },
  quizzes: { id: 'quizzes', label: 'Quizzes', chipLabel: 'Quizzes', icon: Copy },
  spotify: { id: 'spotify', label: 'Spotify', chipLabel: 'Spotify', icon: SpotifyIcon as any },
};

export const TOOL_SYMBOLS: Partial<Record<ToolId, string>> = {
  thinking: 'lightbulb',
  images: 'add_photo_alternate',
  research: 'travel_explore',
  web: 'language',
  learn: 'school',
  canvas: 'draw',
  quizzes: 'quiz',
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
