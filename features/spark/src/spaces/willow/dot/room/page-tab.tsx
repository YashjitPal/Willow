import clsx from "clsx";
import { useEffect, useEffectEvent, useLayoutEffect, useState } from "react";
import { defineMessage, useIntl, type IntlShape } from "react-intl";
import type { NavigateFunction } from "react-router-dom";
import { SitesLight16Icon } from "../../../../codex/icons";
import { defineRightPanelTabType, openRightPanelTab, updateRightPanelTab, useRightPanelStore, type RightPanelTabPanelProps } from "../../shell/right-panel-state";
import { AccessDenied } from "../../../components/access-denied";
import { PageIcon, pageIconAndTitle, SpaceIcon } from "../../../components/space-icon";
import { pageMessages } from "../../../editor/messages";
import { SpacePageContent } from "../../../editor/space-page";
import { usePage, useSpacesStore, WORKSPACE_ID, type PageMetadata } from "../../../state";

const pageTabMessages = {
  defaultTitle: defineMessage({
    id: "codex.space.page.sidePanel.defaultTitle",
    defaultMessage: "Page",
    description: "Fallback tab title for a shared Page opened beside a Codex task before its title loads",
  }),
  openFullPage: defineMessage({
    id: "codex.space.page.sidePanel.openFullPage",
    defaultMessage: "Open full page",
    description: "Context menu action that opens a shared Page as the main Codex app view",
  }),
  newPage: defineMessage({
    id: "thread.sidePanel.newTab.page.title",
    defaultMessage: "New page",
    description: "Action label for creating a shared Page in the task side panel",
  }),
};

/** What the original's openers read from the thread scope. */
export interface SpacePageTabScope {
  intl: IntlShape;
  navigate: NavigateFunction;
}

interface SpacePageTabProps {
  accountId: string;
  pageId: string;
  blockId?: string | null;
  navigate: NavigateFunction;
}

const spacePageTabId = (accountId: string, pageId: string) => `space-page:${accountId}:${pageId}`;

/** Tabs whose `focusTitle` tab state is still set: the title takes focus once, when it can. */
const pendingTitleFocus = new Set<string>();

/** `IWo` */
function pageTabTitle(page: PageMetadata | null | undefined, intl: IntlShape) {
  if (page == null) return intl.formatMessage(pageTabMessages.defaultTitle);
  return page.title?.trim() || intl.formatMessage(pageMessages.untitled);
}

/** `YZ` (`Dxr`) without a navigation target. */
function pageRoute(pageId: string, blockId: string | null | undefined) {
  return `/space/${encodeURIComponent(pageId)}${blockId == null ? "" : `#${encodeURIComponent(blockId)}`}`;
}

/** `kmr` with `loadSpace`: a Space's icon for its root Page, otherwise the Page's symbol or leading emoji. */
function SpacePageTabIcon({ className, pageId, title }: { className: string; pageId: string; title: string }) {
  const page = usePage(pageId);
  const space = useSpacesStore((state) => state.spaces.find((entry) => entry.root_page_id === pageId));
  if (space != null) {
    return (
      <span className={clsx("flex items-center justify-center", className)}>
        <SpaceIcon spaceId={space.id} symbol={page?.symbol} />
      </span>
    );
  }
  return (
    <PageIcon
      pageId={page?.page_id}
      symbol={page?.symbol}
      fallbackIcon={page?.site_project_id == null ? undefined : <SitesLight16Icon className={className} />}
      iconClassName={className}
      title={title}
    >
      {({ icon }) => icon}
    </PageIcon>
  );
}

/** `RWo`: the tab label drops the leading emoji the icon shows, except for a Space's root Page. */
function SpacePageTabTitle({ pageId, title }: { pageId: string; title: string }) {
  const symbol = useSpacesStore((state) => state.pages[pageId]?.symbol);
  const isSpaceRoot = useSpacesStore((state) => state.spaces.some((entry) => entry.root_page_id === pageId));
  return isSpaceRoot ? title : pageIconAndTitle(title, undefined, undefined, symbol).title;
}

/** `LWo` */
function pageTabDisplay(title: string, pageId: string) {
  return {
    icon: <SpacePageTabIcon className="text-sm leading-none select-none" pageId={pageId} title={title} />,
    title,
    titleContent: <SpacePageTabTitle pageId={pageId} title={title} />,
    tooltip: title,
  };
}

/** `SpacePageSidePanelTab` (tab chunk) in `Be` (layout chunk): the Page editor beside the chat. */
function SpacePageSidePanelTab({ accountId, pageId, onClose }: SpacePageTabProps & RightPanelTabPanelProps) {
  const intl = useIntl();
  const tabId = spacePageTabId(accountId, pageId);
  const page = usePage(pageId);
  const isActive = useRightPanelStore((state) => state.activeTabId === tabId);
  const [focusTitle, setFocusTitle] = useState(() => pendingTitleFocus.has(tabId));
  const title = page == null ? null : pageTabTitle(page, intl);

  useLayoutEffect(() => {
    if (title != null) updateRightPanelTab(tabId, pageTabDisplay(title, pageId));
  }, [pageId, tabId, title]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target;
    if (
      event.key !== "Escape" ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.defaultPrevented ||
      !(target instanceof Element) ||
      target.closest("[data-tab-id]")?.getAttribute("data-tab-id") !== tabId ||
      target.closest("[inert]") != null ||
      target.closest("[data-page-explorer-panel]") != null ||
      useRightPanelStore.getState().isFullWidth
    ) {
      return;
    }
    event.preventDefault();
    onClose();
  });

  useEffect(() => {
    if (!isActive) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [isActive]);

  return (
    <div className="@container/page-explorer relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {page == null ? (
        <AccessDenied target={{ kind: "page", id: pageId }} />
      ) : (
        <SpacePageContent
          key={`${accountId}:${pageId}`}
          page={page}
          surface="side-panel"
          focusTitle={isActive && focusTitle}
          onTitleFocused={() => {
            pendingTitleFocus.delete(tabId);
            setFocusTitle(false);
          }}
        />
      )}
      <div className="pointer-events-none absolute inset-x-0 top-[var(--viewer-header-height)] bottom-0" />
    </div>
  );
}

/** `GWo({ open: R6, restore: ihs })` (`chs`) */
const spacePageTab = defineRightPanelTabType<SpacePageTabProps>("space-page", SpacePageSidePanelTab, {
  getId: ({ accountId, pageId }) => spacePageTabId(accountId, pageId),
  getContextMenuItems: ({ accountId, pageId, blockId, navigate }) => [
    {
      id: "open-full-page",
      message: pageTabMessages.openFullPage,
      onSelect: () => {
        if (useSpacesStore.getState().availability === "enabled" && accountId === WORKSPACE_ID) void navigate(pageRoute(pageId, blockId));
      },
    },
  ],
  onClose: ({ accountId, pageId }) => {
    pendingTitleFocus.delete(spacePageTabId(accountId, pageId));
  },
});

export interface OpenSpacePageTabOptions {
  revealAndFocus?: boolean;
  blockId?: string | null;
  /** Focuses the title once the Page can be edited; only for a tab this call opens. */
  focusTitle?: boolean;
  title?: string;
}

/** `R6` (`bk`): opens the Page in a right panel tab, or updates its tab; returns whether the tab is open. */
export function openSpacePageTab(
  { intl, navigate }: SpacePageTabScope,
  pageId: string,
  { revealAndFocus = true, blockId, focusTitle = false, title }: OpenSpacePageTabOptions = {},
) {
  const { availability, pages } = useSpacesStore.getState();
  if (availability !== "enabled") return false;
  const accountId = WORKSPACE_ID;
  const tabId = spacePageTabId(accountId, pageId);
  const hasTab = () => useRightPanelStore.getState().tabs.some((tab) => tab.tabId === tabId);
  if (focusTitle && !hasTab()) pendingTitleFocus.add(tabId);
  openRightPanelTab(spacePageTab, { accountId, pageId, blockId, navigate }, { ...pageTabDisplay(title?.trim() || pageTabTitle(pages[pageId], intl), pageId), revealAndFocus });
  return hasTab();
}

/** `ths`: creates a Personal page and opens it in a tab with its title focused. */
export function createSpacePageTab(scope: SpacePageTabScope) {
  if (useSpacesStore.getState().availability !== "enabled") return false;
  const page = useSpacesStore.getState().createPage({});
  openSpacePageTab(scope, page.page_id, { focusTitle: true });
  return true;
}
