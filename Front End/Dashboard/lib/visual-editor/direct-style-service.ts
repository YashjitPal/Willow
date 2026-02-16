// Direct Style Service - Apply Tailwind classes instantly without AI
// This provides Lovable-like instant visual editing by directly manipulating className attributes

import { Project, SyntaxKind, Node, JsxAttribute, JsxExpression } from 'ts-morph';
import { sandpackStore } from '../sandpack/sandpack-store';
import { pushUndoState, clearSelection, requestInspectorReinit, previewRefreshRequest, pendingSelectionRestore, selectedElement, markAsUnsaved, requestSelectionBoundsRefresh } from './visual-editor-store';
import type { SelectedElement } from './types';

// Reuse singleton project from visual-edit-service
let singletonProject: Project | null = null;
const fileVersions = new Map<string, string>();

function getProject(): Project {
  if (!singletonProject) {
    singletonProject = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        jsx: 4,
        target: 99,
        module: 99,
      },
    });
  }
  return singletonProject;
}

function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(16);
}

function getSourceFile(fileName: string, code: string) {
  const project = getProject();
  const normalizedPath = fileName.startsWith('/') ? fileName : `/${fileName}`;
  const contentHash = hashCode(code);
  const existingHash = fileVersions.get(normalizedPath);

  let sourceFile = project.getSourceFile(normalizedPath);

  if (sourceFile && existingHash === contentHash) {
    return sourceFile;
  }

  // Always recreate the source file to ensure fresh AST parsing
  // replaceWithText can sometimes have stale references
  if (sourceFile) {
    project.removeSourceFile(sourceFile);
  }
  sourceFile = project.createSourceFile(normalizedPath, code, { overwrite: true });

  fileVersions.set(normalizedPath, contentHash);
  return sourceFile;
}

function lineColToOffset(code: string, line: number, column: number): number {
  const lines = code.split('\n');
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  offset += column;
  return offset;
}

// ============================================================================
// TAILWIND CLASS UTILITIES
// ============================================================================

// Spacing scale mapping
const SPACING_SCALE: Record<string, string> = {
  '0': '0', '1': '0.25rem', '2': '0.5rem', '3': '0.75rem', '4': '1rem',
  '5': '1.25rem', '6': '1.5rem', '7': '1.75rem', '8': '2rem', '9': '2.25rem',
  '10': '2.5rem', '11': '2.75rem', '12': '3rem', '14': '3.5rem', '16': '4rem',
  '20': '5rem', '24': '6rem', '28': '7rem', '32': '8rem', '36': '9rem',
  '40': '10rem', '44': '11rem', '48': '12rem', '52': '13rem', '56': '14rem',
  '60': '15rem', '64': '16rem', '72': '18rem', '80': '20rem', '96': '24rem',
};

// Valid Tailwind spacing keys for margin/padding
const TAILWIND_SPACING_KEYS = [
  '0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '14', '16', '20', '24', '28', '32', '36', '40', '44', '48', '52', '56',
  '60', '64', '72', '80', '96', 'px', 'auto'
];

// Reverse lookup: Pixel value → Tailwind spacing key
// e.g., "24" (24px) → "6" (p-6)
const PIXEL_TO_TAILWIND_KEY: Record<string, string> = {
  '0': '0',
  '2': '0.5',
  '4': '1',
  '6': '1.5',
  '8': '2',
  '10': '2.5',
  '12': '3',
  '14': '3.5',
  '16': '4',
  '20': '5',
  '24': '6',
  '28': '7',
  '32': '8',
  '36': '9',
  '40': '10',
  '44': '11',
  '48': '12',
  '56': '14',
  '64': '16',
  '80': '20',
  '96': '24',
};

// Parse px value to Tailwind spacing key
export function pxToSpacingKey(px: number): string {
  const remValue = px / 16;
  // Find closest match
  let closest = '0';
  let closestDiff = Infinity;

  for (const [key, value] of Object.entries(SPACING_SCALE)) {
    const rem = parseFloat(value);
    const diff = Math.abs(rem - remValue);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = key;
    }
  }
  return closest;
}

// Border radius options to Tailwind classes
export const BORDER_RADIUS_MAP: Record<string, string> = {
  'None': 'rounded-none',
  'Small': 'rounded-sm',
  'Default': 'rounded',
  'Medium': 'rounded-md',
  'Large': 'rounded-lg',
  'Extra Large': 'rounded-xl',
  '2XL': 'rounded-2xl',
  '3XL': 'rounded-3xl',
  'Full': 'rounded-full',
};

// Shadow options to Tailwind classes
export const SHADOW_MAP: Record<string, string> = {
  'None': 'shadow-none',
  'Small': 'shadow-sm',
  'Default': 'shadow',
  'Medium': 'shadow-md',
  'Large': 'shadow-lg',
  'Extra Large': 'shadow-xl',
  '2XL': 'shadow-2xl',
  'Inner shadow': 'shadow-inner',
};

// Opacity options to Tailwind classes
export const OPACITY_MAP: Record<string, string> = {
  '100%': 'opacity-100',
  '90%': 'opacity-90',
  '80%': 'opacity-80',
  '70%': 'opacity-70',
  '60%': 'opacity-60',
  '50%': 'opacity-50',
  '40%': 'opacity-40',
  '30%': 'opacity-30',
  '20%': 'opacity-20',
  '10%': 'opacity-10',
  '0%': 'opacity-0',
};

// Font size options
export const FONT_SIZE_MAP: Record<string, string> = {
  'Extra Small': 'text-xs',
  'Small': 'text-sm',
  'Base': 'text-base',
  'Large': 'text-lg',
  'Extra Large': 'text-xl',
  '2XL': 'text-2xl',
  '3XL': 'text-3xl',
  '4XL': 'text-4xl',
  '5XL': 'text-5xl',
};

// Font weight options
export const FONT_WEIGHT_MAP: Record<string, string> = {
  'Thin': 'font-thin',
  'Extra Light': 'font-extralight',
  'Light': 'font-light',
  'Normal': 'font-normal',
  'Medium': 'font-medium',
  'Semibold': 'font-semibold',
  'Bold': 'font-bold',
  'Extra Bold': 'font-extrabold',
  'Black': 'font-black',
};

// Text alignment options
export const TEXT_ALIGN_MAP: Record<string, string> = {
  'Left': 'text-left',
  'Center': 'text-center',
  'Right': 'text-right',
  'Justify': 'text-justify',
};

// Border width options
export const BORDER_WIDTH_MAP: Record<string, string> = {
  'None': 'border-0',
  '1px': 'border',
  '2px': 'border-2',
  '4px': 'border-4',
  '8px': 'border-8',
};

// Border style options
export const BORDER_STYLE_MAP: Record<string, string> = {
  'Solid': 'border-solid',
  'Dashed': 'border-dashed',
  'Dotted': 'border-dotted',
  'Double': 'border-double',
  'None': 'border-none',
};

// ============================================================================
// TAILWIND COLOR TO CSS MAPPING (for preview updates)
// ============================================================================

// Common Tailwind colors mapped to their CSS hex values
export const TAILWIND_COLOR_MAP: Record<string, string> = {
  // Special values
  'transparent': 'transparent',
  'current': 'currentColor',
  'inherit': 'inherit',
  'white': '#ffffff',
  'black': '#000000',

  // Slate
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0', 'slate-300': '#cbd5e1',
  'slate-400': '#94a3b8', 'slate-500': '#64748b', 'slate-600': '#475569', 'slate-700': '#334155',
  'slate-800': '#1e293b', 'slate-900': '#0f172a', 'slate-950': '#020617',

  // Gray
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb', 'gray-300': '#d1d5db',
  'gray-400': '#9ca3af', 'gray-500': '#6b7280', 'gray-600': '#4b5563', 'gray-700': '#374151',
  'gray-800': '#1f2937', 'gray-900': '#111827', 'gray-950': '#030712',

  // Zinc
  'zinc-50': '#fafafa', 'zinc-100': '#f4f4f5', 'zinc-200': '#e4e4e7', 'zinc-300': '#d4d4d8',
  'zinc-400': '#a1a1aa', 'zinc-500': '#71717a', 'zinc-600': '#52525b', 'zinc-700': '#3f3f46',
  'zinc-800': '#27272a', 'zinc-900': '#18181b', 'zinc-950': '#09090b',

  // Neutral
  'neutral-50': '#fafafa', 'neutral-100': '#f5f5f5', 'neutral-200': '#e5e5e5', 'neutral-300': '#d4d4d4',
  'neutral-400': '#a3a3a3', 'neutral-500': '#737373', 'neutral-600': '#525252', 'neutral-700': '#404040',
  'neutral-800': '#262626', 'neutral-900': '#171717', 'neutral-950': '#0a0a0a',

  // Stone
  'stone-50': '#fafaf9', 'stone-100': '#f5f5f4', 'stone-200': '#e7e5e4', 'stone-300': '#d6d3d1',
  'stone-400': '#a8a29e', 'stone-500': '#78716c', 'stone-600': '#57534e', 'stone-700': '#44403c',
  'stone-800': '#292524', 'stone-900': '#1c1917', 'stone-950': '#0c0a09',

  // Red
  'red-50': '#fef2f2', 'red-100': '#fee2e2', 'red-200': '#fecaca', 'red-300': '#fca5a5',
  'red-400': '#f87171', 'red-500': '#ef4444', 'red-600': '#dc2626', 'red-700': '#b91c1c',
  'red-800': '#991b1b', 'red-900': '#7f1d1d', 'red-950': '#450a0a',

  // Orange
  'orange-50': '#fff7ed', 'orange-100': '#ffedd5', 'orange-200': '#fed7aa', 'orange-300': '#fdba74',
  'orange-400': '#fb923c', 'orange-500': '#f97316', 'orange-600': '#ea580c', 'orange-700': '#c2410c',
  'orange-800': '#9a3412', 'orange-900': '#7c2d12', 'orange-950': '#431407',

  // Amber
  'amber-50': '#fffbeb', 'amber-100': '#fef3c7', 'amber-200': '#fde68a', 'amber-300': '#fcd34d',
  'amber-400': '#fbbf24', 'amber-500': '#f59e0b', 'amber-600': '#d97706', 'amber-700': '#b45309',
  'amber-800': '#92400e', 'amber-900': '#78350f', 'amber-950': '#451a03',

  // Yellow
  'yellow-50': '#fefce8', 'yellow-100': '#fef9c3', 'yellow-200': '#fef08a', 'yellow-300': '#fde047',
  'yellow-400': '#facc15', 'yellow-500': '#eab308', 'yellow-600': '#ca8a04', 'yellow-700': '#a16207',
  'yellow-800': '#854d0e', 'yellow-900': '#713f12', 'yellow-950': '#422006',

  // Lime
  'lime-50': '#f7fee7', 'lime-100': '#ecfccb', 'lime-200': '#d9f99d', 'lime-300': '#bef264',
  'lime-400': '#a3e635', 'lime-500': '#84cc16', 'lime-600': '#65a30d', 'lime-700': '#4d7c0f',
  'lime-800': '#3f6212', 'lime-900': '#365314', 'lime-950': '#1a2e05',

  // Green
  'green-50': '#f0fdf4', 'green-100': '#dcfce7', 'green-200': '#bbf7d0', 'green-300': '#86efac',
  'green-400': '#4ade80', 'green-500': '#22c55e', 'green-600': '#16a34a', 'green-700': '#15803d',
  'green-800': '#166534', 'green-900': '#14532d', 'green-950': '#052e16',

  // Emerald
  'emerald-50': '#ecfdf5', 'emerald-100': '#d1fae5', 'emerald-200': '#a7f3d0', 'emerald-300': '#6ee7b7',
  'emerald-400': '#34d399', 'emerald-500': '#10b981', 'emerald-600': '#059669', 'emerald-700': '#047857',
  'emerald-800': '#065f46', 'emerald-900': '#064e3b', 'emerald-950': '#022c22',

  // Teal
  'teal-50': '#f0fdfa', 'teal-100': '#ccfbf1', 'teal-200': '#99f6e4', 'teal-300': '#5eead4',
  'teal-400': '#2dd4bf', 'teal-500': '#14b8a6', 'teal-600': '#0d9488', 'teal-700': '#0f766e',
  'teal-800': '#115e59', 'teal-900': '#134e4a', 'teal-950': '#042f2e',

  // Cyan
  'cyan-50': '#ecfeff', 'cyan-100': '#cffafe', 'cyan-200': '#a5f3fc', 'cyan-300': '#67e8f9',
  'cyan-400': '#22d3ee', 'cyan-500': '#06b6d4', 'cyan-600': '#0891b2', 'cyan-700': '#0e7490',
  'cyan-800': '#155e75', 'cyan-900': '#164e63', 'cyan-950': '#083344',

  // Sky
  'sky-50': '#f0f9ff', 'sky-100': '#e0f2fe', 'sky-200': '#bae6fd', 'sky-300': '#7dd3fc',
  'sky-400': '#38bdf8', 'sky-500': '#0ea5e9', 'sky-600': '#0284c7', 'sky-700': '#0369a1',
  'sky-800': '#075985', 'sky-900': '#0c4a6e', 'sky-950': '#082f49',

  // Blue
  'blue-50': '#eff6ff', 'blue-100': '#dbeafe', 'blue-200': '#bfdbfe', 'blue-300': '#93c5fd',
  'blue-400': '#60a5fa', 'blue-500': '#3b82f6', 'blue-600': '#2563eb', 'blue-700': '#1d4ed8',
  'blue-800': '#1e40af', 'blue-900': '#1e3a8a', 'blue-950': '#172554',

  // Indigo
  'indigo-50': '#eef2ff', 'indigo-100': '#e0e7ff', 'indigo-200': '#c7d2fe', 'indigo-300': '#a5b4fc',
  'indigo-400': '#818cf8', 'indigo-500': '#6366f1', 'indigo-600': '#4f46e5', 'indigo-700': '#4338ca',
  'indigo-800': '#3730a3', 'indigo-900': '#312e81', 'indigo-950': '#1e1b4b',

  // Violet
  'violet-50': '#f5f3ff', 'violet-100': '#ede9fe', 'violet-200': '#ddd6fe', 'violet-300': '#c4b5fd',
  'violet-400': '#a78bfa', 'violet-500': '#8b5cf6', 'violet-600': '#7c3aed', 'violet-700': '#6d28d9',
  'violet-800': '#5b21b6', 'violet-900': '#4c1d95', 'violet-950': '#2e1065',

  // Purple
  'purple-50': '#faf5ff', 'purple-100': '#f3e8ff', 'purple-200': '#e9d5ff', 'purple-300': '#d8b4fe',
  'purple-400': '#c084fc', 'purple-500': '#a855f7', 'purple-600': '#9333ea', 'purple-700': '#7e22ce',
  'purple-800': '#6b21a8', 'purple-900': '#581c87', 'purple-950': '#3b0764',

  // Fuchsia
  'fuchsia-50': '#fdf4ff', 'fuchsia-100': '#fae8ff', 'fuchsia-200': '#f5d0fe', 'fuchsia-300': '#f0abfc',
  'fuchsia-400': '#e879f9', 'fuchsia-500': '#d946ef', 'fuchsia-600': '#c026d3', 'fuchsia-700': '#a21caf',
  'fuchsia-800': '#86198f', 'fuchsia-900': '#701a75', 'fuchsia-950': '#4a044e',

  // Pink
  'pink-50': '#fdf2f8', 'pink-100': '#fce7f3', 'pink-200': '#fbcfe8', 'pink-300': '#f9a8d4',
  'pink-400': '#f472b6', 'pink-500': '#ec4899', 'pink-600': '#db2777', 'pink-700': '#be185d',
  'pink-800': '#9d174d', 'pink-900': '#831843', 'pink-950': '#500724',

  // Rose
  'rose-50': '#fff1f2', 'rose-100': '#ffe4e6', 'rose-200': '#fecdd3', 'rose-300': '#fda4af',
  'rose-400': '#fb7185', 'rose-500': '#f43f5e', 'rose-600': '#e11d48', 'rose-700': '#be123c',
  'rose-800': '#9f1239', 'rose-900': '#881337', 'rose-950': '#4c0519',
};

/**
 * Convert a Tailwind color name to its CSS color value
 * E.g., 'red-500' -> '#ef4444', '#ff0000' -> '#ff0000'
 */
export function tailwindColorToCss(colorValue: string): string {
  if (!colorValue) return '';

  // Already a hex color
  if (colorValue.startsWith('#')) return colorValue;

  // Arbitrary value [#xxx]
  if (colorValue.startsWith('[') && colorValue.endsWith(']')) {
    return colorValue.slice(1, -1);
  }

  // Look up in Tailwind color map
  return TAILWIND_COLOR_MAP[colorValue] || '';
}

// ============================================================================
// CLASS MANIPULATION
// ============================================================================

type StyleCategory =
  | 'textColor' | 'bgColor' | 'borderColor'
  | 'marginX' | 'marginY' | 'marginTop' | 'marginRight' | 'marginBottom' | 'marginLeft'
  | 'paddingX' | 'paddingY' | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft'
  | 'borderRadius' | 'shadow' | 'opacity'
  | 'fontSize' | 'fontWeight' | 'textAlign'
  | 'borderWidth' | 'borderStyle';

// Patterns to match existing classes by category
const CLASS_PATTERNS: Record<StyleCategory, RegExp> = {
  textColor: /^text-(?!xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|left|center|right|justify)/,
  // bgColor should NOT match: bg-clip-, bg-gradient-, bg-opacity-, bg-blend-, bg-origin-, bg-repeat-, bg-size-, bg-position-, bg-attachment-, bg-none
  bgColor: /^bg-(?!clip|gradient|opacity|blend|origin|repeat|size|position|attachment|none|scroll|fixed|local|cover|contain|center|top|bottom|left|right)/,
  // borderColor should NOT match: border widths, styles, direction shorthands (t/r/b/l/x/y followed by - or end), collapse, separate
  // The direction pattern (?![trblxy](?:-|$)) ensures we don't match border-t, border-t-2, etc. but DO match border-teal-500, border-red-500
  borderColor: /^border-(?![trblxy](?:-|$))(?!0$|2$|4$|8$|solid|dashed|dotted|double|none|hidden|collapse|separate|spacing)/,
  marginX: /^mx-/,
  marginY: /^my-/,
  marginTop: /^mt-/,
  marginRight: /^mr-/,
  marginBottom: /^mb-/,
  marginLeft: /^ml-/,
  paddingX: /^px-/,
  paddingY: /^py-/,
  paddingTop: /^pt-/,
  paddingRight: /^pr-/,
  paddingBottom: /^pb-/,
  paddingLeft: /^pl-/,
  borderRadius: /^rounded/,
  shadow: /^shadow(-sm|-md|-lg|-xl|-2xl|-inner|-none)?$/,  // Match shadow utility classes only
  opacity: /^opacity-/,
  fontSize: /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/,
  fontWeight: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
  textAlign: /^text-(left|center|right|justify)$/,
  borderWidth: /^border(-[0248])?$/,
  borderStyle: /^border-(solid|dashed|dotted|double|none)$/,
};

/**
 * Remove classes matching a pattern and add a new class
 */
function replaceClass(classes: string[], category: StyleCategory, newClass: string): string[] {
  const pattern = CLASS_PATTERNS[category];
  const filtered = classes.filter(c => !pattern.test(c));

  // Don't add if it's a "none" or default removal class
  if (newClass && newClass !== 'rounded-none' && newClass !== 'shadow-none' && newClass !== 'opacity-100' && newClass !== 'border-0') {
    filtered.push(newClass);
  } else if (newClass === 'rounded-none' || newClass === 'shadow-none' || newClass === 'border-0') {
    // These are explicit removals, still add them
    filtered.push(newClass);
  }

  return filtered;
}

/**
 * Parse className string into array
 */
function parseClasses(className: string): string[] {
  return className.split(/\s+/).filter(c => c.length > 0);
}

/**
 * Join classes back into string
 */
function joinClasses(classes: string[]): string {
  return classes.join(' ');
}

// ============================================================================
// AST MANIPULATION
// ============================================================================

interface ClassNameInfo {
  node: JsxAttribute | null;
  currentValue: string;
  isExpression: boolean;
  expressionPrefix?: string; // For cn(), clsx(), etc.
}

/**
 * Find the className attribute on a JSX element
 */
function findClassNameAttribute(element: Node): ClassNameInfo | null {
  let attributes: Node[] = [];

  const kind = element.getKind();
  if (kind === SyntaxKind.JsxElement) {
    const jsxEl = element.asKind(SyntaxKind.JsxElement);
    if (jsxEl) {
      attributes = jsxEl.getOpeningElement().getAttributes();
    }
  } else if (kind === SyntaxKind.JsxSelfClosingElement) {
    const selfClosing = element.asKind(SyntaxKind.JsxSelfClosingElement);
    if (selfClosing) {
      attributes = selfClosing.getAttributes();
    }
  }

  for (const attr of attributes) {
    if (attr.getKind() === SyntaxKind.JsxAttribute) {
      const jsxAttr = attr.asKind(SyntaxKind.JsxAttribute);
      if (jsxAttr) {
        const name = jsxAttr.getNameNode().getText();
        if (name === 'className' || name === 'class') {
          const initializer = jsxAttr.getInitializer();

          if (!initializer) {
            return { node: jsxAttr, currentValue: '', isExpression: false };
          }

          // String literal: className="foo bar"
          if (initializer.getKind() === SyntaxKind.StringLiteral) {
            const text = initializer.getText();
            // Remove quotes
            const value = text.slice(1, -1);
            return { node: jsxAttr, currentValue: value, isExpression: false };
          }

          // Expression: className={...}
          if (initializer.getKind() === SyntaxKind.JsxExpression) {
            const expr = initializer.asKind(SyntaxKind.JsxExpression);
            if (expr) {
              const exprText = expr.getExpression()?.getText() || '';

              // Check for cn(), clsx(), classNames() patterns
              const cnMatch = exprText.match(/^(cn|clsx|classNames)\s*\(\s*["'`]([^"'`]*)["'`]/);
              if (cnMatch) {
                return {
                  node: jsxAttr,
                  currentValue: cnMatch[2],
                  isExpression: true,
                  expressionPrefix: cnMatch[1]
                };
              }

              // Template literal: className={`${base} extra`}
              if (exprText.startsWith('`')) {
                // Extract static parts
                const staticMatch = exprText.match(/`([^$`]*)/);
                if (staticMatch) {
                  return { node: jsxAttr, currentValue: staticMatch[1], isExpression: true };
                }
              }

              // Simple string in expression
              const simpleMatch = exprText.match(/^["'`]([^"'`]*)["'`]$/);
              if (simpleMatch) {
                return { node: jsxAttr, currentValue: simpleMatch[1], isExpression: false };
              }

              // Complex expression - return as-is, mark as expression
              return { node: jsxAttr, currentValue: exprText, isExpression: true };
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Find JSX element at source location
 */
function findJsxElementAtLocation(code: string, fileName: string, line: number, column: number): Node | null {
  const sourceFile = getSourceFile(fileName, code);
  const cursorOffset = lineColToOffset(code, line, column);
  const node = sourceFile.getDescendantAtPos(cursorOffset);

  if (!node) return null;

  // Walk up to find JSX element
  let current: Node | undefined = node;
  while (current) {
    const kind = current.getKind();
    if (kind === SyntaxKind.JsxElement || kind === SyntaxKind.JsxSelfClosingElement) {
      return current;
    }
    current = current.getParent();
  }

  return null;
}

// ============================================================================
// PUBLIC API
// ============================================================================

export interface DirectStyleResult {
  success: boolean;
  error?: string;
}

export type StyleProperty =
  | { type: 'textColor'; value: string }  // Tailwind color class like 'red-500' or hex
  | { type: 'bgColor'; value: string }
  | { type: 'borderColor'; value: string }
  | { type: 'marginX'; value: string }  // Spacing key like '4' or px value
  | { type: 'marginY'; value: string }
  | { type: 'marginTop'; value: string }
  | { type: 'marginRight'; value: string }
  | { type: 'marginBottom'; value: string }
  | { type: 'marginLeft'; value: string }
  | { type: 'paddingX'; value: string }
  | { type: 'paddingY'; value: string }
  | { type: 'paddingTop'; value: string }
  | { type: 'paddingRight'; value: string }
  | { type: 'paddingBottom'; value: string }
  | { type: 'paddingLeft'; value: string }
  | { type: 'borderRadius'; value: string }  // Option label like 'Large'
  | { type: 'shadow'; value: string }
  | { type: 'opacity'; value: string }
  | { type: 'fontSize'; value: string }
  | { type: 'fontWeight'; value: string }
  | { type: 'textAlign'; value: string }
  | { type: 'borderWidth'; value: string }
  | { type: 'borderStyle'; value: string };

/**
 * Convert a style property to its Tailwind class
 */
function styleToTailwindClass(style: StyleProperty): string {
  switch (style.type) {
    case 'textColor':
      // If it's a hex color, use arbitrary value
      if (style.value.startsWith('#')) {
        return `text-[${style.value}]`;
      }
      // If it's a CSS variable (hsl(var(...)))
      if (style.value.includes('var(')) {
        return `text-[${style.value.replace(/\s/g, '_')}]`;
      }
      // Otherwise it's a Tailwind color name like 'red-500', 'black', 'white', 'transparent'
      return `text-${style.value}`;

    case 'bgColor':
      if (style.value.startsWith('#')) {
        return `bg-[${style.value}]`;
      }
      if (style.value.includes('var(')) {
        return `bg-[${style.value.replace(/\s/g, '_')}]`;
      }
      return `bg-${style.value}`;

    case 'borderColor':
      if (style.value.startsWith('#')) {
        return `border-[${style.value}]`;
      }
      if (style.value.includes('var(')) {
        return `border-[${style.value.replace(/\s/g, '_')}]`;
      }
      return `border-${style.value}`;

    case 'marginX': {
      // Convert pixel value to Tailwind key, or use arbitrary value
      const key = PIXEL_TO_TAILWIND_KEY[style.value];
      if (key) return `mx-${key}`;
      return `mx-[${style.value}px]`;
    }
    case 'marginY': {
      const key = PIXEL_TO_TAILWIND_KEY[style.value];
      if (key) return `my-${key}`;
      return `my-[${style.value}px]`;
    }
    case 'marginTop': {
      const key = PIXEL_TO_TAILWIND_KEY[style.value];
      if (key) return `mt-${key}`;
      return `mt-[${style.value}px]`;
    }
    case 'marginRight': {
      const key = PIXEL_TO_TAILWIND_KEY[style.value];
      if (key) return `mr-${key}`;
      return `mr-[${style.value}px]`;
    }
    case 'marginBottom': {
      const key = PIXEL_TO_TAILWIND_KEY[style.value];
      if (key) return `mb-${key}`;
      return `mb-[${style.value}px]`;
    }
    case 'marginLeft': {
      const key = PIXEL_TO_TAILWIND_KEY[style.value];
      if (key) return `ml-${key}`;
      return `ml-[${style.value}px]`;
    }

    case 'paddingX': {
      const key = PIXEL_TO_TAILWIND_KEY[style.value];
      if (key) return `px-${key}`;
      return `px-[${style.value}px]`;
    }
    case 'paddingY': {
      const key = PIXEL_TO_TAILWIND_KEY[style.value];
      if (key) return `py-${key}`;
      return `py-[${style.value}px]`;
    }
    case 'paddingTop': {
      const key = PIXEL_TO_TAILWIND_KEY[style.value];
      if (key) return `pt-${key}`;
      return `pt-[${style.value}px]`;
    }
    case 'paddingRight': {
      const key = PIXEL_TO_TAILWIND_KEY[style.value];
      if (key) return `pr-${key}`;
      return `pr-[${style.value}px]`;
    }
    case 'paddingBottom': {
      const key = PIXEL_TO_TAILWIND_KEY[style.value];
      if (key) return `pb-${key}`;
      return `pb-[${style.value}px]`;
    }
    case 'paddingLeft': {
      const key = PIXEL_TO_TAILWIND_KEY[style.value];
      if (key) return `pl-${key}`;
      return `pl-[${style.value}px]`;
    }

    case 'borderRadius':
      return BORDER_RADIUS_MAP[style.value] || 'rounded';
    case 'shadow':
      return SHADOW_MAP[style.value] || 'shadow';
    case 'opacity':
      return OPACITY_MAP[style.value] || 'opacity-100';
    case 'fontSize':
      return FONT_SIZE_MAP[style.value] || 'text-base';
    case 'fontWeight':
      return FONT_WEIGHT_MAP[style.value] || 'font-normal';
    case 'textAlign':
      return TEXT_ALIGN_MAP[style.value] || 'text-left';
    case 'borderWidth':
      return BORDER_WIDTH_MAP[style.value] || 'border';
    case 'borderStyle':
      return BORDER_STYLE_MAP[style.value] || 'border-solid';

    default:
      return '';
  }
}

/**
 * Apply a style change directly to an element's className
 * This is instant - no AI involved
 */
export async function applyDirectStyle(
  element: SelectedElement,
  style: StyleProperty
): Promise<DirectStyleResult> {
  if (!element.sourceLocation) {
    return { success: false, error: 'No source location available' };
  }

  const { fileName, line, column } = element.sourceLocation;

  try {
    // Normalize the file path - try multiple formats
    // The babel plugin may use different path formats than sandpackStore
    const pathVariants = [
      '/' + fileName,                                    // /App.tsx or /src/App.tsx
      fileName,                                           // App.tsx or src/App.tsx
      fileName.replace(/^src\//, '/'),                   // src/App.tsx -> /App.tsx
      '/' + fileName.replace(/^src\//, ''),              // src/App.tsx -> /App.tsx
      '/src/' + fileName.replace(/^\/?(src\/)?/, ''),    // Try with src prefix
    ];

    let fileContent: string | undefined;
    let targetFile = '';

    for (const path of pathVariants) {
      fileContent = sandpackStore.getFile(path);
      if (fileContent) {
        targetFile = path;
        break;
      }
    }

    // Fallback to App.tsx if not found
    if (!fileContent) {
      fileContent = sandpackStore.getFile('/App.tsx');
      targetFile = '/App.tsx';
    }

    if (!fileContent) {
      return { success: false, error: `File not found: ${fileName}` };
    }

    // Find the JSX element
    const jsxElement = findJsxElementAtLocation(fileContent, fileName, line, column);
    if (!jsxElement) {
      return { success: false, error: 'Could not find element in code' };
    }

    // Find or create className attribute
    const classInfo = findClassNameAttribute(jsxElement);
    const newTailwindClass = styleToTailwindClass(style);

    if (!newTailwindClass) {
      return { success: false, error: 'Invalid style value' };
    }

    let newClassName: string;
    let newFileContent: string;

    if (classInfo && classInfo.node) {
      // Has existing className
      if (classInfo.isExpression && classInfo.expressionPrefix) {
        // Complex expression like cn("base classes", condition && "more")
        // For now, just add our class to the first string argument
        const currentClasses = parseClasses(classInfo.currentValue);
        const updatedClasses = replaceClass(currentClasses, style.type as StyleCategory, newTailwindClass);
        newClassName = joinClasses(updatedClasses);

        // Replace in the expression
        const attrText = classInfo.node.getText();
        const oldClassString = `"${classInfo.currentValue}"`;
        const newClassString = `"${newClassName}"`;
        const newAttrText = attrText.replace(oldClassString, newClassString);

        const attrStart = classInfo.node.getStart();
        const attrEnd = classInfo.node.getEnd();
        newFileContent = fileContent.substring(0, attrStart) + newAttrText + fileContent.substring(attrEnd);

      } else {
        // Simple className="classes"
        const currentClasses = parseClasses(classInfo.currentValue);
        const updatedClasses = replaceClass(currentClasses, style.type as StyleCategory, newTailwindClass);
        newClassName = joinClasses(updatedClasses);

        // Build new attribute
        const newAttrText = `className="${newClassName}"`;

        const attrStart = classInfo.node.getStart();
        const attrEnd = classInfo.node.getEnd();
        newFileContent = fileContent.substring(0, attrStart) + newAttrText + fileContent.substring(attrEnd);
      }
    } else {
      // No className - need to add one
      newClassName = newTailwindClass;

      // Find where to insert the className attribute
      const kind = jsxElement.getKind();
      let insertPosition: number;

      if (kind === SyntaxKind.JsxElement) {
        const jsxEl = jsxElement.asKind(SyntaxKind.JsxElement);
        if (jsxEl) {
          const opening = jsxEl.getOpeningElement();
          const tagName = opening.getTagNameNode();
          insertPosition = tagName.getEnd();
        } else {
          return { success: false, error: 'Could not parse JSX element' };
        }
      } else if (kind === SyntaxKind.JsxSelfClosingElement) {
        const selfClosing = jsxElement.asKind(SyntaxKind.JsxSelfClosingElement);
        if (selfClosing) {
          const tagName = selfClosing.getTagNameNode();
          insertPosition = tagName.getEnd();
        } else {
          return { success: false, error: 'Could not parse JSX element' };
        }
      } else {
        return { success: false, error: 'Unsupported element type' };
      }

      const newAttrText = ` className="${newClassName}"`;
      newFileContent = fileContent.substring(0, insertPosition) + newAttrText + fileContent.substring(insertPosition);
    }

    // Push undo state before applying
    pushUndoState(`Style: ${style.type}`);

    // Mark as unsaved changes (UI will show styling dirty state)
    markAsUnsaved();

    // Store the current selection's sourceLocation and additional info for restoration after refresh
    // Include textContent and classNames to disambiguate when multiple elements share same sourceLocation
    const currentSelection = selectedElement.get();
    if (currentSelection?.sourceLocation) {
      pendingSelectionRestore.set({
        ...currentSelection.sourceLocation,
        textContent: currentSelection.textContent?.substring(0, 100),
        classNames: currentSelection.classNames,
      });
    }

    // Apply the change to source file
    sandpackStore.setFile(targetFile, newFileContent);

    // Trigger preview refresh to rebuild with new classes
    previewRefreshRequest.set(Date.now());

    // Wait briefly for rebuild to start
    await new Promise(resolve => setTimeout(resolve, 50));

    // Reinit inspector to keep element tracking working
    requestInspectorReinit();

    return { success: true };

  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Apply multiple style changes at once
 */
export async function applyDirectStyles(
  element: SelectedElement,
  styles: StyleProperty[]
): Promise<DirectStyleResult> {
  // For multiple styles, we apply them sequentially
  // Each one modifies the file, so we need fresh content each time
  for (const style of styles) {
    const result = await applyDirectStyle(element, style);
    if (!result.success) {
      return result;
    }
  }
  return { success: true };
}

/**
 * Read the current className from the source file for an element
 * This is used to get fresh class names after a style change, since element.classNames
 * holds a stale snapshot from the time of selection.
 */
export function getFreshClassNames(element: SelectedElement): string[] | null {
  if (!element.sourceLocation) return null;

  const { fileName, line, column } = element.sourceLocation;
  const pathVariants = [
    '/' + fileName,
    fileName,
    fileName.replace(/^src\//, '/'),
    '/' + fileName.replace(/^src\//, ''),
    '/src/' + fileName.replace(/^\/?(src\/)?/, ''),
  ];

  let fileContent: string | undefined;
  for (const path of pathVariants) {
    fileContent = sandpackStore.getFile(path);
    if (fileContent) break;
  }

  if (!fileContent) {
    fileContent = sandpackStore.getFile('/App.tsx');
  }

  if (!fileContent) return null;

  const jsxElement = findJsxElementAtLocation(fileContent, fileName, line, column);
  if (!jsxElement) return null;

  const classInfo = findClassNameAttribute(jsxElement);
  if (!classInfo || !classInfo.currentValue) return null;

  return classInfo.currentValue.split(/\s+/).filter(Boolean);
}

/**
 * Get current style values from element's computed styles and classes
 */
export function getCurrentStyles(element: SelectedElement): Record<string, string> {
  const result: Record<string, string> = {};
  // Try to read fresh class names from source; fall back to snapshot
  const classes = getFreshClassNames(element) || element.classNames;

  // Extract current values from class names
  for (const cls of classes) {
    // Text color - match text-{color} but not text-{size} or text-{align}
    // Patterns: text-red-500, text-[#fff], text-primary, text-white, text-black, text-transparent
    if (cls.startsWith('text-')) {
      const value = cls.replace('text-', '');
      // Skip font sizes and text alignments
      const fontSizes = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];
      const alignments = ['left', 'center', 'right', 'justify'];
      if (!fontSizes.includes(value) && !alignments.includes(value)) {
        result.textColor = value;
        result.textColorClass = cls; // Store full class for display
      }
    }

    // Background color - match bg-{color}
    // Patterns: bg-red-500, bg-[#fff], bg-primary, bg-white, bg-black, bg-transparent
    if (cls.startsWith('bg-') && !cls.startsWith('bg-gradient') && !cls.startsWith('bg-clip') && !cls.startsWith('bg-opacity')) {
      const value = cls.replace('bg-', '');
      result.bgColor = value;
      result.bgColorClass = cls;
    }

    // Border color - match border-{color} but not border-{width} or border-{style}
    if (cls.startsWith('border-')) {
      const value = cls.replace('border-', '');
      // Skip widths and styles
      const widths = ['0', '2', '4', '8'];
      const styles = ['solid', 'dashed', 'dotted', 'double', 'none', 't', 'r', 'b', 'l', 'x', 'y'];
      if (!widths.includes(value) && !styles.includes(value) && !cls.match(/^border-[trblxy]-/)) {
        result.borderColor = value;
        result.borderColorClass = cls;
      }
    }

    // Margin - check for shorthand m- first, then directional classes
    // m-4 sets all margins, mx- sets left+right, my- sets top+bottom
    if (cls.match(/^m-[0-9\[\]\.]+/) && !cls.startsWith('mx-') && !cls.startsWith('my-') && !cls.startsWith('mt-') && !cls.startsWith('mr-') && !cls.startsWith('mb-') && !cls.startsWith('ml-')) {
      const value = cls.replace('m-', '');
      // Shorthand sets all margins
      result.marginX = value;
      result.marginY = value;
      result.marginTop = value;
      result.marginRight = value;
      result.marginBottom = value;
      result.marginLeft = value;
    }
    if (cls.startsWith('mx-')) result.marginX = cls.replace('mx-', '');
    if (cls.startsWith('my-')) result.marginY = cls.replace('my-', '');
    if (cls.startsWith('mt-')) result.marginTop = cls.replace('mt-', '');
    if (cls.startsWith('mr-')) result.marginRight = cls.replace('mr-', '');
    if (cls.startsWith('mb-')) result.marginBottom = cls.replace('mb-', '');
    if (cls.startsWith('ml-')) result.marginLeft = cls.replace('ml-', '');

    // Padding - check for shorthand p- first, then directional classes
    if (cls.match(/^p-[0-9\[\]\.]+/) && !cls.startsWith('px-') && !cls.startsWith('py-') && !cls.startsWith('pt-') && !cls.startsWith('pr-') && !cls.startsWith('pb-') && !cls.startsWith('pl-')) {
      const value = cls.replace('p-', '');
      result.paddingX = value;
      result.paddingY = value;
      result.paddingTop = value;
      result.paddingRight = value;
      result.paddingBottom = value;
      result.paddingLeft = value;
    }
    if (cls.startsWith('px-')) result.paddingX = cls.replace('px-', '');
    if (cls.startsWith('py-')) result.paddingY = cls.replace('py-', '');
    if (cls.startsWith('pt-')) result.paddingTop = cls.replace('pt-', '');
    if (cls.startsWith('pr-')) result.paddingRight = cls.replace('pr-', '');
    if (cls.startsWith('pb-')) result.paddingBottom = cls.replace('pb-', '');
    if (cls.startsWith('pl-')) result.paddingLeft = cls.replace('pl-', '');

    // Border radius
    for (const [label, twClass] of Object.entries(BORDER_RADIUS_MAP)) {
      if (cls === twClass) result.borderRadius = label;
    }

    // Shadow
    for (const [label, twClass] of Object.entries(SHADOW_MAP)) {
      if (cls === twClass) result.shadow = label;
    }

    // Opacity
    for (const [label, twClass] of Object.entries(OPACITY_MAP)) {
      if (cls === twClass) result.opacity = label;
    }

    // Font size
    for (const [label, twClass] of Object.entries(FONT_SIZE_MAP)) {
      if (cls === twClass) result.fontSize = label;
    }

    // Font weight
    for (const [label, twClass] of Object.entries(FONT_WEIGHT_MAP)) {
      if (cls === twClass) result.fontWeight = label;
    }

    // Text align
    for (const [label, twClass] of Object.entries(TEXT_ALIGN_MAP)) {
      if (cls === twClass) result.textAlign = label;
    }

    // Border width
    for (const [label, twClass] of Object.entries(BORDER_WIDTH_MAP)) {
      if (cls === twClass) result.borderWidth = label;
    }

    // Border style
    for (const [label, twClass] of Object.entries(BORDER_STYLE_MAP)) {
      if (cls === twClass) result.borderStyle = label;
    }
  }

  // Also include computed styles for display
  if (element.computedStyles) {
    result._computedPadding = element.computedStyles.padding;
    result._computedMargin = element.computedStyles.margin;
    result._computedBgColor = element.computedStyles.backgroundColor;
    result._computedColor = element.computedStyles.color;
    result._computedFontSize = element.computedStyles.fontSize;
    result._computedFontWeight = element.computedStyles.fontWeight;
    result._computedBorderRadius = element.computedStyles.borderRadius;
  }

  return result;
}

/**
 * Format a color value for display
 * E.g., 'red-500' -> 'Red 500', '[#ef4444]' -> '#ef4444', 'primary' -> 'Primary'
 */
export function formatColorForDisplay(colorValue: string | undefined): string {
  if (!colorValue) return 'Inherit';

  // Handle arbitrary value [#xxx] or [rgb(...)]
  if (colorValue.startsWith('[') && colorValue.endsWith(']')) {
    return colorValue.slice(1, -1);
  }

  // Handle special values
  if (colorValue === 'transparent') return 'Transparent';
  if (colorValue === 'current') return 'Current';
  if (colorValue === 'inherit') return 'Inherit';
  if (colorValue === 'white') return 'White';
  if (colorValue === 'black') return 'Black';

  // Handle Tailwind colors like 'red-500'
  const parts = colorValue.split('-');
  if (parts.length === 2) {
    const colorName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    return `${colorName} ${parts[1]}`;
  }

  // Handle semantic colors like 'primary', 'destructive'
  return colorValue.charAt(0).toUpperCase() + colorValue.slice(1).replace(/-/g, ' ');
}

/**
 * Check if a computed background color is transparent
 */
export function isTransparent(computedColor: string | undefined): boolean {
  if (!computedColor) return true;
  const lower = computedColor.toLowerCase().replace(/\s/g, '');
  return lower === 'transparent' ||
         lower === 'rgba(0,0,0,0)' ||
         lower.startsWith('rgba(') && lower.endsWith(',0)');
}

/**
 * Get fresh computed styles from the iframe DOM for an element
 * This queries the actual DOM instead of relying on stale snapshot data
 */
export function getFreshComputedStyles(element: SelectedElement): Record<string, string> | null {
  // Import dynamically to avoid circular dependency
  const { getIframeRef } = require('./visual-editor-store');
  const iframe = getIframeRef();

  if (!iframe?.contentDocument) return null;

  let domElement: Element | null = null;

  // First try by source location (survives rebuild)
  if (element.sourceLocation) {
    const sourceStr = `${element.sourceLocation.fileName}:${element.sourceLocation.line}:${element.sourceLocation.column}`;
    domElement = iframe.contentDocument.querySelector(`[data-willow-source="${sourceStr}"]`);
  }

  // Fallback to UID
  if (!domElement) {
    domElement = iframe.contentDocument.querySelector(`[data-willow-uid="${element.uid}"]`);
  }

  if (!domElement) return null;

  try {
    const computed = iframe.contentWindow?.getComputedStyle(domElement);
    if (!computed) return null;

    return {
      backgroundColor: computed.backgroundColor,
      color: computed.color,
      padding: computed.padding,
      margin: computed.margin,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      borderRadius: computed.borderRadius,
      borderWidth: computed.borderWidth,
      borderStyle: computed.borderStyle,
      borderColor: computed.borderColor,
      display: computed.display,
    };
  } catch {
    return null;
  }
}

/**
 * Delete an element directly from the source code without AI
 * Uses ts-morph to find and remove the JSX element at the given source location
 */
export async function deleteElement(
  element: SelectedElement
): Promise<DirectStyleResult> {
  if (!element.sourceLocation) {
    return { success: false, error: 'No source location available' };
  }

  const { fileName, line, column } = element.sourceLocation;

  try {
    // Normalize the file path - try multiple formats
    const pathVariants = [
      '/' + fileName,
      fileName,
      fileName.replace(/^src\//, '/'),
      '/' + fileName.replace(/^src\//, ''),
      '/src/' + fileName.replace(/^\/?(src\/)?/, ''),
    ];

    let fileContent: string | undefined;
    let targetFile = '';

    for (const path of pathVariants) {
      fileContent = sandpackStore.getFile(path);
      if (fileContent) {
        targetFile = path;
        break;
      }
    }

    if (!fileContent) {
      fileContent = sandpackStore.getFile('/App.tsx');
      targetFile = '/App.tsx';
    }

    if (!fileContent) {
      return { success: false, error: `File not found: ${fileName}` };
    }

    // Find the JSX element
    const jsxElement = findJsxElementAtLocation(fileContent, fileName, line, column);
    if (!jsxElement) {
      return { success: false, error: 'Could not find element in code' };
    }

    // Walk up to understand context:
    // - Is this element inside a .map() callback (arrow function body)?
    // - Is this the only child of a parent JSX element?
    // - Is this a return statement's expression?
    const parent = jsxElement.getParent();
    const parentKind = parent?.getKind();

    let removeStart: number;
    let removeEnd: number;

    // Case 1: Element is the body of an arrow function (e.g. .map((item) => <div>...</div>))
    // We need to replace with null or remove the entire .map() call
    if (parentKind === SyntaxKind.ArrowFunction) {
      // Replace the JSX with `null` to keep the arrow function valid
      const elementStart = jsxElement.getStart();
      const elementEnd = jsxElement.getEnd();
      const newFileContent = fileContent.substring(0, elementStart) + 'null' + fileContent.substring(elementEnd);

      pushUndoState(`Delete: ${element.tagName}`);
      markAsUnsaved();
      clearSelection();
      sandpackStore.setFile(targetFile, newFileContent);
      previewRefreshRequest.set(Date.now());
      await new Promise(resolve => setTimeout(resolve, 50));
      requestInspectorReinit();
      return { success: true };
    }

    // Case 2: Element is inside a ParenthesizedExpression that's the body of an arrow function
    // e.g. .map((item) => ( <div>...</div> ))
    if (parentKind === SyntaxKind.ParenthesizedExpression) {
      const grandParent = parent?.getParent();
      if (grandParent?.getKind() === SyntaxKind.ArrowFunction) {
        const elementStart = jsxElement.getStart();
        const elementEnd = jsxElement.getEnd();
        const newFileContent = fileContent.substring(0, elementStart) + 'null' + fileContent.substring(elementEnd);

        pushUndoState(`Delete: ${element.tagName}`);
        markAsUnsaved();
        clearSelection();
        sandpackStore.setFile(targetFile, newFileContent);
        previewRefreshRequest.set(Date.now());
        await new Promise(resolve => setTimeout(resolve, 50));
        requestInspectorReinit();
        return { success: true };
      }
    }

    // Case 3: Element is the expression in a return statement
    // e.g. return <div>...</div>;
    if (parentKind === SyntaxKind.ReturnStatement) {
      const elementStart = jsxElement.getStart();
      const elementEnd = jsxElement.getEnd();
      const newFileContent = fileContent.substring(0, elementStart) + 'null' + fileContent.substring(elementEnd);

      pushUndoState(`Delete: ${element.tagName}`);
      markAsUnsaved();
      clearSelection();
      sandpackStore.setFile(targetFile, newFileContent);
      previewRefreshRequest.set(Date.now());
      await new Promise(resolve => setTimeout(resolve, 50));
      requestInspectorReinit();
      return { success: true };
    }

    // Case 4: Element is inside a ParenthesizedExpression in a return statement
    // e.g. return ( <div>...</div> );
    if (parentKind === SyntaxKind.ParenthesizedExpression) {
      const grandParent = parent?.getParent();
      if (grandParent?.getKind() === SyntaxKind.ReturnStatement) {
        const elementStart = jsxElement.getStart();
        const elementEnd = jsxElement.getEnd();
        const newFileContent = fileContent.substring(0, elementStart) + 'null' + fileContent.substring(elementEnd);

        pushUndoState(`Delete: ${element.tagName}`);
        markAsUnsaved();
        clearSelection();
        sandpackStore.setFile(targetFile, newFileContent);
        previewRefreshRequest.set(Date.now());
        await new Promise(resolve => setTimeout(resolve, 50));
        requestInspectorReinit();
        return { success: true };
      }
    }

    // Case 5: Element is a child inside a parent JSX element - safe to remove directly
    // e.g. <div> <span>hello</span> <p>world</p> </div>  -> removing <span> is safe
    removeStart = jsxElement.getStart();
    removeEnd = jsxElement.getEnd();

    const beforeElement = fileContent.substring(0, removeStart);
    const afterElement = fileContent.substring(removeEnd);

    // Check if the element is alone on its line(s) to clean up whitespace
    const lineStartIndex = beforeElement.lastIndexOf('\n') + 1;
    const lineEndIndex = afterElement.indexOf('\n');
    const linePrefix = beforeElement.substring(lineStartIndex);
    const lineSuffix = afterElement.substring(0, lineEndIndex === -1 ? afterElement.length : lineEndIndex);

    let newFileContent: string;

    if (linePrefix.trim() === '' && lineSuffix.trim() === '') {
      // Element is alone on its lines - remove entire lines
      const actualLineEnd = lineEndIndex === -1 ? afterElement.length : lineEndIndex + 1;
      newFileContent = beforeElement.substring(0, lineStartIndex) + afterElement.substring(actualLineEnd);
    } else {
      newFileContent = beforeElement + afterElement;
    }

    pushUndoState(`Delete: ${element.tagName}`);
    markAsUnsaved();
    clearSelection();
    sandpackStore.setFile(targetFile, newFileContent);
    previewRefreshRequest.set(Date.now());
    await new Promise(resolve => setTimeout(resolve, 50));
    requestInspectorReinit();

    return { success: true };

  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
