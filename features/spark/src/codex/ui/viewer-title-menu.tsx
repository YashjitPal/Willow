import clsx from "clsx";
import type { ReactNode } from "react";
import { defineMessages, useIntl } from "react-intl";
import { ChevronDownSmLight16Icon } from "../icons/chevron-down-sm-light-16";
import { DropdownMenu, type DropdownMenuProps } from "./dropdown-menu";
import { FloatingControlButton, floatingControlCss, type FloatingControlButtonProps } from "./floating-control";
import { Menu } from "./menu";
import { Tooltip } from "./tooltip";

const messages = defineMessages({
  fileActions: {
    id: "viewerHeader.fileActions",
    defaultMessage: "File actions for {title}",
    description: "Accessible label for a viewer's file actions menu",
  },
});

export type ViewerTitleButtonProps = FloatingControlButtonProps & {
  title: string;
  icon: ReactNode;
};

/** Title chip that opens a viewer's file menu (trigger of `$b` / `SEi`). */
export function ViewerTitleButton({ title, icon, className, ...rest }: ViewerTitleButtonProps) {
  const intl = useIntl();
  return (
    <FloatingControlButton
      className={clsx(floatingControlCss.title, "min-w-0", className)}
      variant="dropdown"
      aria-label={intl.formatMessage(messages.fileActions, { title })}
      {...rest}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        {icon}
        <span className="block max-w-[168px] min-w-0 truncate" data-viewer-header-collapsible>
          {title}
        </span>
      </span>
      <ChevronDownSmLight16Icon />
    </FloatingControlButton>
  );
}

export interface ViewerTitleMenuProps extends Omit<DropdownMenuProps, "align" | "contentWidth"> {
  title: string;
  icon: ReactNode;
  breadcrumb?: ReactNode;
}

/** Viewer header file menu (`$b` / `SEi` in app-shared): the file summary section above the file actions. */
export function ViewerTitleMenu({ title, icon, breadcrumb, triggerButton, open, children, ...rest }: ViewerTitleMenuProps) {
  return (
    <DropdownMenu
      {...rest}
      open={open}
      align="start"
      contentWidth="menu"
      triggerButton={
        <Tooltip
          cloneCustomTrigger
          side="bottom"
          tooltipClassName="text-start"
          triggerPopupOpen={open}
          tooltipContent={
            <div className="flex flex-col items-start font-normal">
              <span>{title}</span>
              {breadcrumb != null && <span className="text-secondary">{breadcrumb}</span>}
            </div>
          }
        >
          {triggerButton}
        </Tooltip>
      }
    >
      <Menu.Section className="flex max-w-85 items-center gap-2 py-1.5 ps-2 pe-4 text-default">
        <span className="flex size-5 shrink-0 items-center justify-center self-start">{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="min-w-0 overflow-hidden wrap-anywhere whitespace-normal line-clamp-2 text-sm leading-5 text-default select-text">{title}</span>
          {breadcrumb != null && <span className="text-xs leading-4 break-words text-secondary">{breadcrumb}</span>}
        </div>
      </Menu.Section>
      <Menu.Separator className="last:hidden" />
      {children}
    </DropdownMenu>
  );
}
