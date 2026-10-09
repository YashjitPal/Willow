import { useId, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronDownMdLight16Icon, MagnifyingGlassLgLight16Icon, PlusLgLight16Icon } from "../../codex/icons";
import { Button } from "../../codex/ui/button";
import { PageControlsRow, PageStickyHeader } from "../../codex/ui/page-sticky-header";
import { ScrollTitledPage } from "../../codex/ui/scroll-titled-page";
import { SearchInput } from "../../codex/ui/search-input";
import { Spinner } from "../../codex/ui/spinner";
import { Tabs, type TabItem } from "../../codex/ui/tabs";
import { createAndOpenPage } from "../navigation";
import { usePagesEnabled, useSpacesStore, useTopLevelPages, WORKSPACE_ID } from "../state";
import { PageActivityFeed } from "./page-activity-feed";
import { PageCard, WelcomeCard } from "./page-cards";
import type { PageViewMode } from "./page-content-item";
import { PageViewModeToggle, RecentPages, type RecentPagesView } from "./recent-pages";

/** `location.state.pagesHomeBrowse`: the tab and search survive back/forward navigation. */
interface PagesHomeBrowse {
  accountId: string;
  view: RecentPagesView;
  searchQuery: string;
  showSearch: boolean;
}

const collapsedCardCount = 7;

const listTabs: TabItem<RecentPagesView>[] = [
  { key: "recent", name: <FormattedMessage id="space.list.suggestedTab" defaultMessage="Suggested" description="Filter showing recent Pages" /> },
  { key: "pages", name: <FormattedMessage id="space.list.allTab" defaultMessage="All" description="Filter showing every Page" /> },
  { key: "pinned", name: <FormattedMessage id="space.list.pinnedTab" defaultMessage="Pinned" description="Filter showing pinned Pages" /> },
];

/** The Pages home (Codex's Space home, `LegacySpacesPage`): your top-level Pages as cards, your bots' activity, and every Page. */
export function PagesHome() {
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const searchId = useId();
  const pagesEnabled = usePagesEnabled();
  const pagesStatus = useSpacesStore((state) => state.pagesStatus);
  const pinnedKeys = useSpacesStore((state) => state.pinnedKeys);
  const topLevelPages = useTopLevelPages(pinnedKeys);

  const storedBrowse = (location.state as { pagesHomeBrowse?: PagesHomeBrowse } | null)?.pagesHomeBrowse;
  const browse: PagesHomeBrowse = storedBrowse?.accountId === WORKSPACE_ID ? storedBrowse : { accountId: WORKSPACE_ID, view: "recent", searchQuery: "", showSearch: false };
  const { showSearch, view } = browse;
  const [searchQuery, setSearchQuery] = useState(browse.searchQuery);
  const [viewMode, setViewMode] = useState<PageViewMode>("list");
  const [showAllCards, setShowAllCards] = useState(false);

  const updateBrowse = (patch: Partial<PagesHomeBrowse> = {}) => {
    const next = { ...browse, searchQuery, ...patch };
    if (next.searchQuery === browse.searchQuery && next.showSearch === browse.showSearch && next.view === browse.view) return;
    void navigate(location, { replace: true, preventScrollReset: true, state: { ...(location.state as object | null), pagesHomeBrowse: next } });
  };

  const searchTerm = searchQuery.trim().toLocaleLowerCase();
  const matchingCards = topLevelPages.filter((page) => (page.title ?? "").toLocaleLowerCase().includes(searchTerm));
  const shownCards = showAllCards || searchTerm ? matchingCards : matchingCards.slice(0, collapsedCardCount);
  const searchLabel = intl.formatMessage({ id: "willow.pages.search", defaultMessage: "Search pages", description: "Label and placeholder for searching Pages by title" });

  return (
    <ScrollTitledPage
      contentWidth="wide"
      contentClassName="@container"
      headerVariant="compact"
      title={
        <span className="_mobileTitle_lklth_2">
          <FormattedMessage id="willow.pages.title" defaultMessage="Pages" description="Title of the Pages home" />
        </span>
      }
      subtitle={<FormattedMessage id="willow.pages.subtitle" defaultMessage="Write, plan and think things through with Willow and your bots" description="Subtitle under the Pages title" />}
      headerAction={
        <Button color="primary" size="toolbar" onClick={() => createAndOpenPage(navigate, location)}>
          <PlusLgLight16Icon />
          <FormattedMessage id="willow.pages.new" defaultMessage="New page" description="Creates a Page and opens it" />
        </Button>
      }
    >
      <section className="flex flex-col gap-2 select-none">
        {pagesStatus === "loading" ? (
          <div className="flex items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-3 @md:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4">
            {searchTerm ? null : <WelcomeCard />}
            {shownCards.map((page) => (
              <PageCard key={page.page_id} page={page} />
            ))}
          </div>
        )}
        {searchTerm && matchingCards.length === 0 ? (
          <p className="text-secondary">
            <FormattedMessage id="willow.pages.noMatchingCards" defaultMessage="No matching pages" description="No top-level Page matches the search" />
          </p>
        ) : null}
        {!searchTerm && matchingCards.length > collapsedCardCount ? (
          <div>
            <Button color="ghost" size="toolbar" onClick={() => setShowAllCards(!showAllCards)}>
              {showAllCards ? (
                <FormattedMessage id="willow.pages.showFewer" defaultMessage="Show fewer pages" description="Collapse the Page cards" />
              ) : (
                <FormattedMessage id="willow.pages.showAll" defaultMessage="Show all {count} pages" description="Expand the Page cards" values={{ count: matchingCards.length }} />
              )}
              <ChevronDownMdLight16Icon className={showAllCards ? "rotate-180" : undefined} />
            </Button>
          </div>
        ) : null}
      </section>
      {pagesEnabled ? (
        <div className="mt-8">
          <PageActivityFeed searchQuery={searchQuery} />
        </div>
      ) : null}
      <section className="mt-8 flex flex-col gap-2 select-none">
        <PageStickyHeader className="top-0 pt-4" fadeSize="compact">
          <PageControlsRow inset={false}>
            <Tabs variant="browse" scrollable selectedKey={view} onSelect={(nextView) => updateBrowse({ view: nextView })} tabs={listTabs} />
            <div className="flex shrink-0 items-center gap-2">
              <PageViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
              <Button
                color="ghost"
                size="toolbar"
                uniform
                aria-label={searchLabel}
                aria-expanded={showSearch}
                onClick={() => {
                  setSearchQuery("");
                  updateBrowse({ showSearch: !showSearch, searchQuery: "" });
                }}
              >
                <MagnifyingGlassLgLight16Icon />
              </Button>
            </div>
          </PageControlsRow>
          {showSearch ? (
            <div
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) updateBrowse();
              }}
            >
              <SearchInput
                id={searchId}
                label={searchLabel}
                placeholder={searchLabel}
                searchQuery={searchQuery}
                onSearchQueryChange={(query) => {
                  setSearchQuery(query);
                  if (query === "") updateBrowse({ searchQuery: query });
                }}
                variant="toolbar"
                autoFocus
              />
            </div>
          ) : null}
        </PageStickyHeader>
        <RecentPages key={view} searchTerm={searchTerm} view={view} viewMode={viewMode} />
      </section>
    </ScrollTitledPage>
  );
}
