// Display segments for replies saved before the Code harness.
//
// Code replies used to be bolt artifacts — `<boltArtifact>` wrapping
// `<boltAction type="file">` tags — and chats saved then still hold them. This
// turns one into prose and file indicators so an old chat renders as it did.
// Harness replies carry their own transcript (`steps`) and never come here;
// see `features/code/src/harness/`.

export interface ChatSegment {
  type: 'text' | 'file-indicator' | 'shell-indicator' | 'start-indicator';
  content: string;
  filePath?: string;
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
