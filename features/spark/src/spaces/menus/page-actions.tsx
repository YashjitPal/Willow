import { defineMessages } from "react-intl";
import {
  ArrowDownOpenBaseLight16Icon,
  ArrowDownOpenBaseLight20Icon,
  ChatBubblePlusLight16Icon,
  ChatBubblePlusLight20Icon,
  PencilLight16Icon,
  PencilLight20Icon,
  Person2Light20Icon,
  PersonGroupLight16Icon,
  PinLight16Icon,
  PinLight20Icon,
  PinSlashLight16Icon,
  PinSlashLight20Icon,
  SquareOnSquareLight16Icon,
  SquareOnSquareLight20Icon,
  TrashLight16Icon,
  TrashLight20Icon,
} from "../../codex/icons";
import type { ContextMenuItem } from "../../codex/ui/context-menu";
import { copyToClipboard } from "../../codex/ui/copy-button";
import { SizedIcon, type SizedIconSource } from "../../codex/ui/sized-icon";
import { blockToMarkdown } from "../editor/state/page-document";
import { usePageDocumentsStore } from "../editor/state/page-documents-store";
import { pageShareUrl } from "../navigation";
import type { PageMetadata } from "../state";

export const pageActionMessages = defineMessages({
  loadingSpace: {
    id: "codex.space.sidebar.actions.loading",
    defaultMessage: "Loading actions…",
    description: "Disabled menu item shown while a Space's action permissions are loading",
  },
  loadingPage: {
    id: "codex.space.page.actions.loading",
    defaultMessage: "Loading actions…",
    description: "Disabled menu item while permissions for a Page are loading",
  },
  rename: {
    id: "codex.space.page.actions.rename",
    defaultMessage: "Rename",
    description: "Page menu action that opens a dialog to change the Page title",
  },
  archivePage: {
    id: "codex.space.page.actions.archive",
    defaultMessage: "Delete",
    description: "Menu action that moves a shared Page owned by the signed-in person to Trash",
  },
  copy: {
    id: "codex.space.page.actions.copy",
    defaultMessage: "Copy",
    description: "Submenu label for copying shared Page content, a Page link, or a Page ID",
  },
  copyLink: {
    id: "codex.space.page.header.copyLink",
    defaultMessage: "Copy link",
    description: "Tooltip and accessible label for the Page header button that copies the current Page's URL to the clipboard",
  },
  markdown: {
    id: "codex.space.page.actions.copyMarkdown",
    defaultMessage: "Copy as Markdown",
    description: "Page action that copies the current shared Page content as Markdown",
  },
  downloadMarkdown: {
    id: "codex.space.page.actions.downloadMarkdown",
    defaultMessage: "Download as Markdown",
    description: "Page menu action that saves the Page content as a Markdown file",
  },
  newChat: {
    id: "codex.space.page.actions.newChat",
    defaultMessage: "New chat",
    description: "Page action that opens an unsent chat with the Page referenced in its composer",
  },
  pageId: {
    id: "codex.space.page.actions.copyId",
    defaultMessage: "Page ID",
    description: "Page action that copies a shared Page identifier",
  },
  pageLink: {
    id: "codex.space.page.actions.copyLink",
    defaultMessage: "Page link",
    description: "Page action that copies a link to a shared Page",
  },
  pinPage: {
    id: "codex.space.page.actions.pinPage",
    defaultMessage: "Pin",
    description: "Page menu action that pins the shared Page in the sidebar",
  },
  unpinPage: {
    id: "codex.space.page.actions.unpinPage",
    defaultMessage: "Unpin",
    description: "Page menu action that removes the shared Page from the sidebar's Pinned section",
  },
  share: {
    id: "willow.pages.actions.dots",
    defaultMessage: "Bots on this page",
    description: "Page action that opens the dialog listing the bots that work on the Page",
  },
});

const icons = {
  rename: { 16: PencilLight16Icon, 20: PencilLight20Icon },
  pin: { 16: PinLight16Icon, 20: PinLight20Icon },
  unpin: { 16: PinSlashLight16Icon, 20: PinSlashLight20Icon },
  newChat: { 16: ChatBubblePlusLight16Icon, 20: ChatBubblePlusLight20Icon },
  archive: { 16: TrashLight16Icon, 20: TrashLight20Icon },
  copy: { 16: SquareOnSquareLight16Icon, 20: SquareOnSquareLight20Icon },
  share: { 16: PersonGroupLight16Icon, 20: Person2Light20Icon },
  download: { 16: ArrowDownOpenBaseLight16Icon, 20: ArrowDownOpenBaseLight20Icon },
} satisfies Record<string, SizedIconSource>;

/** `$0` */
function sizedIcon(icon: SizedIconSource) {
  return { icon: <SizedIcon icon={icon} /> };
}

/** `hko` */
export function canRenamePage(page: PageMetadata | undefined) {
  return page?.access.can_read === true && page.access.can_write && page.interaction_mode !== "request_changes";
}

/** `AH` */
export function canDeletePage(page: PageMetadata | undefined) {
  return page?.access.can_delete === true;
}

/** `_ko` */
function pinItem(isPinned: boolean, onTogglePinned: () => void): ContextMenuItem {
  const action = isPinned ? "unpin" : "pin";
  return {
    id: `${action}-page`,
    message: isPinned ? pageActionMessages.unpinPage : pageActionMessages.pinPage,
    ...sizedIcon(icons[action]),
    onSelect: onTogglePinned,
  };
}

/** Markdown of a Page's blocks, standing in for the serialized document. */
export function pageMarkdown(pageId: string) {
  const document = usePageDocumentsStore.getState().documents[pageId];
  return (document?.blocks ?? []).map(blockToMarkdown).join("\n\n");
}

/** `C8t`: the last path segment with characters invalid in file names replaced. */
function safeFileName(name: string) {
  const fileName = (name.replaceAll("\\", "/").replace(/\/+$/u, "").split("/").at(-1) ?? "").replace(/[<>:"|?*]/gu, "_").replaceAll("\0", "_");
  return fileName === "." || fileName === ".." || fileName === "" ? "download" : fileName;
}

/** `downloadPageMarkdown` (download-markdown chunk) with `Ywn`'s anchor download. */
export function downloadPageMarkdown(pageId: string, title: string | null | undefined) {
  const name = title?.trim() || pageId;
  const fileName = safeFileName(/\.md$/iu.test(name) ? name : `${name}.md`);
  const url = URL.createObjectURL(new Blob([pageMarkdown(pageId)], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface PageMenuOptions {
  page: PageMetadata;
  isPinned: boolean;
  onArchive?: () => void;
  onNewChat?: () => void;
  onRename?: () => void;
  /** Opens "Bots on this page". */
  onShare?: () => void;
  onTogglePinned?: () => void;
}

/** `cR` (`CHo`) with `kind: "page"`, building `mko`'s list, plus the Space menu's New chat. "Open in new window" is not cloned. */
export function pageMenuItems({ page, isPinned, onArchive, onNewChat, onRename, onShare, onTogglePinned }: PageMenuOptions): ContextMenuItem[] {
  const pageId = page.page_id;
  const canEdit = page.interaction_mode !== "request_changes";
  const canCopyMarkdown = page.document_type === "page" && page.access.can_read;
  const copyMarkdown: ContextMenuItem = {
    id: "copy-page-markdown",
    message: pageActionMessages.markdown,
    ...sizedIcon(icons.copy),
    enabled: canCopyMarkdown,
    onSelect: () => void copyToClipboard(pageMarkdown(pageId)),
  };
  const items: ContextMenuItem[] = [];
  if (canRenamePage(page) && onRename != null) {
    items.push({ id: "rename-page", message: pageActionMessages.rename, ...sizedIcon(icons.rename), selectAfterClose: true, onSelect: onRename });
  }
  if (onTogglePinned != null) items.push(pinItem(isPinned, onTogglePinned));
  if (onNewChat != null) items.push({ id: "new-chat-with-page", message: pageActionMessages.newChat, ...sizedIcon(icons.newChat), onSelect: onNewChat });
  if (canEdit && onArchive != null) {
    items.push({
      id: "archive-page",
      message: pageActionMessages.archivePage,
      ...sizedIcon(icons.archive),
      tone: "danger",
      selectAfterClose: true,
      onSelect: onArchive,
    });
  }
  if (items.length > 0) items.push({ id: "page-organization-separator", type: "separator" });
  if (canEdit && onShare != null) {
    items.push({ id: "share-page-or-space", message: pageActionMessages.share, ...sizedIcon(icons.share), selectAfterClose: true, onSelect: onShare });
  }
  items.push({
    id: "copy-page-actions",
    message: pageActionMessages.copy,
    ...sizedIcon(icons.copy),
    submenu: [
      {
        id: "copy-page-link",
        message: pageActionMessages.copyLink,
        ...sizedIcon(icons.copy),
        onSelect: () => void copyToClipboard(pageShareUrl(pageId)),
      },
      copyMarkdown,
    ],
  });
  if (canCopyMarkdown) {
    items.push({
      id: "download-page-markdown",
      message: pageActionMessages.downloadMarkdown,
      ...sizedIcon(icons.download),
      enabled: canCopyMarkdown,
      selectAfterClose: true,
      onSelect: () => downloadPageMarkdown(pageId, page.title),
    });
  }
  return items;
}
