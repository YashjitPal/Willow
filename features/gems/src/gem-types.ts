/**
 * The Gem model, its default tools, and the logo palette.
 *
 * Everything here was read off gemini.google.com's Gem manager and editor; see
 * `features/gems/AGENTS.md` for where each value came from.
 */

/**
 * The tool a new chat with the Gem starts with selected. The ids are the composer's own
 * `ToolId`s, so a Gem's choice is handed to the composer as-is.
 */
export type GemDefaultTool = 'none' | 'images' | 'video' | 'music' | 'canvas' | 'research' | 'learn';

export interface GemToolOption {
  id: GemDefaultTool;
  label: string;
  icon: string;
  family: 'google-symbols' | 'luminous';
}

/** Gemini's Default tool menu, in its order. Only "No default tool" is Google Symbols. */
export const GEM_DEFAULT_TOOLS: readonly GemToolOption[] = [
  { id: 'none', label: 'No default tool', icon: 'do_not_disturb_on', family: 'google-symbols' },
  { id: 'images', label: 'Create image', icon: 'image_create', family: 'luminous' },
  { id: 'video', label: 'Create video', icon: 'movie', family: 'luminous' },
  { id: 'music', label: 'Create music', icon: 'music', family: 'luminous' },
  { id: 'canvas', label: 'Canvas', icon: 'canvas', family: 'luminous' },
  { id: 'research', label: 'Deep research', icon: 'deep_research', family: 'luminous' },
  { id: 'learn', label: 'Guided learning', icon: 'guided_learning', family: 'luminous' },
];

export const isGemDefaultTool = (value: unknown): value is GemDefaultTool =>
  GEM_DEFAULT_TOOLS.some((tool) => tool.id === value);

/** A file attached to a Gem as its knowledge. */
export interface GemKnowledgeFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** Extracted text, when the file has any. This is what grounds the Gem's chats. */
  content?: string;
  /** Why there is no text — a scan, an unsupported type — so the prompt can say so. */
  problem?: string;
  addedAt: number;
}

export interface Gem {
  /** Also the file name stem in `<workspace>/Gems/` — see `makeGemId`. */
  id: string;
  name: string;
  description: string;
  instructions: string;
  defaultTool: GemDefaultTool;
  knowledge: GemKnowledgeFile[];
  /** "Disable Knowledge Citations": keep the files out of the Gem's answers. */
  hideCitations: boolean;
  createdAt: number;
  updatedAt: number;
}

/** What the editor holds before a Gem exists. */
export type GemDraft = Omit<Gem, 'id' | 'createdAt' | 'updatedAt'>;

export const emptyGemDraft = (): GemDraft => ({
  name: '',
  description: '',
  instructions: '',
  defaultTool: 'none',
  knowledge: [],
  hideCitations: false,
});

export interface GemLogoColors {
  bg: string;
  fg: string;
}

/**
 * The eight logo pairs Gemini draws Gem avatars in, dark theme. Seven read off the My
 * Gems rows and the eighth off the premade Writing editor; Gemini keeps a Gem's colour
 * for its lifetime, so Willow picks one from a hash of the id (`gemLogoColors`).
 */
export const GEM_LOGO_PALETTE_DARK: readonly GemLogoColors[] = [
  { bg: 'rgb(0, 64, 78)', fg: 'rgb(37, 178, 212)' },
  { bg: 'rgb(0, 61, 100)', fg: 'rgb(96, 169, 237)' },
  { bg: 'rgb(79, 53, 0)', fg: 'rgb(216, 152, 0)' },
  { bg: 'rgb(97, 43, 0)', fg: 'rgb(236, 140, 76)' },
  { bg: 'rgb(0, 65, 68)', fg: 'rgb(0, 182, 188)' },
  { bg: 'rgb(96, 38, 61)', fg: 'rgb(219, 141, 167)' },
  { bg: 'rgb(55, 45, 128)', fg: 'rgb(162, 153, 243)' },
  { bg: 'rgb(85, 34, 110)', fg: 'rgb(200, 142, 225)' },
];

/** The same hues as light containers. Gemini's light theme was not measured. */
export const GEM_LOGO_PALETTE_LIGHT: readonly GemLogoColors[] = [
  { bg: 'rgb(196, 238, 247)', fg: 'rgb(0, 78, 94)' },
  { bg: 'rgb(211, 227, 253)', fg: 'rgb(4, 30, 73)' },
  { bg: 'rgb(255, 223, 153)', fg: 'rgb(92, 65, 0)' },
  { bg: 'rgb(255, 219, 203)', fg: 'rgb(122, 50, 0)' },
  { bg: 'rgb(185, 240, 242)', fg: 'rgb(0, 88, 92)' },
  { bg: 'rgb(255, 216, 228)', fg: 'rgb(125, 41, 80)' },
  { bg: 'rgb(226, 223, 255)', fg: 'rgb(63, 52, 151)' },
  { bg: 'rgb(243, 218, 255)', fg: 'rgb(107, 46, 136)' },
];

/** An unsaved Gem's logo: Gemini's neutral `gem_spark` disc, later its letter. */
export const NEW_GEM_LOGO_DARK: GemLogoColors = { bg: 'rgb(25, 29, 28)', fg: 'rgb(169, 172, 170)' };
export const NEW_GEM_LOGO_LIGHT: GemLogoColors = { bg: 'rgb(233, 238, 246)', fg: 'rgb(68, 71, 70)' };

/** A stable palette slot for an id: the same Gem always gets the same colour. */
export const gemPaletteIndex = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % GEM_LOGO_PALETTE_DARK.length;
};

export const gemLogoColors = (index: number, isLight: boolean): GemLogoColors =>
  (isLight ? GEM_LOGO_PALETTE_LIGHT : GEM_LOGO_PALETTE_DARK)[index % GEM_LOGO_PALETTE_DARK.length];

/** The letter a custom Gem's logo shows: its name's first character, upper-cased. */
export const gemInitial = (name: string): string => {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase() : '';
};
