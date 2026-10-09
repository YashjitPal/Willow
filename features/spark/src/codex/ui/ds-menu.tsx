import clsx from "clsx";
import { DropdownMenu as RadixMenu } from "radix-ui";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { LegacyInitialCboB6faIcon } from "../icons/legacy-initial-cbo-b6fa";
import { LegacySharedCeDad1Icon } from "../icons/legacy-shared-ce-dad1";
import { useEscapeKeyStack } from "./escape-key-stack";
import { ModalPortalContainerContext } from "./modal";
import { TransitionGroup } from "./transition-group";
import { useStableCallback } from "./use-stable-callback";
import { getPortalRoot } from "./portal-root";

const css = {
  Menu: "_Menu_12y2s_2",
  MenuList: "_MenuList_12y2s_2",
  MenuItem: "_MenuItem_12y2s_2",
  MenuItemContent: "_MenuItemContent_12y2s_2",
  PressableInner: "_PressableInner_12y2s_2",
  Separator: "_Separator_12y2s_2",
  SubMenuItem: "_SubMenuItem_12y2s_2",
  SubTriggerIcon: "_SubTriggerIcon_12y2s_2",
  RadioItem: "_RadioItem_12y2s_2",
  RadioIndicator: "_RadioIndicator_12y2s_2",
  RadioIndicatorActive: "_RadioIndicatorActive_12y2s_2",
  CheckmarkIndicator: "_CheckmarkIndicator_12y2s_2",
  CheckboxItem: "_CheckboxItem_12y2s_2",
  CheckboxIndicator: "_CheckboxIndicator_12y2s_2",
  CheckboxCircle: "_CheckboxCircle_12y2s_2",
  SwitchIndicator: "_SwitchIndicator_12y2s_2",
  SwitchThumb: "_SwitchThumb_12y2s_2",
} as const;

/** `menuAnimations` is off in the design-system config (`U$e`), so menus open and close without transitions. */
const MENU_ANIMATIONS = false;

const MENU_COLLISION_PADDING = { bottom: 30, top: 30, left: 12, right: 12 };

function preventDefault(event: Event) {
  event.preventDefault();
}

interface DsMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  compact: boolean;
}

const DsMenuContext = createContext<DsMenuContextValue | null>(null);

function useDsMenuContext() {
  const context = useContext(DsMenuContext);
  if (context == null) throw new Error("Menu components must be wrapped in <Menu />");
  return context;
}

/** Items keep their hover state while the menu animates out. */
function useClosedPointerGuard() {
  const { open } = useDsMenuContext();
  return (event: PointerEvent) => {
    if (!open) event.preventDefault();
  };
}

function cssLength(value: number | string | undefined) {
  return typeof value === "number" ? `${value}px` : value;
}

export interface DsMenuProps {
  children?: ReactNode;
  compact?: boolean;
  forceOpen?: boolean;
  modal?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

/**
 * Design-system dropdown menu (`HR` / `_4` in app-initial): Radix dropdown in a transition group; Escape closes the
 * newest open menu or submenu through the escape-key stack. Not yet: link items and item actions.
 */
function DsMenuRoot({ children, compact = false, forceOpen, modal = false, onOpen, onClose }: DsMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = forceOpen ?? uncontrolledOpen;
  const notify = useStableCallback((next: boolean) => (next ? onOpen?.() : onClose?.()));
  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next);
      notify(next);
    },
    [notify],
  );
  useEscapeKeyStack(open, () => setOpen(false));
  const context = useMemo(() => ({ open, setOpen, compact }), [compact, open, setOpen]);
  return (
    <DsMenuContext.Provider value={context}>
      <RadixMenu.Root open={open} onOpenChange={setOpen} modal={modal}>
        {children}
      </RadixMenu.Root>
    </DsMenuContext.Provider>
  );
}

function DsMenuTrigger({ children, disabled }: { children: ReactElement; disabled?: boolean }) {
  return (
    <RadixMenu.Trigger asChild disabled={disabled}>
      {children}
    </RadixMenu.Trigger>
  );
}

export interface DsMenuContentProps {
  children?: ReactNode;
  className?: string;
  container?: HTMLElement | null;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  align?: "start" | "center" | "end";
  alignOffset?: number;
  width?: number | string;
  minWidth?: number | string;
  maxHeight?: number | string;
  onCloseAutoFocus?: (event: Event) => void;
}

function DsMenuContent({
  children,
  className,
  container,
  side,
  sideOffset = 5,
  align,
  alignOffset,
  width = "auto",
  minWidth = "auto",
  maxHeight,
  onCloseAutoFocus,
}: DsMenuContentProps) {
  const { open, compact } = useDsMenuContext();
  const portalContainer = useContext(ModalPortalContainerContext);
  const style = {
    "--scale": "1",
    "--menu-width": cssLength(width),
    "--menu-min-width": cssLength(minWidth),
    "--menu-max-height": cssLength(maxHeight),
  } as CSSProperties;
  return (
    <RadixMenu.Portal forceMount container={container ?? portalContainer ?? getPortalRoot()}>
      <TransitionGroup className={css.Menu} disableAnimations={!MENU_ANIMATIONS || undefined} enterDuration={150} exitDuration={100}>
        {open && (
          <RadixMenu.Content
            key="dropdown"
            forceMount
            className={clsx("ws-menu", css.MenuList, className)}
            data-compact={compact ? "" : undefined}
            side={side}
            sideOffset={sideOffset}
            align={align}
            alignOffset={alignOffset ?? (align === "center" ? 0 : -5)}
            avoidCollisions
            collisionPadding={MENU_COLLISION_PADDING}
            onEscapeKeyDown={preventDefault}
            onCloseAutoFocus={onCloseAutoFocus}
            style={style}
          >
            {children}
          </RadixMenu.Content>
        )}
      </TransitionGroup>
    </RadixMenu.Portal>
  );
}

export interface DsMenuItemProps {
  children?: ReactNode;
  className?: string;
  color?: "danger";
  disabled?: boolean;
  onSelect?: (event: Event) => void;
  onClick?: () => void;
}

/** Without `onSelect` / `onClick` the item is static content. */
function DsMenuItem({ children, className, color, disabled, onSelect, onClick }: DsMenuItemProps) {
  const guard = useClosedPointerGuard();
  if (onSelect == null && onClick == null) return <div className={clsx(css.MenuItemContent, className)}>{children}</div>;
  return (
    <RadixMenu.Item
      className={clsx(css.MenuItem, className)}
      data-color={color}
      disabled={disabled}
      onSelect={onSelect}
      onClick={onClick}
      onPointerMove={guard}
      onPointerLeave={guard}
    >
      <div className={css.PressableInner}>{children}</div>
    </RadixMenu.Item>
  );
}

function DsMenuSeparator({ className }: { className?: string }) {
  return <RadixMenu.Separator className={clsx(css.Separator, className)} role="separator" />;
}

export interface DsMenuRadioGroupProps {
  children?: ReactNode;
  className?: string;
  value: string;
  onChange: (value: string) => void;
  indicatorPosition?: "start" | "end";
}

function DsMenuRadioGroup({ children, className, value, onChange, indicatorPosition = "end" }: DsMenuRadioGroupProps) {
  return (
    <RadixMenu.RadioGroup className={className} value={value} onValueChange={onChange} data-indicator-position={indicatorPosition}>
      {children}
    </RadixMenu.RadioGroup>
  );
}

export interface DsMenuRadioItemProps {
  children?: ReactNode;
  className?: string;
  value: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-description"?: string;
  indicatorVariant?: "radio" | "checkmark";
}

function DsMenuRadioItem({ children, className, indicatorVariant = "radio", ...rest }: DsMenuRadioItemProps) {
  return (
    <RadixMenu.RadioItem className={clsx(css.MenuItem, css.RadioItem, className)} {...rest}>
      <div className={css.PressableInner}>
        {indicatorVariant === "checkmark" ? (
          <div className={css.CheckmarkIndicator}>
            <RadixMenu.ItemIndicator>
              <LegacySharedCeDad1Icon className="size-4" />
            </RadixMenu.ItemIndicator>
          </div>
        ) : (
          <div className={css.RadioIndicator}>
            <RadixMenu.ItemIndicator className={css.RadioIndicatorActive} />
          </div>
        )}
        {children}
      </div>
    </RadixMenu.RadioItem>
  );
}

export interface DsMenuCheckboxItemProps {
  children?: ReactNode;
  className?: string;
  checked?: boolean | "indeterminate";
  disabled?: boolean;
  "aria-label"?: string;
  onCheckedChange?: (checked: boolean) => void;
  onSelect?: (event: Event) => void;
  variant?: "checkbox" | "switch";
  indicatorPosition?: "start" | "end";
  indicatorVariant?: "solid" | "ghost";
}

/** `_4.CheckboxItem`: a toggle shown as a checkmark (in a circle unless `ghost`) or as a switch. */
function DsMenuCheckboxItem({
  children,
  className,
  variant = "checkbox",
  indicatorPosition = "end",
  indicatorVariant = "solid",
  ...rest
}: DsMenuCheckboxItemProps) {
  return (
    <RadixMenu.CheckboxItem
      className={clsx(css.MenuItem, css.CheckboxItem, className)}
      {...rest}
      data-variant={variant}
      data-indicator-position={indicatorPosition}
      data-indicator-variant={indicatorVariant}
    >
      <div className={css.PressableInner}>
        {variant === "switch" ? (
          <div className={css.SwitchIndicator} aria-hidden="true">
            <div className={css.SwitchThumb} />
          </div>
        ) : (
          <div className={css.CheckboxIndicator}>
            <RadixMenu.ItemIndicator>
              {indicatorVariant === "ghost" ? (
                <LegacySharedCeDad1Icon className="size-4" />
              ) : (
                <div className={css.CheckboxCircle}>
                  <LegacySharedCeDad1Icon className="size-4" />
                </div>
              )}
            </RadixMenu.ItemIndicator>
          </div>
        )}
        {children}
      </div>
    </RadixMenu.CheckboxItem>
  );
}

interface DsMenuSubContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: RefObject<HTMLDivElement | null>;
}

const DsMenuSubContext = createContext<DsMenuSubContextValue | null>(null);

function useDsMenuSubContext() {
  const context = useContext(DsMenuSubContext);
  if (context == null) throw new Error("Submenu components must be wrapped in <Sub />");
  return context;
}

export interface DsMenuSubProps {
  children?: ReactNode;
  forceOpen?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

/** `_4.Sub`: a nested menu; Escape closes only the submenu and focuses its trigger. */
function DsMenuSub({ children, forceOpen, onOpen, onClose }: DsMenuSubProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const open = forceOpen ?? uncontrolledOpen;
  const notify = useStableCallback((next: boolean) => (next ? onOpen?.() : onClose?.()));
  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next);
      notify(next);
    },
    [notify],
  );
  useEscapeKeyStack(open, () => {
    setOpen(false);
    triggerRef.current?.focus();
  });
  const context = useMemo(() => ({ open, setOpen, triggerRef }), [open, setOpen]);
  return (
    <DsMenuSubContext.Provider value={context}>
      <RadixMenu.Sub open={open} onOpenChange={setOpen}>
        {children}
      </RadixMenu.Sub>
    </DsMenuSubContext.Provider>
  );
}

/** `_4.SubTrigger`: an item with a trailing chevron that opens the surrounding `Sub`. */
function DsMenuSubTrigger({ children, className, disabled }: { children?: ReactNode; className?: string; disabled?: boolean }) {
  const guard = useClosedPointerGuard();
  const { triggerRef } = useDsMenuSubContext();
  return (
    <RadixMenu.SubTrigger
      ref={triggerRef}
      className={clsx(css.MenuItem, css.SubMenuItem, className)}
      disabled={disabled}
      onPointerMove={guard}
      onPointerLeave={guard}
    >
      <div className={css.PressableInner}>
        {children}
        <LegacyInitialCboB6faIcon width="16" height="16" className={css.SubTriggerIcon} />
      </div>
    </RadixMenu.SubTrigger>
  );
}

export interface DsMenuSubContentProps {
  children?: ReactNode;
  sideOffset?: number;
  alignOffset?: number;
  width?: number | string;
  minWidth?: number | string;
  maxHeight?: number | string;
}

/** `_4.SubContent`. */
function DsMenuSubContent({ children, sideOffset = 4, alignOffset = -6, width = "auto", minWidth = "auto", maxHeight }: DsMenuSubContentProps) {
  const { compact } = useDsMenuContext();
  const { open } = useDsMenuSubContext();
  const portalContainer = useContext(ModalPortalContainerContext);
  const style = {
    "--scale": "1",
    "--menu-width": cssLength(width),
    "--menu-min-width": cssLength(minWidth),
    "--menu-max-height": cssLength(maxHeight),
  } as CSSProperties;
  return (
    <RadixMenu.Portal forceMount container={portalContainer ?? getPortalRoot()}>
      <TransitionGroup className={css.Menu} disableAnimations={!MENU_ANIMATIONS || undefined} enterDuration={150} exitDuration={100}>
        {open && (
          <RadixMenu.SubContent
            key="submenu"
            className={css.MenuList}
            data-compact={compact ? "" : undefined}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            avoidCollisions
            collisionPadding={MENU_COLLISION_PADDING}
            onEscapeKeyDown={preventDefault}
            style={style}
          >
            {children}
          </RadixMenu.SubContent>
        )}
      </TransitionGroup>
    </RadixMenu.Portal>
  );
}

export const DsMenu = Object.assign(DsMenuRoot, {
  Trigger: DsMenuTrigger,
  Content: DsMenuContent,
  Item: DsMenuItem,
  Separator: DsMenuSeparator,
  Sub: DsMenuSub,
  SubTrigger: DsMenuSubTrigger,
  SubContent: DsMenuSubContent,
  CheckboxItem: DsMenuCheckboxItem,
  RadioGroup: DsMenuRadioGroup,
  RadioItem: DsMenuRadioItem,
});
