/**
 * Willow Figma — scene graph & document model.
 *
 * This file is the single source of truth for every data shape in the Figma
 * clone: nodes, paints, effects, text, auto layout, prototyping, components,
 * styles, comments, presence and file metadata. Every editor module (renderer,
 * interactions, panels, backend client) codes against these types.
 *
 * Conventions:
 *  - No TypeScript enums (string-literal unions only) so the backend can share
 *    types under Node's native type-stripping.
 *  - Node x/y are relative to the parent's coordinate space; rotation is in
 *    degrees around the node's top-left corner-centered pivot (center pivot).
 *  - All ids are opaque strings (nanoid-style, generated in scene.ts).
 */

// ── Ids ──────────────────────────────────────────────────────────────────────

export type NodeId = string;
export type PageId = string;
export type FileId = string;
export type StyleId = string;
export type ComponentId = string;

// ── Color & paints ───────────────────────────────────────────────────────────

/** RGBA, all channels 0..1 (matches Figma's plugin API). */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface GradientStop {
  /** 0..1 along the gradient axis. */
  position: number;
  color: RGBA;
}

export type PaintType = 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'IMAGE';

export interface SolidPaint {
  type: 'SOLID';
  color: RGBA;
  opacity: number; // 0..1, multiplied with color.a
  visible: boolean;
}

export interface GradientPaint {
  type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR';
  stops: GradientStop[];
  /** Rotation of the gradient axis in degrees (0 = left→right). */
  rotation: number;
  opacity: number;
  visible: boolean;
}

export type ImageScaleMode = 'FILL' | 'FIT' | 'CROP' | 'TILE';

export interface ImagePaint {
  type: 'IMAGE';
  /** Key into FigDocument.images (content-hash → data URL). */
  imageRef: string;
  scaleMode: ImageScaleMode;
  opacity: number;
  visible: boolean;
}

export type Paint = SolidPaint | GradientPaint | ImagePaint;

// ── Effects ──────────────────────────────────────────────────────────────────

export type EffectType = 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR';

export interface ShadowEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW';
  color: RGBA;
  offset: { x: number; y: number };
  radius: number; // blur
  spread: number;
  visible: boolean;
}

export interface BlurEffect {
  type: 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  radius: number;
  visible: boolean;
}

export type Effect = ShadowEffect | BlurEffect;

// ── Strokes ──────────────────────────────────────────────────────────────────

export type StrokeAlign = 'INSIDE' | 'OUTSIDE' | 'CENTER';
export type StrokeCap = 'NONE' | 'ROUND' | 'SQUARE' | 'ARROW_LINES' | 'ARROW_EQUILATERAL';
export type StrokeJoin = 'MITER' | 'BEVEL' | 'ROUND';

// ── Blend modes ──────────────────────────────────────────────────────────────

export type BlendMode =
  | 'NORMAL'
  | 'MULTIPLY'
  | 'SCREEN'
  | 'OVERLAY'
  | 'DARKEN'
  | 'LIGHTEN'
  | 'COLOR_DODGE'
  | 'COLOR_BURN'
  | 'HARD_LIGHT'
  | 'SOFT_LIGHT'
  | 'DIFFERENCE'
  | 'EXCLUSION'
  | 'HUE'
  | 'SATURATION'
  | 'COLOR'
  | 'LUMINOSITY';

// ── Constraints (resize behaviour inside a parent frame) ─────────────────────

export type ConstraintType = 'MIN' | 'MAX' | 'CENTER' | 'STRETCH' | 'SCALE';

export interface Constraints {
  horizontal: ConstraintType;
  vertical: ConstraintType;
}

// ── Auto layout ──────────────────────────────────────────────────────────────

export type LayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL';
export type AxisSizing = 'FIXED' | 'HUG' | 'FILL';
export type PrimaryAxisAlign = 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
export type CounterAxisAlign = 'MIN' | 'CENTER' | 'MAX';

export interface AutoLayout {
  mode: LayoutMode;
  /** Gap between children; ignored when primaryAxisAlign is SPACE_BETWEEN. */
  itemSpacing: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  primaryAxisAlign: PrimaryAxisAlign;
  counterAxisAlign: CounterAxisAlign;
  /** How the frame itself sizes along its primary / counter axis. */
  primaryAxisSizing: 'FIXED' | 'HUG';
  counterAxisSizing: 'FIXED' | 'HUG';
}

/** Per-child auto layout participation. */
export type LayoutPositioning = 'AUTO' | 'ABSOLUTE';
export type LayoutGrow = 0 | 1; // 1 = FILL along parent's primary axis
export type LayoutAlignSelf = 'INHERIT' | 'STRETCH';

// ── Text ─────────────────────────────────────────────────────────────────────

export type TextAlignHorizontal = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
export type TextAlignVertical = 'TOP' | 'CENTER' | 'BOTTOM';
export type TextAutoResize = 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT';
export type TextDecoration = 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
export type TextCase = 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';

export interface TextStyleProps {
  fontFamily: string;
  fontWeight: number; // 100..900
  italic: boolean;
  fontSize: number;
  /** Percent (e.g. 100) or px; unit discriminated below. */
  lineHeight: { value: number; unit: 'AUTO' | 'PIXELS' | 'PERCENT' };
  letterSpacing: { value: number; unit: 'PIXELS' | 'PERCENT' };
  textAlignHorizontal: TextAlignHorizontal;
  textAlignVertical: TextAlignVertical;
  textAutoResize: TextAutoResize;
  textDecoration: TextDecoration;
  textCase: TextCase;
  paragraphSpacing: number;
}

// ── Vector paths (pen tool) ──────────────────────────────────────────────────

export interface VectorPoint {
  x: number;
  y: number;
  /** Bezier handle going INTO this point (absolute coords), null = corner. */
  handleIn: { x: number; y: number } | null;
  /** Bezier handle going OUT of this point. */
  handleOut: { x: number; y: number } | null;
}

export interface VectorPath {
  points: VectorPoint[];
  closed: boolean;
}

// ── Prototyping ──────────────────────────────────────────────────────────────

export type TriggerType = 'ON_CLICK' | 'ON_HOVER' | 'ON_PRESS' | 'AFTER_DELAY' | 'ON_DRAG';
export type ActionType = 'NAVIGATE' | 'BACK' | 'OPEN_OVERLAY' | 'CLOSE_OVERLAY' | 'OPEN_URL' | 'SCROLL_TO';
export type TransitionType = 'INSTANT' | 'DISSOLVE' | 'SMART_ANIMATE' | 'MOVE_IN' | 'MOVE_OUT' | 'PUSH' | 'SLIDE_IN' | 'SLIDE_OUT';
export type TransitionDirection = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';

export interface Reaction {
  id: string;
  trigger: { type: TriggerType; delayMs?: number };
  action: {
    type: ActionType;
    /** Target top-level frame for NAVIGATE / OPEN_OVERLAY / SCROLL_TO. */
    destinationId?: NodeId | null;
    url?: string;
    transition: { type: TransitionType; durationMs: number; direction?: TransitionDirection };
  };
}

// ── Nodes ────────────────────────────────────────────────────────────────────

export type NodeType =
  | 'FRAME'
  | 'GROUP'
  | 'SECTION'
  | 'RECTANGLE'
  | 'ELLIPSE'
  | 'POLYGON'
  | 'STAR'
  | 'LINE'
  | 'ARROW'
  | 'VECTOR'
  | 'TEXT'
  | 'IMAGE'
  | 'COMPONENT'
  | 'INSTANCE'
  | 'SLICE';

/** Fields shared by every node. */
export interface BaseNode {
  id: NodeId;
  type: NodeType;
  name: string;
  /** Parent node id, or the page id for top-level nodes. */
  parentId: NodeId | PageId;
  /** Ordered child ids (bottom → top paint order). Empty for leaves. */
  childIds: NodeId[];
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise, around the node center. */
  rotation: number;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  blendMode: BlendMode;
  fills: Paint[];
  strokes: Paint[];
  strokeWeight: number;
  strokeAlign: StrokeAlign;
  strokeCap: StrokeCap;
  strokeJoin: StrokeJoin;
  strokeDash: number[]; // [] = solid
  /** Uniform radius; per-corner overrides win when set. */
  cornerRadius: number;
  /** [topLeft, topRight, bottomRight, bottomLeft] or null for uniform. */
  cornerRadii: [number, number, number, number] | null;
  effects: Effect[];
  constraints: Constraints;
  /** Auto layout container config (meaningful on FRAME/COMPONENT/INSTANCE). */
  layout: AutoLayout;
  /** Participation in the parent's auto layout. */
  layoutPositioning: LayoutPositioning;
  layoutGrow: LayoutGrow;
  layoutAlignSelf: LayoutAlignSelf;
  /** Frames: clip content to bounds. */
  clipsContent: boolean;
  /** TEXT only. */
  characters: string;
  textStyle: TextStyleProps;
  /** POLYGON: point count; STAR: point count + innerRadius ratio. */
  pointCount: number;
  innerRadius: number; // 0..1, STAR only
  /** VECTOR only. */
  vectorPaths: VectorPath[];
  /** INSTANCE only: the COMPONENT node this instance mirrors. */
  componentId: ComponentId | null;
  /**
   * INSTANCE only: per-source-node overrides, keyed by the id of the node
   * inside the component's subtree.
   */
  overrides: Record<NodeId, NodeOverride> | null;
  /** Style links (design-system styles), null when detached. */
  fillStyleId: StyleId | null;
  textStyleId: StyleId | null;
  /** Prototype reactions authored on this node. */
  reactions: Reaction[];
  /** Export presets configured in the Design panel's Export section. */
  exportSettings: ExportSetting[];
}

export interface NodeOverride {
  fills?: Paint[];
  characters?: string;
  visible?: boolean;
  opacity?: number;
}

export type SceneNode = BaseNode;

export interface ExportSetting {
  format: 'PNG' | 'JPG' | 'SVG';
  /** Scale multiplier for raster formats (0.5, 1, 2, 3, 4). */
  scale: number;
  suffix: string;
}

// ── Styles (shared design-system styles) ────────────────────────────────────

export interface ColorStyle {
  id: StyleId;
  name: string; // supports "Group/Name" nesting
  paint: Paint;
}

export interface SharedTextStyle {
  id: StyleId;
  name: string;
  style: TextStyleProps;
}

// ── Pages & document ─────────────────────────────────────────────────────────

export interface FigPage {
  id: PageId;
  name: string;
  /** Top-level node ids (bottom → top). */
  childIds: NodeId[];
  backgroundColor: RGBA;
  /** Prototype start frame ("flow starting point"). */
  prototypeStartNodeId: NodeId | null;
}

export interface ComponentMeta {
  id: ComponentId; // == node id of the COMPONENT node
  name: string;
  description: string;
  pageId: PageId;
}

export interface FigDocument {
  schemaVersion: 1;
  id: FileId;
  name: string;
  pages: Record<PageId, FigPage>;
  pageOrder: PageId[];
  /** Flat node table for every page. */
  nodes: Record<NodeId, SceneNode>;
  components: Record<ComponentId, ComponentMeta>;
  styles: {
    colors: ColorStyle[];
    texts: SharedTextStyle[];
  };
  /** Content-hash → data URL for image fills. */
  images: Record<string, string>;
  /** Monotonic revision, bumped by the store on every committed change. */
  revision: number;
}

// ── File metadata (home screen, backend index) ───────────────────────────────

export interface FigFileMeta {
  id: FileId;
  name: string;
  /** PNG data URL rendered by the editor on save. */
  thumbnail: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// ── Comments ─────────────────────────────────────────────────────────────────

export interface CommentReply {
  id: string;
  author: string;
  authorColor: string;
  text: string;
  createdAt: string;
}

export interface FigComment {
  id: string;
  fileId: FileId;
  pageId: PageId;
  /** World-space anchor. */
  x: number;
  y: number;
  author: string;
  authorColor: string;
  text: string;
  replies: CommentReply[];
  resolved: boolean;
  createdAt: string;
}

// ── Version history ──────────────────────────────────────────────────────────

export interface FigVersionMeta {
  id: string;
  fileId: FileId;
  label: string;
  createdAt: string;
  author: string;
}

// ── Presence / realtime ──────────────────────────────────────────────────────

export interface PresenceUser {
  id: string;
  name: string;
  /** Hex color for cursor/avatar. */
  color: string;
}

export interface PeerState {
  user: PresenceUser;
  pageId: PageId | null;
  cursor: { x: number; y: number } | null; // world space
  selection: NodeId[];
}

/** Node-level LWW diff broadcast over the wire and merged into peers' docs. */
export interface DocOps {
  /** Full replacement nodes. */
  set?: Record<NodeId, SceneNode>;
  /** Deleted node ids. */
  del?: NodeId[];
  /** Replaced pages (child order lives here). */
  pages?: Record<PageId, FigPage>;
  delPages?: PageId[];
  pageOrder?: PageId[];
  name?: string;
  images?: Record<string, string>;
  components?: Record<ComponentId, ComponentMeta>;
  styles?: FigDocument['styles'];
  revision?: number;
}

export type ClientMessage =
  | { t: 'hello'; fileId: FileId; user: PresenceUser }
  | { t: 'cursor'; pageId: PageId; x: number; y: number }
  | { t: 'cursor-hide' }
  | { t: 'selection'; ids: NodeId[]; pageId: PageId }
  | { t: 'ops'; ops: DocOps }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'welcome'; selfId: string; peers: Array<{ peerId: string; state: PeerState }> }
  | { t: 'peer-join'; peerId: string; state: PeerState }
  | { t: 'peer-leave'; peerId: string }
  | { t: 'cursor'; peerId: string; pageId: PageId; x: number; y: number }
  | { t: 'cursor-hide'; peerId: string }
  | { t: 'selection'; peerId: string; ids: NodeId[]; pageId: PageId }
  | { t: 'ops'; peerId: string; ops: DocOps }
  | { t: 'pong' };

// ── Editor-side (non-persisted) types ────────────────────────────────────────

export type ToolType =
  | 'move'
  | 'hand'
  | 'scale'
  | 'frame'
  | 'section'
  | 'slice'
  | 'rectangle'
  | 'line'
  | 'arrow'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'image'
  | 'pen'
  | 'pencil'
  | 'text'
  | 'comment';

export interface Camera {
  /** World coords of the viewport's top-left corner... expressed as pan: screen = (world - x) * zoom. */
  x: number;
  y: number;
  zoom: number;
}

export type EditorMode = 'design' | 'prototype' | 'inspect';
export type LeftTab = 'file' | 'assets';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Vec2 {
  x: number;
  y: number;
}
