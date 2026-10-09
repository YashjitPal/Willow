import clsx from "clsx";
import type { ReactNode } from "react";
import { FormattedMessage } from "react-intl";
import { Button } from "./button";
import { Dialog, DialogDescription, DialogTitle, type DialogSize, type DialogVariant } from "./dialog";
import { DialogBody, DialogFooter, DialogHeader, DialogSection } from "./dialog-layout";

interface PreviewDialogShellProps {
  className?: string;
  icon?: ReactNode;
  iconClassName?: string;
  iconBackgroundClassName?: string;
  title: ReactNode;
  titleText?: string;
  titleClassName?: string;
  headerActions?: ReactNode;
  description?: ReactNode;
  descriptionClassName?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  closeLabel: ReactNode;
  scrollFade?: boolean;
  footer?: ReactNode;
  hideFooter?: boolean;
  size?: DialogSize;
  variant?: DialogVariant;
  children?: ReactNode;
}

/** `KZc`: header with icon and title, an optional scrolling body and a footer that defaults to a close button. */
function PreviewDialogShell({
  className,
  icon,
  iconClassName,
  iconBackgroundClassName,
  title,
  titleText,
  titleClassName,
  headerActions,
  description,
  descriptionClassName,
  isOpen,
  onOpenChange,
  closeLabel,
  scrollFade = true,
  footer,
  hideFooter = false,
  size = "editor",
  variant,
  children,
}: PreviewDialogShellProps) {
  const hasBody = children != null;
  return (
    <Dialog
      contentClassName={clsx("!p-0", className)}
      headerActions={headerActions}
      open={isOpen}
      onOpenChange={onOpenChange}
      size={hasBody ? size : "wide"}
      variant={variant}
    >
      <DialogBody size={hasBody ? (size === "editor" ? "full" : "scrollable") : undefined}>
        {typeof description === "string" ? <DialogDescription className="sr-only">{description}</DialogDescription> : null}
        <DialogSection>
          <DialogHeader
            icon={icon}
            iconClassName={clsx("h-12 w-12 rounded-xl !p-0", iconClassName)}
            iconBackgroundClassName={clsx("bg-transparent", iconBackgroundClassName)}
            title={
              <DialogTitle asChild>
                <div aria-label={titleText} role="heading" aria-level={2}>
                  {title}
                </div>
              </DialogTitle>
            }
            subtitle={description}
            titleClassName={clsx("text-default", headerActions != null && icon == null && "pe-32", titleClassName)}
            subtitleTone="secondary"
            subtitleClassName={descriptionClassName}
          />
        </DialogSection>
        {hasBody ? (
          <DialogSection className="min-h-0 flex-1">
            <div
              className={clsx(
                "overflow-y-auto opacity-80",
                size === "editor" ? "h-full" : "flex min-h-0 flex-col",
                scrollFade ? "vertical-scroll-fade-mask" : null,
              )}
            >
              {children}
            </div>
          </DialogSection>
        ) : null}
        {hideFooter ? null : (
          <DialogSection>
            <DialogFooter className="w-auto gap-2">
              {footer || (
                <Button color="ghost" size="toolbar" onClick={() => onOpenChange(false)}>
                  {closeLabel}
                </Button>
              )}
            </DialogFooter>
          </DialogSection>
        )}
      </DialogBody>
    </Dialog>
  );
}

export interface PreviewDialogProps {
  className?: string;
  icon?: ReactNode;
  iconShape?: "circle" | "rounded";
  title: ReactNode;
  titleText?: string;
  titleClassName?: string;
  headerActions?: ReactNode;
  description?: ReactNode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  footer?: ReactNode;
  hideFooter?: boolean;
  size?: DialogSize;
  variant?: DialogVariant;
  children?: ReactNode;
}

/** `gi`: preview of a skill or app, its icon in a bordered tile next to the title. */
export function PreviewDialog({ icon, iconShape = "circle", ...props }: PreviewDialogProps) {
  return (
    <PreviewDialogShell
      {...props}
      icon={
        icon == null ? null : (
          <span
            className={clsx(
              "flex h-10 w-10 shrink-0 items-center justify-center border border-default text-secondary",
              iconShape === "rounded" ? "rounded-lg" : "rounded-full",
            )}
          >
            {icon}
          </span>
        )
      }
      iconClassName="h-auto w-auto rounded-none border-0 !p-0"
      iconBackgroundClassName="bg-transparent"
      descriptionClassName="text-lg"
      closeLabel={<FormattedMessage id="common.close" defaultMessage="Close" description="Close button label" />}
      scrollFade={false}
    />
  );
}

export interface PreviewDialogTitleProps {
  title: ReactNode;
  kind: ReactNode;
  badge?: ReactNode;
}

/** `vi`: preview dialog title followed by an optional badge and the kind of item ("Skill", "App"). */
export function PreviewDialogTitle({ title, kind, badge }: PreviewDialogTitleProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 truncate">{title}</div>
      {badge}
      <div className="heading-dialog shrink-0 font-normal text-secondary">{kind}</div>
    </div>
  );
}

export interface PreviewDialogSurfaceProps {
  children?: ReactNode;
  className?: string;
  surfaceClassName?: string;
  scrollClassName?: string;
}

/** `_i` (`LQc`): the rounded, scrolling panel that holds a preview's contents. */
export function PreviewDialogSurface({ children, className, surfaceClassName, scrollClassName }: PreviewDialogSurfaceProps) {
  return (
    <div className={clsx("flex h-full min-h-0 flex-col pt-4", className)}>
      <div className={clsx("flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-surface-secondary/40", surfaceClassName)}>
        <div className={clsx("h-full min-h-0 overflow-y-auto", scrollClassName)}>{children}</div>
      </div>
    </div>
  );
}
