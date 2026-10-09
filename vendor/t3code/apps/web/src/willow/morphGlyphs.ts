/**
 * The `lucide` icons T3's `MorphIcon` draws (components/MorphIcon.tsx), as the Material Symbols
 * Willow draws for them — the glyphs `icons.tsx` gives their `lucide-react` names — so its copy
 * buttons, folds and toggles take Willow's icons rather than lucide's strokes. A pair still swaps,
 * without the morph between them.
 */
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  CircleAlert,
  CircleCheck,
  Code2,
  Copy,
  CornerUpRight,
  Eye,
  Folder,
  FolderClosed,
  Image,
  Lock,
  LockOpen,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Sun,
  Table2,
  Text,
  Volume2,
  VolumeOff,
} from "lucide";
import type { LucideIcon } from "lucide-react";

import { willowSymbol } from "./icons";

const glyphs = new Map<unknown, LucideIcon>([
  [Check, willowSymbol("check")],
  [ChevronDown, willowSymbol("keyboard_arrow_down")],
  [ChevronUp, willowSymbol("keyboard_arrow_up")],
  [ChevronRight, willowSymbol("chevron_right")],
  [ChevronsUpDown, willowSymbol("unfold_more")],
  [ChevronsDownUp, willowSymbol("unfold_less")],
  [Circle, willowSymbol("circle")],
  [CircleAlert, willowSymbol("error")],
  [CircleCheck, willowSymbol("check_circle")],
  [Code2, willowSymbol("code")],
  [Copy, willowSymbol("content_copy")],
  [CornerUpRight, willowSymbol("turn_right")],
  [Eye, willowSymbol("visibility")],
  [Folder, willowSymbol("folder_open")],
  [FolderClosed, willowSymbol("folder")],
  [Image, willowSymbol("image")],
  [Lock, willowSymbol("lock")],
  [LockOpen, willowSymbol("lock_open")],
  [Maximize2, willowSymbol("open_in_full")],
  [Minimize2, willowSymbol("close_fullscreen")],
  [Minus, willowSymbol("remove")],
  [Moon, willowSymbol("dark_mode")],
  [PanelLeft, willowSymbol("left_panel_open")],
  [PanelLeftClose, willowSymbol("left_panel_close")],
  [Plus, willowSymbol("add")],
  [Sun, willowSymbol("light_mode")],
  [Table2, willowSymbol("table")],
  [Text, willowSymbol("text_fields")],
  [Volume2, willowSymbol("volume_up")],
  [VolumeOff, willowSymbol("volume_off")],
]);

export const willowMorphGlyph = (icon: unknown): LucideIcon | undefined => glyphs.get(icon);
