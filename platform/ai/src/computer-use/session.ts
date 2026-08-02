// Computer Use API - Gemini 2.5 Computer Use Model
// Implements proper agent loop with screenshot → action → feedback cycle
// Uses the new @google/genai SDK

import { GoogleGenAI, Part, Content, FunctionCall } from '@google/genai';
import { testStore } from './test-store';
import { COMPUTER_USE_MODEL, TEST_INTRO_MODEL } from '@models';

// ============================================================================
// Types
// ============================================================================

export interface TestUpdate {
  type: 'thinking' | 'action' | 'screenshot' | 'text' | 'complete' | 'error' | 'plan';
  message: string;
  actionName?: string;
  thought?: string;
  actionType?: string;
  thoughtSignature?: string;
}

export interface TestResult {
  passed: boolean;
  explanation: string;
  actionsPerformed: string[];
}

export interface ComputerUseTaskResult {
  completed: boolean;
  explanation: string;
  actionsPerformed: string[];
  /** True when the page opened but browser same-origin rules stopped automation. */
  limited?: boolean;
}

// Conversation message for context
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ComputerUseAction {
  name: string;
  args: Record<string, unknown>;
  safetyDecision?: {
    decision: string;
    explanation: string;
  };
}

// ============================================================================
// Constants
// ============================================================================

// Re-export for convenience (model name is defined in /defaultmodel.ts)
export { COMPUTER_USE_MODEL };

// Recommended screen dimensions for Computer Use
const SCREEN_WIDTH = 1440;
const SCREEN_HEIGHT = 900;

// Maximum turns in agent loop to prevent infinite loops
const MAX_AGENT_TURNS = 25;

// System prompt for testing context
const COMPUTER_USE_SYSTEM_PROMPT = `You are a QA tester for a web app. Test what the user asks, then give a clean summary.

TESTING RULES:
- Do ONE action per turn, wait for screenshot, then do next action
- Complete the entire test before giving your summary
- If you can't see something, scroll to find it
- Don't repeat the same action - test once and move on

IMPORTANT - TYPING IN TEXT FIELDS:
- Before typing, check if the input field is already focused (has blinking cursor or highlighted border)
- If NOT focused: click_at on the input field first → wait for screenshot → then type_text_at
- If ALREADY focused (you just clicked it): skip the click, just use type_text_at directly
- Do NOT click on an input that is already selected/focused - this wastes a turn
- To REPLACE existing text (delete and type new), use clear_before_typing: true in your type_text_at action
- To APPEND to existing text, use clear_before_typing: false (default)

WHEN DONE, GIVE A CLEAN SUMMARY:
ONLY provide the summary in the specified format. Do NOT include any other text, commentary, reasoning, or conversation before or after these sections. Your final answer should be simple and easy to read using this EXACT format (note the space after each colon):

**Result:** YES or NO

**What I tested:**
- [First thing you tested]
- [Second thing you tested]

**What happened:**
- [Result of first test]
- [Result of second test]

**Conclusion:** [One sentence summary]

IMPORTANT FORMATTING:
- Always include a SPACE after the colon (e.g., "**Result:** YES" not "**Result:**YES")
- Keep each section on its own line with a blank line between sections

EXAMPLE OF GOOD OUTPUT:
**Result:** YES

**What I tested:**
- Adding two numbers (2 + 3)
- The clear button

**What happened:**
- Clicked 2, +, 3, = and got 5 (correct!)
- Clicked clear and it reset to 0

**Conclusion:** The calculator works perfectly.

BAD OUTPUT (don't do this):
- "**Result:**YES" (missing space after colon)
- Including ANY text before the "**Result:**" line
- Including ANY text after the conclusion
- Long paragraphs with technical explanations
- Mathematical verification steps
- Internal reasoning like "let me verify..."
- Just saying "Test completed"


YOU SHOULD STRICTLY NOT WRITE ANYTHING BEFORE "RESULT" AND AFTER "CONCLUSION".


Keep it simple, clean, and strictly limited to the sections above!`;


// System prompt for generating the intro paragraph (before testing starts)
const TEST_INTRO_SYSTEM_PROMPT = `You are a QA tester. The user will ask you to test something. 

Your job is to write ONE short paragraph (2-3 sentences max) explaining what you will test.

Example:
User: "test the calculator"
You: "I'll test the calculator by entering some numbers and operations. I'll try addition and see if the result is correct."

Keep it brief and conversational. Don't use bullet points or formatting - just a simple paragraph.`;

/**
 * System instructions for Spark's local browser surface.  This intentionally
 * stays separate from the QA prompt above: Spark is asked to complete a task,
 * not to produce a test report.  The browser is an iframe, so the agent must
 * also be honest when a cross-origin page cannot be inspected from the app.
 */
const COMPUTER_USE_TASK_SYSTEM_PROMPT = `You are Willow Spark's local computer-use agent.

Complete the user's request in the browser shown in the screenshot. Use exactly one
computer action per turn, wait for the next screenshot, and then continue. Prefer
click_at, type_text_at, scroll_at, key_combination, and navigate. Do not claim that
an action succeeded unless the tool result says it succeeded. Do not perform a
destructive or irreversible action unless the user explicitly asked for it.

If the page cannot be inspected because it is cross-origin or blocked from being
embedded, explain that limitation plainly and stop. When the task is complete,
return a concise user-facing summary of what was done and any remaining limitation.`;

// Custom Function Declarations to simulate Computer Use on models like gemini-3.5-flash
const LOCAL_COMPUTER_USE_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'click_at',
        description: 'Click at specified normalized coordinates (x, y) on the screen. Coordinates must be normalized 0-1000.',
        parameters: {
          type: 'OBJECT',
          properties: {
            x: { type: 'INTEGER', description: 'Normalized X coordinate (0-1000)' },
            y: { type: 'INTEGER', description: 'Normalized Y coordinate (0-1000)' }
          },
          required: ['x', 'y']
        }
      },
      {
        name: 'type_text_at',
        description: 'Type text at specified normalized coordinates (x, y). Coordinates must be normalized 0-1000.',
        parameters: {
          type: 'OBJECT',
          properties: {
            x: { type: 'INTEGER', description: 'Normalized X coordinate (0-1000)' },
            y: { type: 'INTEGER', description: 'Normalized Y coordinate (0-1000)' },
            text: { type: 'STRING', description: 'The text content to type' },
            press_enter: { type: 'BOOLEAN', description: 'Whether to press enter key after typing' },
            clear_before_typing: { type: 'BOOLEAN', description: 'Whether to clear existing text first' }
          },
          required: ['x', 'y', 'text']
        }
      },
      {
        name: 'hover_at',
        description: 'Hover cursor at specified normalized coordinates (x, y).',
        parameters: {
          type: 'OBJECT',
          properties: {
            x: { type: 'INTEGER', description: 'Normalized X coordinate (0-1000)' },
            y: { type: 'INTEGER', description: 'Normalized Y coordinate (0-1000)' }
          },
          required: ['x', 'y']
        }
      },
      {
        name: 'scroll_at',
        description: 'Scroll element at (x, y) in a direction (up, down, left, right).',
        parameters: {
          type: 'OBJECT',
          properties: {
            x: { type: 'INTEGER', description: 'Normalized X coordinate (0-1000)' },
            y: { type: 'INTEGER', description: 'Normalized Y coordinate (0-1000)' },
            direction: { type: 'STRING', description: 'Scroll direction ("up", "down", "left", "right")' },
            magnitude: { type: 'INTEGER', description: 'Pixels to scroll (default 200)' }
          },
          required: ['x', 'y', 'direction']
        }
      },
      {
        name: 'scroll_document',
        description: 'Scroll document in a direction (up, down).',
        parameters: {
          type: 'OBJECT',
          properties: {
            direction: { type: 'STRING', description: 'Scroll direction ("up", "down")' }
          },
          required: ['direction']
        }
      },
      {
        name: 'drag_and_drop',
        description: 'Drag mouse from (x, y) to destination_x, destination_y.',
        parameters: {
          type: 'OBJECT',
          properties: {
            x: { type: 'INTEGER', description: 'Normalized start X coordinate' },
            y: { type: 'INTEGER', description: 'Normalized start Y coordinate' },
            destination_x: { type: 'INTEGER', description: 'Normalized destination X coordinate' },
            destination_y: { type: 'INTEGER', description: 'Normalized destination Y coordinate' }
          },
          required: ['x', 'y', 'destination_x', 'destination_y']
        }
      },
      {
        name: 'key_combination',
        description: 'Press a keyboard key combination (e.g. "Control+a", "Enter", "Tab").',
        parameters: {
          type: 'OBJECT',
          properties: {
            keys: { type: 'STRING', description: 'Key combo string' }
          },
          required: ['keys']
        }
      },
      {
        name: 'wait_5_seconds',
        description: 'Wait for 5 seconds.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'go_back',
        description: 'Navigate back in history.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'go_forward',
        description: 'Navigate forward in history.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'navigate',
        description: 'Navigate to specified URL.',
        parameters: {
          type: 'OBJECT',
          properties: {
            url: { type: 'STRING', description: 'URL string' }
          },
          required: ['url']
        }
      },
      {
        name: 'search',
        description: 'Navigate to search engine.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'open_web_browser',
        description: 'Verify if browser is open.',
        parameters: { type: 'OBJECT', properties: {} }
      }
    ]
  }
];

// ============================================================================
// Helpers
// ============================================================================

function getActionType(name: string, args: any): string {
  if (name === 'click_at') return 'Clicking';
  if (name === 'type_text_at') return 'Typing';
  if (name === 'hover_at') return 'Hovering';
  if (name === 'scroll_at' || name === 'scroll_document') return 'Scrolling';
  if (name === 'drag_and_drop') return 'Dragging';
  if (name === 'key_combination') return 'Hotkey';
  if (name === 'wait_5_seconds') return 'Waiting';
  if (name === 'go_back') return 'Navigating back';
  if (name === 'go_forward') return 'Navigating forward';
  if (name === 'search') return 'Searching';
  if (name === 'navigate') return 'Navigating';
  if (name === 'open_web_browser') return 'Opening Browser';

  if (name === 'computer' || name === 'computerUse') {
    const action = args?.action;
    if (action === 'key' || action === 'type') return 'Type';
    if (action === 'mouse_click') return 'Click';
    if (action === 'scroll') return 'Scroll';
    if (action === 'mouse_move') return 'Move'; // Often implicit
    if (action === 'screenshot') return 'Analysis';
    if (args?.coordinate) return 'Move';
    return 'Action';
  }
  return 'Process';
}

// ============================================================================
// Client Management
// ============================================================================

let clientCache: { key: string; client: GoogleGenAI } | null = null;

function getClient(apiKey: string): GoogleGenAI {
  if (clientCache?.key === apiKey) {
    return clientCache.client;
  }
  const client = new GoogleGenAI({ apiKey });
  clientCache = { key: apiKey, client };
  return client;
}

// ============================================================================
// Coordinate Utilities
// ============================================================================

/**
 * Convert normalized x coordinate (0-1000) to actual pixel coordinate
 */
function denormalizeX(x: number, screenWidth: number): number {
  return Math.round((x / 1000) * screenWidth);
}

/**
 * Convert normalized y coordinate (0-1000) to actual pixel coordinate
 */
function denormalizeY(y: number, screenHeight: number): number {
  return Math.round((y / 1000) * screenHeight);
}

// ============================================================================
// Screenshot Capture
// ============================================================================

export interface ScreenshotResult {
  data: string;  // Base64 PNG data
  actualWidth: number;  // Original iframe width
  actualHeight: number;  // Original iframe height
  normalizedWidth: number;  // Standard width sent to model (1440)
  normalizedHeight: number;  // Standard height sent to model (900)
  isFallback?: boolean;  // True if this is a fallback screenshot (content didn't load)
}

/**
 * Capture a screenshot of an iframe and normalize it to standard resolution.
 *
 * The Computer Use model works best at specific resolutions. We:
 * 1. Capture the iframe at its actual size
 * 2. Scale it to 1440x900 (the standard size)
 * 3. Return scaling factors so coordinates can be converted back
 *
 * This ensures the model always sees the same resolution regardless of actual iframe size.
 */
export async function captureIframeScreenshot(
  iframe: HTMLIFrameElement,
  retryCount: number = 0
): Promise<ScreenshotResult> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 500; // ms

  return new Promise((resolve, reject) => {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        reject(new Error('Cannot access iframe document'));
        return;
      }

      const rect = iframe.getBoundingClientRect();
      let actualWidth = rect.width;
      let actualHeight = rect.height;

      // Validate dimensions - if invalid, use fallback dimensions
      // This prevents NaN/Infinity errors in gradient calculations
      if (!actualWidth || !actualHeight || !isFinite(actualWidth) || !isFinite(actualHeight) || actualWidth < 1 || actualHeight < 1) {
        console.warn(`[ComputerUse] Invalid iframe dimensions: ${actualWidth}x${actualHeight}, using defaults`);
        actualWidth = SCREEN_WIDTH;
        actualHeight = SCREEN_HEIGHT;
      }

      // Get current scroll position
      const scrollX = iframeDoc.documentElement?.scrollLeft || iframeDoc.body?.scrollLeft || 0;
      const scrollY = iframeDoc.documentElement?.scrollTop || iframeDoc.body?.scrollTop || 0;

      console.log(`[ComputerUse] === SCREENSHOT (attempt ${retryCount + 1}/${MAX_RETRIES + 1}) ===`);
      console.log(`[ComputerUse] Actual iframe size: ${actualWidth}x${actualHeight}`);
      console.log(`[ComputerUse] Will normalize to: ${SCREEN_WIDTH}x${SCREEN_HEIGHT}`);

      // Helper to create fallback screenshot
      const createFallbackScreenshot = (width: number, height: number): ScreenshotResult => {
        const canvas = document.createElement('canvas');
        canvas.width = SCREEN_WIDTH;
        canvas.height = SCREEN_HEIGHT;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#1c1c1c';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#666';
          ctx.font = '16px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Preview Screenshot', canvas.width / 2, canvas.height / 2);
        }
        const dataUrl = canvas.toDataURL('image/png');
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        return {
          data: base64Data,
          actualWidth: width || SCREEN_WIDTH,
          actualHeight: height || SCREEN_HEIGHT,
          normalizedWidth: SCREEN_WIDTH,
          normalizedHeight: SCREEN_HEIGHT,
          isFallback: true, // Mark as fallback for retry logic
        };
      };

      import('html2canvas').then(({ default: html2canvas }) => {
        html2canvas(iframeDoc.documentElement, {
          width: actualWidth,
          height: actualHeight,
          windowWidth: actualWidth,
          windowHeight: actualHeight,
          x: scrollX,
          y: scrollY,
          backgroundColor: '#1c1c1c',
          useCORS: true,
          allowTaint: true,
          scale: 1,
          logging: false,
        }).then(originalCanvas => {
          // Check if the canvas has meaningful content (not just a solid color)
          const ctx = originalCanvas.getContext('2d');
          let hasContent = true;

          if (ctx) {
            // Sample pixels from different areas to check for actual content
            const samples = [
              ctx.getImageData(Math.floor(originalCanvas.width / 4), Math.floor(originalCanvas.height / 4), 1, 1),
              ctx.getImageData(Math.floor(originalCanvas.width / 2), Math.floor(originalCanvas.height / 2), 1, 1),
              ctx.getImageData(Math.floor(3 * originalCanvas.width / 4), Math.floor(3 * originalCanvas.height / 4), 1, 1),
            ];

            // Check if all samples are the same color (likely empty/solid background)
            const firstPixel = samples[0].data;
            const allSame = samples.every(sample =>
              sample.data[0] === firstPixel[0] &&
              sample.data[1] === firstPixel[1] &&
              sample.data[2] === firstPixel[2]
            );

            // If all samples are the same AND it's a dark color (background), content may not be loaded
            if (allSame && firstPixel[0] < 50 && firstPixel[1] < 50 && firstPixel[2] < 50) {
              hasContent = false;
              console.warn('[ComputerUse] Screenshot appears to be empty (solid dark background)');
            }
          }

          // If no content detected and we haven't exceeded retries, try again
          if (!hasContent && retryCount < MAX_RETRIES) {
            console.log(`[ComputerUse] Retrying screenshot in ${RETRY_DELAY}ms...`);
            setTimeout(() => {
              captureIframeScreenshot(iframe, retryCount + 1).then(resolve).catch(reject);
            }, RETRY_DELAY);
            return;
          }

          // Create a new canvas at the normalized size (1440x900)
          const normalizedCanvas = document.createElement('canvas');
          normalizedCanvas.width = SCREEN_WIDTH;
          normalizedCanvas.height = SCREEN_HEIGHT;
          const normalizedCtx = normalizedCanvas.getContext('2d');

          if (normalizedCtx) {
            // Scale the original capture to fit the normalized canvas
            normalizedCtx.drawImage(
              originalCanvas,
              0, 0, originalCanvas.width, originalCanvas.height,  // Source
              0, 0, SCREEN_WIDTH, SCREEN_HEIGHT  // Destination (scaled)
            );
          }

          const dataUrl = normalizedCanvas.toDataURL('image/png');
          const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

          console.log(`[ComputerUse] Normalized screenshot size: ${SCREEN_WIDTH}x${SCREEN_HEIGHT}`);
          console.log(`[ComputerUse] Scale factors: X=${(actualWidth/SCREEN_WIDTH).toFixed(3)}, Y=${(actualHeight/SCREEN_HEIGHT).toFixed(3)}`);

          resolve({
            data: base64Data,
            actualWidth,
            actualHeight,
            normalizedWidth: SCREEN_WIDTH,
            normalizedHeight: SCREEN_HEIGHT,
          });
        }).catch(err => {
          // Handle html2canvas errors (including gradient errors)
          // This catches "Failed to execute 'addColorStop' on 'CanvasGradient': The provided double value is non-finite"
          console.warn('[ComputerUse] html2canvas rendering failed:', err.message);

          // Retry on error if we haven't exceeded retries
          if (retryCount < MAX_RETRIES) {
            console.log(`[ComputerUse] Retrying screenshot in ${RETRY_DELAY}ms after error...`);
            setTimeout(() => {
              captureIframeScreenshot(iframe, retryCount + 1).then(resolve).catch(reject);
            }, RETRY_DELAY);
          } else {
            console.warn('[ComputerUse] Max retries exceeded, using fallback');
            resolve(createFallbackScreenshot(actualWidth, actualHeight));
          }
        });
      }).catch(err => {
        console.warn('[ComputerUse] html2canvas not available, using fallback:', err.message);
        resolve(createFallbackScreenshot(actualWidth, actualHeight));
      });
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================================
// Action Execution
// ============================================================================

/**
 * Execute an action on the iframe
 * @param action - The action to execute
 * @param iframe - The iframe element
 * @param screenshotDimensions - The dimensions of the screenshot the model analyzed (CRITICAL for coordinate mapping)
 * Returns true if action was executed successfully
 */
async function executeAction(
  action: ComputerUseAction,
  iframe: HTMLIFrameElement,
  screenshotDimensions: { width: number; height: number }
): Promise<{ success: boolean; error?: string }> {
  try {
    const iframeWindow = iframe.contentWindow;
    if (!iframeWindow) {
      return { success: false, error: 'Cannot access iframe content' };
    }

    // Reading `contentWindow.document` throws for a cross-origin frame.  URL
    // navigation is still allowed by the browser in that situation, so defer
    // the document requirement until actions that actually inspect the page.
    let iframeDocument: Document | null = null;
    try {
      iframeDocument = iframe.contentDocument || iframeWindow.document;
    } catch {
      iframeDocument = null;
    }
    
    // CRITICAL: Use the ACTUAL dimensions for clicking, not the normalized ones
    // The model sees 1440x900, but we need to click on the actual iframe size
    const actualDimensions = screenshotDimensions;
    
    const { name, args } = action;

    if (!iframeDocument && !['navigate', 'search', 'go_back', 'go_forward', 'open_web_browser'].includes(name)) {
      return { success: false, error: 'The embedded page is cross-origin and cannot be controlled from Willow.' };
    }
    
    console.log(`[ComputerUse] Executing action: ${name}`, args);
    
    // Update cursor thought for the action
    let actionThought = '';
    if (name === 'click_at') actionThought = 'Clicking...';
    else if (name === 'type_text_at') actionThought = 'Typing...';
    else if (name === 'hover_at') actionThought = 'Hovering...';
    else if (name === 'scroll_at') actionThought = 'Scrolling...';
    else if (name === 'navigate') actionThought = 'Navigating...';
    else if (name === 'go_back') actionThought = 'Going back...';
    else if (name === 'go_forward') actionThought = 'Going forward...';
    
    if (actionThought) {
       testStore.setThought(actionThought);
    }
    
    switch (name) {
      case 'click_at': {
        const rawX = args.x as number;
        const rawY = args.y as number;
        
        // Model sees 1440x900 normalized screenshot
        // Convert model coordinates to actual iframe coordinates
        // Formula: actualCoord = (modelCoord / normalizedSize) * actualSize
        const scaleX = actualDimensions.width / SCREEN_WIDTH;
        const scaleY = actualDimensions.height / SCREEN_HEIGHT;
        
        let x: number, y: number;
        
        if (rawX <= 1000 && rawY <= 1000) {
          // Normalized coordinates (0-1000) - convert to actual pixels
          // First to 1440x900 space, then scale to actual
          const normalized1440X = (rawX / 1000) * SCREEN_WIDTH;
          const normalized1440Y = (rawY / 1000) * SCREEN_HEIGHT;
          x = Math.round(normalized1440X * scaleX);
          y = Math.round(normalized1440Y * scaleY);
          console.log(`[ComputerUse] Normalized (0-1000) -> 1440x900 -> actual`);
        } else {
          // Model returned pixel coords in 1440x900 space - scale to actual
          x = Math.round(rawX * scaleX);
          y = Math.round(rawY * scaleY);
          console.log(`[ComputerUse] Pixel (1440x900) -> actual`);
        }
        
        // Debug logging
        console.log(`[ComputerUse] === CLICK DEBUG ===`);
        console.log(`[ComputerUse] Model coords: (${rawX}, ${rawY})`);
        console.log(`[ComputerUse] Normalized size: ${SCREEN_WIDTH}x${SCREEN_HEIGHT}`);
        console.log(`[ComputerUse] Actual iframe size: ${actualDimensions.width}x${actualDimensions.height}`);
        console.log(`[ComputerUse] Scale factors: X=${scaleX.toFixed(3)}, Y=${scaleY.toFixed(3)}`);
        console.log(`[ComputerUse] Final click coords: (${x}, ${y})`);
        
        // Move visual cursor to position
        // Visual cursor uses normalized coords (0-1000), convert actual click coords to normalized
        const visualX = (x / actualDimensions.width) * 1000;
        const visualY = (y / actualDimensions.height) * 1000;
        testStore.moveCursor(visualX, visualY);
        
        // Wait for cursor to animate to position
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Trigger click animation
        testStore.triggerClick();
        
        // Wait for click animation
        await new Promise(resolve => setTimeout(resolve, 150));
        
        const element = iframeDocument?.elementFromPoint(x, y);
        console.log(`[ComputerUse] Element at (${x}, ${y}):`, element?.tagName, element?.className, element?.textContent?.substring(0, 50));
        
        if (element) {
          // Dispatch proper mouse events for better compatibility
          const mousedownEvent = new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y });
          const mouseupEvent = new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y });
          const clickEvent = new MouseEvent('click', { bubbles: true, clientX: x, clientY: y });
          
          element.dispatchEvent(mousedownEvent);
          element.dispatchEvent(mouseupEvent);
          element.dispatchEvent(clickEvent);
          
          // Also try direct click for button elements
          if (element instanceof HTMLElement) {
            element.click();
            // Focus input elements explicitly so they can receive text
            if (element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement) {
              element.focus();
              // Trigger focus event to show blinking cursor
              element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
              // Move caret to end of existing text
              const len = element.value.length;
              element.setSelectionRange(len, len);
            } else if (element.isContentEditable) {
              element.focus();
              element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
            }
          }
          return { success: true };
        }
        return { success: false, error: `No element found at (${x}, ${y})` };
      }
      
      case 'type_text_at': {
        const x = denormalizeX(args.x as number, actualDimensions.width);
        const y = denormalizeY(args.y as number, actualDimensions.height);
        const text = args.text as string;
        const pressEnter = args.press_enter as boolean;
        const clearFirst = args.clear_before_typing as boolean;
        
        console.log(`[ComputerUse] Typing "${text}" at (${x}, ${y})`);
        
        // Move visual cursor to position
        testStore.moveCursor(args.x as number, args.y as number);
        await new Promise(resolve => setTimeout(resolve, 300));
        testStore.triggerClick(); // Click to focus
        await new Promise(resolve => setTimeout(resolve, 150));
        
        const element = iframeDocument?.elementFromPoint(x, y) as HTMLElement | null;
        if (element && ('value' in element || element.isContentEditable)) {
          element.focus();
          
          if ('value' in element) {
            const inputElement = element as HTMLInputElement | HTMLTextAreaElement;
            if (clearFirst) {
              inputElement.value = '';
            }
            inputElement.value += text;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (element.isContentEditable) {
            if (clearFirst) {
              element.textContent = '';
            }
            element.textContent += text;
            element.dispatchEvent(new Event('input', { bubbles: true }));
          }
          
          if (pressEnter) {
            element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
            element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
            
            // For forms, try to submit
            const form = element.closest('form');
            if (form) {
              form.dispatchEvent(new Event('submit', { bubbles: true }));
            }
          }
          return { success: true };
        }
        return { success: false, error: `No input element found at (${x}, ${y})` };
      }
      
      case 'hover_at': {
        const x = denormalizeX(args.x as number, actualDimensions.width);
        const y = denormalizeY(args.y as number, actualDimensions.height);
        
        console.log(`[ComputerUse] Hovering at (${x}, ${y})`);
        
        // Move visual cursor to position
        testStore.moveCursor(args.x as number, args.y as number);
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const element = iframeDocument?.elementFromPoint(x, y);
        if (element) {
          element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: x, clientY: y }));
          element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
          return { success: true };
        }
        return { success: false, error: `No element found at (${x}, ${y})` };
      }
      
      case 'scroll_at': {
        const x = denormalizeX(args.x as number, actualDimensions.width);
        const y = denormalizeY(args.y as number, actualDimensions.height);
        const direction = args.direction as string;
        const magnitude = (args.magnitude as number) || 200;
        
        console.log(`[ComputerUse] Scrolling ${direction} at (${x}, ${y})`);
        
        const element = iframeDocument?.elementFromPoint(x, y);
        if (element) {
          const scrollAmount = direction === 'down' ? magnitude : -magnitude;
          
          // Try scrolling the element first, then its parents
          let scrollTarget: Element | null = element;
          while (scrollTarget) {
            if (scrollTarget.scrollHeight > scrollTarget.clientHeight) {
              scrollTarget.scrollBy({ top: scrollAmount, behavior: 'smooth' });
              return { success: true };
            }
            scrollTarget = scrollTarget.parentElement;
          }
          
          // Fallback to document scroll
          iframeWindow.scrollBy({ top: scrollAmount, behavior: 'smooth' });
          return { success: true };
        }
        return { success: false, error: `No element found at (${x}, ${y})` };
      }
      
      case 'scroll_document': {
        const direction = args.direction as string;
        const scrollAmount = direction === 'down' ? 300 : -300;
        
        console.log(`[ComputerUse] Scrolling document ${direction}`);
        
        iframeWindow.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        return { success: true };
      }
      
      case 'key_combination': {
        const keys = (args.keys as string).split('+');
        const mainKey = keys[keys.length - 1];
        
        console.log(`[ComputerUse] Pressing key combination: ${args.keys}`);
        
        const keyEvent = new KeyboardEvent('keydown', {
          key: mainKey,
          ctrlKey: keys.includes('Control') || keys.includes('Ctrl'),
          shiftKey: keys.includes('Shift'),
          altKey: keys.includes('Alt'),
          metaKey: keys.includes('Meta') || keys.includes('Command'),
          bubbles: true,
        });
        
        iframeDocument?.dispatchEvent(keyEvent);
        return { success: true };
      }
      
      case 'wait_5_seconds': {
        console.log('[ComputerUse] Waiting 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return { success: true };
      }
      
      case 'go_back': {
        console.log('[ComputerUse] Going back');
        iframeWindow.history.back();
        return { success: true };
      }
      
      case 'go_forward': {
        console.log('[ComputerUse] Going forward');
        iframeWindow.history.forward();
        return { success: true };
      }
      
      case 'navigate': {
        const rawUrl = String(args.url ?? '').trim();
        const parsedUrl = new URL(rawUrl, globalThis.location?.href ?? 'http://localhost/');
        if (!['http:', 'https:', 'about:'].includes(parsedUrl.protocol)) {
          return { success: false, error: `Navigation to ${parsedUrl.protocol} URLs is not allowed.` };
        }
        console.log(`[ComputerUse] Navigating to ${parsedUrl.href}`);
        iframe.src = parsedUrl.href;
        return { success: true };
      }
      
      case 'open_web_browser': {
        // Browser is already open (the iframe)
        console.log('[ComputerUse] Browser already open');
        return { success: true };
      }

      case 'search': {
        console.log('[ComputerUse] Navigating to search engine (google.com)');
        iframe.src = 'https://www.google.com';
        return { success: true };
      }

      case 'drag_and_drop': {
        const x = denormalizeX(args.x as number, actualDimensions.width);
        const y = denormalizeY(args.y as number, actualDimensions.height);
        const destX = denormalizeX(args.destination_x as number, actualDimensions.width);
        const destY = denormalizeY(args.destination_y as number, actualDimensions.height);
        
        console.log(`[ComputerUse] Dragging from (${x}, ${y}) to (${destX}, ${destY})`);
        
        // Move visual cursor to start
        testStore.moveCursor(args.x as number, args.y as number);
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Simulate drag mouse events on the element
        const startElement = iframeDocument?.elementFromPoint(x, y);
        if (startElement) {
          const mousedownEvent = new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, which: 1 });
          startElement.dispatchEvent(mousedownEvent);
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Move cursor to dest
          testStore.moveCursor(args.destination_x as number, args.destination_y as number);
          await new Promise(resolve => setTimeout(resolve, 300));
          
          const mousemoveEvent = new MouseEvent('mousemove', { bubbles: true, clientX: destX, clientY: destY, which: 1 });
          const mouseupEvent = new MouseEvent('mouseup', { bubbles: true, clientX: destX, clientY: destY });
          
          const endElement = iframeDocument?.elementFromPoint(destX, destY) || startElement;
          endElement.dispatchEvent(mousemoveEvent);
          await new Promise(resolve => setTimeout(resolve, 100));
          endElement.dispatchEvent(mouseupEvent);
          
          return { success: true };
        }
        return { success: false, error: `No element found to drag at (${x}, ${y})` };
      }
      
      default:
        console.warn(`[ComputerUse] Unknown action: ${name}`);
        return { success: false, error: `Unknown action: ${name}` };
    }
  } catch (error: any) {
    console.error('[ComputerUse] Action execution failed:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Function Call Extraction
// ============================================================================

/**
 * Extract function calls from the model response
 */
function extractFunctionCalls(response: any): ComputerUseAction[] {
  const actions: ComputerUseAction[] = [];
  
  try {
    // The new SDK returns response with candidates
    const candidates = response.candidates || [];
    
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      
      for (const part of parts) {
        if (part.functionCall) {
          const action: ComputerUseAction = {
            name: part.functionCall.name,
            args: part.functionCall.args || {},
          };
          
          // Check for safety decision in args
          if (part.functionCall.args?.safety_decision) {
            action.safetyDecision = part.functionCall.args.safety_decision;
          }
          
          actions.push(action);
        }
      }
    }
  } catch (e) {
    console.warn('[ComputerUse] Failed to extract function calls:', e);
  }
  
  return actions;
}

/**
 * Extract text from the model response (excluding thoughts)
 */
function extractText(response: any): string {
  try {
    const candidates = response.candidates || [];
    const textParts: string[] = [];
    
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        // Skip parts that are strictly thoughts
        // @ts-ignore
        if (part.thought === true) continue;
        
        if (part.text) {
          let cleanedText = part.text;
          
          // Workaround for Gemini API bug (Issue #2121):
          // Thoughts with coordinate reasoning and random numbers can leak into regular part.text
          // prefixed with "THOUGHT:". We strip any such leaked thought blocks.
          if (cleanedText.includes('THOUGHT:')) {
            cleanedText = cleanedText.replace(/THOUGHT:[\s\S]*?(?:\n\n|$)/gi, '');
          }
          
          // Also strip any raw leaked coordinate thoughts/plans
          cleanedText = cleanedText.replace(/Let's click at \d+ \d+/gi, '');
          cleanedText = cleanedText.replace(/click at x=\d+ y=\d+/gi, '');
          
          // Normalize bold Result formatting (e.g. _Result:YES, **Result:**YES)
          cleanedText = cleanedText.replace(/[_*]*Result[_*:\s]+(yes|no)/gi, (match, p1) => '**Result:** ' + p1.toUpperCase());
          
          if (cleanedText.trim()) {
            textParts.push(cleanedText);
          }
        }
      }
    }
    
    return textParts.join(' ');
  } catch (e) {
    console.warn('[ComputerUse] Failed to extract text:', e);
    return '';
  }
}

/**
 * Extract thought from the model response
 */
function extractThought(response: any): string | null {
  try {
    const candidates = response.candidates || [];
    const thoughtParts: string[] = [];
    
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        // Check for native thought property
        // @ts-ignore
        if (part.thought === true && part.text) {
          thoughtParts.push(part.text);
        }
      }
    }
    
    return thoughtParts.length > 0 ? thoughtParts.join(' ') : null;
  } catch (e) {
    return null;
  }
}

/**
 * Extract thought signature (opaque token) from the model response.
 * 
 * Per official docs (https://ai.google.dev/gemini-api/docs/thought-signatures):
 * - thoughtSignature is a SIBLING field to functionCall in a Part object
 *   Example: { "functionCall": {...}, "thoughtSignature": "<Signature>" }
 * - For Gemini 2.5: Signature is on the FIRST part (regardless of type), optional to return
 * - For Gemini 3: Signature is on the first functionCall part, MANDATORY to return
 */
function extractThoughtSignature(response: any): string | null {
  try {
    const candidates = response.candidates || [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      
      // For Gemini 2.5, signature is on the FIRST part
      // For Gemini 3, signature is on the first functionCall part
      for (const part of parts) {
        // thoughtSignature is a sibling field to functionCall in the part
        // @ts-ignore
        if (part.thoughtSignature) {
          console.log('[ComputerUse] Found thoughtSignature (camelCase) on part');
          return part.thoughtSignature;
        }
        // @ts-ignore - REST API might use snake_case
        if (part.thought_signature) {
          console.log('[ComputerUse] Found thought_signature (snake_case) on part');
          return part.thought_signature;
        }
      }
    }
  } catch (e) {
    console.warn('[ComputerUse] Error extracting thought signature:', e);
  }
  return null;
}

// ============================================================================
// Main Agent Loop
// ============================================================================

/**
 * Run the Computer Use test agent loop
 * 
 * Flow:
 * 1. Capture initial screenshot
 * 2. Send to model with Computer Use tool
 * 3. If model returns function calls → execute them → capture new screenshot → send function response
 * 4. Repeat until model returns text without function calls (task complete)
 */
export async function runComputerUseTest(
  apiKey: string,
  userPrompt: string,
  iframe: HTMLIFrameElement,
  onUpdate: (update: TestUpdate) => void,
  conversationHistory: ConversationMessage[] = [], // Full conversation for context
  shouldCancel?: () => boolean, // Optional cancellation checker
  abortSignal?: AbortSignal // Optional AbortSignal for immediate cancellation
): Promise<TestResult> {
  const actionsPerformed: string[] = [];
  
  try {
    const client = getClient(apiKey);
    
    // ========================================
    // PHASE 1: INTRO (before testing starts)
    // ========================================
    onUpdate({ type: 'thinking', message: 'Preparing...' });
    testStore.setThought('Preparing...');

    // Build conversation context summary for the model
    let conversationContext = '';
    if (conversationHistory.length > 0) {
      // Include recent conversation for context (limit to avoid token overflow)
      const recentHistory = conversationHistory.slice(-10); // Last 10 messages
      conversationContext = '\n\nPrevious conversation for context:\n' +
        recentHistory.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.substring(0, 500)}${msg.content.length > 500 ? '...' : ''}`).join('\n');
    }

    // Generate a short intro paragraph (no computer use tools)
    const introResponse = await client.models.generateContent({
      model: TEST_INTRO_MODEL, // Defined in /defaultmodel.ts
      contents: [{ role: 'user', parts: [{ text: `Test request: ${userPrompt}${conversationContext}` }] }],
      config: {
        systemInstruction: TEST_INTRO_SYSTEM_PROMPT,
        // @ts-ignore - Native Thinking/Thought Signature config
        thinkingConfig: {
          thinkingLevel: 'low' as any,
        },
        abortSignal: abortSignal, // Allow cancellation during intro
      },
    });
    
    // Extract the intro text
    const introText = introResponse.candidates?.[0]?.content?.parts?.[0]?.text || 
      `I'll test: ${userPrompt}`;
    
    console.log('[ComputerUse] Intro generated:', introText);
    
    // Send the intro to the UI (this appears BEFORE indicators)
    onUpdate({ type: 'plan', message: introText });
    
    // Small delay to let the intro render before starting testing
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Check for cancellation after intro
    if (shouldCancel && shouldCancel()) {
      console.log('[ComputerUse] Test cancelled after intro');
      testStore.hideCursor();
      return {
        passed: false,
        explanation: 'Test was cancelled by user.',
        actionsPerformed: actionsPerformed,
      };
    }
    
    // ========================================
    // PHASE 2: TESTING (with computer use)
    // ========================================

    // Show cursor and start testing
    testStore.showCursor();
    testStore.setThought('Starting test...');

    onUpdate({ type: 'thinking', message: 'Starting test...' });

    // Wait for iframe content to be ready before capturing screenshot
    // This prevents the "black screen" issue when content hasn't loaded yet
    onUpdate({ type: 'screenshot', message: 'Waiting for content to load...' });
    testStore.setThought('Waiting for content...');

    const maxWaitTime = 5000; // 5 seconds max wait
    const checkInterval = 200; // Check every 200ms
    let waited = 0;

    while (waited < maxWaitTime) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          // Check if iframe has meaningful content (not just empty body)
          const body = iframeDoc.body;
          const hasContent = body && (
            body.children.length > 0 ||
            (body.textContent && body.textContent.trim().length > 0)
          );

          // Also check if document is fully loaded
          const isReady = iframeDoc.readyState === 'complete';

          if (hasContent && isReady) {
            console.log(`[ComputerUse] Iframe content ready after ${waited}ms`);
            break;
          }
        }
      } catch (e) {
        // Cross-origin access error - iframe might be loading
        console.log('[ComputerUse] Waiting for iframe access...');
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
    }

    if (waited >= maxWaitTime) {
      console.warn('[ComputerUse] Iframe content may not be fully loaded after max wait time');
    }

    // Additional small delay to let any final rendering complete
    await new Promise(resolve => setTimeout(resolve, 300));

    // Capture initial screenshot (normalized to 1440x900)
    onUpdate({ type: 'screenshot', message: 'Capturing initial screenshot...' });
    testStore.setThought('Capturing screen...');
    const initialScreenshotResult = await captureIframeScreenshot(iframe);
    console.log('[ComputerUse] Initial screenshot captured');
    console.log(`[ComputerUse] Actual: ${initialScreenshotResult.actualWidth}x${initialScreenshotResult.actualHeight}`);
    console.log(`[ComputerUse] Normalized: ${initialScreenshotResult.normalizedWidth}x${initialScreenshotResult.normalizedHeight}`);
    
    // Build initial content for testing
    const fullPrompt = `Test request: ${userPrompt}

Generated Testing Plan & Intro:
${introText}

${conversationContext ? `\n${conversationContext}
` : ''}
Please analyze the screenshot and perform the necessary actions to test this feature based on the plan above. When done, provide your conclusion with either:
- YES - the feature works correctly
- NO - the feature has issues (explain what's wrong)`;

    // Build conversation history
    const contents: Content[] = [
      {
        role: 'user',
        parts: [
          { text: fullPrompt },
          {
            inlineData: {
              mimeType: 'image/png',
              data: initialScreenshotResult.data,  // Normalized 1440x900 screenshot
            }
          } as Part,
        ],
      },
    ];
    
    // Step 3: Agent loop
    let turn = 0;
    let finalText = '';
    
    // Track dimensions for coordinate conversion
    // Model sees normalized (1440x900), but we click on actual iframe dimensions
    let currentActualDimensions = { 
      width: initialScreenshotResult.actualWidth, 
      height: initialScreenshotResult.actualHeight 
    };
    
    while (turn < MAX_AGENT_TURNS) {
      // Check for cancellation at start of each turn
      if (shouldCancel && shouldCancel()) {
        console.log('[ComputerUse] Test cancelled by user');
        testStore.hideCursor();
        onUpdate({ type: 'text', message: '*Test cancelled by user.*' });
        return {
          passed: false,
          explanation: 'Test was cancelled by user.',
          actionsPerformed: actionsPerformed,
        };
      }
      
      turn++;
      console.log(`[ComputerUse] === Turn ${turn} ===`);
      
      onUpdate({ type: 'thinking', message: `Analyzing (turn ${turn})...` });
      
      // Call the model with Computer Use tool
      const response = await client.models.generateContent({
        model: COMPUTER_USE_MODEL,
        contents: contents,
        config: {
          systemInstruction: COMPUTER_USE_SYSTEM_PROMPT,
          // @ts-ignore - Native Thinking/Thought Signature config
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: 'low' as any,
          },
          tools: LOCAL_COMPUTER_USE_TOOLS as any,
          abortSignal: abortSignal, // Allow immediate cancellation
        },
      });
      
      console.log('[ComputerUse] Response received');
      
      // Extract text, thoughts, and function calls
      const textResponse = extractText(response);
      const thoughtResponse = extractThought(response);
      const thoughtSignature = extractThoughtSignature(response);
      const functionCalls = extractFunctionCalls(response);
      
      console.log('[ComputerUse] Thought Signature:', thoughtSignature ? 'Present' : 'None');
      console.log('[ComputerUse] Thought:', thoughtResponse?.substring(0, 50));
      console.log('[ComputerUse] Text:', textResponse?.substring(0, 100));
      console.log('[ComputerUse] Function calls:', functionCalls.length);
      
      // Update Thought Signature (Floating Bubble)
      if (thoughtResponse) {
        // Update the visual cursor bubble
        testStore.setThought(thoughtResponse);
        
        // Also log to sidebar for history
        const displayThought = thoughtResponse.length > 80 
          ? thoughtResponse.substring(0, 80) + '...' 
          : thoughtResponse;
        
        // Pass thoughtSignature if available
        onUpdate({ 
          type: 'thinking', 
          message: displayThought, 
          thought: thoughtResponse,
          thoughtSignature: thoughtSignature || undefined
        });
      }
      
      // Process model response text
      if (textResponse && textResponse.trim().length > 0) {
        // Always send text to the UI so the user can see the AI's commentary/intro
        onUpdate({ type: 'text', message: textResponse });
        
        // If no function calls are present, this is the final answer
        if (functionCalls.length === 0) {
          finalText = textResponse;
        } else {
          console.log('[ComputerUse] Commentary:', textResponse);
        }

      }
      
      // ============================================================
      // CRITICAL: Preserve the ENTIRE model response in history
      // This includes thought_signature which is REQUIRED for the
      // model to maintain reasoning context across turns.
      // DO NOT manually reconstruct - use the raw response content.
      // ============================================================
      const modelContent = response.candidates?.[0]?.content;
      
      if (modelContent) {
        // Push the COMPLETE model response with all parts intact
        // This preserves thought_signature attached to functionCall parts
        contents.push(modelContent as Content);
        console.log('[ComputerUse] Added model response to history with', modelContent.parts?.length || 0, 'parts');
      } else {
        console.warn('[ComputerUse] No model content to add to history');
      }
      
      // If no function calls, task is complete
      if (functionCalls.length === 0) {
        console.log('[ComputerUse] No function calls, task complete');
        break;
      }
      
      // IMPORTANT: Only process the FIRST action per turn
      // This enforces one-action-at-a-time behavior for proper visual feedback
      if (functionCalls.length > 0) {
        const action = functionCalls[0]; // Only take the first action
        
        if (functionCalls.length > 1) {
          console.log(`[ComputerUse] Model returned ${functionCalls.length} actions, processing only the first one`);
        }
        
        // Check for safety decision requiring confirmation
        if (action.safetyDecision?.decision === 'require_confirmation') {
          console.log('[ComputerUse] Safety confirmation required:', action.safetyDecision.explanation);
          onUpdate({ 
            type: 'action', 
            message: `⚠️ Safety check: ${action.safetyDecision.explanation}`,
            actionName: action.name,
            actionType: 'Safety',
            thought: thoughtResponse || undefined
          });
        }
        
        const actionType = getActionType(action.name, action.args);
        
        // Build a SIMPLE action description for the UI
        let actionDescription = `${actionType}`;
        
        // Add specific details based on action type
        const args = action.args || {};
        if (action.name === 'click_at') {
          actionDescription = `Clicking at (${args.x}, ${args.y})`;
        } else if (action.name === 'type_text_at') {
          const text = String(args.text).substring(0, 30);
          actionDescription = `Typing "${text}${String(args.text).length > 30 ? '...' : ''}" at (${args.x}, ${args.y})`;
        } else if (action.name === 'scroll_at') {
          const dir = args.direction || '';
          actionDescription = `Scrolling ${dir} at (${args.x}, ${args.y})`;
        } else if (action.name === 'scroll_document') {
          const dir = args.direction || '';
          actionDescription = `Scrolling document ${dir}`;
        } else if (action.name === 'drag_and_drop') {
          actionDescription = `Dragging from (${args.x}, ${args.y}) to (${args.destination_x}, ${args.destination_y})`;
        } else if (action.name === 'key_combination') {
          actionDescription = `Pressing keys: ${args.keys}`;
        } else if (action.name === 'navigate') {
          actionDescription = `Navigating to ${args.url}`;
        } else if (action.name === 'wait_5_seconds') {
          actionDescription = `Waiting 5 seconds`;
        } else if (actionType === 'Clicking' && args.coordinate) {
          actionDescription = `Clicking at (${args.coordinate[0]}, ${args.coordinate[1]})`;
        } else if (actionType === 'Typing' && args.text) {
          const text = String(args.text).substring(0, 30);
          actionDescription = `Typing "${text}${String(args.text).length > 30 ? '...' : ''}"`;
        } else if (actionType === 'Scrolling') {
          const dir = args.direction || (args.coordinate ? 'to position' : '');
          actionDescription = `Scrolling ${dir}`;
        }
          
        onUpdate({ 
          type: 'action', 
          message: actionDescription,
          actionName: action.name,
          actionType: actionType,
          thought: thoughtResponse || undefined,
          thoughtSignature: thoughtSignature || undefined
        });
        
        actionsPerformed.push(action.name);
        
        const result = await executeAction(action, iframe, currentActualDimensions);
        
        if (!result.success) {
          console.warn(`[ComputerUse] Action ${action.name} failed:`, result.error);
        }
        
        // Wait for UI to settle after action
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Check for cancellation after action
        if (shouldCancel && shouldCancel()) {
          console.log('[ComputerUse] Test cancelled during action execution');
          testStore.hideCursor();
          onUpdate({ type: 'text', message: '*Test cancelled by user.*' });
          return {
            passed: false,
            explanation: 'Test was cancelled by user.',
            actionsPerformed,
          };
        }
      }
      
      // Capture new screenshot after actions
      onUpdate({ type: 'screenshot', message: 'Capturing new state...' });
      testStore.setThought('Capturing screen...');
      
      const newScreenshotResult = await captureIframeScreenshot(iframe);
      
      // Update actual dimensions for next coordinate conversion
      currentActualDimensions = { 
        width: newScreenshotResult.actualWidth, 
        height: newScreenshotResult.actualHeight 
      };
      console.log(`[ComputerUse] New screenshot - Actual: ${currentActualDimensions.width}x${currentActualDimensions.height}`);
      
      // Get the current URL from iframe (or use a placeholder for preview)
      let currentUrl = 'about:srcdoc'; // Default for iframe content
      try {
        if (iframe.contentWindow?.location?.href) {
          currentUrl = iframe.contentWindow.location.href;
        }
      } catch (e) {
        // Cross-origin access may fail, use default
        console.log('[ComputerUse] Could not get iframe URL, using default');
      }
      
      // Build function response for the SINGLE action we executed
      const functionResponseParts: Part[] = [];
      
      if (functionCalls.length > 0) {
        const action = functionCalls[0]; // Same action we executed
        functionResponseParts.push({
          functionResponse: {
            name: action.name,
            response: {
              url: currentUrl,
              success: true,
            },
          }
        } as Part);
      }
      
      // Add function responses AND the new screenshot to conversation
      const userResponse: Content = {
        role: 'user',
        parts: [
          ...functionResponseParts,
          {
            inlineData: {
              mimeType: 'image/png',
              data: newScreenshotResult.data,  // Normalized 1440x900 screenshot
            }
          } as Part,
        ],
      };
      
      contents.push(userResponse);
    }
    
    // Determine pass/fail from final text
    const passed = finalText.includes('✅') || 
                   finalText.toLowerCase().includes('yes') ||
                   finalText.toLowerCase().includes('works correctly') ||
                   finalText.toLowerCase().includes('feature works');
    
    // Hide cursor when done
    testStore.hideCursor();
    
    onUpdate({ type: 'complete', message: passed ? 'Test passed!' : 'Test failed' });
    
    return {
      passed,
      explanation: finalText,
      actionsPerformed,
    };
    
  } catch (error: any) {
    console.error('[ComputerUse] Agent loop error:', error);

    // Hide cursor on error too
    testStore.hideCursor();

    // Check if this was a user-initiated cancellation
    const wasCancelled = error.name === 'AbortError' ||
                         error.message?.includes('aborted') ||
                         shouldCancel?.();

    if (wasCancelled) {
      onUpdate({ type: 'complete', message: 'Test stopped by user' });
      return {
        passed: false,
        explanation: '*AI testing stopped by the user.*',
        actionsPerformed,
      };
    }

    onUpdate({ type: 'error', message: error.message });

    return {
      passed: false,
      explanation: `Error during testing: ${error.message}`,
      actionsPerformed,
    };
  }
}

/**
 * Runs a small task-oriented computer-use loop for Spark's embedded local
 * browser.  It shares the proven screenshot and action execution primitives
 * with the staging QA runner, while using task-oriented instructions and a
 * smaller turn budget suitable for an in-chat surface.
 */
export async function runComputerUseTask(
  apiKey: string,
  userPrompt: string,
  iframe: HTMLIFrameElement,
  onUpdate: (update: TestUpdate) => void,
  conversationHistory: ConversationMessage[] = [],
  shouldCancel?: () => boolean,
  abortSignal?: AbortSignal,
): Promise<ComputerUseTaskResult> {
  const actionsPerformed: string[] = [];
  const isCancelled = () => Boolean(abortSignal?.aborted || shouldCancel?.());
  const throwIfCancelled = () => {
    if (isCancelled()) throw new DOMException('Computer-use task cancelled.', 'AbortError');
  };
  const describeAction = (action: ComputerUseAction) => {
    const args = action.args ?? {};
    if (action.name === 'click_at') return `Clicking at (${args.x}, ${args.y})`;
    if (action.name === 'type_text_at') {
      const value = String(args.text ?? '');
      return `Typing “${value.slice(0, 36)}${value.length > 36 ? '…' : ''}”`;
    }
    if (action.name === 'scroll_at' || action.name === 'scroll_document') {
      return `Scrolling ${String(args.direction ?? 'the page')}`;
    }
    if (action.name === 'navigate') return `Opening ${String(args.url ?? 'a page')}`;
    if (action.name === 'key_combination') return `Pressing ${String(args.keys ?? 'a key')}`;
    return getActionType(action.name, args);
  };
  const getFrameUrl = () => {
    try {
      return iframe.contentWindow?.location?.href || iframe.src || 'about:srcdoc';
    } catch {
      return iframe.src || 'about:blank';
    }
  };
  const waitForFrame = async (timeoutMs = 2_500) => {
    try {
      if (iframe.contentDocument?.readyState === 'complete') return;
    } catch {
      // A navigated cross-origin frame cannot expose its document to Willow.
      // It can still emit `load`, after which screenshot capture reports the
      // limited-access state handled by the caller.
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        iframe.removeEventListener('load', finish);
        resolve();
      };
      iframe.addEventListener('load', finish, { once: true });
      setTimeout(finish, timeoutMs);
    });
  };

  try {
    throwIfCancelled();
    const client = getClient(apiKey);
    onUpdate({ type: 'plan', message: 'Opening the local browser and preparing the task.' });
    onUpdate({ type: 'screenshot', message: 'Reading the current browser view…' });
    testStore.showCursor();
    testStore.setThought('Reading the page…');
    await waitForFrame();
    const firstScreenshot = await captureIframeScreenshot(iframe);
    let currentDimensions = {
      width: firstScreenshot.actualWidth,
      height: firstScreenshot.actualHeight,
    };
    const historyContext = conversationHistory
      .slice(-8)
      .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content.slice(0, 600)}`)
      .join('\n');
    const contents: Content[] = [{
      role: 'user',
      parts: [
        {
          text: [
            `Task: ${userPrompt}`,
            historyContext ? `Recent conversation:\n${historyContext}` : '',
            'Use the screenshot to take the next best action. Complete the task before stopping.',
          ].filter(Boolean).join('\n\n'),
        },
        {
          inlineData: {
            mimeType: 'image/png',
            data: firstScreenshot.data,
          },
        } as Part,
      ],
    }];
    let finalText = '';

    for (let turn = 1; turn <= 16; turn += 1) {
      throwIfCancelled();
      onUpdate({ type: 'thinking', message: turn === 1 ? 'Planning the first action…' : 'Checking the updated page…' });
      const response = await client.models.generateContent({
        model: COMPUTER_USE_MODEL,
        contents,
        config: {
          systemInstruction: COMPUTER_USE_TASK_SYSTEM_PROMPT,
          // @ts-ignore - supported by the Gemini API even when older SDK types lag behind.
          thinkingConfig: { includeThoughts: true, thinkingLevel: 'low' as any },
          tools: LOCAL_COMPUTER_USE_TOOLS as any,
          abortSignal,
        },
      });
      throwIfCancelled();

      const thought = extractThought(response);
      const thoughtSignature = extractThoughtSignature(response);
      const textResponse = extractText(response).trim();
      const functionCalls = extractFunctionCalls(response);
      if (thought) {
        testStore.setThought(thought);
        onUpdate({
          type: 'thinking',
          message: thought.length > 120 ? `${thought.slice(0, 120)}…` : thought,
          thought,
          thoughtSignature: thoughtSignature ?? undefined,
        });
      }
      if (textResponse) {
        finalText = textResponse;
        onUpdate({ type: 'text', message: textResponse });
      }

      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) contents.push(modelContent as Content);
      if (!functionCalls.length) {
        const explanation = finalText || 'The browser task is complete.';
        onUpdate({ type: 'complete', message: 'Browser task complete' });
        testStore.hideCursor();
        return { completed: true, explanation, actionsPerformed };
      }

      const action = functionCalls[0];
      actionsPerformed.push(action.name);
      onUpdate({
        type: 'action',
        message: describeAction(action),
        actionName: action.name,
        actionType: getActionType(action.name, action.args),
        thought: thought ?? undefined,
        thoughtSignature: thoughtSignature ?? undefined,
      });
      const actionResult = await executeAction(action, iframe, currentDimensions);
      throwIfCancelled();
      await waitForFrame(action.name === 'navigate' || action.name === 'search' ? 3_500 : 900);

      let nextScreenshot: ScreenshotResult;
      try {
        nextScreenshot = await captureIframeScreenshot(iframe);
      } catch (captureError) {
        const explanation = actionResult.success
          ? 'The page opened in Willow’s local browser, but it is cross-origin or blocks embedding, so this frontend-only harness cannot inspect or control it further.'
          : actionResult.error || 'The embedded page could not be controlled.';
        onUpdate({ type: 'error', message: explanation });
        testStore.hideCursor();
        return {
          completed: false,
          explanation,
          actionsPerformed,
          limited: true,
        };
      }
      currentDimensions = {
        width: nextScreenshot.actualWidth,
        height: nextScreenshot.actualHeight,
      };
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: action.name,
              response: {
                success: actionResult.success,
                error: actionResult.error,
                url: getFrameUrl(),
              },
            },
          } as Part,
          {
            inlineData: {
              mimeType: 'image/png',
              data: nextScreenshot.data,
            },
          } as Part,
        ],
      });
    }

    const explanation = finalText || 'The local browser reached its current action limit before the task was finished.';
    onUpdate({ type: 'error', message: explanation });
    testStore.hideCursor();
    return { completed: false, explanation, actionsPerformed };
  } catch (error: any) {
    testStore.hideCursor();
    const cancelled = error?.name === 'AbortError' || isCancelled();
    const explanation = cancelled
      ? 'The browser task was stopped.'
      : `The browser task could not continue: ${error instanceof Error ? error.message : 'Unknown error.'}`;
    onUpdate({ type: cancelled ? 'complete' : 'error', message: explanation });
    return { completed: false, explanation, actionsPerformed };
  }
}

// ============================================================================
// Legacy Export (for backward compatibility during transition)
// ============================================================================

/**
 * @deprecated Use runComputerUseTest instead
 */
export async function streamTestRequest(
  apiKey: string,
  userPrompt: string,
  screenshot: string,
  conversationHistory: Content[] = [],
  onToken: (token: string) => void
): Promise<{ text?: string; actions: ComputerUseAction[]; isComplete: boolean }> {
  console.warn('[ComputerUse] streamTestRequest is deprecated, use runComputerUseTest instead');
  
  // This is a simplified wrapper that doesn't do the full agent loop
  // Just for backward compatibility
  const client = getClient(apiKey);
  
  const response = await client.models.generateContent({
    model: COMPUTER_USE_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { text: userPrompt },
          {
            inlineData: {
              mimeType: 'image/png',
              data: screenshot.replace(/^data:image\/\w+;base64,/, ''),
            }
          } as Part,
        ],
      },
    ],
    config: {
      systemInstruction: COMPUTER_USE_SYSTEM_PROMPT,
      tools: LOCAL_COMPUTER_USE_TOOLS as any,
    },
  });
  
  const text = extractText(response);
  const actions = extractFunctionCalls(response);
  
  if (text) {
    onToken(text);
  }
  
  return {
    text,
    actions,
    isComplete: !actions.length,
  };
}
