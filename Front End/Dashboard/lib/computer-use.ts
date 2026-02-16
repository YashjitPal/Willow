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

// ============================================================================
// Helpers
// ============================================================================

function getActionType(name: string, args: any): string {
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
    const iframeDocument = iframe.contentDocument || iframeWindow?.document;
    
    if (!iframeWindow || !iframeDocument) {
      return { success: false, error: 'Cannot access iframe content' };
    }
    
    // CRITICAL: Use the ACTUAL dimensions for clicking, not the normalized ones
    // The model sees 1440x900, but we need to click on the actual iframe size
    const actualDimensions = screenshotDimensions;
    
    const { name, args } = action;
    
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
        
        const element = iframeDocument.elementFromPoint(x, y);
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
        
        const element = iframeDocument.elementFromPoint(x, y) as HTMLElement | null;
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
        
        const element = iframeDocument.elementFromPoint(x, y);
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
        
        const element = iframeDocument.elementFromPoint(x, y);
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
        
        iframeDocument.dispatchEvent(keyEvent);
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
        const url = args.url as string;
        console.log(`[ComputerUse] Navigating to ${url}`);
        iframeWindow.location.href = url;
        return { success: true };
      }
      
      case 'open_web_browser': {
        // Browser is already open (the iframe)
        console.log('[ComputerUse] Browser already open');
        return { success: true };
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
          textParts.push(part.text);
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
${conversationContext ? `\n${conversationContext}\n` : ''}
Please analyze the screenshot and perform the necessary actions to test this feature. When done, provide your conclusion with either:
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
            thinkingBudget: 2048, // Token budget for thinking
          },
          tools: [{
            // @ts-ignore - Computer Use tool configuration (SDK type issue)
            computerUse: {
              // @ts-ignore - Environment enum not properly exported by SDK
              environment: 'ENVIRONMENT_BROWSER',
              excludedPredefinedFunctions: ['drag_and_drop'],
            }
          }],
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
        if (actionType === 'Clicking' && args.coordinate) {
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
      tools: [{
        // @ts-ignore - Computer Use tool configuration (SDK type issue)
        computerUse: {
          // @ts-ignore - Environment enum not properly exported by SDK
          environment: 'ENVIRONMENT_BROWSER',
          excludedPredefinedFunctions: ['drag_and_drop'],
        }
      }],
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
