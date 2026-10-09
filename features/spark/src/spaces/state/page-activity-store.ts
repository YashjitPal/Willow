import { create } from "zustand";
import { seedDotId } from "../willow/dot/dot-identity";
import { spacesMutationDelayMs } from "./spaces-store";

/** An item of `GET /pages/mentions/inbox`: one of your bots mentioned you in a Page or one of its comments. */
export interface PageMentionNotification {
  notification_id: string;
  page_id: string;
  page_title: string;
  /** The bot that mentioned you; `null` when it is no longer known. */
  actor_dot_id: string | null;
  block_id: string | null;
  thread_id: string | null;
  message_id: string | null;
  created_at: string;
  read_at: string | null;
}

/** `limit` of each inbox page the Activity feed requests. */
export const pageActivityPageSize = 20;

export interface PageActivityData {
  /** `idle` until the feed first asks for the inbox. */
  status: "idle" | "loading" | "ready" | "error";
  /** Every notification the server holds, newest first. */
  notifications: PageMentionNotification[];
  /** How many of them the loaded inbox pages cover. */
  loadedCount: number;
  isFetchingNextPage: boolean;
  /** Makes the next mark-as-read request fail, to exercise the open-error toast. */
  failNextOpen: boolean;
  /** Makes the next inbox load fail. */
  failNextLoad: boolean;
}

interface PageActivityActions {
  load: () => Promise<void>;
  fetchNextPage: () => Promise<void>;
  /** `POST /pages/mentions/inbox/{notification_id}/read` */
  markRead: (notificationId: string) => Promise<void>;
  resetPageActivityState: (overrides?: Partial<PageActivityData>) => void;
}

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

function mention(
  id: string,
  pageId: string,
  pageTitle: string,
  actorDotId: string | null,
  ago: number,
  read: boolean,
  threadId: string | null = null,
): PageMentionNotification {
  const createdAt = new Date(Date.now() - ago);
  return {
    notification_id: id,
    page_id: pageId,
    page_title: pageTitle,
    actor_dot_id: actorDotId,
    block_id: threadId == null ? `block-${id}` : null,
    thread_id: threadId,
    message_id: threadId == null ? null : `message-${id}`,
    created_at: createdAt.toISOString(),
    read_at: read ? new Date(createdAt.getTime() + 20 * minute).toISOString() : null,
  };
}

export function buildPageMentions(): PageMentionNotification[] {
  return [
    mention("mention-design", "page-design-root", "Design system", seedDotId(1), 25 * minute, false, "thread-design-tokens"),
    mention("mention-q4", "page-q4", "Q4 planning", seedDotId(2), 3 * hour, false),
    mention("mention-timeline", "page-launch-timeline", "Timeline", seedDotId(1), day + 2 * hour, true, "thread-timeline-dates"),
    mention("mention-digest", "page-digest", "Weekly digest", seedDotId(0), 2 * day, true),
    mention("mention-rust", "page-onboarding-root", "Learning Rust", seedDotId(1), 4 * day, true),
    mention("mention-retro", "page-rituals-retro", "Retro template", seedDotId(2), 6 * day, true, "thread-retro-format"),
  ];
}

function initialPageActivityData(): PageActivityData {
  return {
    status: "idle",
    notifications: buildPageMentions(),
    loadedCount: 0,
    isFetchingNextPage: false,
    failNextOpen: false,
    failNextLoad: false,
  };
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export const usePageActivityStore = create<PageActivityData & PageActivityActions>()((set, get) => ({
  ...initialPageActivityData(),
  load: async () => {
    if (get().status === "loading") return;
    set({ status: "loading" });
    await wait(spacesMutationDelayMs);
    if (get().failNextLoad) {
      set({ status: "error", failNextLoad: false });
      return;
    }
    set({ status: "ready", loadedCount: Math.min(get().notifications.length, pageActivityPageSize) });
  },
  fetchNextPage: async () => {
    if (get().isFetchingNextPage) return;
    set({ isFetchingNextPage: true });
    await wait(spacesMutationDelayMs);
    set((state) => ({ isFetchingNextPage: false, loadedCount: Math.min(state.notifications.length, state.loadedCount + pageActivityPageSize) }));
  },
  markRead: async (notificationId) => {
    await wait(spacesMutationDelayMs);
    if (get().failNextOpen) {
      set({ failNextOpen: false });
      throw new Error("mark_read_failed");
    }
    const readAt = new Date().toISOString();
    set((state) => ({
      notifications: state.notifications.map((item) => (item.notification_id === notificationId && item.read_at == null ? { ...item, read_at: readAt } : item)),
    }));
  },
  resetPageActivityState: (overrides = {}) => set({ ...initialPageActivityData(), ...overrides }),
}));
