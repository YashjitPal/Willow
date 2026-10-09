import { concatInline, inlineLength, inlineText, splitInline } from "./inline-dom";
import { createPageId, emptyParagraph, text, type HeadingLevel, type PageBlock, type PageInline, type PageListItem } from "./state/page-document";
import type { PageUnitRef } from "./state/page-documents-store";
import { createTable, tableSizeFromQuery } from "./table-model";

/** Styles offered by the block menu's Turn into submenu (`eH`). */
export type BlockStyle =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "unorderedList"
  | "orderedList"
  | "checklist"
  | "quote"
  | "callout"
  | "code";

export type UnitKind = "inline" | "code";

export interface EditorUnit extends PageUnitRef {
  key: string;
  kind: UnitKind;
  /** Coordinates of a table cell's paragraph. */
  cell?: { row: number; column: number };
}

export interface Caret {
  key: string;
  offset: number;
}

export function unitKey(ref: PageUnitRef) {
  return ref.itemId == null ? ref.blockId : `${ref.blockId}/${ref.itemId}`;
}

function cellItemId(row: number, column: number) {
  return `r${row}c${column}`;
}

/** Key of the paragraph unit in a table cell. */
export function tableCellKey(blockId: string, row: number, column: number) {
  return unitKey({ blockId, itemId: cellItemId(row, column) });
}

export function blockUnits(block: PageBlock): EditorUnit[] {
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "blockquote":
    case "callout":
      return [{ key: block.id, blockId: block.id, kind: "inline" }];
    case "code_block":
      return [{ key: block.id, blockId: block.id, kind: "code" }];
    case "list":
    case "ordered_list":
      return block.items.map((item) => ({ key: unitKey({ blockId: block.id, itemId: item.id }), blockId: block.id, itemId: item.id, kind: "inline" }));
    case "table":
      return block.rows.flatMap((row, rowIndex) =>
        row.cells.map((_, column) => {
          const itemId = cellItemId(rowIndex, column);
          return { key: unitKey({ blockId: block.id, itemId }), blockId: block.id, itemId, kind: "inline" as const, cell: { row: rowIndex, column } };
        }),
      );
    default:
      return [];
  }
}

export function documentUnits(blocks: PageBlock[]) {
  return blocks.flatMap(blockUnits);
}

export function findUnit(blocks: PageBlock[], key: string) {
  return documentUnits(blocks).find((unit) => unit.key === key);
}

export function unitContent(blocks: PageBlock[], unit: EditorUnit): PageInline[] {
  const block = blocks.find((entry) => entry.id === unit.blockId);
  if (block == null) return [];
  if (block.type === "code_block") return block.text === "" ? [] : [text(block.text)];
  if (block.type === "table" && unit.cell != null) return block.rows[unit.cell.row]?.cells[unit.cell.column]?.content ?? [];
  if ((block.type === "list" || block.type === "ordered_list") && unit.itemId != null) {
    return block.items.find((item) => item.id === unit.itemId)?.content ?? [];
  }
  return "content" in block ? block.content : [];
}

export function withUnitContent(blocks: PageBlock[], unit: EditorUnit, content: PageInline[]): PageBlock[] {
  return blocks.map((block) => {
    if (block.id !== unit.blockId) return block;
    if (block.type === "code_block") return { ...block, text: inlineText(content) };
    if (block.type === "table" && unit.cell != null) {
      const { row, column } = unit.cell;
      return {
        ...block,
        rows: block.rows.map((entry, index) => (index === row ? { ...entry, cells: entry.cells.map((cell, cellIndex) => (cellIndex === column ? { ...cell, content } : cell)) } : entry)),
      };
    }
    if ((block.type === "list" || block.type === "ordered_list") && unit.itemId != null) {
      return { ...block, items: block.items.map((item) => (item.id === unit.itemId ? { ...item, content } : item)) };
    }
    return "content" in block ? { ...block, content } : block;
  });
}

export function replaceBlock(blocks: PageBlock[], blockId: string, next: PageBlock[]) {
  return blocks.flatMap((block) => (block.id === blockId ? next : [block]));
}

export function insertAfter(blocks: PageBlock[], blockId: string, inserted: PageBlock[]) {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return [...blocks, ...inserted];
  return [...blocks.slice(0, index + 1), ...inserted, ...blocks.slice(index + 1)];
}

function newItem(content: PageInline[] = [], checked?: boolean): PageListItem {
  return { id: createPageId("item"), content, ...(checked == null ? {} : { checked }) };
}

/** Enter: splits a unit at `offset`. Empty list rows and empty quotes leave their container. */
export function splitUnit(blocks: PageBlock[], unit: EditorUnit, offset: number): { blocks: PageBlock[]; caret: Caret } {
  const block = blocks.find((entry) => entry.id === unit.blockId);
  if (block == null) return { blocks, caret: { key: unit.key, offset } };
  if (block.type === "code_block") {
    const value = block.text.slice(0, offset) + "\n" + block.text.slice(offset);
    return { blocks: replaceBlock(blocks, block.id, [{ ...block, text: value }]), caret: { key: unit.key, offset: offset + 1 } };
  }
  if (block.type === "table") return { blocks, caret: { key: unit.key, offset } };
  if ((block.type === "list" || block.type === "ordered_list") && unit.itemId != null) {
    const index = block.items.findIndex((item) => item.id === unit.itemId);
    const item = block.items[index];
    if (inlineLength(item.content) === 0) {
      const before = block.items.slice(0, index);
      const after = block.items.slice(index + 1);
      const paragraph = emptyParagraph();
      const next: PageBlock[] = [
        ...(before.length > 0 ? [{ ...block, items: before }] : []),
        paragraph,
        ...(after.length > 0 ? [{ ...block, id: createPageId("block"), items: after }] : []),
      ];
      return { blocks: replaceBlock(blocks, block.id, next), caret: { key: paragraph.id, offset: 0 } };
    }
    const [head, tail] = splitInline(item.content, offset);
    const created = newItem(tail, block.type === "list" && block.task ? false : undefined);
    const items = [...block.items.slice(0, index), { ...item, content: head }, created, ...block.items.slice(index + 1)];
    return { blocks: replaceBlock(blocks, block.id, [{ ...block, items }]), caret: { key: unitKey({ blockId: block.id, itemId: created.id }), offset: 0 } };
  }
  if (!("content" in block)) return { blocks, caret: { key: unit.key, offset } };
  if ((block.type === "blockquote" || block.type === "callout") && inlineLength(block.content) === 0) {
    const paragraph = emptyParagraph();
    return { blocks: replaceBlock(blocks, block.id, [paragraph]), caret: { key: paragraph.id, offset: 0 } };
  }
  const [head, tail] = splitInline(block.content, offset);
  const paragraph: PageBlock = { id: createPageId("block"), type: "paragraph", content: tail };
  return { blocks: replaceBlock(blocks, block.id, [{ ...block, content: head }, paragraph]), caret: { key: paragraph.id, offset: 0 } };
}

function isListBlock(block: PageBlock): block is Extract<PageBlock, { type: "list" | "ordered_list" }> {
  return block.type === "list" || block.type === "ordered_list";
}

/** Deletes a selection that may span several units, joining the first and last unit. */
export function deleteBetween(blocks: PageBlock[], from: Caret, to: Caret): { blocks: PageBlock[]; caret: Caret } | null {
  const units = documentUnits(blocks);
  const fromUnit = units.find((unit) => unit.key === from.key);
  const toUnit = units.find((unit) => unit.key === to.key);
  if (fromUnit == null || toUnit == null) return null;
  if (fromUnit.key === toUnit.key) {
    const content = unitContent(blocks, fromUnit);
    const [head] = splitInline(content, from.offset);
    const [, tail] = splitInline(content, to.offset);
    return { blocks: withUnitContent(blocks, fromUnit, concatInline(head, tail)), caret: from };
  }
  if (fromUnit.cell != null || toUnit.cell != null) {
    if (fromUnit.blockId !== toUnit.blockId) return null;
    let next = blocks;
    for (const unit of units.slice(units.indexOf(fromUnit), units.indexOf(toUnit) + 1)) {
      const content = unitContent(next, unit);
      const [head] = splitInline(content, unit.key === fromUnit.key ? from.offset : 0);
      const [, tail] = splitInline(content, unit.key === toUnit.key ? to.offset : inlineLength(content));
      next = withUnitContent(next, unit, concatInline(head, tail));
    }
    return { blocks: next, caret: from };
  }
  const [head] = splitInline(unitContent(blocks, fromUnit), from.offset);
  const [, tail] = splitInline(unitContent(blocks, toUnit), to.offset);
  const fromIndex = blocks.findIndex((block) => block.id === fromUnit.blockId);
  const toIndex = blocks.findIndex((block) => block.id === toUnit.blockId);
  const joined = withUnitContent(blocks, fromUnit, concatInline(head, tail)).filter((_, index) => index <= fromIndex || index >= toIndex);
  const next = joined.flatMap((block): PageBlock[] => {
    if (block.id === fromUnit.blockId && isListBlock(block)) {
      const fromItem = block.items.findIndex((item) => item.id === fromUnit.itemId);
      const toItem = block.id === toUnit.blockId ? block.items.findIndex((item) => item.id === toUnit.itemId) : block.items.length - 1;
      return [{ ...block, items: block.items.filter((_, index) => index <= fromItem || index > toItem) }];
    }
    if (block.id === fromUnit.blockId) return [block];
    if (block.id === toUnit.blockId) {
      if (!isListBlock(block)) return [];
      const toItem = block.items.findIndex((item) => item.id === toUnit.itemId);
      const items = block.items.slice(toItem + 1);
      return items.length === 0 ? [] : [{ ...block, items }];
    }
    return [block];
  });
  return { blocks: next, caret: from };
}

/** Inserts inline runs at a caret inside a unit. */
export function insertInline(blocks: PageBlock[], unit: EditorUnit, offset: number, inserted: PageInline[]) {
  const [head, tail] = splitInline(unitContent(blocks, unit), offset);
  return withUnitContent(blocks, unit, concatInline(concatInline(head, inserted), tail));
}

/** Backspace at the start of a unit: lifts list rows and styled blocks, then joins with the previous unit. */
export function joinBackward(blocks: PageBlock[], unit: EditorUnit): { blocks: PageBlock[]; caret: Caret } | null {
  const block = blocks.find((entry) => entry.id === unit.blockId);
  if (block == null) return null;
  if (block.type === "table") return null;
  if ((block.type === "list" || block.type === "ordered_list") && unit.itemId != null) {
    const index = block.items.findIndex((item) => item.id === unit.itemId);
    const item = block.items[index];
    const before = block.items.slice(0, index);
    const after = block.items.slice(index + 1);
    const paragraph: PageBlock = { id: createPageId("block"), type: "paragraph", content: item.content };
    const next: PageBlock[] = [
      ...(before.length > 0 ? [{ ...block, items: before }] : []),
      paragraph,
      ...(after.length > 0 ? [{ ...block, id: createPageId("block"), items: after }] : []),
    ];
    return { blocks: replaceBlock(blocks, block.id, next), caret: { key: paragraph.id, offset: 0 } };
  }
  if (block.type !== "paragraph" && "content" in block) {
    const paragraph: PageBlock = { id: block.id, type: "paragraph", content: block.content };
    return { blocks: replaceBlock(blocks, block.id, [paragraph]), caret: { key: block.id, offset: 0 } };
  }
  if (block.type === "code_block") {
    if (block.text !== "") return null;
    const paragraph: PageBlock = { id: block.id, type: "paragraph", content: [] };
    return { blocks: replaceBlock(blocks, block.id, [paragraph]), caret: { key: block.id, offset: 0 } };
  }
  const index = blocks.findIndex((entry) => entry.id === block.id);
  const previous = blocks[index - 1];
  if (previous == null || block.type !== "paragraph") return null;
  if (previous.type === "horizontal_rule" || previous.type === "page_image" || previous.type === "page_visualization") {
    if (inlineLength(block.content) > 0) return { blocks: blocks.filter((entry) => entry.id !== previous.id), caret: { key: block.id, offset: 0 } };
    return null;
  }
  if (previous.type === "table") return null;
  const previousUnits = blockUnits(previous).filter((entry) => entry.kind === "inline");
  const target = previousUnits[previousUnits.length - 1];
  if (target == null) return null;
  const targetContent = unitContent(blocks, target);
  const merged = concatInline(targetContent, block.content);
  const next = withUnitContent(blocks, target, merged).filter((entry) => entry.id !== block.id);
  return { blocks: next, caret: { key: target.key, offset: inlineLength(targetContent) } };
}

/** Delete at the end of a unit joins the next paragraph into it. */
export function joinForward(blocks: PageBlock[], unit: EditorUnit): { blocks: PageBlock[]; caret: Caret } | null {
  if (unit.kind !== "inline" || unit.cell != null) return null;
  const units = documentUnits(blocks).filter((entry) => entry.kind === "inline");
  const index = units.findIndex((entry) => entry.key === unit.key);
  const next = units[index + 1];
  if (next == null || next.cell != null) return null;
  const nextBlock = blocks.find((entry) => entry.id === next.blockId);
  if (nextBlock?.type !== "paragraph" && next.itemId == null) return null;
  const content = unitContent(blocks, unit);
  const merged = concatInline(content, unitContent(blocks, next));
  let result = withUnitContent(blocks, unit, merged);
  result = result.flatMap((block) => {
    if (block.id !== next.blockId) return [block];
    if ((block.type === "list" || block.type === "ordered_list") && next.itemId != null) {
      const items = block.items.filter((item) => item.id !== next.itemId);
      return items.length === 0 ? [] : [{ ...block, items }];
    }
    return [];
  });
  return { blocks: result, caret: { key: unit.key, offset: inlineLength(content) } };
}

function blockContent(block: PageBlock): PageInline[] {
  if (block.type === "list" || block.type === "ordered_list") return block.items.flatMap((item, index) => (index === 0 ? item.content : [text(" "), ...item.content]));
  if (block.type === "code_block") return block.text === "" ? [] : [text(block.text)];
  return "content" in block ? block.content : [];
}

/** `m_3`: the style a block currently has in the Turn into submenu. */
export function blockStyle(block: PageBlock): BlockStyle | null {
  switch (block.type) {
    case "paragraph":
      return "paragraph";
    case "heading":
      return `heading${block.level}` as BlockStyle;
    case "list":
      return block.task ? "checklist" : "unorderedList";
    case "ordered_list":
      return "orderedList";
    case "blockquote":
      return "quote";
    case "callout":
      return "callout";
    case "code_block":
      return block.lang === "codex-prompt" ? null : "code";
    default:
      return null;
  }
}

export function turnInto(block: PageBlock, style: BlockStyle): PageBlock {
  const listItems = block.type === "list" || block.type === "ordered_list" ? block.items : [newItem(blockContent(block))];
  const content = blockContent(block);
  switch (style) {
    case "paragraph":
      return { id: block.id, type: "paragraph", content };
    case "quote":
      return { id: block.id, type: "blockquote", content };
    case "callout":
      return { id: block.id, type: "callout", emoji: "💡", content };
    case "code":
      return { id: block.id, type: "code_block", lang: null, text: inlineText(content) };
    case "unorderedList":
      return { id: block.id, type: "list", items: listItems.map(({ id, content: itemContent }) => ({ id, content: itemContent })) };
    case "checklist":
      return { id: block.id, type: "list", task: true, items: listItems.map((item) => ({ ...item, checked: item.checked ?? false })) };
    case "orderedList":
      return { id: block.id, type: "ordered_list", items: listItems.map(({ id, content: itemContent }) => ({ id, content: itemContent })) };
    default:
      return { id: block.id, type: "heading", level: Number(style.slice(-1)) as HeadingLevel, content };
  }
}

/** Markdown input rules for the start of a paragraph (`# `, `- `, `1. `, `[] `, `> `, fences and rules). */
export function applyInputRule(blocks: PageBlock[], unit: EditorUnit): { blocks: PageBlock[]; caret: Caret } | null {
  const block = blocks.find((entry) => entry.id === unit.blockId);
  if (block?.type !== "paragraph") return null;
  const value = inlineText(block.content);
  const rules: [RegExp, (match: RegExpExecArray) => PageBlock][] = [
    [/^(#{1,6}) $/, (match) => ({ id: block.id, type: "heading", level: match[1].length as HeadingLevel, content: [] })],
    [/^[-*+] $/, () => ({ id: block.id, type: "list", items: [newItem()] })],
    [/^(\d+)[.)] $/, (match) => ({ id: block.id, type: "ordered_list", items: [newItem()], ...(match[1] === "1" ? {} : { start: Number(match[1]) }) })],
    [/^\[( |x)?\] $/, (match) => ({ id: block.id, type: "list", task: true, items: [newItem([], match[1] === "x")] })],
    [/^> $/, () => ({ id: block.id, type: "blockquote", content: [] })],
    [/^```$/, () => ({ id: block.id, type: "code_block", lang: null, text: "" })],
  ];
  for (const [pattern, create] of rules) {
    const match = pattern.exec(value);
    if (match == null || value.length !== inlineLength(block.content)) continue;
    const next = create(match);
    const caretKey = blockUnits(next)[0]?.key ?? next.id;
    return { blocks: replaceBlock(blocks, block.id, [next]), caret: { key: caretKey, offset: 0 } };
  }
  if (/^(---|\*\*\*|___)$/.test(value) || /^ {0,3}(?:--|[—–])-$/.test(value)) {
    const paragraph = emptyParagraph();
    return { blocks: replaceBlock(blocks, block.id, [{ id: block.id, type: "horizontal_rule" }, paragraph]), caret: { key: paragraph.id, offset: 0 } };
  }
  return null;
}

/** Block created by an insert command, plus where the caret goes. `query` sizes slash tables (`S1a`). */
export function blockForCommand(commandId: string, query?: string): PageBlock[] | null {
  const id = createPageId("block");
  switch (commandId) {
    case "heading1":
    case "heading2":
    case "heading3":
      return [{ id, type: "heading", level: Number(commandId.slice(-1)) as HeadingLevel, content: [] }];
    case "unorderedList":
      return [{ id, type: "list", items: [newItem()] }];
    case "orderedList":
      return [{ id, type: "ordered_list", items: [newItem()] }];
    case "checklist":
      return [{ id, type: "list", task: true, items: [newItem([], false)] }];
    case "quote":
      return [{ id, type: "blockquote", content: [] }];
    case "callout":
      return [{ id, type: "callout", emoji: "💡", content: [] }];
    case "code":
      return [{ id, type: "code_block", lang: null, text: "" }];
    case "prompt":
      return [{ id, type: "code_block", lang: "codex-prompt", text: "" }];
    case "table": {
      const size = tableSizeFromQuery(query);
      return [createTable(size.rows, size.columns)];
    }
    case "divider":
      return [{ id, type: "horizontal_rule" }, emptyParagraph()];
    default:
      return null;
  }
}

export function firstUnitKey(blocks: PageBlock[]) {
  return documentUnits(blocks)[0]?.key ?? null;
}
