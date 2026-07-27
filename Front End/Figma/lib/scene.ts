/**
 * Willow Figma — scene graph operations (pure, document-in/document-out).
 *
 * Node creation with Figma-accurate defaults, traversal, world transforms &
 * bounds, hit-testing, auto layout solving, subtree cloning and naming.
 * The EditorStore is the only mutator; everything here either reads a
 * document or returns new objects (copy-on-write) for the store to commit.
 */

import {
  IDENTITY,
  type Mat,
  matApply,
  matInvert,
  matMultiply,
  nodeTransform,
  rectContains,
  rectsIntersect,
  rectUnionAll,
  transformedRectAabb,
} from './geometry';
import { GRAY_FILL, rgba255, solid, WHITE } from './colors';
import { autoSizeText } from './text';
import type {
  AutoLayout,
  Camera,
  FigDocument,
  FigPage,
  NodeId,
  NodeType,
  PageId,
  Rect,
  SceneNode,
  TextStyleProps,
  Vec2,
} from './types';

// ── Ids ──────────────────────────────────────────────────────────────────────

const ID_ALPHABET = 'useandom26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict';

export function genId(size = 12): string {
  let id = '';
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (let i = 0; i < size; i++) id += ID_ALPHABET[bytes[i] & 61];
  return id;
}

// ── Defaults & factory ───────────────────────────────────────────────────────

export const DEFAULT_TEXT_STYLE: TextStyleProps = {
  fontFamily: 'Inter',
  fontWeight: 400,
  italic: false,
  fontSize: 16,
  lineHeight: { value: 0, unit: 'AUTO' },
  letterSpacing: { value: 0, unit: 'PERCENT' },
  textAlignHorizontal: 'LEFT',
  textAlignVertical: 'TOP',
  textAutoResize: 'WIDTH_AND_HEIGHT',
  textDecoration: 'NONE',
  textCase: 'ORIGINAL',
  paragraphSpacing: 0,
};

export const DEFAULT_LAYOUT: AutoLayout = {
  mode: 'NONE',
  itemSpacing: 10,
  paddingLeft: 10,
  paddingRight: 10,
  paddingTop: 10,
  paddingBottom: 10,
  primaryAxisAlign: 'MIN',
  counterAxisAlign: 'MIN',
  primaryAxisSizing: 'FIXED',
  counterAxisSizing: 'FIXED',
};

/** Create a node of `type` with Figma-accurate defaults. */
export function createNode(type: NodeType, init: Partial<SceneNode> = {}): SceneNode {
  const base: SceneNode = {
    id: genId(),
    type,
    name: type,
    parentId: '',
    childIds: [],
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'NORMAL',
    fills: [solid(GRAY_FILL)],
    strokes: [],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    strokeCap: 'NONE',
    strokeJoin: 'MITER',
    strokeDash: [],
    cornerRadius: 0,
    cornerRadii: null,
    effects: [],
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
    layout: { ...DEFAULT_LAYOUT },
    layoutPositioning: 'AUTO',
    layoutGrow: 0,
    layoutAlignSelf: 'INHERIT',
    clipsContent: true,
    characters: '',
    textStyle: { ...DEFAULT_TEXT_STYLE },
    pointCount: 3,
    innerRadius: 0.5,
    vectorPaths: [],
    componentId: null,
    overrides: null,
    fillStyleId: null,
    textStyleId: null,
    reactions: [],
    exportSettings: [],
  };

  switch (type) {
    case 'FRAME':
      base.fills = [solid(WHITE)];
      base.clipsContent = true;
      break;
    case 'SECTION':
      base.fills = [solid(rgba255(37, 37, 37))];
      base.clipsContent = false;
      break;
    case 'GROUP':
      base.fills = [];
      base.clipsContent = false;
      break;
    case 'TEXT':
      base.fills = [solid(rgba255(0, 0, 0))];
      base.width = 4;
      base.height = 19;
      break;
    case 'LINE':
    case 'ARROW':
      base.fills = [];
      base.strokes = [solid(rgba255(0, 0, 0))];
      base.height = 0;
      base.strokeCap = type === 'ARROW' ? 'ARROW_LINES' : 'NONE';
      break;
    case 'VECTOR':
      base.fills = [];
      base.strokes = [solid(rgba255(0, 0, 0))];
      base.strokeJoin = 'ROUND';
      base.strokeCap = 'ROUND';
      break;
    case 'STAR':
      base.pointCount = 5;
      break;
    case 'POLYGON':
      base.pointCount = 3;
      break;
    case 'SLICE':
      base.fills = [];
      break;
    case 'COMPONENT':
      base.fills = [solid(WHITE)];
      break;
    default:
      break;
  }
  return { ...base, ...init };
}

const NAME_COUNTER_LABELS: Record<string, string> = {
  FRAME: 'Frame',
  GROUP: 'Group',
  SECTION: 'Section',
  RECTANGLE: 'Rectangle',
  ELLIPSE: 'Ellipse',
  POLYGON: 'Polygon',
  STAR: 'Star',
  LINE: 'Line',
  ARROW: 'Arrow',
  VECTOR: 'Vector',
  TEXT: 'Text',
  IMAGE: 'Image',
  COMPONENT: 'Component',
  INSTANCE: 'Instance',
  SLICE: 'Slice',
};

/** "Rectangle 7" — smallest unused counter across the whole document. */
export function nextName(doc: FigDocument, type: NodeType): string {
  const label = NAME_COUNTER_LABELS[type] ?? type;
  let max = 0;
  const re = new RegExp(`^${label} (\\d+)$`);
  for (const id in doc.nodes) {
    const m = doc.nodes[id].name.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${label} ${max + 1}`;
}

// ── Traversal ────────────────────────────────────────────────────────────────

export function getNode(doc: FigDocument, id: NodeId): SceneNode | null {
  return doc.nodes[id] ?? null;
}

export function getPageOfNode(doc: FigDocument, id: NodeId): FigPage | null {
  let cur = doc.nodes[id];
  while (cur) {
    if (doc.pages[cur.parentId]) return doc.pages[cur.parentId];
    cur = doc.nodes[cur.parentId];
  }
  return null;
}

/** Ancestor chain from the node's parent up to (excluding) the page. */
export function getAncestors(doc: FigDocument, id: NodeId): SceneNode[] {
  const out: SceneNode[] = [];
  let cur = doc.nodes[id];
  while (cur && doc.nodes[cur.parentId]) {
    cur = doc.nodes[cur.parentId];
    out.push(cur);
  }
  return out;
}

export function isAncestorOf(doc: FigDocument, maybeAncestor: NodeId, id: NodeId): boolean {
  let cur = doc.nodes[id];
  while (cur && doc.nodes[cur.parentId]) {
    if (cur.parentId === maybeAncestor) return true;
    cur = doc.nodes[cur.parentId];
  }
  return false;
}

/** Depth-first descendant ids (self excluded), document order. */
export function getDescendants(doc: FigDocument, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const walk = (nid: NodeId) => {
    const n = doc.nodes[nid];
    if (!n) return;
    for (const c of n.childIds) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

/** Top-level ids of a page in paint order (bottom → top). */
export function pageChildren(doc: FigDocument, pageId: PageId): SceneNode[] {
  const page = doc.pages[pageId];
  if (!page) return [];
  return page.childIds.map((id) => doc.nodes[id]).filter(Boolean);
}

/** Reduce a node set to the topmost members (drop ids inside other members). */
export function topLevelOnly(doc: FigDocument, ids: NodeId[]): NodeId[] {
  const set = new Set(ids);
  return ids.filter((id) => !getAncestors(doc, id).some((a) => set.has(a.id)));
}

// ── Transforms & bounds ──────────────────────────────────────────────────────

/** Local→world transform (through all ancestors). */
export function worldTransform(doc: FigDocument, id: NodeId): Mat {
  const chain: SceneNode[] = [];
  let cur = doc.nodes[id];
  while (cur) {
    chain.unshift(cur);
    cur = doc.nodes[cur.parentId];
  }
  let m: Mat = IDENTITY;
  for (const n of chain) {
    m = matMultiply(m, nodeTransform(n.x, n.y, n.width, n.height, n.rotation));
  }
  return m;
}

/** Axis-aligned world bounding box (accounts for rotation of self+ancestors). */
export function worldBounds(doc: FigDocument, id: NodeId): Rect {
  const n = doc.nodes[id];
  if (!n) return { x: 0, y: 0, width: 0, height: 0 };
  const m = worldTransform(doc, id);
  return transformedRectAabb({ x: 0, y: 0, width: n.width, height: Math.max(n.height, 0.0001) }, m);
}

export function worldBoundsOfNodes(doc: FigDocument, ids: NodeId[]): Rect | null {
  return rectUnionAll(ids.filter((id) => doc.nodes[id]).map((id) => worldBounds(doc, id)));
}

/** Convert a world point into a node's local space. */
export function worldToLocal(doc: FigDocument, id: NodeId, p: Vec2): Vec2 {
  return matApply(matInvert(worldTransform(doc, id)), p);
}

/** World position of the node's local origin. */
export function worldPosition(doc: FigDocument, id: NodeId): Vec2 {
  return matApply(worldTransform(doc, id), { x: 0, y: 0 });
}

/** Bounds of everything on a page (world). */
export function pageBounds(doc: FigDocument, pageId: PageId): Rect | null {
  const page = doc.pages[pageId];
  if (!page || page.childIds.length === 0) return null;
  return worldBoundsOfNodes(doc, page.childIds);
}

// ── Hit-testing ──────────────────────────────────────────────────────────────

export interface HitOptions {
  /** Also hit nodes whose fills are empty (frames hit by name bar are handled by the caller). */
  includeLocked?: boolean;
  /** Ids to skip entirely (e.g. nodes being dragged). */
  ignore?: Set<NodeId>;
}

function nodeSelfHit(doc: FigDocument, n: SceneNode, world: Vec2, zoom: number): boolean {
  const local = worldToLocal(doc, n.id, world);
  const tolerance = Math.max(3 / zoom, n.strokeWeight);
  if (n.type === 'LINE' || n.type === 'ARROW') {
    return (
      local.x >= -tolerance && local.x <= n.width + tolerance && Math.abs(local.y) <= Math.max(tolerance, 4 / zoom)
    );
  }
  if (n.type === 'VECTOR') {
    // Cheap test: padded bbox of the path points.
    const pad = Math.max(4 / zoom, n.strokeWeight);
    return local.x >= -pad && local.x <= n.width + pad && local.y >= -pad && local.y <= n.height + pad;
  }
  if (n.type === 'ELLIPSE') {
    const rx = n.width / 2;
    const ry = n.height / 2;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (local.x - rx) / rx;
    const dy = (local.y - ry) / ry;
    return dx * dx + dy * dy <= 1.05;
  }
  return rectContains({ x: 0, y: 0, width: n.width, height: n.height }, local);
}

/**
 * Figma-style deep hit-test: topmost leaf under the point, where GROUPs are
 * transparent (their children hit directly) and FRAME/COMPONENT containers
 * select the container first unless `deep`. Returns paint-order-topmost.
 */
export function hitTest(
  doc: FigDocument,
  pageId: PageId,
  world: Vec2,
  zoom: number,
  opts: HitOptions & { deep?: boolean } = {},
): NodeId | null {
  const page = doc.pages[pageId];
  if (!page) return null;

  const visit = (ids: NodeId[], insideContainer: boolean): NodeId | null => {
    // Top → bottom.
    for (let i = ids.length - 1; i >= 0; i--) {
      const n = doc.nodes[ids[i]];
      if (!n || !n.visible) continue;
      if (n.locked && !opts.includeLocked) continue;
      if (opts.ignore?.has(n.id)) continue;

      const isContainer = n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'SECTION';
      const isGroupLike = n.type === 'GROUP';
      const selfHit = nodeSelfHit(doc, n, world, zoom);

      if (isGroupLike) {
        const inner = visit(n.childIds, insideContainer);
        if (inner) {
          // Groups select as a whole at top level; deep select pierces them.
          return opts.deep || insideContainer ? inner : n.id;
        }
        continue;
      }

      if (isContainer) {
        // Children first when the point is inside the container.
        if (selfHit || !n.clipsContent) {
          const inner = visit(n.childIds, true);
          if (inner) {
            return opts.deep ? inner : topmostChildContainerAware(doc, inner, n.id, opts.deep === true);
          }
        }
        if (selfHit) {
          // A frame body only hits when it has a visible fill/stroke, OR it's a
          // top-level frame (Figma selects those from their background too).
          const hasPaint = n.fills.some((f) => f.visible) || n.strokes.some((s) => s.visible);
          const isTopLevel = !!doc.pages[n.parentId];
          if (hasPaint || isTopLevel) return n.id;
        }
        continue;
      }

      if (selfHit) {
        const hasPaint =
          n.fills.some((f) => f.visible) || n.strokes.some((s) => s.visible) || n.type === 'TEXT' || n.type === 'IMAGE' || n.type === 'INSTANCE';
        if (hasPaint) return n.id;
      }
    }
    return null;
  };

  return visit(page.childIds, false);
}

/**
 * When a child inside a frame is hit and we're not deep-selecting, Figma
 * selects the hit node's outermost ancestor group but direct children of
 * frames select themselves. Compute the right selection target.
 */
function topmostChildContainerAware(doc: FigDocument, hitId: NodeId, containerId: NodeId, deep: boolean): NodeId {
  if (deep) return hitId;
  let cur = doc.nodes[hitId];
  let candidate = hitId;
  while (cur && cur.parentId !== containerId) {
    const parent = doc.nodes[cur.parentId];
    if (!parent) break;
    if (parent.type === 'GROUP') candidate = parent.id;
    // Nested frames stop the walk: clicking inside a nested frame selects
    // the deepest such frame's direct child chain.
    if (parent.type === 'FRAME' || parent.type === 'COMPONENT' || parent.type === 'SECTION') break;
    cur = parent;
  }
  return candidate;
}

/** All nodes on the page intersecting a world rect (marquee). Top-level semantics. */
export function nodesInRect(doc: FigDocument, pageId: PageId, r: Rect, opts: { enclosedOnly?: boolean } = {}): NodeId[] {
  const page = doc.pages[pageId];
  if (!page) return [];
  const out: NodeId[] = [];
  for (const id of page.childIds) {
    const n = doc.nodes[id];
    if (!n || !n.visible || n.locked) continue;
    const b = worldBounds(doc, id);
    const isTopLevelFrame = (n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'SECTION') && b.width > 0;
    if (isTopLevelFrame && !rectContainsRectSafe(r, b)) {
      // Marquee inside/overlapping a frame selects its children instead.
      for (const cid of n.childIds) {
        const cn = doc.nodes[cid];
        if (!cn || !cn.visible || cn.locked) continue;
        const cb = worldBounds(doc, cid);
        if (opts.enclosedOnly ? rectContainsRectSafe(r, cb) : rectsIntersect(r, cb)) out.push(cid);
      }
      continue;
    }
    if (opts.enclosedOnly ? rectContainsRectSafe(r, b) : rectsIntersect(r, b)) out.push(id);
  }
  return out;
}

function rectContainsRectSafe(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Find the frame/section that should become the parent for a node dropped at
 * a world point (deepest visible unlocked frame whose bounds contain the
 * point, excluding `ignore` subtrees). Returns page id when none.
 */
export function findDropParent(
  doc: FigDocument,
  pageId: PageId,
  world: Vec2,
  ignore: Set<NodeId>,
): NodeId | PageId {
  const page = doc.pages[pageId];
  if (!page) return pageId;
  let best: NodeId | PageId = pageId;
  const visit = (ids: NodeId[]) => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const n = doc.nodes[ids[i]];
      if (!n || !n.visible || n.locked || ignore.has(n.id)) continue;
      if (n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'SECTION') {
        if (rectContains(worldBounds(doc, n.id), world)) {
          best = n.id;
          visit(n.childIds);
          return; // deepest wins; only recurse into the hit branch
        }
      }
    }
  };
  visit(page.childIds);
  return best;
}

// ── Auto layout ──────────────────────────────────────────────────────────────

/**
 * Solve auto layout for one frame: positions children, sizes FILL children,
 * and hug-sizes the frame. Returns patches (copy-on-write) or null when the
 * frame has no auto layout. TEXT children re-auto-size first.
 */
export function solveAutoLayout(doc: FigDocument, frameId: NodeId): Record<NodeId, SceneNode> | null {
  const frame = doc.nodes[frameId];
  if (!frame || frame.layout.mode === 'NONE') return null;
  const L = frame.layout;
  const horizontal = L.mode === 'HORIZONTAL';
  const patches: Record<NodeId, SceneNode> = {};

  const flow = frame.childIds
    .map((id) => patches[id] ?? doc.nodes[id])
    .filter((n): n is SceneNode => !!n && n.visible && n.layoutPositioning !== 'ABSOLUTE');

  const innerW = frame.width - L.paddingLeft - L.paddingRight;
  const innerH = frame.height - L.paddingTop - L.paddingBottom;
  const primarySize = horizontal ? innerW : innerH;
  const counterSize = horizontal ? innerH : innerW;

  // 1) Sizes: FILL children share leftover primary space; STRETCH fills counter.
  const fixedTotal = flow.reduce((sum, n) => sum + (n.layoutGrow === 1 ? 0 : horizontal ? n.width : n.height), 0);
  const growCount = flow.filter((n) => n.layoutGrow === 1).length;
  const spacing = L.primaryAxisAlign === 'SPACE_BETWEEN' && flow.length > 1
    ? Math.max(0, (primarySize - flow.reduce((s, n) => s + (n.layoutGrow === 1 ? 0 : horizontal ? n.width : n.height), 0)) / (flow.length - 1))
    : L.itemSpacing;
  const spacingTotal = spacing * Math.max(0, flow.length - 1);
  const growSize = growCount > 0 ? Math.max(0, (primarySize - fixedTotal - spacingTotal) / growCount) : 0;

  const sized = flow.map((n) => {
    let w = n.width;
    let h = n.height;
    if (n.layoutGrow === 1) {
      if (horizontal) w = growSize;
      else h = growSize;
    }
    if (n.layoutAlignSelf === 'STRETCH') {
      if (horizontal) h = counterSize;
      else w = counterSize;
    }
    return { n, w, h };
  });

  // 2) Content extent along primary axis.
  const contentPrimary = sized.reduce((s, e) => s + (horizontal ? e.w : e.h), 0) + spacingTotal;
  const contentCounter = Math.max(0, ...sized.map((e) => (horizontal ? e.h : e.w)));

  // 3) Hug sizing of the frame itself.
  let frameW = frame.width;
  let frameH = frame.height;
  if (L.primaryAxisSizing === 'HUG') {
    if (horizontal) frameW = contentPrimary + L.paddingLeft + L.paddingRight;
    else frameH = contentPrimary + L.paddingTop + L.paddingBottom;
  }
  if (L.counterAxisSizing === 'HUG') {
    if (horizontal) frameH = contentCounter + L.paddingTop + L.paddingBottom;
    else frameW = contentCounter + L.paddingLeft + L.paddingRight;
  }

  const effInnerW = frameW - L.paddingLeft - L.paddingRight;
  const effInnerH = frameH - L.paddingTop - L.paddingBottom;
  const effPrimary = horizontal ? effInnerW : effInnerH;
  const effCounter = horizontal ? effInnerH : effInnerW;

  // 4) Starting offset along primary axis.
  let cursor = 0;
  if (L.primaryAxisAlign === 'CENTER') cursor = (effPrimary - contentPrimary) / 2;
  else if (L.primaryAxisAlign === 'MAX') cursor = effPrimary - contentPrimary;

  // 5) Position children.
  for (const e of sized) {
    const counterExtent = horizontal ? e.h : e.w;
    let counterOffset = 0;
    if (e.n.layoutAlignSelf !== 'STRETCH') {
      if (L.counterAxisAlign === 'CENTER') counterOffset = (effCounter - counterExtent) / 2;
      else if (L.counterAxisAlign === 'MAX') counterOffset = effCounter - counterExtent;
    }
    const nx = horizontal ? L.paddingLeft + cursor : L.paddingLeft + counterOffset;
    const ny = horizontal ? L.paddingTop + counterOffset : L.paddingTop + cursor;
    if (nx !== e.n.x || ny !== e.n.y || e.w !== e.n.width || e.h !== e.n.height || e.n.rotation !== 0) {
      patches[e.n.id] = { ...e.n, x: nx, y: ny, width: e.w, height: e.h };
    }
    cursor += (horizontal ? e.w : e.h) + spacing;
  }

  if (frameW !== frame.width || frameH !== frame.height) {
    patches[frameId] = { ...(patches[frameId] ?? frame), width: frameW, height: frameH };
  }
  return Object.keys(patches).length ? patches : null;
}

/**
 * Run auto layout across the document until stable (child hug affects parent
 * hug). Applies TEXT auto-resize first. Returns a new doc or the same object
 * when nothing changed.
 */
export function layoutDocument(doc: FigDocument): FigDocument {
  let nodes = doc.nodes;
  let changed = false;

  // TEXT auto-resize pass.
  for (const id in nodes) {
    const n = nodes[id];
    if (n.type === 'TEXT') {
      const size = autoSizeText(n);
      if (Math.abs(size.width - n.width) > 0.01 || Math.abs(size.height - n.height) > 0.01) {
        if (!changed) nodes = { ...nodes };
        nodes[id] = { ...n, width: size.width, height: size.height };
        changed = true;
      }
    }
  }

  // Iterate auto layout to a fixed point (bounded).
  for (let pass = 0; pass < 6; pass++) {
    let passChanged = false;
    const working: FigDocument = changed ? { ...doc, nodes } : doc;
    // Deepest-first so hug sizes propagate upward in one pass.
    const frames = Object.keys(nodes)
      .filter((id) => nodes[id].layout.mode !== 'NONE')
      .sort((a, b) => depthOf(working, b) - depthOf(working, a));
    for (const fid of frames) {
      const patches = solveAutoLayout({ ...working, nodes }, fid);
      if (patches) {
        if (!changed) nodes = { ...nodes };
        for (const id in patches) nodes[id] = patches[id];
        changed = true;
        passChanged = true;
      }
    }
    if (!passChanged) break;
  }

  return changed ? { ...doc, nodes } : doc;
}

function depthOf(doc: FigDocument, id: NodeId): number {
  let depth = 0;
  let cur = doc.nodes[id];
  while (cur && doc.nodes[cur.parentId]) {
    depth++;
    cur = doc.nodes[cur.parentId];
  }
  return depth;
}

// ── Cloning ──────────────────────────────────────────────────────────────────

/**
 * Deep-clone a subtree with fresh ids. Returns the new root plus every new
 * node keyed by id (caller inserts them + registers parent linkage).
 */
export function cloneSubtree(
  doc: FigDocument,
  rootId: NodeId,
): { rootId: NodeId; nodes: Record<NodeId, SceneNode> } | null {
  const src = doc.nodes[rootId];
  if (!src) return null;
  const out: Record<NodeId, SceneNode> = {};
  const cloneNode = (id: NodeId, parentId: string): NodeId => {
    const n = doc.nodes[id];
    const newId = genId();
    const copy: SceneNode = {
      ...n,
      id: newId,
      parentId,
      childIds: [],
      fills: n.fills.map((f) => ({ ...f })),
      strokes: n.strokes.map((s) => ({ ...s })),
      effects: n.effects.map((e) => ({ ...e })),
      strokeDash: [...n.strokeDash],
      cornerRadii: n.cornerRadii ? [...n.cornerRadii] : null,
      layout: { ...n.layout },
      textStyle: { ...n.textStyle, lineHeight: { ...n.textStyle.lineHeight }, letterSpacing: { ...n.textStyle.letterSpacing } },
      vectorPaths: n.vectorPaths.map((p) => ({ closed: p.closed, points: p.points.map((pt) => ({ ...pt, handleIn: pt.handleIn ? { ...pt.handleIn } : null, handleOut: pt.handleOut ? { ...pt.handleOut } : null })) })),
      overrides: n.overrides ? JSON.parse(JSON.stringify(n.overrides)) : null,
      reactions: n.reactions.map((r) => JSON.parse(JSON.stringify(r))),
      exportSettings: n.exportSettings.map((e) => ({ ...e })),
    };
    out[newId] = copy;
    copy.childIds = n.childIds.map((cid) => cloneNode(cid, newId));
    return newId;
  };
  const newRoot = cloneNode(rootId, src.parentId);
  return { rootId: newRoot, nodes: out };
}

// ── Viewport helpers ─────────────────────────────────────────────────────────

/** Default camera for a page: fit content or a sensible origin view. */
export function initialCamera(doc: FigDocument, pageId: PageId, viewportW: number, viewportH: number): Camera {
  const bounds = pageBounds(doc, pageId);
  if (!bounds) return { x: -viewportW / 2, y: -viewportH / 2, zoom: 1 };
  const zx = (viewportW - 128) / Math.max(bounds.width, 1);
  const zy = (viewportH - 128) / Math.max(bounds.height, 1);
  const zoom = Math.min(1, zx, zy);
  return {
    zoom,
    x: bounds.x + bounds.width / 2 - viewportW / 2 / zoom,
    y: bounds.y + bounds.height / 2 - viewportH / 2 / zoom,
  };
}

// ── Document factory ─────────────────────────────────────────────────────────

export function createEmptyDocument(id: string, name: string): FigDocument {
  const pageId = genId();
  return {
    schemaVersion: 1,
    id,
    name,
    pages: {
      [pageId]: {
        id: pageId,
        name: 'Page 1',
        childIds: [],
        backgroundColor: rgba255(30, 30, 30),
        prototypeStartNodeId: null,
      },
    },
    pageOrder: [pageId],
    nodes: {},
    components: {},
    styles: { colors: [], texts: [] },
    images: {},
    revision: 0,
  };
}
