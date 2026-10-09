import clsx from "clsx";
import { Popover as RadixPopover } from "radix-ui";
import { useContext, useLayoutEffect, useState, type ComponentProps, type CSSProperties } from "react";
import { menuContentWidthClasses, menuSurfaceClassName } from "./menu";
import { OverlayOwnerContext, useWindowZoom } from "./overlay-context";
import { Portal } from "./portal";
import { getPortalRoot } from "./portal-root";

const popoverAnimationClasses = {
  "slide-from-left": "_slide-from-left_1ny4d_2",
  "slide-to-left": "_slide-to-left_1ny4d_2",
} as const;

const popoverSizeClasses = {
  anchor: "w-[var(--radix-popover-trigger-width)]",
  content: "w-fit",
  default: "w-72",
  extraLarge: "w-[408px]",
  large: "w-96",
  menuWide: "w-60",
  railMenu: menuContentWidthClasses.railMenu,
  workspace: "w-65",
} as const;

export type PopoverSize = keyof typeof popoverSizeClasses;
export type PopoverVariant = "default" | "menu" | "comment";

export interface PopoverProps extends ComponentProps<typeof RadixPopover.Root> {}

/** An open popover registers itself with the surrounding overlay owner. */
export function Popover({ open, defaultOpen = false, onOpenChange, ...rest }: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = open ?? uncontrolledOpen;
  const registerOpen = useContext(OverlayOwnerContext)?.registerOpen;
  useLayoutEffect(() => {
    if (isOpen) return registerOpen?.();
  }, [isOpen, registerOpen]);
  return (
    <RadixPopover.Root
      open={isOpen}
      onOpenChange={(next) => {
        if (open === undefined) setUncontrolledOpen(next);
        onOpenChange?.(next);
      }}
      {...rest}
    />
  );
}

export function PopoverAnchor(props: ComponentProps<typeof RadixPopover.Anchor>) {
  return <RadixPopover.Anchor data-slot="popover-anchor" {...props} />;
}

export function PopoverTrigger(props: ComponentProps<typeof RadixPopover.Trigger>) {
  return <RadixPopover.Trigger data-slot="popover-trigger" {...props} />;
}

export interface PopoverContentProps extends ComponentProps<typeof RadixPopover.Content> {
  size?: PopoverSize;
  variant?: PopoverVariant;
  contentOverflow?: "auto" | "visible";
  disablePadding?: boolean;
  disablePortal?: boolean;
  animation?: keyof typeof popoverAnimationClasses;
  opaque?: boolean;
  portalContainer?: HTMLElement | null;
  unstyled?: boolean;
}

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 4,
  size = "default",
  style,
  contentOverflow = "auto",
  disablePadding = false,
  disablePortal = false,
  animation,
  opaque = true,
  portalContainer,
  unstyled = false,
  variant = "default",
  ...rest
}: PopoverContentProps) {
  const zoom = useWindowZoom();
  const ownerId = useContext(OverlayOwnerContext)?.id;
  const contentStyle: CSSProperties = {
    zoom: portalContainer == null && zoom !== 1 ? zoom : undefined,
    maxWidth: `min(calc(var(--radix-popover-content-available-width) / ${zoom}), calc((100vw - 16px) / ${zoom}))`,
    maxHeight: `min(${size === "railMenu" ? "400px, " : ""}calc(var(--radix-popover-content-available-height) / ${zoom}), calc((100vh - 16px) / ${zoom}))`,
    ...style,
  };
  const content = (
    <RadixPopover.Content
      data-overlay-owner={ownerId}
      data-slot="popover-content"
      align={align}
      collisionPadding={6}
      sideOffset={sideOffset}
      className={clsx(
        animation === "slide-from-left" && popoverAnimationClasses["slide-from-left"],
        !unstyled && [
          "text-default z-50 flex origin-[var(--radix-popover-content-transform-origin)] flex-col outline-hidden",
          contentOverflow === "auto" ? "overflow-y-auto" : "overflow-visible",
          variant === "menu"
            ? [menuSurfaceClassName("opaque"), !disablePadding && "p-2"]
            : [
                variant === "comment"
                  ? "ring-border-subtle rounded-2xl shadow-lg-stronger ring-1"
                  : "ring-(--color-border-overlay) rounded-xl shadow-(--shadow-popover-overlay) ring-(length:--popover-overlay-ring-width)",
                !disablePadding && "px-1 py-1",
                opaque ? "bg-surface-elevated-secondary" : "bg-surface-elevated-secondary/90",
              ],
          popoverSizeClasses[size],
        ],
        className,
      )}
      style={contentStyle}
      {...rest}
    />
  );
  if (disablePortal) return content;
  return <Portal container={portalContainer ?? getPortalRoot()}>{content}</Portal>;
}
