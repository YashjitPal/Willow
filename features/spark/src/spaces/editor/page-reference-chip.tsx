import type { KeyboardEvent, MouseEvent } from "react";
import { useIntl } from "react-intl";
import { LockIcon } from "../../codex/icons";
import { InlineMention } from "../../codex/ui";
import { PageIcon, pageIconAndTitle } from "../components/space-icon";
import { usePage, type PageMetadata } from "../state";
import { pageLinkMessages, pageMessages } from "./messages";
import { parsePagePath } from "./page-links";

/** `N$t` (`kmr`): the linked Page's own icon. */
function LinkedPageIcon({ className, page, title }: { className?: string; page: PageMetadata; title: string }) {
  return (
    <PageIcon pageId={page.page_id} symbol={page.symbol} title={title} iconClassName={className}>
      {({ icon }) => icon}
    </PageIcon>
  );
}

interface PageReferenceChipProps {
  path: string;
  /** Authored label; empty shows the linked Page's title. */
  title: string;
  onOpen: (pageId: string, blockId: string | undefined) => void;
}

/**
 * The `spacePageLinks` widget (`gt` in the preview chunk) over a `pageReferenceMention`: the linked Page's icon and
 * title, opening the Page on click, Enter or Space. A Page the mock store can't show resolves as unavailable.
 */
export function PageReferenceChip({ path, title, onOpen }: PageReferenceChipProps) {
  const intl = useIntl();
  const target = parsePagePath(path);
  const pageId = target?.kind === "page" ? target.id : null;
  const page = usePage(pageId);
  const resolvedPage = page != null && page.access.can_read && page.deleted_at == null ? page : null;
  const label = title || (resolvedPage != null ? resolvedPage.title?.trim() || intl.formatMessage(pageMessages.untitled) : intl.formatMessage(pageLinkMessages.unavailable));
  const display = resolvedPage != null ? pageIconAndTitle(label, undefined, undefined, resolvedPage.symbol) : null;
  const icon = resolvedPage != null ? <LinkedPageIcon page={resolvedPage} title={label} /> : <LockIcon />;
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (resolvedPage != null && target?.kind === "page") onOpen(resolvedPage.page_id, target.blockId);
  };
  return (
    <span
      className={resolvedPage != null ? "cursor-pointer" : undefined}
      contentEditable={false}
      data-page-link-id={resolvedPage == null ? undefined : resolvedPage.page_id}
      data-inline-mention-interactive={resolvedPage == null ? undefined : ""}
      role={resolvedPage == null ? undefined : "button"}
      tabIndex={resolvedPage == null ? undefined : 0}
      onClick={resolvedPage == null ? undefined : open}
      onKeyDown={
        resolvedPage == null
          ? undefined
          : (event) => {
              if (event.key === "Enter" || event.key === " ") open(event);
            }
      }
    >
      <InlineMention
        aria-label={label}
        className={resolvedPage != null ? "cursor-pointer" : undefined}
        fontWeight="inherit"
        icon={icon}
        interactive={resolvedPage != null}
        role="group"
        underlineOnHover
      >
        {display?.title ?? label}
      </InlineMention>
    </span>
  );
}
