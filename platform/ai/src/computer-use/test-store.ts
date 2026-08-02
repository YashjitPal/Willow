// Test Store - Manages test mode state and history
// Separate from sandpack store to keep concerns clean

import { atom } from 'nanostores';

// Generic Content type for conversation history (compatible with both old and new SDK)
export interface Content {
  role: string;
  parts: any[];
}

export type TestStatus = 'idle' | 'testing' | 'executing-action' | 'capturing' | 'complete';


export interface TestResult {
  passed: boolean;
  summary: string;
  suggestion?: string;
}

export interface TestMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isTestMessage?: boolean;
}

class TestStore {
  // Whether test mode is active
  isTestMode = atom<boolean>(false);
  
  // Current test status
  status = atom<TestStatus>('idle');
  
  // Test conversation history (for multi-turn testing)
  conversationHistory = atom<Content[]>([]);
  
  // Latest test result
  lastResult = atom<TestResult | null>(null);
  
  // Current action being executed (for UI indicator)
  currentAction = atom<string | null>(null);
  
  // Cursor position for visual feedback (normalized 0-1000, will be converted in UI)
  cursorPosition = atom<{ x: number; y: number } | null>(null);
  
  // Whether cursor is currently clicking (for click animation)
  isClicking = atom<boolean>(false);
  
  // Current thought/status message for the cursor label
  currentThought = atom<string | null>(null);
  
  // Test messages (displayed in sidebar)
  testMessages = atom<TestMessage[]>([]);
  
  // Cancellation flag - checked by test loop to stop execution
  isCancelled = atom<boolean>(false);
  
  // AbortController for immediate request cancellation
  private _abortController: AbortController | null = null;
  
  // Reference to the preview iframe (set by MainPreview, used by Sidebar)
  private _iframeRef: HTMLIFrameElement | null = null;
  
  setIframeRef(iframe: HTMLIFrameElement | null) {
    this._iframeRef = iframe;
  }
  
  getIframeRef(): HTMLIFrameElement | null {
    return this._iframeRef;
  }
  
  /**
   * Get the current AbortSignal for API calls
   */
  getAbortSignal(): AbortSignal | undefined {
    return this._abortController?.signal;
  }
  
  /**
   * Enter test mode
   */
  enterTestMode() {
    console.log('[TestStore] Entering test mode');
    this.isTestMode.set(true);
    this.isCancelled.set(false); // Reset cancellation flag
    this.status.set('idle');
    this.conversationHistory.set([]);
    this.lastResult.set(null);
    this.currentAction.set(null);
  }
  
  /**
   * Exit test mode (return to code mode)
   */
  exitTestMode() {
    console.log('[TestStore] Exiting test mode');
    this.isTestMode.set(false);
    this.status.set('idle');
    this.currentAction.set(null);
    this.cursorPosition.set(null);
    this.currentThought.set(null);
  }
  
  /**
   * Start a new test
   */
  startTest() {
    // Create new AbortController for this test
    this._abortController = new AbortController();
    this.isCancelled.set(false); // Ensure not cancelled at start
    this.status.set('testing');
    this.lastResult.set(null);
  }
  
  /**
   * Cancel an in-progress test - IMMEDIATELY aborts the request
   */
  cancelTest() {
    console.log('[TestStore] Cancelling test immediately');
    this.isCancelled.set(true);
    
    // Abort any pending API request immediately
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    
    // Immediately hide visual elements
    this.cursorPosition.set(null);
    this.currentThought.set(null);
    this.currentAction.set(null);
    
    this.exitTestMode();
  }
  
  /**
   * Set current action for UI indicator
   */
  setCurrentAction(action: string | null) {
    this.currentAction.set(action);
  }
  
  /**
   * Show cursor at center of screen (call when test starts)
   */
  showCursor() {
    // Show at center of screen (500, 500 in normalized coords)
    this.cursorPosition.set({ x: 500, y: 500 });
  }
  
  /**
   * Move cursor to position (normalized 0-1000)
   */
  moveCursor(x: number, y: number) {
    this.cursorPosition.set({ x, y });
  }
  
  /**
   * Trigger click animation
   */
  triggerClick() {
    this.isClicking.set(true);
    // Reset after animation duration
    setTimeout(() => {
      this.isClicking.set(false);
    }, 300);
  }
  
  /**
   * Hide cursor
   */
  hideCursor() {
    this.cursorPosition.set(null);
    this.isClicking.set(false);
  }
  
  /**
   * Set current thought/status for cursor label
   */
  setThought(thought: string | null) {
    this.currentThought.set(thought);
  }
  
  /**
   * Update status
   */
  setStatus(status: TestStatus) {
    this.status.set(status);
  }
  
  /**
   * Add to conversation history
   */
  addToHistory(content: Content) {
    const current = this.conversationHistory.get();
    this.conversationHistory.set([...current, content]);
  }
  
  /**
   * Set test result
   */
  setResult(result: TestResult) {
    this.lastResult.set(result);
    this.status.set('complete');
  }
  
  /**
   * Add a test message to display
   */
  addTestMessage(message: Omit<TestMessage, 'timestamp'>) {
    const current = this.testMessages.get();
    this.testMessages.set([
      ...current,
      { ...message, timestamp: Date.now() }
    ]);
  }
  
  /**
   * Clear test messages
   */
  clearTestMessages() {
    this.testMessages.set([]);
  }
  
  /**
   * Reset everything
   */
  reset() {
    this.isTestMode.set(false);
    this.status.set('idle');
    this.conversationHistory.set([]);
    this.lastResult.set(null);
    this.currentAction.set(null);
    this.currentThought.set(null);
    this.testMessages.set([]);
  }
}

// Singleton instance
export const testStore = new TestStore();
