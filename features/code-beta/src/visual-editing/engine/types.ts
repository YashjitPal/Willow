// Visual Editor Types
// Defines interfaces for the visual editing feature

/**
 * Bounding rectangle for an element in the preview
 */
export interface ElementBounds {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Represents a selected or hovered element in the preview
 */
export interface SelectedElement {
  /** Unique identifier generated for this element */
  uid: string;
  /** HTML tag name (e.g., 'div', 'button', 'p') */
  tagName: string;
  /** CSS classes on the element */
  classNames: string[];
  /** Text content (first 100 chars) */
  textContent: string;
  /** Bounding rectangle relative to iframe */
  bounds: ElementBounds;
  /** CSS selector path to this element */
  selectorPath: string;
  /** Computed styles subset for sidebar display */
  computedStyles: {
    padding: string;
    margin: string;
    backgroundColor: string;
    color: string;
    fontSize: string;
    fontWeight: string;
    borderRadius: string;
  };
  /** Parent element info for breadcrumb display */
  parentPath: Array<{ tagName: string; className?: string }>;
  /** Whether this element has dynamic/inline styles that can't be directly edited */
  hasDynamicStyles?: boolean;
  /** Source location in the original file (fileName:line:column) */
  sourceLocation?: {
    fileName: string;
    line: number;
    column: number;
  } | null;
  /** ✨ NEW: Component file information if this is an imported component */
  componentFile?: {
    filePath: string;  // e.g., "./components/Button" or "@/components/Button"
    componentName: string;  // e.g., "Button", "Header"
  } | null;
  /** Group ID for elements selected in the same batch/action */
  selectionGroupId?: string;
  /** Index of this element among its family siblings (DOM order, 0-based) */
  familyIndex?: number;
  /** Total number of family members */
  familySize?: number;
  /**
   * If the selected element doesn't have direct text but a descendant does,
   * this contains info about that descendant so text styles can be applied to it.
   */
  textSourceElement?: {
    uid: string;
    tagName: string;
    classNames: string[];
    sourceLocation: {
      fileName: string;
      line: number;
      column: number;
    } | null;
  } | null;
}

/**
 * Lightweight representation of a family element (similar elements with dotted borders)
 * Used to send family context to AI for "edit all" vs "edit one" decisions
 */
export interface FamilyElement {
  /** Unique identifier */
  uid: string;
  /** HTML tag name */
  tagName: string;
  /** CSS classes */
  classNames: string[];
  /** Text content (for identifying elements in .map() loops) */
  textContent: string;
  /** Source location for precise code editing */
  sourceLocation: {
    fileName: string;
    line: number;
    column: number;
  } | null;
}

/**
 * State of the visual editor
 */
export interface VisualEditorState {
  /** Whether visual edit mode is active */
  isActive: boolean;
  /** Whether we're currently scanning/initializing */
  isScanning: boolean;
  /** Currently hovered element (for highlight box) */
  hoveredElement: SelectedElement | null;
  /** Currently selected element (for toolbar + sidebar) */
  selectedElement: SelectedElement | null;
  /** Whether the inspector script is loaded in iframe */
  inspectorReady: boolean;
}

/**
 * Message types sent from inspector script in iframe
 */
export type InspectorMessage =
  | { type: 'INSPECTOR_READY' }
  | { type: 'ELEMENT_HOVER'; element: SelectedElement | null }
  | { type: 'ELEMENT_SELECT'; element: SelectedElement }
  | { type: 'ELEMENT_DESELECT' }
  | { type: 'NO_PARENT_AVAILABLE' };

/**
 * Message types sent TO the inspector script
 */
export type EditorToInspectorMessage =
  | { type: 'INIT_INSPECTOR' }
  | { type: 'HIGHLIGHT_ELEMENT'; uid: string }
  | { type: 'CLEAR_HIGHLIGHT' };

/**
 * Quick action types for the floating toolbar
 */
export type QuickAction = 'delete' | 'duplicate' | 'hide' | 'edit-text';

/**
 * Style property categories for the sidebar
 */
export interface StyleCategory {
  name: string;
  properties: Array<{
    key: string;
    label: string;
    type: 'slider' | 'color' | 'select' | 'text';
    options?: string[]; // For select type
    min?: number; // For slider
    max?: number;
    unit?: string;
  }>;
}

/**
 * Tailwind class mapping for common styles
 */
export const TAILWIND_SPACING: Record<string, string> = {
  '0': '0',
  '0.5': '2',
  '1': '4',
  '1.5': '6',
  '2': '8',
  '2.5': '10',
  '3': '12',
  '3.5': '14',
  '4': '16',
  '5': '20',
  '6': '24',
  '7': '28',
  '8': '32',
  '9': '36',
  '10': '40',
  '11': '44',
  '12': '48',
  '14': '56',
  '16': '64',
  '20': '80',
  '24': '96',
};
