import clsx from "clsx";
import type { AriaRole, ComponentType, MouseEventHandler, ReactNode } from "react";
import { InfoCircleLight20Icon } from "../icons/info-circle-light-20";
import { Button, type ButtonColor, type ButtonSize } from "./button";

const css = { successCta: "_successCta_1dw5f_1", catalog: "_catalog_1dw5f_8" } as const;

export type BannerType = "normal" | "caution" | "error" | "infoAccent" | "success" | "warning";
type SurfaceBannerVariant = "default" | "callout" | "announcement" | "announcementInset" | "catalog" | "settings";
export type BannerVariant = SurfaceBannerVariant | "status" | "strip" | "page" | "pageNotice" | "insetNotice" | "privacyNotice";
export type BannerLayout = "horizontal" | "inline" | "vertical" | "verticalIcon" | "warningCallout";

type CtaClickHandler = MouseEventHandler<HTMLButtonElement>;

export interface BannerProps {
  title?: ReactNode;
  content: ReactNode;
  density?: "default" | "compact";
  primaryCtaText?: ReactNode;
  primaryCtaColor?: ButtonColor;
  onPrimaryCtaClick?: CtaClickHandler;
  isPrimaryCtaDisabled?: boolean;
  secondaryCtaText?: ReactNode;
  secondaryCtaColor?: ButtonColor;
  onSecondaryCtaClick?: CtaClickHandler;
  isSecondaryCtaDisabled?: boolean;
  dangerCtaText?: ReactNode;
  onDangerCtaClick?: CtaClickHandler;
  isDangerCtaDisabled?: boolean;
  icon?: ReactNode;
  Icon?: ComponentType<{ className?: string }>;
  iconClassName?: string;
  type?: BannerType;
  variant?: BannerVariant;
  layout?: BannerLayout;
  stackOnNarrow?: boolean;
  showCtaSeparator?: boolean;
  wrapCtas?: boolean;
  ariaLive?: "off" | "polite" | "assertive";
  role?: AriaRole;
  trailingAction?: ReactNode;
  attachedToComposer?: boolean;
}

const narrowStackCtaClassName =
  "[@container_(max-width:400px)]:w-full [@container_(max-width:400px)]:shrink [@container_(max-width:400px)]:flex-wrap [@container_(max-width:400px)]:justify-center";

export function Banner({
  title,
  content,
  density = "default",
  onPrimaryCtaClick,
  primaryCtaText,
  primaryCtaColor,
  secondaryCtaColor,
  onSecondaryCtaClick,
  onDangerCtaClick,
  secondaryCtaText,
  dangerCtaText,
  icon,
  Icon,
  iconClassName,
  isPrimaryCtaDisabled = false,
  isSecondaryCtaDisabled = false,
  isDangerCtaDisabled = false,
  type = "normal",
  variant = "default",
  layout = "horizontal",
  stackOnNarrow = false,
  showCtaSeparator = true,
  wrapCtas = false,
  ariaLive,
  role,
  trailingAction,
  attachedToComposer = false,
}: BannerProps) {
  if (variant === "status") {
    return (
      <aside aria-live={ariaLive} className="flex items-center gap-2 rounded-lg bg-secondary-soft px-3 py-3 text-sm text-default select-none" role={role}>
        {icon}
        <div className="min-w-0 flex-1 break-words">{content}</div>
      </aside>
    );
  }
  if (variant === "strip") {
    return (
      <aside
        aria-live={ariaLive}
        className="flex min-h-11 w-full shrink-0 items-center justify-center gap-2 bg-info-surface px-4 py-2 text-sm text-default select-none"
        role={role}
      >
        {icon}
        <div className="min-w-0 text-center break-words">
          {title ? (
            <span className="font-semibold">
              {title}
              {" "}
            </span>
          ) : null}
          {content}
        </div>
      </aside>
    );
  }

  const isPage = variant === "page";
  const isPageNotice = variant === "pageNotice";
  const isInsetNotice = variant === "insetNotice";
  const primaryCtaSize: ButtonSize | undefined = isPage || isInsetNotice ? "dialogAction" : isPageNotice ? "dialog" : undefined;
  const isCallout = variant === "callout";
  const isWide = isPage || variant === "catalog" || variant === "announcement" || variant === "announcementInset" || variant === "settings";
  const isHorizontal = layout === "horizontal";
  const isInline = layout === "inline";
  const isVertical = layout === "vertical";
  const isWarningCallout = layout === "warningCallout";
  const stacksHorizontal = isHorizontal && stackOnNarrow;
  const stacksWarningCallout = isWarningCallout && stackOnNarrow;

  const ctaClassName = clsx(
    "flex gap-2",
    wrapCtas && "min-w-0 shrink flex-wrap justify-end",
    !wrapCtas && (isVertical ? "w-full justify-end" : "shrink-0"),
    isHorizontal && !isPageNotice && !isInsetNotice && !isWide && (attachedToComposer ? "mt-0 min-w-fit" : "mt-2 min-w-fit @min-[560px]:mt-0"),
    isWide && "max-w-full",
    type === "success" && css.successCta,
    isWarningCallout && showCtaSeparator && "border-default border-s ps-3",
    stacksHorizontal && !isPageNotice && !isWide && narrowStackCtaClassName,
    stacksWarningCallout && narrowStackCtaClassName,
    stacksWarningCallout &&
      showCtaSeparator &&
      "[@container_(max-width:400px)]:border-t [@container_(max-width:400px)]:border-s-0 [@container_(max-width:400px)]:pt-2 [@container_(max-width:400px)]:ps-0",
  );
  const ctas = (primaryCtaText || secondaryCtaText || dangerCtaText) && (
    <div className={ctaClassName}>
      {primaryCtaText && (
        <Button onClick={onPrimaryCtaClick} size={primaryCtaSize} color={primaryCtaColor ?? "outline"} className="shrink-0" disabled={isPrimaryCtaDisabled}>
          {primaryCtaText}
        </Button>
      )}
      {secondaryCtaText && (
        <Button
          onClick={onSecondaryCtaClick}
          size={isPageNotice ? "dialog" : undefined}
          color={secondaryCtaColor ?? "ghost"}
          className="shrink-0"
          disabled={isSecondaryCtaDisabled}
        >
          {secondaryCtaText}
        </Button>
      )}
      {dangerCtaText && (
        <Button onClick={onDangerCtaClick} color="danger" className="shrink-0" disabled={isDangerCtaDisabled}>
          {dangerCtaText}
        </Button>
      )}
    </div>
  );

  if (isInsetNotice) {
    return (
      <aside
        aria-live={ariaLive}
        role={role}
        className="flex w-full flex-wrap items-center gap-4 rounded-xl bg-secondary-soft px-4 py-3 text-sm text-default select-none"
      >
        <div className="min-w-0 flex-1 text-secondary">{content}</div>
        {ctas}
        {trailingAction}
      </aside>
    );
  }
  if (isPage) {
    const pageIcon = icon ?? (Icon ? <Icon className={iconClassName} /> : null);
    return (
      <aside aria-live={ariaLive} role={role} className="w-full shrink-0 bg-surface-tertiary text-default select-none">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-2 py-4 md:px-6 lg:py-6">
          <div className="mx-2 min-w-0 grow md:mx-4">
            <div className="flex items-center gap-4">
              <div className="hidden shrink-0 text-warning md:block">{pageIcon}</div>
              <div className="text-lg font-semibold">{title}</div>
            </div>
            <div className="text-base md:ms-8">{content}</div>
          </div>
          {ctas}
          {trailingAction}
        </div>
      </aside>
    );
  }
  if (isPageNotice) {
    return (
      <aside
        aria-live={ariaLive}
        role={role}
        className="flex min-h-13 w-full flex-wrap items-center gap-2 border-b border-default bg-surface px-5 py-2 text-sm text-default select-none md:flex-nowrap"
      >
        {icon ?? (Icon ? <Icon /> : null)}
        <div className="min-w-0 flex-1 leading-5 md:truncate">{content}</div>
        {ctas}
        {trailingAction}
      </aside>
    );
  }
  if (variant === "privacyNotice") {
    const noticeIconClassName = clsx("text-secondary", iconClassName);
    return (
      <aside aria-live={ariaLive} className="flex items-center gap-3 rounded-xl bg-background-secondary-soft-alpha p-3 select-none" role={role}>
        {icon ?? (Icon ? <Icon className={noticeIconClassName} /> : <InfoCircleLight20Icon className={noticeIconClassName} />)}
        <div className="flex min-w-0 flex-1 flex-col">
          {title ? <div className="text-xs font-medium text-default">{title}</div> : null}
          <div className="text-xs text-secondary">{content}</div>
          {ctas}
        </div>
        {trailingAction}
      </aside>
    );
  }

  const surfaceVariant = variant as SurfaceBannerVariant;
  const toneClassName = {
    caution: "border-default text-default",
    error: "border-text-danger/20 text-danger",
    infoAccent: "border-text-info/40 text-default",
    normal: clsx(
      "text-default",
      isCallout && "border-strong",
      surfaceVariant === "settings" && "border-default",
      !isCallout && surfaceVariant !== "settings" && "border-primary-outline",
    ),
    success: "border-chart-green/30 text-chart-green",
    warning: "border-text-warning/30 text-default",
  }[type];
  const backgroundClassName = {
    caution: "bg-background-caution-solid/15",
    error: "bg-background-danger-surface/20",
    infoAccent: "bg-primary-soft",
    normal: {
      callout: "bg-callout-surface",
      announcement: "bg-surface-elevated",
      catalog: "bg-surface-elevated",
      announcementInset: "bg-surface-tertiary",
      settings: "bg-surface",
      default: attachedToComposer ? "bg-surface-tertiary" : "bg-transparent",
    }[surfaceVariant],
    success: "bg-chart-green/15",
    warning: isWarningCallout ? "bg-background-warning-surface/15" : "bg-background-warning-surface/30",
  }[type];
  const resolvedIconClassName = clsx(
    !isCallout && !isWide && "icon-sm shrink-0",
    isWide && "icon-md shrink-0 text-secondary",
    type === "infoAccent" && "text-info",
    type === "success" && "text-chart-green",
    type === "warning" && "text-warning",
    iconClassName,
  );
  const leadingIcon = icon ?? (Icon ? <Icon className={resolvedIconClassName} /> : null);
  const backdrop = <div aria-hidden className={clsx("absolute inset-0 -z-10", backgroundClassName)} />;
  const surfaceClassName = clsx(
    "relative isolate flex w-full overflow-hidden bg-surface",
    surfaceVariant !== "catalog" && "border",
    !isWide && "text-pretty",
    surfaceVariant === "catalog" && "text-document leading-5",
    surfaceVariant !== "catalog" && (surfaceVariant === "announcementInset" ? "text-base" : "text-sm"),
    {
      callout: "rounded-md px-4 py-3",
      announcement: "rounded-3xl px-5 py-4 shadow-xs",
      catalog: clsx("px-5 py-4", css.catalog),
      announcementInset: "rounded-3xl px-5 py-4 shadow-xs",
      settings: "rounded-2xl py-4 ps-5 pe-3",
      default: clsx(
        "shadow-[0_0_2px_0_rgb(0_0_0/5%),0_4px_6px_0_rgb(0_0_0/2%)] lg:mx-auto",
        attachedToComposer
          ? "-mb-9 rounded-t-[32px] rounded-b-none border-b-0 ps-4 pe-2.5 pt-2.5 pb-9 electron:border electron:border-b-0"
          : clsx("rounded-3xl electron:border-0 electron:ring-[0.5px] electron:ring-border-strong", density === "compact" ? "py-2 ps-3 pe-2" : "py-4 ps-5 pe-3"),
      ),
    }[surfaceVariant],
    toneClassName,
    isWarningCallout && type === "warning" && "before:bg-text-warning/60 before:absolute before:inset-y-0 before:start-0 before:w-0.5",
  );
  const titleClassName = {
    announcementInset: "text-base font-semibold",
    announcement: "text-sm font-medium",
    catalog: "text-document leading-5 font-medium",
    settings: "text-sm font-medium",
    callout: "text-sm font-medium",
    default: "text-sm font-bold",
  }[surfaceVariant];
  const gap = isCallout ? "gap-1" : "gap-1.5";
  let contentToneClassName = isCallout || isWide || isWarningCallout || attachedToComposer ? "text-secondary" : "text-codex-description";
  if (type === "error") contentToneClassName = "text-danger";
  else if (type === "success") contentToneClassName = "text-chart-green";
  const renderContent = (className?: string) => (
    <div className={clsx("flex min-w-0 flex-1 flex-col", className)}>
      <div
        className={clsx(
          "min-w-0 flex-1",
          isInline && "truncate",
          !isCallout && !isWide && "electron:leading-relaxed",
          isWide && "leading-5",
          (surfaceVariant === "announcement" || surfaceVariant === "catalog" || surfaceVariant === "settings") && "tracking-announcement-body",
          !isCallout && !isWide && !isInline && "text-pretty",
          (title || attachedToComposer) && contentToneClassName,
        )}
      >
        {content}
      </div>
    </div>
  );

  if (isVertical) {
    return (
      <aside aria-live={ariaLive} className={clsx(surfaceClassName, "flex-col", gap)} role={role}>
        {backdrop}
        {(leadingIcon ?? title) && (
          <div className="flex items-center gap-1">
            {leadingIcon}
            {title && <h3 className={titleClassName}>{title}</h3>}
          </div>
        )}
        {renderContent(gap)}
        {ctas}
      </aside>
    );
  }
  if (layout === "verticalIcon") {
    const startAligned = isCallout || surfaceVariant === "settings";
    return (
      <aside aria-live={ariaLive} className={clsx(surfaceClassName, "gap-3", startAligned && "items-start")} role={role}>
        {backdrop}
        {leadingIcon == null ? null : <div className={startAligned ? "mt-0.5" : "flex items-center self-center"}>{leadingIcon}</div>}
        <div className={clsx("flex min-w-0 flex-1 flex-col", gap)}>
          {title ? <h3 className={titleClassName}>{title}</h3> : null}
          {renderContent()}
          {ctas}
        </div>
      </aside>
    );
  }
  if (isWarningCallout) {
    return (
      <div className="@container w-full">
        <aside
          aria-live={ariaLive}
          className={clsx(
            surfaceClassName,
            "items-center gap-3",
            stacksWarningCallout &&
              "[@container_(max-width:400px)]:flex-wrap [@container_(max-width:400px)]:items-start [@container_(max-width:400px)]:gap-2",
          )}
          role={role}
        >
          {backdrop}
          {leadingIcon}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {title && <h3 className="text-sm font-semibold text-pretty">{title}</h3>}
            {renderContent()}
          </div>
          {ctas}
        </aside>
      </div>
    );
  }
  return (
    <aside aria-live={ariaLive} className={clsx(surfaceClassName, "@container items-start gap-4")} role={role}>
      {backdrop}
      <div className={clsx("flex h-full w-full gap-3", isWide ? "items-center" : "items-start @min-[560px]:items-center")}>
        {leadingIcon != null && <div className={clsx("flex items-start", !isWide && "pt-0.5")}>{leadingIcon}</div>}
        <div
          className={clsx(
            "flex min-w-0 grow",
            isInline && "items-center justify-between gap-3",
            !isInline && isWide && "flex-wrap items-center gap-x-8 gap-y-3",
            !isInline && !isWide && "flex-col",
            !isInline &&
              !isWide &&
              attachedToComposer &&
              "@min-[400px]:flex-row @min-[400px]:items-start @min-[400px]:justify-between @min-[400px]:gap-3",
            !isInline &&
              !isWide &&
              !attachedToComposer &&
              "@min-[560px]:flex-row @min-[560px]:items-center @min-[560px]:justify-between @min-[560px]:gap-8",
          )}
        >
          <div className={clsx("flex min-w-0 flex-col", isWide ? "grow basis-64 wrap-break-word" : "flex-1")}>
            {title && <h3 className={titleClassName}>{title}</h3>}
            {renderContent()}
          </div>
          {ctas}
        </div>
      </div>
      {trailingAction ? <div className="flex shrink-0 items-start @min-[560px]:self-center">{trailingAction}</div> : null}
    </aside>
  );
}
