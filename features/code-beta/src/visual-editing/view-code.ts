/**
 * Jumping from a selected element to its source.
 *
 * The element only records where it STARTS (`data-willow-source` is a single
 * line:column). To highlight the whole element in the editor we have to guess
 * where it ends, which is what the tag-depth scan below does. It is a heuristic
 * on purpose: a real parse would need the JSX AST, and being a few lines off is
 * cheaper than blocking the jump.
 *
 * Lifted out of the overlay unchanged. It reads no component state — the caller
 * passes the source location it already has.
 */

import { navigateToCode } from './engine/index';
import type { FamilyElement } from './engine/types';

export const viewCodeForSourceLocation = (
  sourceLocation: NonNullable<FamilyElement['sourceLocation']>,
): void => {
  const { fileName, line, column } = sourceLocation;

  // Try to estimate the end line by looking at the file content
  // This is a heuristic - we look for the matching closing tag
  import('../runtime/sandpack/sandpack-store').then(({ sandpackStore }) => {
    const targetFile = '/' + fileName;
    const fileContent = sandpackStore.getFile(targetFile) || sandpackStore.getFile(fileName);

    if (fileContent) {
      const lines = fileContent.split('\n');
      const startLine = line;
      let endLine = startLine;

      // Simple heuristic: scan from start line to find balanced tags
      let depth = 0;
      let foundStart = false;

      for (let i = startLine - 1; i < lines.length && i < startLine + 50; i++) {
        const lineContent = lines[i];

        // Count opening tags (simplified)
        const opens = (lineContent.match(/<[a-zA-Z]/g) || []).length;
        const closes = (lineContent.match(/<\//g) || []).length;
        const selfClosing = (lineContent.match(/\/>/g) || []).length;

        if (i === startLine - 1) {
          foundStart = true;
          depth = opens - closes - selfClosing;
        } else if (foundStart) {
          depth += opens - closes - selfClosing;
        }

        endLine = i + 1;

        // If we're back to depth 0 or negative, we've found the end
        if (foundStart && depth <= 0 && i > startLine - 1) {
          break;
        }
      }

      // Ensure at least a few lines are highlighted
      if (endLine === startLine) {
        endLine = Math.min(startLine + 3, lines.length);
      }

      navigateToCode(fileName, startLine, column, endLine);
    } else {
      navigateToCode(fileName, line, column);
    }
  });
};
