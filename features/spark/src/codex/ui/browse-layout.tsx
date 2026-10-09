import clsx from "clsx";
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type UIEvent } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { ListBulletLight16Icon, ListBulletLight20Icon, SquareGrid2x2Light16Icon, SquareGrid2x2Light20Icon } from "../icons";
import { composeRefs } from "./compose-refs";
import { useWindowZoom } from "./overlay-context";
import { PageHeaderButton } from "./page-header-button";
import { SearchInput } from "./search-input";
import { SearchablePageHeader, SearchablePageToolbar } from "./searchable-page-header";
import { Tooltip } from "./tooltip";

const contentWidthClassName = "max-w-[1440px]";

function setHeaderBackgroundTopInset(container: HTMLElement, header: HTMLElement, zoom: number) {
  const inset = Math.max(0, container.getBoundingClientRect().top - header.getBoundingClientRect().top) / zoom;
  header.style.setProperty("--header-background-top-inset", `${inset}px`);
}

export interface BrowseLayoutProps {
  title: ReactNode;
  banner?: ReactNode;
  /** Header actions: the search toolbar of a browse page. */
  controls?: ReactNode;
  navigation?: ReactNode;
  /** Keeps `navigation` in its own row under the sticky header; otherwise it scrolls with the content. */
  stickyNavigation?: boolean;
  reserveSelectionGutter?: boolean;
  scrollContainerRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
}

/**
 * Library and Space browse page (`t` in `library-browse-layout`): `i9` with an extra-wide sticky compact header that
 * collapses on scroll, in the Slate layout Codex ships (`data-new-slate-layout`).
 */
export function BrowseLayout({
  title,
  banner,
  controls,
  navigation,
  stickyNavigation = true,
  reserveSelectionGutter = false,
  scrollContainerRef,
  children,
}: BrowseLayoutProps) {
  const zoom = useWindowZoom();
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const paddingClassName = clsx("ws-browse__gutter", reserveSelectionGutter ? "ws-browse__gutter--selection px-18 [[data-app-shell-compact-page-gutter=true]_&]:px-14" : "px-12");

  useLayoutEffect(() => {
    const container = containerRef.current;
    const header = headerRef.current;
    if (container == null || header == null) return;
    const observer = new ResizeObserver(() => setHeaderBackgroundTopInset(container, header, zoom));
    observer.observe(container);
    observer.observe(header);
    return () => {
      observer.disconnect();
      header.style.removeProperty("--header-background-top-inset");
    };
  }, [zoom]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const header = headerRef.current;
    if (header == null) {
      setScrolled(container.scrollTop > 0);
      return;
    }
    setScrolled(
      container.scrollTop > 0 && header.getBoundingClientRect().top <= container.getBoundingClientRect().top + parseFloat(getComputedStyle(header).top),
    );
    setHeaderBackgroundTopInset(container, header, zoom);
  };

  return (
    <div
      ref={composeRefs(containerRef, scrollContainerRef)}
      data-new-slate-layout
      className="ws-page ws-browse relative h-full min-h-0 flex-1 [scrollbar-gutter:stable] overflow-x-hidden overflow-y-auto"
      data-app-shell-inline-page-header
      onScroll={onScroll}
    >
      <div className="flex min-h-full w-full flex-col">
        {banner == null ? null : <div className="w-full empty:hidden">{banner}</div>}
        <SearchablePageHeader
          ref={headerRef}
          className={contentWidthClassName}
          horizontalPaddingClassName={paddingClassName}
          collapseOnScroll
          expandSearchWhenWrapped
          showDivider={scrolled}
          sticky
          title={
            <h1 className="ws-browse__title flex min-h-9 items-center text-default browser:max-md:min-h-0 browser:max-md:text-lg browser:max-md:font-medium heading-lg">
              {title}
            </h1>
          }
          actions={controls}
        />
        {stickyNavigation && navigation != null ? (
          <div className={clsx("mx-auto flex min-h-15 w-full min-w-0 items-center", contentWidthClassName, paddingClassName)}>{navigation}</div>
        ) : null}
        <div className={clsx("mx-auto flex min-h-0 w-full flex-1 flex-col pb-4", contentWidthClassName, paddingClassName)}>
          {!stickyNavigation && navigation != null ? <div className="flex min-h-15 items-center">{navigation}</div> : null}
          {children}
        </div>
      </div>
    </div>
  );
}

export type BrowseViewMode = "grid" | "list";

export interface BrowseToolbarProps {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSearchFocus?: () => void;
  viewMode: BrowseViewMode;
  onViewModeChange: (viewMode: BrowseViewMode) => void;
  showViewToggle?: boolean;
  showSearch?: boolean;
  searchLabel?: string;
  searchPlaceholder?: string;
  searchMaxLength?: number;
  fixedSearchWidth?: boolean;
  /** Rendered before the view toggle. */
  filters?: ReactNode;
  filterTags?: ReactNode;
  actions?: ReactNode;
  settings?: ReactNode;
}

/** Browse page search toolbar (`n` in `library-browse-layout`). */
export function BrowseToolbar({
  searchQuery,
  onSearchQueryChange,
  onSearchFocus,
  viewMode,
  onViewModeChange,
  showViewToggle = true,
  showSearch = true,
  searchLabel,
  searchPlaceholder,
  searchMaxLength,
  fixedSearchWidth,
  filters,
  filterTags,
  actions,
  settings,
}: BrowseToolbarProps) {
  const intl = useIntl();
  const id = useId();
  const defaultLabel = intl.formatMessage({
    id: "libraryNext.search.label",
    defaultMessage: "Search library",
    description: "Label and placeholder for the Library search input",
  });
  return (
    <SearchablePageToolbar
      fixedSearchWidth={fixedSearchWidth}
      filterTags={filterTags}
      controls={
        <>
          {filters}
          {showViewToggle ? <ViewModeToggle value={viewMode} onChange={onViewModeChange} /> : null}
        </>
      }
      search={
        showSearch ? (
          <SearchInput
            id={`library-search-${id}`}
            variant="toolbar-compact"
            label={searchLabel ?? defaultLabel}
            placeholder={searchPlaceholder ?? searchLabel ?? defaultLabel}
            searchQuery={searchQuery}
            maxLength={searchMaxLength}
            onFocus={onSearchFocus}
            onSearchQueryChange={onSearchQueryChange}
          />
        ) : undefined
      }
      actions={
        <>
          {actions}
          {settings}
        </>
      }
    />
  );
}

export interface ViewModeToggleProps {
  value: BrowseViewMode;
  onChange: (viewMode: BrowseViewMode) => void;
  disabled?: boolean;
}

/** Grid / list layout buttons (`i` in `library-browse-layout`). */
export function ViewModeToggle({ value, onChange, disabled = false }: ViewModeToggleProps) {
  const intl = useIntl();
  return (
    <div className="ws-view-toggle flex shrink-0 items-center gap-0.5">
      <Tooltip
        cloneCustomTrigger
        tooltipContent={
          <FormattedMessage
            id="libraryNext.view.gridTooltip"
            defaultMessage="Grid"
            description="Tooltip on the Library grid layout button. Grid is the name of the layout, not a verb."
          />
        }
      >
        <PageHeaderButton
          color="secondary"
          variant="ghost"
          uniform
          disabled={disabled}
          selected={value === "grid"}
          icon={{ 16: SquareGrid2x2Light16Icon, 20: SquareGrid2x2Light20Icon }}
          aria-pressed={value === "grid"}
          aria-label={intl.formatMessage({ id: "libraryNext.view.grid", defaultMessage: "Grid view", description: "Switch the Library from a list to a grid" })}
          onClick={() => {
            if (value !== "grid") onChange("grid");
          }}
        />
      </Tooltip>
      <Tooltip
        cloneCustomTrigger
        tooltipContent={
          <FormattedMessage
            id="libraryNext.view.listTooltip"
            defaultMessage="List"
            description="Tooltip on the Library list layout button. List is the name of the layout, not a verb."
          />
        }
      >
        <PageHeaderButton
          color="secondary"
          variant="ghost"
          uniform
          disabled={disabled}
          selected={value === "list"}
          icon={{ 16: ListBulletLight16Icon, 20: ListBulletLight20Icon }}
          aria-pressed={value === "list"}
          aria-label={intl.formatMessage({ id: "libraryNext.view.list", defaultMessage: "List view", description: "Switch the Library from a grid to a list" })}
          onClick={() => {
            if (value !== "list") onChange("list");
          }}
        />
      </Tooltip>
    </div>
  );
}
