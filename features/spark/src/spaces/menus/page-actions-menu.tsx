import { useRef, type Ref } from "react";
import { useIntl, type MessageDescriptor } from "react-intl";
import { EllipsisHorizontalLight16Icon } from "../../codex/icons";
import { Button } from "../../codex/ui/button";
import { composeRefs } from "../../codex/ui/compose-refs";
import { ContextMenu, type ContextMenuItem } from "../../codex/ui/context-menu";
import { DsButton } from "../../codex/ui/ds-button";
import { pageActionMessages } from "./page-actions";

export interface PageActionsMenuProps {
  ref?: Ref<HTMLButtonElement>;
  /** Library rows use the ghost `actionSm` trigger; sidebars use the transparent `3xs` one. */
  libraryPresentation?: boolean;
  documentType?: string;
  getItems: () => ContextMenuItem[] | Promise<ContextMenuItem[]>;
  kind: "page" | "space";
  loadingMessage?: MessageDescriptor;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  title: string;
}

/** `aR` (`AHo`): the "…" button that opens a Page's or Space's actions menu. */
export function PageActionsMenu({
  ref,
  libraryPresentation = false,
  documentType = "page",
  getItems,
  kind,
  loadingMessage,
  onOpenChange,
  open,
  title,
}: PageActionsMenuProps) {
  const intl = useIntl();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const refocusTriggerOnShare = (items: ContextMenuItem[]) =>
    items.map((item) =>
      item.id === "share-page-or-space"
        ? {
            ...item,
            selectAfterClose: true,
            onSelect: () => {
              if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
              item.onSelect?.();
            },
          }
        : item,
    );

  const label =
    kind === "space"
      ? intl.formatMessage(
          {
            id: "codex.space.sidebar.spaceActions",
            defaultMessage: "Space actions for {title}",
            description:
              "Accessible label for the actions menu beside a shared Space in the Pages sidebar. Translate Space/Spaces as a common noun for an area or collection of Pages and files, not a proper name or outer space. Keep the term consistent with navigation.",
          },
          { title },
        )
      : title.trim()
        ? intl.formatMessage(
            {
              id: "codex.space.page.actions",
              defaultMessage: "Page actions for {title}",
              description: "Accessible label for the actions menu beside a Page title in the Space sidebar",
            },
            { title },
          )
        : intl.formatMessage(
            {
              id: "codex.space.page.actions.untitled",
              defaultMessage:
                "Page actions for {documentType, select, granola_document {Untitled doc} granola_whiteboard {Untitled canvas} granola_workbook {Untitled sheet} granola_presentation {Untitled presentation} other {Untitled page}}",
              description:
                "Accessible label for the actions menu beside an untitled document in the Space sidebar. documentType selects the untitled name for a Doc, canvas, sheet, presentation, or ordinary Page.",
            },
            { documentType },
          );

  const resolveItems = () => {
    const items = getItems();
    return Array.isArray(items) ? refocusTriggerOnShare(items) : items.then(refocusTriggerOnShare);
  };

  return (
    <ContextMenu
      preserveBrowserContextMenu
      align="start"
      contentWidth="menuFixed"
      loadingMessage={loadingMessage ?? (kind === "space" ? pageActionMessages.loadingSpace : undefined)}
      getItems={resolveItems}
      onOpenChange={onOpenChange}
      trigger="click"
    >
      {libraryPresentation ? (
        <Button
          ref={composeRefs(ref, triggerRef)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={label}
          color="ghost"
          size="actionSm"
          uniform
        >
          <EllipsisHorizontalLight16Icon />
        </Button>
      ) : (
        <DsButton
          ref={composeRefs(ref, triggerRef)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={label}
          color="secondary"
          variant="transparent"
          size="3xs"
          uniform
        >
          <EllipsisHorizontalLight16Icon />
        </DsButton>
      )}
    </ContextMenu>
  );
}
