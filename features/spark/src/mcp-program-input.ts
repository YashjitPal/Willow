/**
 * What the user types to add an MCP server that is a program on this computer: the command line that starts it, and
 * the variables it reads. Split here, never by a shell — the companion starts the program with these exact arguments.
 */

/**
 * A command line as its words. Whitespace separates them; double or single quotes keep a word together, and a
 * backslash is only ever a backslash, so a Windows path survives as typed.
 */
export const splitCommand = (line: string): string[] | { problem: string } => {
  const words: string[] = [];
  let word = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = '';
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (quote) return { problem: 'A quote in the command is not closed.' };
  if (started) words.push(word);
  if (!words.length || !words[0]) return { problem: 'Enter the command that starts the server.' };
  return words;
};

/** `NAME=value`, one per line; blank lines and `#` comments are skipped, and quotes around a value come off. */
export const parseEnvLines = (text: string): { env: Record<string, string> } | { problem: string } => {
  const env: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) return { problem: `Line ${index + 1} should be NAME=value.` };
    const value = match[2];
    env[match[1]] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
  return { env };
};

/** A program server's command line as it reads back: words with spaces quoted. */
export const commandLine = (command: string, args: string[] = []): string =>
  [command, ...args].map((word) => (/[\s"]/.test(word) || !word ? `"${word}"` : word)).join(' ');
