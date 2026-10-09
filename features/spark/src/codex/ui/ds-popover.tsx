import clsx from "clsx";
import { Popover as RadixPopover } from "radix-ui";
import { createContext, use, useCallback, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { useEscapeKeyStack } from "./escape-key-stack";
import { TransitionGroup } from "./transition-group";
import { useStableCallback } from "./use-stable-callback";
import { getPortalRoot } from "./portal-root";

const css = { popover: "_Popover_oe2a7_2", transition: "_Transition_oe2a7_2" } as const;

/** Module classes for the popovers below; chunks that bundle their own copy of the component use other hashes. */
export const DsPopoverClassNames = createContext<Record<keyof typeof css, string>>(css);

const focusableSelector =
  'a[href], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex^="-"]), [contenteditable]';

interface DsPopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerElement: HTMLElement | null;
  setTriggerElement: (element: HTMLElement | null) => void;
  contentRef: RefObject<HTMLDivElement | null>;
}

const DsPopoverContext = createContext<DsPopoverContextValue | null>(null);

function useDsPopover() {
  const context = use(DsPopoverContext);
  if (context == null) throw new Error("Popover components must be wrapped in <Popover />");
  return context;
}

/** `Cc` (DatePicker chunk): closes the surrounding popover. */
export function useDsPopoverClose() {
  const { setOpen } = useDsPopover();
  return useCallback(() => setOpen(false), [setOpen]);
}

/** `Fsn` (app-shared): CSS custom properties from a map, numbers in px; empty values are left out. */
function cssVariables(values: Record<string, string | number | undefined>) {
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!value && value !== 0) continue;
    style[key.startsWith("--") ? key : `--${key}`] = typeof value === "number" ? `${value}px` : value;
  }
  return style as CSSProperties;
}

function preventDefault(event: Event) {
  event.preventDefault();
}

export interface DsPopoverProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

/**
 * Design-system popover (`n` of `popover-827102ba7681.js`): non-modal Radix popover whose content scales in
 * and out and closes on Escape through the escape-key stack. Not yet: `showOnHover` / `hoverOpenDelay`.
 */
export function DsPopover({ open, onOpenChange, children }: DsPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isOpen = open ?? uncontrolledOpen;
  const setOpen = useStableCallback((next: boolean) => {
    if (isOpen === next) return;
    onOpenChange?.(next);
    setUncontrolledOpen(next);
  });
  const value = useMemo(() => ({ open: isOpen, setOpen, triggerElement, setTriggerElement, contentRef }), [isOpen, setOpen, triggerElement]);
  return (
    <DsPopoverContext value={value}>
      <RadixPopover.Root open={isOpen} onOpenChange={setOpen} modal={false}>
        {children}
      </RadixPopover.Root>
    </DsPopoverContext>
  );
}

export interface DsPopoverTriggerProps {
  children?: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
}

/** `Popover.Trigger`: its only child becomes the trigger. */
function DsPopoverTrigger({ children, onClick, onPointerDown }: DsPopoverTriggerProps) {
  const { setTriggerElement } = useDsPopover();
  const ref = useCallback((element: HTMLButtonElement | null) => setTriggerElement(element), [setTriggerElement]);
  return (
    <RadixPopover.Trigger asChild ref={ref} onPointerDown={onPointerDown} onClick={onClick}>
      {children}
    </RadixPopover.Trigger>
  );
}

export interface DsPopoverContentProps {
  children?: ReactNode;
  className?: string;
  avoidCollisions?: boolean;
  width?: string | number;
  minWidth?: string | number;
  maxWidth?: string | number;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  align?: "start" | "center" | "end";
  alignOffset?: number;
  translucent?: boolean;
  /** Focus the popover itself when it opens without focus inside. */
  autoFocus?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
  preventCloseOnFocusOutside?: boolean;
}

function DsPopoverSurface({
  children,
  avoidCollisions,
  width,
  minWidth,
  maxWidth,
  side,
  sideOffset = 8,
  align,
  alignOffset,
  translucent,
  className,
  autoFocus = true,
  onCloseAutoFocus,
  preventCloseOnFocusOutside = false,
}: DsPopoverContentProps) {
  const { contentRef } = useDsPopover();
  const classNames = use(DsPopoverClassNames);
  return (
    <RadixPopover.Content
      forceMount
      ref={contentRef}
      className={clsx(classNames.popover, className)}
      style={cssVariables({ "popover-width": width, "popover-min-width": minWidth, "popover-max-width": maxWidth })}
      onCloseAutoFocus={onCloseAutoFocus}
      data-translucent={translucent ? "true" : undefined}
      side={side}
      sideOffset={sideOffset}
      align={align}
      alignOffset={alignOffset ?? (align === "center" ? 0 : -5)}
      avoidCollisions={avoidCollisions ?? true}
      hideWhenDetached
      collisionPadding={20}
      onFocusOutside={preventCloseOnFocusOutside ? preventDefault : undefined}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        const content = contentRef.current;
        if (autoFocus && content != null && !content.contains(document.activeElement)) content.focus({ preventScroll: true });
      }}
      onEscapeKeyDown={preventDefault}
      onKeyDown={(event) => {
        const content = contentRef.current;
        if (content != null && event.target === content && event.key === "Tab" && event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          const focusable = content.querySelectorAll<HTMLElement>(focusableSelector);
          focusable[focusable.length - 1]?.focus();
        }
      }}
    >
      {children}
    </RadixPopover.Content>
  );
}

/** `Popover.Content`: portalled into the trigger's dialog when there is one. */
function DsPopoverContent(props: DsPopoverContentProps) {
  const { open, setOpen, triggerElement } = useDsPopover();
  const classNames = use(DsPopoverClassNames);
  const container = triggerElement?.closest<HTMLElement>('[role="dialog"]') ?? undefined;
  useEscapeKeyStack(open, () => setOpen(false));
  return (
    <RadixPopover.Portal forceMount container={container ?? getPortalRoot()}>
      <TransitionGroup enterDuration={600} exitDuration={300} className={classNames.transition}>
        {open && <DsPopoverSurface key="popover" {...props} />}
      </TransitionGroup>
    </RadixPopover.Portal>
  );
}

DsPopover.Trigger = DsPopoverTrigger;
DsPopover.Content = DsPopoverContent;
