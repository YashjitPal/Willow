import { documentUnits, unitContent, unitKey, type Caret } from "./document-model";
import { inlineLength } from "./inline-dom";
import { createPageId, type PageBlock, type PageListItem } from "./state/page-document";

/** What a grip, its menu and its drag act on (`qw`'s `block` or `item`): a top-level block, or one row of a list. */
export interface BlockTarget {
  blockId: string;
  itemId?: string;
}

/** Where dragged content lands: the gap before top-level block `index`, or with `blockId`, before row `index` of that list. */
export interface BlockDrop {
  blockId?: string;
  index: number;
}

export type ListBlock = Extract<PageBlock, { type: "list" | "ordered_list" }>;

export function isListBlock(block: PageBlock | undefined): block is ListBlock {
  return block?.type === "list" || block?.type === "ordered_list";
}

/**
 * `ur` for a non-empty text selection: every block it overlaps, with lists contributing the rows it touches
 * instead of themselves; a text block the selection only meets at its start or end is left out.
 */
export function selectionTargets(blocks: PageBlock[], from: Caret, to: Caret): BlockTarget[] {
  const units = documentUnits(blocks);
  const order = new Map(units.map((unit, index) => [unit.key, index]));
  const start = order.get(from.key);
  const end = order.get(to.key);
  const first = start == null ? undefined : units[start];
  const last = end == null ? undefined : units[end];
  if (start == null || end == null || first == null || last == null || (start === end && from.offset === to.offset)) return [];
  const firstBlock = blocks.findIndex((block) => block.id === first.blockId);
  const lastBlock = blocks.findIndex((block) => block.id === last.blockId);
  const targets: BlockTarget[] = [];
  for (const block of blocks.slice(firstBlock, lastBlock + 1)) {
    if (isListBlock(block)) {
      for (const item of block.items) {
        const index = order.get(unitKey({ blockId: block.id, itemId: item.id }));
        if (index != null && index >= start && index <= end) targets.push({ blockId: block.id, itemId: item.id });
      }
      continue;
    }
    if (block.id === first.key && from.offset >= inlineLength(unitContent(blocks, first))) continue;
    if (block.id === last.key && to.offset === 0) continue;
    targets.push({ blockId: block.id });
  }
  return targets;
}

/** `Jw`: all of the selection's targets when the grip's target is among several selected ones, otherwise just the grip's. */
export function gripTargets(selected: BlockTarget[], target: BlockTarget) {
  const overlaps = selected.some(({ blockId, itemId }) => blockId === target.blockId && (target.itemId == null || itemId === target.itemId));
  return selected.length > 1 && overlaps ? selected : [target];
}

function sameMarkup(a: ListBlock, b: ListBlock) {
  if (a.type !== b.type || a.layout !== b.layout) return false;
  if (a.type === "list" && b.type === "list") return (a.task ?? false) === (b.task ?? false);
  return a.type === "ordered_list" && b.type === "ordered_list" && a.start === b.start;
}

/** A row joining `list`: checklists keep a checked state on every row, other lists none. */
function rowFor(list: ListBlock, item: PageListItem): PageListItem {
  if (list.type === "list" && list.task === true) return { id: item.id, content: item.content, checked: item.checked ?? false };
  return { id: item.id, content: item.content };
}

/**
 * `NV` over `FV`: moves the targets, keeping their document order, to `drop`. Rows dropped outside a list are
 * wrapped in a copy of their list, and wraps of the same kind that end up adjacent are joined; a list left
 * without rows is removed. Null when the drop is not allowed or changes nothing.
 */
export function moveTargets(blocks: PageBlock[], targets: BlockTarget[], drop: BlockDrop): PageBlock[] | null {
  const movedBlocks = new Set(targets.flatMap(({ blockId, itemId }) => (itemId == null ? [blockId] : [])));
  const movedRows = new Set(targets.flatMap(({ blockId, itemId }) => (itemId == null ? [] : [unitKey({ blockId, itemId })])));
  const moved = (list: ListBlock, item: PageListItem) => movedRows.has(unitKey({ blockId: list.id, itemId: item.id }));
  const pieces: ({ block: PageBlock } | { list: ListBlock; item: PageListItem })[] = [];
  for (const block of blocks) {
    if (movedBlocks.has(block.id)) pieces.push({ block });
    else if (isListBlock(block)) pieces.push(...block.items.filter((item) => moved(block, item)).map((item) => ({ list: block, item })));
  }
  if (pieces.length === 0) return null;
  const remaining: PageBlock[] = [];
  let blockAt = 0;
  let listAt: { index: number; row: number } | null = null;
  for (const [index, block] of blocks.entries()) {
    if (movedBlocks.has(block.id)) continue;
    let kept = block;
    if (isListBlock(block)) {
      const items = block.items.filter((item) => !moved(block, item));
      if (items.length === 0) continue;
      if (drop.blockId === block.id) listAt = { index: remaining.length, row: block.items.slice(0, drop.index).filter((item) => !moved(block, item)).length };
      kept = { ...block, items };
    }
    if (index < drop.index) blockAt += 1;
    remaining.push(kept);
  }
  let next: PageBlock[];
  if (drop.blockId != null) {
    const at = listAt;
    const list = at == null ? undefined : remaining[at.index];
    if (at == null || !isListBlock(list)) return null;
    const rows: PageListItem[] = [];
    for (const piece of pieces) {
      if ("block" in piece) return null;
      rows.push(rowFor(list, piece.item));
    }
    const joined: PageBlock = { ...list, items: [...list.items.slice(0, at.row), ...rows, ...list.items.slice(at.row)] };
    next = remaining.map((block, index) => (index === at.index ? joined : block));
  } else {
    const inserted: PageBlock[] = [];
    const wraps = new Set<string>();
    for (const piece of pieces) {
      if ("block" in piece) {
        inserted.push(piece.block);
        continue;
      }
      const previous = inserted.at(-1);
      if (previous != null && wraps.has(previous.id) && isListBlock(previous) && sameMarkup(previous, piece.list)) {
        inserted[inserted.length - 1] = { ...previous, items: [...previous.items, piece.item] };
        continue;
      }
      const wrap: ListBlock = { ...piece.list, id: createPageId("block"), items: [piece.item] };
      wraps.add(wrap.id);
      inserted.push(wrap);
    }
    next = [...remaining.slice(0, blockAt), ...inserted, ...remaining.slice(blockAt)];
  }
  return sameStructure(blocks, next) ? null : next;
}

function sameStructure(a: PageBlock[], b: PageBlock[]) {
  const shape = (blocks: PageBlock[]) => blocks.map((block) => (isListBlock(block) ? `${block.id}[${block.items.map((item) => item.id).join(",")}]` : block.id)).join("|");
  return shape(a) === shape(b);
}

/** `gB` for one list row: removes it, and its list once no rows are left. */
export function removeRow(blocks: PageBlock[], blockId: string, itemId: string): PageBlock[] {
  return blocks.flatMap((block) => {
    if (block.id !== blockId || !isListBlock(block)) return [block];
    const items = block.items.filter((item) => item.id !== itemId);
    return items.length === 0 ? [] : [{ ...block, items }];
  });
}
