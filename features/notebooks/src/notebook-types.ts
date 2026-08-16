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

export interface NotebookSource {
  id: string;
  /** Display name, e.g. a file name or page title. */
  title: string;
  /** Where it came from — shown in the source list, not fetched from. */
  kind: 'file' | 'link' | 'text' | 'drive';
  /** Plain-text content, when the source is small enough to inline. */
  content?: string;
  url?: string;
  createdAt: number;
}

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
}> = [
  {
    id: 'organize',
    icon: 'lightbulb',
    name: 'Organize your ideas',
    subtext: 'Group chats by topic and ground on your sources.',
  },
  {
    id: 'study',
    icon: 'school',
    name: 'Study and learn',
    subtext: 'Get custom lessons and track your progress.',
  },
];

/** Gemini writes "1 source" / "N sources" — singular only at exactly one. */
export const formatSourceCount = (count: number): string =>
  `${count} ${count === 1 ? 'source' : 'sources'}`;
