/**
 * Renders the inline markdown the assistant emits inside a line of prose:
 * bold (**text**) and inline code (`code`).
 *
 * Code spans are pulled out to placeholders before the bold split so a bold
 * marker inside a code span cannot be mistaken for formatting.
 */

import React from 'react';

export const processInlineFormatting = (text: string): React.ReactNode[] => {
  // 1. Extract code blocks and replace with unique placeholders
  const codeBlocks: string[] = [];
  const placeholderPrefix = '___CODE_BLOCK_';
  const placeholderSuffix = '___';
  
  const textWithPlaceholders = text.replace(/(`[^`]+`)/g, (match) => {
    const index = codeBlocks.length;
    codeBlocks.push(match);
    return `${placeholderPrefix}${index}${placeholderSuffix}`;
  });

  // 2. Split by bold markers
  const parts = textWithPlaceholders.split(/(\*\*.*?\*\*)/g);

  // 3. Render parts and restore code blocks
  return parts.map((part, partIdx) => {
    const restoreCode = (content: string) => {
      // Split by placeholders to find where code codes go
      const subParts = content.split(new RegExp(`(${placeholderPrefix}\\d+${placeholderSuffix})`, 'g'));
      
      return subParts.map((subPart, subIdx) => {
        if (subPart.startsWith(placeholderPrefix) && subPart.endsWith(placeholderSuffix)) {
          const indexStr = subPart.substring(placeholderPrefix.length, subPart.length - placeholderSuffix.length);
          const index = parseInt(indexStr, 10);
          if (!isNaN(index) && codeBlocks[index]) {
            // Render the code block
            return (
              <code key={`code-${partIdx}-${subIdx}`} className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-[13px] text-gray-200">
                {codeBlocks[index].slice(1, -1)}
              </code>
            );
          }
        }
        // Return plain text
        return subPart;
      });
    };

    // Check if this part is a bold block
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={`bold-${partIdx}`} className="text-white font-semibold">
          {restoreCode(part.slice(2, -2))}
        </strong>
      );
    }
    
    // Normal text
    return <React.Fragment key={`text-${partIdx}`}>{restoreCode(part)}</React.Fragment>;
  });
};

/** Kept as an alias: the transcript renderer calls it by this name. */
export const processBold = processInlineFormatting;
