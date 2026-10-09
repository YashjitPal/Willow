import clsx from "clsx";
import { motion } from "framer-motion";
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { useReducedMotion } from "../../codex/lib/theme-engine";
import { CheckmarkMdLight16Icon, ChevronDownMdLight16Icon, CodeLight16Icon, LinkLight16Icon, TextItalicSmLight16Icon } from "../../codex/icons";
import { Button, DropdownMenu, Menu, Tooltip } from "../../codex/ui";
import { formatAccelerator } from "../../codex/ui/accelerator";
import type { BlockStyle } from "./document-model";
import { formatMessages } from "./messages";
import { menuEase } from "./slash-menu";
import type { PageMark } from "./state/page-document";
import { getPortalRoot } from "../../codex/ui/portal-root";

function preventDefault(event: MouseEvent) {
  event.preventDefault();
}

/** Places a fixed element beside a viewport rect, flipping and shifting to stay `padding` px inside the window. */
export function useAnchoredStyle(anchor: DOMRect | null, placement: "top" | "bottom-start", offset = 8, padding = 8) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", left: 0, top: 0, visibility: "hidden" });
  const [availableHeight, setAvailableHeight] = useState(() => window.innerHeight - 2 * padding);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element == null || anchor == null) return;
    const { width, height } = element.getBoundingClientRect();
    const below = window.innerHeight - padding - anchor.bottom - offset;
    const above = anchor.top - offset - padding;
    let top = placement === "top" ? anchor.top - offset - height : anchor.bottom + offset;
    let available = placement === "top" ? above : below;
    if (placement === "top" && top < padding) {
      top = anchor.bottom + offset;
      available = below;
    }
    if (placement === "bottom-start" && height > below && above > below) {
      available = above;
      top = Math.max(padding, anchor.top - offset - Math.min(height, above));
    }
    const preferredLeft = placement === "top" ? anchor.left + anchor.width / 2 - width / 2 : anchor.left;
    const left = Math.max(padding, Math.min(preferredLeft, window.innerWidth - padding - width));
    setStyle((current) => (current.left === left && current.top === top && current.visibility == null ? current : { position: "fixed", left, top }));
    setAvailableHeight(Math.max(0, available));
  });
  return [ref, style, availableHeight] as const;
}

/** `JM1`: the elevated pill shared by the selection toolbar and task toolbars. */
export function SelectionToolbarFrame({ children, mode = "actions", preserveSelection }: { children?: ReactNode; mode?: "actions" | "edit" | "link"; preserveSelection?: boolean }) {
  const reducedMotion = useReducedMotion();
  const transition = { duration: reducedMotion ? 0 : 0.15, ease: menuEase };
  return (
    <motion.div
      className={clsx(
        "ws-floating-toolbar pointer-events-auto m-0 max-w-full min-w-0 shrink overflow-hidden bg-surface-elevated-secondary p-1 font-sans font-normal not-italic shadow-lg ring-[0.5px] ring-border select-none",
        mode === "actions" ? "w-fit" : "w-full",
      )}
      initial={false}
      layout={!reducedMotion}
      layoutDependency={mode}
      animate={{ borderRadius: mode === "actions" ? "var(--radius-xl)" : "var(--radius-token-composer-single-line)" }}
      transition={transition}
      role="presentation"
      onMouseDown={(preserveSelection ?? mode === "actions") ? preventDefault : undefined}
    >
      <motion.div className="flex w-full min-w-0 flex-wrap items-center gap-1" layout={reducedMotion ? false : "position"} layoutDependency={mode} transition={transition}>
        {children}
      </motion.div>
    </motion.div>
  );
}

/** `NM` */
export function ToolbarSeparator() {
  return <div aria-hidden className="mx-1 h-3 w-px shrink-0 bg-border" />;
}

const textStyles: { style: BlockStyle; message: MessageDescriptor; shortcut?: string }[] = [
  { style: "paragraph", message: formatMessages.textStyleText },
  { style: "heading1", message: formatMessages.textStyleHeading1 },
  { style: "heading2", message: formatMessages.textStyleHeading2 },
  { style: "heading3", message: formatMessages.textStyleHeading3 },
  { style: "orderedList", message: formatMessages.textStyleNumberedList, shortcut: "CmdOrCtrl+Alt+4" },
  { style: "unorderedList", message: formatMessages.textStyleBulletedList, shortcut: "CmdOrCtrl+Alt+5" },
  { style: "checklist", message: formatMessages.textStyleChecklist, shortcut: "CmdOrCtrl+Alt+6" },
  { style: "quote", message: formatMessages.textStyleQuote },
  { style: "code", message: formatMessages.textStyleCodeBlock },
];

/** `ZN1`: the "Text styles" dropdown at the end of the selection toolbar. */
function TextStyleMenu({ activeStyle, onSelect }: { activeStyle: BlockStyle | null; onSelect: (style: BlockStyle) => void }) {
  const intl = useIntl();
  const label = intl.formatMessage(formatMessages.textStyles);
  const active = textStyles.find((entry) => entry.style === activeStyle);
  return (
    <DropdownMenu
      align="start"
      contentWidth="menuBounded"
      triggerButton={
        <Button aria-label={label} color="ghostActive" size="toolbar" onMouseDown={preventDefault}>
          {active == null ? label : intl.formatMessage(active.message)}
          <ChevronDownMdLight16Icon />
        </Button>
      }
    >
      {textStyles.map((entry) => {
        const checked = entry.style === activeStyle;
        return (
          <Menu.Item
            key={entry.style}
            aria-checked={checked}
            RightIcon={checked ? CheckmarkMdLight16Icon : undefined}
            keyboardShortcut={entry.shortcut == null ? undefined : formatAccelerator(entry.shortcut)}
            role="menuitemradio"
            onSelect={() => onSelect(entry.style)}
          >
            <FormattedMessage {...entry.message} />
          </Menu.Item>
        );
      })}
    </DropdownMenu>
  );
}

const markActions: { mark: PageMark; label: MessageDescriptor }[] = [
  { mark: "bold", label: formatMessages.bold },
  { mark: "italic", label: formatMessages.italic },
  { mark: "underline", label: formatMessages.underline },
  { mark: "strikethrough", label: formatMessages.strikethrough },
  { mark: "code", label: formatMessages.code },
];

function MarkGlyph({ mark }: { mark: PageMark }) {
  switch (mark) {
    case "bold":
      return (
        <strong aria-hidden>
          <FormattedMessage {...formatMessages.boldAbbreviation} />
        </strong>
      );
    case "italic":
      return <TextItalicSmLight16Icon />;
    case "underline":
      return (
        <u aria-hidden>
          <FormattedMessage {...formatMessages.underlineAbbreviation} />
        </u>
      );
    case "strikethrough":
      return (
        <s aria-hidden>
          <FormattedMessage {...formatMessages.strikethroughAbbreviation} />
        </s>
      );
    case "code":
      return <CodeLight16Icon />;
  }
}

/** `GN`'s positioned `[data-page-selection-toolbar]` layer above the selection. */
export function SelectionToolbarLayer({ pageId, anchor, children }: { pageId: string; anchor: DOMRect; children: ReactNode }) {
  const [ref, style] = useAnchoredStyle(anchor, "top");
  return createPortal(
    <div ref={ref} className="z-50 max-w-full" data-page-selection-toolbar={pageId} style={style}>
      <div>{children}</div>
    </div>,
    getPortalRoot(),
  );
}

interface SelectionToolbarProps {
  canWrite: boolean;
  activeMarks: ReadonlySet<PageMark>;
  activeStyle: BlockStyle | null;
  linkActive: boolean;
  commentAction: ReactNode;
  onToggleMark: (mark: PageMark) => void;
  onSelectStyle: (style: BlockStyle) => void;
  onEditLink: () => void;
}

/** `GN`'s "actions" mode (`Me`): marks, link, text style and the Comment action above a text selection. */
export function SelectionToolbar({ canWrite, activeMarks, activeStyle, linkActive, commentAction, onToggleMark, onSelectStyle, onEditLink }: SelectionToolbarProps) {
  const intl = useIntl();
  const linkLabel = intl.formatMessage(formatMessages.link);
  return (
    <SelectionToolbarFrame>
      {!canWrite && commentAction}
      {canWrite ? (
        <>
          {markActions.map(({ mark, label }) => {
            const isActive = activeMarks.has(mark);
            const text = intl.formatMessage(label);
            return (
              <Tooltip key={mark} cloneCustomTrigger sideOffset={8} tooltipContent={text}>
                <Button color={isActive ? "accentSubtle" : "ghostActive"} size="toolbar" aria-label={text} aria-pressed={isActive} uniform onClick={() => onToggleMark(mark)}>
                  <MarkGlyph mark={mark} />
                </Button>
              </Tooltip>
            );
          })}
          <Button color={linkActive ? "accentSubtle" : "ghostActive"} size="toolbar" aria-label={linkLabel} aria-pressed={linkActive} uniform onClick={onEditLink}>
            <LinkLight16Icon />
          </Button>
          <TextStyleMenu activeStyle={activeStyle} onSelect={onSelectStyle} />
          {commentAction == null ? null : (
            <>
              <ToolbarSeparator />
              {commentAction}
            </>
          )}
        </>
      ) : null}
    </SelectionToolbarFrame>
  );
}
