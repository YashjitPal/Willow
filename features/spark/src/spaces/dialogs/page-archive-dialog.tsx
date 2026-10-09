import { useRef, type FormEvent } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../codex/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "../../codex/ui/dialog";
import { DialogBody, DialogFooter, DialogHeader, DialogSection } from "../../codex/ui/dialog-layout";
import { mutationRoundTrip, useSpacesStore, type PageMetadata } from "../state";

export interface PageArchiveDialogProps {
  pageId: string;
  pageTitle: string | null;
  documentType?: string;
  onClose: () => void;
}

function ancestorPageIds(pages: Record<string, PageMetadata>, pageId: string) {
  const ancestors: string[] = [];
  let parent = pages[pageId]?.parent;
  while (parent != null && "page_id" in parent) {
    ancestors.unshift(parent.page_id);
    parent = pages[parent.page_id]?.parent;
  }
  return ancestors;
}

/** `uRo`: where to go after the open Page is deleted (its parent, its Space root, or Space home). */
function pathAfterDelete(pageId: string) {
  const { pages, spaces } = useSpacesStore.getState();
  const page = pages[pageId];
  const space = page?.drive_space_id == null ? undefined : spaces.find((entry) => entry.id === page.drive_space_id);
  const target = ancestorPageIds(pages, pageId).at(-1) ?? space?.root_page_id;
  return target != null && target !== pageId ? `/space/${target}` : "/space";
}

/** `wz` (`CRo1Component`): confirms moving a Page and its subpages to Trash. */
export function PageArchiveDialog({ pageId, pageTitle, documentType = "page", onClose }: PageArchiveDialogProps) {
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const days = useSpacesStore((state) => state.archiveRetentionDays);
  const submittedRef = useRef(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittedRef.current) return;
    if (useSpacesStore.getState().pages[pageId]?.interaction_mode === "request_changes") {
      onClose();
      return;
    }
    submittedRef.current = true;
    const target = pathAfterDelete(pageId);
    const openPageId = matchPath("/space/:pageId", location.pathname)?.params.pageId;
    const showingDeletedTree = openPageId === pageId || (openPageId != null && ancestorPageIds(useSpacesStore.getState().pages, openPageId).includes(pageId));
    const progress = toast.info(
      intl.formatMessage({
        id: "codex.space.page.archivePending",
        defaultMessage: "Deleting page and nested pages…",
        description: "Progress notification while waiting for a Page tree deletion to finish",
      }),
      { duration: Infinity },
    );
    void mutationRoundTrip()
      .then(() => {
        useSpacesStore.getState().archivePage(pageId);
        if (showingDeletedTree) void navigate(target, { replace: true, state: { ...(location.state as object | null), scrollPageToTop: false } });
      })
      .finally(() => toast.dismiss(progress));
    onClose();
  };

  return (
    <Dialog
      open
      dialogCloseClassName="rtl:start-auto rtl:end-4"
      size="compact"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBody as="form" onSubmit={onSubmit}>
        <DialogSection>
          <DialogHeader
            titleClassName="line-clamp-3 break-words pe-8"
            title={
              <DialogTitle className="contents">
                {pageTitle?.trim() ? (
                  <FormattedMessage
                    id="codex.space.page.archive.title"
                    defaultMessage="Delete “{title}”?"
                    description="Title of the confirmation dialog for deleting a shared Page"
                    values={{ title: pageTitle }}
                  />
                ) : (
                  <FormattedMessage
                    id="codex.space.page.archive.title.untitled"
                    defaultMessage="Delete {documentType, select, granola_document {Untitled doc} granola_whiteboard {Untitled canvas} granola_workbook {Untitled sheet} granola_presentation {Untitled slide} other {Untitled page}}?"
                    description="Title of the confirmation dialog for deleting an untitled document. documentType selects the untitled name for a Doc, canvas, sheet, presentation, or ordinary Page."
                    values={{ documentType }}
                  />
                )}
              </DialogTitle>
            }
            subtitle={
              <DialogDescription className="contents">
                {days != null ? (
                  <FormattedMessage
                    id="codex.space.page.archive.descriptionWithRetention"
                    defaultMessage="This page and its subpages will move to Trash. You can restore them within {days, plural, one {# day} other {# days}}."
                    description="Explanation before deleting a shared Page when automatic deletion is enabled. Days is the number of days the newly deleted Page and its nested pages are retained before permanent deletion."
                    values={{ days }}
                  />
                ) : (
                  <FormattedMessage
                    id="codex.space.page.archive.description"
                    defaultMessage="This page and its subpages will move to Trash. You can restore them from Trash."
                    description="Explanation shown before deleting a shared Page"
                  />
                )}
              </DialogDescription>
            }
          />
        </DialogSection>
        <DialogSection>
          <DialogFooter>
            <Button color="secondary" type="button" onClick={onClose}>
              <FormattedMessage id="codex.space.page.archive.cancel" defaultMessage="Cancel" description="Button label to cancel deleting a shared Page" />
            </Button>
            <Button color="danger" type="submit">
              <FormattedMessage id="codex.space.page.archive.confirm" defaultMessage="Delete" description="Button label to confirm deleting a shared Page" />
            </Button>
          </DialogFooter>
        </DialogSection>
      </DialogBody>
    </Dialog>
  );
}
