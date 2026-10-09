import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { ListBulletLight16Icon, SquareGrid2x2Light16Icon } from "../../codex/icons";
import { Button } from "../../codex/ui/button";
import { ContentGrid, ContentLoading, ContentSection } from "../../codex/ui/content-section";
import { EmptyState } from "../../codex/ui/empty-state";
import { LoadMoreSentinel } from "../../codex/ui/load-more-sentinel";
import { SegmentedControl } from "../../codex/ui/segmented-control";
import { SpaceEmptyState } from "../components/space-empty-state";
import { usePageListEntries, usePagesEnabled, useSpacesStore } from "../state";
import { PageContentItem, PageList, type PageViewMode } from "./page-content-item";

const pageSizeStep = 50;
const suggestedPageCount = 12;

/** `EComponent` (recent-pages chunk): list / grid toggle for Space collections. */
export function PageViewModeToggle({ viewMode, onViewModeChange }: { viewMode: PageViewMode; onViewModeChange: (viewMode: PageViewMode) => void }) {
  const intl = useIntl();
  const pagesEnabled = usePagesEnabled();
  const listLabel = intl.formatMessage({ id: "appgenPage.view.list", defaultMessage: "List view", description: "Accessible label for showing Pages in a list" });
  const gridLabel = intl.formatMessage({ id: "appgenPage.view.grid", defaultMessage: "Grid view", description: "Accessible label for showing Pages in a grid" });
  const ariaLabel = pagesEnabled
    ? intl.formatMessage({ id: "willow.pages.view.ariaLabel", defaultMessage: "Pages view", description: "Accessible label for the Pages list or grid selector" })
    : intl.formatMessage({ id: "appgenPage.view.ariaLabel", defaultMessage: "Library view", description: "Accessible label for the Library view selector" });
  return (
    <SegmentedControl
      ariaLabel={ariaLabel}
      className="justify-self-end"
      options={[
        { id: "list", ariaLabel: listLabel, label: <ListBulletLight16Icon />, tooltipContent: listLabel },
        { id: "grid", ariaLabel: gridLabel, label: <SquareGrid2x2Light16Icon />, tooltipContent: gridLabel },
      ]}
      selectedId={viewMode}
      size="toolbar"
      uniform
      onSelect={(id) => onViewModeChange(id as PageViewMode)}
    />
  );
}

export type RecentPagesView = "recent" | "pages" | "pinned";

export interface RecentPagesProps {
  /** Lowercased search query. */
  searchTerm: string;
  view: RecentPagesView;
  viewMode: PageViewMode;
}

/** `WeComponent` (recent-pages chunk), Legacy branch: the Suggested, All and Pinned tabs of the Pages home. */
export function RecentPages({ searchTerm, view, viewMode }: RecentPagesProps) {
  const intl = useIntl();
  const [pageSize, setPageSize] = useState(pageSizeStep);
  const entries = usePageListEntries();
  const pinnedKeys = useSpacesStore((state) => state.pinnedKeys);
  const isLoading = useSpacesStore((state) => state.pagesStatus === "loading");
  const isError = useSpacesStore((state) => state.pagesStatus === "error");
  const isComplete = useSpacesStore((state) => state.pagesStatus === "ready");

  const matches = entries?.filter(
    ({ page }) => (view !== "pinned" || pinnedKeys.includes(`page:${page.page_id}`)) && (page.title ?? "").toLocaleLowerCase().includes(searchTerm),
  );
  const showsSuggestions = view === "recent" && !searchTerm;
  const pages = matches?.slice(0, showsSuggestions ? suggestedPageCount : pageSize);
  const hasPages = !!pages?.length;

  const emptyTitle =
    view === "pinned" && searchTerm ? (
      <FormattedMessage
        id="space.list.noMatchingPinnedPages"
        defaultMessage="No matching pinned pages"
        description="Empty search result in the Pinned tab of Space, which searches only pages the user has pinned"
      />
    ) : view === "pinned" ? (
      <FormattedMessage
        id="space.list.noPinnedPages"
        defaultMessage="No pinned pages yet"
        description="Empty state in the Pinned tab of Space when the user has not pinned any pages"
      />
    ) : searchTerm ? (
      <FormattedMessage id="space.list.noMatchingPersonalPages" defaultMessage="No matching pages" description="No personal Pages match the search" />
    ) : (
      <FormattedMessage id="space.list.noPersonalPages" defaultMessage="No pages yet" description="Empty list of Pages outside any Space" />
    );
  const emptyState = view === "pages" && !searchTerm && isComplete && !isLoading && !isError ? <SpaceEmptyState view="pages" /> : undefined;

  const retry = () => void useSpacesStore.getState().retryLoad("pages");

  const items = pages?.map(({ page, parentPage }) => <PageContentItem key={page.page_id} page={page} parentPage={parentPage} viewMode={viewMode} />);

  return (
    <ContentSection>
      {isError ? (
        <div className="flex items-center gap-2 text-secondary">
          {hasPages ? (
            <FormattedMessage
              id="space.list.partialPagesError"
              defaultMessage="Could not load all pages"
              description="Warning above usable Pages on Space Home or Personal when a Page source failed and the visible list may be incomplete"
            />
          ) : (
            <FormattedMessage id="space.list.personalPagesError" defaultMessage="Could not load pages" description="Error loading Pages when none are available to show" />
          )}
          <Button color="ghost" onClick={retry}>
            <FormattedMessage id="space.list.retryPersonalPages" defaultMessage="Retry pages" description="Action to retry loading personal Pages" />
          </Button>
        </div>
      ) : null}
      {isLoading && !matches?.length ? <ContentLoading /> : null}
      {matches?.length === 0 && isComplete && !isLoading && !isError ? (emptyState ?? <EmptyState layout="browse" title={emptyTitle} />) : null}
      {hasPages && viewMode === "grid" ? <ContentGrid>{items}</ContentGrid> : null}
      {hasPages && viewMode === "list" ? (
        <PageList
          ariaLabel={intl.formatMessage({
            id: "space.list.pages",
            defaultMessage: "Pages",
            description: "Accessible label for the list of Pages on Space home and Personal",
          })}
        >
          {items}
        </PageList>
      ) : null}
      <LoadMoreSentinel
        key={pageSize}
        hasNextPage={!showsSuggestions && (matches?.length ?? 0) > pageSize}
        isFetchingNextPage={false}
        rootMargin="200px"
        onLoadNextPage={() => setPageSize((size) => size + pageSizeStep)}
      />
    </ContentSection>
  );
}
