import clsx from "clsx";
import type { ReactNode } from "react";

export interface SettingsSectionProps {
  children?: ReactNode;
  id?: string;
  className?: string;
}

function SettingsSectionRoot({ children, id, className }: SettingsSectionProps) {
  return (
    <section id={id} className={clsx("flex flex-col", className)}>
      {children}
    </section>
  );
}

export interface SettingsSectionHeaderProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  actionsAlignment?: "end";
  className?: string;
  size?: "default" | "compact" | "recommendation" | "large" | "base";
  titleGap?: "default" | "none";
  spacing?: "default" | "compact";
  subtitlePlacement?: "below-title" | "below-header";
  subtitleWrap?: "balance" | "wrap";
}

function SettingsSectionHeader({
  title,
  subtitle,
  actions,
  actionsAlignment,
  className,
  size = "default",
  titleGap = "default",
  spacing = "default",
  subtitlePlacement = "below-title",
  subtitleWrap = "balance",
}: SettingsSectionHeaderProps) {
  const hasTitle = title != null;
  const hasSubtitle = subtitle != null;
  const hasActions = actions != null;
  const isSmall = size === "compact" || size === "recommendation";
  const subtitleNode = subtitle ? (
    <div
      className={clsx(
        "ws-settings-subtitle",
        "font-normal text-secondary group-data-[density=compact]/settings:text-wrap",
        subtitleWrap === "balance" ? "text-balance" : "text-wrap",
        isSmall ? "text-xs leading-4" : "text-sm leading-[18px]",
        subtitlePlacement === "below-header" && "w-full",
      )}
    >
      {subtitle}
    </div>
  ) : null;
  if (!hasTitle && !hasSubtitle && !hasActions) return <></>;
  return (
    <div
      className={clsx(
        "flex justify-between group-data-[density=compact]/settings:min-h-0 group-data-[density=compact]/settings:pb-3",
        subtitlePlacement === "below-header" ? "flex-wrap gap-x-4 gap-y-0.5" : "gap-4",
        hasSubtitle && spacing === "compact" && "pb-2",
        hasSubtitle && spacing !== "compact" && "pb-3",
        !hasSubtitle && clsx("items-center pb-1.5", spacing === "compact" ? "min-h-8" : "min-h-toolbar"),
        hasSubtitle && isSmall && "items-center",
        hasSubtitle && !isSmall && "items-start",
        className,
      )}
    >
      <div className={clsx("flex min-w-0 flex-1 flex-col", titleGap === "none" ? "gap-0" : "gap-0.5 group-data-[density=compact]/settings:gap-0.75")}>
        {title ? (
          <div
            className={clsx(
              "ws-settings-title",
              "font-medium text-default group-data-[density=compact]/settings:text-lg group-data-[density=compact]/settings:leading-5",
              size === "compact" && "text-sm leading-[18px]",
              size === "recommendation" && "text-sm leading-[21px]",
              (size === "large" || (size === "default" && hasSubtitle)) && "text-lg",
              (size === "base" || (size === "default" && !hasSubtitle)) && "text-base",
            )}
          >
            {title}
          </div>
        ) : null}
        {subtitlePlacement === "below-title" ? subtitleNode : null}
      </div>
      {actions ? <div className={clsx("flex items-center gap-2", actionsAlignment === "end" && "self-end")}>{actions}</div> : null}
      {subtitlePlacement === "below-header" ? subtitleNode : null}
    </div>
  );
}

function SettingsSectionContent({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={clsx("flex flex-col gap-1.5", className)}>{children}</div>;
}

function SettingsSectionFooter({ children, className, variant = "description" }: { children?: ReactNode; className?: string; variant?: "description" | "action" }) {
  return (
    <div className={clsx("text-balance text-secondary", variant === "action" ? "pt-4 text-sm leading-5" : "px-4 pt-1.5 text-xs leading-4", className)}>{children}</div>
  );
}

/** Settings page section (`XS` in app-initial: `eUs` with `Header` / `Content` / `Footer`). */
export const SettingsSection = Object.assign(SettingsSectionRoot, {
  Header: SettingsSectionHeader,
  Content: SettingsSectionContent,
  Footer: SettingsSectionFooter,
});
