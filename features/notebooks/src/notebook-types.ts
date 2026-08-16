/**
 * Notebook types.
 *
 * Gemini's own code calls these "projects" (`project-mgmt`, `project-sidenav-list`,
 * `project-editor-window-v2`) and only the user-facing strings say "notebook".
 * Willow already has an unrelated `Project` concept — a code workspace on disk —
 * so this feature keeps the user-facing name throughout and never reuses the
 * project registry. The two are separate stores with separate scope keys.
 */

/**
 * Which of the two "What are you working on?" cards the notebook was created
 * under. Gemini keeps this on the notebook, not just on the create screen: the
 * `study` vertical is what puts `?subtype=study` on its chats and swaps the
 * notebook page for the tutor layout.
 */
export type NotebookVertical = 'organize' | 'study';

/**
 * What a source is, which drives its row icon and how it is grounded.
 *
 * `kind` is about provenance, not format — a PDF and a PNG are both `file`, and
 * `mimeType` distinguishes them. Grounding cares about `content` (inlined text)
 * and `dataUrl` (bytes we can hand a multimodal model); a source may have neither,
 * in which case only its name and type reach the model.
 */
export type NotebookSourceKind = 'file' | 'website' | 'text' | 'drive';

export interface NotebookSource {
  id: string;
  /** Display name, e.g. a file name or page title. */
  title: string;
  kind: NotebookSourceKind;
  /** Extracted plain text, when the source could be read as text. */
  content?: string;
  /** For websites and Drive items. */
  url?: string;
  mimeType?: string;
  size?: number;
  /**
   * Small binary sources (images) inlined as a data URL. Size-capped at write time
   * — localStorage is the backing store and a few megabytes of base64 would blow
   * the quota for every notebook.
   *
   * NOTE: this is stored but **not yet sent to the model.** The grounding block
   * only tells the model the image exists (and not to invent its contents). Wiring
   * it through as a real attachment means extending the hand-off to carry
   * `ComposerAttachment`s, which `handleSend` already accepts — that is the next
   * step, not something this field currently achieves.
   */
  dataUrl?: string;
  createdAt: number;
}

/** Above this, a file's bytes are not inlined; only its name and type are kept. */
export const MAX_INLINE_SOURCE_BYTES = 1_500_000;

export interface Notebook {
  id: string;
  title: string;
  /**
   * The card/header glyph. Gemini stores a literal emoji rather than an icon
   * name — the card renders it as text at 36px — and defaults new notebooks to
   * 📔. Users can change it, so it is persisted per notebook.
   */
  emoji: string;
  vertical: NotebookVertical;
  /** Chat ids belonging to this notebook, newest first. */
  chatIds: string[];
  sources: NotebookSource[];
  /** Pinned notebooks sort above the rest and show a filled pin. */
  pinned: boolean;
  /**
   * Notebook settings, from Gemini's `project-instructions-editor` (512x446).
   *
   * `useMemory` is its "Use notebook memory" switch — "Consider all chats in this
   * notebook when responding". `instructions` is the free-text box beneath it, which
   * Gemini folds into the system prompt for every turn in the notebook.
   *
   * Optional because notebooks created before this existed have neither, and a
   * missing value must read as off/empty rather than break `parseNotebooks`.
   */
  useMemory?: boolean;
  instructions?: string;
  createdAt: number;
  updatedAt: number;
}

/** Gemini's default for a notebook with no explicit glyph. */
export const DEFAULT_NOTEBOOK_EMOJI = '📔';

/** Gemini's placeholder title for a notebook created without a name. */
export const UNTITLED_NOTEBOOK_TITLE = 'Untitled notebook';

/**
 * The two verticals, in Gemini's order, with the icon each card shows.
 *
 * `lightbulb` and `school` are **Google Symbols** ligatures, not Luminous ones —
 * measured on the live create screen, where the chip icons carry
 * `google-symbols` while every other icon on the page carries `lumi-symbols`.
 * Rendering them from the Luminous face silently falls back to a blank box.
 */
export const NOTEBOOK_VERTICALS: ReadonlyArray<{
  id: NotebookVertical;
  icon: string;
  name: string;
  subtext: string;
  /**
   * The create screen's heading while this vertical is selected. Gemini swaps it
   * live — "What are you working on?" becomes "What are you studying?" the moment
   * the Study chip is picked, and nothing else on the screen changes with it.
   */
  prompt: string;
  /**
   * The typewriter placeholder phrases for this vertical, in Gemini's order.
   *
   * The two verticals have entirely **different** lists, not a shared one — the
   * whole cycle swaps with the chip. Sampled over 32s per vertical; switching
   * restarts from the first phrase rather than finishing the current one.
   */
  placeholders: readonly string[];
}> = [
  {
    id: 'organize',
    icon: 'lightbulb',
    name: 'Organize your ideas',
    subtext: 'Group chats by topic and ground on your sources.',
    prompt: 'What are you working on?',
    placeholders: ['Project or idea', 'Weekly meal prep', 'Creative brainstorm', 'Moving checklist'],
  },
  {
    id: 'study',
    icon: 'school',
    name: 'Study and learn',
    subtext: 'Get custom lessons and track your progress.',
    prompt: 'What are you studying?',
    placeholders: ['Subject or topic', 'Plant biology', 'Creative writing', 'World geography'],
  },
];

/** Gemini writes "1 source" / "N sources" — singular only at exactly one. */
export const formatSourceCount = (count: number): string =>
  `${count} ${count === 1 ? 'source' : 'sources'}`;
