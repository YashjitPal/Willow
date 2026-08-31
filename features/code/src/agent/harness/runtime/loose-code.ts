/**
 * Catching file contents that were written as prose instead of as a patch.
 *
 * ## The failure
 *
 * The model is told to express every edit as a `*** Begin Patch` envelope. It
 * mostly does. But when a turn is long, or the file is new, or it is "just
 * showing" something, it sometimes falls back to what it does everywhere else
 * on the internet: a fenced code block in the reply.
 *
 * That is the worst possible outcome here. The user sees a wall of code and
 * assumes it was applied. Nothing was written, the preview does not change, and
 * the mismatch only surfaces later.
 *
 * ## Why prompting alone does not fix it
 *
 * It reduces the rate; it does not eliminate it. Fenced code is the single most
 * reinforced habit these models have. So this is a detector, and the harness
 * feeds what it finds back as a tool error — the same recovery path a malformed
 * patch takes, which models handle well because it is concrete and actionable.
 *
 * ## What counts as "loose code"
 *
 * Deliberately conservative. A short snippet inside an explanation is fine and
 * often useful — "the fix is `flex-shrink: 0`" should not trigger anything. The
 * detector fires on blocks that look like *file contents*: long enough, in a
 * language that gets written to disk here, and structurally code rather than
 * a fragment. Being over-eager would nag the model on legitimate explanation
 * and cost a round trip every time.
 */

/** Languages that would be a real file in this sandbox. */
const FILE_LANGUAGES = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'typescript',
  'javascript',
  'css',
  'json',
  'html',
]);

/** Below this a block reads as illustration rather than a file. */
const MIN_LINES = 8;

export interface LooseCodeBlock {
  language: string;
  lineCount: number;
  /** First line that looks like a declaration, for the nudge message. */
  hint?: string;
}

const FENCE = /^```([\w+-]*)[^\n]*\n([\s\S]*?)```/gm;

/** Structural signals that a block is a file rather than a fragment. */
const DECLARATION =
  /^\s*(?:export\s+)?(?:default\s+)?(?:function|const|let|class|interface|type|import|@media|:root|\.[a-zA-Z-]+\s*\{)/m;

export function findLooseCode(text: string): LooseCodeBlock[] {
  const found: LooseCodeBlock[] = [];
  let match: RegExpExecArray | null;

  FENCE.lastIndex = 0;
  while ((match = FENCE.exec(text)) !== null) {
    const language = (match[1] ?? '').toLowerCase();
    const body = match[2] ?? '';

    if (!FILE_LANGUAGES.has(language)) continue;

    const lines = body.split('\n').filter((line) => line.trim() !== '');
    if (lines.length < MIN_LINES) continue;
    if (!DECLARATION.test(body)) continue;

    const hint = lines.find((line) => DECLARATION.test(line))?.trim().slice(0, 80);
    found.push({ language, lineCount: lines.length, hint });
  }

  return found;
}

/**
 * The message handed back to the model.
 *
 * Written as an instruction it can act on immediately rather than a scolding:
 * name what happened, name the consequence, and give the exact next move.
 */
export function looseCodeObservation(blocks: LooseCodeBlock[]): string {
  const summary = blocks
    .map(
      (block) =>
        `  - a ${block.lineCount}-line ${block.language} block` +
        (block.hint ? ` starting \`${block.hint}\`` : ''),
    )
    .join('\n');

  return (
    'ERROR You wrote file contents into your reply instead of applying them:\n' +
    `${summary}\n\n` +
    'Nothing was written to the project and the preview did not change. The ' +
    'user is looking at code that does not exist on disk.\n\n' +
    'Re-send that code now as an apply_patch envelope — `*** Add File:` for a ' +
    'new file, `*** Update File:` with @@ hunks for an existing one. Do not ' +
    'repeat the code in prose as well; the patch is the only place it belongs.'
  );
}

/**
 * Strips loose file-content blocks out of prose before it is shown.
 *
 * The recovery path above means the model re-sends the code as a patch, so
 * leaving the original block in the transcript would show the same file twice —
 * once as unapplied text and once as a real diff. Replacing it with a short
 * note keeps the message readable and honest about what happened.
 */
export function stripLooseCode(text: string): string {
  return text.replace(FENCE, (whole, rawLanguage: string, body: string) => {
    const language = (rawLanguage ?? '').toLowerCase();
    if (!FILE_LANGUAGES.has(language)) return whole;

    const lines = String(body).split('\n').filter((line) => line.trim() !== '');
    if (lines.length < MIN_LINES || !DECLARATION.test(String(body))) return whole;

    return `_[${lines.length} lines of ${language} moved into a patch]_`;
  });
}
