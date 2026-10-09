import { create } from "zustand";
import { resolveDot } from "../willow/dot/dot-identity";
import { useDotStore } from "../willow/dot/state/dot-store";
import { selfUserId } from "../willow/dot/state/room-store";
import { buildSpacesSeed, spacesUsers } from "./seed";
import type { DotRole, LoadStatus, PageActor, PageMetadata, PagesAvailability, PageSymbol, ShareTarget, Space, SpacesPinKey, SpacesUser } from "./types";

/** Stand-in for the server round trip on create/rename mutations. */
export const spacesMutationDelayMs = 700;

/** A bot's explicit access on a Page; `none` blocks what it would inherit from a parent. */
export type DotAccessEntry = DotRole | "none";

export interface SpacesData {
  availability: PagesAvailability;
  spacesStatus: LoadStatus;
  pagesStatus: LoadStatus;
  /** Codex's Spaces catalog. Willow's Pages has no Spaces, so it stays empty and the editor's Space-root branches never apply. */
  spaces: Space[];
  pages: Record<string, PageMetadata>;
  /** Most recently viewed first. */
  recentPageIds: string[];
  pinnedKeys: SpacesPinKey[];
  /** "Bots on this page": per Page, each bot's explicit access by bot id; subpages inherit. */
  dotAccess: Record<string, Record<string, DotAccessEntry>>;
  users: SpacesUser[];
  /** `archive_retention_days` from the Spaces catalog; `null` when Trash keeps items indefinitely. */
  archiveRetentionDays: number | null;
  /** `space-welcome-page-ids-v1`: the user's "Your guide to pages" Page once it exists. */
  welcomePageId: string | null;
}

export interface CreatePageInput {
  parentPageId?: string | null;
  title?: string | null;
  symbol?: PageSymbol | null;
  createdBy?: PageActor;
}

interface SpacesActions {
  createPage: (input?: CreatePageInput) => PageMetadata;
  renamePage: (pageId: string, title: string | null) => void;
  setPageSymbol: (pageId: string, symbol: PageSymbol | null) => void;
  archivePage: (pageId: string) => void;
  restorePage: (pageId: string) => void;
  deletePage: (pageId: string) => void;
  recordPageView: (pageId: string) => void;
  setPinned: (key: SpacesPinKey, pinned: boolean) => void;
  /** Sets a bot's explicit access on a Page; `null` clears it so the Page inherits again. */
  setDotAccess: (pageId: string, dotId: string, entry: DotAccessEntry | null) => void;
  /** Refetch after a failed load of the Page list. */
  retryLoad: (source: "spaces" | "pages") => Promise<void>;
  resetSpacesState: (overrides?: Partial<SpacesData>) => void;
}

export type SpacesState = SpacesData & SpacesActions;

function initialSpacesData(): SpacesData {
  return {
    availability: "enabled",
    spacesStatus: "ready",
    pagesStatus: "ready",
    users: spacesUsers,
    archiveRetentionDays: null,
    welcomePageId: null,
    ...buildSpacesSeed(),
  };
}

let sequence = 0;
function nextId(prefix: string) {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export function shareKey(target: ShareTarget) {
  return `${target.type}:${target.id}`;
}

export function pagePinKey(pageId: string): SpacesPinKey {
  return `page:${pageId}`;
}

function newPage(input: CreatePageInput, position: number): PageMetadata {
  const now = new Date().toISOString();
  const author = input.createdBy ?? { actor_type: "user", account_user_id: selfUserId };
  return {
    page_id: nextId("page"),
    title: input.title ?? null,
    document_type: "page",
    symbol: input.symbol ?? null,
    parent: input.parentPageId != null ? { page_id: input.parentPageId } : null,
    drive_space_id: null,
    site_project_id: null,
    has_children: false,
    position,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    access: { can_read: true, can_write: true, can_comment: true, can_share: true, can_delete: true },
    interaction_mode: null,
    created_by: author,
    last_edited_by: author,
  };
}

export function descendantPageIds(pages: Record<string, PageMetadata>, pageId: string): string[] {
  const ids: string[] = [];
  const queue = [pageId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const entry of Object.values(pages)) {
      if (entry.parent != null && "page_id" in entry.parent && entry.parent.page_id === current) {
        ids.push(entry.page_id);
        queue.push(entry.page_id);
      }
    }
  }
  return ids;
}

export const useSpacesStore = create<SpacesState>()((set, get) => {
  function updatePage(pageId: string, update: (page: PageMetadata) => PageMetadata) {
    set((state) => {
      const current = state.pages[pageId];
      if (current == null) return state;
      return { pages: { ...state.pages, [pageId]: update(current) } };
    });
  }

  return {
    ...initialSpacesData(),

    createPage: (input = {}) => {
      const position = Object.keys(get().pages).length;
      const page = newPage(input, position);
      set((state) => {
        const pages = { ...state.pages, [page.page_id]: page };
        const parentId = input.parentPageId;
        if (parentId != null && pages[parentId] != null) pages[parentId] = { ...pages[parentId], has_children: true };
        return { pages, recentPageIds: [page.page_id, ...state.recentPageIds.filter((id) => id !== page.page_id)] };
      });
      return page;
    },

    renamePage: (pageId, title) => updatePage(pageId, (entry) => ({ ...entry, title, updated_at: new Date().toISOString() })),

    setPageSymbol: (pageId, symbol) => updatePage(pageId, (entry) => ({ ...entry, symbol })),

    archivePage: (pageId) => {
      const deletedAt = new Date().toISOString();
      const ids = [pageId, ...descendantPageIds(get().pages, pageId)];
      set((state) => {
        const pages = { ...state.pages };
        for (const id of ids) if (pages[id] != null) pages[id] = { ...pages[id], deleted_at: deletedAt };
        return { pages, pinnedKeys: state.pinnedKeys.filter((key) => !ids.some((id) => key === pagePinKey(id))) };
      });
    },

    restorePage: (pageId) => {
      const ids = [pageId, ...descendantPageIds(get().pages, pageId)];
      set((state) => {
        const pages = { ...state.pages };
        for (const id of ids) if (pages[id] != null) pages[id] = { ...pages[id], deleted_at: null };
        return { pages };
      });
    },

    deletePage: (pageId) => {
      const ids = new Set([pageId, ...descendantPageIds(get().pages, pageId)]);
      set((state) => ({
        pages: Object.fromEntries(Object.entries(state.pages).filter(([id]) => !ids.has(id))),
        recentPageIds: state.recentPageIds.filter((id) => !ids.has(id)),
        pinnedKeys: state.pinnedKeys.filter((key) => ![...ids].some((id) => key === pagePinKey(id))),
        dotAccess: Object.fromEntries(Object.entries(state.dotAccess).filter(([id]) => !ids.has(id))),
      }));
    },

    recordPageView: (pageId) =>
      set((state) => ({ recentPageIds: [pageId, ...state.recentPageIds.filter((id) => id !== pageId)] })),

    setPinned: (key, pinned) =>
      set((state) => ({
        pinnedKeys: pinned ? [...state.pinnedKeys.filter((entry) => entry !== key), key] : state.pinnedKeys.filter((entry) => entry !== key),
      })),

    setDotAccess: (pageId, dotId, entry) =>
      set((state) => {
        const dots = useDotStore.getState().dots;
        const access = { ...state.dotAccess[pageId] };
        for (const key of Object.keys(access)) if (key === dotId || resolveDot(dots, key)?.conversationId === dotId) delete access[key];
        if (entry != null) access[dotId] = entry;
        return { dotAccess: { ...state.dotAccess, [pageId]: access } };
      }),

    retryLoad: async (source) => {
      set(source === "spaces" ? { spacesStatus: "loading" } : { pagesStatus: "loading" });
      await wait(spacesMutationDelayMs);
      set(source === "spaces" ? { spacesStatus: "ready" } : { pagesStatus: "ready" });
    },

    resetSpacesState: (overrides = {}) => set({ ...initialSpacesData(), ...overrides }),
  };
});

export function isDotActor(actor: PageActor) {
  return actor.actor_type === "agent" && actor.agent_kind === "o";
}

export function findSpacesUser(users: SpacesUser[], accountUserId: string | null | undefined) {
  return accountUserId == null ? undefined : users.find((entry) => entry.account_user_id === accountUserId);
}

export function useSpace(spaceId: string | null | undefined) {
  return useSpacesStore((state) => (spaceId == null ? undefined : state.spaces.find((entry) => entry.id === spaceId)));
}

export function usePage(pageId: string | null | undefined) {
  return useSpacesStore((state) => (pageId == null ? undefined : state.pages[pageId]));
}

export function useIsPinned(key: SpacesPinKey) {
  return useSpacesStore((state) => state.pinnedKeys.includes(key));
}

/** `pz`: Pages are available to this account. */
export function usePagesEnabled() {
  return useSpacesStore((state) => state.availability === "enabled");
}

/** Resolves after the simulated server round trip of a mutation. */
export function mutationRoundTrip() {
  return wait(spacesMutationDelayMs);
}
