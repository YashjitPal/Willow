import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useLocation, useNavigate } from "react-router-dom";
import { PinFillLight16Icon, PinLight16Icon } from "../../codex/icons";
import { Button } from "../../codex/ui/button";
import { CompactRelativeTime } from "../../codex/ui/compact-relative-time";
import { ContextMenu } from "../../codex/ui/context-menu";
import { ListRow, type ListRowSelectEvent } from "../../codex/ui/list-row";
import { PageIcon } from "../components/space-icon";
import { PageArchiveDialog } from "../dialogs/page-archive-dialog";
import { PageDotsDialog } from "../dialogs/page-dots-dialog";
import { PageRenameDialog } from "../dialogs/page-rename-dialog";
import { PageActionsMenu } from "../menus/page-actions-menu";
import { canDeletePage, pageActionMessages, pageMenuItems } from "../menus/page-actions";
import { openPage, pageMentionPrompt, startChatWithPrompt } from "../navigation";
import { pagePinKey, useDotsOnPage, useIsPinned, useSpacesStore, type PageMetadata } from "../state";
import { DotFacepile } from "../willow/dot/dot-facepile";

export type PageViewMode = "list" | "grid";

/** `HeComponent`: the Name / Bots / Updated / actions columns of a Page list row. */
function PageListColumns({ name, dots, updated, action }: { name: ReactNode; dots: ReactNode; updated: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <div className="min-w-0 flex-1">{name}</div>
      <div className="pointer-events-auto hidden w-1/4 min-w-0 text-secondary @md:block">{dots}</div>
      <div className="hidden w-20 shrink-0 text-secondary @lg:block">{updated}</div>
      <div className="pointer-events-auto flex w-6 shrink-0 justify-end">{action}</div>
    </div>
  );
}

/** `BeComponent`: the Page list with its column header. */
export function PageList({ ariaLabel, children }: { ariaLabel: string; children?: ReactNode }) {
  return (
    <div className="@container sidebar-navigation">
      <div aria-hidden="true" className="ws-table-head px-[var(--padding-row-cell-x,var(--padding-row-x))] py-row-y text-xs text-tertiary">
        <PageListColumns
          name={<FormattedMessage id="space.list.columnName" defaultMessage="Name" description="Page name column" />}
          dots={<FormattedMessage id="willow.pages.list.columnDots" defaultMessage="Bots" description="Column showing the bots that work on each Page" />}
          updated={<FormattedMessage id="space.list.columnUpdated" defaultMessage="Updated" description="Page update time column" />}
        />
      </div>
      <ul aria-label={ariaLabel}>{children}</ul>
    </div>
  );
}

type RowDialog = { kind: "archive" | "dots" | "rename"; page: PageMetadata } | null;

/** `QeComponent` + `EComponent`: right-click menu, "…" button and the dialogs its actions open, for a Page row or card. */
export function PageRowMenu({ page, children }: { page: PageMetadata; children: (menu: ReactNode) => ReactNode }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<RowDialog>(null);
  const requestChanges = page.interaction_mode === "request_changes";

  const getItems = () => {
    const current = useSpacesStore.getState().pages[page.page_id];
    if (current == null) return [];
    const pinKey = pagePinKey(current.page_id);
    const isPinned = useSpacesStore.getState().pinnedKeys.includes(pinKey);
    return pageMenuItems({
      page: current,
      isPinned,
      onTogglePinned: () => useSpacesStore.getState().setPinned(pinKey, !useSpacesStore.getState().pinnedKeys.includes(pinKey)),
      onNewChat: () => startChatWithPrompt(navigate, pageMentionPrompt(current.page_id, current.title)),
      onRename: () => setDialog({ kind: "rename", page: current }),
      onArchive: canDeletePage(current) && current.interaction_mode !== "request_changes" ? () => setDialog({ kind: "archive", page: current }) : undefined,
      onShare: current.interaction_mode !== "request_changes" ? () => setDialog({ kind: "dots", page: current }) : undefined,
    });
  };

  const menu = (
    <PageActionsMenu
      libraryPresentation
      documentType={page.document_type}
      getItems={getItems}
      kind="page"
      loadingMessage={pageActionMessages.loadingPage}
      onOpenChange={setMenuOpen}
      open={menuOpen}
      title={page.title ?? ""}
    />
  );

  return (
    <>
      <ContextMenu getItems={getItems} loadingMessage={pageActionMessages.loadingPage} onOpenChange={setMenuOpen}>
        <div className="contents">{children(menu)}</div>
      </ContextMenu>
      {dialog?.kind === "archive" && !requestChanges ? (
        <PageArchiveDialog pageId={dialog.page.page_id} pageTitle={dialog.page.title} documentType={dialog.page.document_type} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "dots" ? <PageDotsDialog pageId={dialog.page.page_id} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "rename" ? (
        <PageRenameDialog pageId={dialog.page.page_id} title={dialog.page.title ?? ""} onSaved={() => setDialog(null)} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}

/** The pin toggle of a Page row or card. */
export function PagePinButton({ page }: { page: PageMetadata }) {
  const intl = useIntl();
  const pinKey = pagePinKey(page.page_id);
  const isPinned = useIsPinned(pinKey);
  const label = !page.title?.trim()
    ? isPinned
      ? intl.formatMessage({ id: "space.list.unpinUntitledPage", defaultMessage: "Unpin untitled page", description: "Accessible action to unpin a Page with no title" })
      : intl.formatMessage({ id: "space.list.pinUntitledPage", defaultMessage: "Pin untitled page", description: "Accessible action to pin a Page with no title" })
    : intl.formatMessage(
        isPinned
          ? { id: "codex.space.sidebar.unpinItem", defaultMessage: "Unpin {title}", description: "Action for unpinning a Page named {title}" }
          : { id: "codex.space.sidebar.pinItem", defaultMessage: "Pin {title}", description: "Action for pinning a Page named {title}" },
        { title: page.title ?? "" },
      );
  return (
    <Button
      color="ghost"
      size="actionSm"
      uniform
      aria-label={label}
      aria-pressed={isPinned}
      onClick={(event) => {
        event.stopPropagation();
        useSpacesStore.getState().setPinned(pinKey, !isPinned);
      }}
    >
      {isPinned ? <PinFillLight16Icon /> : <PinLight16Icon />}
    </Button>
  );
}

export interface PageContentItemProps {
  page: PageMetadata;
  parentPage?: PageMetadata;
  viewMode: PageViewMode;
}

/** `ItComponent` / `AtComponent` (page-content-item chunk): a Page as a list row or grid card. */
export function PageContentItem({ page, parentPage, viewMode }: PageContentItemProps) {
  return <PageRowMenu page={page}>{(menu) => <PageContentItemBody page={page} parentPage={parentPage} viewMode={viewMode} menu={menu} />}</PageRowMenu>;
}

function PageContentItemBody({ page, parentPage, viewMode, menu }: PageContentItemProps & { menu: ReactNode }) {
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const isPinned = useIsPinned(pagePinKey(page.page_id));
  const dots = useDotsOnPage(page.page_id).map((entry) => entry.dot);
  const untitled = intl.formatMessage({ id: "codex.space.page.untitledRow", defaultMessage: "Untitled page", description: "Fallback title for a Page without a title" });
  const open = (_event?: ListRowSelectEvent) => openPage(navigate, location, page.page_id);
  const parentTitle = parentPage == null ? null : parentPage.title?.trim() || untitled;

  const actions = (
    <span className="inline-flex items-center gap-1">
      <PagePinButton page={page} />
      {menu}
    </span>
  );

  if (viewMode === "grid") {
    return (
      <PageIcon iconColor="file-type" pageId={page.page_id} symbol={page.symbol} title={page.title ?? ""}>
        {({ icon, title }) => (
          <ListRow
            surface="raised"
            ariaLabel={page.title || untitled}
            title={page.title ? title : untitled}
            icon={icon}
            isSelected={false}
            hasInteractiveContent
            onSelect={open}
            rightText={<span className="pointer-events-auto">{actions}</span>}
            secondLine={
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  {dots.length > 0 ? <DotFacepile dots={dots} max={3} size={20} /> : null}
                  <span className="truncate">
                    {parentTitle == null ? (
                      <FormattedMessage id="willow.pages.list.topLevel" defaultMessage="Page" description="Location of a top-level Page" />
                    ) : (
                      <FormattedMessage id="willow.pages.list.inParent" defaultMessage="In {page}" description="Location of a subpage: the Page it sits in" values={{ page: parentTitle }} />
                    )}
                  </span>
                </span>
                <CompactRelativeTime dateString={page.updated_at} />
              </span>
            }
          />
        )}
      </PageIcon>
    );
  }

  return (
    <PageIcon iconColor="file-type" pageId={page.page_id} symbol={page.symbol} title={page.title ?? ""}>
      {({ icon, title }) => (
        <li>
          <ListRow density="row" ariaLabel={page.title || untitled} title={page.title ? title : untitled} isSelected={false} hasInteractiveContent onSelect={open}>
            <div className="w-full text-base">
              <PageListColumns
                name={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex shrink-0 items-center">{icon}</span>
                    <span className="truncate">{page.title ? title : untitled}</span>
                    {parentTitle == null ? null : (
                      <span className="ws-page-row__parent truncate">
                        <FormattedMessage id="willow.pages.list.inParent" defaultMessage="In {page}" description="Location of a subpage: the Page it sits in" values={{ page: parentTitle }} />
                      </span>
                    )}
                  </span>
                }
                dots={dots.length > 0 ? <DotFacepile dots={dots} max={4} size={22} /> : <span aria-hidden>—</span>}
                updated={<CompactRelativeTime dateString={page.updated_at} />}
                action={<span className={clsx(!isPinned && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100")}>{actions}</span>}
              />
            </div>
          </ListRow>
        </li>
      )}
    </PageIcon>
  );
}
