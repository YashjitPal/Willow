import { ToolCall } from './types';

/**
 * Extract tool calls from agent response text.
 * Supports multiple formats:
 *
 * Format 1 (XML):
 *   <tool_call name="chatroom_send">
 *     <to>agent_name_or_all</to>
 *     <message>Your message here</message>
 *   </tool_call>
 *
 * Format 2 (Bracket):
 *   [run tool chatroom_send with to is Orion message is Hello]
 *
 * Format 3 (Markdown code block wrapping):
 *   ```xml
 *   <tool_call name="chatroom_send">...</tool_call>
 *   ```
 */
export function parseToolCalls(text: string): {
  toolCalls: ToolCall[];
  cleanText: string;
} {
  const toolCalls: ToolCall[] = [];
  let cleanText = text;

  // Pre-process: strip markdown code fences that wrap tool calls
  // Some LLMs wrap tool_call in ```xml ... ``` or ``` ... ```
  cleanText = cleanText.replace(/```(?:xml|tool)?\s*\n?\s*(<tool_call[\s\S]*?<\/tool_call>)\s*\n?\s*```/g, '$1');

  // Format 1: XML-style <tool_call name="...">...</tool_call>
  // Handle both quoted and unquoted name attribute, with flexible whitespace
  const xmlRegex = /<tool_call\s+name\s*=\s*["']?(chatroom_send|wait)["']?\s*>([\s\S]*?)<\/tool_call>/gi;
  let match;
  while ((match = xmlRegex.exec(cleanText)) !== null) {
    const [fullMatch, name, body] = match;
    const args: Record<string, string> = {};

    // Extract nested XML args like <to>value</to>
    const argRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let argMatch;
    while ((argMatch = argRegex.exec(body)) !== null) {
      args[argMatch[1]] = argMatch[2].trim();
    }

    toolCalls.push({ name: name.toLowerCase() as 'chatroom_send' | 'wait', args });
    cleanText = cleanText.replace(fullMatch, '');
  }

  // Format 2: Bracket-style [run tool chatroom_send with to is Orion message is Hello]
  const bracketRegex = /\[run tool (chatroom_send|wait)(?: with ([\s\S]*?))?\]/gi;
  while ((match = bracketRegex.exec(cleanText)) !== null) {
    const [fullMatch, name, argsStr] = match;
    const args: Record<string, string> = {};

    if (argsStr) {
      // Parse "key1 is value1 key2 is value2" format
      const knownKeys = ['to', 'message', 'timeout', 'reason'];
      const remaining = argsStr.trim();

      for (let i = 0; i < knownKeys.length; i++) {
        const key = knownKeys[i];
        const keyPattern = new RegExp(`\\b${key}\\s+is\\s+`, 'i');
        const keyMatch = remaining.match(keyPattern);
        if (!keyMatch) continue;

        const startIdx = remaining.indexOf(keyMatch[0]);
        const valueStart = startIdx + keyMatch[0].length;

        // Find where the next key starts (or end of string)
        let valueEnd = remaining.length;
        for (const nextKey of knownKeys) {
          if (nextKey === key) continue;
          const nextPattern = new RegExp(`\\b${nextKey}\\s+is\\s+`, 'i');
          const nextMatch = remaining.substring(valueStart).match(nextPattern);
          if (nextMatch && nextMatch.index !== undefined) {
            const candidateEnd = valueStart + nextMatch.index;
            if (candidateEnd < valueEnd) valueEnd = candidateEnd;
          }
        }

        args[key] = remaining.substring(valueStart, valueEnd).trim();
      }
    }

    toolCalls.push({ name: name.toLowerCase() as 'chatroom_send' | 'wait', args });
    cleanText = cleanText.replace(fullMatch, '');
  }

  return { toolCalls, cleanText: cleanText.trim() };
}
