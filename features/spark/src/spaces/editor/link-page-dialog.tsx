import { useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Button, Dialog, DialogBody, DialogHeader, DialogSection, DialogTitle, SearchInput, Spinner } from "../../codex/ui";
import { PageIcon } from "../components/space-icon";
import { useSpacesStore, type PageMetadata } from "../state";
import { pageLinkMessages, pageMessages } from "./messages";
import { pageSpace, usePageLinkSearch } from "./page-links";

interface LinkPageDialogProps {
  open: boolean;
  sourcePageId: string;
  onCancel?: () => void;
  onCreateSubpage?: () => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (page: PageMetadata) => void;
}

/**
 * `UY`: the slash menu's "Link to page" picker. Choosing a result or "Create subpage" closes the dialog first and runs
 * once focus would return, so the editor takes focus back; dismissing it runs `onCancel` the same way.
 */
export function LinkPageDialog({ open, sourcePageId, onCancel, onCreateSubpage, onOpenChange, onSelect }: LinkPageDialogProps) {
  const intl = useIntl();
  const spaces = useSpacesStore((state) => state.spaces);
  const pages = useSpacesStore((state) => state.pages);
  const [query, setQuery] = useState("");
  const deferred = useRef<(() => void) | undefined>(undefined);
  const { isFetching, items } = usePageLinkSearch({ enabled: open, query, sourcePageId });
  return (
    <Dialog
      contentProps={{
        onCloseAutoFocus: (event) => {
          const action = deferred.current;
          deferred.current = undefined;
          if (action != null) {
            event.preventDefault();
            action();
          }
        },
      }}
      onOpenChange={(next) => {
        if (!next) deferred.current = onCancel;
        onOpenChange(next);
      }}
      open={open}
      size="compact"
    >
      <DialogBody>
        <DialogSection>
          <DialogHeader
            title={
              <DialogTitle>
                <FormattedMessage {...pageLinkMessages.dialogTitle} />
              </DialogTitle>
            }
          />
        </DialogSection>
        <DialogSection>
          <SearchInput
            autoFocus
            id="space-page-link-search"
            label={intl.formatMessage(pageLinkMessages.searchLabel)}
            onSearchQueryChange={setQuery}
            placeholder={intl.formatMessage(pageLinkMessages.searchPlaceholder)}
            searchQuery={query}
          />
        </DialogSection>
        <DialogSection>
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {isFetching ? <Spinner className="icon-xs" /> : null}
            {items?.map((page) => {
              const space = pageSpace(page, pages, spaces);
              return (
                <Button
                  key={page.page_id}
                  aria-label={page.title ? [page.title, space?.name].filter(Boolean).join(" ") : undefined}
                  color="ghostActive"
                  onClick={() => {
                    deferred.current = () => onSelect(page);
                    onOpenChange(false);
                  }}
                >
                  <PageIcon pageId={page.page_id} symbol={page.symbol} iconClassName="text-secondary" title={page.title ?? ""}>
                    {({ icon, title }) => (
                      <>
                        {icon}
                        {page.title ? title : <FormattedMessage {...pageMessages.untitled} />}
                      </>
                    )}
                  </PageIcon>
                  {space == null ? null : <span className="ms-auto truncate text-xs text-secondary">{space.name}</span>}
                </Button>
              );
            })}
          </div>
          {!isFetching && items?.length === 0 && query.trim().length > 0 ? (
            <p className="select-none" role="status">
              <FormattedMessage {...pageLinkMessages.noMatchingPages} />
            </p>
          ) : null}
        </DialogSection>
        {onCreateSubpage == null ? null : (
          <DialogSection>
            <Button
              color="secondary"
              onClick={() => {
                deferred.current = onCreateSubpage;
                onOpenChange(false);
              }}
            >
              <FormattedMessage {...pageLinkMessages.createSubpage} />
            </Button>
          </DialogSection>
        )}
      </DialogBody>
    </Dialog>
  );
}
