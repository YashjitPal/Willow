import clsx from "clsx";
import { useRef, useState, type ReactNode, type UIEvent } from "react";
import { SearchInput, type SearchInputProps } from "./search-input";
import { SearchablePageHeader, SearchablePageToolbar } from "./searchable-page-header";

const contentWidthClasses = {
  extraWide: "max-w-[1440px]",
  wide: "max-w-5xl",
  medium: "max-w-[960px]",
  default: "max-w-[var(--thread-content-max-width)]",
} as const;

const headerVariantClasses = {
  default: { inset: "pt-panel", title: "heading-xl" },
  inset: { inset: "pt-panel", title: "heading-xl" },
  hero: { inset: "pt-4", title: "text-3xl font-bold md:text-5xl" },
  catalog: { inset: "pt-4", title: "heading-xl font-semibold" },
  compact: { inset: "pt-6", title: "heading-lg" },
} as const;

export interface StickyTitledPageProps {
  title: ReactNode;
  subtitle?: ReactNode;
  headerAction?: ReactNode;
  search?: SearchInputProps;
  searchContent?: ReactNode;
  searchToolbar?: ReactNode;
  stickyControls?: ReactNode;
  controls?: ReactNode;
  children?: ReactNode;
  collapseHeaderOnScroll?: boolean;
  expandSearchWhenWrapped?: boolean;
  wrapActionsAtNarrowWidth?: boolean;
  contentClassName?: string;
  contentInset?: boolean;
  contentWidth?: keyof typeof contentWidthClasses;
  headerVariant?: keyof typeof headerVariantClasses;
  horizontalPaddingClassName?: string;
}

/**
 * `i9` (`KMa` in app-initial) with `headerPlacement="sticky"` and `animateContentLayout={false}`: the title, search and
 * actions stick to the top of the scroll container and collapse to the toolbar row on scroll.
 */
export function StickyTitledPage({
  title,
  subtitle,
  headerAction,
  search,
  searchContent,
  searchToolbar,
  stickyControls,
  controls,
  children,
  collapseHeaderOnScroll = false,
  expandSearchWhenWrapped = false,
  wrapActionsAtNarrowWidth,
  contentClassName,
  contentInset = true,
  contentWidth = "default",
  headerVariant = "default",
  horizontalPaddingClassName,
}: StickyTitledPageProps) {
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isCompact = headerVariant === "compact";
  const hasSearch = search != null || searchContent != null;
  const widthClassName = contentWidthClasses[contentWidth];
  const paddingClassName =
    horizontalPaddingClassName ?? clsx("px-panel", (contentWidth === "medium" || contentWidth === "extraWide") && isCompact ? "px-6 lg:px-12" : undefined);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const header = headerRef.current;
    const content = contentRef.current;
    if (collapseHeaderOnScroll && header != null && content != null) {
      header.style.setProperty("--header-scroll-position", `${event.currentTarget.scrollTop}px`);
      const rect = header.getBoundingClientRect();
      const overlap = ((rect.bottom - content.getBoundingClientRect().top) * header.offsetHeight) / rect.height + parseFloat(getComputedStyle(header).marginBottom);
      header.style.setProperty("--header-scroll-overlap", `${Math.max(0, overlap)}px`);
    }
    setScrolled(event.currentTarget.scrollTop > 0);
  };
  const searchNode =
    searchContent ?? (search == null ? null : <SearchInput {...search} autoFocus={search.autoFocus ?? false} className={clsx("min-w-0 flex-1", search.className)} />);
  return (
    <div
      className="ws-page gemini-chat-scrollbar relative h-full min-h-0 flex-1 [scrollbar-gutter:stable] overflow-x-hidden overflow-y-auto"
      data-app-shell-inline-page-header
      onScroll={onScroll}
    >
      <div className="flex min-h-full w-full flex-col">
        <SearchablePageHeader
          ref={headerRef}
          className={widthClassName}
          horizontalPaddingClassName={paddingClassName}
          collapseOnScroll={collapseHeaderOnScroll}
          expandSearchWhenWrapped={expandSearchWhenWrapped}
          wrapActionsAtNarrowWidth={wrapActionsAtNarrowWidth}
          showDivider={scrolled}
          sticky
          title={
            <>
              <h1 className={clsx("ws-page__title flex min-h-9 items-center text-default", headerVariantClasses[headerVariant].title)}>{title}</h1>
              {subtitle == null ? null : <div className={clsx("ws-page__subtitle text-base leading-6 text-secondary", collapseHeaderOnScroll && "max-w-lg")}>{subtitle}</div>}
            </>
          }
          actions={hasSearch ? <SearchablePageToolbar search={searchNode} controls={searchToolbar} actions={headerAction} /> : headerAction}
          navigation={stickyControls}
        />
        <div
          ref={contentRef}
          className={clsx(
            "mx-auto flex min-h-0 w-full flex-1 flex-col",
            "pb-panel",
            widthClassName,
            contentInset && !isCompact && (!hasSearch && stickyControls == null ? "pt-panel" : "pt-5"),
            contentClassName,
            paddingClassName,
          )}
        >
          {controls}
          {children}
        </div>
      </div>
    </div>
  );
}
