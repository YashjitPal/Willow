import { useId, useState, type FormEvent } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Button } from "../../codex/ui/button";
import { Dialog, DialogTitle } from "../../codex/ui/dialog";
import { DialogBody, DialogFooter, DialogHeader, DialogSection } from "../../codex/ui/dialog-layout";
import { Input } from "../../codex/ui/input";
import { mutationRoundTrip, useSpacesStore } from "../state";

export interface PageRenameDialogProps {
  pageId: string;
  title: string;
  kind?: "page" | "space";
  onRename?: (title: string, onPending: () => void) => Promise<void>;
  onSaved: () => void;
  onClose: () => void;
}

/** `PageRenameDialog` (page-rename-dialog chunk): renames a Page, or a Space through its root Page. */
export function PageRenameDialog({ pageId, title, kind = "page", onRename, onSaved, onClose }: PageRenameDialogProps) {
  const intl = useIntl();
  const interactionMode = useSpacesStore((state) => state.pages[pageId]?.interaction_mode ?? null);
  const [value, setValue] = useState(title);
  const [status, setStatus] = useState<"idle" | "saving" | "pending" | "failed">("idle");
  const statusId = useId();
  const saving = status === "saving";
  const pending = status === "pending";
  const failed = status === "failed";

  const save = async () => {
    if (saving || pending || useSpacesStore.getState().pages[pageId]?.interaction_mode === "request_changes") return;
    const trimmed = value.trim();
    setStatus("saving");
    setValue(trimmed);
    try {
      if (onRename == null) {
        await mutationRoundTrip();
        const page = useSpacesStore.getState().pages[pageId];
        if (page == null || !page.access.can_read || !page.access.can_write) throw new Error("page_rename_unavailable");
        useSpacesStore.getState().renamePage(pageId, trimmed);
      } else {
        await onRename(trimmed, () => setStatus("pending"));
      }
      onSaved();
    } catch {
      setStatus("failed");
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save();
  };

  return (
    <Dialog
      open
      size="compact"
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogBody as="form" onSubmit={onSubmit}>
        <DialogSection>
          <DialogHeader
            title={
              <DialogTitle className="contents">
                {kind === "space" ? (
                  <FormattedMessage
                    id="codex.space.rename.title"
                    defaultMessage="Rename space"
                    description="Title of the dialog for changing a Space name. Translate Space/Spaces as a common noun for an area or collection of Pages and files, not a proper name or outer space. Keep the term consistent with navigation."
                  />
                ) : (
                  <FormattedMessage id="codex.space.page.rename.title" defaultMessage="Rename page" description="Title of the dialog for changing a Page title" />
                )}
              </DialogTitle>
            }
          />
        </DialogSection>
        <DialogSection spacing="large">
          <Input
            autoFocus
            aria-label={
              kind === "space"
                ? intl.formatMessage({
                    id: "codex.space.rename.label",
                    defaultMessage: "Space name",
                    description:
                      "Accessible label for the Space rename input. Translate Space/Spaces as a common noun for an area or collection of Pages and files, not a proper name or outer space. Keep the term consistent with navigation.",
                  })
                : intl.formatMessage({ id: "codex.space.page.rename.label", defaultMessage: "Page title", description: "Accessible label for the Page rename input" })
            }
            value={value}
            disabled={saving || interactionMode === "request_changes"}
            readOnly={pending}
            aria-invalid={failed}
            aria-describedby={failed || pending ? statusId : undefined}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
          {failed ? (
            <p id={statusId} className="text-danger select-none" role="alert">
              {kind === "space" ? (
                <FormattedMessage
                  id="codex.space.rename.error"
                  defaultMessage="Could not rename space"
                  description="Error in the Space rename dialog when saving its name fails. Translate Space/Spaces as a common noun for an area or collection of Pages and files, not a proper name or outer space. Keep the term consistent with navigation."
                />
              ) : (
                <FormattedMessage
                  id="codex.space.page.rename.error"
                  defaultMessage="Could not rename page"
                  description="Error in the Page rename dialog when saving the title fails; the typed title remains available to retry"
                />
              )}
            </p>
          ) : null}
          {pending ? (
            <p id={statusId} className="text-sm text-secondary select-none" role="status">
              <FormattedMessage
                id="codex.space.page.rename.pending"
                defaultMessage="Saving is taking longer than expected. You can close this dialog."
                description="Status when a Page title has been submitted but saving is still awaiting confirmation; closing the dialog does not cancel the save"
              />
            </p>
          ) : null}
        </DialogSection>
        <DialogSection spacing="large">
          <DialogFooter>
            <Button color="secondary" type="button" disabled={saving} onClick={onClose}>
              {pending ? (
                <FormattedMessage
                  id="codex.space.page.rename.close"
                  defaultMessage="Close"
                  description="Dismiss the Page rename dialog while its submitted title continues saving"
                />
              ) : (
                <FormattedMessage id="codex.space.page.rename.cancel" defaultMessage="Cancel" description="Dismiss the Page rename dialog without saving" />
              )}
            </Button>
            <Button type="submit" loading={saving} disabled={pending || interactionMode === "request_changes"}>
              <FormattedMessage id="codex.space.page.rename.save" defaultMessage="Save" description="Save the new Page title" />
            </Button>
          </DialogFooter>
        </DialogSection>
      </DialogBody>
    </Dialog>
  );
}
