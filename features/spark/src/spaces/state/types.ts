/**
 * Shapes mirror the Spaces API objects the app reads (`/spaces/v2`, `/pages/{page_id}`,
 * `/spaces/v2/{space_id}/shares`, `/pages/{page_id}/shares`), so field names stay snake_case.
 */

/** `fz`: `loading` while the pages capability resolves; `disabled` redirects `/space*` to `/`. */
export type PagesAvailability = "loading" | "enabled" | "disabled";

export type LoadStatus = "loading" | "ready" | "error";

/** `XH` collapses several sources and lets `request_changes` win. */
export type InteractionMode = "request_changes" | null;

export interface PageAccess {
  can_read: boolean;
  can_write: boolean;
  can_comment?: boolean;
  can_share?: boolean;
  /** Gates the Delete (move to Trash) action (`AH`). */
  can_delete?: boolean;
}

export type PageSymbol = { kind: "emoji"; value: string } | { kind: "icon"; value: string; color: string | null };

export type PageParent = { page_id: string } | { space_id: string };

/**
 * Block attribution actor (page activity panel). A bot is `actor_type: "agent"` with
 * `agent_kind: "o"`; `account_user_id` is the person who authorized it. Willow's people
 * have several bots, so a bot actor also names which one (`dot_id`); Willow itself is
 * the agent with no `agent_kind`.
 */
export type PageActor =
  | { actor_type: "user"; account_user_id: string }
  | { actor_type: "agent"; agent_kind: "o" | null; account_user_id: string; dot_id?: string }
  | { actor_type: "system"; account_user_id: null };

/** What a bot may do on a Page ("Bots on this page"); subpages inherit it. */
export type DotRole = "editor" | "commenter" | "viewer";

export type PageDocumentType = "page" | "site";

export interface PageMetadata {
  page_id: string;
  title: string | null;
  document_type: PageDocumentType;
  symbol: PageSymbol | null;
  parent: PageParent | null;
  /** Space the page belongs to; `null` for personal pages. */
  drive_space_id: string | null;
  site_project_id: string | null;
  has_children: boolean;
  position: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  access: PageAccess;
  interaction_mode: InteractionMode;
  created_by: PageActor;
  last_edited_by: PageActor;
}

export interface SpaceAppearance {
  emoji: string | null;
  theme: string | null;
}

export type SpaceBackingType = "drive";

export interface Space {
  id: string;
  name: string;
  root_page_id: string;
  backing_type: SpaceBackingType;
  appearance: SpaceAppearance | null;
  can_edit_appearance: boolean;
  interaction_mode: InteractionMode;
  owner_account_user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type SharePrincipalType = "user" | "group" | "workspace";

export type ShareRole = "viewer" | "commenter" | "editor";

export interface ShareRecipient {
  recipient_type: "principal";
  principal_type: SharePrincipalType;
  principal_id: string;
}

export interface Share {
  share_id: string;
  recipient: ShareRecipient;
  role_id: ShareRole | "owner";
  /** Present when access comes from the containing Space rather than the Page itself. */
  inherited_access: boolean;
}

export interface AccessRequest {
  request_id: string;
  requester_name: string;
  requester_email: string;
  requested_role: ShareRole;
}

export interface SpacesUser {
  account_user_id: string;
  display_name: string;
  email: string;
}

export interface SpacesGroup {
  id: string;
  name: string;
  member_count: number;
}

export type SharingManagementStatus = "loading" | "available" | "unavailable";

export type ShareTargetType = "space" | "page";

export interface ShareTarget {
  type: ShareTargetType;
  id: string;
}

/** Sidebar pin key: pinned Spaces and Pages share the Pinned section with threads. */
export type SpacesPinKey = `space:${string}` | `page:${string}`;

/** `zV`: a Space the user started creating that the server has not confirmed yet. */
export interface PendingSpace {
  localId: string;
  name: string;
  appearance: SpaceAppearance | null;
  status: "creating" | "failed";
}
