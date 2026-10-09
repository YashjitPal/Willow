import { useState, type ReactNode } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { PlusLgLight16Icon } from "../../codex/icons";
import { FloatingControlButton } from "../../codex/ui/floating-control";
import { Tooltip } from "../../codex/ui/tooltip";
import { useDotsOnPage } from "../state";
import { DotFacepile } from "../willow/dot/dot-facepile";
import { PageDotsDialog } from "./page-dots-dialog";

export interface PageDotsControlSlots {
  /** The header button that opens "Bots on this page". */
  controls: ReactNode;
  onShare: (() => void) | undefined;
}

/** A Page header's bots control, where Codex's sharing controls were: the bots on the Page, opening "Bots on this page". */
export function PageDotsControls({ children, disabled, pageId }: { children: (slots: PageDotsControlSlots) => ReactNode; disabled?: boolean; pageId: string }) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const onPage = useDotsOnPage(disabled ? null : pageId);
  if (disabled) return <>{children({ controls: null, onShare: undefined })}</>;
  const label = intl.formatMessage({ id: "willow.pages.dots.button", defaultMessage: "Bots on this page", description: "Opens the dialog listing the bots that work on the Page" });
  const onShare = () => setOpen(true);
  return (
    <>
      {children({
        controls: (
          <Tooltip tooltipContent={label}>
            <FloatingControlButton className="ws-share-button ws-dots-button" aria-label={label} onClick={onShare}>
              {onPage.length > 0 ? <DotFacepile dots={onPage.map((entry) => entry.dot)} max={3} size={22} withTooltip={false} /> : <PlusLgLight16Icon />}
              <span data-viewer-header-collapsible className="overflow-hidden whitespace-nowrap">
                {onPage.length > 0 ? (
                  <FormattedMessage id="willow.pages.dots.buttonLabel" defaultMessage="Bots" description="Label of the Page header button showing the bots on the Page" />
                ) : (
                  <FormattedMessage id="willow.pages.dots.addButtonLabel" defaultMessage="Add bots" description="Label of the Page header button when no bot is on the Page" />
                )}
              </span>
            </FloatingControlButton>
          </Tooltip>
        ),
        onShare,
      })}
      {open ? <PageDotsDialog pageId={pageId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
