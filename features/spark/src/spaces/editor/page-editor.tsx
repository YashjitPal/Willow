import clsx from "clsx";
import { motion } from "framer-motion";
import { createElement, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { FormattedMessage, useIntl } from "react-intl";
import { useLocation, useNavigate } from "react-router-dom";
import { useReducedMotion } from "../../codex/lib/theme-engine";
import { TextBubbleLight16Icon } from "../../codex/icons";
import { Button, menuContentMaxHeight, SuggestionSurface } from "../../codex/ui";
import { isMacPlatform } from "../../codex/ui/accelerator";
import { copyToClipboard } from "../../codex/ui/copy-button";
import { InlineSymbolPicker } from "../../codex/ui/inline-symbol-picker";
import { showLinkCopiedToast } from "../../codex/ui/link-copied-toast";
import { openSpacePageTab } from "../willow/dot/room/page-tab";
import { useDots } from "../willow/dot/dot-identity";
import { selfUserId } from "../willow/dot/state/room-store";
import { usePagesViewSettings } from "../../codex/lib/pages-view-settings";
import { pageListOriginState, pageShareUrl, type SpacesLocationState } from "../navigation";
import { findSpacesUser, useSpacesStore, WORKSPACE_ID } from "../state";
import { nearestGap, scrollParent, startBlockDrag, startTableAxisDrag } from "./block-drag";
import { gripTargets, isListBlock, moveTargets, removeRow, selectionTargets, type BlockDrop, type BlockTarget } from "./block-targets";
import { CommentInk } from "./comment-ink";
import { pageCss, writingBlockCss, writingBlockTheme } from "./css";
import {
  applyInputRule,
  blockForCommand,
  blockStyle,
  deleteBetween,
  documentUnits,
  findUnit,
  insertAfter,
  insertInline,
  joinBackward,
  joinForward,
  replaceBlock,
  splitUnit,
  tableCellKey,
  turnInto,
  unitContent,
  withUnitContent,
  type BlockStyle,
  type Caret,
  type EditorUnit,
} from "./document-model";
import { concatInline, inlineLength, inlineText, offsetInElement, pointInElement, readInline, renderInlineHtml, renderPlainHtml, splitInline, toggleMark } from "./inline-dom";
import { MentionMenu, mentionOptions, type MentionOption } from "./mention-menu";
import { commentMessages, pageMessages, slashMenuMessages, tableMessages } from "./messages";
import { AttributionFooter, attributionRanges, PageAttribution, type AttributionPlacement } from "./page-attribution";
import { blockLayout, PageBlockControls, PageControlMenu, type BlockAction, type BlockControlsFrame, type ControlKind } from "./page-block-controls";
import { TableControls } from "./table-controls";
import { evenColumnWidths, measureTableFit, viewportColumnWidths, type TableFitMode } from "./table-fit";
import {
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  minimumColumnWidth,
  moveTableAxis,
  tableColumnCount,
  tableColumnHasContent,
  tableColumnWidths,
  tableSizing,
  withColumnWidths,
  withRowHeight,
  type TableAxis,
  type TableAxisAction,
  type TableBlock,
} from "./table-model";
import { CalloutIcon, ImageView, VisualizationView } from "./page-blocks";
import { LinkForm } from "./link-editor";
import { LinkPageDialog } from "./link-page-dialog";
import { pageReference } from "./page-links";
import { PageReferenceChip } from "./page-reference-chip";
import { SelectionToolbar, SelectionToolbarLayer, useAnchoredStyle } from "./selection-toolbar";
import { slashCommands } from "./slash-commands";
import { menuEase, nextOptionId, SlashMenuList } from "./slash-menu";
import { slashCommandPrompt, slashOptions, type SlashContext } from "./slash-options";
import { convertTypedPunctuation, revertPunctuation, type PunctuationConversion } from "./smart-punctuation";
import { generateText, generateVisualization, insertBlocks, selfActor, type CommentTarget } from "./state/editor-actions";
import { blockToMarkdown, createPageId, taskMentionIdFromPath, text, type PageBlock, type PageDocument, type PageInline, type PageMark } from "./state/page-document";
import { usePageDocumentsStore } from "./state/page-documents-store";
import { usePageEditorUiStore } from "./state/page-editor-ui-store";
import { TaskMentionChip } from "./task-mention-chip";
import { getPortalRoot } from "../../codex/ui/portal-root";

export interface PageEditorHandle {
  focus: (where?: "start" | "end") => void;
  hasFocus: () => boolean;
  /** Runs a slash/Insert menu command; `insertBelow` places new blocks after the last active block. */
  runCommand: (commandId: string, options?: { insertBelow?: boolean }) => void;
  slashContext: () => SlashContext;
}

interface PageEditorProps {
  ref?: Ref<PageEditorHandle>;
  pageId: string;
  document: PageDocument;
  editable: boolean;
  canComment: boolean;
  showAttribution: boolean;
  activeThreadId: string | null;
  /** Thread whose card is hovered in the comments list. */
  highlightedThreadId?: string | null;
  onSelectThread: (threadId: string) => void;
  onRequestComment: (target: CommentTarget) => void;
  onComposeTaskMention: (mentionId: string) => void;
}

interface UnitSelection {
  key: string;
  from: number;
  to: number;
}

/** The range the selection toolbar's "link" mode edits; `GN` pins it while focus is in the form. */
interface LinkEdit extends UnitSelection {
  anchor: DOMRect;
  href: string | null;
  title?: string;
}

interface EditorRange {
  from: Caret;
  to: Caret;
  focus: Caret;
  collapsed: boolean;
}

interface InlineMenu {
  kind: "slash" | "mention" | "emoji";
  key: string;
  /** Offset of the `/`, `@` or `:` trigger. */
  start: number;
  query: string;
  anchor: DOMRect;
  highlightedId?: string;
}

interface TextSelectionState {
  key: string;
  from: number;
  to: number;
  anchor: DOMRect;
}

interface AtomHost {
  element: HTMLElement;
  mentionId: string;
}

interface ReferenceHost {
  element: HTMLElement;
  path: string;
  title: string;
}

/** `lL`: a slash command finished outside the editor; `commit` removes its `/query`, `cancel` reopens the menu on it. */
interface PendingSlashAction {
  commit: () => boolean;
  cancel: () => void;
}

interface InkHost {
  widget: HTMLElement;
  anchor: HTMLElement;
  threadId: string;
}

const atomPlaceholder = "\ufffc";
const typingCoalesceMs = 1000;
const deleteColumnConfirmation = "Delete this column? It contains content.";
const tableResizeSelector = "[data-page-column-resize]";

/** A table cell the caret (or an open table menu) targets. */
interface TableTarget {
  blockId: string;
  row: number;
  column: number;
}

/** Column or row sizes previewed while a resize handle is hovered or dragged. */
interface TableResizePreview {
  blockId: string;
  axis: TableAxis;
  index: number;
  sizes: number[] | null;
}

/** `kB`: the table's rendered scale relative to its CSS size. */
function tableZoom(table: HTMLTableElement) {
  const width = Number.parseFloat(getComputedStyle(table).width) || table.offsetWidth;
  return width > 0 ? table.getBoundingClientRect().width / width : 1;
}

/** `OB`: the current row heights or header cell widths, in CSS pixels. */
function measureTableSizes(table: HTMLTableElement, axis: TableAxis) {
  const zoom = tableZoom(table);
  const cells = axis === "row" ? Array.from(table.rows) : Array.from(table.rows[0]?.cells ?? []);
  return cells.map((cell) => {
    const rect = cell.getBoundingClientRect();
    return (axis === "row" ? rect.height : rect.width) / zoom;
  });
}
/** Pointer targets that keep the current block controls instead of retargeting them. */
const hoverIgnoredSelector =
  '[data-page-editor-controls] button, [data-page-table-controls], [data-page-control-frame="row"], [data-page-control-frame="column"], [data-page-attribution-position]';
/** Wrappers inside the document that resolve to the block under the pointer's row. */
const hoverStructuralSelector = "ul, ol, li, .task-list-item-content, [data-page-block-row], [data-page-block-viewport]";

/** Text of a unit with each atom as one placeholder character, so offsets line up with carets. */
function unitText(content: PageInline[]) {
  return content.map((run) => (run.kind === "text" ? run.text : atomPlaceholder)).join("");
}

/** `XPi`: an emoji shortcode being typed before the caret. */
const emojiTrigger = /(?:^|[\s([{\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u20E3]):([\p{L}\p{N}\p{M}_+-]*)$/u;

/** `LPi` for `:`: the shortcode query ending at `offset`, or null when there is none or it touches inline code. */
function emojiQueryAt(content: PageInline[], offset: number) {
  const query = emojiTrigger.exec(unitText(content).slice(0, offset))?.[1];
  if (query == null) return null;
  const from = offset - query.length - 1;
  let position = 0;
  for (const run of content) {
    const length = run.kind === "text" ? run.text.length : 1;
    if (run.kind === "text" && run.marks?.includes("code") && position < offset && position + length > from) return null;
    position += length;
  }
  return query;
}

function unitHtml(unit: EditorUnit, content: PageInline[], mentions: PageDocument["taskMentions"]) {
  return unit.kind === "inline" ? renderInlineHtml(content, mentions) : renderPlainHtml(inlineText(content));
}

function sameHosts<T extends object>(a: T[], b: T[]) {
  return a.length === b.length && a.every((entry, index) => Object.entries(entry).every(([key, value]) => (b[index] as Record<string, unknown>)[key] === value));
}

function pickFile(accept: string | undefined, onFile: (file: File) => void) {
  const input = document.createElement("input");
  input.type = "file";
  if (accept != null) input.accept = accept;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file != null) onFile(file);
  });
  input.click();
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

/** Keeps a unit's DOM in sync with the model without clobbering what the browser just typed. */
class UnitRegistry {
  private elements = new Map<string, HTMLElement>();
  private keys = new WeakMap<HTMLElement, string>();
  private rendered = new WeakMap<HTMLElement, string>();

  attach(key: string, element: HTMLElement, html: string) {
    this.elements.set(key, element);
    this.keys.set(element, key);
    if (this.rendered.get(element) !== html) {
      element.innerHTML = html;
      this.rendered.set(element, html);
    }
  }

  detach(key: string, element: HTMLElement) {
    if (this.elements.get(key) === element) this.elements.delete(key);
  }

  element(key: string) {
    return this.elements.get(key);
  }

  keyOf(element: HTMLElement) {
    return this.keys.get(element);
  }

  markRendered(element: HTMLElement, html: string) {
    this.rendered.set(element, html);
  }

  forget(element: HTMLElement) {
    this.rendered.delete(element);
  }
}

type UnitTag = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "code";

interface EditableUnitProps extends HTMLAttributes<HTMLElement> {
  as: UnitTag;
  html: string;
  registry: UnitRegistry;
  unitKey: string;
  [attribute: `data-${string}`]: string | undefined;
}

function EditableUnit({ as, html, registry, unitKey, ...rest }: EditableUnitProps) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element == null) return;
    registry.attach(unitKey, element, html);
    return () => registry.detach(unitKey, element);
  });
  return createElement(as, { ...rest, ref });
}

const headingTags = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

/** The Page block editor: one contenteditable root with the original writing-block DOM per block. */
export function PageEditor({
  ref,
  pageId,
  document: pageDocument,
  editable,
  canComment,
  showAttribution,
  activeThreadId,
  highlightedThreadId = null,
  onSelectThread,
  onRequestComment,
  onComposeTaskMention,
}: PageEditorProps) {
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const capabilities = usePageEditorUiStore((state) => state.capabilities);
  const dots = useDots();
  const users = useSpacesStore((state) => state.users);
  const page = useSpacesStore((state) => state.pages[pageId]);
  const blocks = pageDocument.blocks;
  const mentions = pageDocument.taskMentions;

  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const registryRef = useRef<UnitRegistry>(null);
  registryRef.current ??= new UnitRegistry();
  const registry = registryRef.current;
  const pendingSelection = useRef<UnitSelection | null>(null);
  const lastCaret = useRef<Caret | null>(null);
  const history = useRef({ past: [] as { blocks: PageBlock[]; caret: Caret | null }[], future: [] as { blocks: PageBlock[]; caret: Caret | null }[], lastTypingAt: 0 });
  const composing = useRef(false);
  const pointerSelecting = useRef(false);

  const [focused, setFocused] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<InlineMenu | null>(null);
  const [textSelection, setTextSelection] = useState<TextSelectionState | null>(null);
  const [linkEdit, setLinkEdit] = useState<LinkEdit | null>(null);
  /** The "Link to page" dialog, with the slash command it finishes. */
  const [linkDialog, setLinkDialog] = useState<{ action?: PendingSlashAction } | null>(null);
  const pendingSlash = useRef<symbol | null>(null);
  const [atoms, setAtoms] = useState<AtomHost[]>([]);
  const [references, setReferences] = useState<ReferenceHost[]>([]);
  const [inks, setInks] = useState<InkHost[]>([]);
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  /** `qw`'s `item`: the row of the hovered list under the pointer, which the grip then targets. */
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  /** Open control menu: `block:<blockId>`, or `row:<index>` / `column:<index>` of the table showing controls. */
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  /** `z`: every block and row the open block menu acts on, when it opened on one of several selected. */
  const [menuTargets, setMenuTargets] = useState<BlockTarget[] | null>(null);
  const menuSnapshot = useRef<{ blocks: PageBlock[]; caret: Caret | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  const cancelDrag = useRef<(() => void) | null>(null);
  const [controlsFocused, setControlsFocused] = useState(false);
  const stickyTableTarget = useRef<TableTarget | null>(null);
  const [resizePreview, setResizePreview] = useState<TableResizePreview | null>(null);
  const cancelResize = useRef<((clear: boolean) => void) | null>(null);
  const pendingReveal = useRef<{ key: string; anchor?: { blockId: string; bottom: number } } | null>(null);
  const pendingTableSizing = useRef<string | null>(null);
  const updateTableOverflow = useRef<(() => void) | null>(null);
  const [controlsFrame, setControlsFrame] = useState<BlockControlsFrame | null>(null);
  const [attributionPlacements, setAttributionPlacements] = useState<AttributionPlacement[]>([]);
  const [revision, setRevision] = useState(0);

  const { smartPunctuationEnabled } = usePagesViewSettings();
  const punctuation = useRef<PunctuationConversion | null>(null);
  const latest = useRef({ blocks, editable, menu, mentions, smartPunctuationEnabled });
  latest.current = { blocks, editable, menu, mentions, smartPunctuationEnabled };

  const unitOrder = () => documentUnits(latest.current.blocks).map((unit) => unit.key);

  // --- DOM <-> model selection -------------------------------------------------------------

  const caretFromDom = (node: Node | null, offset: number): Caret | null => {
    const root = rootRef.current;
    if (root == null || node == null || !root.contains(node)) return null;
    for (let current: Node | null = node; current != null && current !== root; current = current.parentNode) {
      if (current instanceof HTMLElement) {
        const key = registry.keyOf(current);
        if (key != null && registry.element(key) === current) return { key, offset: offsetInElement(current, node, offset) };
      }
    }
    const cell = (node instanceof Element ? node : node.parentElement)?.closest("td, th");
    if (cell != null && root.contains(cell)) {
      const paragraph = Array.from(cell.children).find((child): child is HTMLElement => child instanceof HTMLElement && registry.keyOf(child) != null);
      const key = paragraph == null ? undefined : registry.keyOf(paragraph);
      if (paragraph != null && key != null) {
        const atEnd = node === cell && offset > Array.prototype.indexOf.call(cell.childNodes, paragraph);
        return { key, offset: atEnd ? offsetInElement(paragraph, paragraph, paragraph.childNodes.length) : 0 };
      }
    }
    const row = node === root ? root.children[Math.min(offset, root.children.length - 1)] : (node instanceof Element ? node : node.parentElement)?.closest("[data-page-block-row]");
    const blockId = row?.getAttribute("data-page-block-id");
    const unit = blockId == null ? undefined : documentUnits(latest.current.blocks).find((entry) => entry.blockId === blockId);
    return unit == null ? null : { key: unit.key, offset: 0 };
  };

  const compareCarets = (a: Caret, b: Caret) => {
    const order = unitOrder();
    return order.indexOf(a.key) - order.indexOf(b.key) || a.offset - b.offset;
  };

  const readRange = (): EditorRange | null => {
    const selection = document.getSelection();
    if (selection == null || selection.rangeCount === 0) return null;
    const anchor = caretFromDom(selection.anchorNode, selection.anchorOffset);
    const focus = caretFromDom(selection.focusNode, selection.focusOffset);
    if (anchor == null || focus == null) return null;
    const forward = compareCarets(anchor, focus) <= 0;
    return { from: forward ? anchor : focus, to: forward ? focus : anchor, focus, collapsed: anchor.key === focus.key && anchor.offset === focus.offset };
  };

  const placeSelection = (target: UnitSelection) => {
    const element = registry.element(target.key);
    const selection = document.getSelection();
    if (element == null || selection == null) return;
    rootRef.current?.focus({ preventScroll: true });
    const start = pointInElement(element, target.from);
    const end = target.to === target.from ? start : pointInElement(element, target.to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    selection.removeAllRanges();
    selection.addRange(range);
    lastCaret.current = { key: target.key, offset: target.to };
  };

  // --- Committing edits --------------------------------------------------------------------

  /** `merge` folds the change into the previous undo step. */
  const commit = (next: PageBlock[], selection: UnitSelection | null, { typing = false, merge = false }: { typing?: boolean; merge?: boolean } = {}) => {
    punctuation.current = null;
    const now = Date.now();
    const log = history.current;
    if (!merge && (!typing || now - log.lastTypingAt > typingCoalesceMs)) {
      log.past = [...log.past.slice(-99), { blocks: latest.current.blocks, caret: lastCaret.current }];
    }
    log.future = [];
    log.lastTypingAt = typing ? now : 0;
    latest.current.blocks = next;
    pendingSelection.current = selection;
    usePageDocumentsStore.getState().setBlocks(pageId, next, selfActor);
  };

  const restore = (direction: "undo" | "redo") => {
    const log = history.current;
    const entry = direction === "undo" ? log.past.at(-1) : log.future.at(-1);
    if (entry == null) return;
    const current = { blocks: latest.current.blocks, caret: lastCaret.current };
    if (direction === "undo") {
      log.past = log.past.slice(0, -1);
      log.future = [...log.future, current];
    } else {
      log.future = log.future.slice(0, -1);
      log.past = [...log.past, current];
    }
    log.lastTypingAt = 0;
    latest.current.blocks = entry.blocks;
    pendingSelection.current = entry.caret == null ? null : { key: entry.caret.key, from: entry.caret.offset, to: entry.caret.offset };
    usePageDocumentsStore.getState().setBlocks(pageId, entry.blocks);
  };

  const caretSelection = (caret: Caret): UnitSelection => ({ key: caret.key, from: caret.offset, to: caret.offset });

  /** Reads a unit the browser just edited back into the model. */
  const syncUnit = (key: string) => {
    const element = registry.element(key);
    const current = latest.current.blocks;
    const unit = findUnit(current, key);
    if (element == null || unit == null) return null;
    const content = unit.kind === "inline" ? readInline(element) : (element.textContent ?? "") === "" ? [] : [text((element.textContent ?? "").replace(/\u200b/g, ""))];
    const empty = inlineLength(content) === 0;
    if (empty) registry.forget(element);
    else registry.markRendered(element, unitHtml(unit, content, latest.current.mentions));
    const next = withUnitContent(current, unit, content);
    commit(next, empty ? { key, from: 0, to: 0 } : null, { typing: true });
    return { unit, next };
  };

  const removeTrigger = (current: PageBlock[], trigger: InlineMenu, end: number) => {
    const unit = findUnit(current, trigger.key);
    if (unit == null) return current;
    const content = unitContent(current, unit);
    return withUnitContent(current, unit, concatInline(splitInline(content, trigger.start)[0], splitInline(content, end)[1]));
  };

  // --- Menus -------------------------------------------------------------------------------

  const caretRect = (fallback: HTMLElement | undefined) => {
    const range = document.getSelection()?.rangeCount ? document.getSelection()?.getRangeAt(0) : null;
    const rect = range?.getClientRects()[0] ?? range?.getBoundingClientRect();
    if (rect != null && (rect.width > 0 || rect.height > 0)) return rect;
    return fallback?.getBoundingClientRect() ?? new DOMRect();
  };

  const slashContextFor = (caret: Caret | null): SlashContext => {
    const current = latest.current.blocks;
    const unit = caret == null ? undefined : findUnit(current, caret.key);
    const block = unit == null ? undefined : current.find((entry) => entry.id === unit.blockId);
    return {
      inTopLevelParagraph: block == null || block.type === "paragraph",
      topLevel: block == null || unit?.itemId == null,
      inTable: block?.type === "table",
      inCallout: block?.type === "callout",
      inlineContent: unit?.kind === "inline",
      generating: usePageEditorUiStore.getState().generating,
    };
  };

  const menuSlashOptions = (state: InlineMenu) =>
    slashOptions(capabilities, slashContextFor({ key: state.key, offset: state.start }), { query: state.query });

  const menuMentionOptions = (state: InlineMenu) =>
    mentionOptions({ query: state.query, dots, canStartTask: capabilities.canGenerate });

  const menuOptionIds = (state: InlineMenu) => (state.kind === "slash" ? menuSlashOptions(state) : menuMentionOptions(state)).map((option) => option.id);

  const trackMenu = (caret: Caret, typed: string | null) => {
    const current = latest.current.blocks;
    const unit = findUnit(current, caret.key);
    if (unit == null) return;
    const value = unitText(unitContent(current, unit));
    const open = latest.current.menu;
    if (open?.kind === "emoji") {
      const query = unit.kind === "code" ? null : emojiQueryAt(unitContent(current, unit), caret.offset);
      if (open.key !== caret.key || query == null || caret.offset - query.length - 1 !== open.start) setMenu(null);
      else if (query !== open.query) setMenu({ ...open, query, anchor: caretRect(registry.element(caret.key)) });
      return;
    }
    if (open == null && typed === ":" && unit.kind !== "code" && emojiQueryAt(unitContent(current, unit), caret.offset) === "") {
      setMenu({ kind: "emoji", key: caret.key, start: caret.offset - 1, query: "", anchor: caretRect(registry.element(caret.key)) });
      return;
    }
    if (open != null) {
      const trigger = open.kind === "slash" ? "/" : "@";
      const query = value.slice(open.start + 1, caret.offset);
      if (open.key !== caret.key || caret.offset <= open.start || value[open.start] !== trigger || query.includes("\n") || query.includes(atomPlaceholder) || (open.kind === "mention" && query.length > 40)) {
        setMenu(null);
        return;
      }
      if (query !== open.query) setMenu({ ...open, query, highlightedId: undefined, anchor: caretRect(registry.element(caret.key)) });
      return;
    }
    if (typed !== "/" && typed !== "@") return;
    const start = caret.offset - 1;
    if (value[start] !== typed || (start > 0 && !/\s/u.test(value[start - 1] ?? ""))) return;
    if (typed === "@" ? unit.kind !== "inline" : unit.kind === "code") return;
    setMenu({ kind: typed === "/" ? "slash" : "mention", key: caret.key, start, query: "", anchor: caretRect(registry.element(caret.key)) });
  };

  const openMentionMenuAt = (current: PageBlock[], caret: Caret) => {
    const unit = findUnit(current, caret.key);
    if (unit == null || unit.kind !== "inline") return;
    commit(insertInline(current, unit, caret.offset, [text("@")]), caretSelection({ key: caret.key, offset: caret.offset + 1 }));
    window.requestAnimationFrame(() => setMenu({ kind: "mention", key: caret.key, start: caret.offset, query: "", anchor: caretRect(registry.element(caret.key)) }));
  };

  /** `c0a` / `l0a`: slash column commands; deleting a column with text asks first. */
  const tableColumnCommand = (current: PageBlock[], unit: EditorUnit | undefined, commandId: string) => {
    const block = unit == null ? undefined : current.find((entry) => entry.id === unit.blockId);
    if (block?.type !== "table" || unit?.cell == null) return null;
    const { row, column } = unit.cell;
    if (commandId === "columnDelete") {
      if (tableColumnHasContent(block, column) && typeof window.confirm === "function" && !window.confirm(deleteColumnConfirmation)) return null;
      const next = deleteTableColumn(block, column);
      if (next == null) return null;
      const caret = { key: tableCellKey(block.id, Math.min(row, next.rows.length - 1), Math.min(column, tableColumnCount(next) - 1)), offset: 0 };
      return { blocks: replaceBlock(current, block.id, [next]), caret };
    }
    const at = commandId === "columnLeft" ? column : column + 1;
    const next = insertTableColumn(block, at);
    return { blocks: replaceBlock(current, block.id, [next]), caret: { key: tableCellKey(block.id, 0, at), offset: 0 } };
  };

  /** `lL`: closes the menu but keeps the `/query` until the command finishes; none while another one is pending. */
  const pendingSlashAction = (trigger: InlineMenu, commandId: string): PendingSlashAction | null => {
    if (pendingSlash.current != null) return null;
    const id = Symbol(commandId);
    pendingSlash.current = id;
    const end = trigger.start + 1 + trigger.query.length;
    const finish = (confirmed: boolean) => {
      if (pendingSlash.current !== id) return false;
      pendingSlash.current = null;
      if (!latest.current.editable) return false;
      if (confirmed) {
        const caret = { key: trigger.key, offset: trigger.start };
        commit(removeTrigger(latest.current.blocks, trigger, end), caretSelection(caret));
        lastCaret.current = caret;
      } else {
        placeSelection({ key: trigger.key, from: end, to: end });
        setMenu({ ...trigger, highlightedId: commandId, anchor: caretRect(registry.element(trigger.key)) });
      }
      return true;
    };
    return {
      commit: () => finish(true),
      cancel: () => {
        finish(false);
      },
    };
  };

  /** `U` + `fS`: replaces the selection (the last caret by default) with a `pageReferenceMention` of the Page. */
  const insertPageReference = (targetPageId: string, at: UnitSelection | null, { focus = true }: { focus?: boolean } = {}) => {
    const current = latest.current.blocks;
    const caret = lastCaret.current;
    const first = documentUnits(current).find((entry) => entry.kind === "inline");
    const target = at ?? (caret != null ? caretSelection(caret) : first == null ? null : { key: first.key, from: 0, to: 0 });
    const unit = target == null ? undefined : findUnit(current, target.key);
    if (target == null || unit?.kind !== "inline") return;
    const [before, rest] = splitInline(unitContent(current, unit), target.from);
    const after = splitInline(rest, target.to - target.from)[1];
    const next = { key: target.key, offset: target.from + 1 };
    commit(withUnitContent(current, unit, concatInline(concatInline(before, [pageReference(targetPageId)]), after)), focus ? caretSelection(next) : null);
    lastCaret.current = next;
  };

  /** `Ii` / `FO`: creates a child Page, links it where the caret is and opens it beside the Page with its title focused. */
  const createSubpage = (action?: PendingSlashAction) => {
    if (!latest.current.editable || !capabilities.canCreateSubpage) {
      action?.cancel();
      return;
    }
    if (action != null && !action.commit()) return;
    const child = useSpacesStore.getState().createPage({ parentPageId: pageId });
    insertPageReference(child.page_id, null, { focus: false });
    openSpacePageTab({ intl, navigate }, child.page_id, { focusTitle: true });
  };

  /** `Ni` from a Page link: opens the linked Page, at the linked block when there is one. */
  const openLinkedPage = (targetPageId: string, blockId: string | undefined) => {
    const sidebar = (location.state as SpacesLocationState | null)?.spaceSidebarAccountId === WORKSPACE_ID;
    void navigate(`/space/${encodeURIComponent(targetPageId)}${blockId == null ? "" : `#${encodeURIComponent(blockId)}`}`, {
      state: {
        ...pageListOriginState(location, WORKSPACE_ID, targetPageId),
        spaceSidebarAccountId: sidebar ? WORKSPACE_ID : undefined,
        spaceSidebarPageId: sidebar ? targetPageId : undefined,
        scrollPageToTop: blockId == null,
      } satisfies SpacesLocationState,
    });
  };

  const runCommand = (commandId: string, { insertBelow = false, trigger }: { insertBelow?: boolean; trigger?: InlineMenu } = {}) => {
    setMenu(null);
    if (commandId === "page" || commandId === "linkPage") {
      const action = trigger == null ? undefined : pendingSlashAction(trigger, commandId);
      if (action === null) return;
      if (commandId === "page") createSubpage(action);
      else if (latest.current.editable) setLinkDialog({ action });
      else action?.cancel();
      return;
    }
    let current = latest.current.blocks;
    let caret = lastCaret.current;
    const query = trigger?.query ?? "";
    if (trigger != null) {
      current = removeTrigger(current, trigger, trigger.start + 1 + trigger.query.length);
      caret = { key: trigger.key, offset: trigger.start };
    }
    const unit = caret == null ? undefined : findUnit(current, caret.key);
    const block = unit == null ? undefined : current.find((entry) => entry.id === unit.blockId);
    const anchorId = block?.id ?? current.at(-1)?.id ?? null;
    const replaceTarget = !insertBelow && block?.type === "paragraph" && inlineLength(block.content) === 0 ? block : null;
    const command = slashCommands.find((entry) => entry.id === commandId);
    const keepTriggerRemoval = () => {
      if (trigger != null) commit(current, caret == null ? null : caretSelection(caret));
    };

    if (commandId === "generate" || commandId === "generatePrompt") {
      keepTriggerRemoval();
      generateText(pageId, anchorId);
      return;
    }
    if (command?.commands != null && commandId !== "canvas") {
      keepTriggerRemoval();
      const prompt = slashCommandPrompt(command, query);
      generateVisualization(pageId, anchorId, prompt || intl.formatMessage(command.label), prompt ?? undefined);
      return;
    }
    switch (commandId) {
      case "image":
        keepTriggerRemoval();
        pickFile("image/*", (file) => void readDataUrl(file).then((src) => insertBlocks(pageId, anchorId, [{ id: createPageId("block"), type: "page_image", src, alt: file.name }], selfActor)));
        return;
      case "file":
        keepTriggerRemoval();
        pickFile(undefined, (file) => insertBlocks(pageId, anchorId, [{ id: createPageId("block"), type: "paragraph", content: [text(file.name)] }], selfActor));
        return;
      case "mentionFiles":
      case "mentionPages":
      case "mentionChats":
        if (caret != null && !insertBelow) openMentionMenuAt(current, caret);
        else keepTriggerRemoval();
        return;
      case "columnLeft":
      case "columnRight":
      case "columnDelete": {
        const next = tableColumnCommand(current, unit, commandId);
        if (next != null) {
          commit(next.blocks, caretSelection(next.caret));
          pendingReveal.current = { key: next.caret.key };
        } else keepTriggerRemoval();
        return;
      }
    }
    const created = blockForCommand(commandId, query);
    if (created == null) {
      keepTriggerRemoval();
      return;
    }
    const next = replaceTarget != null ? replaceBlock(current, replaceTarget.id, created) : anchorId == null ? [...current, ...created] : insertAfter(current, anchorId, created);
    const firstKey = documentUnits(created)[0]?.key;
    commit(next, firstKey == null ? null : { key: firstKey, from: 0, to: 0 });
    // `h2a`: a table typed from the slash menu spreads its columns across the full-width viewport.
    if (trigger != null && created[0]?.type === "table") pendingTableSizing.current = created[0].id;
  };

  const selectMention = (option: MentionOption, trigger: InlineMenu) => {
    setMenu(null);
    const end = trigger.start + 1 + trigger.query.length;
    const current = removeTrigger(latest.current.blocks, trigger, end);
    const unit = findUnit(current, trigger.key);
    if (unit == null) return;
    if (option.kind === "person") {
      const run: PageInline = { kind: "personMention", accountUserId: option.accountUserId, mentionId: createPageId("mention"), title: `@${option.name}` };
      commit(insertInline(current, unit, trigger.start, [run, text(" ")]), { key: trigger.key, from: trigger.start + 2, to: trigger.start + 2 });
      return;
    }
    const mentionId = createPageId("mention");
    const self = findSpacesUser(users, selfUserId);
    usePageDocumentsStore.getState().addTaskMention(pageId, {
      id: mentionId,
      source: "page",
      owner: selfUserId,
      ownerName: self?.display_name,
      threadId: null,
      orbit: option.kind === "dot" ? { threadId: option.conversationId } : undefined,
      prompt: "",
      status: "composing",
    });
    commit(insertInline(current, unit, trigger.start, [{ kind: "taskMention", mentionId }, text(" ")]), { key: trigger.key, from: trigger.start + 2, to: trigger.start + 2 });
    onComposeTaskMention(mentionId);
  };

  /** `insertEmojiSuggestion`: replaces the typed `:query` with the picked emoji, keeping the text's formatting. */
  const selectEmoji = (emoji: string, trigger: InlineMenu) => {
    const end = trigger.start + 1 + trigger.query.length;
    const current = latest.current.blocks;
    const unit = findUnit(current, trigger.key);
    const caret = lastCaret.current;
    if (!latest.current.editable || composing.current || unit == null || caret?.key !== trigger.key || caret.offset !== end) return;
    const content = unitContent(current, unit);
    if (unitText(content).slice(trigger.start, end) !== `:${trigger.query}`) return;
    setMenu(null);
    const [head, rest] = splitInline(content, trigger.start);
    const [replaced, tail] = splitInline(rest, end - trigger.start);
    const source = replaced[0];
    const run: PageInline = source?.kind === "text" ? { ...source, text: emoji } : text(emoji);
    commit(withUnitContent(current, unit, concatInline(concatInline(head, [run]), tail)), caretSelection({ key: trigger.key, offset: trigger.start + emoji.length }));
  };

  const selectMenuOption = (state: InlineMenu, id: string) => {
    if (state.kind === "slash") {
      runCommand(id, { trigger: state });
      return;
    }
    const option = menuMentionOptions(state).find((entry) => entry.id === id);
    if (option != null) selectMention(option, state);
  };

  // --- Structural editing ------------------------------------------------------------------

  const deleteRange = (range: EditorRange) => deleteBetween(latest.current.blocks, range.from, range.to);

  const insertText = (range: EditorRange, value: string) => {
    let current = latest.current.blocks;
    let caret = range.from;
    if (!range.collapsed) {
      const deleted = deleteRange(range);
      if (deleted == null) return;
      current = deleted.blocks;
      caret = deleted.caret;
    }
    const unit = findUnit(current, caret.key);
    if (unit == null) return;
    if (unit.kind !== "inline" || unit.cell != null || !value.includes("\n")) {
      const inserted = unit.cell != null ? value.replace(/\r?\n/g, " ") : value;
      commit(insertInline(current, unit, caret.offset, [text(inserted)]), caretSelection({ key: caret.key, offset: caret.offset + inserted.length }));
      return;
    }
    value.split(/\r?\n/u).forEach((line, index) => {
      if (index > 0) {
        const splitAt = findUnit(current, caret.key);
        if (splitAt == null) return;
        const split = splitUnit(current, splitAt, caret.offset);
        current = split.blocks;
        caret = split.caret;
      }
      const target = findUnit(current, caret.key);
      if (target == null || line === "") return;
      current = insertInline(current, target, caret.offset, [text(line)]);
      caret = { key: caret.key, offset: caret.offset + line.length };
    });
    commit(current, caretSelection(caret));
  };

  const enter = (range: EditorRange) => {
    let current = latest.current.blocks;
    let caret = range.from;
    if (!range.collapsed) {
      const deleted = deleteRange(range);
      if (deleted == null) return;
      current = deleted.blocks;
      caret = deleted.caret;
    }
    const unit = findUnit(current, caret.key);
    if (unit == null || unit.cell != null) return;
    if (unit.kind === "code") {
      const value = inlineText(unitContent(current, unit));
      if (caret.offset === value.length && value.endsWith("\n\n")) {
        const paragraph: PageBlock = { id: createPageId("block"), type: "paragraph", content: [] };
        const trimmed = withUnitContent(current, unit, value.slice(0, -2) === "" ? [] : [text(value.slice(0, -2))]);
        commit(insertAfter(trimmed, unit.blockId, [paragraph]), { key: paragraph.id, from: 0, to: 0 });
        return;
      }
      commit(insertInline(current, unit, caret.offset, [text("\n")]), caretSelection({ key: caret.key, offset: caret.offset + 1 }));
      return;
    }
    const split = splitUnit(current, unit, caret.offset);
    commit(split.blocks, caretSelection(split.caret));
  };

  const deleteBackward = (range: EditorRange, event: InputEvent) => {
    if (!range.collapsed && range.from.key !== range.to.key) {
      event.preventDefault();
      const deleted = deleteRange(range);
      if (deleted != null) commit(deleted.blocks, caretSelection(deleted.caret));
      return;
    }
    if (!range.collapsed || range.from.offset > 0) return;
    event.preventDefault();
    const unit = findUnit(latest.current.blocks, range.from.key);
    if (unit == null || unit.cell != null) return;
    const joined = joinBackward(latest.current.blocks, unit);
    if (joined != null) commit(joined.blocks, caretSelection(joined.caret));
  };

  const deleteForward = (range: EditorRange, event: InputEvent) => {
    if (!range.collapsed && range.from.key !== range.to.key) {
      event.preventDefault();
      const deleted = deleteRange(range);
      if (deleted != null) commit(deleted.blocks, caretSelection(deleted.caret));
      return;
    }
    const unit = findUnit(latest.current.blocks, range.from.key);
    if (!range.collapsed || unit == null || range.from.offset < inlineLength(unitContent(latest.current.blocks, unit))) return;
    event.preventDefault();
    if (unit.cell != null) return;
    const joined = joinForward(latest.current.blocks, unit);
    if (joined != null) commit(joined.blocks, caretSelection(joined.caret));
  };

  const toggleMarkInSelection = (mark: PageMark) => {
    const range = readRange();
    if (range == null || range.collapsed || range.from.key !== range.to.key) return;
    const unit = findUnit(latest.current.blocks, range.from.key);
    if (unit == null || unit.kind !== "inline") return;
    const content = toggleMark(unitContent(latest.current.blocks, unit), range.from.offset, range.to.offset, mark);
    commit(withUnitContent(latest.current.blocks, unit, content), { key: unit.key, from: range.from.offset, to: range.to.offset });
  };

  const setStyleAt = (key: string, style: BlockStyle) => {
    const unit = findUnit(latest.current.blocks, key);
    const block = unit == null ? undefined : latest.current.blocks.find((entry) => entry.id === unit.blockId);
    if (block == null) return;
    const turned = turnInto(block, style);
    const firstKey = documentUnits([turned])[0]?.key;
    commit(replaceBlock(latest.current.blocks, block.id, [turned]), firstKey == null ? null : { key: firstKey, from: 0, to: 0 });
  };

  // --- Native event wiring -----------------------------------------------------------------

  useEffect(() => {
    const root = rootRef.current;
    if (root == null) return;

    const onBeforeInput = (event: InputEvent) => {
      if (!latest.current.editable) {
        event.preventDefault();
        return;
      }
      if (event.isComposing || composing.current) return;
      const range = readRange();
      if (range == null) {
        event.preventDefault();
        return;
      }
      switch (event.inputType) {
        case "insertParagraph":
          event.preventDefault();
          enter(range);
          return;
        case "insertLineBreak":
          event.preventDefault();
          insertText(range, "\n");
          return;
        case "deleteContentBackward":
        case "deleteWordBackward":
        case "deleteSoftLineBackward":
        case "deleteHardLineBackward":
          deleteBackward(range, event);
          return;
        case "deleteContentForward":
        case "deleteWordForward":
        case "deleteSoftLineForward":
        case "deleteHardLineForward":
          deleteForward(range, event);
          return;
        case "deleteByCut":
        case "deleteContent":
          if (range.from.key !== range.to.key) {
            event.preventDefault();
            const deleted = deleteRange(range);
            if (deleted != null) commit(deleted.blocks, caretSelection(deleted.caret));
          }
          return;
        case "insertFromPaste":
        case "insertFromDrop":
        case "deleteByDrag":
          event.preventDefault();
          return;
        case "historyUndo":
          event.preventDefault();
          restore("undo");
          return;
        case "historyRedo":
          event.preventDefault();
          restore("redo");
          return;
        case "formatBold":
        case "formatItalic":
        case "formatUnderline":
        case "formatStrikeThrough":
          event.preventDefault();
          toggleMarkInSelection(({ formatBold: "bold", formatItalic: "italic", formatUnderline: "underline", formatStrikeThrough: "strikethrough" } as const)[event.inputType]);
          return;
        default:
          if (event.inputType.startsWith("format")) {
            event.preventDefault();
            return;
          }
          if (range.from.key !== range.to.key) {
            event.preventDefault();
            if (event.data != null) insertText(range, event.data);
          }
      }
    };

    const onInput = (event: Event) => {
      if (composing.current) return;
      const range = readRange();
      if (range == null) return;
      const previous = punctuation.current;
      const synced = syncUnit(range.focus.key);
      if (synced == null) return;
      const data = event instanceof InputEvent && event.inputType === "insertText" ? event.data : null;
      if (data != null && (data === " " || data === "`" || data === "-" || data === "*" || data === "_" || data === "]")) {
        const unit = findUnit(synced.next, range.focus.key);
        const rule = unit == null ? null : applyInputRule(synced.next, unit);
        if (rule != null) {
          setMenu(null);
          commit(rule.blocks, caretSelection(rule.caret));
          return;
        }
      }
      if (data != null && range.collapsed && latest.current.smartPunctuationEnabled && synced.unit.kind !== "code") {
        const converted = convertTypedPunctuation(unitContent(synced.next, synced.unit), range.focus.offset, data, previous?.key === synced.unit.key ? previous : undefined);
        if (converted != null) {
          setMenu(null);
          commit(withUnitContent(synced.next, synced.unit, converted.content), caretSelection({ key: synced.unit.key, offset: converted.from + converted.glyph.length }), { typing: true });
          punctuation.current = { key: synced.unit.key, from: converted.from, shortcut: converted.shortcut, glyph: converted.glyph };
          return;
        }
      }
      lastCaret.current = range.focus;
      trackMenu(range.focus, data);
    };

    const onCompositionStart = () => {
      composing.current = true;
    };
    const onCompositionEnd = () => {
      composing.current = false;
      const range = readRange();
      if (range != null) syncUnit(range.focus.key);
    };

    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      if (!latest.current.editable) return;
      const range = readRange();
      const value = event.clipboardData?.getData("text/plain") ?? "";
      if (range != null && value !== "") insertText(range, value);
    };

    const onSelectionChange = () => {
      const selection = document.getSelection();
      if (selection == null || !root.contains(selection.anchorNode)) {
        setTextSelection(null);
        return;
      }
      const range = readRange();
      setActiveKey(range?.focus.key ?? null);
      if (range == null) return;
      const conversion = punctuation.current;
      if (conversion != null && (!range.collapsed || range.focus.key !== conversion.key || range.focus.offset !== conversion.from + conversion.glyph.length)) {
        punctuation.current = null;
      }
      lastCaret.current = range.focus;
      const open = latest.current.menu;
      if (
        open != null &&
        (range.focus.key !== open.key || range.focus.offset <= open.start || !range.collapsed || (open.kind === "emoji" && range.focus.offset !== open.start + 1 + open.query.length))
      ) {
        setMenu(null);
      }
      if (!range.collapsed && range.from.key === range.to.key && !pointerSelecting.current && selection.rangeCount > 0) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        setTextSelection((current) =>
          current != null && current.key === range.from.key && current.from === range.from.offset && current.to === range.to.offset ? current : { key: range.from.key, from: range.from.offset, to: range.to.offset, anchor: rect },
        );
      } else if (range.collapsed || range.from.key !== range.to.key) setTextSelection(null);
    };

    const onPointerDown = (event: PointerEvent) => {
      const handle = inTableResizeTarget(event.target);
      if (handle != null) {
        if (startTableResize(event, handle)) event.stopPropagation();
        return;
      }
      pointerSelecting.current = true;
      setTextSelection(null);
    };
    const onPointerUp = () => {
      if (!pointerSelecting.current) return;
      pointerSelecting.current = false;
      onSelectionChange();
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(tableResizeSelector) != null) event.preventDefault();
    };
    const onPointerOver = (event: PointerEvent) => {
      if (cancelResize.current != null) return;
      const handle = latest.current.editable ? inTableResizeTarget(event.target) : null;
      setResizePreview((current) => {
        if (handle == null) return null;
        return current?.blockId === handle.blockId && current.axis === handle.axis && current.index === handle.index ? current : { blockId: handle.blockId, axis: handle.axis, index: handle.index, sizes: null };
      });
    };
    const onPointerLeave = () => {
      if (cancelResize.current == null) setResizePreview(null);
    };

    root.addEventListener("beforeinput", onBeforeInput);
    root.addEventListener("input", onInput);
    root.addEventListener("compositionstart", onCompositionStart);
    root.addEventListener("compositionend", onCompositionEnd);
    root.addEventListener("paste", onPaste);
    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("mousedown", onMouseDown);
    root.addEventListener("pointerover", onPointerOver);
    root.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      root.removeEventListener("beforeinput", onBeforeInput);
      root.removeEventListener("input", onInput);
      root.removeEventListener("compositionstart", onCompositionStart);
      root.removeEventListener("compositionend", onCompositionEnd);
      root.removeEventListener("paste", onPaste);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("mousedown", onMouseDown);
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const resizeHandle = inTableResizeTarget(event.target);
    if (resizeHandle != null) {
      if (resizeTableByKey(event, resizeHandle)) event.stopPropagation();
      return;
    }
    if (menu?.kind === "emoji" && event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      setMenu(null);
      return;
    }
    if (menu != null && menu.kind !== "emoji") {
      const ids = menuOptionIds(menu);
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const current = menu.highlightedId ?? ids[0];
        const index = Math.max(0, ids.indexOf(current ?? ""));
        const nextId =
          menu.kind === "slash"
            ? nextOptionId(menuSlashOptions(menu), current, event.key)
            : event.key === "Home"
              ? ids[0]
              : event.key === "End"
                ? ids.at(-1)
                : ids[(index + (event.key === "ArrowDown" ? 1 : -1) + ids.length) % Math.max(1, ids.length)];
        setMenu({ ...menu, highlightedId: nextId });
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && ids.length > 0) {
        event.preventDefault();
        selectMenuOption(menu, menu.highlightedId ?? ids[0] ?? "");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(null);
        return;
      }
    }
    if (!editable) return;
    const conversion = punctuation.current;
    if (event.key === "Backspace" && conversion != null && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.nativeEvent.isComposing) {
      const range = readRange();
      const unit = findUnit(latest.current.blocks, conversion.key);
      if (unit != null && range?.collapsed && range.focus.key === conversion.key && range.focus.offset === conversion.from + conversion.glyph.length) {
        event.preventDefault();
        const reverted = revertPunctuation(unitContent(latest.current.blocks, unit), conversion);
        commit(withUnitContent(latest.current.blocks, unit, reverted), caretSelection({ key: unit.key, offset: conversion.from + conversion.shortcut.length }));
        return;
      }
    }
    const mod = isMacPlatform() ? event.metaKey : event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey) {
      if (key === "z") {
        event.preventDefault();
        restore(event.shiftKey ? "redo" : "undo");
        return;
      }
      if (key === "y" && !isMacPlatform()) {
        event.preventDefault();
        restore("redo");
        return;
      }
      const mark: PageMark | null = event.shiftKey ? (key === "s" || key === "x" ? "strikethrough" : null) : ({ b: "bold", i: "italic", u: "underline", e: "code" } as Record<string, PageMark>)[key] ?? null;
      if (mark != null) {
        event.preventDefault();
        toggleMarkInSelection(mark);
        return;
      }
      const listStyle: BlockStyle | null = event.shiftKey ? (event.code === "Digit9" ? "orderedList" : event.code === "Digit8" ? "unorderedList" : null) : null;
      if (listStyle != null && lastCaret.current != null) {
        event.preventDefault();
        setStyleAt(lastCaret.current.key, listStyle);
        return;
      }
    }
    if (mod && event.altKey && lastCaret.current != null) {
      const style = ({ Digit4: "orderedList", Digit5: "unorderedList", Digit6: "checklist" } as Record<string, BlockStyle>)[event.code];
      if (style != null) {
        event.preventDefault();
        setStyleAt(lastCaret.current.key, style);
        return;
      }
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
      const range = readRange();
      const unit = range == null || range.from.key !== range.to.key ? undefined : findUnit(latest.current.blocks, range.from.key);
      const focusUnit = range == null ? undefined : findUnit(latest.current.blocks, range.focus.key);
      if (range != null && unit?.kind === "code") indentCode(unit, range, event.shiftKey);
      else if (focusUnit?.cell != null) moveToCell(focusUnit, event.shiftKey ? -1 : 1);
    }
  };

  /** `i0a` / `n0a`: Tab and Shift+Tab move to the start of the next or previous cell; nothing past either end. */
  const moveToCell = (unit: EditorUnit, step: 1 | -1) => {
    const block = latest.current.blocks.find((entry) => entry.id === unit.blockId);
    if (block?.type !== "table" || unit.cell == null) return;
    const cells = block.rows.flatMap((row, rowIndex) => row.cells.map((_, column) => ({ row: rowIndex, column })));
    const index = cells.findIndex((cell) => cell.row === unit.cell?.row && cell.column === unit.cell.column);
    const next = index < 0 ? undefined : cells[index + step];
    if (next == null) return;
    const key = tableCellKey(block.id, next.row, next.column);
    placeSelection({ key, from: 0, to: 0 });
    registry.element(key)?.closest("td, th")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  /** The page's collapsed Tab, `INc` (Tab) and `LNc` (Shift+Tab): tab-indents or outdents the code lines the selection touches. */
  const indentCode = (unit: EditorUnit, range: EditorRange, outdent: boolean) => {
    const current = latest.current.blocks;
    const value = inlineText(unitContent(current, unit));
    const from = range.from.offset;
    const to = range.to.offset;
    if (!outdent && range.collapsed) {
      commit(withUnitContent(current, unit, [text(`${value.slice(0, from)}\t${value.slice(to)}`)]), caretSelection({ key: unit.key, offset: from + 1 }));
      return;
    }
    const end = !range.collapsed && value[to - 1] === "\n" ? to - 1 : to;
    const starts = [from === 0 ? 0 : value.lastIndexOf("\n", from - 1) + 1];
    for (let at = value.indexOf("\n", starts[0]); at !== -1 && at + 1 <= end; at = value.indexOf("\n", at + 1)) starts.push(at + 1);
    const removals = starts.map((start) => {
      const head = value.slice(start, start + 4);
      return head.startsWith("\t") ? 1 : (/^ {1,4}/.exec(head)?.[0].length ?? 0);
    });
    let next = value;
    let nextFrom = from;
    let nextTo = to;
    for (let index = starts.length - 1; index >= 0; index -= 1) {
      const start = starts[index] ?? 0;
      if (outdent) {
        const removed = removals[index] ?? 0;
        if (removed === 0) continue;
        next = next.slice(0, start) + next.slice(start + removed);
        if (nextFrom > start) nextFrom = Math.max(start, nextFrom - removed);
        if (nextTo > start) nextTo = Math.max(start, nextTo - removed);
      } else {
        next = `${next.slice(0, start)}\t${next.slice(start)}`;
        if (nextFrom >= start) nextFrom += 1;
        if (nextTo >= start) nextTo += 1;
      }
    }
    if (next !== value) commit(withUnitContent(current, unit, [text(next)]), { key: unit.key, from: nextFrom, to: nextTo });
  };

  // --- Layout: restore selection, portal hosts, control geometry ---------------------------

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root == null) return;
    const pending = pendingSelection.current;
    if (pending != null) {
      pendingSelection.current = null;
      placeSelection(pending);
    }
    const reveal = pendingReveal.current;
    if (reveal != null) {
      pendingReveal.current = null;
      registry.element(reveal.key)?.closest("td, th")?.scrollIntoView({ block: "nearest", inline: "nearest" });
      const table = reveal.anchor == null ? null : tableElementFor(reveal.anchor.blockId);
      if (table != null && reveal.anchor != null) {
        const delta = table.getBoundingClientRect().bottom - reveal.anchor.bottom;
        if (Math.abs(delta) > 0.5) scrollParent(table)?.scrollBy({ top: delta });
      }
    }
    const sizingId = pendingTableSizing.current;
    if (sizingId != null) {
      pendingTableSizing.current = null;
      const block = latest.current.blocks.find((entry) => entry.id === sizingId);
      const table = tableElementFor(sizingId);
      const widths = block?.type === "table" && table != null ? viewportColumnWidths(table, tableColumnCount(block)) : null;
      if (block?.type === "table" && widths != null) {
        commit(replaceBlock(latest.current.blocks, block.id, [{ ...withColumnWidths(block, widths), layout: "full-width" }]), null, { merge: true });
      }
    }
    updateTableOverflow.current?.();
    const nextAtoms = Array.from(root.querySelectorAll<HTMLElement>("[data-page-task-mention]")).flatMap((element) => {
      const mentionId = taskMentionIdFromPath(element.getAttribute("data-page-task-mention") ?? "");
      return mentionId == null ? [] : [{ element, mentionId }];
    });
    setAtoms((current) => (sameHosts(current, nextAtoms) ? current : nextAtoms));
    const nextReferences = Array.from(root.querySelectorAll<HTMLElement>("[page-reference-mention-path]")).map((element) => ({
      element,
      path: element.getAttribute("page-reference-mention-path") ?? "",
      title: element.getAttribute("page-reference-mention-title") ?? "",
    }));
    setReferences((current) => (sameHosts(current, nextReferences) ? current : nextReferences));
    const nextInks = Array.from(root.querySelectorAll<HTMLElement>("span.page-comment-highlight")).flatMap((widget) => {
      const anchor = widget.nextElementSibling;
      const threadId = anchor?.getAttribute("data-page-comment-thread");
      return anchor instanceof HTMLElement && threadId != null ? [{ widget, anchor, threadId }] : [];
    });
    setInks((current) => (sameHosts(current, nextInks) ? current : nextInks));
  });

  /** The `li` of a list row; rows render in item order. */
  const listRowElement = (blockId: string, itemId: string) => {
    const block = latest.current.blocks.find((entry) => entry.id === blockId);
    const index = isListBlock(block) ? block.items.findIndex((item) => item.id === itemId) : -1;
    const list = rootRef.current?.querySelector(`[data-page-block-id="${CSS.escape(blockId)}"] > [data-page-block-viewport] > :is(ul, ol)`);
    const row = index < 0 ? null : list?.children[index];
    return row instanceof HTMLElement ? row : null;
  };

  useLayoutEffect(() => {
    const container = containerRef.current;
    const root = rootRef.current;
    if (container == null || root == null) return;
    const origin = container.getBoundingClientRect();
    const rowOf = (blockId: string) => root.querySelector<HTMLElement>(`[data-page-block-id="${CSS.escape(blockId)}"]`);
    const firstLine = (row: HTMLElement) => {
      const block = row.querySelector<HTMLElement>("[data-page-block-viewport] > *") ?? row;
      const line = block.matches("table") ? block.querySelector("tr") : block.querySelector(":scope > hr");
      if (line != null) return line.getBoundingClientRect();
      const text = block.matches("p, h1, h2, h3, h4, h5, h6, pre") ? block : (block.querySelector<HTMLElement>("p, h1, h2, h3, h4, h5, h6, pre") ?? block);
      const rect = text.getBoundingClientRect();
      const style = getComputedStyle(text);
      const lineHeight = Number.parseFloat(style.lineHeight);
      return DOMRect.fromRect({ x: rect.left, y: rect.top + Number.parseFloat(style.paddingTop || "0"), width: rect.width, height: Number.isFinite(lineHeight) ? Math.min(rect.height, lineHeight) : rect.height });
    };
    const hovered = hoveredBlockId == null ? null : rowOf(hoveredBlockId);
    let frame: BlockControlsFrame | null = null;
    if (hovered != null) {
      const bounds = (hovered.querySelector<HTMLElement>("[data-page-block-viewport] > *") ?? hovered).getBoundingClientRect();
      const item = hoveredBlockId == null || hoveredItemId == null ? null : listRowElement(hoveredBlockId, hoveredItemId);
      const line = firstLine(item ?? hovered);
      frame = { left: bounds.left - origin.left, top: bounds.top - origin.top, width: bounds.width, height: bounds.height, lineTop: line.top - bounds.top, lineHeight: line.height };
    }
    setControlsFrame((current) => (current != null && frame != null && sameHosts([current], [frame]) ? current : frame));
    const placements = showAttribution
      ? attributionRanges(blocks, pageDocument.attribution).flatMap((range) => {
          const first = rowOf(range.blockIds[0] ?? "");
          const last = rowOf(range.blockIds.at(-1) ?? "");
          if (first == null || last == null) return [];
          const line = firstLine(first);
          return [{ range, top: line.top - origin.top, height: last.getBoundingClientRect().bottom - line.top, lineHeight: line.height }];
        })
      : [];
    setAttributionPlacements((current) =>
      current.length === placements.length && current.every((entry, index) => entry.range.key === placements[index]?.range.key && entry.top === placements[index]?.top && entry.height === placements[index]?.height && entry.range.attribution === placements[index]?.range.attribution)
        ? current
        : placements,
    );
  });

  useEffect(() => {
    const root = rootRef.current;
    if (root == null) return;
    const observer = new ResizeObserver(() => setRevision((value) => value + 1));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => cancelDrag.current?.(), []);

  /** `wB`: marks each table viewport whose table is wider than it, which turns on the scroll fade. */
  useEffect(() => {
    const root = rootRef.current;
    if (root == null) return;
    let observed = new Map<Element, HTMLElement>();
    const measure = (viewport: HTMLElement) => {
      const overflow = String(viewport.scrollWidth > viewport.clientWidth);
      if (viewport.getAttribute("data-page-table-overflow") !== overflow) viewport.setAttribute("data-page-table-overflow", overflow);
    };
    const observer = new ResizeObserver((entries) => {
      const viewports = new Set(entries.flatMap((entry) => observed.get(entry.target) ?? []));
      viewports.forEach(measure);
    });
    const update = () => {
      const next = new Map<Element, HTMLElement>();
      root.querySelectorAll<HTMLElement>('[data-page-block-type="table"] > [data-page-block-viewport]').forEach((viewport) => {
        next.set(viewport, viewport);
        if (viewport.firstElementChild != null) next.set(viewport.firstElementChild, viewport);
      });
      observed.forEach((viewport, element) => {
        if (next.has(element)) return;
        observer.unobserve(element);
        if (!next.has(viewport)) viewport.removeAttribute("data-page-table-overflow");
      });
      next.forEach((viewport, element) => {
        if (!observed.has(element)) observer.observe(element);
        else measure(viewport);
      });
      observed = next;
    };
    updateTableOverflow.current = update;
    update();
    return () => {
      updateTableOverflow.current = null;
      observer.disconnect();
      new Set(observed.values()).forEach((viewport) => viewport.removeAttribute("data-page-table-overflow"));
    };
  }, []);

  useEffect(() => () => cancelResize.current?.(false), []);
  useEffect(() => {
    cancelResize.current?.(true);
  }, [editable, blocks]);

  useEffect(() => {
    if (linkEdit == null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element && event.target.closest("[data-page-selection-toolbar]") != null)) setLinkEdit(null);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      setLinkEdit(null);
      placeSelection(linkEdit);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [linkEdit]);

  const controlsOpenRef = useRef(openMenu != null);
  controlsOpenRef.current = openMenu != null;
  useEffect(() => {
    const container = containerRef.current;
    const canvas = container?.closest<HTMLElement>("[data-page-document-canvas]") ?? container;
    if (canvas == null) return;
    const rowAt = (clientY: number) =>
      Array.from(rootRef.current?.querySelectorAll<HTMLElement>(":scope > [data-page-block-row]") ?? []).find((row) => {
        const rect = row.getBoundingClientRect();
        return clientY >= rect.top && clientY < rect.bottom;
      });
    /** `qw` for a target inside a row, otherwise `kw`: the row at the pointer's height, or the nearest one. */
    const itemAt = (row: Element | null | undefined, target: Element, clientY: number) => {
      const list = row?.querySelector(":scope > [data-page-block-viewport] > :is(ul, ol)");
      const block = latest.current.blocks.find((entry) => entry.id === row?.getAttribute("data-page-block-id"));
      if (list == null || !isListBlock(block)) return null;
      const rows = Array.from(list.children);
      const own = target.matches(hoverStructuralSelector) ? null : target.closest("li");
      let index = own?.parentElement === list ? rows.indexOf(own) : -1;
      let nearest = Number.POSITIVE_INFINITY;
      if (index < 0) {
        for (const [at, element] of rows.entries()) {
          const rect = element.getBoundingClientRect();
          const distance = clientY < rect.top ? rect.top - clientY : clientY >= rect.bottom ? clientY - rect.bottom : 0;
          if (distance < nearest) {
            nearest = distance;
            index = at;
          }
        }
      }
      return block.items[index]?.id ?? null;
    };
    const onPointerMove = (event: PointerEvent) => {
      const root = rootRef.current;
      const target = event.target;
      if (root == null || controlsOpenRef.current || event.buttons > 0 || !(target instanceof Element) || target.closest(hoverIgnoredSelector) != null) return;
      let row: Element | null | undefined = null;
      if (target !== root && root.contains(target)) row = target.matches(hoverStructuralSelector) ? rowAt(event.clientY) : target.closest("[data-page-block-row]");
      else if (target.contains(root) || target.closest("[data-page-editor-controls]") != null) row = rowAt(event.clientY);
      setHoveredBlockId(row?.getAttribute("data-page-block-id") ?? null);
      setHoveredItemId(itemAt(row, target, event.clientY));
    };
    const onPointerLeave = () => {
      if (controlsOpenRef.current) return;
      setHoveredBlockId(null);
      setHoveredItemId(null);
    };
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    return () => {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    focus: (where = "end") => {
      const units = documentUnits(latest.current.blocks);
      const unit = where === "start" ? units[0] : units.at(-1);
      if (unit == null) return;
      const offset = where === "start" ? 0 : inlineLength(unitContent(latest.current.blocks, unit));
      placeSelection({ key: unit.key, from: offset, to: offset });
    },
    hasFocus: () => rootRef.current != null && rootRef.current.ownerDocument.activeElement === rootRef.current,
    runCommand: (commandId, options) => runCommand(commandId, { insertBelow: options?.insertBelow ?? false }),
    slashContext: () => slashContextFor(lastCaret.current),
  }));

  // --- Block actions -----------------------------------------------------------------------

  const controlBlock = hoveredBlockId == null ? undefined : blocks.find((block) => block.id === hoveredBlockId);
  const controlItem = isListBlock(controlBlock) && hoveredItemId != null ? controlBlock.items.find((item) => item.id === hoveredItemId) : undefined;

  /** `U.item ?? U.block`: the hovered row, or else the hovered block. */
  const gripTarget = (): BlockTarget | null => (controlBlock == null ? null : { blockId: controlBlock.id, itemId: controlItem?.id });

  /** `Jw(vw(view), target)`: the selection's blocks and rows when the target is among several selected. */
  const targetsWith = (target: BlockTarget) => {
    const range = readRange();
    return range == null || range.collapsed ? [target] : gripTargets(selectionTargets(latest.current.blocks, range.from, range.to), target);
  };

  /** `NV`: moves the dragged blocks and rows to the drop, keeping a selection inside one text. */
  const moveContent = (targets: BlockTarget[], drop: BlockDrop) => {
    if (!latest.current.editable) return;
    const next = moveTargets(latest.current.blocks, targets, drop);
    if (next == null) return;
    const range = readRange();
    commit(next, range == null || range.from.key !== range.to.key ? null : { key: range.from.key, from: range.from.offset, to: range.to.offset });
    rootRef.current?.focus({ preventScroll: true });
  };

  const onGripPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const container = containerRef.current;
    const root = rootRef.current;
    const hovered = gripTarget();
    if (container == null || root == null || controlBlock == null || hovered == null || event.button !== 0 || event.ctrlKey) return;
    event.preventDefault();
    cancelDrag.current?.();
    const current = latest.current.blocks;
    const elements = current.flatMap((block) => {
      const row = root.querySelector<HTMLElement>(`[data-page-block-id="${CSS.escape(block.id)}"]`);
      const element = row?.querySelector<HTMLElement>("[data-page-block-viewport] > *") ?? row;
      return element == null ? [] : [element];
    });
    if (elements.length !== current.length) return;
    const indexOf = (blockId: string) => current.findIndex((block) => block.id === blockId);
    let targets = targetsWith(hovered.itemId != null && event.altKey ? { blockId: hovered.blockId } : hovered);
    const only = targets.length === 1 ? targets[0] : undefined;
    const heading = only?.itemId == null ? current[indexOf(only?.blockId ?? "")] : undefined;
    if (heading?.type === "heading") {
      const section: BlockTarget[] = [];
      for (let index = indexOf(heading.id) + 1, next = current[index]; next != null && !(next.type === "heading" && next.level <= heading.level); index += 1, next = current[index]) section.push({ blockId: next.id });
      targets = [...targets, ...section];
    }
    const rowsOnly = targets.every((target) => target.itemId != null);
    const topRanges =
      heading?.type === "heading"
        ? [{ from: indexOf(heading.id), to: indexOf(heading.id) + targets.length }]
        : targets.flatMap((target) => (target.itemId == null ? [{ from: indexOf(target.blockId), to: indexOf(target.blockId) + 1 }] : []));
    const dragged = targets.flatMap((target) => {
      const element = target.itemId == null ? elements[indexOf(target.blockId)] : listRowElement(target.blockId, target.itemId);
      return element == null ? [] : [element];
    });
    if (dragged.length !== targets.length) return;
    /** `dB`: for rows, the gaps of the list under the pointer (or the first row's own list) before top-level gaps. */
    const dropAt = (point: { x: number; y: number }, zoom: number) => {
      if (rowsOnly) {
        const at = elements.findIndex((element) => {
          const row = element.closest("[data-page-block-row]")?.getBoundingClientRect();
          return row != null && point.y >= row.top && point.y < row.bottom;
        });
        const list = current[at < 0 ? indexOf(targets[0]?.blockId ?? "") : at];
        const listElement = list == null ? null : root.querySelector<HTMLElement>(`[data-page-block-id="${CSS.escape(list.id)}"] > [data-page-block-viewport] > :is(ul, ol)`);
        if (isListBlock(list) && listElement != null) {
          const rows = Array.from(listElement.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
          const ranges = list.items.flatMap((item, index) => (targets.some((target) => target.blockId === list.id && target.itemId === item.id) ? [{ from: index, to: index + 1 }] : []));
          const gap = nearestGap(listElement, rows, ranges, point, zoom);
          if (gap != null) return { target: { blockId: list.id, index: gap.index }, rect: gap.rect };
        }
      }
      const gap = nearestGap(root, elements, topRanges, point, zoom);
      return gap == null ? null : { target: { index: gap.index }, rect: gap.rect };
    };
    cancelDrag.current = startBlockDrag<BlockDrop>({
      event: event.nativeEvent,
      handle: event.currentTarget,
      container,
      root,
      dragged,
      dropAt,
      onClick: () => openControlMenu(`block:${controlBlock.id}`),
      onDragStart: () => {
        setOpenMenu(null);
        setDragging(true);
      },
      onFinish: () => {
        cancelDrag.current = null;
        setDragging(false);
      },
      onDrop: (drop) => moveContent(targets, drop),
    });
  };

  const openControlMenu = (id: string) => {
    menuSnapshot.current = { blocks: latest.current.blocks, caret: lastCaret.current };
    const target = id.startsWith("block:") ? gripTarget() : null;
    const targets = target == null ? [] : targetsWith(target);
    setMenuTargets(targets.length > 1 ? targets : null);
    setOpenMenu(id);
  };

  const onControlMenuOpenChange = (id: string, open: boolean) => {
    if (open) {
      openControlMenu(id);
      return;
    }
    setOpenMenu((current) => (current === id ? null : current));
    rootRef.current?.focus({ preventScroll: true });
  };

  /** Menu actions only apply to the document and selection the menu was opened on. */
  const runMenuAction = (action: () => void) => {
    const snapshot = menuSnapshot.current;
    const caret = lastCaret.current;
    menuSnapshot.current = null;
    setOpenMenu(null);
    if (!editable || snapshot == null || snapshot.blocks !== latest.current.blocks || snapshot.caret?.key !== caret?.key || snapshot.caret?.offset !== caret?.offset) return;
    action();
  };

  const tableElementFor = (blockId: string) =>
    rootRef.current?.querySelector<HTMLTableElement>(`[data-page-block-id="${CSS.escape(blockId)}"] [data-page-block-viewport] > table`) ?? null;

  /** `gB`: removes a block and puts the caret at the nearest text after it, or before it when it was last. */
  const deleteBlock = (blockId: string) => {
    const current = latest.current.blocks;
    const index = current.findIndex((block) => block.id === blockId);
    if (index < 0) return;
    const remaining = current.filter((block) => block.id !== blockId);
    setHoveredBlockId(null);
    setHoveredItemId(null);
    if (remaining.length === 0) {
      const paragraph: PageBlock = { id: createPageId("block"), type: "paragraph", content: [] };
      commit([paragraph], { key: paragraph.id, from: 0, to: 0 });
      return;
    }
    const after = documentUnits(remaining.slice(index))[0];
    const before = documentUnits(remaining.slice(0, index)).at(-1);
    const caret = after != null ? { key: after.key, offset: 0 } : before != null ? { key: before.key, offset: inlineLength(unitContent(remaining, before)) } : null;
    commit(remaining, caret == null ? null : caretSelection(caret));
  };

  /** `gB` for a list row, or deleting every target of a multi-block menu, with the same caret placement. */
  const deleteTargets = (targets: BlockTarget[]) => {
    const current = latest.current.blocks;
    let remaining = current;
    for (const { blockId, itemId } of targets) remaining = itemId == null ? remaining.filter((block) => block.id !== blockId) : removeRow(remaining, blockId, itemId);
    setHoveredBlockId(null);
    setHoveredItemId(null);
    if (remaining.length === 0) {
      const paragraph: PageBlock = { id: createPageId("block"), type: "paragraph", content: [] };
      commit([paragraph], { key: paragraph.id, from: 0, to: 0 });
      return;
    }
    const units = documentUnits(current);
    const kept = new Set(documentUnits(remaining).map((unit) => unit.key));
    const firstBlock = current.findIndex((block) => targets.some((target) => target.blockId === block.id));
    const removed = (unit: EditorUnit) => targets.some(({ blockId, itemId }) => unit.blockId === blockId && (itemId == null || unit.itemId === itemId));
    let first = units.findIndex(removed);
    if (first < 0) first = units.findIndex((unit) => current.findIndex((block) => block.id === unit.blockId) > firstBlock);
    if (first < 0) first = units.length;
    const after = units.slice(first).find((unit) => kept.has(unit.key));
    const before = units.slice(0, first).reverse().find((unit) => kept.has(unit.key));
    const caret = after != null ? { key: after.key, offset: 0 } : before != null ? { key: before.key, offset: inlineLength(unitContent(remaining, before)) } : null;
    commit(remaining, caret == null ? null : caretSelection(caret));
  };

  /** `VV` (Normal width / For readability) and `BV` (Distribute columns evenly). */
  const fitTable = (block: TableBlock, mode: TableFitMode | "distribute") => {
    const root = rootRef.current;
    const table = tableElementFor(block.id);
    if (root == null || table == null) return;
    const columns = tableColumnCount(block);
    const fit = mode === "distribute" ? { layout: blockLayout(block), widths: evenColumnWidths(table, tableZoom(table), columns) } : measureTableFit(root, table, tableZoom(table), mode);
    const widths = fit?.widths;
    const current = tableColumnWidths(block);
    const unchanged = fit != null && fit.layout === blockLayout(block) && current != null && widths != null && current.length === widths.length && current.every((width, index) => width === widths[index]);
    if (fit == null || widths == null || widths.length !== columns || unchanged) {
      root.focus({ preventScroll: true });
      return;
    }
    commit(replaceBlock(latest.current.blocks, block.id, [{ ...withColumnWidths(block, widths), layout: fit.layout }]), null);
    root.focus({ preventScroll: true });
  };

  /** `itemId`: the list row the grip targeted; `targets`: every block and row of a multi-block menu. */
  const onBlockAction = (blockId: string, action: BlockAction, itemId?: string, targets?: BlockTarget[] | null) => {
    const current = latest.current.blocks;
    const block = current.find((entry) => entry.id === blockId);
    if (block == null) return;
    switch (action.kind) {
      case "turnInto": {
        const turned = turnInto(block, action.style);
        const firstKey = documentUnits([turned])[0]?.key;
        commit(replaceBlock(current, block.id, [turned]), firstKey == null ? null : { key: firstKey, from: 0, to: 0 });
        return;
      }
      case "insertBelow": {
        const paragraph: PageBlock = { id: createPageId("block"), type: "paragraph", content: [] };
        commit(insertAfter(current, block.id, [paragraph]), { key: paragraph.id, from: 0, to: 0 });
        return;
      }
      case "copyLink": {
        const url = new URL(pageShareUrl(pageId));
        url.hash = block.id;
        void copyToClipboard(url.toString()).then((copied) => copied && showLinkCopiedToast());
        return;
      }
      case "copyMarkdown":
        void copyToClipboard(blockToMarkdown(block));
        return;
      case "layout":
        commit(replaceBlock(current, block.id, [{ ...block, layout: action.layout }]), null);
        return;
      case "fit":
        if (block.type === "table") fitTable(block, action.mode);
        return;
      case "distributeColumns":
        if (block.type === "table") fitTable(block, "distribute");
        return;
      case "delete":
        if (targets != null && targets.length > 1) deleteTargets(targets);
        else if (itemId != null && action.wholeList !== true) deleteTargets([{ blockId: block.id, itemId }]);
        else deleteBlock(block.id);
        return;
    }
  };

  /** The caret cell after moving a row or column (`o0a`): it follows the moved cell, otherwise lands on the moved axis. */
  const caretAfterMove = (blockId: string, axis: TableAxis, from: number, to: number): Caret => {
    const caret = lastCaret.current;
    const cell = caret == null ? undefined : findUnit(latest.current.blocks, caret.key)?.cell;
    const inside = caret != null && cell != null && findUnit(latest.current.blocks, caret.key)?.blockId === blockId && (axis === "row" ? cell.row === from : cell.column === from);
    if (inside) return { key: axis === "row" ? tableCellKey(blockId, to, cell.column) : tableCellKey(blockId, cell.row, to), offset: caret.offset };
    return { key: axis === "row" ? tableCellKey(blockId, to, 0) : tableCellKey(blockId, 0, to), offset: 0 };
  };

  const moveTableAxisTo = (blockId: string, axis: TableAxis, from: number, to: number) => {
    const current = latest.current.blocks;
    const block = current.find((entry) => entry.id === blockId);
    const moved = block?.type === "table" ? moveTableAxis(block, axis, from, to) : null;
    if (moved == null) return;
    const caret = caretAfterMove(blockId, axis, from, to);
    commit(replaceBlock(current, blockId, [moved]), caretSelection(caret));
  };

  /** `_B`: a row or column menu action; deleting the last row or column deletes the table. */
  const runTableAxisAction = (blockId: string, axis: TableAxis, index: number, action: TableAxisAction) => {
    const current = latest.current.blocks;
    const block = current.find((entry) => entry.id === blockId);
    if (block?.type !== "table") return null;
    if (action === "delete" && (axis === "row" ? block.rows.length : tableColumnCount(block)) === 1) {
      deleteBlock(blockId);
      return null;
    }
    if (action === "move-before" || action === "move-after") {
      moveTableAxisTo(blockId, axis, index, index + (action === "move-after" ? 1 : -1));
      return null;
    }
    let next: TableBlock | null;
    let caret: Caret;
    if (action === "delete") {
      next = axis === "row" ? deleteTableRow(block, index) : deleteTableColumn(block, index);
      if (next == null) return null;
      caret = { key: axis === "row" ? tableCellKey(blockId, Math.min(index, next.rows.length - 1), 0) : tableCellKey(blockId, 0, Math.min(index, tableColumnCount(next) - 1)), offset: 0 };
    } else {
      const at = index + (action === "insert-after" ? 1 : 0);
      next = axis === "row" ? insertTableRow(block, at) : insertTableColumn(block, at);
      caret = { key: axis === "row" ? tableCellKey(blockId, at, 0) : tableCellKey(blockId, 0, at), offset: 0 };
    }
    commit(replaceBlock(current, blockId, [next]), caretSelection(caret));
    if (action === "delete") return null;
    pendingReveal.current = { key: caret.key };
    return pendingReveal.current;
  };

  /** The add buttons; a new bottom row keeps the table's bottom edge where it was. */
  const appendTableAxis = (blockId: string, axis: TableAxis, row: number) => {
    const block = latest.current.blocks.find((entry) => entry.id === blockId);
    const table = tableElementFor(blockId);
    if (block?.type !== "table" || table == null) return;
    const bottom = table.getBoundingClientRect().bottom;
    const index = axis === "row" ? block.rows.length - 1 : (block.rows[row]?.cells.length ?? tableColumnCount(block)) - 1;
    const reveal = runTableAxisAction(blockId, axis, index, "insert-after");
    if (reveal != null && axis === "row") reveal.anchor = { blockId, bottom };
  };

  /** `MB`: stores resized column widths, or one row's height. */
  const commitTableSizes = (blockId: string, axis: TableAxis, index: number, sizes: number[]) => {
    const current = latest.current.blocks;
    const block = current.find((entry) => entry.id === blockId);
    if (block?.type !== "table") return;
    const size = sizes[index];
    if (axis === "row" && (size == null || block.rows[index]?.height === size)) return;
    const next = axis === "column" ? withColumnWidths(block, sizes) : withRowHeight(block, index, size ?? 0);
    commit(replaceBlock(current, blockId, [next]), null);
  };

  /** `EB` pointerdown: drags a column edge (min 64px) or row edge (min 1px) with a live preview; Escape cancels. */
  const startTableResize = (event: PointerEvent, target: { blockId: string; axis: TableAxis; index: number; table: HTMLTableElement }) => {
    if (!latest.current.editable || event.button !== 0) return false;
    event.preventDefault();
    cancelResize.current?.(true);
    const { blockId, axis, index, table } = target;
    const startBlocks = latest.current.blocks;
    const zoom = tableZoom(table);
    const sizes = measureTableSizes(table, axis);
    if (sizes[index] == null) return false;
    const minimum = axis === "column" ? minimumColumnWidth : 1;
    const direction = axis === "column" && getComputedStyle(table).direction === "rtl" ? -1 : 1;
    const start = axis === "column" ? event.clientX : event.clientY;
    const view = table.ownerDocument.defaultView ?? window;
    let next = sizes;
    let frame: number | null = null;
    const resize = (position: number) => {
      const size = Math.max(minimum, (sizes[index] ?? 0) + Math.round((direction * (position - start)) / zoom));
      if (next[index] === size) return false;
      next = sizes.map((value, at) => (at === index ? size : value));
      return true;
    };
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== event.pointerId || !resize(axis === "column" ? move.clientX : move.clientY) || frame != null) return;
      frame = view.requestAnimationFrame(() => {
        frame = null;
        setResizePreview({ blockId, axis, index, sizes: next });
      });
    };
    const stop = (clear: boolean) => {
      if (frame != null) view.cancelAnimationFrame(frame);
      view.removeEventListener("pointermove", onMove);
      view.removeEventListener("pointerup", onUp);
      view.removeEventListener("pointercancel", onCancel);
      view.removeEventListener("blur", onCancel);
      view.removeEventListener("keydown", onKey, true);
      cancelResize.current = null;
      if (clear) setResizePreview(null);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== event.pointerId) return;
      const position = axis === "column" ? up.clientX : up.clientY;
      resize(position);
      stop(false);
      if (latest.current.editable && latest.current.blocks === startBlocks && position !== start) commitTableSizes(blockId, axis, index, next);
      setResizePreview(null);
    };
    const onCancel = () => stop(true);
    const onKey = (key: globalThis.KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      key.stopPropagation();
      stop(true);
    };
    view.addEventListener("pointermove", onMove);
    view.addEventListener("pointerup", onUp);
    view.addEventListener("pointercancel", onCancel);
    view.addEventListener("blur", onCancel);
    view.addEventListener("keydown", onKey, true);
    cancelResize.current = stop;
    setResizePreview({ blockId, axis, index, sizes: null });
    return true;
  };

  /** `EB` keydown: arrow keys resize by 10px (50px with Shift). */
  const resizeTableByKey = (event: KeyboardEvent<HTMLElement>, target: { blockId: string; axis: TableAxis; index: number; table: HTMLTableElement }) => {
    const { blockId, axis, index, table } = target;
    const keys = axis === "row" ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
    if (!latest.current.editable || !keys.includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return false;
    event.preventDefault();
    const sizes = measureTableSizes(table, axis);
    const size = sizes[index];
    if (size == null) return true;
    const rtl = axis === "column" && getComputedStyle(table).direction === "rtl";
    const step = (event.key === keys[1] ? 1 : -1) * (rtl ? -1 : 1) * (event.shiftKey ? 50 : 10);
    sizes[index] = Math.max(axis === "column" ? minimumColumnWidth : 1, size + step);
    commitTableSizes(blockId, axis, index, sizes);
    return true;
  };

  /** `DB` for the handles inside the table: each cell's trailing column edge. */
  const inTableResizeTarget = (target: EventTarget | null) => {
    const handle = target instanceof Element ? target.closest(tableResizeSelector) : null;
    const cell = handle?.closest("td, th");
    const table = cell?.closest("table");
    const blockId = table?.closest("[data-page-block-id]")?.getAttribute("data-page-block-id");
    if (!(cell instanceof HTMLTableCellElement) || table == null || blockId == null || !rootRef.current?.contains(table)) return null;
    return { blockId, axis: "column" as const, index: cell.cellIndex, table };
  };

  const onTableAxisPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, blockId: string, axis: TableAxis, index: number) => {
    const container = containerRef.current;
    const root = rootRef.current;
    const table = tableElementFor(blockId);
    if (container == null || root == null || table == null || event.button !== 0 || event.ctrlKey) return;
    event.preventDefault();
    cancelDrag.current?.();
    const startBlocks = latest.current.blocks;
    cancelDrag.current = startTableAxisDrag({
      event: event.nativeEvent,
      handle: event.currentTarget,
      container,
      root,
      table,
      axis,
      index,
      isCurrent: () => latest.current.blocks === startBlocks && table.isConnected,
      onClick: () => openControlMenu(`${axis}:${index}`),
      onDragStart: () => {
        setOpenMenu(null);
        setDragging(true);
      },
      onFinish: () => {
        cancelDrag.current = null;
        setDragging(false);
      },
      onDrop: (destination) => moveTableAxisTo(blockId, axis, index, destination),
    });
  };

  const toggleTask = (blockId: string, itemId: string) => {
    if (!editable) return;
    const current = latest.current.blocks;
    commit(
      current.map((block) => (block.id === blockId && block.type === "list" ? { ...block, items: block.items.map((item) => (item.id === itemId ? { ...item, checked: !item.checked } : item)) } : block)),
      null,
    );
  };

  // --- Rendering ---------------------------------------------------------------------------

  const activeBlockId = focused && activeKey != null ? findUnit(blocks, activeKey)?.blockId : undefined;
  const placeholder = intl.formatMessage(pageMessages.editorPlaceholder);
  const onlyEmptyParagraph = blocks.length === 1 && blocks[0]?.type === "paragraph" && inlineLength(blocks[0].content) === 0;

  const unitElement = (unit: EditorUnit, as: UnitTag, extra: Record<string, string | undefined> = {}) => (
    <EditableUnit key={unit.key} as={as} html={unitHtml(unit, unitContent(blocks, unit), mentions)} registry={registry} unitKey={unit.key} {...extra} />
  );

  const renderBlock = (block: PageBlock): ReactNode => {
    const layout = block.layout != null && block.layout !== "normal" ? block.layout : undefined;
    const units = documentUnits([block]);
    const first = units[0];
    switch (block.type) {
      case "paragraph": {
        const showPlaceholder = editable && inlineLength(block.content) === 0 && (activeBlockId === block.id || onlyEmptyParagraph);
        return first == null ? null : unitElement(first, "p", { "data-writing-block-empty-placeholder": showPlaceholder ? placeholder : undefined });
      }
      case "heading":
        return first == null ? null : unitElement(first, headingTags[block.level]);
      case "blockquote":
        return <blockquote>{first == null ? null : unitElement(first, "p")}</blockquote>;
      case "callout":
        return (
          <div data-page-callout="true" data-emoji={block.emoji}>
            <div data-page-callout-icon="" contentEditable={false}>
              <CalloutIcon emoji={block.emoji} />
            </div>
            <div data-page-callout-content="true" id={`${block.id}-content`}>
              {first == null ? null : unitElement(first, "p")}
            </div>
          </div>
        );
      case "code_block":
        return (
          <pre data-page-layout={layout} data-language={block.lang ?? undefined}>
            {first == null ? null : unitElement(first, "code")}
          </pre>
        );
      case "horizontal_rule":
        return <hr contentEditable={false} />;
      case "list":
        return (
          <ul data-type={block.task ? "taskList" : undefined}>
            {block.items.map((item, index) => {
              const unit = units[index];
              if (unit == null) return null;
              if (!block.task) return <li key={item.id}>{unitElement(unit, "p")}</li>;
              return (
                <li key={item.id} data-task-list-item="true" data-checked={String(item.checked === true)}>
                  <span className="task-list-item-checkbox" contentEditable={false}>
                    <input type="checkbox" tabIndex={-1} checked={item.checked === true} disabled={!editable} onChange={() => toggleTask(block.id, item.id)} />
                  </span>
                  <div className="task-list-item-content">{unitElement(unit, "p")}</div>
                </li>
              );
            })}
          </ul>
        );
      case "ordered_list":
        return (
          <ol start={block.start}>
            {block.items.map((item, index) => {
              const unit = units[index];
              return unit == null ? null : <li key={item.id}>{unitElement(unit, "p")}</li>;
            })}
          </ol>
        );
      case "table": {
        const preview = resizePreview?.blockId === block.id ? resizePreview : null;
        const sizing = tableSizing(block, blockLayout(block), preview?.axis === "column" ? preview.sizes : null);
        const stored = tableColumnWidths(block);
        const resizeLabel = intl.formatMessage(tableMessages.resizeColumn);
        return (
          <table data-page-layout={blockLayout(block)} data-page-table-resized={sizing == null ? undefined : "true"} style={sizing?.style}>
            <tbody>
              {block.rows.map((row, rowIndex) => {
                const height = preview?.axis === "row" && preview.index === rowIndex && preview.sizes != null ? preview.sizes[rowIndex] : row.height;
                return (
                  <tr key={rowIndex} data-page-row-height={row.height} style={height == null ? undefined : { height }}>
                    {row.cells.map((cell, column) => {
                      const unit = units.find((entry) => entry.cell?.row === rowIndex && entry.cell.column === column);
                      const width = sizing?.widths[column];
                      const header = rowIndex === 0;
                      const Cell = header ? "th" : "td";
                      return (
                        <Cell
                          key={column}
                          style={{ ...(header ? { fontWeight: "normal" } : {}), ...(cell.align != null ? { textAlign: cell.align } : {}), ...(header && width != null ? { width } : {}) }}
                          data-page-column-width={stored?.[column] ?? undefined}
                          data-page-column-active={String(preview?.axis === "column" && preview.index === column)}
                        >
                          {unit == null ? null : unitElement(unit, "p")}
                          {header ? (
                            <span
                              data-page-column-resize=""
                              contentEditable={false}
                              tabIndex={0}
                              role="separator"
                              aria-label={resizeLabel}
                              aria-orientation="vertical"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(((width ?? 1) / (sizing?.totalWidth ?? row.cells.length)) * 100)}
                            />
                          ) : (
                            <span data-page-column-resize="" contentEditable={false} aria-hidden="true" />
                          )}
                        </Cell>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      }
      case "page_image":
        return <ImageView block={block} />;
      case "page_visualization":
        return <VisualizationView block={block} />;
    }
  };

  const threadsById = new Map(pageDocument.threads.map((thread) => [thread.id, thread]));
  const resolvedThread = (threadId: string | undefined) => threadId != null && threadsById.get(threadId)?.state === "resolved";
  const textSelectionUnit = textSelection == null ? undefined : findUnit(blocks, textSelection.key);
  const textSelectionMarks = new Set<PageMark>();
  let textSelectionLink: { href: string | null; active: boolean; text: string } = { href: null, active: false, text: "" };
  if (textSelection != null && textSelectionUnit != null) {
    const [, rest] = splitInline(unitContent(blocks, textSelectionUnit), textSelection.from);
    const [selected] = splitInline(rest, textSelection.to - textSelection.from);
    const runs = selected.filter((run) => run.kind === "text");
    for (const mark of ["bold", "italic", "underline", "strikethrough", "code"] as const) {
      if (runs.length > 0 && runs.every((run) => run.kind === "text" && run.marks?.includes(mark))) textSelectionMarks.add(mark);
    }
    const first = runs[0];
    textSelectionLink = {
      href: first?.kind === "text" ? (first.href ?? null) : null,
      active: runs.length > 0 && runs.every((run) => run.kind === "text" && run.href != null),
      text: inlineText(selected),
    };
  }
  const textSelectionBlock = textSelectionUnit == null ? undefined : blocks.find((block) => block.id === textSelectionUnit.blockId);

  /** `Te("link")`: pins the selected range and switches the toolbar to its link form. */
  const openLinkEditor = () => {
    if (!editable || textSelection == null || textSelectionUnit?.kind !== "inline") return;
    const { href, text: selectedText } = textSelectionLink;
    setLinkEdit({ key: textSelection.key, from: textSelection.from, to: textSelection.to, anchor: textSelection.anchor, href, title: href != null && /^https?:/u.test(href) ? selectedText : undefined });
  };

  /** `PN`'s save and remove: relinks the pinned range, replacing it with the edited title as one run when the title changed. */
  const applyLink = (href: string | null, title?: string) => {
    const edit = linkEdit;
    setLinkEdit(null);
    const current = latest.current.blocks;
    const unit = edit == null ? undefined : findUnit(current, edit.key);
    if (!editable || edit == null || unit == null) return;
    const [before, rest] = splitInline(unitContent(current, unit), edit.from);
    const [selected, after] = splitInline(rest, edit.to - edit.from);
    if (href != null && title != null && title !== inlineText(selected)) {
      const first = selected.find((run) => run.kind === "text");
      const caret = edit.from + title.length;
      commit(withUnitContent(current, unit, concatInline([...before, { ...text(title, first?.kind === "text" ? first.marks : undefined), href }], after)), { key: edit.key, from: caret, to: caret });
      return;
    }
    const relinked = selected.map((run) => {
      if (run.kind !== "text") return run;
      const { href: _previous, ...plain } = run;
      return href == null ? plain : { ...plain, href };
    });
    commit(withUnitContent(current, unit, concatInline([...before, ...relinked], after)), { key: edit.key, from: edit.from, to: edit.to });
  };

  /** `PN`'s page pick: the pinned range becomes a link to the Page. */
  const selectLinkPage = (targetPageId: string) => {
    const edit = linkEdit;
    setLinkEdit(null);
    if (editable && edit != null) insertPageReference(targetPageId, edit);
  };

  const commentAction =
    canComment && textSelection != null && textSelectionUnit?.kind === "inline" && textSelectionBlock != null ? (
      <Button
        color="ghostActive"
        size="toolbar"
        onClick={() => {
          const content = unitContent(blocks, textSelectionUnit);
          const [, rest] = splitInline(content, textSelection.from);
          const quote = inlineText(splitInline(rest, textSelection.to - textSelection.from)[0]);
          document.getSelection()?.removeAllRanges();
          setTextSelection(null);
          onRequestComment({ blockId: textSelectionBlock.id, unitKey: textSelectionUnit.key, from: textSelection.from, to: textSelection.to, quote });
        }}
      >
        <TextBubbleLight16Icon />
        <FormattedMessage {...commentMessages.commentOnSelection} />
      </Button>
    ) : null;
  const toolbarAnchor = linkEdit?.anchor ?? (textSelection != null && (editable || commentAction != null) && textSelectionUnit?.kind !== "code" ? textSelection.anchor : null);

  const attributionFor = (blockId: string) => {
    const entry = pageDocument.attribution[blockId];
    return entry == null ? undefined : <AttributionFooter attribution={entry} />;
  };
  const focusEditor = () => rootRef.current?.focus({ preventScroll: true });

  // `CH`: the table holding the caret while the editor (or the table controls) has focus; an open
  // row, column or table menu and an axis drag keep the last target.
  const caretUnit = activeKey == null ? undefined : findUnit(blocks, activeKey);
  const previousTableTarget = stickyTableTarget.current;
  const tableMenuOpen =
    previousTableTarget != null && openMenu != null && (openMenu.startsWith("row:") || openMenu.startsWith("column:") || openMenu === `block:${previousTableTarget.blockId}`);
  const candidateTarget: TableTarget | null =
    editable && (focused || controlsFocused) && caretUnit?.cell != null
      ? { blockId: caretUnit.blockId, row: caretUnit.cell.row, column: caretUnit.cell.column }
      : editable && (tableMenuOpen || dragging)
        ? previousTableTarget
        : null;
  const tableBlock = candidateTarget == null ? undefined : blocks.find((block): block is TableBlock => block.id === candidateTarget.blockId && block.type === "table");
  const tableTarget = tableBlock != null && candidateTarget != null && tableBlock.rows[candidateTarget.row]?.cells[candidateTarget.column] != null ? candidateTarget : null;
  const tableElement = tableTarget == null ? null : tableElementFor(tableTarget.blockId);
  const tableRtl = tableElement != null && getComputedStyle(tableElement).direction === "rtl";
  const gripHidden = controlBlock?.type === "table" && tableTarget?.blockId === controlBlock.id;
  const tableControls =
    tableTarget != null && tableBlock != null && tableElement != null && containerRef.current != null ? (
      <TableControls
        key={tableBlock.id}
        block={tableBlock}
        table={tableElement}
        target={tableTarget}
        container={containerRef.current}
        dragging={dragging}
        openMenu={openMenu}
        renderMenu={(kind: ControlKind, index, label, allowDrag, tabIndex) => {
          const id = kind === "block" ? `block:${tableBlock.id}` : `${kind}:${index ?? 0}`;
          return (
            <PageControlMenu
              kind={kind}
              block={tableBlock}
              axisIndex={index}
              axisLabel={label}
              axisTabIndex={tabIndex}
              compact
              allowDrag={allowDrag}
              open={openMenu === id}
              dragging={dragging}
              rtl={tableRtl}
              attribution={kind === "block" ? attributionFor(tableBlock.id) : undefined}
              onOpenChange={(open) => onControlMenuOpenChange(id, open)}
              onAction={(action) => runMenuAction(() => onBlockAction(tableBlock.id, action))}
              onAxisAction={kind === "block" || index == null ? undefined : (action) => runMenuAction(() => void runTableAxisAction(tableBlock.id, kind, index, action))}
              onPointerDown={kind === "block" || index == null ? undefined : (event) => onTableAxisPointerDown(event, tableBlock.id, kind, index)}
              onEscape={focusEditor}
            />
          );
        }}
        onAppend={(axis) => appendTableAxis(tableBlock.id, axis, tableTarget.row)}
        onDelete={() => deleteBlock(tableBlock.id)}
        onResizePointerDown={(event, axis, index) => {
          if (startTableResize(event.nativeEvent, { blockId: tableBlock.id, axis, index, table: tableElement })) event.stopPropagation();
        }}
        onResizeKeyDown={(event, axis, index) => {
          if (resizeTableByKey(event, { blockId: tableBlock.id, axis, index, table: tableElement })) event.stopPropagation();
        }}
        onEscape={focusEditor}
      />
    ) : null;
  useLayoutEffect(() => {
    stickyTableTarget.current = tableTarget;
  });

  return (
    <div
      ref={containerRef}
      className="relative"
      data-page-document-selection=""
      data-codex-character-input-boundary=""
      role="presentation"
      onFocus={(event) => {
        const inside = event.target instanceof Element && event.target.closest("[data-page-table-controls]") != null;
        if (inside !== controlsFocused) setControlsFocused(inside);
      }}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-page-table-controls]") != null)) setControlsFocused(false);
      }}
    >
      <div className="group/page-presence" data-codex-escape-boundary="">
      <div
        className={clsx(writingBlockCss.root, "writing-block-editor", pageCss.PageDocumentTheme, "px-0")}
        data-newline-selection-appearance="none"
        data-table-selection-appearance="subtle"
        style={writingBlockTheme}
      >
        <div
          ref={rootRef}
          className={clsx("ProseMirror", writingBlockCss.content, pageCss.PageDocument, focused && "ProseMirror-focused")}
          contentEditable={editable}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={intl.formatMessage(pageMessages.editorLabel)}
          translate="no"
          tabIndex={0}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            setFocused(false);
            if (menu?.kind === "emoji") {
              const picker = document.getElementById(event.currentTarget.getAttribute("aria-controls") ?? "")?.closest("[data-symbol-picker]");
              if ((event.relatedTarget instanceof Node && picker?.contains(event.relatedTarget)) || (event.relatedTarget == null && !document.hasFocus())) return;
            }
            setMenu(null);
          }}
          onKeyDown={onKeyDown}
          onClick={(event) => {
            const anchor = event.target instanceof Element ? event.target.closest("[data-page-comment-thread]") : null;
            const threadId = anchor?.getAttribute("data-page-comment-thread");
            if (threadId != null) onSelectThread(threadId);
          }}
          onMouseOver={(event) => {
            const anchor = event.target instanceof Element ? event.target.closest("[data-page-comment-thread]") : null;
            const threadId = anchor?.getAttribute("data-page-comment-thread") ?? null;
            if (threadId !== hoveredThreadId) setHoveredThreadId(threadId);
          }}
        >
          {blocks.map((block) => (
            <div
              key={block.id}
              data-page-block-row=""
              data-page-block-id={block.id}
              data-page-block-type={block.type}
              data-page-block-layout={blockLayout(block)}
              data-page-active-block={activeBlockId === block.id ? "" : undefined}
              data-page-controls-visible={editable && hoveredBlockId === block.id ? "" : undefined}
              data-page-image-block={block.type === "page_image" ? "" : undefined}
            >
              <div data-page-block-viewport="">{renderBlock(block)}</div>
            </div>
          ))}
        </div>
      </div>
      </div>
      {editable ? (
        <PageBlockControls
          block={gripHidden ? null : (controlBlock ?? null)}
          frame={controlsFrame}
          listItem={controlItem != null}
          multiple={menuTargets != null && controlBlock != null && openMenu === `block:${controlBlock.id}`}
          open={controlBlock != null && openMenu === `block:${controlBlock.id}`}
          dragging={dragging}
          onOpenChange={(open) => {
            if (controlBlock != null) onControlMenuOpenChange(`block:${controlBlock.id}`, open);
          }}
          attribution={controlBlock == null ? undefined : attributionFor(controlBlock.id)}
          tableControls={tableControls}
          onAction={(action) => {
            if (controlBlock != null) runMenuAction(() => onBlockAction(controlBlock.id, action, controlItem?.id, menuTargets));
          }}
          onGripPointerDown={onGripPointerDown}
          onEscape={focusEditor}
        />
      ) : null}
      {showAttribution ? <PageAttribution placements={attributionPlacements} /> : null}
      {atoms.map(({ element, mentionId }) => {
        const mention = mentions[mentionId];
        return mention == null
          ? null
          : createPortal(<TaskMentionChip mention={mention} viewer={selfUserId} resolved={resolvedThread(mention.commentThreadId)} onCompose={onComposeTaskMention} />, element, mentionId);
      })}
      {references.map(({ element, path, title }, index) => createPortal(<PageReferenceChip path={path} title={title} onOpen={openLinkedPage} />, element, `${index}:${path}`))}
      {editable && capabilities.canLinkPage ? (
        <LinkPageDialog
          open={linkDialog != null}
          sourcePageId={pageId}
          onCancel={linkDialog?.action?.cancel}
          onCreateSubpage={capabilities.canCreateSubpage ? () => createSubpage(linkDialog?.action) : undefined}
          onOpenChange={(open) => {
            if (!open) setLinkDialog(null);
          }}
          onSelect={(target) => {
            if (latest.current.editable && (linkDialog?.action == null || linkDialog.action.commit())) insertPageReference(target.page_id, null);
          }}
        />
      ) : null}
      {inks.map(({ widget, anchor, threadId }, index) => {
        const thread = threadsById.get(threadId);
        if (thread == null || thread.state === "resolved") return null;
        const agent = thread.messages[0]?.author.kind !== "user";
        return createPortal(
          <CommentInk widget={widget} anchor={anchor} active={activeThreadId === threadId} agent={agent} hovered={hoveredThreadId === threadId || highlightedThreadId === threadId} revision={revision} />,
          widget,
          `${threadId}-${index}`,
        );
      })}
      {toolbarAnchor != null ? (
        <SelectionToolbarLayer pageId={pageId} anchor={toolbarAnchor}>
          {linkEdit != null ? (
            <LinkForm
              initialHref={linkEdit.href}
              initialTitle={linkEdit.title}
              sourcePageId={pageId}
              onCancel={() => {
                setLinkEdit(null);
                placeSelection(linkEdit);
              }}
              onRemove={linkEdit.href == null ? undefined : () => applyLink(null)}
              onSave={applyLink}
              onSelectPage={selectLinkPage}
            />
          ) : textSelection != null ? (
            <SelectionToolbar
              canWrite={editable && textSelectionUnit?.kind === "inline"}
              activeMarks={textSelectionMarks}
              activeStyle={textSelectionBlock == null ? null : blockStyle(textSelectionBlock)}
              linkActive={textSelectionLink.active}
              commentAction={commentAction}
              onToggleMark={(mark) => {
                if (textSelectionUnit == null) return;
                const content = toggleMark(unitContent(blocks, textSelectionUnit), textSelection.from, textSelection.to, mark);
                commit(withUnitContent(blocks, textSelectionUnit, content), { key: textSelection.key, from: textSelection.from, to: textSelection.to });
              }}
              onSelectStyle={(style) => setStyleAt(textSelection.key, style)}
              onEditLink={openLinkEditor}
            />
          ) : null}
        </SelectionToolbarLayer>
      ) : null}
      {menu != null && (focused || menu.kind === "emoji") ? (
        <InlineMenuPopup
          menu={menu}
          options={menu.kind === "slash" ? menuSlashOptions(menu) : null}
          mentions={menu.kind === "mention" ? menuMentionOptions(menu) : null}
          keyboardTarget={rootRef.current}
          onHighlight={(id) => setMenu({ ...menu, highlightedId: id })}
          onSelect={(id) => selectMenuOption(menu, id)}
          onSelectEmoji={(emoji) => selectEmoji(emoji, menu)}
          onDismiss={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

interface InlineMenuPopupProps {
  menu: InlineMenu;
  options: ReturnType<typeof slashOptions> | null;
  mentions: MentionOption[] | null;
  /** The editor root, which keeps focus and drives the emoji grid. */
  keyboardTarget: HTMLElement | null;
  onHighlight: (id: string) => void;
  onSelect: (id: string) => void;
  onSelectEmoji: (emoji: string) => void;
  onDismiss: () => void;
}

const MotionSuggestionSurface = motion.create(SuggestionSurface);
const slashMenuMaxHeight = menuContentMaxHeight("tall", "var(--page-slash-menu-available-height, 100vh)") ?? "";
/** `G = 8 + 2 * zoom` at zoom 1. */
const slashMenuOffset = 10;

/** `SLComponent` popup: the slash, mention or `:emoji` menu floating below the caret. */
function InlineMenuPopup({ menu, options, mentions, keyboardTarget, onHighlight, onSelect, onSelectEmoji, onDismiss }: InlineMenuPopupProps) {
  const intl = useIntl();
  const reducedMotion = useReducedMotion();
  const anchor = new DOMRect(menu.anchor.left, menu.anchor.bottom);
  const [ref, style, availableHeight] = useAnchoredStyle(anchor, "bottom-start", slashMenuOffset);
  const highlightedId = menu.highlightedId ?? (options ?? mentions ?? [])[0]?.id;
  if (menu.kind === "emoji" ? keyboardTarget == null : (options ?? mentions ?? []).length === 0) return null;
  return createPortal(
    <div ref={ref} className="z-50" style={style}>
      {menu.kind === "emoji" && keyboardTarget != null ? (
        <InlineSymbolPicker
          key={menu.start}
          keyboardTarget={keyboardTarget}
          onDismiss={onDismiss}
          capabilities={{ emoji: {} }}
          onSelect={(selection) => {
            if (selection.kind !== "emoji") return;
            keyboardTarget.focus({ preventScroll: true });
            onSelectEmoji(selection.value);
          }}
          query={menu.query}
        />
      ) : options != null ? (
        <MotionSuggestionSurface
          key="slash-menu"
          className="z-50 m-px"
          aria-label={intl.formatMessage(slashMenuMessages.label)}
          variant="floating"
          width="panelWide"
          role="menu"
          initial={{ opacity: reducedMotion ? 1 : 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.15, ease: menuEase }}
          style={{ maxHeight: slashMenuMaxHeight, ["--page-slash-menu-available-height" as string]: `${availableHeight}px` }}
        >
          <SlashMenuList maxHeight={slashMenuMaxHeight} options={options} query={menu.query} currentOptionId={highlightedId} onHighlight={onHighlight} onSelect={onSelect} />
        </MotionSuggestionSurface>
      ) : (
        <MentionMenu options={mentions ?? []} highlightedId={highlightedId} onHighlight={onHighlight} onSelect={(option) => onSelect(option.id)} />
      )}
    </div>,
    getPortalRoot(),
  );
}
