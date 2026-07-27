/**
 * Willow Figma — module boundary contracts.
 *
 * Each editor subsystem (renderer, overlays, interaction engine, tools,
 * exporter) is implemented in its own module against the interfaces below.
 * CanvasHost composes them; nothing else may deep-import across subsystems.
 */

import type { EditorStore } from './store';
import type { Camera, FigDocument, NodeId, PageId, Rect, ToolType, Vec2 } from './types';

// ── Renderer (editor/canvas/render.ts) ───────────────────────────────────────

export interface RenderOptions {
  /** Device pixel ratio already applied to the canvas backing store. */
  dpr: number;
  viewportW: number;
  viewportH: number;
  /** Draw the checkered/pixel grid when zoom ≥ 4 (Figma behaviour). */
  showPixelGrid: boolean;
  /** Node ids to skip painting (e.g. text node hidden while DOM-edited). */
  skip?: Set<NodeId>;
  /** Image cache shared across paints; renderer loads refs lazily and calls onImageLoaded. */
  images: ImageCache;
  /** When set, render exactly this node subtree (export path). */
  onlyNodeId?: NodeId;
  /** Paint frame name labels above top-level frames. */
  frameLabels?: boolean;
  /** Currently selected ids — frame labels tint blue. */
  selection?: ReadonlySet<NodeId>;
}

export interface ImageCache {
  get(ref: string): HTMLImageElement | null;
  /** Begin loading a data URL; onLoad fires repaint. */
  ensure(ref: string, dataUrl: string): void;
}

/** Paint one full page (background, nodes, frame labels) into ctx. */
export type RenderSceneFn = (
  ctx: CanvasRenderingContext2D,
  doc: FigDocument,
  pageId: PageId,
  camera: Camera,
  opts: RenderOptions,
) => void;

// ── Overlays (editor/canvas/overlays.ts) ─────────────────────────────────────

/** Everything the overlay painter needs beyond the store. */
export interface OverlayContext {
  store: EditorStore;
  viewportW: number;
  viewportH: number;
  dpr: number;
}

/** Paint selection outlines, handles, hover, marquee, snap guides, rulers, measurements. */
export type RenderOverlaysFn = (ctx: CanvasRenderingContext2D, octx: OverlayContext) => void;

/** Hit zones for the transform handles, used by the interaction engine. */
export type HandleKind =
  | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
  | 'rotate-nw' | 'rotate-ne' | 'rotate-se' | 'rotate-sw';

export interface HandleHit {
  kind: HandleKind;
  cursor: string;
}

/** Which handle (if any) sits under a screen point for the current selection. */
export type HitTestHandlesFn = (store: EditorStore, screen: Vec2, viewportW: number, viewportH: number) => HandleHit | null;

// ── Interaction engine (editor/canvas/interactions.ts) ───────────────────────

export interface PointerEventLike {
  clientX: number;
  clientY: number;
  /** Position relative to the canvas element. */
  x: number;
  y: number;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * The pointer/keyboard state machine for the canvas: selection, marquee,
 * move (with snapping + reparent), resize/rotate via handles, creation drags
 * for shape tools, pan/zoom, measurement hover, double-click descend.
 */
export interface InteractionEngine {
  onPointerDown(e: PointerEventLike): void;
  onPointerMove(e: PointerEventLike): void;
  onPointerUp(e: PointerEventLike): void;
  onDoubleClick(e: PointerEventLike): void;
  onWheel(e: WheelEvent, canvasPoint: Vec2): void;
  onKeyDown(e: KeyboardEvent): boolean; // true = handled (stop propagation)
  onKeyUp(e: KeyboardEvent): void;
  /** CSS cursor for the canvas right now. */
  getCursor(): string;
  /** Viewport size so the engine can zoom-to-fit etc. */
  setViewport(w: number, h: number): void;
  destroy(): void;
}

export type CreateInteractionEngineFn = (store: EditorStore) => InteractionEngine;

// ── Export (lib/export.ts, implemented with the renderer) ────────────────────

export interface ExportResult {
  /** File name including extension. */
  filename: string;
  /** Blob ready for download. */
  blob: Blob;
}

export interface ExportNodeFn {
  (doc: FigDocument, nodeId: NodeId, format: 'PNG' | 'JPG' | 'SVG', scale: number): Promise<ExportResult>;
}

/** Render a small PNG data-URL thumbnail of the page (for file cards). */
export interface RenderThumbnailFn {
  (doc: FigDocument, pageId: PageId, width: number, height: number): string | null;
}

// ── Prototype player (editor/PresentMode.tsx) ────────────────────────────────

export interface PresentModeProps {
  onExit: () => void;
}

// ── Tool metadata (toolbar + shortcuts share this) ───────────────────────────

export interface ToolDefinition {
  id: ToolType;
  label: string;
  shortcut: string | null;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { id: 'move', label: 'Move', shortcut: 'V' },
  { id: 'hand', label: 'Hand tool', shortcut: 'H' },
  { id: 'scale', label: 'Scale', shortcut: 'K' },
  { id: 'frame', label: 'Frame', shortcut: 'F' },
  { id: 'section', label: 'Section', shortcut: 'Shift+S' },
  { id: 'slice', label: 'Slice', shortcut: 'S' },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'R' },
  { id: 'line', label: 'Line', shortcut: 'L' },
  { id: 'arrow', label: 'Arrow', shortcut: 'Shift+L' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O' },
  { id: 'polygon', label: 'Polygon', shortcut: null },
  { id: 'star', label: 'Star', shortcut: null },
  { id: 'image', label: 'Place image', shortcut: 'Ctrl+Shift+K' },
  { id: 'pen', label: 'Pen', shortcut: 'P' },
  { id: 'pencil', label: 'Pencil', shortcut: 'Shift+P' },
  { id: 'text', label: 'Text', shortcut: 'T' },
  { id: 'comment', label: 'Add comment', shortcut: 'C' },
];

// ── Misc shared UI constants ─────────────────────────────────────────────────

export const PANEL_BG = '#2c2c2c';
export const PANEL_BORDER = '#444444';
export const CANVAS_BG_CSS = '#1e1e1e';
export const TEXT_PRIMARY = '#ffffff';
export const TEXT_SECONDARY = '#b3b3b3';
export const ACCENT_BLUE = '#0d99ff';
export const SELECTION_STROKE = '#0d99ff';
export const COMPONENT_STROKE = '#9747ff';
export const RULER_SIZE = 0; // rulers drawn as overlay lines, no fixed gutter

/** Screen-space rect utilities shared by overlays + interactions. */
export interface SelectionScreenBox {
  rect: Rect; // screen space
  rotation: number; // deg, 0 for multi-selection
}
