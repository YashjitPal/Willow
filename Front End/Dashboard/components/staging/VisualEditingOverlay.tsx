import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { X, MousePointer2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AIInputWithLoading } from '@/components/ui/ai-input-with-loading';
import { useUserDataContext } from '../../context/UserDataContext';
import {
  isVisualEditMode,
  isScanning,
  exitVisualEdit,
  applyVisualEdit,
  selectedElement as selectedElementAtom,
  isVisualEditing,
  navigateToCode,
  clearSelection,
  addToVisualEditQueue,
  dequeueVisualEdit,
  visualEditQueue,
  parentSelectionRequested,
  selectedElements as selectedElementsAtom,
  inspectorReady,
  previewRefreshRequest,
  pendingSelectionRestore,
  deleteElement,
} from '../../lib/visual-editor';
import type { SelectedElement, FamilyElement } from '../../lib/visual-editor/types';
import type { AiOptions } from '../../lib/ai';

// Constants for prompt box sizing
const PROMPT_BOX_HEIGHT = 60;
const EDGE_PADDING = 12;

// Darker blue color for selection/hover
const SELECTION_COLOR = '#1e40af';
const SELECTION_COLOR_RGB = '30, 64, 175';

/**
 * Helper to read source location from a DOM element (checks element + ancestors)
 */
function readSourceLocation(el: Element): FamilyElement['sourceLocation'] {
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

interface VisualEditingOverlayProps {
  iframeRef: React.RefObject<HTMLIFrameElement>;
  selectedModelId: string;
  modelConfig: any;
  isReloading?: boolean;
}

interface ElementInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  tagName: string;
  className?: string;
  borderRadius?: string;
  // Individual corner radii for elements with mixed corners
  borderTopLeftRadius?: string;
  borderTopRightRadius?: string;
  borderBottomLeftRadius?: string;
  borderBottomRightRadius?: string;
  clipTop?: number;
  selectionGroupId?: string; // To track grouping for solid/dashed borders
}

const VisualEditingOverlay: React.FC<VisualEditingOverlayProps> = ({ iframeRef, selectedModelId, modelConfig, isReloading = false }) => {
  const isActive = useStore(isVisualEditMode);
  const scanning = useStore(isScanning);
  const isInspectorReady = useStore(inspectorReady); // Subscribe to inspectorReady atom
  const globalSelectedElement = useStore(selectedElementAtom);
  // Subscribe to multi-selection state to sync changes from sidebar back to overlay
  const globalSelectedElements = useStore(selectedElementsAtom);

  // Get API keys from context
  const { apiKeys } = useUserDataContext();

  const [hoveredElements, setHoveredElements] = useState<ElementInfo[]>([]);
  const [selectedElements, setSelectedElements] = useState<ElementInfo[]>([]);
  const [isPromptVisible, setIsPromptVisible] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Store references to actual DOM elements for live position tracking
  const selectedDomElementsRef = useRef<Element[]>([]);
  // Store references to the overlay DOM elements for direct updates
  const selectionOverlayRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Store family elements with source locations for AI context
  const familyElementsRef = useRef<FamilyElement[]>([]);

  // Get element info from a DOM element
  const getElementInfo = useCallback((element: Element): ElementInfo => {
    const rect = element.getBoundingClientRect();
    // Get computed border-radius for all corners individually
    let borderRadius = '4px';
    let borderTopLeftRadius = '4px';
    let borderTopRightRadius = '4px';
    let borderBottomLeftRadius = '4px';
    let borderBottomRightRadius = '4px';

    try {
      const computed = window.getComputedStyle(element);
      borderRadius = computed.borderRadius || '4px';
      // Get individual corners - these override the shorthand when different
      borderTopLeftRadius = computed.borderTopLeftRadius || borderRadius;
      borderTopRightRadius = computed.borderTopRightRadius || borderRadius;
      borderBottomLeftRadius = computed.borderBottomLeftRadius || borderRadius;
      borderBottomRightRadius = computed.borderBottomRightRadius || borderRadius;
    } catch {}

    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      tagName: element.tagName.toLowerCase(),
      className: typeof element.className === 'string' ? element.className.split(' ')[0] : undefined,
      borderRadius,
      borderTopLeftRadius,
      borderTopRightRadius,
      borderBottomLeftRadius,
      borderBottomRightRadius,
      // We need to fetch the ID here. Since getElementInfo takes a raw Element, we rely on the WeakMap we set up earlier
      selectionGroupId: selectedGroupIdsRef.current.get(element as HTMLElement)
    };
  }, []);

  // Refresh selected element positions from stored DOM references
  const refreshPositions = useCallback(() => {
    if (selectedDomElementsRef.current.length === 0) return;

    const newElements: ElementInfo[] = [];
    for (const el of selectedDomElementsRef.current) {
      // Check if element is still in the document
      if (el.isConnected) {
        let info = getElementInfo(el);

        // Handle visual occlusion (e.g., sticky headers)
        // Check if the top center of the projected element/box is actively covered
        const doc = el.ownerDocument;
        if (doc) {
          // Point to test: Top center of the element's bounding box
          // We clamp y to 0 (viewport top) to check if it's covered "at the screen edge"
          const testX = info.x + info.width / 2;
          const testY = Math.max(0, info.y + 1); // +1 to get slightly inside

          const hitElement = doc.elementFromPoint(testX, testY);

          // If we hit something, and it's NOT the element itself or a descendant...
          // And ignore BODY/HTML as they are usually backgrounds, not overlays
          if (hitElement && hitElement !== el && !el.contains(hitElement) &&
              hitElement.tagName !== 'BODY' && hitElement.tagName !== 'HTML') {
            // ...then it's likely covered by a header/overlay.
            const coverRect = hitElement.getBoundingClientRect();

            // If the cover is above the element (visually covering the top), clip it
            if (coverRect.bottom > info.y) {
               const newTop = coverRect.bottom;
               const diff = newTop - info.y;
               if (diff < info.height) { // Only clip if not fully covered
                 // Instead of changing y/height (which moves the border), we set a clip amount
                 // This allows proper "sliding under" effect via clip-path
                 info = {
                   ...info,
                   clipTop: diff
                 };
               } else {
                 // Fully covered - skip adding this element or make it 0 size
                 // Skipping effectively hides it
                 continue;
               }
            }
          }
        }

        newElements.push(info);
      }
    }

    if (newElements.length > 0) {
      setSelectedElements(newElements);
    } else if (selectedDomElementsRef.current.length > 0) {
       // If all selected elements are fully occluded/gone, clear selection visual but keep state?
       // User wants persistence. So let's render empty list to "hide" but don't clear ref.
       setSelectedElements([]);
    }
  }, [getElementInfo]);



  // Optimized direct DOM update for scroll/resize to avoid React render lag
  const updatePositionsDirectly = useCallback(() => {
    if (selectedDomElementsRef.current.length === 0) return;

    selectedDomElementsRef.current.forEach((el, index) => {
      // Get the overlay element
      const overlayEl = selectionOverlayRefs.current.get(index);
      if (!overlayEl || !el.isConnected) return;

      const rect = el.getBoundingClientRect();
      let clipTop = 0;

      // Handle occlusion (simplified logic from refreshPositions)
      const doc = el.ownerDocument;
      if (doc) {
        const testX = rect.left + rect.width / 2;
        const testY = Math.max(0, rect.top + 1);
        const hitElement = doc.elementFromPoint(testX, testY);

        if (hitElement && hitElement !== el && !el.contains(hitElement) &&
            hitElement.tagName !== 'BODY' && hitElement.tagName !== 'HTML') {
          const coverRect = hitElement.getBoundingClientRect();
          if (coverRect.bottom > rect.top) {
             const diff = coverRect.bottom - rect.top;
             if (diff < rect.height) {
               clipTop = diff;
             } else {
               // Fully covered - hide it
               overlayEl.style.display = 'none';
               return;
             }
          }
        }
      }

      // Apply updates directly
      overlayEl.style.display = 'block'; // Ensure visible if it was hidden
      overlayEl.style.left = `${rect.left}px`;
      overlayEl.style.top = `${rect.top}px`;
      overlayEl.style.width = `${rect.width}px`;
      overlayEl.style.height = `${rect.height}px`;
      
      if (clipTop > 0) {
        overlayEl.style.clipPath = `inset(${clipTop}px 0 0 0)`;
      } else {
        overlayEl.style.clipPath = '';
      }
    });

    // Also update prompt box position if visible
    // (We could persist ref to prompt box wrapper too, but it renders conditionally)
    // For now, prompt box position is managed by React state `primaryElement`
    // which is updated by refreshPositions (debounced or state-based).
    // If prompt lags, we might need a ref for it too.
  }, []);

  // Set up scroll listener on iframe to track positions in real-time

  useEffect(() => {
    if (!isActive || !iframeRef.current) return;

    const iframe = iframeRef.current;
    const win = iframe.contentWindow;

    if (!win) return;

    const handleScroll = () => {
      // Use direct DOM update for smooth sync
      requestAnimationFrame(updatePositionsDirectly);
      
      // Also trigger state update eventually to keep React state consistent (debounce/throttle could be good here)
      // For now, we rely on the direct update for visuals. State update can happen on end?
      // Actually, if we just update DOM, React state becomes "stale" but it doesn't matter unless component re-renders.
      // If we don't update state, `selectedElements` (used for render) has old coordinates.
      // If a re-render happens (e.g. hover), it will snap back to old coordinates briefly!
      // So we MUST also update state. But maybe throttled?
      // Or simply: refreshPositions() is fast enough? No, user said it lags.
      // Let's call refreshPositions() but maybe we rely on updatePositionsDirectly for the immediate frame.
      
      // We will SKIP calling refreshPositions() on scroll to avoid fighting the DOM updates and causing lag.
      // Instead we only update the React state when scrolling STOPS (debounce).
    };

    const handleScrollEnd = () => {
      refreshPositions();
    };
    
    // Debounce state update
    let scrollTimeout: NodeJS.Timeout;
    const debouncedScroll = () => {
        requestAnimationFrame(updatePositionsDirectly);
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(handleScrollEnd, 100);
    };

    win.addEventListener('scroll', debouncedScroll, { passive: true, capture: true });

    return () => {
      win.removeEventListener('scroll', debouncedScroll, { capture: true });
      clearTimeout(scrollTimeout);
    };
  }, [isActive, iframeRef, updatePositionsDirectly, refreshPositions]);


  // Listen for ELEMENT_SELECT, THEME_COLORS_RESPONSE, and HOT_UPDATE_COMPLETE messages from iframe
  // This updates the global selectedElementAtom and themeColors when received
  useEffect(() => {
    if (!isActive) return;

    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'ELEMENT_SELECT' && e.data.element) {
        // Update the global selected element atom
        import('../../lib/visual-editor').then(({ selectElement }) => {
          selectElement(e.data.element);
        });
      }

      // Handle theme colors response from iframe
      if (e.data?.type === 'THEME_COLORS_RESPONSE' && e.data.colors) {
        import('../../lib/visual-editor/visual-editor-store').then(({ themeColors }) => {
          themeColors.set(e.data.colors);
          console.log('[VisualEditingOverlay] Theme colors received:', Object.keys(e.data.colors).length);
        });
      }

      // ✨ HOT UPDATE COMPLETE: Re-sync DOM references after hot update
      // After a hot update, React creates new DOM nodes but selectedDomElementsRef still holds
      // references to the old disconnected nodes. We need to re-find elements by sourceLocation.
      if (e.data?.type === 'HOT_UPDATE_COMPLETE') {
        console.log('[VisualEditingOverlay] Hot update complete, re-syncing DOM references');

        const iframeDoc = iframeRef.current?.contentDocument;
        if (!iframeDoc) return;

        const globalElements = selectedElementsAtom.get();
        if (globalElements.length === 0) return;

        // Re-find elements by source location (survives hot update)
        const newDomElements: Element[] = [];
        for (const item of globalElements) {
          let el: Element | null = null;

          if (item.sourceLocation) {
            const sourceStr = `${item.sourceLocation.fileName}:${item.sourceLocation.line}:${item.sourceLocation.column}`;
            const matchingElements = iframeDoc.querySelectorAll(`[data-willow-source="${sourceStr}"]`);

            if (matchingElements.length === 1) {
              el = matchingElements[0];
            } else if (matchingElements.length > 1) {
              // Multiple matches - disambiguate using textContent
              const targetText = item.textContent || '';
              let bestMatch: Element | null = null;
              let bestScore = -1;

              for (const candidate of matchingElements) {
                let score = 0;
                const candidateText = (candidate.textContent || '').trim().substring(0, 100);

                if (targetText && candidateText === targetText) {
                  score += 10;
                } else if (targetText && candidateText.includes(targetText.substring(0, 20))) {
                  score += 3;
                }

                if (item.classNames.length > 0) {
                  const candidateClasses = Array.from(candidate.classList || []);
                  const commonClasses = item.classNames.filter(c => candidateClasses.includes(c));
                  score += commonClasses.length;
                }

                if (score > bestScore) {
                  bestScore = score;
                  bestMatch = candidate;
                }
              }

              el = bestMatch || matchingElements[0];
            }
          }

          // Fallback: try to find by UID
          if (!el) {
            el = iframeDoc.querySelector(`[data-willow-uid="${item.uid}"]`);
          }

          if (el) {
            // Re-assign UID to the new element
            (el as HTMLElement).dataset.willowUid = item.uid;
            newDomElements.push(el);
          }
        }

        if (newDomElements.length > 0) {
          selectedDomElementsRef.current = newDomElements;
          refreshPositions();
          console.log('[VisualEditingOverlay] Re-synced', newDomElements.length, 'elements after hot update');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isActive, refreshPositions]);

  // Set up resize observer to track positions when preview panel is resized
  useEffect(() => {
    if (!isActive || !iframeRef.current) return;

    const iframe = iframeRef.current;

    // Watch both the iframe and its parent container for size changes
    const resizeObserver = new ResizeObserver(() => {
      // Refresh positions when size changes
      refreshPositions();
    });

    resizeObserver.observe(iframe);
    if (iframe.parentElement) {
      resizeObserver.observe(iframe.parentElement);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [isActive, iframeRef, refreshPositions]);

  // Sync global selection changes (e.g. from Sidebar) back to local overlay
  useEffect(() => {
     if (!isActive || !iframeRef.current || !iframeRef.current.contentDocument) return;

     // Don't sync if the selection matches (check by sourceLocation which survives rebuilds)
     const localSourceLocs = new Set(selectedDomElementsRef.current.map(el => (el as HTMLElement).dataset?.willowSource).filter(Boolean));
     const globalSourceLocs = new Set(globalSelectedElements.map(el =>
       el.sourceLocation ? `${el.sourceLocation.fileName}:${el.sourceLocation.line}:${el.sourceLocation.column}` : null
     ).filter(Boolean));

     // Quick check if sets are equal by sourceLocation
     if (localSourceLocs.size === globalSourceLocs.size && localSourceLocs.size > 0 && [...localSourceLocs].every(src => globalSourceLocs.has(src!))) {
        return;
     }

     console.log('[VisualEditingOverlay] Syncing global selection to local:', globalSelectedElements.length);

     const doc = iframeRef.current.contentDocument;
     const newSelectedDomElements: Element[] = [];

     globalSelectedElements.forEach(item => {
        let el: Element | null = null;

        // First try to find by sourceLocation (survives rebuilds)
        if (item.sourceLocation) {
           const sourceStr = `${item.sourceLocation.fileName}:${item.sourceLocation.line}:${item.sourceLocation.column}`;
           const matchingElements = doc.querySelectorAll(`[data-willow-source="${sourceStr}"]`);

           if (matchingElements.length === 1) {
             el = matchingElements[0];
           } else if (matchingElements.length > 1) {
             // Multiple matches - disambiguate using textContent
             const targetText = item.textContent || '';
             let bestMatch: Element | null = null;
             let bestScore = -1;

             for (const candidate of matchingElements) {
               let score = 0;
               const candidateText = (candidate.textContent || '').trim().substring(0, 100);

               if (targetText && candidateText === targetText) {
                 score += 10;
               } else if (targetText && candidateText.includes(targetText.substring(0, 20))) {
                 score += 3;
               }

               // Also check classNames
               if (item.classNames.length > 0) {
                 const candidateClasses = Array.from(candidate.classList || []);
                 const commonClasses = item.classNames.filter(c => candidateClasses.includes(c));
                 score += commonClasses.length;
               }

               if (score > bestScore) {
                 bestScore = score;
                 bestMatch = candidate;
               }
             }

             el = bestMatch || matchingElements[0];
           }
        }

        // Fallback: try to find by UID
        if (!el) {
           el = doc.querySelector(`[data-willow-uid="${item.uid}"]`);
        }

        if (el) {
           newSelectedDomElements.push(el);
        }
     });

     selectedDomElementsRef.current = newSelectedDomElements;
     // Update prompt visibility based on if we have selection
     setIsPromptVisible(newSelectedDomElements.length > 0);

     // Trigger position refresh to draw boxes
     refreshPositions();

  }, [isActive, globalSelectedElements, refreshPositions]);

  // Re-sync DOM references after preview rebuilds (e.g., after sidebar style changes)
  // This prevents selection overlay from disappearing on scroll after a rebuild
  const lastRefreshRef = useRef<number>(0);
  const refreshRequest = useStore(previewRefreshRequest);

  useEffect(() => {
    // Skip if no refresh requested or same as last handled
    if (refreshRequest === 0 || refreshRequest === lastRefreshRef.current) return;
    lastRefreshRef.current = refreshRequest;

    if (!isActive || !iframeRef.current) return;

    // If there's a pending selection restore, skip this effect entirely
    // The RESTORE_SELECTION mechanism will handle updating the selection
    const pendingRestore = pendingSelectionRestore.get();
    if (pendingRestore) {
      return;
    }

    // Get current global selection
    const globalElements = selectedElementsAtom.get();
    if (globalElements.length === 0) return;

    // Wait for iframe to rebuild and inspector to reinit (inspector reinit is 500ms)
    const timer = setTimeout(() => {
      const iframeDoc = iframeRef.current?.contentDocument;
      if (!iframeDoc) return;

      // Re-find elements by SOURCE LOCATION (survives rebuild) instead of UID
      const newDomElements: Element[] = [];
      for (const item of globalElements) {
        let el: Element | null = null;

        // First try by source location (most reliable after rebuild)
        if (item.sourceLocation) {
          const sourceStr = `${item.sourceLocation.fileName}:${item.sourceLocation.line}:${item.sourceLocation.column}`;
          const matchingElements = iframeDoc.querySelectorAll(`[data-willow-source="${sourceStr}"]`);

          if (matchingElements.length === 1) {
            el = matchingElements[0];
          } else if (matchingElements.length > 1) {
            // Multiple matches - disambiguate using textContent and classNames
            const targetText = item.textContent || '';
            let bestMatch: Element | null = null;
            let bestScore = -1;

            for (const candidate of matchingElements) {
              let score = 0;
              const candidateText = (candidate.textContent || '').trim().substring(0, 100);

              if (targetText && candidateText === targetText) {
                score += 10;
              } else if (targetText && candidateText.includes(targetText.substring(0, 20))) {
                score += 3;
              }

              if (item.classNames.length > 0) {
                const candidateClasses = Array.from(candidate.classList || []);
                const commonClasses = item.classNames.filter(c => candidateClasses.includes(c));
                score += commonClasses.length;
              }

              if (score > bestScore) {
                bestScore = score;
                bestMatch = candidate;
              }
            }

            el = bestMatch || matchingElements[0];
          }
        }

        // Fallback to UID (might work if element wasn't rebuilt)
        if (!el) {
          el = iframeDoc.querySelector(`[data-willow-uid="${item.uid}"]`);
        }

        if (el) {
          // Re-assign UID to the new element so future operations work
          (el as HTMLElement).dataset.willowUid = item.uid;
          newDomElements.push(el);
        }
      }

      if (newDomElements.length > 0) {
        selectedDomElementsRef.current = newDomElements;
        refreshPositions();
      }
    }, 600); // Wait 600ms - after inspector reinit (500ms)

    return () => clearTimeout(timer);
  }, [refreshRequest, isActive, iframeRef, refreshPositions]);

  // Track the last parent selection request we handled
  const lastParentRequestRef = useRef<number>(0);
  const parentRequest = useStore(parentSelectionRequested);
  // Track if a manual click happened (to cancel pending parent sync)
  const pendingParentSyncRef = useRef<boolean>(false);

  // Sync local selection state when Select Parent is clicked
  useEffect(() => {
    // Only run when there's a new parent selection request
    if (parentRequest === 0 || parentRequest === lastParentRequestRef.current) return;
    lastParentRequestRef.current = parentRequest;

    if (!isActive || !iframeRef.current) return;

    // IMMEDIATELY clear the old selection to prevent showing both button and parent
    setSelectedElements([]);
    selectedDomElementsRef.current = [];
    setIsPromptVisible(false);

    // Mark that we have a pending sync
    pendingParentSyncRef.current = true;

    // Wait for the global selection to update from the iframe message
    const timer = setTimeout(() => {
      // Check if sync was cancelled by a manual click
      if (!pendingParentSyncRef.current) {
        console.log('[VisualEditor] Parent sync cancelled by manual click');
        return;
      }
      pendingParentSyncRef.current = false;

      const globalElement = selectedElementAtom.get();
      if (!globalElement) return;

      console.log('[VisualEditor] Select Parent requested, syncing to:', globalElement.tagName);

      const iframeDoc = iframeRef.current?.contentDocument;
      if (!iframeDoc) return;

      // Try to find the element by UID first, then by source location
      let targetElement = iframeDoc.querySelector(`[data-willow-uid="${globalElement.uid}"]`);

      if (!targetElement && globalElement.sourceLocation) {
        const sourceStr = `${globalElement.sourceLocation.fileName}:${globalElement.sourceLocation.line}:${globalElement.sourceLocation.column}`;
        targetElement = iframeDoc.querySelector(`[data-willow-source="${sourceStr}"]`);
      }

      if (targetElement) {
        // Update local state to match global selection
        const elementInfo = getElementInfo(targetElement);
        setSelectedElements([elementInfo]);
        selectedDomElementsRef.current = [targetElement];
        setIsPromptVisible(true);
        setEditError(null);

        // IMPORTANT: Now that the overlay component is handling the selection,
        // tell the iframe to hide its internal selectionOverlay to avoid double highlights
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({ type: 'CLEAR_SELECTION_OVERLAY' }, '*');
        }

        // Update family elements
        familyElementsRef.current = [{
          uid: globalElement.uid,
          tagName: targetElement.tagName.toLowerCase(),
          classNames: Array.from(targetElement.classList),
          textContent: (targetElement.textContent || '').trim().substring(0, 100),
          sourceLocation: globalElement.sourceLocation
        }];

        console.log('[VisualEditor] Synced to parent element:', targetElement.tagName);
      } else {
        console.log('[VisualEditor] Could not find parent element in DOM');
      }
    }, 150); // Delay to allow iframe message round-trip

    return () => {
      clearTimeout(timer);
      pendingParentSyncRef.current = false;
    };
  }, [parentRequest, isActive, iframeRef, getElementInfo]);

  // Find all similar elements (same tag + class, or siblings of same tag for common elements)
  const findSimilarElements = useCallback((element: Element, iframeDoc: Document): Element[] => {
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

    // Try multiple strategies for finding family elements
    let familyElements: Element[] = [];

    // Strategy 1: Same tag + first class name
    if (className && typeof className === 'string' && className.trim()) {
      const firstClass = className.split(' ')[0];
      if (firstClass) {
        try {
          // Escape special characters in class name for CSS selector
          const escapedClass = CSS.escape(firstClass);
          const allMatches = iframeDoc.querySelectorAll(`${tagName.toLowerCase()}.${escapedClass}`);
          familyElements = Array.from(allMatches).filter(el => isSimilarSize(el));
        } catch {
          // CSS.escape might not be available or selector might be invalid
        }
      }
    }

    // Strategy 2: If no matches or only self, try parent's direct children of same tag
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

    // Strategy 3: For common interactive elements, also check grandparent
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
  }, []);

  // Get elements at point
  const getElementsAtPoint = useCallback((clientX: number, clientY: number): { elements: ElementInfo[], domElements: Element[] } => {
    if (!iframeRef.current) return { elements: [], domElements: [] };

    try {
      const iframe = iframeRef.current;
      const iframeRect = iframe.getBoundingClientRect();

      const x = clientX - iframeRect.left;
      const y = clientY - iframeRect.top;

      const iframeDoc = iframe.contentDocument;
      if (!iframeDoc) {
        return {
          elements: [{
            x: x - 50,
            y: y - 25,
            width: 100,
            height: 50,
            tagName: 'element',
          }],
          domElements: [],
        };
      }

      // Use elementsFromPoint to get ALL elements at this specific coordinate
      // Then we can sort by size to find the "smallest" one (most specific)
      const elementsAtPoint = iframeDoc.elementsFromPoint(x, y);

      if (!elementsAtPoint || elementsAtPoint.length === 0) {
        return { elements: [], domElements: [] };
      }

      // Filter out body/html and sort by area (smallest first)
      const candidates = elementsAtPoint
        .filter(el => el !== iframeDoc.body && el !== iframeDoc.documentElement)
        .map(el => {
          const rect = el.getBoundingClientRect();
          return {
            element: el,
            area: rect.width * rect.height,
            rect
          };
        })
        .sort((a, b) => a.area - b.area);

      if (candidates.length === 0) {
         return { elements: [], domElements: [] };
      }

      // Pick the smallest element
      const bestElement = candidates[0].element;

      const similarElements = findSimilarElements(bestElement, iframeDoc);
      const elements = similarElements.map(el => getElementInfo(el));

      return { elements, domElements: similarElements };
    } catch (e) {
      console.log('[VisualEditor] Cannot access iframe content:', e);
      return { elements: [], domElements: [] };
    }
  }, [iframeRef, findSimilarElements, getElementInfo]);

  // Handle mouse move - allow hovering even when something is selected (Lovable-style)
  // But don't show hover highlight for ALREADY selected elements to avoid double borders
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isActive || scanning || !isInspectorReady) return;

    const { elements, domElements } = getElementsAtPoint(e.clientX, e.clientY);

    // Filter out elements that are already selected
    const filteredElements = elements.filter((_, index) => {
      const domEl = domElements[index];
      return !selectedDomElementsRef.current.includes(domEl);
    });

    setHoveredElements(filteredElements);

    // Update global store for Sidebar indicator
    const el = domElements[0];
    if (el) {
      const rect = el.getBoundingClientRect();
      const styles = window.getComputedStyle(el);
      
      import('../../lib/visual-editor').then(({ setHoveredElement }) => {
        setHoveredElement({
          uid: (el as any).dataset.willowUid || `el-${Math.random().toString(36).substr(2, 9)}`,
          tagName: el.tagName.toLowerCase(),
          classNames: Array.from(el.classList),
          textContent: (el.textContent || '').slice(0, 100),
          bounds: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height
          },
          selectorPath: el.tagName.toLowerCase(),
          computedStyles: {
            padding: styles.padding,
            margin: styles.margin,
            backgroundColor: styles.backgroundColor,
            color: styles.color,
            fontSize: styles.fontSize,
            fontWeight: styles.fontWeight,
            borderRadius: styles.borderRadius
          },
          parentPath: []
        });
      });
    } else {
      import('../../lib/visual-editor').then(({ setHoveredElement }) => {
        setHoveredElement(null);
      });
    }
  }, [isActive, scanning, getElementsAtPoint]);

  // Track group IDs for selected elements
  const selectedGroupIdsRef = useRef(new WeakMap<HTMLElement, string>());

  // Handle click
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!isActive || scanning || !isInspectorReady) return;

    // Cancel any pending parent selection sync
    pendingParentSyncRef.current = false;

    e.preventDefault();
    e.stopPropagation();

    const { elements, domElements } = getElementsAtPoint(e.clientX, e.clientY);
    
    // Generate a unique Group ID for this specific click interaction
    const currentClickGroupId = `group-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    // Determine the new selection
    if (elements.length > 0) {
      // Check for multi-select modifier (Ctrl or Cmd)
      if (e.ctrlKey || e.metaKey) {
        const primaryDom = domElements[0];
        const isAlreadySelected = selectedDomElementsRef.current.includes(primaryDom);

        if (isAlreadySelected) {
          // Deselect: remove these elements and their group IDs
          selectedDomElementsRef.current = selectedDomElementsRef.current.filter(el => !domElements.includes(el));
          // We don't strictly need to remove from WeakMap, but we could.
        } else {
          // Add to selection: Only add elements that aren't already selected
          const uniqueNewElements = domElements.filter(el => !selectedDomElementsRef.current.includes(el));
          selectedDomElementsRef.current.push(...uniqueNewElements);
          
          // Assign the new Group ID to these newly selected elements
          uniqueNewElements.forEach(el => selectedGroupIdsRef.current.set(el, currentClickGroupId));
        }
      } else {
        // Single select (default): Replace selection
        selectedDomElementsRef.current = domElements;
        setHoveredElements([]); // Clear hover when selecting
        
        // Reset/Assign Group ID for this new single selection batch
        // Since it's a fresh selection, all these elements get the current click Group ID
        domElements.forEach(el => selectedGroupIdsRef.current.set(el, currentClickGroupId));
      }

      // Update local UI state
      const newSelectedInfos = selectedDomElementsRef.current.map(el => getElementInfo(el));
      setSelectedElements(newSelectedInfos);
      setIsPromptVisible(selectedDomElementsRef.current.length > 0);

      // Clear the inspector's internal selection overlay
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'CLEAR_SELECTION_OVERLAY' }, '*');
      }

      // Build family elements for AI context (based on the first/primary element for now, or all?)
      if (selectedDomElementsRef.current.length > 0) {
         // Use the most recently added or first element for family context
         familyElementsRef.current = selectedDomElementsRef.current.map((domEl, index) => ({
           uid: (domEl as any).dataset?.willowUid || `family-${index}-${Math.random().toString(36).substring(2, 11)}`,
           tagName: domEl.tagName.toLowerCase(),
           classNames: Array.from(domEl.classList),
           textContent: (domEl.textContent || '').trim().substring(0, 100),
           sourceLocation: readSourceLocation(domEl)
         }));
      } else {
        familyElementsRef.current = [];
      }

      // SYNC TO GLOBAL STORE (Multi-select support)
      // We map ALL selected elements to the global format
      const richSelectedElements = selectedDomElementsRef.current.map(el => {
          const styles = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const styleAttr = el.getAttribute('style') || '';
          const hasInlineStyle = styleAttr.trim().length > 0;
          const hasRunningAnimation =
            styles.animationName !== 'none' &&
            styles.animationName !== '' &&
            styles.animationPlayState === 'running';
          
          const hasJsTransform =
            hasInlineStyle &&
            (styleAttr.includes('transform') ||
             styleAttr.includes('translate') ||
             styleAttr.includes('rotate') ||
             styleAttr.includes('scale'));
          
          const hasDynamicStyles = hasInlineStyle || hasRunningAnimation || hasJsTransform;

          // Source Location Logic
          let sourceLocation = null;
          const sourceAttr = (el as HTMLElement).dataset?.willowSource;
          if (sourceAttr) {
            const parts = sourceAttr.split(':');
            if (parts.length === 3) {
              sourceLocation = {
                fileName: parts[0],
                line: parseInt(parts[1], 10),
                column: parseInt(parts[2], 10)
              };
            }
          }
          // Fallback: search parent elements
          if (!sourceLocation) {
            let ancestor = el.parentElement;
            let depth = 0;
            while (ancestor && depth < 10) {
              const ancestorSource = (ancestor as HTMLElement).dataset?.willowSource;
              if (ancestorSource) {
                const parts = ancestorSource.split(':');
                if (parts.length === 3) {
                  sourceLocation = {
                    fileName: parts[0],
                    line: parseInt(parts[1], 10),
                    column: parseInt(parts[2], 10)
                  };
                  break;
                }
              }
              ancestor = ancestor.parentElement;
              depth++;
            }
          }

          // Component File Logic
          let componentFile = null;
          const componentAttr = (el as HTMLElement).dataset?.willowComponent;
          if (componentAttr) {
            const colonIndex = componentAttr.lastIndexOf(':');
            if (colonIndex > 0) {
              componentFile = {
                filePath: componentAttr.substring(0, colonIndex),
                componentName: componentAttr.substring(colonIndex + 1)
              };
            }
          }
          // Fallback: search parent elements
          if (!componentFile) {
            let ancestor = el.parentElement;
            let depth = 0;
            while (ancestor && depth < 10) {
              const ancestorComponent = (ancestor as HTMLElement).dataset?.willowComponent;
              if (ancestorComponent) {
                const colonIndex = ancestorComponent.lastIndexOf(':');
                if (colonIndex > 0) {
                  componentFile = {
                    filePath: ancestorComponent.substring(0, colonIndex),
                    componentName: ancestorComponent.substring(colonIndex + 1)
                  };
                  break;
                }
              }
              ancestor = ancestor.parentElement;
              depth++;
            }
          }

          // Ensure UID
          const elHtml = el as HTMLElement;
          if (!elHtml.dataset.willowUid) {
            elHtml.dataset.willowUid = `el-${Math.random().toString(36).substr(2, 9)}`;
          }
          const elementUid = elHtml.dataset.willowUid;

          return {
              uid: elementUid,
              tagName: el.tagName.toLowerCase(),
              classNames: Array.from(el.classList),
              textContent: (el.textContent || '').slice(0, 100),
              bounds: {
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height
              },
              selectorPath: el.tagName.toLowerCase(), // Simplistic selector
              computedStyles: {
                padding: styles.padding,
                margin: styles.margin,
                backgroundColor: styles.backgroundColor,
                color: styles.color,
                fontSize: styles.fontSize,
                fontWeight: styles.fontWeight,
                borderRadius: styles.borderRadius
              },
              parentPath: [],
              hasDynamicStyles,
              sourceLocation,
              componentFile,
              // ✨ Assign the tracked selection group ID
              selectionGroupId: selectedGroupIdsRef.current.get(el)
          };
      });

      console.log('[VisualEditor] Syncing selected elements to store:', richSelectedElements.length);
      
      import('../../lib/visual-editor').then(({ setSelectedElements }) => {
        setSelectedElements(richSelectedElements);
      });

    } else {
        // Clicked on empty space - deselect
        setSelectedElements([]);
        selectedDomElementsRef.current = [];
        familyElementsRef.current = [];
        setIsPromptVisible(false);
        import('../../lib/visual-editor').then(({ clearSelection }) => {
            clearSelection();
        });
    }
  }, [isActive, scanning, getElementsAtPoint, getElementInfo]);

  // Handle scroll - robustly forward to the correct element within the iframe
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;

    if (!win || !doc) return;

    // Calculate position relative to iframe
    const iframeRect = iframe.getBoundingClientRect();
    const x = e.clientX - iframeRect.left;
    const y = e.clientY - iframeRect.top;

    // Find the element actually under the cursor in the iframe
    const elementUnderCursor = doc.elementFromPoint(x, y);

    if (elementUnderCursor) {
      let current: Element | null = elementUnderCursor;
      let scrolled = false;

      // Walk up the tree to find the first scrollable ancestor
      while (current) {
        // Skip text nodes (shouldn't be returned by elementFromPoint but safe check)
        if (current.nodeType !== 1) {
          current = current.parentElement;
          continue;
        }

        const style = win.getComputedStyle(current);
        const overflowY = style.overflowY;
        // Check if element is scrollable
        const isScrollable = (overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight;
        
        // Special case: document/body/html might check slightly differently, but usually they are caught here 
        // or loop finishes and we fallback to window scroll.
        
        if (isScrollable) {
           // We found a scroll container!
           const canScrollDown = e.deltaY > 0 && current.scrollTop + current.clientHeight < current.scrollHeight;
           const canScrollUp = e.deltaY < 0 && current.scrollTop > 0;
           
           if (canScrollDown || canScrollUp) {
             current.scrollTop += e.deltaY;
             current.scrollLeft += e.deltaX;
             scrolled = true;
             break; // Stop bubbling once we found the target
           }
        }
        
        current = current.parentElement;
      }

      // If no internal scroll container found, scroll the window
      // (This handles the standard document body scroll case)
      if (!scrolled) {
        win.scrollBy({
          top: e.deltaY,
          left: e.deltaX,
          behavior: 'auto'
        });
      }
    } else {
        // Fallback if no element found
        win.scrollBy({
          top: e.deltaY,
          left: e.deltaX,
          behavior: 'auto'
        });
    }

    setHoveredElements([]);
    
    // Clear global hover state on scroll
    import('../../lib/visual-editor').then(({ setHoveredElement }) => {
      setHoveredElement(null);
    });

    // Hide prompt box when scrolling, but keep selection active
    setIsPromptVisible(false);

    // Immediately refresh positions after scroll so selection highlight follows element
    requestAnimationFrame(() => {
      refreshPositions();
    });
  }, [iframeRef, refreshPositions]);

  // Handle close selection
  const handleCloseSelection = useCallback(() => {
    setSelectedElements([]);
    selectedDomElementsRef.current = [];
    setIsPromptVisible(false);
    setEditError(null);
    clearSelection(); // Clear global selection state
  }, []);

  // Close just the prompt UI but keep selection active (for after submitting)
  const handleClosePromptOnly = useCallback(() => {
    setSelectedElements([]);
    selectedDomElementsRef.current = [];
    setIsPromptVisible(false);
    setEditError(null);
    // Don't clear global selection - keep it for Select Parent and other operations
  }, []);

  // Store current AI options for queue processing
  const aiOptionsRef = useRef<AiOptions | null>(null);

  // Process the next item in the queue
  const processQueueItem = useCallback(async () => {
    const queuedItem = dequeueVisualEdit();
    if (!queuedItem || !globalSelectedElement) return;

    console.log('[VisualEdit] Processing queued item:', queuedItem.prompt.substring(0, 30));

    if (aiOptionsRef.current) {
      try {
        const result = await applyVisualEdit({
          element: globalSelectedElement,
          familyElements: familyElementsRef.current,
          prompt: queuedItem.prompt,
          apiOptions: aiOptionsRef.current,
        });

        if (!result.success) {
          console.error('Queued Visual Edit Failed:', result.error);
        }
      } catch (error) {
        console.error('[VisualEdit] Queue processing error:', error);
      }
    }
  }, [globalSelectedElement]);

  // Watch for visual edit completion to process queue
  useEffect(() => {
    const unsubscribe = isVisualEditing.subscribe((editing) => {
      if (!editing) {
        // Visual edit just completed - check if there are queued items
        const queue = visualEditQueue.get();
        if (queue.length > 0) {
          // Small delay to let the UI update
          setTimeout(() => {
            processQueueItem();
          }, 100);
        }
      }
    });
    return unsubscribe;
  }, [processQueueItem]);

  // Handle visual edit submission
  const handleVisualEditSubmit = useCallback(async (promptText: string) => {
    if (!globalSelectedElement || !promptText.trim()) return;

    // Find the selected model to get provider info
    const allModels = [
      ...modelConfig.gemini.savedModels.map((m: any) => ({ ...m, provider: 'gemini' as const })),
      ...modelConfig.openai.savedModels.map((m: any) => ({ ...m, provider: 'openai' as const })),
      ...modelConfig.anthropic.savedModels.map((m: any) => ({ ...m, provider: 'anthropic' as const })),
    ];

    const selectedModel = allModels.find((m: any) => m.id === selectedModelId);
    if (!selectedModel) {
      setEditError('No model selected');
      return;
    }

    // Get the API key for the provider
    const providerKeys = apiKeys[selectedModel.provider];
    const apiKey = providerKeys?.[0];

    if (!apiKey) {
      setEditError(`No API key configured for ${selectedModel.provider}`);
      return;
    }

    // Create AI options
    const aiOptions: AiOptions = {
      provider: selectedModel.provider,
      model: selectedModel.modelId,
      apiKey,
      thinkingLevel: selectedModel.thinkingLevel,
    };

    // Store for queue processing
    aiOptionsRef.current = aiOptions;

    // Check if a visual edit is already in progress
    if (isVisualEditing.get()) {
      // Add to queue instead of running immediately
      addToVisualEditQueue(promptText);
      handleClosePromptOnly(); // Close prompt but keep selection for Select Parent/Undo
      return;
    }

    // Capture element before closing prompt
    const currentElement = globalSelectedElement;

    // Close the prompt UI but keep selection active for Select Parent/Undo
    handleClosePromptOnly();

    try {
      const result = await applyVisualEdit({
        element: currentElement,
        familyElements: familyElementsRef.current,
        prompt: promptText,
        apiOptions: aiOptions,
      });

      if (!result.success) {
        console.error('Visual Edit Failed:', result.error);

        // Restore UI to show error to user
        if (iframeRef.current?.contentDocument && currentElement?.uid) {
             const el = iframeRef.current.contentDocument.querySelector(`[data-willow-uid="${currentElement.uid}"]`);
             if (el) {
                 selectedDomElementsRef.current = [el];
                 const info = getElementInfo(el);
                 setSelectedElements([info]);
                 setIsPromptVisible(true);
                 setEditError(result.error || 'Failed to apply edits');
             }
        }
      } else {
        // Edit succeeded - re-select the element after DOM rebuilds
        // Wait for the preview to rebuild and inspector to reinit
        setTimeout(() => {
          if (!iframeRef.current?.contentDocument || !currentElement?.sourceLocation) {
            // Can't re-select, clear selection
            import('../../lib/visual-editor').then(({ clearSelection }) => clearSelection());
            return;
          }

          const iframeDoc = iframeRef.current.contentDocument;
          const { fileName, line, column } = currentElement.sourceLocation;
          const sourceStr = `${fileName}:${line}:${column}`;

          // Try to find the element by source location (survives rebuild)
          let el = iframeDoc.querySelector(`[data-willow-source="${sourceStr}"]`);

          if (el) {
            // Re-assign UID and update local state
            const newUid = `el-${Math.random().toString(36).substr(2, 9)}`;
            (el as HTMLElement).dataset.willowUid = newUid;
            selectedDomElementsRef.current = [el];

            const info = getElementInfo(el);
            setSelectedElements([info]);
            setIsPromptVisible(true);
            setEditError(null);

            // Update global selection with fresh element data
            const styles = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();

            import('../../lib/visual-editor').then(({ setSelectedElements: setGlobalSelected }) => {
              setGlobalSelected([{
                uid: newUid,
                tagName: el!.tagName.toLowerCase(),
                classNames: Array.from(el!.classList),
                textContent: (el!.textContent || '').slice(0, 100),
                bounds: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
                selectorPath: el!.tagName.toLowerCase(),
                computedStyles: {
                  padding: styles.padding,
                  margin: styles.margin,
                  backgroundColor: styles.backgroundColor,
                  color: styles.color,
                  fontSize: styles.fontSize,
                  fontWeight: styles.fontWeight,
                  borderRadius: styles.borderRadius
                },
                parentPath: [],
                sourceLocation: currentElement.sourceLocation
              }]);
            });

            console.log('[VisualEdit] Re-selected element after successful edit');
          } else {
            // Element not found - clear selection
            import('../../lib/visual-editor').then(({ clearSelection }) => clearSelection());
            console.log('[VisualEdit] Could not re-find element after edit, cleared selection');
          }
        }, 700); // Wait for rebuild + inspector reinit (600ms) + small buffer
      }
    } catch (error) {
      console.error('[VisualEdit] Error:', error);
      // Clear selection on error
      import('../../lib/visual-editor').then(({ clearSelection }) => clearSelection());
    }
  }, [globalSelectedElement, selectedModelId, modelConfig, apiKeys, handleClosePromptOnly, getElementInfo]);

  // Handle exit
  const handleExit = useCallback(() => {
    handleCloseSelection();
    exitVisualEdit();
  }, [handleCloseSelection]);

  // Handle delete button click - directly removes the element without AI
  const handleDelete = useCallback(async () => {
    if (!globalSelectedElement) return;

    // Clear local selection state immediately to remove selection borders
    setSelectedElements([]);
    selectedDomElementsRef.current = [];
    familyElementsRef.current = [];
    setIsPromptVisible(false);

    const result = await deleteElement(globalSelectedElement);
    if (!result.success) {
      console.error('[VisualEditor] Delete failed:', result.error);
    }
  }, [globalSelectedElement]);

  // Handle view code button - navigate to source location with line range
  const handleViewCode = useCallback(() => {
    if (globalSelectedElement?.sourceLocation) {
      const { fileName, line, column } = globalSelectedElement.sourceLocation;

      // Try to estimate the end line by looking at the file content
      // This is a heuristic - we look for the matching closing tag
      import('../../lib/sandpack/sandpack-store').then(({ sandpackStore }) => {
        const targetFile = '/' + fileName;
        const fileContent = sandpackStore.getFile(targetFile) || sandpackStore.getFile(fileName);

        if (fileContent) {
          const lines = fileContent.split('\n');
          const startLine = line;
          let endLine = startLine;

          // Simple heuristic: scan from start line to find balanced tags
          let depth = 0;
          let foundStart = false;

          for (let i = startLine - 1; i < lines.length && i < startLine + 50; i++) {
            const lineContent = lines[i];

            // Count opening tags (simplified)
            const opens = (lineContent.match(/<[a-zA-Z]/g) || []).length;
            const closes = (lineContent.match(/<\//g) || []).length;
            const selfClosing = (lineContent.match(/\/>/g) || []).length;

            if (i === startLine - 1) {
              foundStart = true;
              depth = opens - closes - selfClosing;
            } else if (foundStart) {
              depth += opens - closes - selfClosing;
            }

            endLine = i + 1;

            // If we're back to depth 0 or negative, we've found the end
            if (foundStart && depth <= 0 && i > startLine - 1) {
              break;
            }
          }

          // Ensure at least a few lines are highlighted
          if (endLine === startLine) {
            endLine = Math.min(startLine + 3, lines.length);
          }

          navigateToCode(fileName, startLine, column, endLine);
        } else {
          navigateToCode(fileName, line, column);
        }
      });
    }
  }, [globalSelectedElement]);

  // Clear hover state when mouse leaves overlay
  const handleMouseLeave = useCallback(() => {
    setHoveredElements([]);
    import('../../lib/visual-editor').then(({ setHoveredElement }) => {
      setHoveredElement(null);
    });
  }, []);

  // Hide overlay when preview is reloading or not ready
  if (!isActive || !isInspectorReady || isReloading) return null;

  const primaryElement = selectedElements[0] || null;

  return (
    <div
      className="absolute inset-0 z-[45]"
      style={{
        background: 'transparent',
      }}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      onWheel={handleWheel}
      onMouseLeave={handleMouseLeave}
    >


      {/* Hover Highlights - No tag label, just the border */}
      {hoveredElements.map((element, index) => (
        <div
          key={`hover-${index}`}
          className="absolute pointer-events-none"
          style={{
            left: element.x,
            top: element.y,
            width: element.width,
            height: element.height,
            backgroundColor: `rgba(${SELECTION_COLOR_RGB}, 0.08)`,
            borderTopLeftRadius: element.borderTopLeftRadius,
            borderTopRightRadius: element.borderTopRightRadius,
            borderBottomLeftRadius: element.borderBottomLeftRadius,
            borderBottomRightRadius: element.borderBottomRightRadius,
            border: index === 0
              ? `2px solid ${SELECTION_COLOR}`
              : `2px dashed ${SELECTION_COLOR}`,
          }}
        />
      ))}

      {/* Selection Highlights - Tag label only on primary selected element of EACH group */}
      {(() => {
        const seenGroups = new Set<string>();
        return selectedElements.map((element, index) => {
          // Identify if this element is the "head" (primary) of its selection group
          let isPrimary = false;
          // If we have a group ID, the first one we see is primary
          if (element.selectionGroupId) {
             if (!seenGroups.has(element.selectionGroupId)) {
                isPrimary = true;
                seenGroups.add(element.selectionGroupId);
             }
          } else {
             // Fallback for legacy/ungrouped: simple index 0 check
             isPrimary = index === 0;
          }

          return (
          <div
            key={`select-${index}`}
            ref={(el) => {
                if (el) selectionOverlayRefs.current.set(index, el);
                else selectionOverlayRefs.current.delete(index);
            }}
            className="absolute pointer-events-none"
            style={{
              left: element.x,
              top: element.y,
              width: element.width,
              height: element.height,
              backgroundColor: isPrimary
                ? `rgba(${SELECTION_COLOR_RGB}, 0.12)`
                : `rgba(${SELECTION_COLOR_RGB}, 0.06)`,
              borderTopLeftRadius: element.borderTopLeftRadius,
              borderTopRightRadius: element.borderTopRightRadius,
              borderBottomLeftRadius: element.borderBottomLeftRadius,
              borderBottomRightRadius: element.borderBottomRightRadius,
              border: isPrimary
                ? `2px solid ${SELECTION_COLOR}`
                : `2px dashed ${SELECTION_COLOR}`,
              boxShadow: isPrimary
                ? `0 0 0 1px rgba(${SELECTION_COLOR_RGB}, 0.3), 0 4px 12px rgba(${SELECTION_COLOR_RGB}, 0.15)`
                : 'none',
              clipPath: element.clipTop ? `inset(${element.clipTop}px 0 0 0)` : undefined,
            }}
          >
            {/* Tag label - only on click/selected, not hover */}
            {isPrimary && (
              <div
                className="absolute -top-7 left-0 px-2 py-1 text-white text-xs font-medium rounded flex items-center gap-1.5"
                style={{ backgroundColor: SELECTION_COLOR }}
              >
                <span>{element.tagName}</span>
              </div>
            )}
          </div>
        );
      });
      })()}

      {/* Floating Toolbar - Smart positioning to stay in viewport */}
      <AnimatePresence>
        {primaryElement && !scanning && isPromptVisible && (() => {
          // Calculate optimal position for the prompt box
          let viewportWidth = window.innerWidth;
          let viewportHeight = window.innerHeight;

          if (iframeRef.current) {
            const rect = iframeRef.current.getBoundingClientRect();
            viewportWidth = rect.width;
            viewportHeight = rect.height;
          }

          // Use a safe estimate for the box width (slightly larger than actual to be safe)
          const SAFE_BOX_WIDTH = 420;

          // Default: align left edge with selection, position below
          let left = primaryElement.x;
          let top = primaryElement.y + primaryElement.height + 10;

          // Clamp left position to keep prompt fully visible
          const minLeft = EDGE_PADDING;
          const maxLeft = viewportWidth - SAFE_BOX_WIDTH - EDGE_PADDING;

          // Ensure strictly bounded
          left = Math.max(minLeft, Math.min(left, maxLeft));

          // Handle vertical positioning
          const belowWorks = top + PROMPT_BOX_HEIGHT <= viewportHeight - EDGE_PADDING;
          const aboveTop = primaryElement.y - PROMPT_BOX_HEIGHT - 10;
          const aboveWorks = aboveTop >= EDGE_PADDING;

          if (!belowWorks) {
            if (aboveWorks) {
              // Position above the selection
              top = aboveTop;
            } else {
              // Neither above nor below works - position ON the selection (centered)
              top = primaryElement.y + (primaryElement.height / 2) - (PROMPT_BOX_HEIGHT / 2);
              // Clamp to viewport
              top = Math.max(EDGE_PADDING, Math.min(top, viewportHeight - PROMPT_BOX_HEIGHT - EDGE_PADDING));
            }
          }

          return (
            <motion.div
              key="floating-prompt"
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{
                duration: 0.15,
                ease: 'easeOut',
                layout: { duration: 0.2, ease: 'easeOut' }
              }}
              className="absolute pointer-events-auto z-[55] dark"
              style={{
                left,
                top,
                width: 'max-content',
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseMove={(e) => {
                e.stopPropagation();
                // Clear any hover highlight when over the prompt box
                setHoveredElements([]);
              }}
            >
              <AIInputWithLoading
                placeholder="Describe the change..."
                onClose={handleCloseSelection}
                onSubmit={handleVisualEditSubmit}
                onCode={handleViewCode}
                onDelete={handleDelete}
                isLoading={isProcessing}
                error={editError}
              />
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
};

export default VisualEditingOverlay;
