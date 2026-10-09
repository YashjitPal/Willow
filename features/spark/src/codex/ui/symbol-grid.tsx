import clsx from "clsx";
import { useInView } from "framer-motion";
import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useIntl } from "react-intl";
import { PersonGroupLight16Icon } from "../icons";
import { Button } from "./button";
import { projectColorClasses } from "./project-appearance";
import { ProjectIcon } from "./project-icon";
import { SymbolSkeletonCell } from "./symbol-picker-layout";
import type { SymbolChoice, SymbolKind, SymbolSection } from "./symbol-picker-types";
import { useStableCallback } from "./use-stable-callback";

const css = { emoji: "_emoji_jqcth_2", compactButton: "_compactButton_jqcth_6", compactEmoji: "_compactEmoji_jqcth_14" } as const;

function cssZoom(element: Element) {
  return (element as Element & { currentCSSZoom?: number }).currentCSSZoom || 1;
}

/** `Xe1Component`: a team icon image, loaded once scrolled into view. */
function TeamIconGlyph({ url }: { url: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  return (
    <span ref={ref} className="relative flex size-6 items-center justify-center" data-symbol-glyph="" aria-hidden>
      {status === "loading" ? <SymbolSkeletonCell /> : null}
      {status === "error" ? <PersonGroupLight16Icon className="text-secondary" /> : null}
      {inView && status !== "error" ? (
        <img
          ref={(image) => {
            if (image?.complete) setStatus(image.naturalWidth > 0 ? "loaded" : "error");
          }}
          className="size-6 object-contain"
          alt=""
          draggable={false}
          hidden={status === "loading"}
          src={url}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
        />
      ) : null}
    </span>
  );
}

/** `NeComponent` */
function SymbolGlyph({ choice, compact }: { choice: SymbolChoice; compact: boolean }) {
  if (choice.kind === "emoji") {
    return (
      <span className={clsx(css.emoji, "relative leading-none", compact && [css.compactEmoji, "flex size-6 items-center justify-center"])} data-symbol-glyph="" aria-hidden>
        {choice.value}
      </span>
    );
  }
  if (choice.kind === "teamIcon") return <TeamIconGlyph key={choice.metadata.url} url={choice.metadata.url} />;
  return (
    <span className="relative" data-symbol-glyph="" aria-hidden>
      <ProjectIcon className={projectColorClasses[choice.metadata.color ?? "black"].accentClassName} icon={choice.value} size={20} />
    </span>
  );
}

interface SymbolRowProps {
  id: string;
  autoFocus: boolean;
  compact: boolean;
  columns: number;
  choices: SymbolChoice[];
  disabled: boolean;
  focusedColumn: number;
  highlightFirstResult: boolean;
  onFocusChoice: (sectionId: string, index: number) => void;
  onSelect: (choice: SymbolChoice, source: HTMLElement) => void;
  rowIndex: number;
  sectionId: string;
  selectedValues?: string[];
  trackPointer: boolean;
}

/** `MeComponent`: one row of symbol buttons; only the focused one is in the tab order. */
function SymbolRow({
  id,
  autoFocus,
  compact,
  columns,
  choices,
  disabled,
  focusedColumn,
  highlightFirstResult,
  onFocusChoice,
  onSelect,
  rowIndex,
  sectionId,
  selectedValues,
  trackPointer,
}: SymbolRowProps) {
  return (
    <div
      className={
        compact
          ? "flex w-max gap-2.5"
          : "grid grid-cols-8 gap-1 [contain-intrinsic-block-size:auto_calc(var(--spacing)*8)] [content-visibility:auto] focus-within:[content-visibility:visible]"
      }
      role="row"
    >
      {choices.slice(rowIndex * columns, (rowIndex + 1) * columns).map((choice, column) => {
        const index = rowIndex * columns + column;
        const focused = column === focusedColumn;
        const selected = selectedValues?.includes(choice.value);
        return (
          <div key={choice.value} className="flex justify-center" role="gridcell">
            <Button
              id={`${id}-${index}`}
              className={clsx("group/symbol relative", compact && [css.compactButton, "flex size-11 shrink-0 items-center justify-center rounded-full aria-pressed:bg-surface-tertiary"])}
              unstyled={compact}
              color={selected ? "secondary" : "ghostMuted"}
              radius="large"
              size="iconCircle"
              aria-label={choice.metadata.label}
              aria-pressed={selected}
              aria-disabled={compact ? disabled : undefined}
              autoFocus={autoFocus && focused}
              disabled={compact ? undefined : disabled}
              tabIndex={focused ? 0 : -1}
              onFocus={() => onFocusChoice(sectionId, index)}
              onPointerMove={() => {
                if (trackPointer) onFocusChoice(sectionId, index);
              }}
              onClick={(event) => {
                if (disabled) return;
                const button = event.currentTarget as HTMLButtonElement;
                onSelect(choice, compact ? (button.querySelector<HTMLElement>("[data-symbol-glyph]") ?? button) : button);
              }}
            >
              <span
                className={clsx(
                  "pointer-events-none absolute inset-0 bg-primary-ghost-hover opacity-0 group-focus-visible/symbol:opacity-100 group-active/symbol:opacity-100 pointer-fine:group-hover/symbol:opacity-100",
                  compact ? "rounded-full" : "rounded-lg",
                  (trackPointer ? focused : highlightFirstResult && column === 0) && "group-not-focus-within/symbol-grid:opacity-100",
                )}
                aria-hidden
              />
              <SymbolGlyph choice={choice} compact={compact} />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

interface SymbolSectionRowsProps {
  id: string;
  autoFocus: boolean;
  compact: boolean;
  disabled: boolean;
  focusedIndex: number;
  highlightFirstResult: boolean;
  onFocusChoice: (sectionId: string, index: number) => void;
  onSelect: (choice: SymbolChoice, source: HTMLElement) => void;
  section: SymbolSection;
  selectedValues?: string[];
  setSectionElement: (sectionId: string, element: HTMLElement | null) => void;
  showHeading: boolean;
  trackPointer: boolean;
}

/** `Je1Component`: a section's heading row and its rows of 8 (or a single row when compact). */
function SymbolSectionRows({
  id,
  autoFocus,
  compact,
  disabled,
  focusedIndex,
  highlightFirstResult,
  onFocusChoice,
  onSelect,
  section,
  selectedValues,
  setSectionElement,
  showHeading,
  trackPointer,
}: SymbolSectionRowsProps) {
  const columns = compact ? Math.max(1, section.choices.length) : 8;
  const sectionRef = useCallback((element: HTMLDivElement | null) => setSectionElement(section.id, element), [section.id, setSectionElement]);
  return (
    <div ref={sectionRef} className="flex flex-col gap-1" role="rowgroup" aria-label={section.heading}>
      {showHeading ? (
        <div role="row">
          <div className="truncate text-xs font-medium text-secondary" role="columnheader" aria-colspan={columns}>
            {section.heading}
          </div>
        </div>
      ) : null}
      {Array.from({ length: Math.ceil(section.choices.length / columns) }, (_, rowIndex) => (
        <SymbolRow
          key={section.choices[rowIndex * columns]?.value}
          id={id}
          autoFocus={autoFocus}
          compact={compact}
          columns={columns}
          choices={section.choices}
          disabled={disabled}
          focusedColumn={Math.floor(focusedIndex / columns) === rowIndex ? focusedIndex % columns : -1}
          highlightFirstResult={highlightFirstResult && rowIndex === 0}
          rowIndex={rowIndex}
          sectionId={section.id}
          selectedValues={selectedValues}
          trackPointer={trackPointer}
          onFocusChoice={onFocusChoice}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export interface SymbolGridProps {
  id: string;
  autoFocus?: boolean;
  compact?: boolean;
  disabled?: boolean;
  /** An outside element whose arrow keys, Enter and Tab drive the grid (via `aria-activedescendant`). */
  keyboardTarget?: HTMLElement | null;
  kind: SymbolKind;
  selectedValues?: string[];
  sections: SymbolSection[];
  showHeadings?: boolean;
  setSectionElement: (sectionId: string, element: HTMLElement | null) => void;
  focusedSectionId: string;
  focusedIndex: number;
  onFocusChoice: (sectionId: string, index: number) => void;
  highlightFirstResult: boolean;
  onSelect: (choice: SymbolChoice, source: HTMLElement) => void;
  onReturnToSearch: () => void;
}

/** `IeComponent`: the symbol grid with roving focus across sections. */
export function SymbolGrid({
  id,
  autoFocus = false,
  compact = false,
  disabled = false,
  keyboardTarget,
  kind,
  selectedValues,
  sections,
  showHeadings = true,
  setSectionElement,
  focusedSectionId,
  focusedIndex,
  onFocusChoice,
  highlightFirstResult,
  onSelect,
  onReturnToSearch,
}: SymbolGridProps) {
  const intl = useIntl();
  const gridRef = useRef<HTMLDivElement>(null);
  const focusedSectionIndex = sections.findIndex((section) => section.id === focusedSectionId);
  const activeDescendant = sections[focusedSectionIndex]?.choices[focusedIndex] == null ? undefined : `${id}-${focusedSectionIndex}-${focusedIndex}`;

  const handleKeyDown = (event: KeyboardEvent, fromKeyboardTarget: boolean) => {
    const grid = gridRef.current;
    if (grid == null || disabled || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const buttons = Array.from(grid.querySelectorAll("button"));
    const current = buttons.findIndex((button) => (fromKeyboardTarget ? button.id === activeDescendant : button === event.target));
    if (current < 0) return;
    const moveTo = (button: HTMLButtonElement | undefined) => {
      if (button == null) return;
      if (fromKeyboardTarget) {
        const position = buttons.indexOf(button);
        let offset = 0;
        for (const section of sections) {
          if (position < offset + section.choices.length) {
            onFocusChoice(section.id, position - offset);
            break;
          }
          offset += section.choices.length;
        }
        button.scrollIntoView({ block: "nearest" });
      } else {
        button.focus();
      }
    };
    const consume = () => {
      event.preventDefault();
      if (fromKeyboardTarget) event.stopPropagation();
    };
    if (fromKeyboardTarget && (event.key === "Enter" || event.key === "Tab")) {
      consume();
      buttons[current].click();
      return;
    }
    const rtl = getComputedStyle(grid).direction === "rtl";
    let next = current;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const rows = Array.from(grid.querySelectorAll('[role="row"]'), (row) => Array.from(row.querySelectorAll("button"))).filter((row) => row.length > 0);
      const rowIndex = rows.findIndex((row) => row.includes(buttons[current]));
      const column = rows[rowIndex].indexOf(buttons[current]);
      consume();
      if (event.key === "ArrowUp" && rowIndex === 0) {
        onReturnToSearch();
        return;
      }
      const row = rows[Math.max(0, Math.min(rows.length - 1, rowIndex + (event.key === "ArrowDown" ? 1 : -1)))];
      moveTo(row[Math.min(column, row.length - 1)]);
      return;
    }
    if (event.key === "ArrowRight") next += rtl ? -1 : 1;
    else if (event.key === "ArrowLeft") next += rtl ? 1 : -1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    consume();
    moveTo(buttons[compact ? (next + buttons.length) % buttons.length : Math.max(0, Math.min(buttons.length - 1, next))]);
  };

  const handleTargetKeyDown = useEffectEvent((event: KeyboardEvent) => handleKeyDown(event, true));

  useEffect(() => {
    if (keyboardTarget == null) return;
    const listener = (event: KeyboardEvent) => handleTargetKeyDown(event);
    const attributes = ["aria-autocomplete", "aria-controls", "aria-haspopup", "aria-activedescendant"];
    const previous = new Map(attributes.map((name) => [name, keyboardTarget.getAttribute(name)]));
    keyboardTarget.addEventListener("keydown", listener, true);
    keyboardTarget.setAttribute("aria-autocomplete", "list");
    keyboardTarget.setAttribute("aria-controls", id);
    keyboardTarget.setAttribute("aria-haspopup", "grid");
    return () => {
      keyboardTarget.removeEventListener("keydown", listener, true);
      for (const [name, value] of previous) {
        if (value == null) keyboardTarget.removeAttribute(name);
        else keyboardTarget.setAttribute(name, value);
      }
    };
  }, [id, keyboardTarget]);

  useEffect(() => {
    if (activeDescendant == null) keyboardTarget?.removeAttribute("aria-activedescendant");
    else keyboardTarget?.setAttribute("aria-activedescendant", activeDescendant);
  }, [activeDescendant, keyboardTarget]);

  const label =
    kind === "emoji"
      ? intl.formatMessage({
          id: "emoji.grid.label",
          defaultMessage: "Emojis",
          description: "Accessible label for the emoji selection grid",
        })
      : kind === "teamIcon"
        ? intl.formatMessage({
            id: "symbolPicker.teamIconGrid.label",
            defaultMessage: "Team icons",
            description: "Accessible label for the illustrated team icon selection grid",
          })
        : intl.formatMessage({
            id: "symbolPicker.iconGrid.label",
            defaultMessage: "Icons",
            description: "Accessible label for the icon selection grid",
          });

  return (
    <div
      id={id}
      ref={gridRef}
      className="group/symbol-grid flex flex-col gap-2"
      role="grid"
      tabIndex={-1}
      aria-label={label}
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => handleKeyDown(event.nativeEvent, false)}
    >
      {sections.map((section, sectionIndex) => (
        <SymbolSectionRows
          key={section.id}
          id={`${id}-${sectionIndex}`}
          autoFocus={autoFocus}
          compact={compact}
          disabled={disabled}
          section={section}
          selectedValues={selectedValues}
          showHeading={showHeadings}
          setSectionElement={setSectionElement}
          focusedIndex={section.id === focusedSectionId ? focusedIndex : -1}
          highlightFirstResult={highlightFirstResult && sectionIndex === 0}
          trackPointer={keyboardTarget != null}
          onFocusChoice={onFocusChoice}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function noop() {}

/** `useUe`: the section at the top of the scrolled results, and scrolling to a section. */
export function useSymbolSections({ container, sectionIds }: { container: HTMLElement | null; sectionIds: string[] }) {
  const sectionElements = useRef<Record<string, HTMLElement>>({});
  const setSectionElement = useCallback((sectionId: string, element: HTMLElement | null) => {
    if (element == null) {
      delete sectionElements.current[sectionId];
      return;
    }
    sectionElements.current[sectionId] = element;
  }, []);
  const scrollToSection = useStableCallback((sectionId: string) => {
    const element = sectionElements.current[sectionId];
    if (container == null || element == null) return;
    container.scrollTo({
      top:
        sectionId === sectionIds[0]
          ? 0
          : container.scrollTop +
            (element.getBoundingClientRect().top - container.getBoundingClientRect().top) / cssZoom(container) -
            (Number.parseFloat(getComputedStyle(container).scrollPaddingTop) || 0),
      behavior: "instant",
    });
  });
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (container == null) return noop;
      container.addEventListener("scroll", onChange, { passive: true });
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onChange);
      if (observer != null) {
        observer.observe(container);
        if (container.firstElementChild != null) observer.observe(container.firstElementChild);
        for (const sectionId of sectionIds) {
          const element = sectionElements.current[sectionId];
          if (element != null) observer.observe(element);
        }
      }
      return () => {
        container.removeEventListener("scroll", onChange);
        observer?.disconnect();
      };
    },
    [container, sectionIds],
  );
  const getActiveSectionId = useCallback(() => {
    if (sectionIds.length === 0) return null;
    if (container == null || container.scrollTop === 0) return sectionIds[0];
    const top = container.getBoundingClientRect().top + (Number.parseFloat(getComputedStyle(container).scrollPaddingTop) || 0) * cssZoom(container);
    let active = sectionIds[0];
    for (const sectionId of sectionIds) {
      const element = sectionElements.current[sectionId];
      if (element == null) continue;
      if (element.getBoundingClientRect().top > top) break;
      active = sectionId;
    }
    return active;
  }, [container, sectionIds]);
  const activeSectionId = useSyncExternalStore(subscribe, getActiveSectionId, getActiveSectionId);
  return { activeSectionId, scrollToSection, setSectionElement };
}
