import clsx from "clsx";
import type { KeyboardEvent, ReactNode, Ref, WheelEvent } from "react";
import { LegacySharedDbi838cIcon } from "../icons/legacy-shared-dbi-838c";
import { Button, type ButtonProps } from "./button";

export type TabsVariant = "text" | "segmented" | "toolbar" | "inset" | "page" | "pill" | "filter" | "browse" | "profile" | "icon" | "underline";

export interface TabItem<K extends string = string> {
  key: K;
  name: ReactNode;
  icon?: ReactNode;
  panelId?: string;
  ariaLabel?: string;
  closeLabel?: string;
  onClose?: () => void;
}

export interface TabsProps<K extends string = string> {
  tabs: TabItem<K>[];
  selectedKey: K;
  onSelect: (key: K) => void;
  onTabClick?: (key: K) => void;
  onTabHover?: (key: K) => void;
  className?: string;
  fill?: boolean;
  scrollable?: boolean;
  tabListRef?: Ref<HTMLDivElement>;
  variant?: TabsVariant;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  activationMode?: "automatic" | "manual";
}

interface VariantClasses {
  closeButtonClassName: string;
  itemClassName: string;
  listClassName: string;
  segmentedEdges: boolean;
  selectedClassName: string;
  selectionIndicator: "underline" | null;
  tabButtonClassName: string;
  unselectedClassName: string;
}

const base: VariantClasses = {
  closeButtonClassName: "flex h-7 w-5 items-center justify-center",
  itemClassName: "shrink-0",
  listClassName: "flex min-w-0 items-center gap-0.5",
  segmentedEdges: false,
  selectedClassName: "bg-surface-secondary text-default",
  selectionIndicator: null,
  tabButtonClassName: "flex min-w-0 gap-1.5 rounded-md px-2 py-1 font-medium",
  unselectedClassName: "text-secondary hover:bg-surface-secondary",
};

const variants: Record<TabsVariant, VariantClasses> = {
  text: {
    ...base,
    listClassName: "flex min-w-0 items-center justify-center gap-5",
    tabButtonClassName: "flex min-h-9 min-w-0 items-center font-medium",
    selectedClassName: "text-default font-semibold",
    unselectedClassName: "text-tertiary hover:text-default",
  },
  segmented: {
    closeButtonClassName: "px-1",
    itemClassName: "flex-1",
    listClassName: "border-default flex items-center rounded-lg border",
    segmentedEdges: true,
    selectedClassName: "bg-text-emphasis/25 text-default",
    selectionIndicator: null,
    tabButtonClassName: "relative flex-1 rounded-none px-4 py-1.5 font-medium",
    unselectedClassName: "text-secondary hover:bg-text-emphasis/5",
  },
  toolbar: base,
  inset: {
    ...base,
    listClassName: "inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-[10px] bg-surface-secondary/92 p-0.5",
  },
  page: { ...base, listClassName: "-ms-2 flex min-w-0 items-center gap-2" },
  pill: {
    ...base,
    listClassName: "flex min-w-0 items-center gap-1",
    selectedClassName: "bg-text/5 text-default ring-1 ring-border-strong",
    tabButtonClassName: "flex min-w-0 gap-1.5 rounded-full border border-transparent px-4 py-2 font-medium ring-inset",
    unselectedClassName: "text-tertiary hover:bg-primary-ghost-hover",
  },
  filter: {
    ...base,
    listClassName: "-ms-3 flex min-w-0 items-center gap-1",
    selectedClassName: "bg-text/5 text-default",
    tabButtonClassName: "flex min-h-9 min-w-0 gap-1.5 rounded-full px-3 leading-5 font-normal ring-inset",
    unselectedClassName: "text-secondary hover:bg-primary-ghost-hover",
  },
  browse: {
    ...base,
    listClassName: "flex min-w-0 items-center gap-1",
    selectedClassName: "bg-primary-ghost-hover text-default",
    tabButtonClassName: "flex h-9 min-w-0 rounded-full border border-transparent px-4 py-0 font-medium ring-inset",
    unselectedClassName: "text-secondary hover:bg-background-primary-ghost-hover/50 hover:text-default",
  },
  profile: {
    ...base,
    itemClassName: "flex-1",
    listClassName: "flex min-w-0 items-center",
    selectedClassName: "bg-primary-ghost-hover text-default",
    tabButtonClassName: "flex h-9 w-full min-w-0 justify-center rounded-full border border-transparent px-3 py-0 font-medium",
    unselectedClassName: "text-secondary hover:text-default",
  },
  icon: {
    ...base,
    listClassName: "flex max-w-full min-w-0 flex-wrap items-start justify-center gap-x-8 gap-y-2",
  },
  underline: {
    closeButtonClassName: "px-1",
    itemClassName: "shrink-0 pb-2",
    listClassName: "border-default flex min-w-0 items-start gap-8 border-b",
    segmentedEdges: false,
    selectedClassName: "text-default",
    selectionIndicator: "underline",
    tabButtonClassName: "flex min-w-0 gap-1.5 font-medium",
    unselectedClassName: "text-secondary hover:text-default",
  },
};

const iconTabSizes = {
  medium: { icon: "size-9", caption: "w-9" },
  large: { icon: "size-10", caption: "w-10" },
  xl: { icon: "size-12", caption: "w-12" },
} as const;

type IconTabProps = Omit<Extract<ButtonProps, { as?: "button" }>, "children" | "size" | "as"> & {
  children: ReactNode;
  icon: ReactNode;
  size: keyof typeof iconTabSizes;
  surface?: "elevated" | "flat";
  labelVisibility?: "visible" | "hidden";
};

function IconTab({ children, icon, size, surface = "elevated", labelVisibility = "visible", ...rest }: IconTabProps) {
  return (
    <Button
      {...rest}
      className={clsx("group/labeled-icon flex-col gap-1.5", size === "large" && labelVisibility === "visible" && "pb-1.5")}
      color="ghostTertiary"
      size="inline"
      focusRing="none"
    >
      <span
        className={clsx(
          "flex items-center justify-center rounded-full border-default bg-surface text-default group-not-aria-selected/labeled-icon:group-not-disabled/labeled-icon:group-not-aria-disabled/labeled-icon:group-hover/labeled-icon:bg-primary-ghost-hover group-focus-visible/labeled-icon:ring-2 group-focus-visible/labeled-icon:ring-ring group-aria-selected/labeled-icon:border-transparent group-aria-selected/labeled-icon:bg-info-solid group-aria-selected/labeled-icon:text-inverse",
          surface === "elevated" ? "border shadow-xs" : "border-hairline",
          iconTabSizes[size].icon,
        )}
      >
        {icon}
      </span>
      <span
        className={clsx(
          labelVisibility === "hidden" ? "sr-only" : "text-center text-sm leading-4 whitespace-normal",
          labelVisibility === "visible" && iconTabSizes[size].caption,
        )}
      >
        {children}
      </span>
    </Button>
  );
}

function scrollTabList(event: WheelEvent<HTMLDivElement>) {
  const delta = event.deltaX || event.deltaY;
  if (delta !== 0) event.currentTarget.scrollLeft = event.currentTarget.scrollLeft + delta;
}

/** `Uz` in app-initial. */
export function Tabs<K extends string = string>({
  tabs,
  selectedKey,
  onSelect,
  onTabClick,
  onTabHover,
  className,
  fill = false,
  scrollable = false,
  tabListRef,
  variant = "segmented",
  ariaLabel,
  ariaLabelledBy,
  activationMode = "automatic",
}: TabsProps<K>) {
  const v = variants[variant];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    const index = items.findIndex((item) => item === event.target);
    if (index < 0 || items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (index + (event.key === (rtl ? "ArrowLeft" : "ArrowRight") ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
    if (scrollable) items[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const tab = tabs[next];
    if (tab != null && activationMode === "automatic") onSelect(tab.key);
  };

  return (
    <div
      ref={tabListRef}
      role="tablist"
      tabIndex={-1}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={clsx("ws-tabs", `ws-tabs--${variant}`, v.listClassName, fill && "w-full", scrollable && "hide-scrollbar overflow-x-auto overflow-y-hidden", className)}
      onWheel={scrollable ? scrollTabList : undefined}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab, index) => {
        const selected = tab.key === selectedKey;
        const first = index === 0;
        const last = index === tabs.length - 1;
        const tabProps = {
          id: tab.panelId == null ? undefined : `${tab.panelId}-tab`,
          type: "button" as const,
          role: "tab",
          "aria-controls": tab.panelId,
          "aria-label": tab.ariaLabel,
          "aria-selected": selected,
          tabIndex: selected ? 0 : -1,
          onPointerEnter: onTabHover == null ? undefined : () => onTabHover(tab.key),
          onClick: () => {
            if (!selected || activationMode === "manual") onSelect(tab.key);
            onTabClick?.(tab.key);
          },
        };
        const tabClassName = clsx(
          "ws-tab",
          fill && "min-w-0 flex-1 justify-center",
          variant !== "inset" && [
            "cursor-interaction items-center text-sm select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
            v.tabButtonClassName,
            v.segmentedEdges && first && "rounded-l-md",
            v.segmentedEdges && last && "rounded-r-md",
            selected ? v.selectedClassName : v.unselectedClassName,
          ],
        );
        const tabContent = (
          <>
            {tab.icon == null ? null : (
              <span aria-hidden="true" className="icon-xs flex shrink-0 items-center justify-center">
                {tab.icon}
              </span>
            )}
            {fill ? <span className="truncate">{tab.name}</span> : tab.name}
          </>
        );
        return (
          <div key={tab.key} className={clsx("relative flex min-w-0 items-center", v.itemClassName, fill && "flex-1", tab.onClose != null && "group/tab")}>
            {variant === "icon" ? (
              <IconTab {...tabProps} icon={tab.icon} size="large">
                {tab.name}
              </IconTab>
            ) : variant === "inset" ? (
              <Button {...tabProps} className={tabClassName} color={selected ? "segmentedInsetSelected" : "ghost"} size="compact">
                {tabContent}
              </Button>
            ) : (
              <button {...tabProps} className={tabClassName}>
                {tabContent}
              </button>
            )}
            {v.selectionIndicator === "underline" && selected ? <div className="absolute inset-x-0 bottom-[-1px] h-px bg-primary-solid" /> : null}
            {tab.onClose == null ? null : (
              <button
                type="button"
                aria-label={tab.closeLabel}
                className={clsx("cursor-interaction text-tertiary hover:text-default", v.closeButtonClassName)}
                onClick={tab.onClose}
              >
                <LegacySharedDbi838cIcon className="icon-2xs" />
              </button>
            )}
            {v.segmentedEdges && !last ? <div className="h-full w-px self-stretch bg-border" /> : null}
          </div>
        );
      })}
    </div>
  );
}
