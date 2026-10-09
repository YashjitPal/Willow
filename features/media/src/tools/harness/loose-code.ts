/**
 * Catching file contents written as prose instead of as an action.
 *
 * The model is told that code goes in `<willow-write>` / `<willow-edit>`. It
 * mostly listens. But on a long turn, or when "just showing" something, it
 * falls back to what it does everywhere else: a fenced code block in the reply.
 * That is the worst outcome here — the user sees code and assumes it landed,
 * and nothing was written.
 *
 * Prompting lowers the rate; it cannot remove it. So this detects it and the
 * turn feeds it back as an error, which models fix reliably because it is
 * concrete. Detection is deliberately conservative: a short snippet inside an
 * explanation ("the fix is `flex-shrink: 0`") must not trigger anything, so only
 * blocks that look like files count — long enough, in a language that is a file
 * here, and shaped like a declaration rather than a fragment.
 */

const FILE_LANGUAGES = new Set(['ts', 'tsx', 'js', 'jsx', 'typescript', 'javascript', 'css', 'json', 'html']);

/** Below this a block reads as illustration rather than a file. */
const MIN_LINES = 8;

const FENCE = /^```([\w+-]*)[^\n]*\n([\s\S]*?)```/gm;

/** Structural signals that a block is a file rather than a fragment. */
const DECLARATION =
  /^\s*(?:export\s+)?(?:default\s+)?(?:function|const|let|class|interface|type|import|@media|:root|\.[a-zA-Z-]+\s*\{)/m;

export interface LooseCodeBlock {
  language: string;
  lineCount: number;
  /** The first declaration-looking line, to name the block in the nudge. */
  hint?: string;
}

const looksLikeFile = (language: string, body: string): boolean => {
  if (!FILE_LANGUAGES.has(language)) return false;
  const lines = body.split('\n').filter((line) => line.trim() !== '');
  return lines.length >= MIN_LINES && DECLARATION.test(body);
};

export function findLooseCode(text: string): LooseCodeBlock[] {
  const found: LooseCodeBlock[] = [];
  FENCE.lastIndex = 0;
  for (let match = FENCE.exec(text); match !== null; match = FENCE.exec(text)) {
    const language = (match[1] ?? '').toLowerCase();
    const body = match[2] ?? '';
    if (!looksLikeFile(language, body)) continue;
    const lines = body.split('\n').filter((line) => line.trim() !== '');
    const hint = lines.find((line) => DECLARATION.test(line))?.trim().slice(0, 80);
    found.push({ language, lineCount: lines.length, hint });
  }
  return found;
}

/** The feedback handed back to the model: what happened, why it matters, what to do. */
export function looseCodeFeedback(blocks: LooseCodeBlock[]): string {
  const summary = blocks
    .map((block) => `- a ${block.lineCount}-line ${block.language} block${block.hint ? ` starting \`${block.hint}\`` : ''}`)
    .join('\n');
  return (
    'You wrote file contents into your reply instead of applying them:\n' +
    `${summary}\n\n` +
    'Nothing was written to the project and the preview did not change. Re-send that code now as ' +
    '<willow-write path="…"> for a new or fully rewritten file, or <willow-edit path="…"> with ' +
    'SEARCH/REPLACE blocks for a change to an existing one. Do not repeat the code in prose.'
  );
}

/**
 * Replaces loose file-content blocks in prose with a short note.
 *
 * The model re-sends the code as an action, so leaving the original block in
 * the transcript would show the same file twice — once as text that was never
 * applied and once as a real edit.
 */
export function stripLooseCode(text: string): string {
  FENCE.lastIndex = 0;
  return text.replace(FENCE, (whole, rawLanguage: string, body: string) => {
    const language = (rawLanguage ?? '').toLowerCase();
    if (!looksLikeFile(language, String(body))) return whole;
    const lines = String(body).split('\n').filter((line) => line.trim() !== '').length;
    return `_[${lines} lines of ${language} moved into the project]_`;
  });
}
