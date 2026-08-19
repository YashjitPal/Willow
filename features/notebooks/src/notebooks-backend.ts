/**
 * The notebooks backend: a scoped-localStorage registry.
 *
 * Deliberately modelled on `@willow/projects/registry` rather than on the
 * synced-folder engine, for one reason that matters in practice: notebooks must
 * work with **no local folder connected**. The folder-backed stores gate every
 * read behind `isLocalFolderConnected`, which is why Recents disappears without
 * one; a notebook list that vanished the same way would make the sidebar section
 * look broken on a fresh browser profile.
 *
 * Scope keys follow the existing convention exactly — `<uid>::<root>::<workspace>`,
 * defaulting to `signed-out::browser::My Willow` — and `setNotebookStorageScope`
 * is called from the same place in `LocalFSContext` that sets the project, media,
 * and code-session scopes. Sharing the format means a signed-in user's notebooks
 * follow them across the same boundaries their chats already do.
 *
 * Every mutation goes through `writeNotebooks`, which persists and then emits
 * `NOTEBOOKS_UPDATED_EVENT`. The store subscribes to that, so a write from any
 * surface (sidebar menu, card grid, create screen) updates all of them without
 * those surfaces knowing about each other.
 */
import type { Notebook, NotebookVertical } from './notebook-types';
import { DEFAULT_NOTEBOOK_EMOJI, UNTITLED_NOTEBOOK_TITLE } from './notebook-types';

const NOTEBOOKS_KEY_PREFIX = 'willow_notebooks:v1:';
const DEFAULT_NOTEBOOK_SCOPE = 'signed-out::browser::My Willow';

export const NOTEBOOKS_UPDATED_EVENT = 'willow_notebooks_updated';

let activeScopeId = DEFAULT_NOTEBOOK_SCOPE;

export const getNotebooksStorageKey = (scopeId = activeScopeId): string =>
  `${NOTEBOOKS_KEY_PREFIX}${scopeId}`;

export const getNotebookStorageScope = (): string => activeScopeId;

/**
 * Point the registry at a new scope.
 *
 * Returns whether the scope actually changed, so the caller can skip a reload
 * when `LocalFSContext` re-runs its init for an unrelated reason.
 */
export const setNotebookStorageScope = (scopeId: string): boolean => {
  const next = scopeId || DEFAULT_NOTEBOOK_SCOPE;
  if (next === activeScopeId) return false;
  activeScopeId = next;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NOTEBOOKS_UPDATED_EVENT));
  }
  return true;
};

/** True when `key` is the one this scope reads, for `storage`-event filtering. */
export const isActiveNotebooksStorageKey = (key: string | null): boolean =>
  key === getNotebooksStorageKey();

/**
 * Coerce whatever is on disk into a valid notebook list.
 *
 * Written defensively on purpose: this data is user-editable through devtools
 * and survives across versions, so a single malformed entry must not take the
 * sidebar down with it. Unknown fields are dropped, missing ones are defaulted,
 * and an entry without a usable `id` is discarded entirely — an id is the only
 * field nothing else can be reconstructed from.
 */
const parseNotebooks = (raw: string | null): Notebook[] => {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: Notebook[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const vertical: NotebookVertical = row.vertical === 'study' ? 'study' : 'organize';
    const createdAt = typeof row.createdAt === 'number' ? row.createdAt : 0;
    out.push({
      id,
      title: typeof row.title === 'string' && row.title.trim() ? row.title : UNTITLED_NOTEBOOK_TITLE,
      emoji: typeof row.emoji === 'string' && row.emoji ? row.emoji : DEFAULT_NOTEBOOK_EMOJI,
      vertical,
      chatIds: Array.isArray(row.chatIds) ? row.chatIds.filter((c): c is string => typeof c === 'string') : [],
      sources: Array.isArray(row.sources)
        ? row.sources.flatMap((s) => {
            if (!s || typeof s !== 'object') return [];
            const src = s as Record<string, unknown>;
            if (typeof src.id !== 'string' || typeof src.title !== 'string') return [];
            const kind = src.kind;
            return [{
              id: src.id,
              title: src.title,
              /*
               * `'link'` is accepted as an alias for `'website'`: notebooks written
               * by the first version of this feature used it, and silently
               * downgrading those rows to `'file'` would swap their icon and lose
               * the URL's meaning.
               */
              kind: kind === 'website' || kind === 'link' ? 'website'
                : kind === 'text' || kind === 'drive' ? kind : 'file',
              content: typeof src.content === 'string' ? src.content : undefined,
              url: typeof src.url === 'string' ? src.url : undefined,
              mimeType: typeof src.mimeType === 'string' ? src.mimeType : undefined,
              size: typeof src.size === 'number' ? src.size : undefined,
              dataUrl: typeof src.dataUrl === 'string' ? src.dataUrl : undefined,
              fsName: typeof src.fsName === 'string' && src.fsName ? src.fsName : undefined,
              pages: typeof src.pages === 'number' ? src.pages : undefined,
              createdAt: typeof src.createdAt === 'number' ? src.createdAt : createdAt,
            }];
          })
        : [],
      pinned: row.pinned === true,
      /*
       * Both of these were written by the settings sheet and dropped here, which
       * made them look like they never saved: the store re-hydrates on its own
       * commit, so the round trip through this parser happened immediately.
       */
      useMemory: row.useMemory === true ? true : undefined,
      instructions: typeof row.instructions === 'string' && row.instructions ? row.instructions : undefined,
      fsFolder: typeof row.fsFolder === 'string' && row.fsFolder ? row.fsFolder : undefined,
      createdAt,
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : createdAt,
    });
  }
  return out;
};

export const readNotebooks = (scopeId = activeScopeId): Notebook[] => {
  if (typeof localStorage === 'undefined') return [];
  return parseNotebooks(localStorage.getItem(getNotebooksStorageKey(scopeId)));
};

export const writeNotebooks = (notebooks: Notebook[], scopeId = activeScopeId): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(getNotebooksStorageKey(scopeId), JSON.stringify(notebooks));
  } catch {
    // A quota failure must not break the in-memory list the user is looking at;
    // the store has already been updated by the time this runs.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NOTEBOOKS_UPDATED_EVENT));
  }
};

/**
 * Sort for every surface that lists notebooks: pinned first, then most recently
 * updated. Gemini's sidebar and card grid agree on this order, and the pinned
 * group is what keeps a pinned notebook visible once the sidebar starts
 * truncating the list.
 */
export const sortNotebooks = (notebooks: readonly Notebook[]): Notebook[] =>
  [...notebooks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

/**
 * Mint an id.
 *
 * `crypto.randomUUID()` matches the shape Gemini uses in its own URLs
 * (`/notebook/a7ac8b83-9e7f-47c4-85a6-2ee6c5a0e0f2`). The fallback covers
 * insecure origins, where `randomUUID` is undefined.
 */
export const makeNotebookId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rand = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${rand()}${rand()}-${rand()}-${rand()}-${rand()}-${rand()}${rand()}${rand()}`;
};

// ── The disk mirror: folder names, and who owns which chat ───────────────────
//
// The registry above stays the source of truth for notebook EXISTENCE — that is
// what keeps notebooks working with no folder connected. What follows is the
// vocabulary the disk mirror needs, and it lives here rather than in the storage
// package because `LocalFSContext` is allowed to import this module and nothing
// deeper (see `features/notebooks/AGENTS.md`). Two callers deriving folder names
// separately would eventually disagree, and a disagreement here means a chat
// written to a folder nobody scans.

/** The notebook folder that holds every notebook folder. */
export const NOTEBOOKS_DIR_NAME = 'Notebooks';

/** Inside a notebook's folder. */
export const NOTEBOOK_SOURCES_DIR_NAME = 'Sources';
export const NOTEBOOK_CHATS_DIR_NAME = 'Chats';

/**
 * Windows forbids these in a path segment, and so does this code on every
 * platform: the same folder has to be openable after the user syncs it to a PC.
 * `\` is included, which `getSanitizedWorkspaceName` omits — a title containing
 * one would otherwise become a directory separator.
 */
const ILLEGAL_FOLDER_CHARS = /[\\/:*?"<>|]/g;

/**
 * Names Windows cannot create at all, in any casing and with or without an
 * extension. A notebook titled "NUL" would fail every write forever, silently.
 */
const RESERVED_DEVICE_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** Long enough for a real title, short enough to survive a deep path. */
const MAX_FOLDER_NAME_LENGTH = 80;

/**
 * A notebook title as one legal path segment, ignoring collisions.
 *
 * Not exported: a name is only usable once it has been de-duplicated against the
 * names already handed out, which is what `deriveNotebookFolderName` does.
 */
const sanitizeFolderSegment = (title: string): string => {
  const cleaned = (title || '')
    .replace(ILLEGAL_FOLDER_CHARS, '')
    // Control characters are equally illegal and arrive by paste.
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, MAX_FOLDER_NAME_LENGTH)
    /*
     * Windows silently DROPS a trailing dot or space when creating a directory, so
     * a folder asked for as "Notes." comes back named "Notes" — every later lookup
     * by the requested name then misses, and the mirror re-creates it every poll.
     * Truncation above can also leave a trailing space, so this runs after it.
     */
    .replace(/[. ]+$/, '')
    .trim();
  if (!cleaned) return UNTITLED_NOTEBOOK_TITLE;
  // Reserved even with an extension, so test the stem.
  const stem = cleaned.split('.')[0].toUpperCase();
  return RESERVED_DEVICE_NAMES.has(stem) ? `${cleaned}_` : cleaned;
};

/**
 * The folder name to give a notebook that does not have one yet.
 *
 * Titles are free text and are allowed to collide — Gemini's own list holds two
 * "Untitled notebook"s and `createNotebook` reproduces that — so a taken name
 * gets `Name (2)`, `Name (3)`.
 *
 * Dedup is against the names **already assigned** (`fsFolder`), never against
 * other notebooks' titles, and that is the load-bearing part. A name derived from
 * the whole list every time is not stable: rename the first of two "Physics"
 * notebooks to "Chem" and the second's derived name silently changes from
 * `Physics (2)` to `Physics`, while its folder — and every chat in it — is still
 * where it was. Assign once, then keep it; see `Notebook.fsFolder`.
 *
 * Case-INSENSITIVE, because the filesystems this targets are: "physics" and
 * "Physics" are one directory on Windows and on a default-configured macOS, and
 * treating them as two produces a folder holding another notebook's chats.
 */
export const deriveNotebookFolderName = (
  notebook: Pick<Notebook, 'id' | 'title'>,
  notebooks: readonly Notebook[],
): string => {
  const taken = new Set<string>();
  for (const other of notebooks) {
    if (other.id === notebook.id || !other.fsFolder) continue;
    taken.add(other.fsFolder.toLowerCase());
  }
  const base = sanitizeFolderSegment(notebook.title);
  let name = base;
  let suffix = 2;
  while (taken.has(name.toLowerCase())) {
    name = `${base} (${suffix})`;
    suffix += 1;
  }
  return name;
};

/**
 * The notebook's folder name, assigning and persisting one if it has none.
 *
 * Idempotent, and the single place a folder name is ever chosen — so the name in
 * the registry and the name on disk cannot be derived by two callers that
 * disagree. Returns `''` for an unknown notebook.
 *
 * Call this only when a folder is actually connected: a name assigned with
 * nowhere to put it would leave the registry claiming a folder that does not
 * exist.
 */
export const ensureNotebookFolderName = (notebookId: string): string => {
  if (!notebookId) return '';
  const notebooks = readNotebooks();
  const notebook = notebooks.find((entry) => entry.id === notebookId);
  if (!notebook) return '';
  if (notebook.fsFolder) return notebook.fsFolder;
  const folderName = deriveNotebookFolderName(notebook, notebooks);
  writeNotebooks(sortNotebooks(notebooks.map((entry) => (
    entry.id === notebookId ? { ...entry, fsFolder: folderName } : entry
  ))));
  return folderName;
};

/**
 * Record the folder name a notebook's folder now has, after a rename on disk.
 *
 * Separate from `ensureNotebookFolderName` on purpose: this one overwrites, and
 * must only be called once the move has actually landed. `updatedAt` is left
 * alone — a folder rename is bookkeeping, not an edit to the notebook.
 */
export const setNotebookFolderName = (notebookId: string, folderName: string): boolean => {
  if (!notebookId || !folderName) return false;
  const notebooks = readNotebooks();
  const notebook = notebooks.find((entry) => entry.id === notebookId);
  if (!notebook || notebook.fsFolder === folderName) return false;
  writeNotebooks(sortNotebooks(notebooks.map((entry) => (
    entry.id === notebookId ? { ...entry, fsFolder: folderName } : entry
  ))));
  return true;
};

/**
 * Record the file name a source got inside the notebook's `Sources/` folder.
 *
 * `updatedAt` is left alone deliberately: this is the disk mirror reporting back,
 * not the user editing anything. Routing it through the store's `updateNotebook`
 * would bump the timestamp — and the backfill patches every pre-existing source at
 * once, which would reorder the whole sidebar on the first poll after a folder is
 * connected.
 *
 * Down here rather than in the store because the **backfill** is a caller and it
 * runs inside `LocalFSContext`, which may only reach this module. Same arrangement
 * as `adoptChatIntoNotebook` below: two entry points, one persist path, and the
 * store re-hydrates off `NOTEBOOKS_UPDATED_EVENT` either way.
 *
 * Returns whether anything changed, so a caller inside a poll can stay
 * change-only.
 */
export const setNotebookSourceFsName = (
  notebookId: string,
  sourceId: string,
  fsName: string,
): boolean => {
  if (!notebookId || !sourceId || !fsName) return false;
  const notebooks = readNotebooks();
  const notebook = notebooks.find((entry) => entry.id === notebookId);
  if (!notebook) return false;
  const source = notebook.sources.find((entry) => entry.id === sourceId);
  if (!source || source.fsName === fsName) return false;
  writeNotebooks(sortNotebooks(notebooks.map((entry) => (
    entry.id === notebookId
      ? { ...entry, sources: entry.sources.map((s) => (s.id === sourceId ? { ...s, fsName } : s)) }
      : entry
  ))));
  return true;
};

export interface NotebookChatIndex {
  /**
   * Every notebook folder that exists, so the reconciler knows which directories
   * to scan. **Only notebooks that have been assigned an `fsFolder`** — a name
   * this list predicted rather than assigned would send the scan into a folder
   * that belongs to something else.
   */
  folders: Array<{ notebookId: string; folderName: string }>;
  /** `notebookId -> folderName`, for resolving one chat's directory. */
  folderByNotebookId: Record<string, string>;
  /** `chatId -> owning notebook id`. A chat belongs to at most one notebook. */
  chatOwner: Record<string, string>;
}

const EMPTY_CHAT_INDEX: NotebookChatIndex = { folders: [], folderByNotebookId: {}, chatOwner: {} };

const buildNotebookChatIndex = (notebooks: readonly Notebook[]): NotebookChatIndex => {
  const folders: NotebookChatIndex['folders'] = [];
  const folderByNotebookId: Record<string, string> = {};
  const chatOwner: Record<string, string> = {};
  for (const notebook of notebooks) {
    if (notebook.fsFolder) {
      folders.push({ notebookId: notebook.id, folderName: notebook.fsFolder });
      folderByNotebookId[notebook.id] = notebook.fsFolder;
    }
    for (const chatId of notebook.chatIds) {
      // First owner wins. `findNotebookForChat` assumes at most one, and a
      // hand-edited registry can list the same chat under two notebooks.
      if (!chatOwner[chatId]) chatOwner[chatId] = notebook.id;
    }
  }
  return { folders, folderByNotebookId, chatOwner };
};

/*
 * Memoized on the raw stored string, which IS the input — so there is no
 * invalidation to get wrong, and any write through `writeNotebooks` (or a
 * devtools edit, or another tab) changes the key by construction.
 *
 * Worth doing because the disk reconciler reads this on every 3-second poll while
 * a notebook's `sources[].content` can hold hundreds of thousands of characters:
 * re-parsing that blob on a timer is exactly the kind of steady cost invariant 7
 * exists to prevent.
 */
let chatIndexCache: { key: string; raw: string; index: NotebookChatIndex } | null = null;

/** What the disk mirror needs from the registry, in one read. */
export const readNotebookChatIndex = (scopeId = activeScopeId): NotebookChatIndex => {
  if (typeof localStorage === 'undefined') return EMPTY_CHAT_INDEX;
  const key = getNotebooksStorageKey(scopeId);
  const raw = localStorage.getItem(key) ?? '';
  if (chatIndexCache && chatIndexCache.key === key && chatIndexCache.raw === raw) {
    return chatIndexCache.index;
  }
  const index = buildNotebookChatIndex(parseNotebooks(raw || null));
  chatIndexCache = { key, raw, index };
  return index;
};

/**
 * File `chatId` into `notebookId`, or unfile it when that is null/`''`.
 *
 * The registry write the **disk reconciler** makes, when it finds a chat's file
 * somewhere the registry did not put it — the user moved it in Explorer, and disk
 * is authoritative for where a file is (invariant 3). It lives here, not in
 * `notebooks-store`, because the reconciler may only reach this module; the write
 * still lands on every surface, since `writeNotebooks` fires
 * `NOTEBOOKS_UPDATED_EVENT` and the store re-hydrates from it. So there is still
 * one atom and one persist path, just two entry points into it.
 *
 * Returns whether anything changed, which is what lets a caller inside a poll
 * stay change-only: no change, no write, no event, no re-render.
 */
export const adoptChatIntoNotebook = (chatId: string, notebookId: string | null): boolean => {
  if (!chatId) return false;
  const target = notebookId || '';
  const notebooks = readNotebooks();
  const now = Date.now();
  let changed = false;
  const next = notebooks.map((notebook) => {
    const holds = notebook.chatIds.includes(chatId);
    if (notebook.id === target) {
      if (holds) return notebook;
      changed = true;
      return { ...notebook, chatIds: [chatId, ...notebook.chatIds], updatedAt: now };
    }
    if (!holds) return notebook;
    changed = true;
    return { ...notebook, chatIds: notebook.chatIds.filter((id) => id !== chatId), updatedAt: now };
  });
  if (!changed) return false;
  writeNotebooks(sortNotebooks(next));
  return true;
};
