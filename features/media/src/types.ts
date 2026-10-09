// Shared shapes for the Media app.
//
// These live here rather than in MediaView.tsx because more than one surface
// needs them: MediaView owns the gallery, AgentSidebar owns the composer, and
// both traffic in the same attachment objects. Keeping one definition means a
// field added here can't drift out of sync between the two.
//
// Types only — no runtime values, so importing this costs nothing at bundle time.

/** What kind of media a tile holds. Drives which element renders it. */
export type MediaKind = 'image' | 'video' | 'audio';

/** Lifecycle of a generation request. Tiles exist before their media does. */
export type MediaStatus = 'generating' | 'completed' | 'failed';

/**
 * A file the user attached to a prompt — either picked from disk (`file` set)
 * or dragged in from the gallery (`file` absent, `url` points at existing media).
 */
export interface ImageAttachment {
  id: string;
  url: string;
  name: string;
  file?: File;
  kind?: MediaKind;
  /**
   * A character added as an ingredient (Flow's entity reference): `url` is its portrait, and the
   * generation sends its portrait and body under its name.
   */
  characterId?: string;
}

/**
 * One tile in the gallery.
 *
 * A `MediaItem` is created at request time with `status: 'generating'` and no
 * `url`; the URL arrives when generation finishes. So `url` being undefined is
 * a normal intermediate state, not an error — check `status` before rendering.
 */
export type MediaItem = {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  url?: string;
  audioUrl?: string;
  error?: string;
  prompt: string;
  shortenedPrompt?: string;
  modelId: string;
  modelName: string;
  ratio: string;
  timestamp: number;
  /**
   * The submission it came from: the items one generation makes (x1 to x4) share it, which is
   * what batch view groups by (batch/batch-layout.ts). Items from before it existed are grouped
   * by their timestamps instead.
   */
  batchId?: string;
  attachments?: ImageAttachment[];
  /** Flow-style detail-view lineage. Items in one viewer history share this id. */
  historyGroupId?: string;
  historyParentId?: string;
  /** A character's portrait or body (or a version of one); kept out of the gallery grid. */
  characterId?: string;
  /**
   * The collection it is in (collection-store.ts), shown there instead of at the top of the
   * project. On disk its file sits in that collection's folder, and the reconcile reads this back
   * from where the file is.
   */
  collectionId?: string;
  favorite?: boolean;
  isSavedToFS?: boolean;
  fsName?: string;
  /** A song's audio file, beside its cover (`fsName`) in the same folder. */
  audioFsName?: string;
  lyrics?: { time: number; text: string }[];
  effort?: string;
  quality?: string;
  resolution?: string;
};
