// Message Parser for Sandpack - adapted from bolt.diy
// Parses streaming AI responses to extract boltArtifact and boltAction tags
// Also tracks text segments for conversational display

export interface ArtifactCallback {
  onArtifactOpen?: (id: string, title: string) => void;
  onArtifactClose?: (id: string) => void;
  onActionOpen?: (action: ParsedAction) => void;
  onActionClose?: (action: ParsedAction) => void;
  onTextChunk?: (text: string, isInsideArtifact: boolean) => void;
}

export interface ParsedAction {
  type: 'file' | 'shell' | 'start';
  filePath?: string;
  content?: string;
}

export interface ChatSegment {
  type: 'text' | 'file-indicator' | 'shell-indicator' | 'start-indicator';
  content: string;
  filePath?: string;
}

export class StreamingMessageParser {
  #callbacks: ArtifactCallback;
  #currentArtifact: { id: string; title: string } | null = null;
  #currentAction: ParsedAction | null = null;
  #buffer = '';
  #actionContent = '';
  #segments: ChatSegment[] = [];

  constructor(callbacks: ArtifactCallback = {}) {
    this.#callbacks = callbacks;
  }

  parse(chunk: string): string {
    this.#buffer += chunk;
    let output = '';

    // Process boltArtifact opening tags
    const artifactOpenMatch = this.#buffer.match(/<boltArtifact\s+id="([^"]+)"\s+title="([^"]+)">/);
    if (artifactOpenMatch && !this.#currentArtifact) {
      const [fullMatch, id, title] = artifactOpenMatch;
      // Emit any text before the artifact
      const textBefore = this.#buffer.substring(0, this.#buffer.indexOf(fullMatch));
      if (textBefore.trim()) {
        this.#callbacks.onTextChunk?.(textBefore.trim(), false);
        this.#segments.push({ type: 'text', content: textBefore.trim() });
      }
      this.#currentArtifact = { id, title };
      this.#callbacks.onArtifactOpen?.(id, title);
      this.#buffer = this.#buffer.substring(this.#buffer.indexOf(fullMatch) + fullMatch.length);
    }

    // Process boltAction opening tags
    const actionOpenMatch = this.#buffer.match(/<boltAction\s+type="(file|shell|start)"(?:\s+filePath="([^"]+)")?>/);
    if (actionOpenMatch && !this.#currentAction) {
      const [fullMatch, type, filePath] = actionOpenMatch;
      // Emit any text before the action (progress notes inside artifact)
      const textBefore = this.#buffer.substring(0, this.#buffer.indexOf(fullMatch));
      if (textBefore.trim()) {
        this.#callbacks.onTextChunk?.(textBefore.trim(), true);
        this.#segments.push({ type: 'text', content: textBefore.trim() });
      }
      this.#currentAction = { type: type as 'file' | 'shell' | 'start', filePath };
      this.#actionContent = '';
      this.#callbacks.onActionOpen?.(this.#currentAction);
      // Add file indicator to segments (skip shell/start for Sandpack)
      if (type === 'file' && filePath) {
        this.#segments.push({ type: 'file-indicator', content: filePath, filePath });
      }
      // Note: shell and start indicators are kept for display purposes but won't be executed
      this.#buffer = this.#buffer.substring(this.#buffer.indexOf(fullMatch) + fullMatch.length);
    }

    // Collect action content (hidden from display)
    if (this.#currentAction) {
      const closeTag = '</boltAction>';
      const closeIndex = this.#buffer.indexOf(closeTag);
      if (closeIndex !== -1) {
        // Found complete closing tag - extract content and close action
        this.#actionContent += this.#buffer.substring(0, closeIndex);
        this.#currentAction.content = this.#actionContent;
        this.#callbacks.onActionClose?.(this.#currentAction);
        this.#currentAction = null;
        this.#actionContent = '';
        this.#buffer = this.#buffer.substring(closeIndex + closeTag.length);
      } else {
        // No complete closing tag yet - check for potential partial tag at end
        let safeLength = this.#buffer.length;
        
        // Check if buffer ends with any prefix of '</boltAction>'
        for (let i = 1; i < closeTag.length && i <= this.#buffer.length; i++) {
          const suffix = this.#buffer.slice(-i);
          const prefix = closeTag.substring(0, i);
          if (suffix === prefix) {
            safeLength = this.#buffer.length - i;
            break;
          }
        }
        
        // Only consume content that's definitely safe
        if (safeLength > 0) {
          this.#actionContent += this.#buffer.substring(0, safeLength);
          this.#buffer = this.#buffer.substring(safeLength);
        }
      }
    }

    // Close artifact
    if (this.#currentArtifact && this.#buffer.includes('</boltArtifact>')) {
      const closeIndex = this.#buffer.indexOf('</boltArtifact>');
      const textBefore = this.#buffer.substring(0, closeIndex);
      if (textBefore.trim()) {
        this.#callbacks.onTextChunk?.(textBefore.trim(), true);
        this.#segments.push({ type: 'text', content: textBefore.trim() });
      }
      this.#callbacks.onArtifactClose?.(this.#currentArtifact.id);
      this.#currentArtifact = null;
      this.#buffer = this.#buffer.substring(closeIndex + '</boltArtifact>'.length);
    }

    // Return text outside of artifacts
    if (!this.#currentArtifact && !this.#currentAction && this.#buffer.trim()) {
      output = this.#buffer;
    }

    return output;
  }

  // Get all parsed segments for rendering
  getSegments(): ChatSegment[] {
    return [...this.#segments];
  }

  // Finalize and get remaining text
  finalize(): ChatSegment[] {
    if (this.#buffer.trim()) {
      this.#segments.push({ type: 'text', content: this.#buffer.trim() });
      this.#callbacks.onTextChunk?.(this.#buffer.trim(), false);
    }
    return this.getSegments();
  }

  reset() {
    this.#buffer = '';
    this.#currentArtifact = null;
    this.#currentAction = null;
    this.#actionContent = '';
    this.#segments = [];
  }
}

// Utility to parse completed response for display segments
export function parseResponseForDisplay(response: string): ChatSegment[] {
  const segments: ChatSegment[] = [];
  
  if (!response || typeof response !== 'string') {
    return segments;
  }
  
  // Find artifact boundaries
  const artifactStart = response.indexOf('<boltArtifact');
  const artifactEnd = response.indexOf('</boltArtifact>');
  
  // No artifact found - return plain text
  if (artifactStart === -1) {
    if (response.trim()) {
      segments.push({ type: 'text', content: response.trim() });
    }
    return segments;
  }
  
  // Extract text BEFORE artifact
  if (artifactStart > 0) {
    const textBefore = response.substring(0, artifactStart).trim();
    if (textBefore) {
      segments.push({ type: 'text', content: textBefore });
    }
  }
  
  // Find where artifact content starts (after the opening tag)
  const artifactOpenEnd = response.indexOf('>', artifactStart);
  if (artifactOpenEnd === -1) {
    return segments;
  }
  
  // Extract content inside artifact
  const artifactContent = artifactEnd !== -1 
    ? response.substring(artifactOpenEnd + 1, artifactEnd)
    : response.substring(artifactOpenEnd + 1);
  
  // Process actions inside artifact - only show file indicators for Sandpack
  const actionRegex = /<boltAction\s+type="(file|shell|start)"(?:\s+filePath="([^"]+)")?>([\s\S]*?)<\/boltAction>/g;
  let lastIndex = 0;
  let match;
  
  while ((match = actionRegex.exec(artifactContent)) !== null) {
    const [fullMatch, type, filePath] = match;
    
    // Check for text between last action and this one
    if (match.index > lastIndex) {
      const textBetween = artifactContent.substring(lastIndex, match.index).trim();
      const cleanText = textBetween.replace(/<[^>]*>/g, '').trim();
      if (cleanText) {
        segments.push({ type: 'text', content: cleanText });
      }
    }
    
    // Add indicator for file actions only (Sandpack doesn't support shell/start)
    if (type === 'file' && filePath) {
      segments.push({ type: 'file-indicator', content: filePath, filePath });
    }
    
    lastIndex = match.index + fullMatch.length;
  }
  
  // Check for incomplete (still streaming) action at the end
  const remainingContent = artifactContent.substring(lastIndex);
  const incompleteActionMatch = remainingContent.match(/<boltAction\s+type="(file|shell|start)"(?:\s+filePath="([^"]+)")?>/);
  if (incompleteActionMatch) {
    const [, type, filePath] = incompleteActionMatch;
    if (type === 'file' && filePath) {
      // Add indicator for the currently streaming file
      segments.push({ type: 'file-indicator', content: filePath, filePath });
    }
  }
  
  // Extract text AFTER artifact
  if (artifactEnd !== -1) {
    const textAfter = response.substring(artifactEnd + '</boltArtifact>'.length).trim();
    if (textAfter) {
      segments.push({ type: 'text', content: textAfter });
    }
  }
  
  return segments;
}

// Utility to parse completed response for execution
export function parseAIResponse(response: string): ParsedAction[] {
  const actions: ParsedAction[] = [];
  const regex = /<boltAction\s+type="(file|shell|start)"(?:\s+filePath="([^"]+)")?>([\s\S]*?)<\/boltAction>/g;
  
  let match;
  while ((match = regex.exec(response)) !== null) {
    const [, type, filePath, content] = match;
    // Only include file actions for Sandpack (shell/start not supported)
    if (type === 'file') {
      actions.push({ type: type as 'file', filePath, content: content.trim() });
    }
  }
  
  return actions;
}
