// Visual Editor Store
// Central state management for the visual editing feature

import { atom } from 'nanostores';
import type { SelectedElement, InspectorMessage } from './types';
import { sandpackStore } from '../sandpack/sandpack-store';

/**
 * Whether visual edit mode is currently active
 * Only true when user clicks "Visual Edit" in Design tab
 */
export const isVisualEditMode = atom<boolean>(false);

/**
 * Whether we're currently scanning/initializing the project
 * Shows "Scanning project..." overlay
 */
export const isScanning = atom<boolean>(false);

/**
 * Whether we're currently saving visual changes to disk (simulated delay + action)
 */
export const isSaving = atom<boolean>(false);

/**
 * Whether the inspector script is ready in the iframe
 */
export const inspectorReady = atom<boolean>(false);

/**
 * Currently hovered element (null when not hovering anything)
 */
export const hoveredElement = atom<SelectedElement | null>(null);

/**
 * Currently selected element (null when nothing selected)
 */
export const selectedElement = atom<SelectedElement | null>(null);

/**
 * Currently selected elements (multi-selection support)
 */
export const selectedElements = atom<SelectedElement[]>([]);

/**
 * Whether a visual edit is currently in progress
 * When true, the generation watcher skips reinitialization
 */
export const isVisualEditing = atom<boolean>(false);

/**
 * Theme colors extracted from the preview iframe's CSS variables
 * Maps semantic color names (e.g., 'primary', 'background') to their resolved HSL/RGB values
 */
export const themeColors = atom<Record<string, string>>({});

/**
 * Queue of pending visual edit prompts
 * When a visual edit is in progress and user submits another, it's added here
 */
export interface QueuedVisualEdit {
  id: string;
  prompt: string;
  timestamp: number;
}
export const visualEditQueue = atom<QueuedVisualEdit[]>([]);

/**
 * Undo history for visual edits
 * Stores file snapshots before each visual edit
 */
export interface UndoHistoryEntry {
  id: string;
  timestamp: number;
  files: Record<string, string>; // filePath -> content snapshot
  description: string; // What was changed
}
export const undoHistory = atom<UndoHistoryEntry[]>([]);

/**
 * Whether there's anything to undo
 */
export const canUndo = atom<boolean>(false);

/**
 * Signal to request a preview refresh (used after undo)
 * Components watching this should rebuild when timestamp changes
 */
export const previewRefreshRequest = atom<number>(0);

/**
 * Signal to request selection bounds refresh after direct style changes
 * The overlay watches this to update position when margin/padding changes shift the element
 */
export const selectionBoundsRefreshRequest = atom<number>(0);

/**
 * Signal to request sidebar style re-read after undo/discard
 * The VisualEditMenu watches this to refresh its currentStyles display
 */
export const selectionStyleRefreshRequest = atom<number>(0);

/**
 * Request the selection overlay to update its bounds
 * Called after applying direct styles that may change element position
 */
export function requestSelectionBoundsRefresh(): void {
  selectionBoundsRefreshRequest.set(Date.now());
}

/**
 * Request the sidebar to re-read styles for the currently selected element
 * Called after undo/discard to sync the sidebar display
 */
export function requestSelectionStyleRefresh(): void {
  selectionStyleRefreshRequest.set(Date.now());
}

/**
 * Signal that a parent selection was requested
 * The overlay should watch this to sync its local state when parent is selected
 */
export const parentSelectionRequested = atom<number>(0);

/**
 * Whether the currently selected element is at root level (no selectable parent)
 */
export const isAtRootLevel = atom<boolean>(false);

/**
 * Pending selection to restore after preview refresh
 * Stores the sourceLocation and additional identifying info for disambiguation
 * when multiple elements share the same sourceLocation (e.g., from .map())
 */
export const pendingSelectionRestore = atom<{
  fileName: string;
  line: number;
  column: number;
  // Additional info for disambiguation when multiple elements have same sourceLocation
  textContent?: string;  // First 100 chars of textContent
  classNames?: string[]; // Class names for additional matching
  familyIndex?: number;  // DOM-order index among family siblings (for .map() elements)
} | null>(null);

/**
 * Whether there are unsaved visual edits
 */
export const hasUnsavedChanges = atom<boolean>(false);

/**
 * Snapshot of files at the start of a visual edit session (before unsaved changes)
 */
export const visualEditSessionSnapshot = atom<Record<string, string> | null>(null);

/**
 * Mark that a visual edit has occurred and capture snapshot if needed
 */
export function markAsUnsaved(): void {
  // If we don't have a snapshot yet, take one now (this is the state BEFORE this new edit applied? 
  // actually direct-style-service calls this inside applyDirectStyle... wait. 
  // If we call this inside applyDirectStyle, we should ideally capture the snapshot BEFORE the change is applied.
  // BUT applyDirectStyle works by modifying sandpackStore.
  // So we should rely on this being called EITHER:
  // 1. Just before the modification (preferred)
  // 2. Or if we want to support multiple edits, we only capture if snapshot is null.
  
  if (!visualEditSessionSnapshot.get()) {
    const currentFiles = sandpackStore.files.get();
    const snapshot: Record<string, string> = {};
    for (const [path, file] of Object.entries(currentFiles)) {
      snapshot[path] = file.content;
    }
    visualEditSessionSnapshot.set(snapshot);
    console.log('[VisualEditor] Session snapshot captured');
  }
  
  hasUnsavedChanges.set(true);
}

/**
 * Save (commit) visual changes
 * Updates the baseline to current state, so future changes are tracked from this point
 */
export async function saveVisualChanges(): Promise<void> {
  if (isSaving.get()) return;
  
  isSaving.set(true);
  console.log('[VisualEditor] Saving changes...');

  // Simulate a small delay for the animation as requested by user
  await new Promise(resolve => setTimeout(resolve, 800));

  // Capture current state as the new baseline
  const currentFiles = sandpackStore.files.get();
  const snapshot: Record<string, string> = {};
  for (const [path, file] of Object.entries(currentFiles)) {
    snapshot[path] = file.content;
  }
  visualEditSessionSnapshot.set(snapshot);
  
  hasUnsavedChanges.set(false);
  isSaving.set(false);
  
  // Keep undo history - user can still undo past the save point
  // If they do, checkUnsavedStatus will detect the difference and show the bar
  console.log('[VisualEditor] Changes saved, new baseline captured');
}

/**
 * Discard (revert) visual changes
 * Restores the snapshot from the beginning of the "unsaved" session
 * Pushes current state to undo history first, so user can "undo the discard"
 */
export async function discardVisualChanges(): Promise<void> {
  if (isSaving.get()) return;

  const snapshot = visualEditSessionSnapshot.get();
  if (!snapshot) {
    console.log('[VisualEditor] No snapshot to restore');
    return;
  }

  isSaving.set(true);
  
  // Push current state to undo history BEFORE restoring
  // This allows user to "undo the discard" if they change their mind
  pushUndoState('Before discard');

  console.log('[VisualEditor] Discarding changes, restoring snapshot');
  for (const [path, content] of Object.entries(snapshot)) {
    sandpackStore.setFile(path, content);
  }
  
  // Clear unsaved state but KEEP the baseline for future edits in this session
  hasUnsavedChanges.set(false);
  
  // Trigger preview refresh
  previewRefreshRequest.set(Date.now());

  // Refresh sidebar styles after a short delay to let preview update
  setTimeout(() => requestSelectionStyleRefresh(), 150);

  // Wait for a bit for the UI feedback
  await new Promise(resolve => setTimeout(resolve, 300));
  isSaving.set(false);
}

/**
 * Check if current file state differs from session baseline
 * Updates hasUnsavedChanges accordingly
 */
export function checkUnsavedStatus(): void {
  const baseline = visualEditSessionSnapshot.get();
  if (!baseline) {
    // No baseline means no session tracking, assume no unsaved changes
    hasUnsavedChanges.set(false);
    return;
  }

  const currentFiles = sandpackStore.files.get();
  
  // Compare current state with baseline
  for (const [path, baselineContent] of Object.entries(baseline)) {
    const currentFile = currentFiles[path];
    if (!currentFile || currentFile.content !== baselineContent) {
      hasUnsavedChanges.set(true);
      return;
    }
  }
  
  // Check if there are new files not in baseline
  for (const path of Object.keys(currentFiles)) {
    if (!(path in baseline)) {
      hasUnsavedChanges.set(true);
      return;
    }
  }
  
  // States match - no unsaved changes
  hasUnsavedChanges.set(false);
}

/**
 * Add a prompt to the visual edit queue
 */
export function addToVisualEditQueue(prompt: string): void {
  const newItem: QueuedVisualEdit = {
    id: `queue-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    prompt,
    timestamp: Date.now(),
  };
  visualEditQueue.set([...visualEditQueue.get(), newItem]);
  console.log('[VisualEditor] Added to queue:', prompt.substring(0, 30), '- Queue size:', visualEditQueue.get().length);
}

/**
 * Remove the first item from the queue and return it
 */
export function dequeueVisualEdit(): QueuedVisualEdit | null {
  const queue = visualEditQueue.get();
  if (queue.length === 0) return null;

  const [first, ...rest] = queue;
  visualEditQueue.set(rest);
  console.log('[VisualEditor] Dequeued:', first.prompt.substring(0, 30), '- Queue size:', rest.length);
  return first;
}

/**
 * Clear the entire queue
 */
export function clearVisualEditQueue(): void {
  visualEditQueue.set([]);
  console.log('[VisualEditor] Queue cleared');
}

/**
 * Push current file state to undo history before making a visual edit
 * Call this BEFORE applying any visual edit
 */
export function pushUndoState(description: string): void {
  // Get current file state from sandpackStore
  const currentFiles = sandpackStore.files.get();
  const snapshot: Record<string, string> = {};

  for (const [path, file] of Object.entries(currentFiles)) {
    snapshot[path] = file.content;
  }

  const entry: UndoHistoryEntry = {
    id: `undo-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: Date.now(),
    files: snapshot,
    description,
  };

  // Keep only last 10 undo states to limit memory usage
  const history = undoHistory.get();
  const newHistory = [...history.slice(-9), entry];
  undoHistory.set(newHistory);
  canUndo.set(true);

  console.log('[VisualEditor] Pushed undo state:', description, '- History size:', newHistory.length);
}

/**
 * Undo the last visual edit by restoring previous file state
 */
export function undoLastVisualEdit(): boolean {
  const history = undoHistory.get();
  if (history.length === 0) {
    console.log('[VisualEditor] Nothing to undo');
    return false;
  }

  // Pop the last entry
  const lastEntry = history[history.length - 1];
  const newHistory = history.slice(0, -1);
  undoHistory.set(newHistory);
  canUndo.set(newHistory.length > 0);

  // Restore files from snapshot
  console.log('[VisualEditor] Undoing:', lastEntry.description);
  for (const [path, content] of Object.entries(lastEntry.files)) {
    sandpackStore.setFile(path, content);
  }

  // Trigger preview refresh
  previewRefreshRequest.set(Date.now());

  // Check if we're back at baseline after undo
  checkUnsavedStatus();

  // Refresh sidebar styles after a short delay to let preview update
  setTimeout(() => requestSelectionStyleRefresh(), 150);

  console.log('[VisualEditor] Undo complete - History size:', newHistory.length);
  return true;
}

/**
 * Clear undo history (e.g., when starting a new session)
 */
export function clearUndoHistory(): void {
  undoHistory.set([]);
  canUndo.set(false);
  console.log('[VisualEditor] Undo history cleared');
}

/**
 * Request to select the parent element of the currently selected element
 * Sends message to the iframe inspector to select parent
 */
export function selectParentElement(): void {
  const current = selectedElement.get();
  console.log('[VisualEditor] selectParentElement called, current selection:', current?.tagName || 'none');

  if (!current) {
    console.log('[VisualEditor] No element selected, cannot select parent');
    return;
  }

  // Signal that parent selection was requested (overlay watches this)
  parentSelectionRequested.set(Date.now());

  // Send message to iframe to select parent of current element
  // Include source location so element can be found after iframe reload
  if (iframeRef?.contentWindow) {
    const sourceStr = current.sourceLocation
      ? `${current.sourceLocation.fileName}:${current.sourceLocation.line}:${current.sourceLocation.column}`
      : null;
    console.log('[VisualEditor] Sending SELECT_PARENT to iframe for:', current.tagName, 'uid:', current.uid, 'source:', sourceStr);
    iframeRef.contentWindow.postMessage({
      type: 'SELECT_PARENT',
      uid: current.uid,
      sourceLocation: sourceStr
    }, '*');
  } else {
    console.log('[VisualEditor] No iframe reference available');
  }
}

/**
 * Navigation request to open a file at a specific line in the code panel
 * Set this to trigger navigation, components should clear it after handling
 */
export interface CodeNavigationRequest {
  filePath: string;
  line: number;
  endLine?: number; // For highlighting a range of lines
  column?: number;
  timestamp: number; // To ensure each request is unique
}
export const codeNavigationRequest = atom<CodeNavigationRequest | null>(null);

/**
 * Navigate to a specific file and line (or line range) in the code panel
 * This will switch to the code tab and scroll to the line
 */
export function navigateToCode(filePath: string, line: number, column?: number, endLine?: number): void {
  console.log('[VisualEditor] Navigating to code:', filePath, 'lines', line, '-', endLine || line);
  codeNavigationRequest.set({
    filePath,
    line,
    endLine,
    column,
    timestamp: Date.now(),
  });
}

/**
 * Reference to the preview iframe for messaging
 */
let iframeRef: HTMLIFrameElement | null = null;

/**
 * Track previous generation state to detect completion
 */
let wasGenerating = false;

/**
 * Initialize subscription to sandpack generation state
 * Re-initializes visual editor when app generation completes
 */
function initGenerationWatcher(): void {
  sandpackStore.isGenerating.subscribe((isGenerating) => {
    // Detect transition from generating -> not generating
    const justFinishedGenerating = wasGenerating && !isGenerating;
    wasGenerating = isGenerating;

    // Skip reinitialization if this is a visual edit (handled separately)
    if (isVisualEditing.get()) {
      return;
    }

    // If visual edit mode is active and generation just completed, re-initialize
    if (justFinishedGenerating && isVisualEditMode.get()) {
      reinitializeInspector();
    }
  });
}

// Start watching generation state immediately
initGenerationWatcher();

/**
 * Re-initialize the inspector after iframe content changes
 * Called when app generation completes while in visual edit mode
 */
function reinitializeInspector(): void {
  // Reset state
  inspectorReady.set(false);
  isScanning.set(true);
  hoveredElement.set(null);
  selectedElement.set(null);

  // Wait for the new iframe content to be ready, then inject
  // Use longer delay since the preview needs to rebuild
  setTimeout(() => {
    injectInspectorScript();
  }, 800);
}

/**
 * Request re-injection of the inspector script
 * Called after a visual edit to ensure the inspector is available for Select Parent
 */
export function requestInspectorReinit(): void {
  if (!isVisualEditMode.get()) return;

  console.log('[VisualEditor] Requesting inspector re-injection after visual edit');
  // Use a delay to let the preview rebuild first
  setTimeout(() => {
    if (isVisualEditMode.get()) {
      injectInspectorScript();

      // After inspector is ready, restore the pending selection
      const pendingRestore = pendingSelectionRestore.get();
      if (pendingRestore && iframeRef?.contentWindow) {
        // Wait a bit more for the inspector to be fully ready
        setTimeout(() => {
          console.log('[VisualEditor] Restoring selection to:', pendingRestore);
          iframeRef?.contentWindow?.postMessage({
            type: 'RESTORE_SELECTION',
            sourceLocation: {
              fileName: pendingRestore.fileName,
              line: pendingRestore.line,
              column: pendingRestore.column,
            },
            // Pass additional info for disambiguation
            textContent: pendingRestore.textContent,
            classNames: pendingRestore.classNames,
            familyIndex: pendingRestore.familyIndex,
          }, '*');
          pendingSelectionRestore.set(null);
        }, 300);
      }
    }
  }, 500);
}

/**
 * optimized re-injection that happens instantly and silently
 * Used during iframe onLoad events where we know the DOM is ready
 * Also used after hot updates to reinitialize the inspector
 */
export function immediateInspectorReinit(): void {
  if (!isVisualEditMode.get() || !iframeRef?.contentWindow) return;

  // Inject directly without timeouts or state flickering
  const inspectorCode = getInspectorScriptContent();
  try {
     const doc = iframeRef.contentDocument;
     if (doc) {
       // ✨ Reset the inspector flag before re-injection (important for hot updates)
       // Since hot updates don't reload the page, the flag persists from the previous injection
       try {
         (iframeRef.contentWindow as any).__willowInspector = false;
       } catch (e) { /* Cross-origin access may fail, that's ok */ }

       // Clean up old inspector elements (important for hot updates where body persists)
       const existing = doc.getElementById('willow-visual-inspector');
       if (existing) existing.remove();
       const oldHoverOverlay = doc.getElementById('willow-hover-overlay');
       if (oldHoverOverlay) oldHoverOverlay.remove();
       const oldSelectionOverlay = doc.getElementById('willow-selection-overlay');
       if (oldSelectionOverlay) oldSelectionOverlay.remove();

       const script = doc.createElement('script');
       script.id = 'willow-visual-inspector';
       script.textContent = inspectorCode;
       doc.body.appendChild(script);
     } else {
        iframeRef.contentWindow.postMessage({ type: 'INIT_INSPECTOR', code: inspectorCode }, '*');
     }
  } catch(e) {
      iframeRef.contentWindow.postMessage({ type: 'INIT_INSPECTOR', code: inspectorCode }, '*');
  }

  // Mark ready immediately
  inspectorReady.set(true);
  isScanning.set(false);
}

/**
 * Store the iframe reference for communication
 */
export function setIframeRef(iframe: HTMLIFrameElement | null): void {
  iframeRef = iframe;
}

/**
 * Get the current iframe reference
 */
export function getIframeRef(): HTMLIFrameElement | null {
  return iframeRef;
}

/**
 * Enter visual edit mode
 * Called when user clicks "Visual Edit" button
 */
export function enterVisualEdit(): void {
  if (isVisualEditMode.get()) return;

  console.log('[VisualEditor] Entering visual edit mode');
  isVisualEditMode.set(true);
  isScanning.set(true);
  hoveredElement.set(null);
  selectedElement.set(null);
  
  // Capture baseline for this session (if not already set from a previous session)
  if (!visualEditSessionSnapshot.get()) {
    const currentFiles = sandpackStore.files.get();
    const snapshot: Record<string, string> = {};
    for (const [path, file] of Object.entries(currentFiles)) {
      snapshot[path] = file.content;
    }
    visualEditSessionSnapshot.set(snapshot);
    console.log('[VisualEditor] Session baseline captured');
  }
  
  // Clear undo history for fresh session
  undoHistory.set([]);
  canUndo.set(false);
  hasUnsavedChanges.set(false);

  // Check if app is currently generating
  const currentlyGenerating = sandpackStore.isGenerating.get();

  if (currentlyGenerating) {
    // If generating, don't inject yet - the generation watcher will
    // automatically re-initialize when generation completes
    console.log('[VisualEditor] App is generating, waiting for completion...');
    return;
  }

  // Not generating - inject inspector script after a brief delay
  // This simulates the "scanning" phase
  setTimeout(() => {
    injectInspectorScript();
  }, 500);
}

/**
 * Exit visual edit mode
 * Called when user leaves Design tab or clicks elsewhere
 */
export function exitVisualEdit(): void {
  console.log('[VisualEditor] Exiting visual edit mode');
  isVisualEditMode.set(false);
  isScanning.set(false);
  inspectorReady.set(false);
  hoveredElement.set(null);
  selectedElement.set(null);
  selectedElements.set([]); // Clear multi-selection state too
  
  // Clean up inspector in iframe
  if (iframeRef?.contentWindow) {
    iframeRef.contentWindow.postMessage({ type: 'CLEANUP_INSPECTOR' }, '*');
  }
}

/**
 * Select an element
 */
export function selectElement(element: SelectedElement): void {
  console.log('[VisualEditor] Element selected:', element.tagName, element.classNames);
  selectedElement.set(element);
  // Also update multi-selection to contain just this element
  selectedElements.set([element]);
}

/**
 * Set multiple selected elements
 */
export function setSelectedElements(elements: SelectedElement[]): void {
  console.log('[VisualEditor] Elements selected:', elements.length);
  selectedElements.set(elements);
  // Update primary selection to the first element
  if (elements.length > 0) {
    selectedElement.set(elements[0]);
  } else {
    selectedElement.set(null);
  }
}

/**
 * Clear element selection
 */
export function clearSelection(): void {
  selectedElement.set(null);
  selectedElements.set([]);
}

/**
 * Update hovered element
 */
export function setHoveredElement(element: SelectedElement | null): void {
  hoveredElement.set(element);
}

/**
 * Inject the inspector script into the preview iframe
 */
function injectInspectorScript(): void {
  if (!iframeRef?.contentWindow) {
    console.error('[VisualEditor] No iframe available for injection');
    isScanning.set(false);
    return;
  }

  // The inspector script content (will be injected as a script tag)
  const inspectorCode = getInspectorScriptContent();
  
  try {
    // Create and inject the script
    const doc = iframeRef.contentDocument;
    if (doc) {
      // Remove any existing inspector script
      const existing = doc.getElementById('willow-visual-inspector');
      if (existing) {
        existing.remove();
      }
      
      const script = doc.createElement('script');
      script.id = 'willow-visual-inspector';
      script.textContent = inspectorCode;
      doc.body.appendChild(script);
      
      console.log('[VisualEditor] Inspector script injected');
    }
  } catch (e) {
    console.error('[VisualEditor] Failed to inject inspector:', e);
    // Fallback: try postMessage approach
    iframeRef.contentWindow.postMessage({ type: 'INIT_INSPECTOR', code: inspectorCode }, '*');
  }
  
  // Set scanning complete after injection
  setTimeout(() => {
    isScanning.set(false);
    inspectorReady.set(true);
    console.log('[VisualEditor] Scanning complete, inspector ready');
  }, 1000);
}

/**
 * Handle messages from the inspector script
 */
export function handleInspectorMessage(message: InspectorMessage): void {
  switch (message.type) {
    case 'INSPECTOR_READY':
      inspectorReady.set(true);
      isScanning.set(false);
      // Request theme colors once inspector is ready
      requestThemeColors();
      break;

    case 'ELEMENT_HOVER':
      if (isVisualEditMode.get()) {
        hoveredElement.set(message.element);
      }
      break;

    case 'ELEMENT_SELECT':
      if (isVisualEditMode.get()) {
        selectElement(message.element);
        // Reset root level flag when a new element is selected
        isAtRootLevel.set(false);
      }
      break;

    case 'ELEMENT_DESELECT':
      clearSelection();
      break;

    case 'NO_PARENT_AVAILABLE':
      // The iframe reports no valid parent for the current element
      isAtRootLevel.set(true);
      break;

    default:
      // Handle THEME_COLORS_RESPONSE which comes from a different message flow
      if ((message as any).type === 'THEME_COLORS_RESPONSE' && (message as any).colors) {
        themeColors.set((message as any).colors);
        console.log('[VisualEditor] Theme colors received:', Object.keys((message as any).colors).length, 'colors');
      }
      break;
  }
}

/**
 * Request theme colors from the preview iframe
 * Sends GET_THEME_COLORS message, response handled in handleInspectorMessage
 */
export function requestThemeColors(): void {
  if (!iframeRef?.contentWindow) {
    console.log('[VisualEditor] Cannot request theme colors - no iframe');
    return;
  }
  
  console.log('[VisualEditor] Requesting theme colors from iframe');
  iframeRef.contentWindow.postMessage({ type: 'GET_THEME_COLORS' }, '*');
}

/**
 * Get the inspector script content
 * This runs inside the preview iframe
 */
function getInspectorScriptContent(): string {
  return `
(function() {
  if (window.__willowInspector) return;
  window.__willowInspector = true;
  
  let hoveredEl = null;
  let selectedEl = null;
  let highlightOverlay = null;
  let selectionOverlay = null;
  
  // Create overlay elements
  function createOverlay(id, color, useTransition) {
    const overlay = document.createElement('div');
    overlay.id = id;
    const transitionStyle = useTransition ? 'transition: all 0.15s ease-out;' : '';
    overlay.style.cssText = \`
      position: fixed;
      pointer-events: none;
      z-index: 999999;
      border: 2px solid \${color};
      background: \${color}20;
      \${transitionStyle}
      opacity: 0;
    \`;
    document.body.appendChild(overlay);
    return overlay;
  }

  // Hover overlay has smooth transition, selection overlay appears instantly
  highlightOverlay = createOverlay('willow-hover-overlay', '#8B5CF6', true);
  selectionOverlay = createOverlay('willow-selection-overlay', '#3B82F6', false);
  
  // Get element info
  function getElementInfo(el) {
    if (!el || el === document.body || el === document.documentElement) return null;

    const rect = el.getBoundingClientRect();
    const styles = window.getComputedStyle(el);

    // Build parent path
    const parentPath = [];
    let parent = el.parentElement;
    let depth = 0;
    while (parent && parent !== document.body && depth < 5) {
      parentPath.unshift({
        tagName: parent.tagName.toLowerCase(),
        className: parent.className?.split?.(' ')?.[0] || undefined
      });
      parent = parent.parentElement;
      depth++;
    }

    // ✨ NEW: Extract source location from data-willow-source attribute
    let sourceLocation = null;
    if (el.dataset.willowSource) {
      sourceLocation = parseSourceLocation(el.dataset.willowSource);
    }

    // Fallback: search parent elements for source location
    if (!sourceLocation) {
      let ancestor = el.parentElement;
      let ancestorDepth = 0;
      while (ancestor && ancestor !== document.body && ancestorDepth < 10) {
        if (ancestor.dataset.willowSource) {
          sourceLocation = parseSourceLocation(ancestor.dataset.willowSource);
          break;
        }
        ancestor = ancestor.parentElement;
        ancestorDepth++;
      }
    }

    // ✨ NEW: Extract component file info from data-willow-component attribute
    let componentFile = null;
    if (el.dataset.willowComponent) {
      componentFile = parseComponentFile(el.dataset.willowComponent);
    }

    // Fallback: search parent elements for component file info
    if (!componentFile) {
      let ancestor = el.parentElement;
      let ancestorDepth = 0;
      while (ancestor && ancestor !== document.body && ancestorDepth < 10) {
        if (ancestor.dataset.willowComponent) {
          componentFile = parseComponentFile(ancestor.dataset.willowComponent);
          break;
        }
        ancestor = ancestor.parentElement;
        ancestorDepth++;
      }
    }

    return {
      uid: el.dataset.willowUid || (el.dataset.willowUid = 'el-' + Math.random().toString(36).substr(2, 9)),
      tagName: el.tagName.toLowerCase(),
      classNames: Array.from(el.classList || []),
      textContent: (el.textContent || '').trim().substring(0, 100),
      bounds: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      },
      selectorPath: getSelector(el),
      computedStyles: {
        padding: styles.padding,
        margin: styles.margin,
        backgroundColor: styles.backgroundColor,
        color: styles.color,
        fontSize: styles.fontSize,
        fontWeight: styles.fontWeight,
        borderRadius: styles.borderRadius
      },
      parentPath,
      // ✨ NEW: Include source location
      sourceLocation,
      // ✨ NEW: Include component file info
      componentFile,
      // ✨ NEW: Include text source element (first descendant with direct text)
      textSourceElement: findTextSourceElement(el)
    };
  }

  // ✨ NEW: Parse source location string
  function parseSourceLocation(sourceStr) {
    if (!sourceStr) return null;
    const parts = sourceStr.split(':');
    if (parts.length !== 3) return null;

    const line = parseInt(parts[1], 10);
    const column = parseInt(parts[2], 10);

    if (isNaN(line) || isNaN(column)) return null;

    return {
      fileName: parts[0],
      line,
      column
    };
  }

  // ✨ NEW: Parse component file string
  function parseComponentFile(componentStr) {
    if (!componentStr) return null;
    // Format: "./components/Button:Button" or "@/components/Button:Button"
    const colonIndex = componentStr.lastIndexOf(':');
    if (colonIndex < 0) return null;

    const filePath = componentStr.substring(0, colonIndex);
    const componentName = componentStr.substring(colonIndex + 1);

    if (!filePath || !componentName) return null;

    return {
      filePath,
      componentName
    };
  }

  // ✨ NEW: Find the first element with direct text content (not from descendants)
  // Returns null if the element itself has direct text, or info about the first descendant with text
  function findTextSourceElement(el) {
    const NON_TEXT_TAGS = ['img', 'svg', 'hr', 'br', 'video', 'audio', 'iframe', 'canvas', 'script', 'style'];

    // Regex to match emoji characters
    const emojiRegex = /[\\u{1F300}-\\u{1F9FF}\\u{1FA00}-\\u{1FAFF}\\u{2600}-\\u{26FF}\\u{2700}-\\u{27BF}\\u{1F1E0}-\\u{1F1FF}\\u{FE00}-\\u{FE0F}\\u{200D}\\u{20E3}\\u{E0020}-\\u{E007F}]/gu;

    // Check if text is emoji-only
    function isEmojiOnly(text) {
      const withoutEmojis = text.replace(emojiRegex, '').trim();
      return withoutEmojis.length === 0 && text.trim().length > 0;
    }

    // Check if element has direct text nodes (not from children)
    function hasDirectText(element) {
      if (NON_TEXT_TAGS.includes(element.tagName.toLowerCase())) return false;

      for (const node of element.childNodes) {
        if (node.nodeType === 3) { // Text node
          const text = node.textContent?.trim();
          if (text && !isEmojiOnly(text)) {
            return true;
          }
        }
      }
      return false;
    }

    // If the element itself has direct text, no need for textSourceElement
    if (hasDirectText(el)) {
      return null;
    }

    // BFS to find first descendant with direct text
    const queue = Array.from(el.children);
    while (queue.length > 0) {
      const child = queue.shift();
      if (!child || NON_TEXT_TAGS.includes(child.tagName?.toLowerCase())) continue;

      if (hasDirectText(child)) {
        // Found a descendant with direct text - return its info
        let childSourceLocation = null;
        if (child.dataset?.willowSource) {
          childSourceLocation = parseSourceLocation(child.dataset.willowSource);
        }
        // Fallback: search parent elements for source location
        if (!childSourceLocation) {
          let ancestor = child.parentElement;
          let ancestorDepth = 0;
          while (ancestor && ancestor !== document.body && ancestorDepth < 10) {
            if (ancestor.dataset?.willowSource) {
              childSourceLocation = parseSourceLocation(ancestor.dataset.willowSource);
              break;
            }
            ancestor = ancestor.parentElement;
            ancestorDepth++;
          }
        }

        return {
          uid: child.dataset?.willowUid || (child.dataset.willowUid = 'el-' + Math.random().toString(36).substr(2, 9)),
          tagName: child.tagName.toLowerCase(),
          classNames: Array.from(child.classList || []),
          sourceLocation: childSourceLocation
        };
      }

      // Add children to queue for BFS
      if (child.children) {
        queue.push(...Array.from(child.children));
      }
    }

    return null;
  }

  // Generate CSS selector for element
  function getSelector(el) {
    if (el.id) return '#' + el.id;
    if (!el.parentElement) return el.tagName.toLowerCase();
    
    const parent = getSelector(el.parentElement);
    const siblings = Array.from(el.parentElement.children);
    const index = siblings.indexOf(el);
    const tag = el.tagName.toLowerCase();
    
    if (el.className) {
      const cls = el.className.split(' ')[0];
      if (cls) return parent + ' > .' + cls;
    }
    
    return parent + ' > ' + tag + ':nth-child(' + (index + 1) + ')';
  }
  
  // Update overlay position
  function updateOverlay(overlay, rect, show) {
    if (!overlay) return;
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.opacity = show ? '1' : '0';
  }
  
  // Mouse move handler
  document.addEventListener('mousemove', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el === hoveredEl) return;
    if (el === highlightOverlay || el === selectionOverlay) return;
    
    hoveredEl = el;
    const info = getElementInfo(el);
    
    if (info) {
      updateOverlay(highlightOverlay, info.bounds, true);
      window.parent.postMessage({ type: 'ELEMENT_HOVER', element: info }, '*');
    } else {
      updateOverlay(highlightOverlay, { top: 0, left: 0, width: 0, height: 0 }, false);
      window.parent.postMessage({ type: 'ELEMENT_HOVER', element: null }, '*');
    }
  });
  
  // Click handler
  document.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el === highlightOverlay || el === selectionOverlay) return;
    
    selectedEl = el;
    const info = getElementInfo(el);
    
    if (info) {
      updateOverlay(selectionOverlay, info.bounds, true);
      window.parent.postMessage({ type: 'ELEMENT_SELECT', element: info }, '*');
    }
  }, true);
  
  // Mouse leave
  document.addEventListener('mouseleave', () => {
    hoveredEl = null;
    updateOverlay(highlightOverlay, { top: 0, left: 0, width: 0, height: 0 }, false);
    window.parent.postMessage({ type: 'ELEMENT_HOVER', element: null }, '*');
  });

  // Message handler for commands from parent
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'CLEANUP_INSPECTOR') {
      highlightOverlay?.remove();
      selectionOverlay?.remove();
      window.__willowInspector = false;
    }

    // Handle SELECT_PARENT command
    if (e.data?.type === 'SELECT_PARENT') {
      // IMPORTANT: Try to find the target element by UID or sourceLocation FIRST
      // The internal selectedEl may be stale if user clicked a different element via the overlay
      // Priority order:
      // 1. Find by UID attribute (most reliable, always matches the current selection)
      // 2. Find by source location attribute (fallback)
      // 3. Use existing selectedEl only as last resort
      let targetEl = null;

      if (e.data.uid) {
        targetEl = document.querySelector('[data-willow-uid="' + e.data.uid + '"]');
        if (targetEl) {
          console.log('[Willow Inspector] Found element by UID:', e.data.uid);
        }
      }

      if (!targetEl && e.data.sourceLocation) {
        targetEl = document.querySelector('[data-willow-source="' + e.data.sourceLocation + '"]');
        if (targetEl) {
          console.log('[Willow Inspector] Found element by source location:', e.data.sourceLocation);
        }
      }

      // Only fallback to selectedEl if we couldn't find by UID/sourceLocation
      if (!targetEl && selectedEl) {
        targetEl = selectedEl;
        console.log('[Willow Inspector] Using fallback selectedEl');
      }

      if (targetEl) {
        const parent = targetEl.parentElement;
        if (parent && parent !== document.body && parent !== document.documentElement) {
          // Update selectedEl to the parent for future operations
          selectedEl = parent;
          const info = getElementInfo(parent);
          if (info) {
            // DON'T show iframe's selectionOverlay - the overlay component handles rendering
            // This prevents double highlights (iframe overlay + overlay component)
            window.parent.postMessage({ type: 'ELEMENT_SELECT', element: info }, '*');
            console.log('[Willow Inspector] Selected parent:', parent.tagName);
          }
        } else {
          // At root level - notify parent that there's no valid parent to select
          window.parent.postMessage({ type: 'NO_PARENT_AVAILABLE' }, '*');
          console.log('[Willow Inspector] No valid parent to select (reached body/html)');
        }
      } else {
        console.log('[Willow Inspector] Could not find element - uid:', e.data.uid, 'source:', e.data.sourceLocation);
      }
    }

    // Handle CLEAR_SELECTION_OVERLAY command (when user clicks a new element via the overlay)
    if (e.data?.type === 'CLEAR_SELECTION_OVERLAY') {
      selectedEl = null;
      updateOverlay(selectionOverlay, { top: 0, left: 0, width: 0, height: 0 }, false);
      console.log('[Willow Inspector] Cleared selection overlay');
    }

    // Handle RESTORE_SELECTION command - re-select an element by sourceLocation after refresh
    // Uses textContent and classNames for disambiguation when multiple elements share same sourceLocation
    if (e.data?.type === 'RESTORE_SELECTION' && e.data.sourceLocation) {
      const sl = e.data.sourceLocation;
      const sourceStr = sl.fileName + ':' + sl.line + ':' + sl.column;
      const matchingElements = document.querySelectorAll('[data-willow-source="' + sourceStr + '"]');

      let targetEl = null;

      if (matchingElements.length === 1) {
        // Only one match - use it directly
        targetEl = matchingElements[0];
      } else if (matchingElements.length > 1) {
        // Multiple matches (family/map elements) - use familyIndex if available
        if (typeof e.data.familyIndex === 'number' && e.data.familyIndex >= 0 && e.data.familyIndex < matchingElements.length) {
          // Direct index lookup - most reliable for .map() elements
          targetEl = matchingElements[e.data.familyIndex];
          console.log('[Willow Inspector] Restored by familyIndex:', e.data.familyIndex, 'of', matchingElements.length);
        } else {
          // Fallback: find the best one using textContent and classNames
          const targetTextContent = e.data.textContent || '';
          const targetClassNames = e.data.classNames || [];

          let bestMatch = null;
          let bestScore = -1;

          for (const el of matchingElements) {
            let score = 0;

            // Check textContent match
            const elText = (el.textContent || '').trim().substring(0, 100);
            if (targetTextContent && elText === targetTextContent) {
              score += 10;
            } else if (targetTextContent && elText.includes(targetTextContent.substring(0, 20))) {
              score += 3;
            }

            // Check class names match
            if (targetClassNames.length > 0) {
              const elClasses = Array.from(el.classList || []);
              const commonClasses = targetClassNames.filter(c => elClasses.includes(c));
              score += commonClasses.length;
            }

            if (score > bestScore) {
              bestScore = score;
              bestMatch = el;
            }
          }

          targetEl = bestMatch || matchingElements[0];
          console.log('[Willow Inspector] Found', matchingElements.length, 'elements with same sourceLocation, picked best match with score:', bestScore);
        }
      }

      if (targetEl) {
        selectedEl = targetEl;
        const info = getElementInfo(targetEl);
        if (info) {
          window.parent.postMessage({ type: 'ELEMENT_SELECT', element: info }, '*');
        }
      }
    }

    // Handle GET_THEME_COLORS command - read CSS variables from :root
    if (e.data?.type === 'GET_THEME_COLORS') {
      const semanticColors = [
        'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
        'destructive', 'destructive-foreground', 'muted', 'muted-foreground',
        'accent', 'accent-foreground', 'popover', 'popover-foreground',
        'card', 'card-foreground', 'warning', 'warning-foreground',
        'success', 'success-foreground', 'sidebar', 'sidebar-foreground',
        'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-accent',
        'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
        'border', 'input', 'ring', 'background', 'foreground'
      ];
      
      const colors = {};
      const root = getComputedStyle(document.documentElement);
      
      for (const name of semanticColors) {
        const value = root.getPropertyValue('--' + name).trim();
        if (value) {
          colors[name] = value;
        }
      }
      
      window.parent.postMessage({ type: 'THEME_COLORS_RESPONSE', colors }, '*');
      console.log('[Willow Inspector] Sent theme colors:', Object.keys(colors).length);
    }
  });
  
  // Notify parent we're ready
  window.parent.postMessage({ type: 'INSPECTOR_READY' }, '*');
  console.log('[Willow Inspector] Initialized');
})();
  `;
}

// Export as singleton-like object for convenience
export const visualEditorStore = {
  isVisualEditMode,
  isScanning,
  inspectorReady,
  hoveredElement,
  selectedElement,
  selectedElements,
  isVisualEditing,
  setIframeRef,
  getIframeRef,
  enterVisualEdit,
  exitVisualEdit,
  selectElement,
  setSelectedElements,
  clearSelection,
  setHoveredElement,
  handleInspectorMessage,
};
