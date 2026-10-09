import clsx from "clsx";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import { DropdownMenu as RadixDropdownMenu } from "radix-ui";
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type AriaAttributes,
  type ComponentProps,
  type ComponentType,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { CheckmarkMdLight16Icon } from "../icons/checkmark-md-light-16";
import { ChevronRightMdLight16Icon } from "../icons/chevron-right-md-light-16";
import { Icon } from "../icons/icon";
import type { IconAsset } from "../icons/icon-asset";
import { LegacySharedFvi2dd2Icon } from "../icons/legacy-shared-fvi-2dd2";
import { LegacySharedSvi9324Icon } from "../icons/legacy-shared-svi-9324";
import { LegacySharedT7A513Icon } from "../icons/legacy-shared-t7-a513";
import { MagnifyingGlassLgLight16Icon } from "../icons/magnifying-glass-lg-light-16";
import { AdaptiveIcon } from "./adaptive-icon";
import { composeRefs } from "./compose-refs";
import { OverlayOwnerContext, dismissTooltips, useWindowZoom } from "./overlay-context";
import { Portal } from "./portal";
import { ScrollArea } from "./scroll-area";
import { SwitchIndicator } from "./switch-indicator";
import { Tooltip, type TooltipAlign, type TooltipColor, type TooltipOpenWhen, type TooltipSide } from "./tooltip";
import { getPortalRoot } from "./portal-root";

/** CSS-module classes of the Codex menu (`CC` in the bundles). */
export const menuClasses = {
  leadingIcon: "_leadingIcon_1xk2n_2",
  singleLineRows: "_singleLineRows_1xk2n_2",
  miniIcon: "_miniIcon_1xk2n_2",
  hintRow: "_hintRow_1xk2n_2",
  glassSurface: "_glassSurface_1xk2n_2",
  comboboxRow: "_comboboxRow_1xk2n_2",
  suggestionMenu: "_suggestionMenu_1xk2n_2",
  sectionLabel: "_sectionLabel_1xk2n_2",
  largeRows: "_largeRows_1xk2n_2",
  selectRows: "_selectRows_1xk2n_2",
  insetRows: "_insetRows_1xk2n_2",
  descriptiveRows: "_descriptiveRows_1xk2n_2",
  actionRows: "_actionRows_1xk2n_2",
} as const;

const sectionCss = {
  replacedContent: "_replacedContent_1ebbz_1",
  parentBottomAlignedContent: "_parentBottomAlignedContent_1ebbz_5",
  scrollSection: "_scrollSection_1ebbz_12",
  fixedSection: "_fixedSection_1ebbz_26",
} as const;

const itemClasses = {
  content: "flex w-full items-center gap-[var(--spacing-menu-item-content,calc(var(--spacing)*1.5))]",
  icon: "shrink-0 opacity-75 group-focus:opacity-100 group-hover:opacity-100",
  itemBase:
    "outline-hidden flex min-h-[var(--app-menu-item-height,0px)] shrink-0 items-center justify-center p-[var(--app-menu-item-padding,var(--padding-row-y)_var(--padding-row-x))] text-(length:--app-menu-item-font-size,var(--text-sm)) leading-(--app-menu-item-line-height,var(--text-sm--line-height))",
  itemInteractive: "group hover:bg-primary-ghost-hover focus:bg-primary-ghost-hover cursor-interaction",
} as const;

const itemIconSizeClasses = {
  xs: "icon-xs",
  sm: "icon-sm",
  base: "icon-base",
  md: "icon-md",
} as const;

export const menuContentWidthClasses = {
  icon: "min-w-[120px]",
  xs: "min-w-[160px]",
  sm: "min-w-[180px]",
  menuNarrow: "w-52",
  menu: "min-w-[var(--app-menu-min-width,220px)]",
  menuFixed: "w-[220px]",
  menuBounded: "min-w-[200px] max-w-[320px]",
  menuWide: "w-[240px]",
  railMenu: "w-57",
  sidebar: "min-w-[172px] max-w-[240px]",
  workspace: "min-w-[260px]",
  panel: "w-[280px]",
  panelWide: "w-[360px]",
  panelExtraWide: "w-[408px]",
} as const;

const menuMaxHeights = {
  available: "calc(100vh - 16px)",
  compact: "200px",
  list: "250px",
  tall: "350px",
  composerPlugins: "var(--height-composer-plugins-menu, 250px)",
} as const;

/** Default size limits of dropdown menu content. */
export const menuContentLimits = {
  maxWidth: "min(var(--radix-dropdown-menu-content-available-width), calc(100vw - 16px))",
  maxHeight: "min(var(--radix-dropdown-menu-content-available-height), calc(100vh - 16px))",
} as const;

export const MENU_HOVER_OPEN_DELAY_MS = 200;
export const MENU_HOVER_CLOSE_DELAY_MS = 100;

const submenuTransition: Transition = { duration: 300 / 1000, ease: [0.19, 1, 0.22, 1] };

export type MenuSurface = "menu" | "glass" | "chatgpt" | "opaque" | "panel";
export type MenuContentWidth = keyof typeof menuContentWidthClasses;
export type MenuContentMaxHeight = keyof typeof menuMaxHeights;

/** Surface classes of menu content (`EC` in the bundles). */
export function menuSurfaceClassName(surface: MenuSurface) {
  if (surface === "chatgpt") return "min-w-40 bg-surface-elevated-secondary text-default rounded-3xl py-2.5 shadow-(--shadow-dropdown-overlay)";
  const base =
    surface === "opaque"
      ? "bg-surface-elevated-secondary text-default shadow-(--shadow-dropdown-overlay)"
      : "bg-surface-elevated-secondary/90 text-default ring-(--color-border-overlay) ring-(length:--dropdown-overlay-ring-width) shadow-(--shadow-dropdown-overlay) backdrop-blur-sm";
  if (surface === "panel") return `${base} rounded-2xl p-4 shadow-2xl backdrop-blur-lg`;
  return `${base} rounded-2xl p-[var(--app-menu-gutter,var(--spacing))]`;
}

/** `DC` in the bundles. */
export function menuContentWidthClassName(width: MenuContentWidth | undefined) {
  return width == null ? undefined : menuContentWidthClasses[width];
}

/** `wC` in the bundles. */
export function menuContentMaxHeight(height: MenuContentMaxHeight | undefined, available: string) {
  return height == null ? undefined : `min(${menuMaxHeights[height]}, ${available}, calc(100vh - 16px))`;
}

/** Side forced by an ancestor `[data-dropdown-overlay-side]` (`TC` in the bundles). */
export function dropdownOverlaySide(element: Element | null) {
  const side = element?.closest("[data-dropdown-overlay-side]")?.getAttribute("data-dropdown-overlay-side");
  return side === "bottom" || side === "top" ? side : undefined;
}

export interface MenuOpenStateOptions {
  disabled?: boolean;
  dismissOnWindowBlur?: boolean;
}

/** Controlled/uncontrolled open state of Codex menus (`kC` in the bundles); opening dismisses tooltips. */
export function useMenuOpenState(
  open: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
  { disabled = false, dismissOnWindowBlur = true }: MenuOpenStateOptions = {},
) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  if (disabled && uncontrolledOpen) setUncontrolledOpen(false);
  const isOpen = !disabled && (open ?? uncontrolledOpen);
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (disabled && next) return;
      if (next) dismissTooltips();
      if (open === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [disabled, onOpenChange, open],
  );
  const dismiss = useEffectEvent(() => handleOpenChange(false));
  useEffect(() => {
    if (!isOpen || !dismissOnWindowBlur) return;
    const handleBlur = () => dismiss();
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [dismissOnWindowBlur, isOpen]);
  return { handleOpenChange, open: isOpen };
}

const MENU_ITEM_ROLES = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

function enabledItemsAfter(element: Element) {
  const menu = element.closest('[role="menu"]');
  if (menu == null) return [];
  const candidates = Array.from(menu.querySelectorAll<HTMLElement>(`input, ${MENU_ITEM_ROLES}`));
  return candidates.slice(candidates.indexOf(element as HTMLElement) + 1).filter((candidate) => {
    const role = candidate.getAttribute("role");
    return (
      (role === "menuitem" || role === "menuitemcheckbox" || role === "menuitemradio") &&
      !candidate.hasAttribute("data-disabled") &&
      candidate.getAttribute("aria-disabled") !== "true"
    );
  });
}

/** Focuses the first (`next`) or last (`previous`) enabled menu item after `element`; returns whether one was found. */
export function focusMenuItem(element: Element, direction: "next" | "previous") {
  const items = enabledItemsAfter(element);
  const target = direction === "next" ? items[0] : items[items.length - 1];
  target?.focus();
  return target != null;
}

const MenuPortalHostContext = createContext<HTMLElement | null | undefined>(undefined);

export interface MenuPortalProps {
  children?: ReactNode;
  container?: HTMLElement;
}

/** Portals menu content and exposes its host element to nested flyout submenus. */
export function MenuPortal({ children, container }: MenuPortalProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <MenuPortalHostContext.Provider value={container == null ? host : undefined}>
      <RadixDropdownMenu.Portal container={container ?? getPortalRoot()}>
        <Portal container={container ?? getPortalRoot()}>
          {container == null ? (
            <div ref={setHost} className="contents">
              {children}
            </div>
          ) : (
            children
          )}
        </Portal>
      </RadixDropdownMenu.Portal>
    </MenuPortalHostContext.Provider>
  );
}

export type MenuTriggerProps = ComponentProps<typeof RadixDropdownMenu.Trigger>;

export function MenuTrigger({ ref, disabled, className, ...rest }: MenuTriggerProps) {
  return (
    <RadixDropdownMenu.Trigger
      ref={ref}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      className={clsx("outline-hidden", disabled ? "cursor-default opacity-25" : "cursor-interaction", className)}
      {...rest}
    />
  );
}

export type MenuContentSize = "default" | "large" | "descriptive" | "select" | "inset" | "action";

export interface MenuContentProps extends ComponentProps<typeof RadixDropdownMenu.Content> {
  /** Forwarded to Radix's focus scope at runtime although Radix's dropdown types omit it. */
  onOpenAutoFocus?: (event: Event) => void;
  maxWidth?: "default" | "wide";
  size?: MenuContentSize;
  rowLayout?: "single-line";
  surface?: MenuSurface;
  variant?: "default" | "picker";
  scrollFade?: boolean;
  scrollPeek?: boolean;
}

export function MenuContent({
  children,
  className,
  align,
  maxWidth = "default",
  onKeyDownCapture,
  sideOffset = 1,
  size = "default",
  rowLayout,
  surface = "menu",
  variant = "default",
  scrollFade = false,
  scrollPeek = false,
  ref,
  style,
  ...rest
}: MenuContentProps) {
  const overlayOwner = useContext(OverlayOwnerContext);
  let resolvedMaxWidth: string = menuContentLimits.maxWidth;
  if (maxWidth === "wide") resolvedMaxWidth = "min(var(--container-sm), var(--radix-dropdown-menu-content-available-width), calc(100vw - 16px))";
  else if (surface === "chatgpt") resolvedMaxWidth = "min(var(--container-xs), var(--radix-dropdown-menu-content-available-width), calc(100vw - 16px))";
  const scrolls = scrollFade || scrollPeek;
  return (
    <RadixDropdownMenu.Content
      ref={ref}
      data-overlay-owner={overlayOwner?.id}
      className={clsx(
        "ws-menu no-drag z-50 m-px flex select-none flex-col",
        scrolls ? "overflow-hidden" : "overflow-y-auto",
        variant === "picker" ? "w-65 [--app-menu-gutter:0px]" : surface === "panel" && "px-1 py-1",
        menuSurfaceClassName(surface),
        surface === "glass" && menuClasses.glassSurface,
        size === "large" && menuClasses.largeRows,
        rowLayout === "single-line" && menuClasses.singleLineRows,
        size === "descriptive" && menuClasses.descriptiveRows,
        size === "select" && menuClasses.selectRows,
        size === "inset" && menuClasses.insetRows,
        size === "action" && menuClasses.actionRows,
        className,
      )}
      align={align ?? "start"}
      collisionPadding={6}
      onKeyDownCapture={(event) => {
        onKeyDownCapture?.(event);
        if (event.defaultPrevented || (event.key !== "ArrowUp" && !(event.key === "Tab" && event.shiftKey))) return;
        const input = event.currentTarget.querySelector("input");
        const firstItem = input == null ? undefined : enabledItemsAfter(input)[0];
        if (event.target instanceof HTMLElement && event.target.closest(MENU_ITEM_ROLES) === firstItem) {
          input?.focus();
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      sideOffset={sideOffset}
      style={{ ...menuContentLimits, maxWidth: resolvedMaxWidth, ...style }}
      {...rest}
    >
      {scrollPeek ? (
        <div className="relative flex min-h-0 flex-col">
          <div className="min-h-0 overflow-y-auto">{children}</div>
        </div>
      ) : scrollFade ? (
        <ScrollArea className="relative flex min-h-0 flex-col" fade="overlay" scrollClassName="min-h-0 overflow-y-auto" fadeClassName="inset-x-0">
          {children}
        </ScrollArea>
      ) : (
        children
      )}
    </RadixDropdownMenu.Content>
  );
}

/** Leading icon slot of a menu row (`bC` in the bundles). */
export function MenuLeadingIcon({ children }: { children?: ReactNode }) {
  return <span className={menuClasses.leadingIcon}>{children}</span>;
}

type MenuIconComponent = ComponentType<{ className?: string }>;
type MenuTextOverflow = "ellipsis" | "fade";

export interface MenuRowContentProps {
  children?: ReactNode;
  LeftIcon?: MenuIconComponent;
  leftIcon?: ReactNode;
  iconSize?: 16 | 20;
  trailingContent?: ReactNode;
  allowWrap?: boolean;
  textOverflow?: MenuTextOverflow;
  tooltipOverflowTarget?: boolean;
}

/** Icon + label + trailing row layout (`yC` in the bundles). */
export function MenuRowContent({
  children,
  LeftIcon,
  leftIcon,
  iconSize = 16,
  trailingContent,
  allowWrap = false,
  textOverflow = "ellipsis",
  tooltipOverflowTarget = false,
}: MenuRowContentProps) {
  const icon = leftIcon ?? (LeftIcon ? <LeftIcon className={clsx("shrink-0", iconSize === 20 ? "size-5" : "icon-xs")} /> : null);
  return (
    <div data-menu-row-content className="flex w-full min-w-0 items-center gap-[var(--spacing-menu-item-content,calc(var(--spacing)*1.5))]">
      {icon == null ? null : <MenuLeadingIcon>{icon}</MenuLeadingIcon>}
      <span
        data-tooltip-overflow-target={tooltipOverflowTarget ? "" : undefined}
        className={clsx("flex-1 min-w-0", allowWrap && "whitespace-normal", !allowWrap && (textOverflow === "fade" ? "text-fade-truncate" : "truncate"))}
      >
        {children}
      </span>
      {trailingContent}
    </div>
  );
}

export interface MenuItemTooltipOptions {
  tooltipText?: ReactNode;
  tooltipDisabled?: boolean;
  tooltipTextClassName?: string;
  tooltipInteractive?: boolean;
  tooltipSide?: TooltipSide;
  tooltipSideOffset?: number;
  tooltipAlign?: TooltipAlign;
  tooltipOpenWhen?: TooltipOpenWhen;
}

function MenuItemTooltip({
  children,
  color = "default",
  tooltipText,
  tooltipDisabled,
  tooltipTextClassName,
  tooltipInteractive,
  tooltipSide,
  tooltipSideOffset,
  tooltipAlign,
  tooltipOpenWhen,
}: MenuItemTooltipOptions & { children: ReactNode; color?: TooltipColor }) {
  if (!tooltipText) return <>{children}</>;
  return (
    <Tooltip
      cloneCustomTrigger
      color={color}
      disabled={tooltipDisabled}
      tooltipContent={<div className={clsx("max-w-64 text-pretty", tooltipTextClassName)}>{tooltipText}</div>}
      closeOnTriggerBlur={!tooltipInteractive}
      interactive={tooltipInteractive}
      side={tooltipSide ?? "right"}
      sideOffset={tooltipSideOffset ?? (color === "surface" ? 12 : undefined)}
      align={tooltipAlign}
      openWhen={tooltipOpenWhen}
    >
      {children}
    </Tooltip>
  );
}

function preventDefault(event: { preventDefault(): void }) {
  event.preventDefault();
}

function splitLeadingItemIcon(children: ReactNode) {
  const items = Children.toArray(children);
  const icon = isValidElement(items[0]) && items[0].type === MenuItemIcon ? items[0] : null;
  return { icon, rest: icon ? items.slice(1) : children };
}

export type MenuItemTone = "default" | "danger" | "destructive" | "warning";
export type MenuItemVariant = "default" | "hint" | "label" | "display" | "detail" | "unstyled";

type RadixItemProps = ComponentProps<typeof RadixDropdownMenu.Item>;

export interface MenuItemProps extends MenuItemTooltipOptions, Omit<RadixItemProps, "asChild" | "children" | "disabled" | "onClick" | "onSelect"> {
  /** Renders the single child element (e.g. a router link) as the row. */
  asChild?: boolean;
  children?: ReactNode;
  LeftIcon?: MenuIconComponent;
  leftIconAsset?: IconAsset;
  leftIcon?: ReactNode;
  leftIconClassName?: string;
  RightIcon?: MenuIconComponent;
  rightIconAsset?: IconAsset;
  rightIcon?: ReactNode;
  rightIconClassName?: string;
  rightText?: ReactNode;
  keyboardShortcut?: ReactNode;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onSelect?: (event: Event) => void;
  isActive?: boolean;
  disabled?: boolean;
  focusableWhenDisabled?: boolean;
  href?: string;
  SubText?: ReactNode;
  tone?: MenuItemTone;
  variant?: MenuItemVariant;
  allowWrap?: boolean;
  subTextAllowWrap?: boolean;
  textOverflow?: MenuTextOverflow;
}

interface MenuItemChildProps {
  href?: string;
  className?: string;
  children?: ReactNode;
  onClick?: (event: MouseEvent) => void;
  onAuxClick?: (event: MouseEvent) => void;
}

/** Menu row (`dC` in the bundles), a Radix dropdown item. */
export function MenuItem({
  asChild,
  children,
  LeftIcon,
  leftIconAsset,
  keyboardShortcut,
  leftIcon: leftIconProp,
  leftIconClassName,
  RightIcon,
  rightIconAsset,
  rightIcon: rightIconProp,
  rightIconClassName,
  rightText,
  className,
  onClick,
  onSelect,
  isActive = false,
  disabled,
  focusableWhenDisabled = false,
  href,
  SubText,
  tooltipText,
  tooltipDisabled,
  tooltipTextClassName,
  tooltipInteractive,
  tooltipSide,
  tooltipSideOffset,
  tooltipAlign,
  tooltipOpenWhen,
  tone = "default",
  variant = "default",
  allowWrap = false,
  subTextAllowWrap = false,
  textOverflow = "ellipsis",
  ...rest
}: MenuItemProps) {
  const danger = tone === "danger" || tone === "destructive";
  const child = asChild && isValidElement<MenuItemChildProps>(children) ? (children as ReactElement<MenuItemChildProps>) : null;
  const resolvedHref = child?.props.href ?? href;
  const selectableWhenDisabled = !!disabled && focusableWhenDisabled;
  const display = variant === "display";
  const surfaceTooltip = display || variant === "detail";
  const interactive = variant !== "label" && !display && !disabled && (!!resolvedHref || !!onClick || !!onSelect);
  const { icon: itemIcon, rest: label } = splitLeadingItemIcon(child == null ? children : child.props.children);

  const leftIcon =
    leftIconProp ??
    itemIcon ??
    (leftIconAsset ? <Icon className={clsx(leftIconClassName, itemClasses.icon)} aria-hidden={false} asset={leftIconAsset} /> : null) ??
    (LeftIcon ? <LeftIcon className={clsx(leftIconClassName ?? (SubText == null ? "icon-xs" : "icon-sm"), itemClasses.icon)} /> : null);
  const rightIcon =
    rightIconProp ??
    (rightIconAsset ? <Icon className={clsx(rightIconClassName, itemClasses.icon)} aria-hidden={false} asset={rightIconAsset} /> : null) ??
    (RightIcon ? <RightIcon className={clsx(rightIconClassName ?? "icon-xs", itemClasses.icon)} /> : null);
  const trailingContent =
    keyboardShortcut || rightIcon || rightText != null ? (
      <>
        {keyboardShortcut ? <span className="ms-2 shrink-0 text-xs text-codex-description">{keyboardShortcut}</span> : null}
        {rightText == null ? null : <span className={clsx("shrink-0", !rightIcon && "pe-1")}>{rightText}</span>}
        {rightIcon}
      </>
    ) : null;
  const overflowTarget = tooltipOpenWhen === "trigger-overflows" ? "" : undefined;

  const rowContent =
    SubText == null ? (
      <MenuRowContent
        allowWrap={allowWrap}
        leftIcon={leftIcon}
        textOverflow={textOverflow}
        tooltipOverflowTarget={tooltipOpenWhen === "trigger-overflows"}
        trailingContent={trailingContent}
      >
        {label}
      </MenuRowContent>
    ) : (
      <div data-menu-row-content className={itemClasses.content}>
        {leftIcon == null ? null : <span className={menuClasses.leadingIcon}>{leftIcon}</span>}
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            data-tooltip-overflow-target={overflowTarget}
            className={clsx("min-w-0", allowWrap && "whitespace-normal", !allowWrap && (textOverflow === "fade" ? "text-fade-truncate" : "truncate"))}
          >
            {label}
          </span>
          <span className={clsx("min-w-0 text-xs leading-dense text-tertiary", subTextAllowWrap ? "whitespace-normal" : "truncate")}>{SubText}</span>
        </div>
        {trailingContent}
      </div>
    );

  const linkLike = variant === "default" && !!resolvedHref;
  const rowClassName = clsx(
    child?.props.className,
    linkLike && "focus:!outline-none",
    linkLike && [danger && "!text-danger", tone === "warning" && "!text-warning", tone === "default" && "!text-default"],
    (variant === "default" || variant === "hint") && "flex flex-col",
  );

  const row =
    child == null ? (
      resolvedHref ? (
        <a href={resolvedHref} className={rowClassName}>
          {rowContent}
        </a>
      ) : (
        <div className={rowClassName}>{rowContent}</div>
      )
    ) : (
      cloneElement(child, {
        className: rowClassName,
        children: rowContent,
        onClick: disabled || display ? preventDefault : child.props.onClick,
        onAuxClick: disabled || display ? preventDefault : child.props.onAuxClick,
      })
    );

  return (
    <MenuItemTooltip
      color={surfaceTooltip ? "surface" : "default"}
      tooltipText={tooltipText}
      tooltipDisabled={tooltipDisabled}
      tooltipTextClassName={tooltipTextClassName}
      tooltipInteractive={tooltipInteractive}
      tooltipSide={tooltipSide}
      tooltipSideOffset={tooltipSideOffset}
      tooltipAlign={tooltipAlign}
      tooltipOpenWhen={tooltipOpenWhen}
    >
      <RadixDropdownMenu.Item
        asChild
        className={clsx(
          "no-drag",
          variant !== "unstyled" && [itemClasses.itemBase, surfaceTooltip ? "rounded-md" : "rounded-xl"],
          variant === "label" && "cursor-default select-text text-codex-description",
          surfaceTooltip && [
            "select-none text-default",
            interactive ? "cursor-interaction" : "cursor-default",
            !disabled && "hover:bg-primary-ghost-hover focus:bg-primary-ghost-hover",
          ],
          (variant === "default" || variant === "hint") && [
            danger && "text-danger",
            tone === "warning" && "text-warning",
            tone === "default" && (variant === "hint" ? "text-tertiary" : "text-default"),
            isActive && "bg-primary-ghost-hover",
            disabled
              ? "cursor-default opacity-50"
              : interactive &&
                  (tone === "destructive"
                    ? "group hover:bg-danger-soft-alpha focus:bg-danger-soft-alpha cursor-interaction"
                    : itemClasses.itemInteractive),
          ],
          variant === "hint" && [menuClasses.hintRow, "select-none"],
          variant === "unstyled" && (disabled ? "cursor-default" : interactive && "group cursor-interaction"),
          className,
        )}
        aria-current={isActive ? "true" : undefined}
        aria-disabled={disabled || display || undefined}
        onClick={(event) => {
          if (display) {
            event.preventDefault();
            return;
          }
          if (!disabled) onClick?.(event);
        }}
        onSelect={selectableWhenDisabled || variant === "label" || display ? preventDefault : disabled ? undefined : onSelect}
        disabled={disabled && !focusableWhenDisabled}
        {...rest}
      >
        {row}
      </RadixDropdownMenu.Item>
    </MenuItemTooltip>
  );
}

export interface MenuCheckboxItemProps extends Omit<ComponentProps<typeof RadixDropdownMenu.CheckboxItem>, "children" | "asChild"> {
  children?: ReactNode;
  /** Keeps the menu open after toggling unless set. */
  closeOnSelect?: boolean;
  href?: string;
  indicator?: "checkmark" | "switch";
  leftIcon?: ReactNode;
  SubText?: ReactNode;
}

/** `lC` in the bundles. */
export function MenuCheckboxItem({
  children,
  closeOnSelect = false,
  checked,
  className,
  disabled,
  href,
  indicator = "checkmark",
  leftIcon,
  onSelect,
  SubText,
  ...rest
}: MenuCheckboxItemProps) {
  const { icon: itemIcon, rest: label } = splitLeadingItemIcon(children);
  const content = (
    <div data-menu-row-content className={itemClasses.content}>
      {leftIcon != null || itemIcon != null ? <span className={menuClasses.leadingIcon}>{leftIcon ?? itemIcon}</span> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {SubText == null ? null : <span className="text-xs leading-dense whitespace-normal text-tertiary">{SubText}</span>}
      </div>
      {indicator === "switch" ? (
        <SwitchIndicator checked={checked === true} size="sm" />
      ) : (
        <RadixDropdownMenu.ItemIndicator>
          <LegacySharedT7A513Icon className="icon-xs" />
        </RadixDropdownMenu.ItemIndicator>
      )}
    </div>
  );
  return (
    <RadixDropdownMenu.CheckboxItem
      asChild={href != null}
      className={clsx(
        "no-drag flex flex-col",
        itemClasses.itemBase,
        "rounded-xl text-default",
        href != null && "focus:!outline-none !text-default",
        disabled ? "cursor-default opacity-50" : itemClasses.itemInteractive,
        className,
      )}
      checked={checked}
      disabled={disabled}
      onSelect={(event) => {
        if (href == null && !closeOnSelect) event.preventDefault();
        onSelect?.(event);
      }}
      {...rest}
    >
      {href == null ? (
        content
      ) : (
        <a href={href} onAuxClick={disabled ? preventDefault : undefined} onClick={disabled ? preventDefault : undefined}>
          {content}
        </a>
      )}
    </RadixDropdownMenu.CheckboxItem>
  );
}

export type MenuRadioItemVariant = "default" | "icon" | "swatch" | "chatgpt" | "descriptive";

export interface MenuRadioItemProps extends Omit<ComponentProps<typeof RadixDropdownMenu.RadioItem>, "children"> {
  children?: ReactNode;
  href?: string;
  icon?: ReactNode;
  SubText?: ReactNode;
  variant?: MenuRadioItemVariant;
}

export function MenuRadioItem({ asChild, children, className, disabled, href, icon, SubText, variant = "default", ...rest }: MenuRadioItemProps) {
  const iconOnly = variant === "icon" || variant === "swatch";
  const chatgpt = variant === "chatgpt";
  const row = iconOnly ? (
    children
  ) : (
    <div className={chatgpt ? "flex items-center gap-1.5" : itemClasses.content}>
      {icon}
      <div className={clsx("flex min-w-0 flex-1 flex-col", variant === "default" && "gap-1")}>
        <span className={clsx("whitespace-normal", variant === "default" && "font-medium")}>{children}</span>
        {SubText != null && variant !== "descriptive" ? (
          <span className={clsx("text-xs whitespace-normal", chatgpt ? "leading-4 text-secondary" : "leading-dense text-tertiary")}>{SubText}</span>
        ) : null}
      </div>
      <span className={chatgpt ? "size-4 shrink-0" : "icon-sm shrink-0"}>
        <RadixDropdownMenu.ItemIndicator>{chatgpt ? <CheckmarkMdLight16Icon /> : <LegacySharedT7A513Icon className="icon-sm" />}</RadixDropdownMenu.ItemIndicator>
      </span>
    </div>
  );
  const content =
    variant === "descriptive" ? (
      <div className="flex w-full min-w-0 flex-col gap-1">
        {row}
        {SubText != null && <span className="text-xs leading-dense whitespace-normal text-tertiary">{SubText}</span>}
      </div>
    ) : (
      row
    );
  return (
    <RadixDropdownMenu.RadioItem
      className={clsx(
        iconOnly
          ? [
              "no-drag flex size-9 items-center justify-center rounded-full p-0 text-default outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              disabled ? "cursor-default opacity-50" : "cursor-interaction",
              variant === "icon" &&
                "data-highlighted:bg-primary-ghost-hover data-[state=checked]:bg-primary-ghost-hover data-[state=checked]:ring-1 data-[state=checked]:ring-border",
            ]
          : [
              "no-drag",
              chatgpt ? "mx-1.5 rounded-lg px-2.5 py-2 text-sm leading-5 outline-none" : [itemClasses.itemBase, "rounded-xl"],
              "text-default",
              disabled && "cursor-default opacity-50",
              !disabled && (chatgpt ? "cursor-interaction data-[highlighted]:bg-primary-ghost-hover" : itemClasses.itemInteractive),
            ],
        className,
      )}
      disabled={disabled}
      {...rest}
      asChild={href != null || asChild}
    >
      {href == null ? (
        content
      ) : (
        <a href={href} onAuxClick={disabled ? preventDefault : undefined} onClick={disabled ? preventDefault : undefined}>
          {content}
        </a>
      )}
    </RadixDropdownMenu.RadioItem>
  );
}

export interface MenuItemIconProps {
  children?: ReactNode;
  className?: string;
  size?: keyof typeof itemIconSizeClasses;
}

/** Icon wrapper; as the first child of a menu item it becomes the item's leading icon. */
export function MenuItemIcon({ children, className, size = "sm" }: MenuItemIconProps) {
  return <span className={clsx("inline-flex items-center justify-center leading-none", itemIconSizeClasses[size], itemClasses.icon, className)}>{children}</span>;
}

export type MenuInputProps = ComponentProps<"input">;

/** Autofocused text input inside a menu (`uC` in the bundles); keystrokes don't reach Radix typeahead. */
export function MenuInput({ onKeyDown, className, ...rest }: MenuInputProps) {
  return (
    <input
      className={clsx("w-full min-w-0 rounded-sm border border-none px-row-x py-row-y text-sm !outline-none", className)}
      autoFocus
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
          event.preventDefault();
          event.currentTarget.select();
          return;
        }
        onKeyDown?.(event);
      }}
      {...rest}
    />
  );
}

export interface MenuSearchInputProps extends MenuInputProps {
  inputClassName?: string;
  sticky?: boolean;
  trailingContent?: ReactNode;
  variant?: "default" | "inset";
}

export function MenuSearchInput({ className, inputClassName, onKeyDown, sticky = false, trailingContent, variant = "default", ...rest }: MenuSearchInputProps) {
  const field = (
    <div
      className={clsx(
        itemClasses.content,
        "p-[var(--app-menu-item-padding,var(--padding-row-y)_var(--padding-row-x))]",
        variant === "inset" && "m-2 !w-auto rounded-lg border border-primary-outline",
        className,
      )}
    >
      <MenuLeadingIcon>
        <AdaptiveIcon className="text-tertiary" icon16={MagnifyingGlassLgLight16Icon} legacyIcon={LegacySharedFvi2dd2Icon} />
      </MenuLeadingIcon>
      <MenuInput
        className={clsx("!w-auto flex-1 appearance-none !rounded-none !border-none bg-transparent !px-0 !py-0 text-default placeholder:text-tertiary", inputClassName)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (
            !event.defaultPrevented &&
            (event.key === "ArrowDown" || event.key === "ArrowUp") &&
            focusMenuItem(event.currentTarget, event.key === "ArrowDown" ? "next" : "previous")
          ) {
            event.preventDefault();
          }
        }}
        {...rest}
      />
      {trailingContent ? <div className="shrink-0">{trailingContent}</div> : null}
    </div>
  );
  if (!sticky) return field;
  return (
    <div className="sticky top-0 z-10 -mx-1 -mt-1 bg-surface-elevated-secondary p-1 before:pointer-events-none before:absolute before:inset-x-0 before:-top-1 before:h-1 before:bg-surface-elevated-secondary before:content-['']">
      {field}
    </div>
  );
}

export interface MenuSeparatorProps {
  className?: string;
  paddingClassName?: string;
  variant?: "default" | "chatgpt";
}

/** `fC` in the bundles. */
export function MenuSeparator({ className, paddingClassName = "py-[var(--app-menu-separator-gutter,var(--spacing))]", variant = "default" }: MenuSeparatorProps) {
  return (
    <div className={clsx("w-full", variant === "chatgpt" ? "px-4 py-1" : ["px-[var(--app-menu-separator-inset,var(--padding-row-x))]", paddingClassName], className)}>
      <div className={clsx("h-px w-full", variant === "chatgpt" ? "bg-border-subtle" : "bg-border")} />
    </div>
  );
}

export function MenuSectionLabel({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div data-menu-section-label className={clsx(menuClasses.sectionLabel, className)}>
      {children}
    </div>
  );
}

export interface MenuMessageProps {
  children?: ReactNode;
  className?: string;
  tone?: "muted" | "error" | "default";
  compact?: boolean;
  centered?: boolean;
  role?: string;
  variant?: "default" | "inset" | "chatgpt";
}

/** Non-interactive message row (empty states, errors). */
export function MenuMessage({ children, className, tone = "muted", compact = false, centered = false, role, variant = "default" }: MenuMessageProps) {
  return (
    <div
      role={role}
      className={clsx(
        variant === "inset" && "m-1 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-default p-3 text-center text-sm",
        variant === "chatgpt" && "mx-1.5 px-2.5 py-2.5 text-xs leading-4",
        variant === "default" && ["px-row-x text-sm", compact ? "py-2" : "py-3"],
        tone === "error" && "text-danger",
        tone === "muted" && (variant === "chatgpt" ? "text-tertiary" : "text-codex-description"),
        centered && "self-center text-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MenuTitle({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={clsx("text-codex-description flex min-h-6 items-center truncate px-row-x py-row-y text-sm leading-4", className)}>{children}</div>;
}

export function MenuGroup({ children }: { children?: ReactNode }) {
  return (
    <RadixDropdownMenu.Group className="before:mx-4 before:my-1 before:block before:h-px before:bg-border first:before:hidden empty:hidden [:not(:has(div:not([role=group])))]:hidden [&:nth-child(1_of_:has(div:not([role=group])))]:before:hidden">
      {children}
    </RadixDropdownMenu.Group>
  );
}

export interface MenuSectionProps {
  children?: ReactNode;
  className?: string;
  /** Any size makes the section scroll; `five-rows` also fixes its height. */
  size?: "five-rows" | (string & {});
}

export function MenuSection({ children, className, size }: MenuSectionProps) {
  return (
    <div
      className={clsx(
        size != null && "flex min-h-0 flex-col overflow-y-auto text-sm",
        size != null && sectionCss.scrollSection,
        size === "five-rows" && sectionCss.fixedSection,
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface MenuSubmenuItemProps {
  trigger: ReactElement<MenuItemProps>;
  children?: ReactNode;
  isDefaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Inline (accordion) submenu (`sC` in the bundles): selecting `trigger` expands `children` below it. */
export function MenuSubmenuItem({ trigger, children, isDefaultOpen = false, onOpenChange }: MenuSubmenuItemProps) {
  const disabled = trigger.props.disabled ?? false;
  const [expanded, setExpanded] = useState(!disabled && isDefaultOpen);
  const open = expanded && !disabled;
  const triggerItem = cloneElement(trigger, {
    onSelect: (event: Event) => {
      trigger.props.onSelect?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      if (!disabled) {
        setExpanded(!open);
        onOpenChange?.(!open);
      }
    },
    rightIcon: (
      <span aria-hidden className={clsx("inline-flex items-center justify-center text-tertiary", open && "rotate-90")}>
        <LegacySharedSvi9324Icon className={clsx(trigger.props.rightIconClassName ?? "icon-xs", itemClasses.icon)} />
      </span>
    ),
  });
  return (
    <div className="flex flex-col" data-state={open ? "open" : "closed"}>
      {triggerItem}
      <div className={open ? undefined : "pointer-events-none invisible h-0 overflow-hidden"}>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="dropdown-submenu"
              initial={false}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={submenuTransition}
              className="overflow-hidden"
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export interface MenuFlyoutSubmenuItemProps extends MenuItemTooltipOptions {
  ref?: Ref<HTMLDivElement>;
  "aria-current"?: AriaAttributes["aria-current"];
  ariaLabel?: string;
  label?: ReactNode;
  allowWrap?: boolean;
  children?: ReactNode;
  LeftIcon?: MenuIconComponent;
  leftIcon?: ReactNode;
  leftIconAsset?: IconAsset;
  leftIconClassName?: string;
  className?: string;
  disabled?: boolean;
  /** Radix always aligns sub-content to the start of its trigger, so this has no visual effect. */
  align?: "start" | "center" | "end";
  alignToParentBottom?: boolean;
  contentClassName?: string;
  contentWidth?: MenuContentWidth;
  contentSurface?: MenuSurface | "bare";
  onSelect?: () => void;
  triggerContent?: ReactNode;
  rightIcon?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: "default" | "unstyled";
}

/** Submenu that flies out beside its parent menu; hovering the trigger opens it after 200ms. */
export function MenuFlyoutSubmenuItem({
  ref,
  "aria-current": ariaCurrent,
  ariaLabel,
  label,
  allowWrap = false,
  children,
  LeftIcon,
  leftIcon: leftIconProp,
  leftIconAsset,
  leftIconClassName,
  className,
  disabled = false,
  alignToParentBottom,
  contentClassName,
  contentWidth,
  contentSurface = "menu",
  onSelect,
  triggerContent,
  rightIcon,
  tooltipText,
  tooltipDisabled,
  tooltipTextClassName,
  tooltipSide,
  tooltipSideOffset,
  tooltipAlign,
  tooltipOpenWhen,
  open,
  onOpenChange,
  variant = "default",
}: MenuFlyoutSubmenuItemProps) {
  const portalHost = useContext(MenuPortalHostContext);
  const zoom = useWindowZoom();
  const overlayOwner = useContext(OverlayOwnerContext);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = !disabled && (open ?? uncontrolledOpen);
  const suppressOpen = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keydownListener = useRef<AbortController | null>(null);
  const triggerNode = useRef<HTMLDivElement | null>(null);
  const [alignOffset, setAlignOffset] = useState(0);
  const [sideOffset, setSideOffset] = useState(4);
  const triggerRef = useMemo(() => composeRefs(ref, triggerNode), [ref]);

  const cancelHoverOpen = useCallback(() => {
    if (hoverTimer.current != null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    keydownListener.current?.abort();
    keydownListener.current = null;
  }, []);
  useEffect(() => cancelHoverOpen, [cancelHoverOpen, disabled, isOpen]);

  const handleOpenChange = (next: boolean) => {
    if (next && (disabled || hoverTimer.current != null)) return;
    cancelHoverOpen();
    if (next && suppressOpen.current) {
      suppressOpen.current = false;
      return;
    }
    suppressOpen.current = !next;
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const measureContent = (node: HTMLDivElement | null) => {
    if (node == null) return;
    const style = getComputedStyle(node);
    setAlignOffset(-parseFloat(style.paddingTop) - parseFloat(style.marginTop));
    const trigger = triggerNode.current;
    const menu = trigger?.closest('[role="menu"]');
    if (!alignToParentBottom && trigger != null && menu != null) {
      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      setSideOffset(4 + Math.max(triggerRect.left - menuRect.left, menuRect.right - triggerRect.right, 0) / zoom);
    }
  };

  const scheduleHoverOpen = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || isOpen || event.pointerType !== "mouse") return;
    if (hoverTimer.current == null) {
      const trigger = event.currentTarget;
      const controller = new AbortController();
      keydownListener.current = controller;
      trigger.ownerDocument.addEventListener(
        "keydown",
        () => {
          cancelHoverOpen();
          suppressOpen.current = true;
        },
        { capture: true, signal: controller.signal },
      );
      hoverTimer.current = setTimeout(() => {
        cancelHoverOpen();
        trigger.focus({ preventScroll: true });
        suppressOpen.current = false;
        handleOpenChange(true);
      }, MENU_HOVER_OPEN_DELAY_MS);
    }
    const timer = hoverTimer.current;
    queueMicrotask(() => {
      if (event.defaultPrevented && hoverTimer.current === timer) {
        cancelHoverOpen();
        suppressOpen.current = true;
      }
    });
  };

  const leftIcon =
    leftIconProp ??
    (leftIconAsset ? <Icon className={clsx(leftIconClassName, itemClasses.icon)} aria-hidden={false} asset={leftIconAsset} /> : null) ??
    (LeftIcon ? <LeftIcon className={clsx(leftIconClassName ?? "icon-xs", itemClasses.icon)} /> : null);

  return (
    <RadixDropdownMenu.Sub open={isOpen} onOpenChange={handleOpenChange}>
      <MenuItemTooltip
        tooltipText={tooltipText}
        tooltipDisabled={tooltipDisabled}
        tooltipTextClassName={tooltipTextClassName}
        tooltipSide={tooltipSide}
        tooltipSideOffset={tooltipSideOffset}
        tooltipAlign={tooltipAlign}
        tooltipOpenWhen={tooltipOpenWhen}
      >
        <RadixDropdownMenu.SubTrigger
          ref={triggerRef}
          aria-current={ariaCurrent}
          aria-label={ariaLabel}
          className={clsx(
            variant === "default" ? [itemClasses.itemBase, "flex w-full items-center rounded-xl text-default"] : "no-drag outline-hidden",
            disabled ? "cursor-default opacity-50" : "group cursor-interaction",
            !disabled &&
              variant === "default" &&
              "data-[highlighted]:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover focus-visible:bg-primary-ghost-hover",
            className,
          )}
          disabled={disabled}
          onPointerEnter={scheduleHoverOpen}
          onPointerMove={scheduleHoverOpen}
          onPointerLeave={cancelHoverOpen}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            cancelHoverOpen();
            suppressOpen.current = true;
            const openKey = event.currentTarget.closest('[role="menu"]')?.getAttribute("dir") === "rtl" ? "ArrowLeft" : "ArrowRight";
            if (event.key === openKey || event.key === "Enter" || event.key === " ") {
              if (event.key === " ") {
                queueMicrotask(() => {
                  if (!event.defaultPrevented) suppressOpen.current = true;
                });
              }
              suppressOpen.current = false;
            }
          }}
          onClick={(event) => {
            cancelHoverOpen();
            suppressOpen.current = false;
            if (disabled || onSelect == null) return;
            event.preventDefault();
            event.stopPropagation();
            suppressOpen.current = true;
            onSelect();
          }}
        >
          {triggerContent ?? (
            <div data-menu-row-content className={itemClasses.content}>
              {leftIcon == null ? null : <span className={menuClasses.leadingIcon}>{leftIcon}</span>}
              <span className={clsx("min-w-0 flex-1", allowWrap ? "whitespace-normal" : "truncate")}>{label}</span>
              {rightIcon}
              <ChevronRightMdLight16Icon className="text-tertiary" data-rtl-flip="" />
            </div>
          )}
        </RadixDropdownMenu.SubTrigger>
      </MenuItemTooltip>
      {portalHost !== null && (
        <RadixDropdownMenu.Portal container={portalHost ?? getPortalRoot()}>
          <RadixDropdownMenu.SubContent
            ref={measureContent}
            data-overlay-owner={overlayOwner?.id}
            className={clsx(
              "ws-menu z-50 flex min-w-[180px] select-none flex-col overflow-y-auto",
              contentSurface === "bare" ? "m-0 p-0" : ["m-px", menuSurfaceClassName(contentSurface)],
              menuContentWidthClassName(contentWidth),
              alignToParentBottom && sectionCss.parentBottomAlignedContent,
              contentClassName,
            )}
            collisionPadding={6}
            avoidCollisions={!alignToParentBottom}
            sideOffset={alignToParentBottom || variant === "unstyled" ? 4 : sideOffset}
            alignOffset={alignToParentBottom ? -4 : alignOffset}
            style={{
              ...(alignToParentBottom ? { ...menuContentLimits, maxHeight: "calc(100vh - 16px)" } : menuContentLimits),
              zoom: zoom === 1 ? undefined : zoom,
            }}
          >
            <div>{children}</div>
          </RadixDropdownMenu.SubContent>
        </RadixDropdownMenu.Portal>
      )}
    </RadixDropdownMenu.Sub>
  );
}

/** The Codex menu namespace (`cC` in the bundles). Parts render inside `DropdownMenu` / `ContextMenu` content. */
export const Menu = {
  focusMenuItem,
  Trigger: MenuTrigger,
  Content: MenuContent,
  Item: MenuItem,
  ItemSlot: RadixDropdownMenu.Item,
  CheckboxItem: MenuCheckboxItem,
  RadioGroup: RadixDropdownMenu.RadioGroup,
  RadioItem: MenuRadioItem,
  ItemIcon: MenuItemIcon,
  Input: MenuInput,
  SearchInput: MenuSearchInput,
  Separator: MenuSeparator,
  SectionLabel: MenuSectionLabel,
  Message: MenuMessage,
  Title: MenuTitle,
  SubmenuItem: MenuSubmenuItem,
  FlyoutSubmenuItem: MenuFlyoutSubmenuItem,
  Group: MenuGroup,
  Section: MenuSection,
};
