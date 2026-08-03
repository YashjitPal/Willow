/**
 * Strips code blocks and bolt artifact markup out of an assistant message so the
 * copy-to-clipboard action yields just the prose the user can read.
 */

// Helper to strip code blocks and bolt artifact tags for clean text copying
export const stripCodeAndIndicators = (content: string): string => {
  let text = content;
  // Remove boltArtifact and boltAction tags and their contents
  text = text.replace(/<boltArtifact[^>]*>[\s\S]*?<\/boltArtifact>/gi, '');
  text = text.replace(/<boltAction[^>]*>[\s\S]*?<\/boltAction>/gi, '');
  // Remove markdown code blocks
  text = text.replace(/```[\s\S]*?```/g, '');
  // Remove inline code
  text = text.replace(/`[^`]+`/g, '');
  // Clean up extra whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
};
