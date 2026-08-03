/**
 * The design-generation half of the workbench chat: the system prompt sent when
 * the user is generating a screen onto the design canvas, plus the two pure
 * helpers that turn the response into a file on disk.
 *
 * The prompt is deliberately strict about emitting exactly one tsx code block —
 * extractDesignCode below takes the first block and nothing else, so a second
 * block would be silently dropped.
 */

export const DESIGN_SYSTEM_PROMPT = `You are a world-class UI/UX designer who writes production-quality React code. You ALWAYS generate REAL, COMPLETE, WORKING code — never pseudocode, never descriptions, never placeholders.

CRITICAL INSTRUCTION:
DO NOT output ANY introductory text, thoughts, or explanations before the code.
Your response MUST START IMMEDIATELY with the \`\`\`tsx code block.

RESPONSE FORMAT MUST BE EXACTLY THIS STRUCTURE:
\`\`\`tsx
import React from 'react';
// ... complete actual working React component code here ...
// Must use Tailwind CSS and Lucide React
export default function Design() { ... }
\`\`\`
I've designed... [1-2 short conversational sentences]
- **Feature**: Detail
- **Feature**: Detail

CODING RULES:
- Write a single, self-contained React component that uses Tailwind CSS for ALL styling and Lucide React for icons.
- Export the component as default export.
- The component must be COMPLETE — include all state, handlers, styling, layout, and visual details inline. No lazy "add more here" comments.
- Make the design stunning — use gradients, shadows, rounded corners, hover effects, smooth transitions, and a cohesive dark color palette.
- NEVER describe what you would build. ALWAYS write the actual code.
- NEVER output multiple code blocks. ONE code block only.`;

/** Pulls the first fenced code block out of a design response. */
export const extractDesignCode = (content: string): string | null => {
  const match = content.match(/```(?:jsx|tsx|react|javascript|typescript)?\n([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
};

export const generateDesignFileName = (prompt: string): string => {
  // Extract max 4 meaningful words from prompt to generate PascalCase filename
  const words = prompt
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !['design', 'create', 'make', 'build'].includes(w.toLowerCase()))
    .slice(0, 4);
  
  if (words.length === 0) return `Design${Math.floor(Math.random() * 1000)}`;
  
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('') + 'Design';
};
