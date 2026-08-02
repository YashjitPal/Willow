/**
 * Willow Figma — EditorStore: the single mutable owner of editor state.
 *
 * All document mutations flow through `apply()` which:
 *   1. runs the mutation (copy-on-write; helpers from scene.ts),
 *   2. re-solves text auto-size + auto layout (layoutDocument),
 *   3. bumps doc.revision, records undo history (with per-gesture coalescing),
 *   4. notifies React subscribers and the realtime diff listener.
 *
 * Ephemeral per-frame state (marquee, snap guides, remote cursors, drag
 * previews) lives in `store.eph` — mutated directly and repainted via
 * `requestRepaint()` without waking React.
 */

import React, { createContext, useContext, useSyncExternalStore } from 'react';
import {
  cloneSubtree,
  createEmptyDocument,
  createNode,
  genId,
  getAncestors,
  getDescendants,
  getNode,
  isAncestorOf,
  layoutDocument,
  nextName,
  pageBounds,
  topLevelOnly,
  worldBounds,
  worldBoundsOfNodes,
  worldPosition,
} from './scene';
import { cameraToFit, clamp, zoomAt } from './geometry';
import type {
  Camera,
  ColorStyle,
  DocOps,
  EditorMode,
  FigComment,
  FigDocument,
  FigFileMeta,
  FigPage,
  LeftTab,
  NodeId,
  PageId,
  PeerState,
  Rect,
  SceneNode,
  SharedTextStyle,
  ToolType,
  Vec2,
} from './types';

// ── State shape ──────────────────────────────────────────────────────────────

export type SaveState = 'saved' | 'saving' | 'dirty' | 'offline';

export interface EditorState {
  doc: FigDocument;
  fileMeta: FigFileMeta;
  currentPageId: PageId;
  selection: NodeId[];
  hoveredId: NodeId | null;
  tool: ToolType;
  camera: Camera;
  mode: EditorMode;
  leftTab: LeftTab;
  /** TEXT node currently being edited in the DOM overlay. */
  editingTextId: NodeId | null;
  /** Vector node being edited with the pen tool (vector edit mode). */
  editingVectorId: NodeId | null;
  showUI: boolean;
  showRulers: boolean;
  showPixelGrid: boolean;
  snappingEnabled: boolean;
  saveState: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  peers: Record<string, PeerState>;
  comments: FigComment[];
  showComments: boolean;
  /** Present-mode: id of the top-level frame being presented, null = closed. */
  presentingFrameId: NodeId | null;
  /** Open color-picker / popover coordination key (one popover at a time). */
  activePopover: string | null;
}

/** Per-frame ephemeral state, read directly by the canvas each paint. */
export interface EphemeralState {
  /** Marquee selection rect in world space. */
  marquee: Rect | null;
  /** Smart-guide lines to draw (world coords). */
  snapLinesV: number[];
  snapLinesH: number[];
  /** Alt-hover measurement: from selection to this node. */
  measureTargetId: NodeId | null;
  /** Live drag/resize hint label (e.g. "512 × 320") at world point. */
  sizeHint: { x: number; y: number; text: string } | null;
  /** Insertion preview rect while a creation tool drags. */
  creationDraft: Rect | null;
  /** Pen tool in-progress path preview points (world). */
  penPreview: Vec2[] | null;
  /** Highlighted drop-target frame during a move. */
  dropTargetId: NodeId | null;
  /** Space key held (temporary hand tool). */
  spaceDown: boolean;
  /** Pointer world position (for zoom-to-cursor & cursor chat). */
  pointerWorld: Vec2;
}

export interface HistoryEntry {
  doc: FigDocument;
  selection: NodeId[];
  pageId: PageId;
}

export interface ApplyOptions {
  /** 'push' (default) new undo entry; 'coalesce' merges gestures via key; 'skip' = no history (remote ops, transient). */
  history?: 'push' | 'coalesce' | 'skip';
  coalesceKey?: string;
  /** Skip the auto-layout pass (rare; e.g. pure reorder already solved). */
  skipLayout?: boolean;
}

// ── Store ────────────────────────────────────────────────────────────────────

export class EditorStore {
  state: EditorState;
  eph: EphemeralState;
  /** Canvas viewport size in CSS px, kept fresh by CanvasHost's ResizeObserver. */
  viewport = { w: 1200, h: 800 };

  private listeners = new Set<() => void>();
  private repaintListeners = new Set<() => void>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private lastCoalesceKey: string | null = null;
  /** Called after each committed doc change with (prevDoc, nextDoc) for realtime broadcast + autosave. */
  onDocCommitted: ((prev: FigDocument, next: FigDocument) => void) | null = null;

  constructor(doc: FigDocument, fileMeta: FigFileMeta) {
    this.state = {
      doc: layoutDocument(doc),
      fileMeta,
      currentPageId: doc.pageOrder[0],
      selection: [],
      hoveredId: null,
      tool: 'move',
      camera: { x: -400, y: -300, zoom: 1 },
      mode: 'design',
      leftTab: 'file',
      editingTextId: null,
      editingVectorId: null,
      showUI: true,
      showRulers: true,
      showPixelGrid: true,
      snappingEnabled: true,
      saveState: 'saved',
      canUndo: false,
      canRedo: false,
      peers: {},
      comments: [],
      showComments: true,
      presentingFrameId: null,
      activePopover: null,
    };
    this.eph = {
      marquee: null,
      snapLinesV: [],
      snapLinesH: [],
      measureTargetId: null,
      sizeHint: null,
      creationDraft: null,
      penPreview: null,
      dropTargetId: null,
      spaceDown: false,
      pointerWorld: { x: 0, y: 0 },
    };
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): EditorState => this.state;

  private emit(): void {
    for (const fn of this.listeners) fn();
    this.requestRepaint();
  }

  /** Canvas paint loop subscription (also fired by ephemeral changes). */
  onRepaint = (fn: () => void): (() => void) => {
    this.repaintListeners.add(fn);
    return () => this.repaintListeners.delete(fn);
  };

  requestRepaint = (): void => {
    for (const fn of this.repaintListeners) fn();
  };

  // ── Generic state setters ─────────────────────────────────────────────────

  /** Patch non-document UI state (no history). */
  setState(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  // ── Core document mutation ────────────────────────────────────────────────

  apply(mutate: (doc: FigDocument) => FigDocument, opts: ApplyOptions = {}): void {
    const prev = this.state.doc;
    let next = mutate(prev);
    if (next === prev) return;
    if (!opts.skipLayout) next = layoutDocument(next);
    next = { ...next, revision: prev.revision + 1 };

    const mode = opts.history ?? 'push';
    if (mode === 'push') {
      this.pushHistory(prev);
      this.lastCoalesceKey = null;
    } else if (mode === 'coalesce') {
      const key = opts.coalesceKey ?? 'gesture';
      if (this.lastCoalesceKey !== key) {
        this.pushHistory(prev);
        this.lastCoalesceKey = key;
      }
    }

    // Selection hygiene: drop ids that no longer exist.
    const selection = this.state.selection.filter((id) => next.nodes[id]);
    this.state = {
      ...this.state,
      doc: next,
      selection: selection.length === this.state.selection.length ? this.state.selection : selection,
      saveState: 'dirty',
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
    this.emit();
    this.onDocCommitted?.(prev, next);
  }

  private pushHistory(doc: FigDocument): void {
    this.undoStack.push({ doc, selection: this.state.selection, pageId: this.state.currentPageId });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Ends gesture coalescing so the next change starts a fresh undo entry. */
  endGesture(): void {
    this.lastCoalesceKey = null;
  }

  undo = (): void => {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push({ doc: this.state.doc, selection: this.state.selection, pageId: this.state.currentPageId });
    const prev = this.state.doc;
    this.lastCoalesceKey = null;
    this.state = {
      ...this.state,
      doc: entry.doc,
      selection: entry.selection.filter((id) => entry.doc.nodes[id]),
      currentPageId: entry.doc.pages[entry.pageId] ? entry.pageId : entry.doc.pageOrder[0],
      editingTextId: null,
      editingVectorId: null,
      saveState: 'dirty',
      canUndo: this.undoStack.length > 0,
      canRedo: true,
    };
    this.emit();
    this.onDocCommitted?.(prev, this.state.doc);
  };

  redo = (): void => {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push({ doc: this.state.doc, selection: this.state.selection, pageId: this.state.currentPageId });
    const prev = this.state.doc;
    this.lastCoalesceKey = null;
    this.state = {
      ...this.state,
      doc: entry.doc,
      selection: entry.selection.filter((id) => entry.doc.nodes[id]),
      currentPageId: entry.doc.pages[entry.pageId] ? entry.pageId : entry.doc.pageOrder[0],
      editingTextId: null,
      editingVectorId: null,
      saveState: 'dirty',
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
    this.emit();
    this.onDocCommitted?.(prev, this.state.doc);
  };

  // ── Selection & navigation ────────────────────────────────────────────────

  select(ids: NodeId[]): void {
    const valid = ids.filter((id) => this.state.doc.nodes[id]);
    this.setState({ selection: valid });
  }

  toggleSelect(id: NodeId): void {
    const sel = this.state.selection;
    this.select(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
  }

  selectAll(): void {
    const frameSel = this.state.selection
      .map((id) => this.state.doc.nodes[id])
      .find((n) => n && this.state.doc.nodes[n.parentId]);
    if (frameSel) {
      // Select siblings within the same parent (Figma behaviour).
      const parent = this.state.doc.nodes[frameSel.parentId];
      if (parent) {
        this.select([...parent.childIds]);
        return;
      }
    }
    const page = this.state.doc.pages[this.state.currentPageId];
    this.select(page ? [...page.childIds] : []);
  }

  setHovered(id: NodeId | null): void {
    if (this.state.hoveredId !== id) this.setState({ hoveredId: id });
  }

  setTool(tool: ToolType): void {
    this.setState({ tool, editingVectorId: tool === 'pen' ? this.state.editingVectorId : null });
  }

  setMode(mode: EditorMode): void {
    this.setState({ mode });
  }

  setLeftTab(tab: LeftTab): void {
    this.setState({ leftTab: tab });
  }

  setCamera(camera: Camera): void {
    this.state = { ...this.state, camera };
    // Camera pans/zooms every frame during gestures; notify React listeners
    // (zoom % readout) but they should select narrowly.
    this.emit();
  }

  panBy(dx: number, dy: number): void {
    const c = this.state.camera;
    this.setCamera({ ...c, x: c.x + dx / c.zoom, y: c.y + dy / c.zoom });
  }

  zoomAtScreenPoint(screenPoint: Vec2, factor: number): void {
    this.setCamera(zoomAt(this.state.camera, screenPoint, this.state.camera.zoom * factor));
  }

  setZoom(zoom: number, viewportW: number, viewportH: number): void {
    this.setCamera(zoomAt(this.state.camera, { x: viewportW / 2, y: viewportH / 2 }, clamp(zoom, 0.02, 256)));
  }

  zoomToFit(viewportW: number, viewportH: number): void {
    const bounds = pageBounds(this.state.doc, this.state.currentPageId);
    if (!bounds) return this.setCamera({ x: -viewportW / 2, y: -viewportH / 2, zoom: 1 });
    this.setCamera(cameraToFit(bounds, viewportW, viewportH));
  }

  zoomToSelection(viewportW: number, viewportH: number): void {
    const bounds = worldBoundsOfNodes(this.state.doc, this.state.selection);
    if (bounds) this.setCamera(cameraToFit(bounds, viewportW, viewportH, 96));
  }

  setCurrentPage(pageId: PageId): void {
    if (!this.state.doc.pages[pageId] || pageId === this.state.currentPageId) return;
    this.setState({ currentPageId: pageId, selection: [], hoveredId: null, editingTextId: null });
  }

  // ── Node mutations ────────────────────────────────────────────────────────

  /** Patch nodes by id (object patch or updater fn). */
  updateNodes(
    ids: NodeId[],
    patch: Partial<SceneNode> | ((n: SceneNode) => Partial<SceneNode>),
    opts: ApplyOptions = {},
  ): void {
    if (ids.length === 0) return;
    this.apply((doc) => {
      let nodes = doc.nodes;
      let changed = false;
      for (const id of ids) {
        const n = nodes[id];
        if (!n) continue;
        const p = typeof patch === 'function' ? patch(n) : patch;
        if (!p || Object.keys(p).length === 0) continue;
        if (!changed) nodes = { ...nodes };
        nodes[id] = { ...n, ...p };
        changed = true;
      }
      return changed ? { ...doc, nodes } : doc;
    }, opts);
  }

  /**
   * Insert a prebuilt node (tree) under `parentId` (node id or page id).
   * Auto-names when the node still carries its type as name. Selects it.
   */
  insertNode(node: SceneNode, parentId: NodeId | PageId, index?: number, extraNodes?: Record<NodeId, SceneNode>): void {
    this.apply((doc) => {
      const named =
        node.name === node.type ? { ...node, parentId, name: nextName(doc, node.type) } : { ...node, parentId };
      const nodes = { ...doc.nodes, ...(extraNodes ?? {}), [named.id]: named };
      if (doc.pages[parentId]) {
        const page = doc.pages[parentId];
        const childIds = [...page.childIds];
        childIds.splice(index ?? childIds.length, 0, named.id);
        return { ...doc, nodes, pages: { ...doc.pages, [parentId]: { ...page, childIds } } };
      }
      const parent = nodes[parentId];
      if (!parent) return doc;
      const childIds = [...parent.childIds];
      childIds.splice(index ?? childIds.length, 0, named.id);
      nodes[parentId] = { ...parent, childIds };
      return { ...doc, nodes };
    });
    this.select([node.id]);
  }

  deleteNodes(ids: NodeId[]): void {
    const targets = topLevelOnly(this.state.doc, ids);
    if (targets.length === 0) return;
    this.apply((doc) => {
      const nodes = { ...doc.nodes };
      const pages = { ...doc.pages };
      const components = { ...doc.components };
      for (const id of targets) {
        const n = nodes[id];
        if (!n) continue;
        for (const did of [id, ...getDescendants(doc, id)]) {
          if (components[did]) delete components[did];
          delete nodes[did];
        }
        if (pages[n.parentId]) {
          pages[n.parentId] = { ...pages[n.parentId], childIds: pages[n.parentId].childIds.filter((c) => c !== id) };
        } else if (nodes[n.parentId]) {
          nodes[n.parentId] = { ...nodes[n.parentId], childIds: nodes[n.parentId].childIds.filter((c) => c !== id) };
        }
      }
      return { ...doc, nodes, pages, components };
    });
    this.setState({ selection: [], hoveredId: null });
  }

  deleteSelection(): void {
    this.deleteNodes(this.state.selection);
  }

  /**
   * Reparent nodes keeping their world position. `index` positions within the
   * new parent's childIds (default: end/top).
   */
  reparent(ids: NodeId[], newParentId: NodeId | PageId, index?: number, opts: ApplyOptions = {}): void {
    const doc0 = this.state.doc;
    const valid = topLevelOnly(doc0, ids).filter(
      (id) => id !== newParentId && !isAncestorOf(doc0, id, newParentId) && doc0.nodes[id],
    );
    if (valid.length === 0) return;
    this.apply((doc) => {
      let nodes = { ...doc.nodes };
      let pages = doc.pages;
      // World offset of the new parent.
      const parentOrigin = doc.pages[newParentId] ? { x: 0, y: 0 } : worldPosition(doc, newParentId);
      let insertAt = index;
      for (const id of valid) {
        const n = nodes[id];
        const oldParentId = n.parentId;
        if (oldParentId === newParentId) continue;
        const world = worldPosition(doc, id);
        // Remove from old parent.
        if (doc.pages[oldParentId]) {
          pages = { ...pages, [oldParentId]: { ...pages[oldParentId], childIds: pages[oldParentId].childIds.filter((c) => c !== id) } };
        } else if (nodes[oldParentId]) {
          nodes[oldParentId] = { ...nodes[oldParentId], childIds: nodes[oldParentId].childIds.filter((c) => c !== id) };
        }
        // Insert into new parent.
        if (doc.pages[newParentId]) {
          const page = pages[newParentId];
          const childIds = [...page.childIds];
          childIds.splice(insertAt ?? childIds.length, 0, id);
          if (insertAt !== undefined) insertAt++;
          pages = { ...pages, [newParentId]: { ...page, childIds } };
        } else {
          const parent = nodes[newParentId];
          const childIds = [...parent.childIds];
          childIds.splice(insertAt ?? childIds.length, 0, id);
          if (insertAt !== undefined) insertAt++;
          nodes[newParentId] = { ...parent, childIds };
        }
        nodes[id] = { ...n, parentId: newParentId, x: world.x - parentOrigin.x, y: world.y - parentOrigin.y };
      }
      return { ...doc, nodes, pages };
    }, opts);
  }

  /** Paint-order ops on the selection within each parent. */
  reorder(op: 'front' | 'back' | 'forward' | 'backward'): void {
    const sel = new Set(topLevelOnly(this.state.doc, this.state.selection));
    if (sel.size === 0) return;
    this.apply((doc) => {
      let nodes = doc.nodes;
      let pages = doc.pages;
      const applyOrder = (childIds: NodeId[]): NodeId[] => {
        const selected = childIds.filter((c) => sel.has(c));
        if (selected.length === 0) return childIds;
        const rest = childIds.filter((c) => !sel.has(c));
        if (op === 'front') return [...rest, ...selected];
        if (op === 'back') return [...selected, ...rest];
        const out = [...childIds];
        const indices = selected.map((s) => out.indexOf(s)).sort((a, b) => (op === 'forward' ? b - a : a - b));
        for (const i of indices) {
          const j = op === 'forward' ? Math.min(out.length - 1, i + 1) : Math.max(0, i - 1);
          const [item] = out.splice(i, 1);
          out.splice(j, 0, item);
        }
        return out;
      };
      for (const pid of doc.pageOrder) {
        const page = pages[pid];
        const next = applyOrder(page.childIds);
        if (next !== page.childIds && next.join() !== page.childIds.join()) {
          pages = { ...pages, [pid]: { ...page, childIds: next } };
        }
      }
      for (const id in doc.nodes) {
        const n = doc.nodes[id];
        if (n.childIds.length === 0) continue;
        const next = applyOrder(n.childIds);
        if (next.join() !== n.childIds.join()) {
          if (nodes === doc.nodes) nodes = { ...nodes };
          nodes[id] = { ...n, childIds: next };
        }
      }
      return { ...doc, nodes, pages };
    });
  }

  // ── Group / frame / component ─────────────────────────────────────────────

  groupSelection(as: 'GROUP' | 'FRAME' = 'GROUP'): void {
    const doc = this.state.doc;
    const ids = topLevelOnly(doc, this.state.selection);
    if (ids.length === 0) return;
    const bounds = worldBoundsOfNodes(doc, ids);
    if (!bounds) return;
    const first = doc.nodes[ids[0]];
    const parentId = first.parentId;
    const parentOrigin = doc.pages[parentId] ? { x: 0, y: 0 } : worldPosition(doc, parentId);
    const container = createNode(as, {
      x: bounds.x - parentOrigin.x,
      y: bounds.y - parentOrigin.y,
      width: bounds.width,
      height: bounds.height,
      clipsContent: as === 'FRAME',
      fills: as === 'GROUP' ? [] : [],
    });
    this.apply((d) => {
      const named = { ...container, parentId, name: nextName(d, as) };
      let nodes = { ...d.nodes, [named.id]: named };
      let pages = d.pages;
      // Insert container at the topmost selected node's position.
      const siblings = d.pages[parentId] ? d.pages[parentId].childIds : d.nodes[parentId]?.childIds ?? [];
      const topIndex = Math.max(...ids.map((id) => siblings.indexOf(id)));
      const newSiblings = siblings.filter((c) => !ids.includes(c));
      newSiblings.splice(Math.min(topIndex - ids.length + 1, newSiblings.length), 0, named.id);
      if (d.pages[parentId]) {
        pages = { ...pages, [parentId]: { ...d.pages[parentId], childIds: newSiblings } };
      } else {
        nodes[parentId] = { ...nodes[parentId], childIds: newSiblings };
      }
      // Move members into the container preserving world position.
      const childIds: NodeId[] = [];
      for (const id of siblings.filter((c) => ids.includes(c))) {
        const n = nodes[id];
        const world = worldPosition(d, id);
        nodes[id] = { ...n, parentId: named.id, x: world.x - bounds.x, y: world.y - bounds.y };
        childIds.push(id);
      }
      nodes[named.id] = { ...nodes[named.id], childIds };
      return { ...d, nodes, pages };
    });
    this.select([container.id]);
  }

  ungroupSelection(): void {
    const doc = this.state.doc;
    const groups = this.state.selection.filter((id) => {
      const n = doc.nodes[id];
      return n && (n.type === 'GROUP' || n.type === 'FRAME' || n.type === 'SECTION');
    });
    if (groups.length === 0) return;
    const released: NodeId[] = [];
    this.apply((d) => {
      let nodes = { ...d.nodes };
      let pages = d.pages;
      for (const gid of groups) {
        const g = nodes[gid];
        if (!g) continue;
        const parentId = g.parentId;
        const parentOrigin = d.pages[parentId] ? { x: 0, y: 0 } : worldPosition(d, parentId);
        const siblings = d.pages[parentId] ? pages[parentId].childIds : nodes[parentId]?.childIds ?? [];
        const gIndex = siblings.indexOf(gid);
        const newSiblings = [...siblings];
        newSiblings.splice(gIndex, 1, ...g.childIds);
        for (const cid of g.childIds) {
          const c = nodes[cid];
          const world = worldPosition(d, cid);
          nodes[cid] = {
            ...c,
            parentId,
            x: world.x - parentOrigin.x,
            y: world.y - parentOrigin.y,
            rotation: c.rotation + g.rotation,
          };
          released.push(cid);
        }
        delete nodes[gid];
        if (d.pages[parentId]) {
          pages = { ...pages, [parentId]: { ...pages[parentId], childIds: newSiblings } };
        } else {
          nodes[parentId] = { ...nodes[parentId], childIds: newSiblings };
        }
      }
      return { ...d, nodes, pages };
    });
    this.select(released);
  }

  /** Convert the selection into a COMPONENT (single node or wrap-in-frame). */
  createComponentFromSelection(): void {
    const doc = this.state.doc;
    const ids = topLevelOnly(doc, this.state.selection);
    if (ids.length === 0) return;
    if (ids.length > 1 || doc.nodes[ids[0]].type !== 'FRAME') {
      this.groupSelection('FRAME');
    }
    const rootId = this.state.selection[0];
    if (!rootId) return;
    this.apply((d) => {
      const n = d.nodes[rootId];
      if (!n) return d;
      const pageId = this.state.currentPageId;
      const compName = n.name.startsWith('Frame ') ? nextName(d, 'COMPONENT') : n.name;
      return {
        ...d,
        nodes: { ...d.nodes, [rootId]: { ...n, type: 'COMPONENT', name: compName } },
        components: {
          ...d.components,
          [rootId]: { id: rootId, name: compName, description: '', pageId },
        },
      };
    });
  }

  /** Instantiate a component at a world point on the current page. */
  createInstance(componentId: NodeId, at: Vec2): NodeId | null {
    const doc = this.state.doc;
    const comp = doc.nodes[componentId];
    if (!comp || comp.type !== 'COMPONENT') return null;
    const inst = createNode('INSTANCE', {
      x: at.x,
      y: at.y,
      width: comp.width,
      height: comp.height,
      componentId,
      overrides: {},
      fills: [],
      name: comp.name,
    });
    this.insertNode(inst, this.state.currentPageId);
    return inst.id;
  }

  /** Replace an INSTANCE with an editable copy of its component subtree. */
  detachInstance(instanceId: NodeId): void {
    const doc = this.state.doc;
    const inst = doc.nodes[instanceId];
    if (!inst || inst.type !== 'INSTANCE' || !inst.componentId) return;
    const cloned = cloneSubtree(doc, inst.componentId);
    if (!cloned) return;
    this.apply((d) => {
      const root = cloned.nodes[cloned.rootId];
      cloned.nodes[cloned.rootId] = {
        ...root,
        type: 'FRAME',
        parentId: inst.parentId,
        x: inst.x,
        y: inst.y,
        width: inst.width,
        height: inst.height,
        rotation: inst.rotation,
        name: inst.name,
      };
      const nodes = { ...d.nodes, ...cloned.nodes };
      delete nodes[instanceId];
      let pages = d.pages;
      if (d.pages[inst.parentId]) {
        const page = d.pages[inst.parentId];
        pages = {
          ...pages,
          [inst.parentId]: { ...page, childIds: page.childIds.map((c) => (c === instanceId ? cloned.rootId : c)) },
        };
      } else if (nodes[inst.parentId]) {
        nodes[inst.parentId] = {
          ...nodes[inst.parentId],
          childIds: nodes[inst.parentId].childIds.map((c) => (c === instanceId ? cloned.rootId : c)),
        };
      }
      return { ...d, nodes, pages };
    });
    this.select([cloned.rootId]);
  }

  // ── Align & distribute ────────────────────────────────────────────────────

  align(op: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom'): void {
    const doc = this.state.doc;
    const ids = topLevelOnly(doc, this.state.selection);
    if (ids.length === 0) return;
    // Single node aligns to its parent frame; multiple align to combined bounds.
    let target: Rect | null;
    if (ids.length === 1) {
      const parentId = doc.nodes[ids[0]].parentId;
      target = doc.pages[parentId] ? null : worldBounds(doc, parentId);
      if (!target) return;
    } else {
      target = worldBoundsOfNodes(doc, ids);
    }
    if (!target) return;
    const t = target;
    this.apply((d) => {
      let nodes = { ...d.nodes };
      for (const id of ids) {
        const b = worldBounds(d, id);
        let dx = 0;
        let dy = 0;
        if (op === 'left') dx = t.x - b.x;
        else if (op === 'right') dx = t.x + t.width - (b.x + b.width);
        else if (op === 'center-h') dx = t.x + t.width / 2 - (b.x + b.width / 2);
        else if (op === 'top') dy = t.y - b.y;
        else if (op === 'bottom') dy = t.y + t.height - (b.y + b.height);
        else if (op === 'center-v') dy = t.y + t.height / 2 - (b.y + b.height / 2);
        const n = nodes[id];
        nodes[id] = { ...n, x: n.x + dx, y: n.y + dy };
      }
      return { ...d, nodes };
    });
  }

  distribute(axis: 'horizontal' | 'vertical'): void {
    const doc = this.state.doc;
    const ids = topLevelOnly(doc, this.state.selection);
    if (ids.length < 3) return;
    const entries = ids
      .map((id) => ({ id, b: worldBounds(doc, id) }))
      .sort((a, b) => (axis === 'horizontal' ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = entries[0];
    const last = entries[entries.length - 1];
    const totalSize = entries.reduce((s, e) => s + (axis === 'horizontal' ? e.b.width : e.b.height), 0);
    const span =
      axis === 'horizontal' ? last.b.x + last.b.width - first.b.x : last.b.y + last.b.height - first.b.y;
    const gap = (span - totalSize) / (entries.length - 1);
    this.apply((d) => {
      let nodes = { ...d.nodes };
      let cursor = axis === 'horizontal' ? first.b.x : first.b.y;
      for (const e of entries) {
        const n = nodes[e.id];
        const delta = axis === 'horizontal' ? cursor - e.b.x : cursor - e.b.y;
        nodes[e.id] = axis === 'horizontal' ? { ...n, x: n.x + delta } : { ...n, y: n.y + delta };
        cursor += (axis === 'horizontal' ? e.b.width : e.b.height) + gap;
      }
      return { ...d, nodes };
    });
  }

  // ── Clipboard / duplicate ─────────────────────────────────────────────────

  private clipboard: { nodes: Record<NodeId, SceneNode>; roots: NodeId[]; images: Record<string, string> } | null =
    null;

  copySelection(): void {
    const doc = this.state.doc;
    const ids = topLevelOnly(doc, this.state.selection);
    if (ids.length === 0) return;
    const nodes: Record<NodeId, SceneNode> = {};
    const images: Record<string, string> = {};
    const collectImages = (n: SceneNode) => {
      for (const f of [...n.fills, ...n.strokes]) {
        if (f.type === 'IMAGE' && doc.images[f.imageRef]) images[f.imageRef] = doc.images[f.imageRef];
      }
    };
    for (const id of ids) {
      for (const nid of [id, ...getDescendants(doc, id)]) {
        nodes[nid] = doc.nodes[nid];
        collectImages(doc.nodes[nid]);
      }
    }
    this.clipboard = { nodes, roots: ids, images };
  }

  cutSelection(): void {
    this.copySelection();
    this.deleteSelection();
  }

  paste(at?: Vec2): void {
    if (!this.clipboard) return;
    const clip = this.clipboard;
    const newIds: NodeId[] = [];
    this.apply((d) => {
      let nodes = { ...d.nodes };
      let pages = { ...d.pages };
      const images = { ...d.images, ...clip.images };
      const pageId = this.state.currentPageId;
      for (const rootId of clip.roots) {
        const src = clip.nodes[rootId];
        if (!src) continue;
        // Clone with fresh ids from the clipboard snapshot.
        const idMap = new Map<NodeId, NodeId>();
        const cloneFrom = (id: NodeId, parentId: string): NodeId => {
          const n = clip.nodes[id];
          const newId = genId();
          idMap.set(id, newId);
          nodes[newId] = { ...n, id: newId, parentId, childIds: [] };
          nodes[newId] = { ...nodes[newId], childIds: n.childIds.filter((c) => clip.nodes[c]).map((c) => cloneFrom(c, newId)) };
          return newId;
        };
        const newRoot = cloneFrom(rootId, pageId);
        const offset = at
          ? { x: at.x - src.x, y: at.y - src.y }
          : { x: 16, y: 16 };
        nodes[newRoot] = { ...nodes[newRoot], x: src.x + offset.x, y: src.y + offset.y };
        pages[pageId] = { ...pages[pageId], childIds: [...pages[pageId].childIds, newRoot] };
        newIds.push(newRoot);
      }
      return { ...d, nodes, pages, images };
    });
    this.select(newIds);
  }

  duplicateSelection(offset: Vec2 = { x: 16, y: 16 }): NodeId[] {
    const doc = this.state.doc;
    const ids = topLevelOnly(doc, this.state.selection);
    if (ids.length === 0) return [];
    const newIds: NodeId[] = [];
    this.apply((d) => {
      let nodes = { ...d.nodes };
      let pages = { ...d.pages };
      for (const id of ids) {
        const src = d.nodes[id];
        const cloned = cloneSubtree(d, id);
        if (!cloned) continue;
        Object.assign(nodes, cloned.nodes);
        nodes[cloned.rootId] = { ...nodes[cloned.rootId], x: src.x + offset.x, y: src.y + offset.y };
        if (d.pages[src.parentId]) {
          const page = pages[src.parentId];
          const idx = page.childIds.indexOf(id);
          const childIds = [...page.childIds];
          childIds.splice(idx + 1, 0, cloned.rootId);
          pages[src.parentId] = { ...page, childIds };
        } else if (nodes[src.parentId]) {
          const parent = nodes[src.parentId];
          const idx = parent.childIds.indexOf(id);
          const childIds = [...parent.childIds];
          childIds.splice(idx + 1, 0, cloned.rootId);
          nodes[src.parentId] = { ...parent, childIds };
        }
        newIds.push(cloned.rootId);
      }
      return { ...d, nodes, pages };
    });
    this.select(newIds);
    return newIds;
  }

  // ── Pages ─────────────────────────────────────────────────────────────────

  addPage(): void {
    const id = genId();
    this.apply((doc) => {
      const num = doc.pageOrder.length + 1;
      const page: FigPage = {
        id,
        name: `Page ${num}`,
        childIds: [],
        backgroundColor: { r: 30 / 255, g: 30 / 255, b: 30 / 255, a: 1 },
        prototypeStartNodeId: null,
      };
      return { ...doc, pages: { ...doc.pages, [id]: page }, pageOrder: [...doc.pageOrder, id] };
    });
    this.setCurrentPage(id);
  }

  renamePage(pageId: PageId, name: string): void {
    this.apply((doc) => {
      const page = doc.pages[pageId];
      if (!page || page.name === name) return doc;
      return { ...doc, pages: { ...doc.pages, [pageId]: { ...page, name } } };
    });
  }

  deletePage(pageId: PageId): void {
    if (this.state.doc.pageOrder.length <= 1) return;
    this.apply((doc) => {
      const page = doc.pages[pageId];
      if (!page) return doc;
      const nodes = { ...doc.nodes };
      for (const id of page.childIds) {
        for (const did of [id, ...getDescendants(doc, id)]) delete nodes[did];
      }
      const pages = { ...doc.pages };
      delete pages[pageId];
      return { ...doc, nodes, pages, pageOrder: doc.pageOrder.filter((p) => p !== pageId) };
    });
    if (this.state.currentPageId === pageId) {
      this.setCurrentPage(this.state.doc.pageOrder[0]);
    }
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  addColorStyle(style: Omit<ColorStyle, 'id'>): void {
    this.apply((doc) => ({
      ...doc,
      styles: { ...doc.styles, colors: [...doc.styles.colors, { ...style, id: genId() }] },
    }));
  }

  removeColorStyle(id: string): void {
    this.apply((doc) => ({
      ...doc,
      styles: { ...doc.styles, colors: doc.styles.colors.filter((s) => s.id !== id) },
    }));
  }

  addTextStyleShared(style: Omit<SharedTextStyle, 'id'>): void {
    this.apply((doc) => ({
      ...doc,
      styles: { ...doc.styles, texts: [...doc.styles.texts, { ...style, id: genId() }] },
    }));
  }

  // ── Images ────────────────────────────────────────────────────────────────

  registerImage(hash: string, dataUrl: string): void {
    this.apply((doc) => (doc.images[hash] ? doc : { ...doc, images: { ...doc.images, [hash]: dataUrl } }), {
      history: 'skip',
    });
  }

  // ── Document / file meta ──────────────────────────────────────────────────

  renameFile(name: string): void {
    this.apply((doc) => ({ ...doc, name }));
    this.setState({ fileMeta: { ...this.state.fileMeta, name } });
  }

  /** Merge remote (peer) operations without recording history. */
  applyRemoteOps(ops: DocOps): void {
    this.apply(
      (doc) => {
        let next = { ...doc };
        if (ops.set || ops.del) {
          const nodes = { ...next.nodes, ...(ops.set ?? {}) };
          for (const id of ops.del ?? []) delete nodes[id];
          next.nodes = nodes;
        }
        if (ops.pages || ops.delPages) {
          const pages = { ...next.pages, ...(ops.pages ?? {}) };
          for (const id of ops.delPages ?? []) delete pages[id];
          next.pages = pages;
        }
        if (ops.pageOrder) next.pageOrder = ops.pageOrder;
        if (ops.name !== undefined) next.name = ops.name;
        if (ops.images) next.images = { ...next.images, ...ops.images };
        if (ops.components) next.components = ops.components;
        if (ops.styles) next.styles = ops.styles;
        return next;
      },
      { history: 'skip' },
    );
  }

  // ── Presence ──────────────────────────────────────────────────────────────

  setPeer(peerId: string, state: PeerState | null): void {
    const peers = { ...this.state.peers };
    if (state) peers[peerId] = state;
    else delete peers[peerId];
    this.setState({ peers });
  }

  patchPeer(peerId: string, patch: Partial<PeerState>): void {
    const cur = this.state.peers[peerId];
    if (!cur) return;
    this.setState({ peers: { ...this.state.peers, [peerId]: { ...cur, ...patch } } });
  }
}

// ── Realtime diff (prev doc → ops) ───────────────────────────────────────────

/** Reference-equality diff of two docs into wire ops. Cheap thanks to COW. */
export function diffDocs(prev: FigDocument, next: FigDocument): DocOps | null {
  if (prev === next) return null;
  const ops: DocOps = {};
  if (prev.nodes !== next.nodes) {
    const set: Record<NodeId, SceneNode> = {};
    const del: NodeId[] = [];
    for (const id in next.nodes) if (next.nodes[id] !== prev.nodes[id]) set[id] = next.nodes[id];
    for (const id in prev.nodes) if (!next.nodes[id]) del.push(id);
    if (Object.keys(set).length) ops.set = set;
    if (del.length) ops.del = del;
  }
  if (prev.pages !== next.pages) {
    const pages: Record<PageId, FigPage> = {};
    const delPages: PageId[] = [];
    for (const id in next.pages) if (next.pages[id] !== prev.pages[id]) pages[id] = next.pages[id];
    for (const id in prev.pages) if (!next.pages[id]) delPages.push(id);
    if (Object.keys(pages).length) ops.pages = pages;
    if (delPages.length) ops.delPages = delPages;
  }
  if (prev.pageOrder !== next.pageOrder) ops.pageOrder = next.pageOrder;
  if (prev.name !== next.name) ops.name = next.name;
  if (prev.images !== next.images) {
    const images: Record<string, string> = {};
    for (const k in next.images) if (!prev.images[k]) images[k] = next.images[k];
    if (Object.keys(images).length) ops.images = images;
  }
  if (prev.components !== next.components) ops.components = next.components;
  if (prev.styles !== next.styles) ops.styles = next.styles;
  ops.revision = next.revision;
  const keys = Object.keys(ops);
  return keys.length > 1 || (keys.length === 1 && keys[0] !== 'revision') ? ops : null;
}

// ── React bindings ───────────────────────────────────────────────────────────

export const EditorContext = createContext<EditorStore | null>(null);

export function useEditorStore(): EditorStore {
  const store = useContext(EditorContext);
  if (!store) throw new Error('useEditorStore must be used inside <EditorContext.Provider>');
  return store;
}

/**
 * Subscribe to a slice of editor state. The selector must return a stable
 * (Object.is-comparable) value — primitives, or references out of the state.
 */
export function useEditor<T>(selector: (s: EditorState) => T): T {
  const store = useEditorStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.state),
    () => selector(store.state),
  );
}

// ── Bootstrap helpers ────────────────────────────────────────────────────────

/** A fresh document pre-seeded like Figma's "New design file" (empty page). */
export function newFileDocument(id: string, name: string): FigDocument {
  return createEmptyDocument(id, name);
}

export { createNode, genId, getNode, getAncestors, nextName };
