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
              createdAt: typeof src.createdAt === 'number' ? src.createdAt : createdAt,
            }];
          })
        : [],
      pinned: row.pinned === true,
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
