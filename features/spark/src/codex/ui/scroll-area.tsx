import clsx from "clsx";
import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { composeRefs } from "./compose-refs";

const scrollAreaCss = { Mask: "_Mask_g5dvy_1", Root: "_Root_g5dvy_14" } as const;

export type ScrollAreaFade = "overlay" | "mask" | "divider" | "none";

export interface ScrollAreaProps {
  children?: ReactNode;
  className?: string;
  fade?: ScrollAreaFade;
  fadeClassName?: string;
  /** Caps the viewport so the last visible menu item is cut through its middle, hinting at more rows. */
  peekMenuItems?: boolean;
  scrollClassName?: string;
  scrollProps?: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> };
}

const menuItemSelector = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

/** Scroll container that exposes its overflow state for fades (`_C` in the bundles). */
export function ScrollArea({ children, className, fade = "overlay", fadeClassName, peekMenuItems = false, scrollClassName, scrollProps }: ScrollAreaProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (root == null || viewport == null || content == null) return;
    const update = () => {
      const hasOverflow = (fade === "overlay" ? content : viewport).scrollHeight > viewport.clientHeight + 1;
      const canScrollDown = viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1;
      root.dataset.hasOverflow = hasOverflow ? "true" : "false";
      root.dataset.canScrollUp = viewport.scrollTop > 1 ? "true" : "false";
      root.dataset.canScrollDown = hasOverflow && canScrollDown ? "true" : "false";
    };
    const initialMaxHeight = viewport.style.maxHeight;
    let peekMaxHeight: string | undefined;
    const measure = () => {
      if (peekMenuItems) {
        const scrollTop = viewport.scrollTop;
        viewport.style.maxHeight = initialMaxHeight;
        peekMaxHeight = undefined;
        const visibleHeight = viewport.clientHeight;
        if (viewport.scrollHeight > visibleHeight + 1) {
          const viewportRect = viewport.getBoundingClientRect();
          const scale = viewportRect.height / viewport.offsetHeight;
          let cut = 0;
          if (scale > 0) {
            for (const item of content.querySelectorAll(menuItemSelector)) {
              const rect = item.getBoundingClientRect();
              const middle = (rect.top - viewportRect.top + rect.height / 2) / scale - viewport.clientTop + viewport.scrollTop;
              if (rect.height > 0 && middle <= visibleHeight) cut = Math.max(cut, middle);
            }
          }
          if (cut > 0) {
            peekMaxHeight = `${cut}px`;
            viewport.style.maxHeight = peekMaxHeight;
          }
        }
        viewport.scrollTop = scrollTop;
      }
      update();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    const mutations = peekMenuItems ? new MutationObserver(measure) : undefined;
    mutations?.observe(content, { childList: true, characterData: true, subtree: true });
    if (peekMenuItems) window.addEventListener("resize", measure);
    viewport.addEventListener("scroll", update, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      mutations?.disconnect();
      window.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", update);
      if (viewport.style.maxHeight === peekMaxHeight) viewport.style.maxHeight = initialMaxHeight;
    };
  }, [fade, peekMenuItems]);

  const { ref: scrollRef, className: scrollPropsClassName, ...viewportProps } = scrollProps ?? {};
  return (
    <div
      ref={rootRef}
      data-can-scroll-down="false"
      data-can-scroll-up="false"
      data-has-overflow="false"
      className={clsx("group", scrollAreaCss.Root, className)}
    >
      <div
        {...viewportProps}
        ref={composeRefs(viewportRef, scrollRef)}
        className={clsx(fade === "mask" && scrollAreaCss.Mask, scrollClassName, scrollPropsClassName)}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {fade === "divider" && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 hidden border-t border-subtle group-data-[can-scroll-up=true]:block"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 hidden border-t border-subtle group-data-[can-scroll-down=true]:block"
          />
        </>
      )}
      {fade === "overlay" && (
        <div
          className={clsx(
            "pointer-events-none absolute bottom-0 hidden h-10 bg-gradient-to-b from-transparent to-surface-elevated-secondary/90 group-data-[can-scroll-down=true]:block",
            fadeClassName,
          )}
        />
      )}
    </div>
  );
}
