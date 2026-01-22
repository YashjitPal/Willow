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
  
  // Test messages (displayed in sidebar)
  testMessages = atom<TestMessage[]>([]);
  
  // Reference to the preview iframe (set by MainPreview, used by Sidebar)
  private _iframeRef: HTMLIFrameElement | null = null;
  
  setIframeRef(iframe: HTMLIFrameElement | null) {
    this._iframeRef = iframe;
  }
  
  getIframeRef(): HTMLIFrameElement | null {
    return this._iframeRef;
  }
  
  /**
   * Enter test mode
   */
  enterTestMode() {
    console.log('[TestStore] Entering test mode');
    this.isTestMode.set(true);
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
  }
  
  /**
   * Start a new test
   */
  startTest() {
    this.status.set('testing');
    this.lastResult.set(null);
  }
  
  /**
   * Set current action for UI indicator
   */
  setCurrentAction(action: string | null) {
    this.currentAction.set(action);
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
    this.testMessages.set([]);
  }
}

// Singleton instance
export const testStore = new TestStore();
