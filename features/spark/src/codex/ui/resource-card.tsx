import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { ChevronDownMdLight16Icon } from "../icons/chevron-down-md-light-16";
import { Button, type ButtonProps } from "./button";

export type ResourceCardVariant =
  | "default"
  | "artifact-list"
  | "file-tile"
  | "composer-attachment"
  | "thread-attachment"
  | "attachment"
  | "link-preview";

export interface ResourceCardProps {
  as?: "div" | "span";
  children?: ReactNode;
  className?: string;
  variant?: ResourceCardVariant;
}

/** Card surface of attachments, artifacts and in-conversation cards (`jln` in app-initial). */
export function ResourceCard({ as = "div", children, className, variant = "default" }: ResourceCardProps) {
  const isAttachment = variant === "composer-attachment" || variant === "thread-attachment";
  const classes = clsx(
    "flex max-w-[min(100%,var(--resource-card-max-width,100%))] flex-col overflow-hidden font-sans text-default [--resource-card-row-padding-x:0.75rem]",
    variant === "artifact-list" && "rounded-2xl border border-default bg-surface-elevated [--resource-card-row-padding-x:1rem]",
    variant === "file-tile" && "w-50 shrink-0 rounded-2xl bg-surface-elevated ring-1 ring-border ring-inset md:w-80",
    variant !== "artifact-list" &&
      variant !== "file-tile" &&
      "electron:elevation-stroke extension:border extension:border-default extension:bg-background-primary-soft/50 extension:shadow-sm",
    variant !== "artifact-list" && variant !== "file-tile" && !isAttachment && "bg-surface-elevated-secondary/50",
    isAttachment && "composer-attachment-surface group/resource-card relative max-w-64 flex-shrink-0 bg-primary-soft",
    variant === "composer-attachment" && "w-fit rounded-lg",
    variant === "thread-attachment" && "w-50 rounded-2xl",
    variant === "default" && "rounded-lg",
    variant === "attachment" && "rounded-2xl",
    variant === "link-preview" && "w-90 rounded-2xl",
    className,
  );
  return as === "span" ? <span className={classes}>{children}</span> : <div className={classes}>{children}</div>;
}

export interface ResourceCardButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
}

/** Whole-card click target (`Mln`): covers the card when empty, wraps the row otherwise. */
export function ResourceCardButton({ children, ...props }: ResourceCardButtonProps) {
  return (
    <button
      {...props}
      type="button"
      className={clsx(
        "peer/resource-card cursor-interaction bg-transparent group-hover/resource-card:bg-background-primary-ghost-hover/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
        children == null ? "absolute inset-0" : "relative w-full",
      )}
    >
      {children}
    </button>
  );
}

const rowPadding = { default: "px-[var(--resource-card-row-padding-x)] py-3", compact: "p-1.5" };
const rowPaddingWithTrailingSpace = { default: "py-3 pe-10 ps-[var(--resource-card-row-padding-x)]", compact: "py-1.5 pe-6 ps-1.5" };

export interface ResourceCardRowProps {
  className?: string;
  icon?: ReactNode;
  padding?: "default" | "compact";
  reserveTrailingSpace?: boolean;
  subtitle?: ReactNode;
  title: ReactNode;
  titleTooltip?: string;
  trailing?: ReactNode;
  variant?: ResourceCardVariant;
}

/** Icon, title, subtitle and trailing content of a resource card (`Rln`). */
export function ResourceCardRow({
  className,
  icon,
  padding = "default",
  reserveTrailingSpace = false,
  subtitle,
  title,
  titleTooltip,
  trailing,
  variant = "default",
}: ResourceCardRowProps) {
  const isArtifactList = variant === "artifact-list";
  const isFileTile = variant === "file-tile";
  const isAttachment = variant === "attachment";
  const isLinkPreview = variant === "link-preview";
  const effectivePadding = isAttachment || isLinkPreview ? "compact" : padding;
  const pinTrailing = isArtifactList && trailing != null;
  return (
    <span
      className={clsx(
        "flex min-w-0 items-center text-start",
        (isAttachment || isLinkPreview) && "pointer-events-none relative z-10 h-full",
        isArtifactList && "relative gap-3",
        isFileTile && "gap-2",
        !isArtifactList && !isFileTile && "gap-2.5",
        isFileTile && "p-2.5",
        !reserveTrailingSpace && !pinTrailing && !isFileTile && rowPadding[effectivePadding],
        reserveTrailingSpace && !isArtifactList && rowPaddingWithTrailingSpace[effectivePadding],
        isArtifactList && (reserveTrailingSpace || pinTrailing) && "py-3 pe-14 ps-[var(--resource-card-row-padding-x)]",
        className,
      )}
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={clsx(
            "truncate text-default",
            isAttachment && (reserveTrailingSpace ? "max-w-36" : "max-w-32"),
            isFileTile && "text-sm font-semibold",
            isArtifactList && "text-sm font-medium",
            !isFileTile && !isArtifactList && "text-size-chat font-medium",
          )}
          title={titleTooltip}
        >
          {title}
        </span>
        {subtitle == null ? null : (
          <span className={clsx("truncate text-secondary", isFileTile && "text-sm", isArtifactList && "text-xs", !isFileTile && !isArtifactList && "text-size-chat-sm")}>
            {subtitle}
          </span>
        )}
      </span>
      {pinTrailing ? <span className="absolute end-3 top-1/2 -translate-y-1/2">{trailing}</span> : trailing}
    </span>
  );
}

/** Square icon tile at the start of a resource card row (`Iln`). */
export function ResourceCardIcon({ children }: { children?: ReactNode }) {
  return <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary/92 text-secondary">{children}</span>;
}

const pillClassName =
  "flex h-token-button-composer shrink-0 items-center gap-1 overflow-hidden rounded-lg border border-default bg-transparent px-2 py-0 text-base leading-[18px] whitespace-nowrap";

/** Non-interactive "Open" pill shown at the end of a clickable card (`Lln`). */
export function ResourceCardOpenLabel({ label, showChevron = false }: { label: ReactNode; showChevron?: boolean }) {
  return (
    <span className={clsx(pillClassName, "hover:bg-primary-ghost-hover")}>
      {label}
      {showChevron ? <ChevronDownMdLight16Icon className="opacity-50" aria-hidden={false} /> : null}
    </span>
  );
}

export type ResourceCardActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "color"> &
  Pick<ButtonProps, "disabled" | "loading">;

/** Pill-shaped action button inside a resource card (`Nln`). */
export function ResourceCardActionButton({ children, ...props }: ResourceCardActionButtonProps) {
  return (
    <Button {...props} className={clsx(pillClassName, "not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover")} unstyled>
      {children}
    </Button>
  );
}
