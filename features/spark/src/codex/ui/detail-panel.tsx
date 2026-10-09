import clsx from "clsx";
import type { KeyboardEventHandler, ReactNode } from "react";
import { XmarkMdLight20Icon } from "../icons/xmark-md-light-20";
import { Button } from "./button";
import { Tooltip } from "./tooltip";

export type DetailPanelVariant = "default" | "glass" | "summary";
export type DetailPanelPlacement = "shell" | "inline";

export interface DetailPanelProps {
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  shellHeaderControlsSpacer?: ReactNode;
  leading?: ReactNode;
  navigation?: ReactNode;
  placement?: DetailPanelPlacement;
  showHeader?: boolean;
  variant?: DetailPanelVariant;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  closeLabel?: string;
  onClose?: () => void;
  showCloseButton?: boolean;
}

/** `GKr1Component`: the toolbar close button of a detail panel. */
export function DetailPanelCloseButton({ color = "ghost", label, onClick }: { color?: "ghost" | "secondary"; label?: string; onClick?: () => void }) {
  return (
    <Tooltip tooltipContent={label} delayOpen>
      <Button aria-label={label} color={color} radius={color === "secondary" ? "full" : undefined} size="toolbar" uniform onClick={onClick}>
        <XmarkMdLight20Icon />
      </Button>
    </Tooltip>
  );
}

interface DetailPanelHeaderProps {
  actions?: ReactNode;
  closeAction: ReactNode;
  shellHeaderControlsSpacer?: ReactNode;
  leading?: ReactNode;
  navigation?: ReactNode;
  placement: DetailPanelPlacement;
  variant: DetailPanelVariant;
}

/** `MKr1Component`; the sidebar spacer it adds inside the app-shell layout is not reproduced. */
function DetailPanelHeader({ actions, closeAction, shellHeaderControlsSpacer, leading, navigation, placement, variant }: DetailPanelHeaderProps) {
  const draggable = placement === "shell" && "draggable";
  if (variant === "glass") {
    return (
      <div className="flex shrink-0 flex-col gap-2 px-toolbar pb-3">
        <div className={clsx("flex h-toolbar min-w-0 items-center gap-2", draggable)}>
          <div className="flex min-w-0 flex-1 items-center">{leading}</div>
          {closeAction}
          {shellHeaderControlsSpacer}
        </div>
        {navigation}
        {actions}
      </div>
    );
  }
  if (navigation == null) {
    return (
      <div className={clsx("flex min-w-0 shrink-0 items-center gap-2", draggable, variant === "default" ? "h-toolbar px-toolbar" : "min-h-toolbar border-b border-default px-6 py-3")}>
        <div className={clsx("flex min-w-0 items-center", variant !== "default" && "flex-1")}>{leading}</div>
        <div className="ms-auto flex min-w-0 shrink-0 items-center gap-1.5">
          {actions}
          {closeAction}
          {shellHeaderControlsSpacer}
        </div>
      </div>
    );
  }
  return (
    <div
      className={clsx(
        "grid h-toolbar min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-toolbar [@container_app-shell-detail-panel_(max-width:899px)]:grid-cols-[auto_minmax(0,1fr)_auto] [@container_app-shell-detail-panel_(max-width:899px)]:gap-1",
        draggable,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 justify-self-start">{leading}</div>
      <div className="min-w-0 justify-self-center [@container_app-shell-detail-panel_(max-width:899px)]:w-full [@container_app-shell-detail-panel_(max-width:899px)]:justify-self-stretch">{navigation}</div>
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-1 justify-self-end">
        {actions}
        {closeAction}
        {shellHeaderControlsSpacer}
      </div>
    </div>
  );
}

/** `wqt` (`PKr1Component`): side-panel shell with a toolbar header, scrollable body and optional footer. */
export function DetailPanel({
  actions,
  children,
  footer,
  shellHeaderControlsSpacer,
  leading,
  navigation,
  placement = "shell",
  showHeader = true,
  variant = "default",
  onKeyDown,
  closeLabel,
  onClose,
  showCloseButton,
}: DetailPanelProps) {
  const closeAction = showCloseButton === false ? null : <DetailPanelCloseButton color={variant === "glass" ? "secondary" : "ghost"} label={closeLabel} onClick={onClose} />;
  return (
    <div
      className={clsx(
        "@container/app-shell-detail-panel flex h-full min-h-0 flex-col",
        variant === "glass" ? "overflow-hidden rounded-3xl bg-surface-elevated-secondary p-2 text-default shadow-lg ring-[0.5px] ring-border" : "bg-surface",
        variant === "summary" && "relative",
      )}
      role="presentation"
      onKeyDown={onKeyDown}
    >
      {showHeader ? (
        <DetailPanelHeader
          actions={actions}
          closeAction={closeAction}
          shellHeaderControlsSpacer={shellHeaderControlsSpacer}
          leading={leading}
          navigation={navigation}
          placement={placement}
          variant={variant}
        />
      ) : null}
      <div className={clsx("flex min-h-0 flex-1 flex-col", variant === "glass" && "overflow-hidden")}>{children}</div>
      {footer == null ? null : (
        <div
          className={
            variant === "summary"
              ? "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface from-50% via-surface/50 via-75% to-transparent p-6"
              : "shrink-0 border-t border-default p-panel"
          }
        >
          {variant === "summary" ? <div className="pointer-events-auto">{footer}</div> : footer}
        </div>
      )}
    </div>
  );
}
