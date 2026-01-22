// Computer Use API - Gemini 2.5 Computer Use Model
// Implements proper agent loop with screenshot → action → feedback cycle
// Uses the new @google/genai SDK

import { GoogleGenAI, Part, Content, FunctionCall } from '@google/genai';

// ============================================================================
// Types
// ============================================================================

export interface TestUpdate {
  type: 'thinking' | 'action' | 'screenshot' | 'text' | 'complete' | 'error';
  message: string;
  actionName?: string;
}

export interface TestResult {
  passed: boolean;
  explanation: string;
  actionsPerformed: string[];
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

export const COMPUTER_USE_MODEL = 'gemini-2.5-computer-use-preview-10-2025';

// Recommended screen dimensions for Computer Use
const SCREEN_WIDTH = 1440;
const SCREEN_HEIGHT = 900;

// Maximum turns in agent loop to prevent infinite loops
const MAX_AGENT_TURNS = 10;

// System prompt for testing context
const COMPUTER_USE_SYSTEM_PROMPT = `You are a QA tester for a web application preview. The user will ask you to test specific features or behaviors.

When testing:
1. Look at the screenshot provided and analyze the current state of the UI
2. Perform the requested tests using the available actions (click_at, type_text_at, scroll_at, etc.)
3. After performing actions, analyze the new state to verify if the feature works
4. Report your findings clearly with:
   - ✅ YES - if the feature works as expected, explain what you observed
   - ❌ NO - if something is wrong, explain what failed and what you expected

Be concise but thorough. Describe what you see and what actions you take.`;

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

/**
 * Capture a screenshot of an iframe using html2canvas
 * Returns base64 PNG data (without the data:image/png;base64, prefix)
 */
export async function captureIframeScreenshot(
  iframe: HTMLIFrameElement
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        reject(new Error('Cannot access iframe document'));
        return;
      }
      
      const rect = iframe.getBoundingClientRect();
      
      import('html2canvas').then(({ default: html2canvas }) => {
        html2canvas(iframeDoc.body, {
          width: rect.width,
          height: rect.height,
          windowWidth: rect.width,
          windowHeight: rect.height,
          backgroundColor: '#1c1c1c',
          useCORS: true,
          allowTaint: true,
        }).then(canvas => {
          const dataUrl = canvas.toDataURL('image/png');
          // Remove the data:image/png;base64, prefix
          const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
          resolve(base64Data);
        }).catch(reject);
      }).catch(err => {
        console.warn('[ComputerUse] html2canvas not available, using fallback');
        // Fallback: create a simple placeholder
        const canvas = document.createElement('canvas');
        canvas.width = rect.width || 800;
        canvas.height = rect.height || 600;
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
        resolve(base64Data);
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
 * Returns true if action was executed successfully
 */
async function executeAction(
  action: ComputerUseAction,
  iframe: HTMLIFrameElement
): Promise<{ success: boolean; error?: string }> {
  try {
    const iframeWindow = iframe.contentWindow;
    const iframeDocument = iframe.contentDocument || iframeWindow?.document;
    
    if (!iframeWindow || !iframeDocument) {
      return { success: false, error: 'Cannot access iframe content' };
    }
    
    const rect = iframe.getBoundingClientRect();
    const dimensions = { width: rect.width, height: rect.height };
    
    const { name, args } = action;
    
    console.log(`[ComputerUse] Executing action: ${name}`, args);
    
    switch (name) {
      case 'click_at': {
        const x = denormalizeX(args.x as number, dimensions.width);
        const y = denormalizeY(args.y as number, dimensions.height);
        console.log(`[ComputerUse] Clicking at (${x}, ${y})`);
        
        const element = iframeDocument.elementFromPoint(x, y);
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
          }
          return { success: true };
        }
        return { success: false, error: `No element found at (${x}, ${y})` };
      }
      
      case 'type_text_at': {
        const x = denormalizeX(args.x as number, dimensions.width);
        const y = denormalizeY(args.y as number, dimensions.height);
        const text = args.text as string;
        const pressEnter = args.press_enter as boolean;
        const clearFirst = args.clear_before_typing as boolean;
        
        console.log(`[ComputerUse] Typing "${text}" at (${x}, ${y})`);
        
        const element = iframeDocument.elementFromPoint(x, y) as HTMLInputElement | HTMLTextAreaElement;
        if (element && ('value' in element || element.isContentEditable)) {
          element.focus();
          
          if ('value' in element) {
            if (clearFirst) {
              element.value = '';
            }
            element.value += text;
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
        const x = denormalizeX(args.x as number, dimensions.width);
        const y = denormalizeY(args.y as number, dimensions.height);
        
        console.log(`[ComputerUse] Hovering at (${x}, ${y})`);
        
        const element = iframeDocument.elementFromPoint(x, y);
        if (element) {
          element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: x, clientY: y }));
          element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
          return { success: true };
        }
        return { success: false, error: `No element found at (${x}, ${y})` };
      }
      
      case 'scroll_at': {
        const x = denormalizeX(args.x as number, dimensions.width);
        const y = denormalizeY(args.y as number, dimensions.height);
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
 * Extract text from the model response
 */
function extractText(response: any): string {
  try {
    // Try the simple text property first (new SDK)
    if (response.text) {
      return response.text;
    }
    
    // Fall back to parsing candidates
    const candidates = response.candidates || [];
    const textParts: string[] = [];
    
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
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
  onUpdate: (update: TestUpdate) => void
): Promise<TestResult> {
  const actionsPerformed: string[] = [];
  
  try {
    onUpdate({ type: 'thinking', message: 'Initializing Computer Use agent...' });
    
    const client = getClient(apiKey);
    
    // Get iframe dimensions for coordinate mapping
    const rect = iframe.getBoundingClientRect();
    const screenWidth = rect.width || SCREEN_WIDTH;
    const screenHeight = rect.height || SCREEN_HEIGHT;
    
    console.log(`[ComputerUse] Screen dimensions: ${screenWidth}x${screenHeight}`);
    
    // Step 1: Capture initial screenshot
    onUpdate({ type: 'screenshot', message: 'Capturing initial screenshot...' });
    const initialScreenshot = await captureIframeScreenshot(iframe);
    console.log('[ComputerUse] Initial screenshot captured, length:', initialScreenshot.length);
    
    // Step 2: Build initial content
    const fullPrompt = `Test request: ${userPrompt}

Please analyze the screenshot and perform the necessary actions to test this feature. When done, provide your conclusion with either:
- ✅ YES - the feature works correctly
- ❌ NO - the feature has issues (explain what's wrong)`;

    // Build conversation history
    const contents: Content[] = [
      {
        role: 'user',
        parts: [
          { text: fullPrompt },
          {
            inlineData: {
              mimeType: 'image/png',
              data: initialScreenshot,
            }
          } as Part,
        ],
      },
    ];
    
    // Step 3: Agent loop
    let turn = 0;
    let finalText = '';
    
    while (turn < MAX_AGENT_TURNS) {
      turn++;
      console.log(`[ComputerUse] === Turn ${turn} ===`);
      
      onUpdate({ type: 'thinking', message: `Analyzing (turn ${turn})...` });
      
      // Call the model with Computer Use tool
      const response = await client.models.generateContent({
        model: COMPUTER_USE_MODEL,
        contents: contents,
        config: {
          systemInstruction: COMPUTER_USE_SYSTEM_PROMPT,
          tools: [{
            // @ts-ignore - Computer Use tool configuration
            computerUse: {
              environment: 'ENVIRONMENT_BROWSER',
              excludedPredefinedFunctions: ['drag_and_drop'],
            }
          }],
        },
      });
      
      console.log('[ComputerUse] Response received');
      
      // Extract text and function calls
      const textResponse = extractText(response);
      const functionCalls = extractFunctionCalls(response);
      
      console.log('[ComputerUse] Text:', textResponse?.substring(0, 100));
      console.log('[ComputerUse] Function calls:', functionCalls.length);
      
      // Stream any text to the UI
      if (textResponse) {
        onUpdate({ type: 'text', message: textResponse });
        finalText = textResponse;
      }
      
      // Add model response to conversation history
      const modelContent: Content = {
        role: 'model',
        parts: [],
      };
      
      if (textResponse) {
        modelContent.parts.push({ text: textResponse });
      }
      
      for (const fc of functionCalls) {
        modelContent.parts.push({
          functionCall: {
            name: fc.name,
            args: fc.args,
          }
        } as Part);
      }
      
      contents.push(modelContent);
      
      // If no function calls, task is complete
      if (functionCalls.length === 0) {
        console.log('[ComputerUse] No function calls, task complete');
        break;
      }
      
      // Execute each function call
      
      for (const action of functionCalls) {
        // Check for safety decision requiring confirmation
        if (action.safetyDecision?.decision === 'require_confirmation') {
          console.log('[ComputerUse] Safety confirmation required:', action.safetyDecision.explanation);
          onUpdate({ 
            type: 'action', 
            message: `⚠️ Safety check: ${action.safetyDecision.explanation}`,
            actionName: action.name 
          });
          // For now, auto-confirm (in production, you'd prompt the user)
        }
        
        onUpdate({ 
          type: 'action', 
          message: `Executing: ${action.name}`,
          actionName: action.name 
        });
        
        actionsPerformed.push(action.name);
        
        const result = await executeAction(action, iframe);
        
        if (!result.success) {
          console.warn(`[ComputerUse] Action ${action.name} failed:`, result.error);
        }
        
        // Wait for UI to settle after action
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Capture new screenshot after actions
      onUpdate({ type: 'screenshot', message: 'Capturing new state...' });
      const newScreenshot = await captureIframeScreenshot(iframe);
      
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
      
      // Build function responses with URL (required by Computer Use API)
      // The API requires: url in response, and screenshot as inline_data
      const functionResponseParts: Part[] = [];
      
      for (const action of functionCalls) {
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
              data: newScreenshot,
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
    
    onUpdate({ type: 'complete', message: passed ? 'Test passed!' : 'Test failed' });
    
    return {
      passed,
      explanation: finalText,
      actionsPerformed,
    };
    
  } catch (error: any) {
    console.error('[ComputerUse] Agent loop error:', error);
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
        // @ts-ignore
        computerUse: {
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
