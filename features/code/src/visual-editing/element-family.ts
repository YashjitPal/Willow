/**
 * Finding the "family" of a clicked element — the set the visual editor should
 * select together, so editing one button edits every button rendered by the
 * same line of source.
 *
 * Pure DOM query: no React, no props, no component state. It was declared with
 * `useCallback(_, [])` in the overlay, which is exactly as stable as a
 * module-scope function, so the wrapper was dropped rather than kept — the
 * dependency arrays that name it are unaffected.
 */

// Find all similar elements (same tag + class, or siblings of same tag for common elements)
export const findSimilarElements = (element: Element, iframeDoc: Document): Element[] => {
  const tagName = element.tagName;
  const className = element.className;
  const originalRect = element.getBoundingClientRect();
  const originalArea = originalRect.width * originalRect.height;

  // Filter function: element must be within 3x the area of original
  const isSimilarSize = (el: Element) => {
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    return area <= originalArea * 3 && area >= originalArea / 3;
  };

  // Primary strategy: Use data-willow-source (same source code location = true family)
  // This matches the same logic the sidebar edit system uses for targeting
  const sourceAttr = (element as HTMLElement).dataset?.willowSource;
  if (sourceAttr) {
    const sourceMatches = Array.from(
      iframeDoc.querySelectorAll(`[data-willow-source="${sourceAttr}"]`)
    ).filter(el => isSimilarSize(el));

    if (sourceMatches.length > 0) {
      const withoutTarget = sourceMatches.filter(el => el !== element);
      return [element, ...withoutTarget];
    }
  }

  // Fallback strategies (when source location is not available)
  let familyElements: Element[] = [];

  // Fallback 1: Same tag + first class name
  if (className && typeof className === 'string' && className.trim()) {
    const firstClass = className.split(' ')[0];
    if (firstClass) {
      try {
        const escapedClass = CSS.escape(firstClass);
        const allMatches = iframeDoc.querySelectorAll(`${tagName.toLowerCase()}.${escapedClass}`);
        familyElements = Array.from(allMatches).filter(el => isSimilarSize(el));
      } catch {
        // CSS.escape might not be available or selector might be invalid
      }
    }
  }

  // Fallback 2: If no matches or only self, try parent's direct children of same tag
  if (familyElements.length <= 1) {
    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        el => el.tagName === tagName && isSimilarSize(el)
      );
      if (siblings.length > familyElements.length) {
        familyElements = siblings;
      }
    }
  }

  // Fallback 3: For common interactive elements, also check grandparent
  if (familyElements.length <= 1 && ['BUTTON', 'A', 'INPUT', 'LI', 'IMG'].includes(tagName)) {
    const grandparent = element.parentElement?.parentElement;
    if (grandparent) {
      const cousins = Array.from(grandparent.querySelectorAll(tagName.toLowerCase()))
        .filter(el => isSimilarSize(el));
      if (cousins.length > familyElements.length) {
        familyElements = cousins;
      }
    }
  }

  // Ensure clicked element is first
  if (familyElements.length > 0) {
    const withoutTarget = familyElements.filter(el => el !== element);
    return [element, ...withoutTarget];
  }

  return [element];
};
