/**
 * Incremental segmentation of a model response into prose and tool blocks.
 *
 * The parser is fed raw tokens and works line by line, because both envelopes
 * in the protocol are line-oriented. Working per line rather than per token is
 * what lets a patch be applied and rendered while it is still arriving — the
 * transcript shows the diff filling in, which is only possible if each complete
 * line is dispatched the moment it lands.
 *
 * It is a state machine with three states and no lookahead, so a truncated
 * stream (a cancelled turn) leaves it in a well-defined state rather than
 * throwing.
 */

import { CALL_BEGIN, CALL_END, PATCH_BEGIN, PATCH_END } from './protocol';

export interface StreamHandlers {
  /** Prose, already stripped of any tool envelope. */
  onText: (chunk: string) => void;
  onPatchOpen: () => void;
  /** One raw line of the patch body, envelope lines included. */
  onPatchLine: (line: string) => void;
  /** The complete envelope, ready for `parsePatch`. */
  onPatchClose: (patch: string) => void;
  /** A `*** Call:` envelope, with its raw JSON body. */
  onCall: (name: string, body: string) => void;
}

type Mode = 'text' | 'patch' | 'call';

export class ResponseStreamParser {
  #buffer = '';
  #mode: Mode = 'text';
  #patchLines: string[] = [];
  #callName = '';
  #callBody: string[] = [];

  constructor(private readonly handlers: StreamHandlers) {}

  /** Feeds a token. Only complete lines are dispatched. */
  push(chunk: string): void {
    this.#buffer += chunk;

    let newline = this.#buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      this.#line(line);
      newline = this.#buffer.indexOf('\n');
    }

    // Prose is flushed eagerly so text appears as it is typed. A partial line
    // is only held back when it could still turn out to be an envelope opener.
    if (this.#mode === 'text' && this.#buffer.length > 0 && !this.#couldOpen(this.#buffer)) {
      this.handlers.onText(this.#buffer);
      this.#buffer = '';
    }
  }

  /** Flushes whatever remains. Call once the stream ends. */
  end(): void {
    if (this.#buffer.length > 0) {
      this.#line(this.#buffer);
      this.#buffer = '';
    }

    // An unterminated patch still gets delivered: the model ran out of budget
    // mid-envelope, and the applier's own validation is a better place to
    // reject it than silently dropping the user's work.
    if (this.#mode === 'patch' && this.#patchLines.length > 0) {
      this.#patchLines.push(PATCH_END);
      this.handlers.onPatchClose(this.#patchLines.join('\n'));
      this.#patchLines = [];
    }

    this.#mode = 'text';
  }

  /**
   * True when the partial line might still turn out to be an envelope opener,
   * so the parser should wait for its newline rather than emitting it as prose.
   *
   * Both directions matter, and missing the second one is a real bug: while the
   * buffer is shorter than an opener it is a *prefix of* one
   * (`"*** Cal"`), but as soon as it passes that length it *starts with* one
   * (`"*** Call: read_file"`). Checking only the first flushes the opener as
   * text the moment the next token arrives, and the envelope is never seen —
   * which is exactly what happens with small token chunks.
   */
  #couldOpen(partial: string): boolean {
    const trimmed = partial.trimStart();
    if (trimmed === '') return false;
    for (const opener of [PATCH_BEGIN, CALL_BEGIN]) {
      if (opener.startsWith(trimmed) || trimmed.startsWith(opener)) return true;
    }
    return false;
  }

  #line(raw: string): void {
    const trimmed = raw.trim();

    if (this.#mode === 'text') {
      if (trimmed === PATCH_BEGIN) {
        this.#mode = 'patch';
        this.#patchLines = [PATCH_BEGIN];
        this.handlers.onPatchOpen();
        this.handlers.onPatchLine(PATCH_BEGIN);
        return;
      }
      if (trimmed.startsWith(CALL_BEGIN)) {
        this.#mode = 'call';
        this.#callName = trimmed.slice(CALL_BEGIN.length).trim();
        this.#callBody = [];
        return;
      }
      this.handlers.onText(`${raw}\n`);
      return;
    }

    if (this.#mode === 'patch') {
      this.#patchLines.push(raw);
      this.handlers.onPatchLine(raw);
      if (trimmed === PATCH_END) {
        this.#mode = 'text';
        const patch = this.#patchLines.join('\n');
        this.#patchLines = [];
        this.handlers.onPatchClose(patch);
      }
      return;
    }

    // mode === 'call'
    if (trimmed === CALL_END) {
      this.#mode = 'text';
      this.handlers.onCall(this.#callName, this.#callBody.join('\n'));
      this.#callName = '';
      this.#callBody = [];
      return;
    }
    this.#callBody.push(raw);
  }
}

/**
 * Parses a tool-call body.
 *
 * Models wrap JSON in fences often enough that stripping them is worth doing
 * here rather than failing the call and spending a round trip on the retry.
 */
export function parseCallBody(body: string): Record<string, unknown> {
  let text = body.trim();

  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(text);
  if (fence) text = fence[1]!.trim();

  if (text === '') return {};

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    // A bare path is common and unambiguous for the single-argument tools.
    if (!text.includes('{') && !text.includes('\n')) {
      return { path: text.replace(/^["']|["']$/g, '') };
    }
    throw new Error(
      `Could not parse the arguments as JSON. Received:\n${text.slice(0, 200)}`,
    );
  }
}
