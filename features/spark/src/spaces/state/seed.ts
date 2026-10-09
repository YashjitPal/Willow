import { seedDotId } from "../willow/dot/dot-identity";
import { selfUserId } from "../willow/dot/state/room-store";
import type { DotRole, PageActor, PageMetadata, SpacesPinKey, SpacesUser } from "./types";

export const WORKSPACE_ID = "personal";
export const WORKSPACE_NAME = "Willow";

/** Pages are the signed-in person's alone: the only person is "you"; everyone else on a Page is one of your bots. */
export const spacesUsers: SpacesUser[] = [{ account_user_id: selfUserId, display_name: "You", email: "" }];

const hour = 3_600_000;
const day = 24 * hour;

function ago(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

const self: PageActor = { actor_type: "user", account_user_id: selfUserId };
const dot = (slot: number): PageActor => ({ actor_type: "agent", agent_kind: "o", account_user_id: selfUserId, dot_id: seedDotId(slot) });

const ownerAccess = { can_read: true, can_write: true, can_comment: true, can_share: true, can_delete: true };

interface SeedPage {
  id: string;
  title: string | null;
  symbol?: string | null;
  parent?: string | null;
  updated: number;
  createdBy?: PageActor;
  editedBy?: PageActor;
  deleted?: number;
}

function page(seed: SeedPage, position: number): PageMetadata {
  return {
    page_id: seed.id,
    title: seed.title,
    document_type: "page",
    symbol: seed.symbol == null ? null : { kind: "emoji", value: seed.symbol },
    parent: seed.parent == null ? null : { page_id: seed.parent },
    drive_space_id: null,
    site_project_id: null,
    has_children: false,
    position,
    created_at: ago(seed.updated + 6 * day),
    updated_at: ago(seed.updated),
    deleted_at: seed.deleted == null ? null : ago(seed.deleted),
    access: ownerAccess,
    interaction_mode: null,
    created_by: seed.createdBy ?? self,
    last_edited_by: seed.editedBy ?? seed.createdBy ?? self,
  };
}

const seedPages: SeedPage[] = [
  { id: "page-launch-root", title: "Launch plan", symbol: "🚀", updated: 2 * hour, editedBy: dot(0) },
  { id: "page-launch-timeline", title: "Timeline", symbol: "🗓️", parent: "page-launch-root", updated: 3 * hour },
  { id: "page-launch-press", title: "Press kit checklist", parent: "page-launch-root", updated: 1 * day, createdBy: dot(2) },
  { id: "page-launch-competitive", title: "Competitive scan", symbol: "🔭", parent: "page-launch-root", updated: 40 * 60_000, createdBy: dot(0) },
  { id: "page-launch-questions", title: "Open questions", parent: "page-launch-timeline", updated: 5 * hour, editedBy: dot(0) },
  { id: "page-design-root", title: "Design system", symbol: "🎨", updated: 6 * hour, editedBy: dot(1) },
  { id: "page-design-tokens", title: "Color tokens", parent: "page-design-root", updated: 2 * day, createdBy: dot(1) },
  { id: "page-design-audit", title: "Components audit", symbol: "🧩", parent: "page-design-root", updated: 9 * hour, createdBy: dot(1) },
  { id: "page-rituals-root", title: "Weekly rituals", symbol: "☕", updated: 3 * day, createdBy: dot(2) },
  { id: "page-rituals-retro", title: "Retro template", parent: "page-rituals-root", updated: 4 * day, createdBy: dot(2) },
  { id: "page-research-root", title: "Research notes", symbol: "🔬", updated: 8 * day },
  { id: "page-onboarding-root", title: "Learning Rust", symbol: "🦀", updated: 12 * day, createdBy: dot(1) },
  { id: "page-digest", title: "Weekly digest", symbol: "📬", updated: 20 * 60_000, createdBy: dot(0) },
  { id: "page-reading", title: "Reading list", symbol: "📚", updated: 4 * hour },
  { id: "page-meeting", title: "Meeting notes – Oct 2", updated: 1 * day },
  { id: "page-inbox-triage", title: "Inbox triage", symbol: "🗂️", updated: 2 * day, createdBy: dot(0) },
  { id: "page-trip", title: "Trip ideas", symbol: "🧳", updated: 5 * day },
  { id: "page-untitled", title: null, updated: 6 * day },
  { id: "page-q4", title: "Q4 planning", symbol: "📈", updated: 7 * hour, editedBy: dot(2) },
  { id: "page-old-draft", title: "Old draft", updated: 20 * day, deleted: 2 * day },
];

function buildPages(): Record<string, PageMetadata> {
  const pages: Record<string, PageMetadata> = {};
  seedPages.forEach((seed, index) => {
    pages[seed.id] = page(seed, index);
  });
  for (const entry of Object.values(pages)) {
    const parent = entry.parent;
    if (parent != null && "page_id" in parent && pages[parent.page_id] != null) {
      pages[parent.page_id] = { ...pages[parent.page_id], has_children: true };
    }
  }
  return pages;
}

/** The bots on each top-level Page; their subpages inherit them. */
function buildDotAccess(): Record<string, Record<string, DotRole>> {
  return {
    "page-launch-root": { [seedDotId(0)]: "editor", [seedDotId(1)]: "editor", [seedDotId(2)]: "commenter" },
    "page-design-root": { [seedDotId(1)]: "editor", [seedDotId(2)]: "viewer" },
    "page-rituals-root": { [seedDotId(2)]: "editor" },
    "page-research-root": { [seedDotId(0)]: "editor" },
    "page-onboarding-root": { [seedDotId(1)]: "editor" },
    "page-digest": { [seedDotId(0)]: "editor" },
    "page-inbox-triage": { [seedDotId(0)]: "editor" },
    "page-q4": { [seedDotId(2)]: "editor" },
  };
}

/** Most recently viewed first. */
const seedRecentPageIds = [
  "page-digest",
  "page-launch-competitive",
  "page-launch-root",
  "page-reading",
  "page-design-root",
  "page-q4",
  "page-launch-timeline",
  "page-meeting",
  "page-design-audit",
  "page-inbox-triage",
  "page-rituals-root",
  "page-trip",
];

const seedPinnedKeys: SpacesPinKey[] = ["page:page-launch-root", "page:page-digest"];

export function buildSpacesSeed() {
  return {
    spaces: [],
    pages: buildPages(),
    dotAccess: buildDotAccess(),
    recentPageIds: [...seedRecentPageIds],
    pinnedKeys: [...seedPinnedKeys],
  };
}
