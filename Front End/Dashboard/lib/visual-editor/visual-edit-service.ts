// Visual Edit Service - AST-BASED SURGICAL editing (no more line slicing!)
// Uses ts-morph SINGLETON to find EXACT node boundaries - never cuts tags in half
// The Project persists across requests for speed (<5ms queries instead of 50-100ms)

import { Project, SyntaxKind, Node, SourceFile } from 'ts-morph';
import { sandpackStore } from '../sandpack/sandpack-store';
import { streamChat, type ChatMessage, type AiOptions } from '../ai';
import type { SelectedElement, FamilyElement } from './types';
import { isVisualEditing, pushUndoState, clearSelection, requestInspectorReinit, markAsUnsaved } from './visual-editor-store';

export interface VisualEditRequest {
  element: SelectedElement;
  familyElements?: FamilyElement[];
  prompt: string;
  apiOptions: AiOptions;
}

export interface VisualEditResult {
  success: boolean;
  error?: string;
}

interface SurgicalRange {
  start: number;       // Character offset in file
  end: number;         // Character offset in file
  text: string;        // The extracted code (guaranteed valid)
  isInsideMap: boolean;
  mapVariableName?: string; // e.g., "item" from items.map(item => ...)
  clickedElementText?: string; // The specific element the user clicked on (for targeting)
  clickedElementTag?: string; // Tag name of clicked element
}

// ============================================================================
// SINGLETON TS-MORPH PROJECT
// Persists across requests - no 50-100ms startup cost per edit!
// ============================================================================

let singletonProject: Project | null = null;
const fileVersions = new Map<string, string>(); // Track file content hashes

/**
 * Get or create the singleton ts-morph Project
 * This is the key optimization - project stays alive across requests
 */
function getProject(): Project {
  if (!singletonProject) {
    console.log('[VisualEdit] Creating singleton ts-morph Project');
    singletonProject = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        jsx: 4, // JsxEmit.ReactJSX
        target: 99, // ScriptTarget.ESNext
        module: 99, // ModuleKind.ESNext
      },
    });
  }
  return singletonProject;
}

/**
 * Get or update a source file in the singleton project
 * - If file doesn't exist, create it
 * - If file exists but content changed, update it
 * - If file exists and content same, reuse it (instant!)
 */
function getSourceFile(fileName: string, code: string): SourceFile {
  const project = getProject();
  const normalizedPath = fileName.startsWith('/') ? fileName : `/${fileName}`;

  // Simple hash for change detection
  const contentHash = hashCode(code);
  const existingHash = fileVersions.get(normalizedPath);

  let sourceFile = project.getSourceFile(normalizedPath);

  if (sourceFile && existingHash === contentHash) {
    // File exists and content unchanged - instant reuse!
    console.log('[VisualEdit] Reusing cached source file:', normalizedPath);
    return sourceFile;
  }

  if (sourceFile) {
    // File exists but content changed - update it (fast)
    console.log('[VisualEdit] Updating source file:', normalizedPath);
    sourceFile.replaceWithText(code);
  } else {
    // New file - create it
    console.log('[VisualEdit] Creating new source file:', normalizedPath);
    sourceFile = project.createSourceFile(normalizedPath, code, { overwrite: true });
  }

  fileVersions.set(normalizedPath, contentHash);
  return sourceFile;
}

/**
 * Simple hash for content comparison
 */
function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(16);
}

/**
 * Convert line:column to character offset
 */
function lineColToOffset(code: string, line: number, column: number): number {
  const lines = code.split('\n');
  let offset = 0;

  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }

  offset += column;
  return offset;
}

/**
 * Get the surgical range using AST - NEVER cuts tags in half
 * Uses singleton Project for speed (<5ms instead of 50-100ms)
 *
 * UNIFIED APPROACH: When inside a .map(), extracts the ENTIRE callback body (the "family/template").
 * This lets the AI decide whether to edit just one element or all elements based on the user's prompt.
 */
function getSurgicalRange(code: string, fileName: string, line: number, column: number): SurgicalRange | null {
  try {
    // Use singleton project - fast!
    const sourceFile = getSourceFile(fileName, code);

    // Convert line:col to offset
    const cursorOffset = lineColToOffset(code, line, column);

    // Find the node at the cursor position
    const node = sourceFile.getDescendantAtPos(cursorOffset);
    if (!node) {
      console.warn('[VisualEdit] No node found at position', cursorOffset);
      return null;
    }

    console.log('[VisualEdit] Found node:', node.getKindName(), 'at', cursorOffset);

    // STEP 1: Find the JSX element that contains this position (the clicked element)
    let clickedElement = findContainingJSXElement(node);

    if (!clickedElement) {
      console.warn('[VisualEdit] No JSX element found, using parent context');
      clickedElement = node.getFirstAncestorByKind(SyntaxKind.JsxElement)
                || node.getFirstAncestorByKind(SyntaxKind.JsxSelfClosingElement)
                || node.getFirstAncestorByKind(SyntaxKind.JsxFragment);
    }

    if (!clickedElement) {
      console.warn('[VisualEdit] Could not find any JSX context');
      return null;
    }

    // Store info about the clicked element for identification
    const clickedElementText = clickedElement.getText();
    const clickedElementTag = getJsxTagName(clickedElement);

    // STEP 2: Check if we're inside a .map() callback
    const mapContext = findMapContext(clickedElement);

    // STEP 3: UNIFIED APPROACH
    // - If inside .map(): Extract the ENTIRE callback body (the template/family)
    // - If not in .map(): Extract just the clicked element
    let targetNode: Node;
    let isInsideMap = false;
    let mapVariableName: string | undefined;

    if (mapContext) {
      // INSIDE MAP: Extract the full callback body
      // This is the "family" - the template that renders all items
      isInsideMap = true;
      mapVariableName = mapContext.itemVariable;
      targetNode = mapContext.callbackBody;

      console.log('[VisualEdit] Inside .map() - extracting FULL callback body (family template)');
      console.log('[VisualEdit] Map variable:', mapVariableName);
      console.log('[VisualEdit] Clicked element tag:', clickedElementTag);
    } else {
      // NOT IN MAP: Extract just the clicked element
      targetNode = clickedElement;
      console.log('[VisualEdit] Not in .map() - extracting clicked element only');
    }

    // Get the EXACT text range - ts-morph guarantees this includes closing tags
    const start = targetNode.getStart();
    const end = targetNode.getEnd();
    const text = targetNode.getText();

    console.log('[VisualEdit] AST range:', start, '-', end, `(${text.length} chars)`);

    return {
      start,
      end,
      text,
      isInsideMap,
      mapVariableName,
      clickedElementText: isInsideMap ? clickedElementText : undefined,
      clickedElementTag: isInsideMap ? clickedElementTag : undefined
    };

  } catch (error) {
    console.error('[VisualEdit] AST extraction failed:', error);
    return null;
  }
}

/**
 * Get the tag name from a JSX element node
 */
function getJsxTagName(node: Node): string {
  const kind = node.getKind();

  if (kind === SyntaxKind.JsxElement) {
    const jsxEl = node.asKind(SyntaxKind.JsxElement);
    if (jsxEl) {
      const openingEl = jsxEl.getOpeningElement();
      return openingEl.getTagNameNode().getText();
    }
  } else if (kind === SyntaxKind.JsxSelfClosingElement) {
    const selfClosing = node.asKind(SyntaxKind.JsxSelfClosingElement);
    if (selfClosing) {
      return selfClosing.getTagNameNode().getText();
    }
  } else if (kind === SyntaxKind.JsxFragment) {
    return 'Fragment';
  }

  return 'element';
}

/**
 * Find the JSX element that contains this node
 * Climbs up until we find JsxElement, JsxSelfClosingElement, or JsxFragment
 */
function findContainingJSXElement(node: Node): Node | null {
  let current: Node | undefined = node;

  while (current) {
    const kind = current.getKind();

    if (kind === SyntaxKind.JsxElement ||
        kind === SyntaxKind.JsxSelfClosingElement ||
        kind === SyntaxKind.JsxFragment) {
      return current;
    }

    // Also catch JSX text and expressions
    if (kind === SyntaxKind.JsxText || kind === SyntaxKind.JsxExpression) {
      const parent = current.getParent();
      if (parent) {
        const parentKind = parent.getKind();
        if (parentKind === SyntaxKind.JsxElement || parentKind === SyntaxKind.JsxFragment) {
          return parent;
        }
      }
    }

    current = current.getParent();
  }

  return null;
}

/**
 * Check if the node is inside a .map() callback and return context
 */
function findMapContext(node: Node): { callbackBody: Node; itemVariable: string } | null {
  let current: Node | undefined = node;

  while (current) {
    // Look for ArrowFunction or FunctionExpression that's a .map() callback
    if (current.getKind() === SyntaxKind.ArrowFunction ||
        current.getKind() === SyntaxKind.FunctionExpression) {

      const parent = current.getParent();
      if (parent && parent.getKind() === SyntaxKind.CallExpression) {
        // Check if this is a .map() call
        const callText = parent.getText();
        if (callText.includes('.map(') || callText.includes('.map (')) {
          // Get the callback body
          const arrowFunc = current.asKind(SyntaxKind.ArrowFunction);
          if (arrowFunc) {
            const params = arrowFunc.getParameters();
            const itemVariable = params[0]?.getName() || 'item';

            // Get the body - could be expression or block
            const body = arrowFunc.getBody();
            if (body) {
              return { callbackBody: body, itemVariable };
            }
          }
        }
      }
    }

    current = current.getParent();
  }

  return null;
}

/**
 * Apply a visual edit using AST-BASED SURGICAL approach
 * - Uses ts-morph to find EXACT node boundaries
 * - NEVER cuts tags in half
 * - Detects .map() loops automatically
 */
export async function applyVisualEdit(
  request: VisualEditRequest,
  onProgress?: (status: string) => void
): Promise<VisualEditResult> {
  const { element, prompt, apiOptions } = request;

  console.log('[VisualEdit] === AST SURGICAL EDIT ===');
  console.log('[VisualEdit] Element:', element.tagName, `"${element.textContent?.substring(0, 30)}..."`);
  console.log('[VisualEdit] Source:', element.sourceLocation);

  if (!element.sourceLocation) {
    return { success: false, error: 'No source location. Click directly on an element.' };
  }

  const { fileName, line, column } = element.sourceLocation;

  try {
    isVisualEditing.set(true);
    onProgress?.('Analyzing code...');

    // Get the file
    const targetFile = '/' + fileName;
    let fileContent = sandpackStore.getFile(targetFile)
      || sandpackStore.getFile(fileName)
      || sandpackStore.getFile('/App.tsx');

    if (!fileContent) {
      isVisualEditing.set(false);
      clearSelection(); // Clear stale selection on failure
      return { success: false, error: `File not found: ${fileName}` };
    }

    // USE AST TO GET EXACT RANGE - uses singleton Project for speed!
    const surgicalRange = getSurgicalRange(fileContent, fileName, line, column);

    if (!surgicalRange) {
      isVisualEditing.set(false);
      clearSelection(); // Clear stale selection on failure
      return { success: false, error: 'Could not locate element in code. Try clicking directly on it.' };
    }

    console.log('[VisualEdit] Surgical range:', surgicalRange.start, '-', surgicalRange.end,
      `(${surgicalRange.text.length} chars)`, surgicalRange.isInsideMap ? '[.map() detected]' : '');

    // Build the surgical prompt
    onProgress?.('Editing...');
    const editPrompt = buildSurgicalPrompt(
      surgicalRange.text,
      element,
      surgicalRange.isInsideMap,
      surgicalRange.mapVariableName,
      surgicalRange.clickedElementText,
      surgicalRange.clickedElementTag,
      prompt
    );

    console.log('[VisualEdit] Prompt to AI:', editPrompt);

    // Call AI
    const messages: ChatMessage[] = [{ role: 'user', content: editPrompt }];
    let aiResponse = '';

    await streamChat(
      messages,
      apiOptions,
      (token) => { aiResponse += token; },
      () => {}
    );

    console.log('[VisualEdit] AI response:', aiResponse.length, 'chars');

    // Check if this is a delete request
    const isDelete = isDeleteRequest(prompt);

    // Extract and validate the modified snippet
    const modifiedSnippet = extractSnippet(aiResponse);

    // For delete requests, allow empty/null responses
    if (isDelete && (!modifiedSnippet || modifiedSnippet.length < 5 ||
        modifiedSnippet === 'null' || modifiedSnippet === '<></>' ||
        modifiedSnippet.trim() === '')) {
      console.log('[VisualEdit] Delete request - allowing empty/null response');
      // Use empty fragment for safe deletion
      const safeDeleteSnippet = modifiedSnippet === 'null' ? 'null' :
                                 modifiedSnippet === '' ? '{null}' :
                                 modifiedSnippet || '{null}';

      // CHARACTER-BASED REPLACEMENT
      const newContent =
        fileContent.substring(0, surgicalRange.start) +
        safeDeleteSnippet +
        fileContent.substring(surgicalRange.end);

      // PUSH UNDO STATE before applying the change
      const undoDescription = `Visual edit: "${prompt.substring(0, 30)}${prompt.length > 30 ? '...' : ''}"`;
      pushUndoState(undoDescription);
      markAsUnsaved();

      console.log('[VisualEdit] Applying delete change');
      sandpackStore.setFile(targetFile, newContent);

      await new Promise(resolve => setTimeout(resolve, 100));
      isVisualEditing.set(false);
      clearSelection();
      requestInspectorReinit();
      console.log('[VisualEdit] === DELETE SUCCESS ===');
      return { success: true };
    }

    if (!modifiedSnippet || modifiedSnippet.length < 5) {
      isVisualEditing.set(false);
      clearSelection();
      return { success: false, error: 'AI returned invalid response' };
    }

    // VALIDATION: Check brackets are balanced
    if (!areBracketsBalanced(modifiedSnippet)) {
      console.error('[VisualEdit] AI returned unbalanced code - rejecting');
      isVisualEditing.set(false);
      clearSelection(); // Clear stale selection on failure
      return { success: false, error: 'AI returned malformed code. Try again or rephrase your request.' };
    }

    // VALIDATION: Basic JSX sanity check
    if (!isValidJSXSnippet(modifiedSnippet)) {
      console.error('[VisualEdit] AI returned invalid JSX - rejecting');
      isVisualEditing.set(false);
      clearSelection(); // Clear stale selection on failure
      return { success: false, error: 'AI returned invalid JSX. Try again.' };
    }

    // CHARACTER-BASED REPLACEMENT - precise and safe
    const newContent =
      fileContent.substring(0, surgicalRange.start) +
      modifiedSnippet +
      fileContent.substring(surgicalRange.end);

    // CHECK FOR NO-OP: If normalized content is identical, don't apply
    if (newContent.replace(/\s+/g, ' ').trim() === fileContent.replace(/\s+/g, ' ').trim()) {
        console.warn('[VisualEdit] AI returned identical code (normalized) - no changes applied');
        isVisualEditing.set(false);
        // We don't clear selection so user can try again easily
        return { success: false, error: 'No changes were made to the code.' };
    }
    
    // Also check just the snippet vs original text for speed
    if (modifiedSnippet.replace(/\s+/g, '') === surgicalRange.text.replace(/\s+/g, '')) {
         console.warn('[VisualEdit] AI returned identical snippet - no changes applied');
         isVisualEditing.set(false);
         return { success: false, error: 'No changes were made to the code.' };
    }

    // VALIDATION: TS-Morph Syntax Check
    // Create a temporary source file to check for syntax errors WITHOUT saving to store yet
    try {
        const project = getProject();
        // Use a unique name to avoid conflicts
        const tempFileName = `/_temp_vis_edit_${Date.now()}.tsx`;
        const tempSourceFile = project.createSourceFile(tempFileName, newContent, { overwrite: true });
        
        if (!tempSourceFile) {
             console.warn('[VisualEdit] Failed to create temp file for validation');
             isVisualEditing.set(false);
             return { success: false, error: 'Validation failed: Could not create temp file.' };
        }
        
        // Robust check for the diagnostics method
        let diagnostics: any[] = [];
        if (typeof tempSourceFile.getSyntacticDiagnostics === 'function') {
            diagnostics = tempSourceFile.getSyntacticDiagnostics();
        } else if (typeof (tempSourceFile as any).getDiagnostics === 'function') {
             // Fallback for some versions/environments
             diagnostics = (tempSourceFile as any).getDiagnostics();
        } else {
             console.warn('[VisualEdit] Validation method not found on source file - skipping validation');
             // Fail open: assume valid if we can't check
             diagnostics = [];
        }
        
        if (diagnostics.length > 0) {
            const firstError = diagnostics[0];
            const message = typeof firstError.getMessageText === 'function' ? 
                            firstError.getMessageText() : 
                            (firstError.messageText || 'Unknown syntax error');
                            
            const line = typeof firstError.getLineNumber === 'function' ? 
                         firstError.getLineNumber() : '?';

            console.error('[VisualEdit] Syntax check failed:', message, 'at line', line);
            
            // Clean up
            project.removeSourceFile(tempSourceFile);
            
            isVisualEditing.set(false);
            clearSelection();
            return { 
                success: false, 
                error: `Syntax Error: ${message}` 
            };
        }
        
        // Clean up temp file
        project.removeSourceFile(tempSourceFile);
        
    } catch (e) {
        console.error('[VisualEdit] Syntax validation crashed:', e);
        // Fall through - if validation crashes, maybe risking it is better? 
        // Or safer to reject. Let's reject to be safe.
        isVisualEditing.set(false);
        const errorMessage = e instanceof Error ? e.message : String(e);
        return { success: false, error: `Validation system errored: ${errorMessage}` };
    }

    // PUSH UNDO STATE before applying the change
    const undoDescription = `Visual edit: "${prompt.substring(0, 30)}${prompt.length > 30 ? '...' : ''}"`;
    pushUndoState(undoDescription);
    markAsUnsaved();

    console.log('[VisualEdit] Applying character-based surgical change');
    sandpackStore.setFile(targetFile, newContent);

    // Wait a tick and check if the file was accepted
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify the change was applied
    const currentContent = sandpackStore.getFile(targetFile);
    if (currentContent !== newContent) {
      console.warn('[VisualEdit] Change may have been reverted by bundler');
    }

    isVisualEditing.set(false);

    // Clear the global selection after a successful edit
    // The DOM was rebuilt, so the old UID and sourceLocation are stale
    // User needs to re-select an element to use Select Parent
    clearSelection();

    // Re-inject the inspector script since the preview rebuilt
    // This ensures Select Parent works after visual edits
    requestInspectorReinit();

    console.log('[VisualEdit] === SUCCESS ===');

    return { success: true };

  } catch (error) {
    console.error('[VisualEdit] Error:', error);
    isVisualEditing.set(false);
    clearSelection(); // Clear stale selection on error
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Count unclosed brackets in code
 */
function countBrackets(code: string): {
  openParens: number;
  openBraces: number;
  openBrackets: number;
} {
  let openParens = 0;
  let openBraces = 0;
  let openBrackets = 0;

  // Simple counting (doesn't handle strings/comments perfectly but good enough for validation)
  for (const char of code) {
    switch (char) {
      case '(': openParens++; break;
      case ')': openParens--; break;
      case '{': openBraces++; break;
      case '}': openBraces--; break;
      case '[': openBrackets++; break;
      case ']': openBrackets--; break;
    }
  }

  return { openParens, openBraces, openBrackets };
}

/**
 * Check if brackets are balanced
 */
function areBracketsBalanced(code: string): boolean {
  const { openParens, openBraces, openBrackets } = countBrackets(code);
  return openParens === 0 && openBraces === 0 && openBrackets === 0;
}

/**
 * Basic JSX sanity check to catch common AI mistakes
 */
function isValidJSXSnippet(code: string): boolean {
  // Check for empty response
  const nonWhitespace = code.replace(/\s/g, '');
  if (nonWhitespace.length < 5) {
    console.warn('[VisualEdit] Response too short');
    return false;
  }

  // We rely on areBracketsBalanced() for structural validity.
  // We removed the text pattern checks because they triggered false positives
  // on valid text content (e.g. "Note: this is important" in a <p> tag).

  return true;
}

/**
 * Detect if user wants to delete the element
 */
function isDeleteRequest(prompt: string): boolean {
  const lowerPrompt = prompt.toLowerCase();
  const deletePatterns = [
    /\bdelete\b/,
    /\bremove\b/,
    /\bhide\b/,
    /\bget rid of\b/,
    /\beliminate\b/,
  ];

  return deletePatterns.some(pattern => pattern.test(lowerPrompt));
}

/**
 * Build a surgical prompt with UNIFIED SINGLE-SYSTEM approach.
 *
 * For elements inside .map():
 * - AI receives the ENTIRE callback/template (the "family")
 * - AI is told which specific element the user clicked
 * - AI decides based on user's language whether to:
 *   - Edit just that one element (if "this", "only this", singular language)
 *   - Edit the whole template/family (if "all", "these", plural, or generic language)
 *
 * For elements NOT in .map():
 * - Simple direct edit of the element
 */
function buildSurgicalPrompt(
  codeToEdit: string,
  element: SelectedElement,
  isInsideMap: boolean,
  mapVariableName: string | undefined,
  clickedElementCode: string | undefined,
  _clickedElementTag: string | undefined,
  userPrompt: string
): string {
  const textContent = element.textContent?.trim() || '';
  const wantsDelete = isDeleteRequest(userPrompt);

  // For elements NOT in a .map() - simple direct edit
  if (!isInsideMap) {
    if (wantsDelete) {
      return `Delete this element. Return {null} or <></>.

\`\`\`tsx
${codeToEdit}
\`\`\`

Modified:`;
    }

    return `Edit: "${userPrompt}"

\`\`\`tsx
${codeToEdit}
\`\`\`

Rules: Return ONLY valid JSX. No imports. No markdown wrapping.

Modified code:`;
  }

  // ============================================================
  // INSIDE .map() - CLEAR PROMPT WITH NATURAL INTERPRETATION
  // ============================================================

  const itemVar = mapVariableName || 'item';
  const selectedContent = textContent.substring(0, 80);

  return `# Visual Edit Request

**Request:** "${userPrompt}"

**Context:**
- This is a \`.map()\` template (iterator: \`${itemVar}\`)
- User clicked on item showing: "${selectedContent}"
${clickedElementCode ? `\n**Clicked element:**\n\`\`\`tsx\n${clickedElementCode}\n\`\`\`\n` : ''}
**Template:**
\`\`\`tsx
${codeToEdit}
\`\`\`

---

# Rules

1. **DEFAULT = Edit the template (affects ALL items).** This is what you should do unless the user EXPLICITLY asks for only one item.

2. **ONLY use conditionals** if the user's language clearly indicates they want ONLY the clicked item changed (not all items). In that case, find which property of \`${itemVar}\` contains "${selectedContent}" and add a conditional targeting that value.

3. **NEVER do nothing.** Always make a change. If unsure, edit the template.

4. **Be fast.** Make your decision immediately and return code.

5. **Return ONLY code.** No explanations.

${wantsDelete ? `6. **For deletion:** Either remove from template (all items) or wrap in conditional to hide only "${selectedContent}".` : ''}

---

Modified template:`;
}

/**
 * Extract clean code from AI response
 */
function extractSnippet(response: string): string {
  let code = response.trim();

  // Remove markdown code blocks
  const match = code.match(/```(?:tsx?|jsx?|typescript|javascript)?\n?([\s\S]*?)```/);
  if (match) {
    code = match[1];
  }

  // Remove backticks and common preambles
  code = code
    .replace(/^`+|`+$/g, '')
    .replace(/^Here(?:'s| is) the modified.*?:\s*/i, '')
    .replace(/^Modified.*?:\s*/i, '')
    .replace(/^MODIFIED(?: CODE)?:\s*/i, '')
    .replace(/^The code.*?:\s*/i, '')
    .replace(/^I(?:'ve| have) (?:made|updated|changed|modified).*?:\s*/i, '')
    .replace(/\n\n(?:Note|This|I|The).*$/is, '')
    .replace(/\n\nI(?:'ve| have).*$/is, '')
    .replace(/^(?:Note|This change|I changed|The above).*?\n/gim, '');

  code = code.trim();

  // If code still starts with non-JSX, try to find the start
  if (code.length > 0 && !/^[<{\s(\/]/.test(code)) {
    // Look for the first opening bracket that looks like JSX
    const firstTag = code.search(/<[a-z0-9]/i);
    const firstExpression = code.search(/{/);
    
    // Use the earlier of the two if found
    let firstJSX = -1;
    if (firstTag >= 0 && firstExpression >= 0) {
        firstJSX = Math.min(firstTag, firstExpression);
    } else if (firstTag >= 0) {
        firstJSX = firstTag;
    } else if (firstExpression >= 0) {
        firstJSX = firstExpression;
    }

    if (firstJSX >= 0) {
      // If we found a start, ensure we aren't cutting off important context?
      // For visual editing, we expect an element or null.
      code = code.substring(firstJSX);
    }
  }

  // Handle trailing text like "I hope this helps!"
  // Find the last closing tag `>` or `}`? This is risky if code has > comparisons...
  // Better to rely on balanced brackets check later.


  return code.trim();
}

/**
 * Get element description for display
 */
export function getElementDescription(element: SelectedElement): string {
  const parts = [`<${element.tagName}>`];
  if (element.classNames.length > 0) {
    parts.push(`.${element.classNames[0]}`);
  }
  if (element.textContent) {
    parts.push(`"${element.textContent.substring(0, 20)}..."`);
  }
  return parts.join(' ');
}
