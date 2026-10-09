/**
 * The Tools tab's state, outside React: the account's own tools, its favorites and pins, and the
 * manager's tab, saved through `@willow/storage/media-tools`. Templates and community tools come
 * from the catalog; `entries()` gives every tool the pages draw as one `ToolEntry`.
 *
 * Flow's rules kept here:
 * - Opening a template opens your own copy of it: Flow's server answers a template's version
 *   with a "Remix of …" it makes the first time and reuses after (`openTemplateCopy`).
 * - A remix is named "Remix of <name>" and keeps the icon and description.
 * - My creations are ordered by when each was last opened (else changed), newest first.
 * - A tool from Create tool exists once its first build does: until that turn saves a version it
 *   is `pending` and listed nowhere, and one left pending by an earlier visit is dropped.
 */
import { atom, computed } from 'nanostores';
import {
  deleteTool as deleteStoredTool,
  listTools,
  loadTool,
  loadToolChat,
  loadToolLocalStorage,
  loadToolPrefs,
  loadToolVersion,
  onMediaToolsChange,
  saveTool,
  saveToolChat,
  saveToolLocalStorage,
  saveToolPrefs,
  saveToolVersion,
  toolKvClear,
  toolKvGet,
  toolKvKeys,
  toolKvRemove,
  toolKvSet,
  type StoredTool,
  type StoredToolChatMessage,
  type StoredToolFile,
  type StoredToolPrefs,
  type StoredToolVersion,
} from '@willow/storage/media-tools';
import { catalogTool, randomToolIcon, type CatalogTool, type ToolCategory } from './catalog';
import type { StorageValue, ToolStorage } from './runtime/bridge';

export type ToolKind = 'self' | 'template' | 'community';
export type ManagerTab = 'MY_APPS' | 'COMMUNITY' | 'GALLERY';

/** One card's worth of a tool, whatever its kind. */
export interface ToolEntry {
  id: string;
  kind: ToolKind;
  name: string;
  description: string;
  author: string;
  icon: string;
  /** A gallery card's picture: a catalog preview or an own tool's cover. */
  preview: string | null;
  category: ToolCategory;
  favorite: boolean;
  pinned: boolean;
  spotlightOrder?: number;
  /** Own tools only. */
  tool?: StoredTool;
}

export const UNTITLED_TOOL = 'Untitled applet';

let scopeId = 'guest';
let loadedScope: string | null = null;

export const $tools = atom<StoredTool[]>([]);
export const $toolPrefs = atom<StoredToolPrefs>({ favorites: [], pins: [] });
export const $toolsLoaded = atom(false);

const uid = (prefix: string): string =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
/** A pending tool older than this was left by a visit that ended mid-build. */
const ABANDONED_AFTER_MS = 60 * 60 * 1000;
const newToolId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : uid('tool-');

/** Loads the account's tools once per scope (user + root + workspace). */
export async function initToolsStore(scope: string): Promise<void> {
  scopeId = scope || 'guest';
  if (loadedScope === scopeId) return;
  loadedScope = scopeId;
  $toolsLoaded.set(false);
  try {
    const [tools, prefs] = await Promise.all([listTools(scopeId), loadToolPrefs(scopeId)]);
    if (loadedScope !== scopeId) return;
    const abandoned = tools.filter((t) => t.pending && Date.now() - t.createdAt > ABANDONED_AFTER_MS);
    $tools.set(tools.filter((t) => !abandoned.includes(t)));
    $toolPrefs.set(prefs);
    for (const t of abandoned) void deleteStoredTool(t.id, scopeId).catch(() => undefined);
  } catch (error) {
    console.warn('[tools] could not load the tools store', error);
  } finally {
    if (loadedScope === scopeId) $toolsLoaded.set(true);
  }
}

const persistPrefs = (prefs: StoredToolPrefs) => {
  $toolPrefs.set(prefs);
  void saveToolPrefs(prefs, scopeId).catch((e) => console.warn('[tools] prefs not saved', e));
};

const putTool = (tool: StoredTool) => {
  $tools.set([tool, ...$tools.get().filter((t) => t.id !== tool.id)]);
  void saveTool(tool, scopeId).catch((e) => console.warn('[tools] tool not saved', e));
};

export const getTool = (id: string): StoredTool | undefined => $tools.get().find((t) => t.id === id);

export function toolKind(id: string): ToolKind | null {
  if (getTool(id)) return 'self';
  const c = catalogTool(id);
  if (!c) return null;
  return c.id.startsWith('community-') ? 'community' : 'template';
}

const fromCatalog = (c: CatalogTool, prefs: StoredToolPrefs): ToolEntry => ({
  id: c.id,
  kind: c.id.startsWith('community-') ? 'community' : 'template',
  name: c.name,
  description: c.description,
  author: c.author,
  icon: c.icon,
  preview: c.preview,
  category: c.category,
  favorite: prefs.favorites.includes(c.id),
  pinned: prefs.pins.includes(c.id),
  ...(c.spotlightOrder !== undefined ? { spotlightOrder: c.spotlightOrder } : {}),
});

const fromTool = (t: StoredTool, prefs: StoredToolPrefs): ToolEntry => ({
  id: t.id,
  kind: 'self',
  name: t.name || UNTITLED_TOOL,
  description: t.description,
  author: 'You',
  icon: t.icon,
  preview: t.cover ?? null,
  category: 'Experimental',
  favorite: prefs.favorites.includes(t.id),
  pinned: prefs.pins.includes(t.id),
  tool: t,
});

export function toolEntry(id: string): ToolEntry | null {
  const prefs = $toolPrefs.get();
  const own = getTool(id);
  if (own) return fromTool(own, prefs);
  const c = catalogTool(id);
  return c ? fromCatalog(c, prefs) : null;
}

/** My creations: last opened (else changed) first, then name — Flow's `xdb`. */
export const $myCreations = computed([$tools, $toolPrefs], (tools, prefs) =>
  tools
    .filter((t) => !t.pending)
    .sort((a, b) => {
      const ta = a.lastOpenedAt ?? a.updatedAt;
      const tb = b.lastOpenedAt ?? b.updatedAt;
      return ta !== tb ? tb - ta : a.name.localeCompare(b.name);
    })
    .map((t) => fromTool(t, prefs)));

/** Favorites: every favorited tool, own or not, in the order they were favorited. */
const resolveEntries = (ids: readonly string[], tools: readonly StoredTool[], prefs: StoredToolPrefs): ToolEntry[] =>
  ids
    .map((id) => {
      const own = tools.find((t) => t.id === id);
      if (own) return own.pending ? null : fromTool(own, prefs);
      const c = catalogTool(id);
      return c ? fromCatalog(c, prefs) : null;
    })
    .filter((e): e is ToolEntry => e !== null);

/** Favorites: every favorited tool, own or not, in the order they were favorited. */
export const $favorites = computed([$tools, $toolPrefs], (tools, prefs) => resolveEntries(prefs.favorites, tools, prefs));

/** Pinned tools in pin order. */
export const $pinned = computed([$tools, $toolPrefs], (tools, prefs) => resolveEntries(prefs.pins, tools, prefs));

/**
 * The sidebar's Tools list, as Flow's nav list builds it: pinned tools, then the ones opened
 * lately that are not pinned, newest first; five at most, and a count of the rest.
 */
export const DOCK_LIMIT = 5;
export const $dock = computed([$tools, $toolPrefs], (tools, prefs) => {
  const pinned = resolveEntries(prefs.pins, tools, prefs);
  const recent = resolveEntries((prefs.recent ?? []).filter((id) => !prefs.pins.includes(id)), tools, prefs);
  const all = [...pinned, ...recent];
  return { items: all.slice(0, DOCK_LIMIT), more: Math.max(0, all.length - DOCK_LIMIT), total: all.length };
});

/** A tool was opened: it joins the dock's recent tools. */
export function noteToolOpened(id: string): void {
  const prefs = $toolPrefs.get();
  const recent = [id, ...(prefs.recent ?? []).filter((x) => x !== id)].slice(0, 20);
  if ((prefs.recent ?? [])[0] !== id) persistPrefs({ ...prefs, recent });
}

export function setDockOpen(open: boolean): void {
  const prefs = $toolPrefs.get();
  if (!!prefs.dockOpen !== open) persistPrefs({ ...prefs, dockOpen: open });
}

export const catalogEntry = (c: CatalogTool): ToolEntry => fromCatalog(c, $toolPrefs.get());

/* ------------------------------------------------------------------ *
 * Prefs
 * ------------------------------------------------------------------ */

export function setActiveTab(tab: ManagerTab): void {
  const prefs = $toolPrefs.get();
  if (prefs.activeTab !== tab) persistPrefs({ ...prefs, activeTab: tab });
}

export function toggleFavorite(id: string): boolean {
  const prefs = $toolPrefs.get();
  const on = !prefs.favorites.includes(id);
  persistPrefs({ ...prefs, favorites: on ? [...prefs.favorites, id] : prefs.favorites.filter((x) => x !== id) });
  return on;
}

/** Returns whether the tool is pinned now. */
export function togglePin(id: string): boolean {
  const prefs = $toolPrefs.get();
  const on = !prefs.pins.includes(id);
  persistPrefs({ ...prefs, pins: on ? [...prefs.pins, id] : prefs.pins.filter((x) => x !== id) });
  return on;
}

export function setPanelWidth(width: number): void {
  const prefs = $toolPrefs.get();
  if (prefs.panelWidth !== width) persistPrefs({ ...prefs, panelWidth: width });
}

/* ------------------------------------------------------------------ *
 * Own tools
 * ------------------------------------------------------------------ */

async function writeVersion(toolId: string, files: StoredToolFile[], origin: StoredToolVersion['origin']): Promise<StoredToolVersion> {
  const version: StoredToolVersion = { id: uid('v-'), toolId, createdAt: Date.now(), files: files.map((f) => ({ path: f.path, content: f.content })), origin };
  await saveToolVersion(version, scopeId);
  return version;
}

/** A new tool of your own; resolves once its first version is saved. */
export async function createTool(spec: {
  name?: string;
  description?: string;
  icon?: string;
  files?: StoredToolFile[];
  origin?: StoredToolVersion['origin'];
  remixedFrom?: StoredTool['remixedFrom'];
  /** Create tool's: hidden until the first build saves a version. */
  pending?: boolean;
}): Promise<StoredTool> {
  const id = newToolId();
  const version = await writeVersion(id, spec.files ?? [], spec.origin ?? 'create');
  const now = Date.now();
  const tool: StoredTool = {
    id,
    name: spec.name ?? '',
    description: spec.description ?? '',
    icon: spec.icon ?? randomToolIcon(),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    versionId: version.id,
    allowRemixing: true,
    ...(spec.remixedFrom ? { remixedFrom: spec.remixedFrom } : {}),
    ...(spec.pending ? { pending: true } : {}),
  };
  putTool(tool);
  return tool;
}

export function updateTool(id: string, patch: Partial<Omit<StoredTool, 'id'>>, options: { touch?: boolean } = {}): StoredTool | undefined {
  const tool = getTool(id);
  if (!tool) return undefined;
  const next: StoredTool = { ...tool, ...patch, ...(options.touch === false ? {} : { updatedAt: Date.now() }) };
  putTool(next);
  return next;
}

export const renameTool = (id: string, name: string) => updateTool(id, { name: name.trim() || UNTITLED_TOOL });
export const setToolIcon = (id: string, icon: string) => updateTool(id, { icon });
export const setToolDescription = (id: string, description: string) => updateTool(id, { description });
export const setToolCover = (id: string, cover: string | undefined) => updateTool(id, { cover });

/** Marks a tool opened, which is what orders My creations. */
export function touchTool(id: string): void {
  if (getTool(id)) updateTool(id, { lastOpenedAt: Date.now() }, { touch: false });
}

/** A tool gone from the pages, and from the favorites, pins and recent tools that named it. */
function forgetTool(id: string): void {
  $tools.set($tools.get().filter((t) => t.id !== id));
  const prefs = $toolPrefs.get();
  if (prefs.favorites.includes(id) || prefs.pins.includes(id) || prefs.recent?.includes(id)) {
    persistPrefs({
      ...prefs,
      favorites: prefs.favorites.filter((x) => x !== id),
      pins: prefs.pins.filter((x) => x !== id),
      recent: (prefs.recent ?? []).filter((x) => x !== id),
    });
  }
}

export async function deleteTool(id: string): Promise<void> {
  forgetTool(id);
  await deleteStoredTool(id, scopeId);
}

// The Tools folder put a tool back, or found its file deleted (./tools-disk.ts): the pages follow.
onMediaToolsChange((change) => {
  const { toolId } = change;
  if (!change.fromDisk || !toolId || change.scopeId !== loadedScope) return;
  if (change.what === 'deleted') {
    forgetTool(toolId);
    return;
  }
  void loadTool(toolId, change.scopeId)
    .then((tool) => {
      if (tool && change.scopeId === loadedScope) $tools.set([tool, ...$tools.get().filter((t) => t.id !== toolId)]);
    })
    .catch((error) => console.warn('[tools] a tool from the Tools folder did not load', error));
});

/** The files a tool runs: an own tool's current version, a catalog tool's shipped files. */
export async function loadToolFiles(id: string): Promise<StoredToolFile[]> {
  const own = getTool(id);
  if (own) {
    const version = await loadToolVersion(own.id, own.versionId, scopeId);
    return version?.files ?? [];
  }
  const { loadCatalogFiles } = await import('./catalog-sources');
  return loadCatalogFiles(id);
}

export const loadVersion = (toolId: string, versionId: string) => loadToolVersion(toolId, versionId, scopeId);

/** Saves new files as the tool's current version. */
export async function commitVersion(toolId: string, files: StoredToolFile[], origin: StoredToolVersion['origin'] = 'edit'): Promise<StoredToolVersion> {
  const version = await writeVersion(toolId, files, origin);
  const tool = getTool(toolId);
  if (tool?.pending) {
    const { pending: _pending, ...made } = tool;
    putTool({ ...made, versionId: version.id, updatedAt: Date.now() });
  } else {
    updateTool(toolId, { versionId: version.id });
  }
  return version;
}

/** "Restore tool to this version": that version's files become a new current version. */
export async function restoreVersion(toolId: string, versionId: string): Promise<StoredToolVersion | null> {
  const old = await loadToolVersion(toolId, versionId, scopeId);
  if (!old) return null;
  return commitVersion(toolId, old.files, 'restore');
}

/** Remix tool: a copy of your own, "Remix of <name>". */
export async function remixTool(id: string): Promise<StoredTool> {
  const entry = toolEntry(id);
  if (!entry) throw new Error('Tool not found');
  const files = await loadToolFiles(id);
  return createTool({
    name: `Remix of ${entry.name}`,
    description: entry.description,
    icon: entry.icon,
    files,
    origin: 'remix',
    remixedFrom: { id, name: entry.name, kind: entry.kind },
  });
}

const copying = new Map<string, Promise<StoredTool>>();

/** A template opens as your copy of it, made the first time (see the file comment); one copy however often it is asked for at once. */
export function openTemplateCopy(templateId: string): Promise<StoredTool> {
  const existing = $tools.get().find((t) => t.remixedFrom?.kind === 'template' && t.remixedFrom.id === templateId);
  if (existing) return Promise.resolve(existing);
  let copy = copying.get(templateId);
  if (!copy) {
    copy = remixTool(templateId).finally(() => copying.delete(templateId));
    copying.set(templateId, copy);
  }
  return copy;
}

/* ------------------------------------------------------------------ *
 * The Tool Builder's conversation
 * ------------------------------------------------------------------ */

export const loadBuilderChat = (toolId: string) => loadToolChat(toolId, scopeId);
export const saveBuilderChat = (toolId: string, messages: StoredToolChatMessage[]) => saveToolChat(toolId, messages, scopeId);

/* ------------------------------------------------------------------ *
 * A tool's own storage (any tool, catalog ones included)
 * ------------------------------------------------------------------ */

export function toolStorage(toolId: string): ToolStorage {
  return {
    getItem: async (key) => (await toolKvGet(toolId, key, scopeId)) as StorageValue | null,
    setItem: (key, value) => toolKvSet(toolId, key, value, scopeId),
    removeItem: (key) => toolKvRemove(toolId, key, scopeId),
    clear: () => toolKvClear(toolId, scopeId),
    keys: (prefix) => toolKvKeys(toolId, scopeId, prefix ?? ''),
  };
}

export const loadLocalStorage = (toolId: string) => loadToolLocalStorage(toolId, scopeId);
export const saveLocalStorage = (toolId: string, entries: Record<string, string>) => saveToolLocalStorage(toolId, entries, scopeId);
/** Reset tool and clear media: everything the tool stored, its localStorage included. */
export const resetToolStorage = (toolId: string) => toolKvClear(toolId, scopeId, { includeLocalStorage: true });
