import clsx from "clsx";
import { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { Button, type ButtonColor, type ButtonProps } from "./button";

const headerCss = { header: "_header_1oxlz_1", contentFade: "_contentFade_1oxlz_31" } as const;
const fadeCss = { background: "_background_18gud_1" } as const;
const controlCss = {
  controlSurface: "_controlSurface_14ans_2",
  inputSurface: "_inputSurface_14ans_2",
  capsule: "_capsule_14ans_2",
  control: "_control_14ans_2",
  group: "_group_14ans_2",
  joined: "_joined_14ans_2",
  zoomGroup: "_zoomGroup_14ans_2",
} as const;

/** Gap kept between the leading and trailing groups when both are visible (`Kki`). */
const SIDE_GAP = 80;

export interface ViewerHeaderItem {
  id: string;
  content: ReactNode;
  /** Lower priorities collapse their `[data-viewer-header-collapsible]` regions first. */
  collapsePriority?: number;
  collapseSteps?: { priority: number; selector: string }[];
  /** Lower priorities hide the whole item first; items without one never hide. */
  hidePriority?: number;
  allowShrink?: boolean;
  grow?: boolean;
}

export interface ViewerHeaderProps {
  className?: string;
  contentFade?: boolean;
  placement?: string;
  density?: "regular" | "surface";
  inset?: boolean;
  layout?: "single-row" | "wrap-leading";
  label?: string;
  leading: ViewerHeaderItem[];
  trailing?: ViewerHeaderItem[];
}

type SidedItem = ViewerHeaderItem & { side: "leading" | "trailing" };
type MeasuredItem = SidedItem & { width: number };

function hasContent({ content }: ViewerHeaderItem) {
  return content != null && content !== false;
}

/**
 * Viewer header row (`ny` in the bundles): leading and trailing item groups that collapse marked regions
 * and then hide whole items by priority until the row fits its width.
 */
export function ViewerHeader({ className, contentFade, placement, density = "regular", inset = true, layout = "single-row", label, leading, trailing }: ViewerHeaderProps) {
  const headerRef = useRef<HTMLElement>(null);
  const leadingRef = useRef<HTMLDivElement>(null);
  const trailingRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [visibleSides, setVisibleSides] = useState({ leading: false, trailing: false });
  const items: SidedItem[] = [
    ...leading.map((item) => ({ ...item, side: "leading" as const })),
    ...(trailing ?? []).map((item) => ({ ...item, side: "trailing" as const })),
  ].filter(hasContent);
  const itemsKey = items.map((item) => item.id).join("|");

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (header == null || layout === "wrap-leading") return;
    const collapsed = new Set<HTMLElement>();
    const reveal = (element: HTMLElement) => {
      element.style.display = "";
      element.removeAttribute("data-viewer-header-collapsed");
    };
    const updateSides = (leadingCount: number, trailingCount: number) => {
      const next = { leading: leadingCount > 0, trailing: trailingCount > 0 };
      setVisibleSides((current) => (current.leading === next.leading && current.trailing === next.trailing ? current : next));
    };
    const measure = () => {
      const style = getComputedStyle(header);
      const leadingGap = parseFloat(getComputedStyle(leadingRef.current ?? header).columnGap) || 0;
      const trailingGap = parseFloat(getComputedStyle(trailingRef.current ?? header).columnGap) || 0;
      const available = header.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      for (const element of collapsed) reveal(element);
      for (const { id, allowShrink } of items) {
        const element = itemRefs.current.get(id);
        if (allowShrink && element != null) element.style.flexShrink = header.clientWidth === 0 ? "" : "0";
      }
      const selectors = new Set(["[data-viewer-header-collapsible]", ...items.flatMap((item) => item.collapseSteps?.map((step) => step.selector) ?? [])]);
      for (const selector of selectors) {
        for (const element of header.querySelectorAll<HTMLElement>(selector)) {
          collapsed.add(element);
          reveal(element);
        }
      }
      const measured: MeasuredItem[] = items.flatMap((item) => {
        const element = itemRefs.current.get(item.id);
        return element?.hasChildNodes() ? [{ ...item, width: element.offsetWidth }] : [];
      });
      let leadingCount = measured.filter((item) => item.side === "leading").length;
      let trailingCount = measured.length - leadingCount;
      if (header.clientWidth === 0) {
        setHiddenIds((current) => (current.length === 0 ? current : []));
        updateSides(leadingCount, trailingCount);
        return;
      }
      let total = measured.reduce((sum, item) => sum + item.width, 0);
      const hidden: string[] = [];
      const steps = measured
        .flatMap((item) => {
          const element = itemRefs.current.get(item.id);
          const regionSteps = (item.collapseSteps ?? []).map(({ priority, selector }) => ({
            item,
            priority,
            regions: Array.from(element?.querySelectorAll<HTMLElement>(selector) ?? []) as HTMLElement[] | null,
          }));
          if (item.collapsePriority != null) {
            regionSteps.push({ item, priority: item.collapsePriority, regions: Array.from(element?.querySelectorAll<HTMLElement>("[data-viewer-header-collapsible]") ?? []) });
          }
          return [...regionSteps, { item, priority: item.hidePriority, regions: null }];
        })
        .sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity));
      const required = () =>
        total + Math.max(0, leadingCount - 1) * leadingGap + Math.max(0, trailingCount - 1) * trailingGap + (leadingCount > 0 && trailingCount > 0 ? SIDE_GAP : 0);
      for (const { item, priority, regions } of steps) {
        if (required() <= available) break;
        if (priority == null || hidden.includes(item.id)) continue;
        if (regions != null) {
          for (const region of regions) {
            collapsed.add(region);
            region.style.display = "none";
            region.setAttribute("data-viewer-header-collapsed", "");
          }
          const width = itemRefs.current.get(item.id)?.offsetWidth ?? 0;
          total -= item.width - width;
          item.width = width;
        } else {
          hidden.push(item.id);
          total -= item.width;
          if (item.side === "leading") leadingCount -= 1;
          else trailingCount -= 1;
        }
      }
      for (const { id, allowShrink } of items) {
        const element = itemRefs.current.get(id);
        if (allowShrink && element != null) element.style.flexShrink = "";
      }
      updateSides(leadingCount, trailingCount);
      setHiddenIds((current) => (current.length === hidden.length && current.every((id, index) => id === hidden[index]) ? current : hidden));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    for (const element of itemRefs.current.values()) observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      for (const element of collapsed) reveal(element);
    };
    // Re-measures when the set of item ids changes, not on every content re-render.
  }, [itemsKey, layout]);

  const renderSide = (sideItems: SidedItem[], ref: Ref<HTMLDivElement>, isTrailing = false) => {
    if (sideItems.length === 0) return null;
    return (
      <div
        ref={ref}
        className={clsx(
          "flex items-center",
          layout === "wrap-leading" && !isTrailing ? "min-w-0 flex-wrap gap-2" : ["gap-1.5", sideItems.some((item) => item.allowShrink) ? "min-w-0 shrink" : "shrink-0"],
          sideItems.some((item) => item.grow) && "min-w-0 flex-1",
          isTrailing && "ms-auto",
          isTrailing && layout === "wrap-leading" && "col-start-2",
        )}
      >
        {sideItems.map(({ id, content, allowShrink, grow }) => {
          const hidden = layout === "single-row" && hiddenIds.includes(id);
          return (
            <div
              key={id}
              ref={(element) => {
                if (element == null) itemRefs.current.delete(id);
                else itemRefs.current.set(id, element);
              }}
              className={clsx(
                "pointer-events-auto flex w-max items-center gap-1.5 empty:hidden",
                allowShrink ? "min-w-0 shrink" : "shrink-0",
                layout === "wrap-leading" && !isTrailing && "max-w-full",
                grow && "min-w-0 flex-1",
                contentFade && "z-10",
                hidden && "invisible absolute start-0 top-0",
              )}
              aria-hidden={hidden || undefined}
              inert={hidden}
            >
              {content}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <header
      ref={headerRef}
      aria-label={label}
      className={clsx(
        headerCss.header,
        className,
        "pointer-events-none z-30 min-w-0 shrink-0 text-sm select-none",
        layout === "wrap-leading" ? "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2" : "flex items-center",
        inset && "py-2 ps-[calc(var(--spacing)*2+var(--viewer-header-start-inset,0px))] pe-2",
      )}
      data-viewer-content-fade={contentFade || undefined}
      data-viewer-placement={placement}
      data-viewer-density={density}
      data-testid="viewer-header"
    >
      {contentFade ? (
        <div aria-hidden className={headerCss.contentFade}>
          <div className={fadeCss.background} />
        </div>
      ) : null}
      {renderSide(
        items.filter((item) => item.side === "leading"),
        leadingRef,
      )}
      {layout === "single-row" && visibleSides.leading && visibleSides.trailing ? <div aria-hidden className="min-w-20 flex-1" /> : null}
      {renderSide(
        items.filter((item) => item.side === "trailing"),
        trailingRef,
        true,
      )}
    </header>
  );
}

export type FloatingControlCapsuleProps = HTMLAttributes<HTMLDivElement> & { variant?: "default" | "input" };

/** Rounded control surface (`VEi1` in the bundles). */
export function FloatingControlCapsule({ className, variant = "default", ...rest }: FloatingControlCapsuleProps) {
  return <div className={clsx(controlCss.capsule, controlCss.controlSurface, variant === "input" && controlCss.inputSurface, "rounded-full", className)} {...rest} />;
}

export interface FloatingControlGroupProps {
  hideWhenEmpty?: boolean;
  children?: ReactNode;
  label?: string;
  shrink?: boolean;
  variant?: "default" | "joined" | "zoom";
}

/** Labelled group of viewer controls on one capsule (`ox` in the bundles). */
export function FloatingControlGroup({ hideWhenEmpty = false, children, label, shrink = false, variant = "default" }: FloatingControlGroupProps) {
  return (
    <FloatingControlCapsule
      aria-label={label}
      className={clsx(
        "ws-control-group",
        controlCss.group,
        variant === "joined" && controlCss.joined,
        variant === "zoom" && controlCss.zoomGroup,
        hideWhenEmpty && "empty:hidden",
        "inline-flex items-center border-0 text-default",
        shrink ? "min-w-0" : "shrink-0",
        (variant === "joined" || variant === "zoom") && "gap-0",
      )}
      role="group"
    >
      {children}
    </FloatingControlCapsule>
  );
}

export type FloatingControlIconButtonProps = Omit<ButtonProps, "color"> & { color?: ButtonColor };

/** Round icon control inside a viewer control group (`ix` in the bundles). */
export function FloatingControlIconButton({ className, color = "ghostActive", uniform, ...rest }: FloatingControlIconButtonProps) {
  return <Button className={clsx(controlCss.control, className)} color={color} radius="full" uniform={uniform} {...(rest as ButtonProps)} />;
}
