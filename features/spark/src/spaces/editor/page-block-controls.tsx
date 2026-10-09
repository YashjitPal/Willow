import clsx from "clsx";
import { AnimatePresence, useIsPresent } from "framer-motion";
import { createContext, Fragment, useContext, useEffect, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import {
  ArrowDownLgLight16Icon,
  ArrowLeftArrowRightLight16Icon,
  ArrowLeftLgLight16Icon,
  ArrowRightLgLight16Icon,
  ArrowsClockwiseRotateLgLight16Icon,
  ArrowUpMdLight16Icon,
  ArrowUpRightMdLight16Icon,
  CheckmarkMdLight16Icon,
  CheckmarkSquareLight16Icon,
  CodeLight16Icon,
  DragLight16Icon,
  EllipsisHorizontalLight12Icon,
  EllipsisHorizontalLight16Icon,
  LinkLight16Icon,
  ListBulletLight16Icon,
  ListNumberLight16Icon,
  PlusLgLight16Icon,
  QuotemarkLight16Icon,
  SquareOnSquareLight16Icon,
  SquareTextFormatLight16Icon,
  TextAlignleftLight16Icon,
  TextStyleSmLight16Icon,
  TrashLight16Icon,
} from "../../codex/icons";
import { Button, DropdownMenu, Menu, Tooltip } from "../../codex/ui";
import { pageActionMessages } from "../menus/page-actions";
import { pageCss } from "./css";
import { blockStyle, type BlockStyle } from "./document-model";
import { controlMessages, tableMessages } from "./messages";
import type { PageBlock, PageBlockLayout } from "./state/page-document";
import type { TableFitMode } from "./table-fit";
import type { TableAxis, TableAxisAction } from "./table-model";

export type BlockAction =
  | { kind: "turnInto"; style: BlockStyle }
  | { kind: "insertBelow" }
  | { kind: "copyLink" }
  | { kind: "copyMarkdown" }
  | { kind: "layout"; layout: PageBlockLayout }
  | { kind: "fit"; mode: TableFitMode }
  | { kind: "distributeColumns" }
  /** `wholeList`: Option or Alt was held on a list row's menu, so the whole list goes. */
  | { kind: "delete"; wholeList?: boolean };

/** What a control menu targets: a whole block, or one row or column of a table. */
export type ControlKind = "block" | TableAxis;

type MenuIcon = typeof TextAlignleftLight16Icon;

/** `eH`: the Turn into styles, in menu order. */
const turnIntoStyles: { style: BlockStyle; icon: MenuIcon; label: MessageDescriptor }[] = [
  { style: "paragraph", icon: TextAlignleftLight16Icon, label: controlMessages.turnIntoText },
  { style: "heading1", icon: TextStyleSmLight16Icon, label: controlMessages.turnIntoHeading1 },
  { style: "heading2", icon: TextStyleSmLight16Icon, label: controlMessages.turnIntoHeading2 },
  { style: "heading3", icon: TextStyleSmLight16Icon, label: controlMessages.turnIntoHeading3 },
  { style: "heading4", icon: TextStyleSmLight16Icon, label: controlMessages.turnIntoHeading4 },
  { style: "heading5", icon: TextStyleSmLight16Icon, label: controlMessages.turnIntoHeading5 },
  { style: "heading6", icon: TextStyleSmLight16Icon, label: controlMessages.turnIntoHeading6 },
  { style: "unorderedList", icon: ListBulletLight16Icon, label: controlMessages.turnIntoBulletedList },
  { style: "orderedList", icon: ListNumberLight16Icon, label: controlMessages.turnIntoNumberedList },
  { style: "checklist", icon: CheckmarkSquareLight16Icon, label: controlMessages.turnIntoChecklist },
  { style: "quote", icon: QuotemarkLight16Icon, label: controlMessages.turnIntoQuote },
  { style: "callout", icon: SquareTextFormatLight16Icon, label: controlMessages.turnIntoHighlight },
  { style: "code", icon: CodeLight16Icon, label: controlMessages.turnIntoCode },
];

/** `V9t.options` with `mH` icons and `_H` labels. */
const layoutOptions: { layout: PageBlockLayout; icon: MenuIcon; label: MessageDescriptor }[] = [
  { layout: "normal", icon: TextAlignleftLight16Icon, label: controlMessages.layoutReading },
  { layout: "flexible", icon: ArrowUpRightMdLight16Icon, label: controlMessages.layoutWideAligned },
  { layout: "full-width", icon: ArrowLeftArrowRightLight16Icon, label: controlMessages.layoutWideCentered },
];

/** `_H.block` */
const blockOptionsMessage = {
  id: "codex.space.page.block.options",
  defaultMessage: "Options",
  description: "Opens options for the entire Page block; its grip also drags the block",
} satisfies MessageDescriptor;

/** `_H` labels for each kind of control. */
const kindMessages: Record<ControlKind, MessageDescriptor> = { block: blockOptionsMessage, row: controlMessages.row, column: controlMessages.column };

/** `_H[`${scope}-${action}`]` */
const axisActionMessages = {
  "row-insert-before": controlMessages.insertRowAbove,
  "row-insert-after": controlMessages.insertRowBelow,
  "row-move-before": controlMessages.moveRowUp,
  "row-move-after": controlMessages.moveRowDown,
  "row-delete": controlMessages.deleteRow,
  "column-insert-before": controlMessages.insertColumnLeft,
  "column-insert-after": controlMessages.insertColumnRight,
  "column-move-left": controlMessages.moveColumnLeft,
  "column-move-right": controlMessages.moveColumnRight,
  "column-delete": controlMessages.deleteColumn,
} satisfies Record<string, MessageDescriptor>;

/** `pH`: shown instead of row numbers from 1000 on. */
const overflowRowLabel = "·";

/** Tooltip delay of the controls inside a `TooltipProvider` (the table controls use 700ms, `uV`). */
export const ControlTooltipDelay = createContext<number | undefined>(undefined);

function preventDefault(event: MouseEvent | Event) {
  event.preventDefault();
}

/** Effective `pageLayout` of a block (`z9t`); tables default to full width. */
export function blockLayout(block: PageBlock): PageBlockLayout {
  return block.layout ?? (block.type === "table" ? "full-width" : "normal");
}

/** `WV`: the Fit submenu icon; `readability` draws text lines between margins. */
function FitIcon({ className, mode = "normal" }: { className?: string; mode?: TableFitMode }) {
  return (
    <svg
      className={clsx("shrink-0", className)}
      aria-hidden="true"
      fill="none"
      focusable="false"
      height="16"
      viewBox="0 0 16 16"
      width="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1"
    >
      {mode === "readability" ? (
        <>
          <path d="M1.5 3v10M14.5 3v10" />
          <path d="M4 5h8M4 8h8M4 11h5" opacity="0.75" />
        </>
      ) : (
        <>
          <path d="M6 3.5h4v9H6z" fill="currentColor" opacity="0.2" stroke="none" />
          <path d="M6 3.5v9M10 3.5v9M1 8h3m-2-2 2 2-2 2M15 8h-3m2-2-2 2 2 2" />
        </>
      )}
    </svg>
  );
}

/** `XV` */
function TurnIntoMenu({ activeStyle, onSelect }: { activeStyle: BlockStyle | null; onSelect: (style: BlockStyle) => void }) {
  return (
    <Menu.FlyoutSubmenuItem LeftIcon={ArrowsClockwiseRotateLgLight16Icon} label={<FormattedMessage {...controlMessages.turnIntoLabel} />}>
      {turnIntoStyles.map(({ style, icon, label }, index) => (
        <Fragment key={style}>
          {index > 0 && (style === "unorderedList" || style === "quote") ? <Menu.Separator /> : null}
          <Menu.Item
            LeftIcon={icon}
            RightIcon={style === activeStyle ? CheckmarkMdLight16Icon : undefined}
            aria-checked={style === activeStyle}
            role="menuitemradio"
            onSelect={() => onSelect(style)}
          >
            <FormattedMessage {...label} />
          </Menu.Item>
        </Fragment>
      ))}
    </Menu.FlyoutSubmenuItem>
  );
}

/** `cH`: insert, move and delete actions for one table row or column. Moves never involve the header row. */
function TableAxisMenu({ scope, index, last, rtl, onAction }: { scope: TableAxis; index: number; last: number; rtl: boolean; onAction: (action: TableAxisAction) => void }) {
  const first = scope === "row" ? 1 : 0;
  return (
    <>
      {(["insert-before", "insert-after"] as const).map((action) => (
        <Menu.Item key={action} LeftIcon={PlusLgLight16Icon} onSelect={() => onAction(action)}>
          <FormattedMessage {...axisActionMessages[`${scope}-${action}`]} />
        </Menu.Item>
      ))}
      {(["move-before", "move-after"] as const).map((action) => {
        const before = action === "move-before";
        const left = before !== rtl;
        let icon: MenuIcon = left ? ArrowLeftLgLight16Icon : ArrowRightLgLight16Icon;
        let label: MessageDescriptor = left ? axisActionMessages["column-move-left"] : axisActionMessages["column-move-right"];
        if (scope === "row") {
          icon = before ? ArrowUpMdLight16Icon : ArrowDownLgLight16Icon;
          label = before ? axisActionMessages["row-move-before"] : axisActionMessages["row-move-after"];
        }
        return (
          <Menu.Item key={action} disabled={(scope === "row" && index === 0) || (before ? index === first : index === last)} LeftIcon={icon} onSelect={() => onAction(action)}>
            <FormattedMessage {...label} />
          </Menu.Item>
        );
      })}
      <Menu.Separator />
      <Menu.Item LeftIcon={TrashLight16Icon} tone="danger" onSelect={() => onAction("delete")}>
        <FormattedMessage {...axisActionMessages[`${scope}-delete`]} />
      </Menu.Item>
    </>
  );
}

export interface PageControlMenuProps {
  kind: ControlKind;
  /** The block the menu acts on; for row and column menus, their table. */
  block: PageBlock;
  /** Row or column index, for axis menus. */
  axisIndex?: number;
  /** Displayed row number or column letter, for axis menus. */
  axisLabel?: string;
  axisTabIndex?: number;
  /** Small round button (table toolbar and axis handles) instead of the grip. */
  compact?: boolean;
  allowDrag?: boolean;
  /** The grip targets one row of a list. */
  listItem?: boolean;
  /** The target is one of several blocks or rows in the selection, and the menu acts on all of them. */
  multiple?: boolean;
  open: boolean;
  dragging: boolean;
  rtl?: boolean;
  attribution?: ReactNode;
  onOpenChange: (open: boolean) => void;
  onAction: (action: BlockAction) => void;
  onAxisAction?: (action: TableAxisAction) => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
  onEscape: () => void;
}

/** `iJr`: whether Option or Alt is held, followed from window key events while `enabled`. */
function useAltKey(enabled: boolean) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const sync = (event: KeyboardEvent) => setHeld(event.altKey);
    const release = () => setHeld(false);
    window.addEventListener("keydown", sync, true);
    window.addEventListener("keyup", sync, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", sync, true);
      window.removeEventListener("keyup", sync, true);
      window.removeEventListener("blur", release);
      setHeld(false);
    };
  }, [enabled]);
  return enabled && held;
}

/** `nH`: the grip or button that opens a block, row or column menu, and drags it when allowed. */
export function PageControlMenu({
  kind,
  block,
  axisIndex,
  axisLabel,
  axisTabIndex,
  compact = false,
  allowDrag = true,
  listItem = false,
  multiple = false,
  open,
  dragging,
  rtl = false,
  attribution,
  onOpenChange,
  onAction,
  onAxisAction,
  onPointerDown,
  onEscape,
}: PageControlMenuProps) {
  const intl = useIntl();
  const present = useIsPresent();
  const tooltipDelay = useContext(ControlTooltipDelay);
  const wholeList = useAltKey(listItem && !multiple && kind === "block");
  const menuOpen = open && present;
  const isBlock = kind === "block";
  const draggable = allowDrag && (isBlock || compact || axisLabel != null);
  const compactBlock = compact && isBlock;
  let size: "dragHandle" | "toolbar" | "formatToolbarIcon" | "iconCircleSm" = draggable ? "dragHandle" : "toolbar";
  if (compact) size = compactBlock ? "formatToolbarIcon" : "iconCircleSm";
  const isTable = block.type === "table";
  let label = intl.formatMessage(kindMessages[kind]);
  if (isBlock && isTable) label = intl.formatMessage(controlMessages.tableOptions);
  if (axisLabel != null && kind === "row") label = intl.formatMessage(controlMessages.labeledRowOptions, { label: axisLabel });
  else if (axisLabel != null && kind === "column") label = intl.formatMessage(controlMessages.labeledColumnOptions, { label: axisLabel });
  let tooltip = label;
  if (draggable && !multiple && !listItem && block.type === "heading") tooltip = intl.formatMessage(controlMessages.sectionDragHint);
  else if (wholeList) tooltip = intl.formatMessage(controlMessages.listDragHint);
  else if (draggable && axisLabel == null) tooltip = intl.formatMessage(controlMessages.dragHint);
  const style = isBlock ? blockStyle(block) : null;
  const canChangeLayout = isBlock && (block.type === "code_block" || isTable || block.type === "page_image");
  const currentLayout = blockLayout(block);
  let deleteMessage = isTable && !multiple ? controlMessages.deleteTable : controlMessages.deleteBlock;
  if (listItem && !multiple) deleteMessage = wholeList ? controlMessages.deleteList : controlMessages.deleteListRow;
  const lastAxisIndex = block.type === "table" ? (kind === "row" ? block.rows.length : (block.rows[0]?.cells.length ?? 0)) - 1 : 0;
  const content = !menuOpen ? null : (
    <>
      {!isBlock && axisIndex != null && onAxisAction != null ? <TableAxisMenu scope={kind} index={axisIndex} last={lastAxisIndex} rtl={rtl} onAction={onAxisAction} /> : null}
      {style == null ? null : <TurnIntoMenu activeStyle={style} onSelect={(next) => onAction({ kind: "turnInto", style: next })} />}
      {isBlock ? (
        <>
          {multiple ? null : (
            <>
              <Menu.Item LeftIcon={PlusLgLight16Icon} onSelect={() => onAction({ kind: "insertBelow" })}>
                <FormattedMessage {...controlMessages.insertBelow} />
              </Menu.Item>
              <Menu.Item LeftIcon={LinkLight16Icon} onSelect={() => onAction({ kind: "copyLink" })}>
                <FormattedMessage {...controlMessages.copyLink} />
              </Menu.Item>
            </>
          )}
          {isTable ? (
            <Menu.Item LeftIcon={SquareOnSquareLight16Icon} onSelect={() => onAction({ kind: "copyMarkdown" })}>
              <FormattedMessage {...pageActionMessages.markdown} />
            </Menu.Item>
          ) : null}
        </>
      ) : null}
      {canChangeLayout ? (
        <>
          <Menu.Separator />
          <Menu.FlyoutSubmenuItem LeftIcon={ArrowLeftArrowRightLight16Icon} label={<FormattedMessage {...controlMessages.layoutMenuTitle} />}>
            {layoutOptions
              .filter(({ layout }) => block.type !== "page_image" || layout !== "flexible")
              .map(({ layout, icon, label: layoutLabel }) => (
                <Menu.Item
                  key={layout}
                  LeftIcon={icon}
                  aria-checked={currentLayout === layout}
                  rightIcon={currentLayout === layout ? <CheckmarkMdLight16Icon /> : undefined}
                  role="menuitemradio"
                  onSelect={() => onAction({ kind: "layout", layout })}
                >
                  <FormattedMessage {...layoutLabel} />
                </Menu.Item>
              ))}
          </Menu.FlyoutSubmenuItem>
          {isTable ? (
            <Menu.FlyoutSubmenuItem LeftIcon={FitIcon} label={<FormattedMessage {...tableMessages.fitMenuTitle} />}>
              <Menu.Item leftIcon={<FitIcon mode="normal" />} onSelect={() => onAction({ kind: "fit", mode: "normal" })}>
                <FormattedMessage {...tableMessages.fitToContentWidth} />
              </Menu.Item>
              <Menu.Item leftIcon={<FitIcon mode="readability" />} onSelect={() => onAction({ kind: "fit", mode: "readability" })}>
                <FormattedMessage {...tableMessages.fitForReadability} />
              </Menu.Item>
              <Menu.Item LeftIcon={ArrowLeftArrowRightLight16Icon} onSelect={() => onAction({ kind: "distributeColumns" })}>
                <FormattedMessage {...tableMessages.distributeColumns} />
              </Menu.Item>
            </Menu.FlyoutSubmenuItem>
          ) : null}
        </>
      ) : null}
      {isBlock ? (
        <>
          <Menu.Separator />
          <Menu.Item LeftIcon={TrashLight16Icon} tone="danger" onSelect={() => onAction({ kind: "delete", wholeList })}>
            <FormattedMessage {...deleteMessage} />
          </Menu.Item>
        </>
      ) : null}
      {attribution}
    </>
  );
  return (
    <Tooltip
      open={!present || dragging ? false : undefined}
      triggerPopupOpen={menuOpen}
      disableHoverOpen={menuOpen || dragging}
      closeOnTriggerClick
      delayDuration={tooltipDelay}
      skipDelayKey="page-block-controls"
      tooltipContent={tooltip}
    >
      <DropdownMenu
        side={isBlock ? "left" : undefined}
        sideOffset={isBlock ? 4 : undefined}
        align={isBlock ? "start" : "end"}
        contentRef={markControlsContent}
        contentWidth="menuBounded"
        open={menuOpen}
        onOpenChange={onOpenChange}
        onCloseAutoFocus={preventDefault}
        onEscapeKeyDown={onEscape}
        triggerButton={
          <Button
            className={clsx(axisLabel != null && "size-full justify-center", draggable && "cursor-grab touch-none active:cursor-grabbing")}
            aria-label={label}
            color={draggable || compactBlock ? "ghost" : "ghostSecondary"}
            focusRing={compact || axisLabel != null ? "inset" : undefined}
            size={size}
            radius={compactBlock ? "full" : undefined}
            uniform={axisLabel == null && !draggable && !compactBlock}
            unstyled={axisLabel != null}
            tabIndex={axisTabIndex}
            onPointerDown={draggable ? onPointerDown : undefined}
            onMouseDown={preventDefault}
          >
            {kind === "row" && axisIndex != null && axisIndex >= 999 ? <span aria-hidden="true">{overflowRowLabel}</span> : axisLabel}
            {axisLabel == null && compact && !compactBlock ? <EllipsisHorizontalLight12Icon /> : null}
            {axisLabel == null && (!compact || compactBlock) ? draggable ? <DragLight16Icon /> : <EllipsisHorizontalLight16Icon /> : null}
          </Button>
        }
      >
        {content}
      </DropdownMenu>
    </Tooltip>
  );
}

/** `aH` */
function markControlsContent(element: HTMLDivElement | null) {
  element?.setAttribute("data-page-editor-controls", "");
}

export interface BlockControlsFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  /** First line box, relative to the frame (the handle centers on it). */
  lineTop: number;
  lineHeight: number;
}

interface PageBlockControlsProps {
  /** Hovered block whose grip shows, unless its table shows its own controls. */
  block: PageBlock | null;
  frame: BlockControlsFrame | null;
  /** Hovered list row, when the grip targets one row of a list. */
  listItem: boolean;
  /** The open menu acts on every block and row of the selection it was opened in. */
  multiple?: boolean;
  open: boolean;
  dragging: boolean;
  attribution?: ReactNode;
  /** `XB` for the table holding the caret. */
  tableControls?: ReactNode;
  onOpenChange: (open: boolean) => void;
  onAction: (action: BlockAction) => void;
  onGripPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onEscape: () => void;
}

/** `[data-page-editor-controls]` overlay: the table controls and the `nH` grip of the hovered block. */
export function PageBlockControls({ block, frame, listItem, multiple = false, open, dragging, attribution, tableControls, onOpenChange, onAction, onGripPointerDown, onEscape }: PageBlockControlsProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none" data-page-editor-controls="">
      <AnimatePresence>{tableControls}</AnimatePresence>
      <div
        className={clsx("pointer-events-none absolute", pageCss.PageControlFrame)}
        data-page-control-frame="block"
        hidden={frame == null || block == null}
        style={frame == null ? undefined : { left: frame.left, top: frame.top, width: frame.width, height: frame.height, visibility: "visible" }}
      >
        <div className="pointer-events-none absolute inset-y-0 end-full pe-1.5">
          <div
            className="pointer-events-auto flex items-center"
            data-page-control-anchor=""
            style={frame == null ? undefined : { height: Math.min(frame.lineHeight, frame.height), marginBlockStart: Math.max(0, frame.lineTop) }}
          >
            {block == null ? null : (
              <PageControlMenu
                kind="block"
                block={block}
                listItem={listItem}
                multiple={multiple}
                open={open}
                dragging={dragging}
                attribution={attribution}
                onOpenChange={onOpenChange}
                onAction={onAction}
                onPointerDown={onGripPointerDown}
                onEscape={onEscape}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
