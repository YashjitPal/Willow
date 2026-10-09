import type { ReactNode, Ref } from "react";
import type { ProjectColor, ProjectIconId } from "./project-appearance";

/** The picker tabs, in display order. */
export type SymbolKind = "emoji" | "icon" | "teamIcon";

export interface EmojiChoice {
  kind: "emoji";
  value: string;
  metadata: { label: string; categoryId?: string };
}

export interface IconChoice {
  kind: "icon";
  value: ProjectIconId;
  metadata: { label: string; categoryId: string; keywords: string[]; color?: ProjectColor };
}

/** An illustrated team icon; the server provides the catalog. */
export interface TeamIconChoice {
  kind: "teamIcon";
  value: string;
  metadata: { label: string; url: string; categoryId: string; keywords: string[] };
}

export type SymbolChoice = EmojiChoice | IconChoice | TeamIconChoice;

export interface SymbolSection {
  id: string;
  heading: string;
  choices: SymbolChoice[];
}

/** A picked choice and the element it was picked from (the glyph in the compact layout; none when picked with Enter in the search field). */
export type SymbolSelection = SymbolChoice & { source?: HTMLElement };

export interface EmojiCapability {
  /** Restricts the grid to these emoji (one "Emojis" section, no category bar). */
  allowedEmojis?: string[];
  selectedEmojis?: string[];
  getEmojiLabel?: (emoji: string) => string;
}

export interface IconCapability {
  allowedIcons?: ProjectIconId[];
  selectedIcon?: ProjectIconId | null;
  color?: ProjectColor;
  /** Shows the color palette above the icons. */
  onColorChange?: (color: ProjectColor) => void;
}

export interface TeamIconCapability {
  choices: TeamIconChoice[];
  selectedIcon?: string | null;
}

/** Which tabs the picker offers and how each behaves. */
export interface SymbolPickerCapabilities {
  emoji?: EmojiCapability;
  icons?: IconCapability;
  teamIcons?: TeamIconCapability;
}

/** A stored Page or Space symbol (`value` / `onChange` usage). */
export type SymbolValue = { kind: "emoji"; value: string } | { kind: "icon"; value: string; color: string | null } | { kind: "none" };

export type SymbolPickerLayoutKind = "grid" | "compact";

/** Props shared by the picker, its lazily loaded browser and its loading fallback. */
export interface SymbolBrowserOptions {
  disabled?: boolean;
  defaultKind?: SymbolKind;
  /** Controlled search query; the picker keeps its own when omitted. */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Text shown in the search field when it differs from the query. */
  inputValue?: string;
  availableHeight?: string;
  layout?: SymbolPickerLayoutKind;
  showSearch?: boolean;
  showHeadings?: boolean;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** An outside element (e.g. a composer) that drives the grid with the arrow keys. */
  keyboardTarget?: HTMLElement | null;
  onReturnToSearch?: () => void;
  footer?: ReactNode;
}

export interface SymbolBrowserProps extends SymbolBrowserOptions {
  capabilities: SymbolPickerCapabilities;
  kind: SymbolKind;
  query: string;
  onQueryChange: (query: string) => void;
  onKindChange: (kind: SymbolKind) => void;
  onSelect: (selection: SymbolSelection) => void;
  onClear?: () => void;
  availableHeight: string;
}
