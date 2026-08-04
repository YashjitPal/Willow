/**
 * DOM geometry helpers for the visual editor overlay.
 *
 * All four are pure functions of the DOM they are handed: no React, no
 * nanostores, no props. They were lifted out of VisualEditingOverlay unchanged
 * so the overlay component holds only the parts that touch React state.
 *
 * Each swallows its own errors and returns a safe default. These run inside
 * mousemove and scroll handlers against a cross-origin-ish preview iframe, so a
 * throw here would kill the interaction rather than degrade it.
 */

import type { FamilyElement } from './engine/types';

/**
 * Helper to read source location from a DOM element (checks element + ancestors)
 */
export function readSourceLocation(el: Element): FamilyElement['sourceLocation'] {
  // Try reading from the element itself
  const sourceAttr = (el as HTMLElement).dataset?.willowSource;
  if (sourceAttr) {
    const parts = sourceAttr.split(':');
    if (parts.length === 3) {
      return {
        fileName: parts[0],
        line: parseInt(parts[1], 10),
        column: parseInt(parts[2], 10)
      };
    }
  }

  // Fallback: search parent elements
  let ancestor = el.parentElement;
  let depth = 0;
  while (ancestor && depth < 10) {
    const ancestorSource = (ancestor as HTMLElement).dataset?.willowSource;
    if (ancestorSource) {
      const parts = ancestorSource.split(':');
      if (parts.length === 3) {
        return {
          fileName: parts[0],
          line: parseInt(parts[1], 10),
          column: parseInt(parts[2], 10)
        };
      }
    }
    ancestor = ancestor.parentElement;
    depth++;
  }

  return null;
}

// Helper: Detect the visual effects of a covering element.
// Returns whether to clip and what effects to apply to the "ghost" border for the covered portion.
interface CoverEffects {
  shouldClip: boolean;
  filter: string | undefined; // full backdrop-filter value to apply as filter
  opacity: number;
}

export function getCoverEffects(coverEl: Element): CoverEffects {
  try {
    const styles = window.getComputedStyle(coverEl);

    // Get opacity
    const opacity = parseFloat(styles.opacity || '1');

    // Get full backdrop-filter (handles blur, brightness, contrast, saturate, etc.)
    const backdropFilter = styles.getPropertyValue('backdrop-filter') || styles.getPropertyValue('-webkit-backdrop-filter');
    const hasBackdropFilter = backdropFilter && backdropFilter !== 'none';

    // Get background alpha
    let bgAlpha = 1;
    const bg = styles.backgroundColor;
    if (bg) {
      const match = bg.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/);
      if (match && match[4] !== undefined) {
        bgAlpha = parseFloat(match[4]);
      }
    }

    const effectiveOpacity = opacity * bgAlpha;

    // Fully opaque, no effects → normal clip, no ghost border needed
    if (effectiveOpacity >= 0.85 && !hasBackdropFilter) {
      return { shouldClip: true, filter: undefined, opacity: 1 };
    }

    // Semi-transparent or has effects → clip, but provide effects for ghost border
    return { shouldClip: true, filter: hasBackdropFilter ? backdropFilter : undefined, opacity: effectiveOpacity };
  } catch {
    return { shouldClip: true, filter: undefined, opacity: 1 };
  }
}

// Helper: Check if an element is in a fixed/sticky positioning context
function isInFixedStickyContext(el: Element): boolean {
  let current: Element | null = el;
  while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML') {
    try {
      const pos = window.getComputedStyle(current).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
    } catch { /* ignore */ }
    current = current.parentElement;
  }
  return false;
}

// Helper: Find the covering element at a given point using a two-phase approach.
// Phase 1: Validate that at least one element at the point is in a fixed/sticky context
//          (prevents normal layout siblings from being treated as covers).
// Phase 2: Among all opaque elements in front of the target, return the one with the
//          largest `bottom` value (handles stacked covers and transparent wrappers).
export function findTrueCover(doc: Document, x: number, y: number, targetEl: Element): Element | null {
  try {
    const elements = doc.elementsFromPoint(x, y);
    let hasFixedStickyContext = false;
    let bestCover: Element | null = null;
    let maxBottom = -Infinity;

    for (const el of elements) {
      // Once we reach the target, everything after is behind it
      if (el === targetEl) break;
      // Skip ancestors and descendants of the target
      if (el.contains(targetEl) || targetEl.contains(el)) continue;
      if (el.tagName === 'BODY' || el.tagName === 'HTML') continue;

      // Phase 1: Check if this element is in a fixed/sticky context
      if (!hasFixedStickyContext && isInFixedStickyContext(el)) {
        hasFixedStickyContext = true;
      }

      // Phase 2: Track the opaque element with the largest bottom edge
      if (getCoverEffects(el).shouldClip) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > maxBottom) {
          maxBottom = rect.bottom;
          bestCover = el;
        }
      }
    }

    // Only return a cover if there's structural validation (fixed/sticky context present)
    return hasFixedStickyContext ? bestCover : null;
  } catch {
    // Fallback: ignore
  }
  return null;
}
