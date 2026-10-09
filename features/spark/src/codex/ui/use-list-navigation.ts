import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { isMacPlatform } from "./accelerator";
import { useStableCallback } from "./use-stable-callback";

type NavigationKeyEvent = KeyboardEvent | ReactKeyboardEvent;

export interface ListNavigationOptions<T> {
  items: readonly T[] | null | undefined;
  isActive: boolean;
  getItemKey?: (item: T) => unknown;
  onSelect: (item: T, index: number) => void;
  onHighlight?: (item: T | null, index: number) => void;
  onEscape?: () => void;
  autoHighlightFirst?: boolean;
  clearHighlightOnMouseLeave?: boolean;
  /** Listens on `keyboardEventTarget` (the window by default) in the capture phase instead of through `getInputProps`. */
  captureWindowKeydown?: boolean;
  keyboardEventTarget?: EventTarget | null;
  preserveHighlightOnItemsChange?: boolean;
  /** Number keys 1 to 3 select that many leading items. */
  numberShortcutCount?: number;
  selectOnTab?: boolean;
  shouldHandleKeyDown?: (event: KeyboardEvent) => boolean;
}

function wrapIndex(index: number, count: number) {
  return ((index % count) + count) % count;
}

function consume(event: NavigationKeyEvent) {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * `qR` (app-initial `nBo`): keyboard and pointer highlight over a result list driven from an input. Items carry
 * `data-list-navigation-item`; the highlighted one scrolls into view unless the pointer moved it.
 */
export function useListNavigation<T>({
  items,
  isActive,
  getItemKey,
  onSelect,
  onHighlight,
  onEscape,
  autoHighlightFirst = true,
  clearHighlightOnMouseLeave = false,
  captureWindowKeydown = false,
  keyboardEventTarget,
  preserveHighlightOnItemsChange = false,
  numberShortcutCount = 0,
  selectOnTab = false,
  shouldHandleKeyDown,
}: ListNavigationOptions<T>) {
  const isMac = isMacPlatform();
  const listRef = useRef<HTMLDivElement>(null);
  const pointerIndex = useRef<number | null>(null);
  const previousItems = useRef<readonly T[] | null | undefined>(null);
  const count = items?.length ?? 0;
  const [highlightedIndex, setHighlightedIndex] = useState(autoHighlightFirst && count > 0 ? 0 : -1);
  const highlighted = isActive && highlightedIndex >= 0 && highlightedIndex < count ? (items?.[highlightedIndex] ?? null) : null;
  const highlightedKey = highlighted == null ? null : (getItemKey?.(highlighted) ?? highlighted);
  const notifyHighlight = useEffectEvent((index: number) => onHighlight?.(items?.[index] ?? null, index));

  useEffect(() => {
    const previous = previousItems.current;
    const changed = previous != null && (items == null || previous.length !== count || previous.some((item, index) => item !== items[index]));
    previousItems.current = items;
    if (!isActive || count === 0) {
      if (highlightedIndex !== -1) setHighlightedIndex(-1);
      return;
    }
    if (highlightedIndex >= 0 && highlightedIndex < count && ((preserveHighlightOnItemsChange && getItemKey == null) || !changed)) return;
    const previousItem = previous?.[highlightedIndex];
    const preserved = preserveHighlightOnItemsChange && getItemKey != null && previousItem != null ? (items?.findIndex((item) => getItemKey(item) === getItemKey(previousItem)) ?? -1) : -1;
    const next = preserved >= 0 ? preserved : autoHighlightFirst ? 0 : -1;
    if (highlightedIndex !== next) setHighlightedIndex(next);
  }, [autoHighlightFirst, getItemKey, highlightedIndex, isActive, items, count, preserveHighlightOnItemsChange]);

  useEffect(() => {
    notifyHighlight(highlightedKey == null ? -1 : highlightedIndex);
  }, [highlightedIndex, highlightedKey]);

  useEffect(() => {
    const fromPointer = pointerIndex.current === highlightedIndex;
    pointerIndex.current = null;
    if (!isActive || fromPointer || highlightedIndex < 0 || highlightedIndex >= count) return;
    listRef.current?.querySelectorAll(`[data-list-navigation-item="true"]`).item(highlightedIndex)?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, isActive, count]);

  const select = useStableCallback((index: number) => {
    const item = items != null && index >= 0 && index < count ? items[index] : undefined;
    if (item === undefined) return;
    setHighlightedIndex(index);
    onSelect(item, index);
  });
  const highlightFromPointer = useStableCallback((index: number) => {
    if (!isActive || index < 0 || index >= count || index === highlightedIndex) return;
    pointerIndex.current = index;
    setHighlightedIndex(index);
  });
  const move = (step: number) => {
    pointerIndex.current = null;
    setHighlightedIndex((current) => (count === 0 ? -1 : current < 0 ? (step >= 0 ? 0 : count - 1) : wrapIndex(current + step, count)));
  };

  const handleKeyDown = (event: NavigationKeyEvent) => {
    if (!isActive) return false;
    const native = "nativeEvent" in event ? event.nativeEvent : event;
    if (shouldHandleKeyDown?.(native) === false || native.isComposing || native.keyCode === 229) return false;
    const { key } = event;
    if (count === 0) {
      if (key !== "Escape" || onEscape == null) return false;
      onEscape();
      consume(event);
      return true;
    }
    if (key === "ArrowDown" || (isMac && event.ctrlKey && key === "n")) {
      move(1);
      consume(event);
      return true;
    }
    if (key === "ArrowUp" || (isMac && event.ctrlKey && key === "p")) {
      move(-1);
      consume(event);
      return true;
    }
    if (numberShortcutCount > 0 && !event.ctrlKey && !event.metaKey && !event.altKey && /^[1-3]$/.test(key) && Number(key) <= Math.min(numberShortcutCount, count)) {
      select(Number(key) - 1);
      consume(event);
      return true;
    }
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if ((key === "Enter" && plain) || (selectOnTab && key === "Tab" && plain)) {
      const index = highlightedIndex >= 0 ? highlightedIndex : autoHighlightFirst ? 0 : -1;
      if (index < 0 || index >= count) return false;
      select(index);
      consume(event);
      return true;
    }
    if (key !== "Escape" || onEscape == null) return false;
    onEscape();
    consume(event);
    return true;
  };
  const onCapturedKeyDown = useEffectEvent((event: KeyboardEvent) => {
    handleKeyDown(event);
  });

  useEffect(() => {
    if (!captureWindowKeydown || !isActive) return;
    const target = keyboardEventTarget ?? window;
    const listener = (event: Event) => onCapturedKeyDown(event as KeyboardEvent);
    target.addEventListener("keydown", listener, true);
    return () => target.removeEventListener("keydown", listener, true);
  }, [captureWindowKeydown, isActive, keyboardEventTarget]);

  const getInputProps = <E extends Element>(props: { onKeyDown?: (event: ReactKeyboardEvent<E>) => void } = {}) => ({
    onKeyDown: (event: ReactKeyboardEvent<E>) => {
      if (!handleKeyDown(event)) props.onKeyDown?.(event);
    },
  });
  const getItemProps = <E extends Element>(index: number, props: { onClick?: (event: ReactMouseEvent<E>) => void; onMouseMove?: (event: ReactMouseEvent<E>) => void } = {}) => ({
    onClick: (event: ReactMouseEvent<E>) => {
      select(index);
      props.onClick?.(event);
    },
    onMouseMove: (event: ReactMouseEvent<E>) => {
      highlightFromPointer(index);
      props.onMouseMove?.(event);
    },
    onMouseLeave: () => {
      if (clearHighlightOnMouseLeave) setHighlightedIndex(-1);
    },
    "data-list-navigation-item": "true" as const,
  });

  return { highlightedIndex, setHighlightedIndex, listRef, handleKeyDown, getInputProps, getItemProps };
}
