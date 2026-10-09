import clsx from "clsx";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { useFloatingPosition, type FloatingPlacement } from "./floating-position";
import { Kbd } from "./kbd";
import { DISMISS_TOOLTIPS_EVENT, OverlayOwnerContext } from "./overlay-context";
import { Portal } from "./portal";
import { getPortalRoot } from "./portal-root";

const css = { textTheme: "_textTheme_8iuk0_2" } as const;

const DEFAULT_DELAY_MS = 200;
const DELAY_OPEN_MS = 250;
const HOVER_HANDOFF_MS = 100;
const COACHMARK_ARROW_SIZE = 12;
const OVERFLOW_TARGET = "[data-tooltip-overflow-target]";
const VISIBILITY_TARGET = "[data-tooltip-visibility-target]";

export type TooltipSide = "top" | "right" | "bottom" | "left";
export type TooltipAlign = "start" | "center" | "end";
export type TooltipVariant = "tooltip" | "rich" | "entityPreview" | "coachmark" | "floating-navigation-rail" | "unstyled";
export type TooltipColor = "default" | "surface" | "inverse" | "classicLight";
export type TooltipOpenWhen = "always" | "trigger-overflows" | "visibility-target-hidden";

type TriggerProps = Omit<HTMLAttributes<HTMLElement>, "color" | "children" | "content">;

export interface TooltipProps extends TriggerProps {
  children?: ReactNode;
  tooltipContent: ReactNode;
  /** Shortcut rendered as a `Kbd` after the content. */
  shortcut?: ReactNode;
  disabled?: boolean;
  delayOpen?: boolean;
  delayDuration?: number;
  getDelayDuration?: (event: PointerEvent<HTMLElement>, delay: number) => number | undefined;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Suppresses the tooltip while the trigger's own popup is open. */
  triggerPopupOpen?: boolean;
  disableHoverOpen?: boolean;
  side?: TooltipSide;
  sideOffset?: number;
  align?: TooltipAlign;
  alignOffset?: number;
  flipAlignment?: boolean;
  variant?: TooltipVariant;
  color?: TooltipColor;
  coachmarkArrow?: "default" | "curved";
  disablePadding?: boolean;
  forceMount?: boolean;
  triggerAsChild?: boolean;
  cloneCustomTrigger?: boolean;
  triggerRef?: Ref<HTMLButtonElement | null>;
  triggerElement?: HTMLElement | null;
  positioningElement?: HTMLElement | null;
  closeOnTriggerClick?: boolean;
  openOnFocusWithin?: boolean;
  closeOnTriggerBlur?: boolean;
  closeOnPointerLeave?: boolean;
  closeOnWindowBlur?: boolean;
  selectable?: boolean;
  scrollable?: boolean;
  interactive?: boolean;
  followPointer?: boolean | "desktop";
  keyboardNavigation?: boolean;
  scaleAvailableSizeWithZoom?: boolean;
  tooltipClassName?: string;
  tooltipBodyClassName?: string;
  tooltipId?: string;
  tooltipMaxWidth?: CSSProperties["maxWidth"];
  skipDelayKey?: string;
  openWhen?: TooltipOpenWhen;
  portalContainer?: HTMLElement | null;
  ref?: Ref<HTMLElement>;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (ref == null) return;
  if (typeof ref === "function") ref(value);
  else (ref as RefObject<T>).current = value;
}

function containsNode(container: Element | null | undefined, node: EventTarget | null) {
  return node instanceof (container?.ownerDocument.defaultView?.Node ?? Node) && container?.contains(node as Node) === true;
}

function isFocusVisible(element: Element | null | undefined) {
  try {
    return element?.matches(":focus-visible") === true;
  } catch {
    return false;
  }
}

function shouldOpen(trigger: HTMLElement | null, openWhen: TooltipOpenWhen) {
  switch (openWhen) {
    case "always":
      return true;
    case "trigger-overflows": {
      const target = trigger?.querySelector(OVERFLOW_TARGET) ?? trigger;
      return target != null && (target.scrollWidth > target.clientWidth || target.scrollHeight > target.clientHeight);
    }
    case "visibility-target-hidden": {
      const target = trigger?.querySelector(VISIBILITY_TARGET);
      return target != null && getComputedStyle(target).display === "none";
    }
  }
}

function focusableElements(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex], [contenteditable]"))
    .filter((element) => {
      if (
        (element.tabIndex < 0 &&
          (element.hasAttribute("tabindex") || !element.matches('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]'))) ||
        element.matches(":disabled") ||
        element.closest("[inert], [hidden]") != null ||
        getComputedStyle(element).visibility === "hidden"
      ) {
        return false;
      }
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        if (getComputedStyle(node).display === "none") return false;
      }
      return true;
    })
    .sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity));
}

const oppositeSide = { top: "bottom", right: "left", bottom: "top", left: "right" } as const;

function placementSide(placement: FloatingPlacement): TooltipSide {
  return placement.split("-")[0] as TooltipSide;
}

/** Hover/focus tooltip (`XT` in the bundles). Renders only the trigger when disabled or without content. */
export function Tooltip(props: TooltipProps) {
  if (props.disabled || props.tooltipContent == null) return <>{props.children}</>;
  return <TooltipRoot {...props} delayDuration={props.delayDuration ?? DEFAULT_DELAY_MS} />;
}

function TooltipRoot({
  children,
  delayOpen,
  open,
  triggerPopupOpen = false,
  defaultOpen,
  disableHoverOpen = false,
  onOpenChange,
  tooltipContent,
  shortcut,
  sideOffset,
  side,
  variant = "tooltip",
  coachmarkArrow = "default",
  align = "center",
  alignOffset,
  flipAlignment = true,
  disablePadding = false,
  disabled: _disabled,
  forceMount = false,
  triggerAsChild = true,
  cloneCustomTrigger = false,
  triggerRef,
  closeOnTriggerClick,
  openOnFocusWithin = false,
  closeOnTriggerBlur = true,
  closeOnPointerLeave = true,
  closeOnWindowBlur = true,
  delayDuration,
  getDelayDuration,
  selectable = false,
  scrollable = false,
  interactive = selectable,
  followPointer = false,
  keyboardNavigation = false,
  scaleAvailableSizeWithZoom: _scaleAvailableSizeWithZoom,
  color = "default",
  tooltipClassName,
  tooltipBodyClassName,
  tooltipId,
  tooltipMaxWidth,
  skipDelayKey: _skipDelayKey,
  openWhen = "always",
  portalContainer,
  positioningElement,
  triggerElement,
  className,
  ref,
  ...rest
}: TooltipProps) {
  const generatedId = useId();
  const id = tooltipId ?? generatedId;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen === true);
  const controlled = open !== undefined;
  const plainTooltip = variant === "tooltip" && !interactive && !controlled;
  const closesOnClick = closeOnTriggerClick ?? plainTooltip;
  const followsPointer = (followPointer === true || followPointer === "desktop") && !interactive && variant === "tooltip";
  const suppressed = triggerPopupOpen && plainTooltip && closesOnClick;
  if (suppressed && uncontrolledOpen) setUncontrolledOpen(false);

  const triggerNode = useRef<HTMLElement | null>(triggerElement ?? null);
  const contentNode = useRef<HTMLDivElement | null>(null);
  const sideRef = useRef<TooltipSide>(side ?? "top");
  const pointerAnchor = useRef<DOMRect | null>(null);
  const updatePosition = useRef<(() => void) | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const dismissedByClick = useRef(false);
  const isOpen = !suppressed && (open ?? uncontrolledOpen);
  const openRef = useRef(isOpen);

  const clearOpenTimer = useCallback(() => {
    if (openTimer.current != null) window.clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);
  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const setOpen = useCallback(
    (next: boolean) => {
      if (openRef.current !== next || (controlled && isOpen !== next)) {
        openRef.current = next;
        if (!controlled) setUncontrolledOpen(next);
        onOpenChange?.(next);
      }
    },
    [controlled, isOpen, onOpenChange],
  );

  useLayoutEffect(() => {
    openRef.current = isOpen;
    clearOpenTimer();
    if (!isOpen) clearCloseTimer();
  }, [clearCloseTimer, clearOpenTimer, isOpen]);

  useEffect(
    () => () => {
      clearOpenTimer();
      clearCloseTimer();
    },
    [clearCloseTimer, clearOpenTimer],
  );

  const scheduleOpen = (delay: number) => {
    clearCloseTimer();
    if (suppressed || isOpen || openRef.current) return;
    if (openTimer.current != null) {
      if (delay !== 0) return;
      clearOpenTimer();
    }
    if (!shouldOpen(triggerNode.current, openWhen)) return;
    if (delay === 0) {
      setOpen(true);
      return;
    }
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      if (shouldOpen(triggerNode.current, openWhen)) setOpen(true);
    }, delay);
  };

  const close = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setOpen(false);
  }, [clearCloseTimer, clearOpenTimer, setOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const dismiss = () => close();
    const handleWindowBlur = () => {
      if (closeOnWindowBlur) close();
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !(event.target instanceof Element && event.target.closest("[data-tooltip-keyboard-navigation]"))) queueMicrotask(dismiss);
    };
    window.addEventListener(DISMISS_TOOLTIPS_EVENT, dismiss);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("keydown", handleEscape, true);
    return () => {
      window.removeEventListener(DISMISS_TOOLTIPS_EVENT, dismiss);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [close, closeOnWindowBlur, isOpen]);

  const closeUnlessSelecting = () => {
    const content = contentNode.current;
    if (keyboardNavigation && interactive && content?.contains(content.ownerDocument.activeElement)) return;
    const selection = selectable ? content?.ownerDocument.getSelection() : null;
    if (selection?.isCollapsed !== false || (!content?.contains(selection.anchorNode) && !content?.contains(selection.focusNode))) close();
  };

  const handoffPointerLeave = (event: PointerEvent<HTMLElement>) => {
    clearOpenTimer();
    clearCloseTimer();
    const point = { x: event.clientX, y: event.clientY };
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      const trigger = triggerNode.current;
      const hovered = trigger?.ownerDocument.elementFromPoint(point.x, point.y) ?? null;
      if (containsNode(trigger, hovered) || containsNode(contentNode.current, hovered)) return;
      closeUnlessSelecting();
    }, HOVER_HANDOFF_MS);
  };

  const handlePointerHover = (event: PointerEvent<HTMLElement>) => {
    if (disableHoverOpen || !containsNode(triggerNode.current, event.target) || (closesOnClick && dismissedByClick.current) || event.pointerType === "touch") return;
    if (followsPointer) {
      if (event.pointerType === "mouse") {
        pointerAnchor.current = new DOMRect(event.clientX, event.clientY);
        updatePosition.current?.();
      } else if (pointerAnchor.current != null) {
        pointerAnchor.current = null;
        updatePosition.current?.();
      }
    }
    let delay = delayDuration ?? 0;
    if (delayOpen) delay = DELAY_OPEN_MS;
    delay = getDelayDuration?.(event, delay) ?? delay;
    scheduleOpen(delay);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!keyboardNavigation) {
      if (event.key === "Escape") close();
      return;
    }
    if (event.defaultPrevented) return;
    const content = contentNode.current;
    const trigger = triggerNode.current;
    const returnTarget = trigger == null || trigger.tabIndex >= 0 ? trigger : focusableElements(trigger)[0];
    const insideContent = containsNode(content, event.target);
    if (event.key === "Escape") {
      if (interactive && insideContent && containsNode(content, content?.ownerDocument.activeElement ?? null)) {
        event.preventDefault();
        event.stopPropagation();
        returnTarget?.focus({ preventScroll: true });
      }
      close();
      return;
    }
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey || !interactive || !isOpen || content == null || trigger == null) return;
    const contentFocusables = focusableElements(content);
    let next: HTMLElement | undefined;
    if (!insideContent && !event.shiftKey) {
      next = contentFocusables[0];
    } else if (insideContent && event.shiftKey && event.target === contentFocusables[0]) {
      next = returnTarget ?? undefined;
    } else if (insideContent && !event.shiftKey && event.target === contentFocusables.at(-1)) {
      const outside = focusableElements(trigger.ownerDocument.body).filter((element) => !content.contains(element));
      const index = outside.findIndex((element) => element === returnTarget);
      next = index < 0 ? undefined : outside[index + 1];
      if (next != null && closeOnTriggerBlur) close();
    }
    if (next != null) {
      event.preventDefault();
      next.focus({ preventScroll: true });
    }
  };

  const triggerHandlers = {
    "aria-describedby": isOpen ? id : undefined,
    "data-state": isOpen ? "delayed-open" : "closed",
    onClick(event: MouseEvent<HTMLElement>) {
      if (closesOnClick && containsNode(triggerNode.current, event.target)) {
        dismissedByClick.current = true;
        close();
      }
    },
    onBlur(event: FocusEvent<HTMLElement>) {
      if (closeOnTriggerBlur && !(interactive && containsNode(contentNode.current, event.relatedTarget))) close();
    },
    onContextMenu() {
      clearOpenTimer();
      close();
    },
    onFocus(event: FocusEvent<HTMLElement>) {
      let target: Element | null = closesOnClick ? triggerNode.current : event.currentTarget;
      if (openOnFocusWithin && event.target instanceof HTMLElement) target = event.target;
      if (closesOnClick && event.defaultPrevented) {
        dismissedByClick.current = true;
        close();
        return;
      }
      if (!event.defaultPrevented && (!closesOnClick || containsNode(triggerNode.current, event.target)) && isFocusVisible(target)) {
        dismissedByClick.current = false;
        if (pointerAnchor.current != null) {
          pointerAnchor.current = null;
          updatePosition.current?.();
        }
        scheduleOpen(0);
      }
    },
    onKeyDown: handleKeyDown,
    onPointerEnter(event: PointerEvent<HTMLElement>) {
      if (containsNode(triggerNode.current, event.target)) dismissedByClick.current = false;
      handlePointerHover(event);
    },
    onPointerLeave(event: PointerEvent<HTMLElement>) {
      clearOpenTimer();
      if (!closeOnPointerLeave) return;
      if (interactive) {
        handoffPointerLeave(event);
        return;
      }
      close();
      if (pointerAnchor.current != null) {
        pointerAnchor.current = null;
        updatePosition.current?.();
      }
    },
    onPointerMove: handlePointerHover,
  };

  const latestHandlers = useRef(triggerHandlers);
  latestHandlers.current = triggerHandlers;
  useEffect(() => {
    if (triggerElement == null) return;
    triggerNode.current = triggerElement;
    const controller = new AbortController();
    const listen = <K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void) =>
      triggerElement.addEventListener(type, handler, { signal: controller.signal });
    const asReact = <E,>(event: Event) => event as unknown as E;
    listen("click", (event) => latestHandlers.current.onClick(asReact(event)));
    listen("focusout", (event) => latestHandlers.current.onBlur(asReact(event)));
    listen("focusin", (event) => latestHandlers.current.onFocus(asReact(event)));
    listen("contextmenu", () => latestHandlers.current.onContextMenu());
    listen("keydown", (event) => latestHandlers.current.onKeyDown(asReact(event)));
    listen("pointerover", (event) => {
      if (!containsNode(triggerElement, event.relatedTarget)) latestHandlers.current.onPointerEnter(asReact(event));
    });
    listen("pointerout", (event) => {
      if (!containsNode(triggerElement, event.relatedTarget)) latestHandlers.current.onPointerLeave(asReact(event));
    });
    listen("pointermove", (event) => latestHandlers.current.onPointerMove(asReact(event)));
    return () => {
      controller.abort();
      clearOpenTimer();
      clearCloseTimer();
    };
  }, [clearCloseTimer, clearOpenTimer, triggerElement]);

  const mergedProps = {
    ...triggerHandlers,
    ...rest,
    className,
    onClick: closesOnClick
      ? (event: MouseEvent<HTMLElement>) => {
          rest.onClick?.(event);
          triggerHandlers.onClick(event);
        }
      : rest.onClick,
    onBlur(event: FocusEvent<HTMLElement>) {
      rest.onBlur?.(event);
      triggerHandlers.onBlur(event);
    },
    onContextMenu(event: MouseEvent<HTMLElement>) {
      rest.onContextMenu?.(event);
      triggerHandlers.onContextMenu();
    },
    onFocus(event: FocusEvent<HTMLElement>) {
      rest.onFocus?.(event);
      triggerHandlers.onFocus(event);
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      rest.onKeyDown?.(event);
      triggerHandlers.onKeyDown(event);
    },
    onPointerEnter(event: PointerEvent<HTMLElement>) {
      rest.onPointerEnter?.(event);
      triggerHandlers.onPointerEnter(event);
    },
    onPointerLeave(event: PointerEvent<HTMLElement>) {
      rest.onPointerLeave?.(event);
      triggerHandlers.onPointerLeave(event);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      rest.onPointerMove?.(event);
      triggerHandlers.onPointerMove(event);
    },
  };

  const setTrigger = (node: HTMLElement | null) => {
    triggerNode.current = node;
    assignRef(ref, node);
  };
  const childRef = isValidElement<{ ref?: Ref<HTMLElement> }>(children) ? children.props.ref : undefined;
  const setClonedTrigger = useCallback(
    (node: HTMLElement | null) => {
      triggerNode.current = node;
      assignRef(ref, node);
      assignRef(childRef, node);
      if (triggerRef != null && (node == null || node instanceof HTMLButtonElement)) assignRef(triggerRef, node as HTMLButtonElement | null);
    },
    [childRef, ref, triggerRef],
  );

  let trigger: ReactNode;
  if (triggerElement != null) {
    trigger = children;
  } else if (!triggerAsChild) {
    trigger = (
      <button
        ref={(node) => {
          setTrigger(node);
          assignRef(triggerRef, node);
        }}
        type="button"
        {...mergedProps}
      >
        {children}
      </button>
    );
  } else if (!isValidElement(children)) {
    trigger = (
      <span ref={setTrigger} {...mergedProps}>
        {children}
      </span>
    );
  } else if (typeof children.type !== "string" && !cloneCustomTrigger) {
    trigger = (
      <span
        ref={(node) => {
          const first = node?.firstElementChild ?? null;
          setTrigger(first instanceof HTMLElement ? first : node);
        }}
        {...mergedProps}
        className={clsx("contents", className)}
      >
        {children}
      </span>
    );
  } else {
    trigger = cloneTrigger(children as ReactElement<ChildTriggerProps>, mergedProps, closesOnClick, setClonedTrigger);
  }

  return (
    <>
      {trigger}
      {isOpen || forceMount ? (
        <TooltipContent
          id={id}
          className={tooltipClassName}
          align={align}
          alignOffset={alignOffset}
          flipAlignment={flipAlignment}
          contentRef={contentNode}
          disablePadding={disablePadding}
          color={color}
          coachmarkArrow={coachmarkArrow}
          followPointer={followsPointer}
          keyboardNavigation={keyboardNavigation && interactive}
          maxWidth={tooltipMaxWidth}
          open={isOpen}
          onBlur={
            interactive && closeOnTriggerBlur
              ? (event) => {
                  if (!(containsNode(event.currentTarget, event.relatedTarget) || containsNode(triggerNode.current, event.relatedTarget))) close();
                }
              : undefined
          }
          onKeyDown={interactive ? handleKeyDown : undefined}
          onPointerEnter={interactive ? clearCloseTimer : undefined}
          onPointerLeave={interactive && closeOnPointerLeave ? handoffPointerLeave : undefined}
          placementSideRef={sideRef}
          portalContainer={portalContainer}
          pointerAnchorRef={pointerAnchor}
          positioningElement={positioningElement ?? triggerElement}
          referenceElementRef={triggerNode}
          selectable={selectable}
          scrollable={scrollable}
          side={side}
          sideOffset={sideOffset}
          updatePositionRef={followsPointer ? updatePosition : undefined}
          variant={variant}
        >
          <div className={clsx("flex gap-2", variant === "tooltip" ? "items-center" : "items-stretch", variant !== "tooltip" && "min-h-0 flex-1")}>
            <div
              className={clsx(
                "min-w-0",
                variant !== "tooltip" && "flex min-h-0 w-full",
                variant === "coachmark" && "overflow-y-auto",
                variant === "coachmark" && !disablePadding && "px-4 py-3",
                tooltipBodyClassName,
              )}
            >
              {tooltipContent}
            </div>
            {shortcut ? <Kbd keysLabel={shortcut} variant={variant === "tooltip" && color === "default" ? "tooltip" : "default"} /> : null}
          </div>
        </TooltipContent>
      ) : null}
    </>
  );
}

type ChildTriggerProps = HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> };

function cloneTrigger(child: ReactElement<ChildTriggerProps>, merged: ChildTriggerProps, closesOnClick: boolean, ref: (node: HTMLElement | null) => void) {
  const own = child.props;
  const describedBy = own["aria-describedby"] == null ? merged["aria-describedby"] : merged["aria-describedby"] == null ? own["aria-describedby"] : `${own["aria-describedby"]} ${merged["aria-describedby"]}`;
  return cloneElement(child, {
    ...merged,
    "aria-describedby": describedBy,
    className: clsx(own.className, merged.className),
    style: { ...merged.style, ...own.style },
    ref,
    onClick: closesOnClick
      ? (event: MouseEvent<HTMLElement>) => {
          own.onClick?.(event);
          merged.onClick?.(event);
        }
      : (merged.onClick ?? own.onClick),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      own.onBlur?.(event);
      merged.onBlur?.(event);
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      own.onContextMenu?.(event);
      merged.onContextMenu?.(event);
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      own.onFocus?.(event);
      merged.onFocus?.(event);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      own.onKeyDown?.(event);
      merged.onKeyDown?.(event);
    },
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      own.onPointerEnter?.(event);
      merged.onPointerEnter?.(event);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      own.onPointerLeave?.(event);
      merged.onPointerLeave?.(event);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      own.onPointerMove?.(event);
      merged.onPointerMove?.(event);
    },
  });
}

interface TooltipContentProps {
  id: string;
  children: ReactNode;
  className?: string;
  align: TooltipAlign;
  alignOffset?: number;
  flipAlignment: boolean;
  color: TooltipColor;
  coachmarkArrow: "default" | "curved";
  contentRef: RefObject<HTMLDivElement | null>;
  disablePadding: boolean;
  followPointer: boolean;
  keyboardNavigation: boolean;
  maxWidth?: CSSProperties["maxWidth"];
  open: boolean;
  onBlur?: (event: FocusEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  placementSideRef: RefObject<TooltipSide>;
  portalContainer?: HTMLElement | null;
  pointerAnchorRef: RefObject<DOMRect | null>;
  positioningElement?: HTMLElement | null;
  referenceElementRef: RefObject<HTMLElement | null>;
  selectable: boolean;
  scrollable: boolean;
  side?: TooltipSide;
  sideOffset?: number;
  updatePositionRef?: RefObject<(() => void) | null>;
  variant: TooltipVariant;
}

const EMPTY_RECT = { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 };

function TooltipContent({
  align,
  alignOffset,
  flipAlignment,
  children,
  className,
  color,
  coachmarkArrow,
  contentRef,
  disablePadding,
  followPointer,
  id,
  keyboardNavigation,
  maxWidth,
  open,
  onBlur,
  onKeyDown,
  onPointerEnter,
  onPointerLeave,
  placementSideRef,
  portalContainer,
  pointerAnchorRef,
  positioningElement,
  referenceElementRef,
  selectable,
  scrollable,
  side,
  sideOffset,
  updatePositionRef,
  variant,
}: TooltipContentProps) {
  const overlayOwner = useContext(OverlayOwnerContext);
  const positioningRef = useRef(positioningElement);
  const [arrowElement, setArrowElement] = useState<HTMLDivElement | null>(null);
  const [cssSide, setCssSide] = useState<"top" | "bottom">("top");
  const readsCssSide = side == null && variant === "tooltip" && (color === "default" || color === "classicLight");
  const [virtualReference] = useState(() => ({
    get contextElement() {
      return positioningRef.current ?? referenceElementRef.current ?? undefined;
    },
    getBoundingClientRect() {
      return pointerAnchorRef.current ?? positioningRef.current?.getBoundingClientRect() ?? referenceElementRef.current?.getBoundingClientRect() ?? EMPTY_RECT;
    },
  }));
  useLayoutEffect(() => {
    positioningRef.current = positioningElement;
    if (!followPointer) pointerAnchorRef.current = null;
  }, [followPointer, pointerAnchorRef, positioningElement]);

  const curvedArrow = coachmarkArrow === "curved";
  const horizontal = side === "left" || side === "right";
  const arrowWidth = curvedArrow ? (horizontal ? 14 : 36) : COACHMARK_ARROW_SIZE;
  const arrowHeight = curvedArrow ? (horizontal ? 36 : 14) : COACHMARK_ARROW_SIZE;
  const padding = color === "surface" || color === "inverse" ? "px-2 py-1.5" : "px-3 py-1.25";

  const floating = useFloatingPosition({
    reference: followPointer ? virtualReference : (positioningElement ?? virtualReference),
    placement: (align == null || align === "center" ? (side ?? (readsCssSide ? cssSide : "top")) : `${side ?? (readsCssSide ? cssSide : "top")}-${align}`) as FloatingPlacement,
    offset: () => {
      let mainAxis = sideOffset ?? 2;
      if (followPointer && pointerAnchorRef.current != null && sideOffset == null) mainAxis = 12;
      return { mainAxis, crossAxis: alignOffset ?? 0 };
    },
    flip: { padding: 8, flipAlignment, crossAxis: flipAlignment },
    shift: { padding: 8 },
    size: {
      padding: 8,
      apply({ availableWidth, availableHeight, floating: floatingElement, reference }) {
        floatingElement.style.setProperty("--radix-tooltip-trigger-width", `${Math.max(0, reference.width)}px`);
        floatingElement.style.setProperty("--radix-tooltip-content-available-width", `${Math.max(0, availableWidth)}px`);
        floatingElement.style.setProperty("--radix-tooltip-content-available-height", `${Math.max(0, availableHeight)}px`);
      },
    },
    arrow: variant === "coachmark" ? { element: arrowElement, padding: 16 } : undefined,
    onAutoUpdate() {
      const trigger = referenceElementRef.current;
      if (readsCssSide && trigger != null) {
        setCssSide(getComputedStyle(trigger).getPropertyValue("--side-tooltip").trim() === "bottom" ? "bottom" : "top");
      }
    },
  });

  useLayoutEffect(() => {
    if (updatePositionRef == null) return;
    updatePositionRef.current = floating.update;
    return () => {
      updatePositionRef.current = null;
    };
  }, [floating.update, updatePositionRef]);

  const resolvedSide = placementSide(floating.placement);
  const setFloating = floating.setFloating;
  const setContent = useCallback(
    (node: HTMLDivElement | null) => {
      setFloating(node);
      contentRef.current = node;
      if (node != null) placementSideRef.current = resolvedSide;
    },
    [contentRef, placementSideRef, resolvedSide, setFloating],
  );

  if (typeof document === "undefined") return null;

  const coachmarkArrowElement =
    variant === "coachmark" ? (
      <div
        ref={setArrowElement}
        className={clsx("pointer-events-none absolute", !curvedArrow && ["rotate-45 rounded-2xs", color === "surface" ? "bg-surface-elevated-secondary" : "bg-coachmark"])}
        style={{
          width: arrowWidth,
          height: arrowHeight,
          left: floating.arrow?.x,
          top: floating.arrow?.y,
          [oppositeSide[resolvedSide]]: -(curvedArrow ? 14 : COACHMARK_ARROW_SIZE / 2),
        }}
      >
        {curvedArrow && (
          <svg
            className={horizontal ? undefined : "rtl:-scale-x-100"}
            aria-hidden="true"
            width="100%"
            height="100%"
            viewBox={`0 0 ${arrowWidth} ${arrowHeight}`}
            fill={color === "surface" ? "var(--color-surface-elevated-secondary)" : "var(--color-background-coachmark)"}
          >
            <path
              d="M0 0C4 0 6.5 1.2963 8 4.40741C9.5 7.77778 9 10.8889 11 12.7037C12.25 13.7407 13.75 13.7407 15 12.4444C19.25 7.51852 25.5 2.59259 32 0.777778C33.75 0.259259 34.75 0 36 0H0Z"
              transform={{ top: undefined, bottom: "translate(0 14) scale(1 -1)", left: "matrix(0 -1 1 0 0 36)", right: "matrix(0 1 -1 0 14 0)" }[resolvedSide]}
            />
          </svg>
        )}
      </div>
    ) : null;

  return (
    <Portal container={portalContainer ?? getPortalRoot()}>
      <div
        id={id}
        ref={setContent}
        data-side={resolvedSide}
        data-overlay-owner={overlayOwner?.id}
        data-tooltip-keyboard-navigation={keyboardNavigation ? "" : undefined}
        aria-hidden={open ? undefined : "true"}
        hidden={!open && variant !== "unstyled"}
        role="tooltip"
        className={clsx(
          "ws-tooltip",
          `ws-tooltip--${variant}`,
          "w-fit text-sm whitespace-normal break-words",
          variant === "tooltip" && !scrollable && "min-h-min",
          scrollable && "overflow-y-auto",
          selectable ? "select-text" : "select-none",
          variant === "floating-navigation-rail" ? "z-20 flex flex-col" : clsx("z-50", variant !== "tooltip" && "flex flex-col", variant !== "tooltip" && variant !== "coachmark" && "m-px"),
          (variant === "rich" || variant === "entityPreview") && "bg-surface-elevated-secondary text-default ring-border shadow-xl-spread ring-[0.5px]",
          variant === "rich" && "rounded-xl",
          variant === "entityPreview" && "rounded-3xl",
          variant === "coachmark" &&
            clsx("relative rounded-2xl shadow-lg", color === "surface" ? "bg-surface-elevated-secondary text-default" : "bg-coachmark text-coachmark"),
          variant === "tooltip" && color === "default" && [css.textTheme, "text-center"],
          variant === "tooltip" && color === "classicLight" && "text-center",
          variant === "tooltip" && color === "surface" && "rounded-md bg-surface-elevated-secondary text-secondary ring-border shadow-xl-spread ring-[0.5px]",
          variant === "tooltip" &&
            color === "classicLight" &&
            "rounded-full border border-(color:--color-border-tooltip-classic) bg-(--color-background-tooltip-classic) text-(color:--color-text-tooltip-classic) text-[14px] leading-[18px] font-semibold tracking-(--tracking-tooltip) shadow-(--shadow-tooltip)",
          variant === "tooltip" &&
            color !== "surface" &&
            color !== "classicLight" &&
            (color === "inverse"
              ? "border-text bg-primary-solid text-primary-solid rounded-2xl border"
              : "rounded-2xl border border-(color:--color-border-tooltip) bg-(--color-background-tooltip) text-(color:--color-text-tooltip) leading-4.5 font-(weight:--tooltip-compact-font-weight) tracking-(--tracking-tooltip) shadow-(--shadow-tooltip)"),
          variant === "tooltip" && !disablePadding && padding,
          !open || (onPointerEnter == null && onPointerLeave == null) ? "pointer-events-none" : "pointer-events-auto",
          className,
        )}
        style={{
          ...floating.floatingStyles,
          maxWidth: maxWidth ?? "min(20rem, var(--radix-tooltip-content-available-width), calc(100vw - 16px))",
          maxHeight: "min(var(--radix-tooltip-content-available-height), calc(100vh - 16px))",
        }}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        {children}
        {coachmarkArrowElement}
      </div>
    </Portal>
  );
}
