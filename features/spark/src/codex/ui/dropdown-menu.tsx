import clsx from "clsx";
import { DropdownMenu as RadixDropdownMenu } from "radix-ui";
import {
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { composeRefs } from "./compose-refs";
import {
  MENU_HOVER_CLOSE_DELAY_MS,
  MENU_HOVER_OPEN_DELAY_MS,
  MenuContent,
  MenuPortal,
  MenuTrigger,
  dropdownOverlaySide,
  menuContentLimits,
  menuContentMaxHeight,
  menuContentWidthClassName,
  useMenuOpenState,
  type MenuContentMaxHeight,
  type MenuContentProps,
  type MenuContentWidth,
  type MenuSurface,
} from "./menu";
import { OverlayOwnerContext, useWindowZoom } from "./overlay-context";
import { Portal } from "./portal";
import { getPortalRoot } from "./portal-root";

export type DropdownMenuSide = "top" | "right" | "bottom" | "left";
export type DropdownMenuAlign = "start" | "center" | "end";

export interface DropdownMenuPlacement {
  side?: DropdownMenuSide;
  align?: DropdownMenuAlign;
  sideOffset?: number;
  alignOffset?: number;
}

export interface DropdownMenuProps {
  /** Element that opens the menu; rendered through Radix `asChild`. */
  triggerButton: ReactNode;
  disabled?: boolean;
  children?: ReactNode;
  /** Shown in the menu while `children` suspend. */
  loadingContent?: ReactNode;
  modal?: boolean;
  open?: boolean;
  openOnHover?: boolean;
  onOpenChange?: (open: boolean) => void;
  dir?: "ltr" | "rtl";
  side?: DropdownMenuSide;
  align?: DropdownMenuAlign;
  sideOffset?: number;
  /** Recomputed while open on resize; overrides side/align/offsets. */
  getPlacement?: (trigger: HTMLElement, zoom: number, contentWidth: number | undefined) => DropdownMenuPlacement;
  alignOffset?: number;
  contentRef?: Ref<HTMLDivElement>;
  contentRole?: string;
  contentAriaLabelledBy?: string;
  scrollFade?: boolean;
  scrollPeek?: boolean;
  onContentFocus?: (event: FocusEvent<HTMLDivElement>) => void;
  onContentKeyDownCapture?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onContentPointerDownCapture?: (event: PointerEvent<HTMLDivElement>) => void;
  onContentPointerEnter?: (event: PointerEvent<HTMLDivElement>) => void;
  onContentPointerLeave?: (event: PointerEvent<HTMLDivElement>) => void;
  onOpenAutoFocus?: MenuContentProps["onOpenAutoFocus"];
  onCloseAutoFocus?: MenuContentProps["onCloseAutoFocus"];
  onEscapeKeyDown?: MenuContentProps["onEscapeKeyDown"];
  onInteractOutside?: MenuContentProps["onInteractOutside"];
  contentClassName?: string;
  contentVariant?: MenuContentProps["variant"];
  contentStyle?: CSSProperties;
  size?: MenuContentProps["size"];
  rowLayout?: MenuContentProps["rowLayout"];
  surface?: MenuSurface;
  contentWidth?: MenuContentWidth;
  contentMaxWidth?: MenuContentProps["maxWidth"];
  matchTriggerWidth?: boolean;
  contentMaxHeight?: MenuContentMaxHeight;
  portalContainer?: HTMLElement | null;
}

/** Codex dropdown menu (`oC` in the bundles): Radix dropdown root + `Menu.Trigger` + `Menu.Content`. */
export function DropdownMenu({
  triggerButton,
  disabled,
  children,
  loadingContent,
  modal = false,
  open,
  openOnHover = false,
  onOpenChange,
  dir,
  side,
  align,
  sideOffset,
  getPlacement,
  alignOffset,
  contentRef,
  contentRole = "menu",
  contentAriaLabelledBy,
  scrollFade,
  scrollPeek,
  onContentFocus,
  onContentKeyDownCapture,
  onContentPointerDownCapture,
  onContentPointerEnter,
  onContentPointerLeave,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  onInteractOutside,
  contentClassName,
  contentVariant,
  contentStyle,
  size,
  rowLayout,
  surface = "menu",
  contentWidth,
  contentMaxWidth,
  matchTriggerWidth = false,
  contentMaxHeight,
  portalContainer,
}: DropdownMenuProps) {
  const zoom = useWindowZoom();
  const triggerWidth = `calc(var(--radix-dropdown-menu-trigger-width) / ${zoom})`;
  const triggerNode = useRef<HTMLElement | null>(null);
  const [measuredContent, setMeasuredContent] = useState<HTMLDivElement | null>(null);
  const contentNode = useRef<HTMLDivElement | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const openedByHover = useRef(false);
  const [placement, setPlacement] = useState<DropdownMenuPlacement>();
  const [overlaySide, setOverlaySide] = useState<"top" | "bottom">();
  const { handleOpenChange, open: isOpen } = useMenuOpenState(open, onOpenChange, { disabled, dismissOnWindowBlur: false });
  const registerOpen = useContext(OverlayOwnerContext)?.registerOpen;
  useLayoutEffect(() => {
    if (!isOpen) return;
    const unregister = registerOpen?.();
    return typeof unregister === "function" ? unregister : undefined;
  }, [isOpen, registerOpen]);
  if (!isOpen && placement != null) setPlacement(undefined);

  const cancelHoverTimer = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
  }, []);
  const resetHover = () => {
    cancelHoverTimer();
    openedByHover.current = false;
  };
  const handleRootOpenChange = (next: boolean) => {
    cancelHoverTimer();
    if (next) openedByHover.current = false;
    handleOpenChange(next);
  };
  useEffect(() => cancelHoverTimer, [cancelHoverTimer, disabled, isOpen, openOnHover]);

  const scheduleHoverClose = (event: PointerEvent<HTMLElement>) => {
    if (!openOnHover || event.pointerType !== "mouse") return;
    cancelHoverTimer();
    if (!isOpen || !openedByHover.current) return;
    hoverTimer.current = window.setTimeout(() => {
      cancelHoverTimer();
      handleOpenChange(false);
    }, MENU_HOVER_CLOSE_DELAY_MS);
  };

  useLayoutEffect(() => {
    const trigger = triggerNode.current;
    if (!isOpen || getPlacement == null || trigger == null) return;
    const update = () => {
      const next = getPlacement(trigger, zoom, measuredContent?.offsetWidth);
      setPlacement((current) =>
        current?.side === next.side && current?.align === next.align && current?.sideOffset === next.sideOffset && current?.alignOffset === next.alignOffset
          ? current
          : next,
      );
    };
    update();
    const observer = measuredContent == null ? null : new ResizeObserver(update);
    if (measuredContent != null) observer?.observe(measuredContent);
    const view = trigger.ownerDocument.defaultView;
    view?.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      view?.removeEventListener("resize", update);
    };
  }, [getPlacement, isOpen, measuredContent, zoom]);

  const mergedContentRef = useMemo(() => composeRefs(contentRef, getPlacement == null ? undefined : setMeasuredContent), [contentRef, getPlacement]);
  const resolvedContentRef = useMemo(
    () =>
      getPlacement == null && !openOnHover
        ? contentRef
        : (node: HTMLDivElement | null) => {
            contentNode.current = node;
            const cleanup = mergedContentRef(node);
            return () => {
              contentNode.current = null;
              if (typeof cleanup === "function") cleanup();
            };
          },
    [contentRef, getPlacement, mergedContentRef, openOnHover],
  );
  const setTriggerNode = useCallback(
    (node: HTMLButtonElement | null) => {
      triggerNode.current = node;
      if (node != null && isOpen) setOverlaySide(dropdownOverlaySide(node));
    },
    [isOpen],
  );

  const content = (
    <MenuContent
      ref={resolvedContentRef}
      role={contentRole}
      {...(contentAriaLabelledBy == null ? {} : { "aria-labelledby": contentAriaLabelledBy })}
      scrollFade={scrollFade}
      scrollPeek={scrollPeek}
      side={overlaySide ?? placement?.side ?? side}
      align={placement?.align ?? align}
      sideOffset={placement?.sideOffset ?? sideOffset}
      alignOffset={placement?.alignOffset ?? alignOffset}
      onFocus={onContentFocus}
      onKeyDownCapture={(event) => {
        resetHover();
        onContentKeyDownCapture?.(event);
      }}
      onPointerDownCapture={(event) => {
        resetHover();
        onContentPointerDownCapture?.(event);
      }}
      onPointerEnter={(event) => {
        cancelHoverTimer();
        onContentPointerEnter?.(event);
      }}
      onPointerLeave={(event) => {
        onContentPointerLeave?.(event);
        if (!event.defaultPrevented) scheduleHoverClose(event);
      }}
      onOpenAutoFocus={(event) => {
        if (openedByHover.current) event.preventDefault();
        onOpenAutoFocus?.(event);
      }}
      onCloseAutoFocus={(event) => {
        if (openedByHover.current) event.preventDefault();
        onCloseAutoFocus?.(event);
        openedByHover.current = false;
      }}
      onEscapeKeyDown={onEscapeKeyDown}
      onInteractOutside={(event) => {
        if (openOnHover && event.target instanceof Node && triggerNode.current?.contains(event.target)) event.preventDefault();
        onInteractOutside?.(event);
      }}
      size={size}
      maxWidth={contentMaxWidth}
      rowLayout={rowLayout}
      surface={surface}
      variant={contentVariant}
      className={clsx(menuContentWidthClassName(contentWidth), contentClassName)}
      style={{
        ...contentStyle,
        ...(matchTriggerWidth ? { width: triggerWidth, minWidth: triggerWidth } : null),
        maxHeight: menuContentMaxHeight(contentMaxHeight, "var(--radix-dropdown-menu-content-available-height)") ?? menuContentLimits.maxHeight,
        zoom: portalContainer == null && zoom !== 1 ? zoom : undefined,
      }}
    >
      {children}
    </MenuContent>
  );

  return (
    <RadixDropdownMenu.Root dir={dir} modal={modal} open={isOpen} onOpenChange={handleRootOpenChange}>
      <MenuTrigger
        ref={setTriggerNode}
        asChild
        disabled={disabled}
        onPointerEnter={(event) => {
          if (!openOnHover || disabled || event.defaultPrevented || event.pointerType !== "mouse") return;
          cancelHoverTimer();
          if (!isOpen) {
            hoverTimer.current = window.setTimeout(() => {
              openedByHover.current = true;
              handleOpenChange(true);
            }, MENU_HOVER_OPEN_DELAY_MS);
          }
        }}
        onPointerLeave={scheduleHoverClose}
        onPointerDown={(event) => {
          if (openOnHover && !event.defaultPrevented && event.button === 0 && !event.ctrlKey) {
            cancelHoverTimer();
            event.preventDefault();
          }
        }}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          if (!openOnHover || disabled || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.detail === 0) return;
          const next = !isOpen || openedByHover.current;
          handleRootOpenChange(next);
          if (next) contentNode.current?.focus({ preventScroll: true });
        }}
        onKeyDown={(event) => {
          if (!openOnHover || event.defaultPrevented) return;
          resetHover();
          if (!isOpen || !["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) return;
          event.preventDefault();
          const items = contentNode.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([data-disabled])');
          (event.key === "ArrowUp" ? items?.[items.length - 1] : items?.[0])?.focus();
        }}
      >
        {triggerButton}
      </MenuTrigger>
      {!disabled && modal && isOpen ? (
        <RadixDropdownMenu.Portal container={portalContainer ?? getPortalRoot()}>
          <Portal container={portalContainer ?? getPortalRoot()}>
            <div aria-hidden className="pointer-events-auto fixed inset-0" />
          </Portal>
        </RadixDropdownMenu.Portal>
      ) : null}
      {!disabled && (
        <MenuPortal container={portalContainer ?? getPortalRoot()}>
          {loadingContent === undefined ? content : <SuspendedMenuContent content={content} loadingContent={loadingContent} open={isOpen} />}
        </MenuPortal>
      )}
    </RadixDropdownMenu.Root>
  );
}

function SuspendedMenuContent({ content, loadingContent, open }: { content: ReactElement<MenuContentProps>; loadingContent: ReactNode; open: boolean }) {
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
  }, [open]);
  return (
    <Suspense
      fallback={
        <MenuContent
          {...content.props}
          onCloseAutoFocus={(event) => {
            if (openRef.current) event.preventDefault();
            else content.props.onCloseAutoFocus?.(event);
          }}
        >
          {loadingContent}
        </MenuContent>
      }
    >
      {content}
    </Suspense>
  );
}
