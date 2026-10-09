import clsx from "clsx";
import { motion } from "framer-motion";
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import { composeRefs } from "./compose-refs";

const css = {
  shell: "_shell_bomwa_2",
  content: "_content_bomwa_2",
  headerRow: "_headerRow_bomwa_2",
  title: "_title_bomwa_2",
  titleContent: "_titleContent_bomwa_2",
  actions: "_actions_bomwa_2",
  search: "_search_bomwa_2",
  navigation: "_navigation_bomwa_2",
  toolbar: "_toolbar_bomwa_2",
  filterTags: "_filterTags_bomwa_2",
  filterTagsContent: "_filterTagsContent_bomwa_2",
  viewControls: "_viewControls_bomwa_2",
  pageActions: "_pageActions_bomwa_2",
} as const;

/** Filter tags, view controls, search and page actions laid out for a searchable header (`c9` / `HMa` in app-initial). */
export function SearchablePageToolbar({
  filterTags,
  controls,
  search,
  actions,
  fixedSearchWidth,
}: {
  filterTags?: ReactNode;
  controls?: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
  fixedSearchWidth?: boolean;
}) {
  return (
    <div className={css.toolbar}>
      <div className={css.filterTags}>
        <div className={css.filterTagsContent}>{filterTags}</div>
      </div>
      <div className={css.viewControls}>{controls}</div>
      {search != null && (
        <div className={css.search} data-fixed-width={fixedSearchWidth || undefined}>
          {search}
        </div>
      )}
      <div className={css.pageActions}>{actions}</div>
    </div>
  );
}

export interface SearchablePageHeaderProps {
  ref?: Ref<HTMLDivElement>;
  className?: string;
  horizontalPaddingClassName?: string;
  collapseOnScroll?: boolean;
  expandSearchWhenWrapped?: boolean;
  showDivider?: boolean;
  sticky?: boolean;
  wrapActionsAtNarrowWidth?: boolean;
  title?: ReactNode;
  actions?: ReactNode;
  navigation?: ReactNode;
}

/**
 * Sticky page header with title, actions and navigation rows (`s9` / `BMa` in app-initial). Measures the title so the
 * header can collapse to its toolbar row while the page scrolls.
 */
export function SearchablePageHeader({
  ref,
  className,
  horizontalPaddingClassName = "px-panel",
  collapseOnScroll = false,
  expandSearchWhenWrapped = false,
  showDivider,
  sticky = true,
  wrapActionsAtNarrowWidth,
  title,
  actions,
  navigation,
}: SearchablePageHeaderProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const content = contentRef.current;
    if (!shell || !content) return;
    const resizeObserver = new ResizeObserver(() => {
      shell.style.setProperty("--header-content-start", `${content.offsetLeft + parseFloat(getComputedStyle(content).paddingInlineStart)}px`);
      const toolbar = content.querySelector(`.${css.toolbar}`);
      if (!collapseOnScroll || toolbar == null) {
        shell.removeAttribute("data-collapsible");
        return;
      }
      const titleContent = content.querySelector(`.${css.titleContent}`);
      if (titleContent == null) return;
      shell.style.setProperty("--header-collapse-offset", `${(titleContent.parentElement?.offsetHeight ?? 0) + parseFloat(getComputedStyle(shell).paddingTop)}px`);
      shell.toggleAttribute("data-collapsible", true);
    });
    const observeTargets = () => {
      resizeObserver.disconnect();
      for (const target of [content, ...content.querySelectorAll(`.${css.title}`)]) resizeObserver.observe(target);
    };
    const mutationObserver = new MutationObserver(observeTargets);
    mutationObserver.observe(content, { childList: true, characterData: true, subtree: true });
    observeTargets();
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [collapseOnScroll]);
  return (
    <motion.div
      ref={composeRefs(shellRef, ref)}
      data-scroll-collapse={collapseOnScroll || undefined}
      data-expand-search={expandSearchWhenWrapped || undefined}
      data-scrolled={showDivider || undefined}
      data-sticky={sticky || undefined}
      data-wrap-actions={wrapActionsAtNarrowWidth || undefined}
      className={clsx(css.shell, showDivider ? "border-subtle" : "border-transparent")}
      style={{ "--app-shell-titlebar-left-inset": "0px" } as CSSProperties}
    >
      <div ref={contentRef} className={clsx(css.content, "mx-auto w-full", horizontalPaddingClassName, className)}>
        <div className={css.headerRow}>
          {title == null ? null : (
            <div className={css.title}>
              <div className={css.titleContent}>{title}</div>
            </div>
          )}
          <div className={css.actions}>{actions}</div>
        </div>
        <div className={css.navigation}>{navigation}</div>
      </div>
    </motion.div>
  );
}
