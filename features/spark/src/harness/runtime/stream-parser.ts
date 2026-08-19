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

import { CALL_BEGIN, CALL_END, PATCH_BEGIN, PATCH_END, WORK_TITLE_BEGIN } from './protocol';

export interface StreamHandlers {
  /** Prose, already stripped of any tool envelope. */
  onText: (chunk: string) => void;
  /** Spark metadata that labels the overall job, separate from work-log prose. */
  onWorkTitle: (title: string) => void;
  onPatchOpen: () => void;
  /** One raw line of the patch body, envelope lines included. */
  onPatchLine: (line: string) => void;
  /** The complete envelope, ready for `parsePatch`. */
  onPatchClose: (patch: string) => void;
  /** A `*** Call:` envelope, with its raw JSON body. */
  onCall: (name: string, body: string) => void;
}

type Mode = 'text' | 'patch' | 'call';

/** Shared by every marker in the protocol, opening and closing alike. */
const MARKER_PREFIX = '***';

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

    // Prose is flushed eagerly so text appears as it is typed, but only up to
    // the point where an envelope might begin.
    if (this.#mode === 'text' && this.#buffer.length > 0) {
      const cut = this.#flushBoundary(this.#buffer);
      if (cut > 0) {
        this.handlers.onText(this.#buffer.slice(0, cut));
        this.#buffer = this.#buffer.slice(cut);
      }
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

    // Likewise a call whose closer never arrived. Dropping it would end the
    // turn silently, since the loop only continues while calls are being made;
    // delivering it either works or produces a tool error the model can answer.
    if (this.#mode === 'call' && this.#callName !== '') {
      this.#closeCall();
    }

    this.#mode = 'text';
  }

  /**
   * The earliest envelope opener in a string, wherever it sits.
   *
   * Position-independent because models routinely append the marker straight
   * onto the sentence introducing it — `"...what we're starting with.*** Call:
   * list_files"` — with no newline between. Anchoring to the start of a line
   * misses that entirely: the envelope renders as prose, no tool runs, and
   * because the turn loop only continues while calls are being made, the turn
   * ends right there.
   *
   * The cost is that prose quoting a marker mid-sentence is taken literally.
   * That is the right trade: the harness owns these markers and instructs the
   * model to emit them only as envelopes, whereas the failure it prevents is
   * total.
   */
  #findOpener(text: string): { index: number; opener: string } | null {
    let found: { index: number; opener: string } | null = null;
    for (const opener of [WORK_TITLE_BEGIN, PATCH_BEGIN, CALL_BEGIN]) {
      const index = text.indexOf(opener);
      if (index !== -1 && (found === null || index < found.index)) {
        found = { index, opener };
      }
    }
    return found;
  }

  /**
   * How much of a partial line is safe to emit as prose.
   *
   * Two things are held back: a complete opener still waiting for its newline,
   * and a trailing fragment that could still grow into one. Missing the second
   * is a real bug — while the buffer is shorter than an opener it is only a
   * *prefix of* one (`"*** Cal"`), and flushing it means the envelope is never
   * recognised once the rest arrives. With small token chunks that is the
   * common case rather than the edge case.
   */
  #flushBoundary(buffer: string): number {
    /*
     * Every marker in the protocol begins `***`, and every one occupies a whole
     * line. So the safe cut is the first point where a marker has begun, or
     * could still begin once more tokens arrive — from there on, nothing can be
     * emitted as prose until the line is complete and `#line` has classified
     * it.
     *
     * Anchoring this to openers alone was not enough. `*** End Call` is not an
     * opener, so a buffer holding `*** End` looked like ordinary prose and was
     * flushed; by the time the rest arrived the line was already on screen, and
     * a model that had lost the thread filled the transcript with terminators.
     */
    for (let i = 0; i < buffer.length; i += 1) {
      const suffix = buffer.slice(i);
      if (suffix.startsWith(MARKER_PREFIX)) return i;
      if (suffix.length < MARKER_PREFIX.length && MARKER_PREFIX.startsWith(suffix)) return i;
    }
    return buffer.length;
  }

  #line(raw: string): void {
    const trimmed = raw.trim();

    if (this.#mode === 'text') {
      /*
       * A closing marker with nothing open is protocol noise, never prose.
       *
       * Models emit these when they lose track of the envelope — one stray
       * `*** End Call` tends to become a dozen — and rendering them puts raw
       * protocol in front of the user. Dropping them costs nothing: no reply
       * legitimately consists of a lone terminator.
       */
      if (trimmed === CALL_END || trimmed === PATCH_END) return;

      const found = this.#findOpener(raw);
      if (found) {
        // Whatever preceded the marker is ordinary prose and belongs in the
        // transcript. No newline is appended: the envelope becomes its own
        // block, so the sentence should not gain a break it never had.
        const before = raw.slice(0, found.index);
        if (before.trim() !== '') this.handlers.onText(before);

        const rest = raw.slice(found.index + found.opener.length);

        if (found.opener === WORK_TITLE_BEGIN) {
          const title = rest.trim().replace(/\s+/g, ' ').slice(0, 160);
          if (title) this.handlers.onWorkTitle(title);
          return;
        }

        if (found.opener === PATCH_BEGIN) {
          this.#mode = 'patch';
          this.#patchLines = [PATCH_BEGIN];
          this.handlers.onPatchOpen();
          this.handlers.onPatchLine(PATCH_BEGIN);
          // A patch crammed onto the opener's line is still a patch line.
          if (rest.trim() !== '') this.#line(rest);
          return;
        }

        // For a call the remainder of the line is the tool name.
        this.#mode = 'call';
        this.#callName = rest.trim();
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
    //
    // `endsWith` rather than equality, because the same habit that appends the
    // opener to a sentence also appends the closer to the body (`{}*** End
    // Call`). Anchoring to a whole line leaves the call unterminated, and an
    // unterminated call is a stalled turn.
    if (trimmed.endsWith(CALL_END)) {
      const tail = trimmed.slice(0, trimmed.length - CALL_END.length);
      if (tail.trim() !== '') this.#callBody.push(tail);
      this.#closeCall();
      return;
    }
    this.#callBody.push(raw);
  }

  #closeCall(): void {
    this.#mode = 'text';
    this.handlers.onCall(this.#callName, this.#callBody.join('\n'));
    this.#callName = '';
    this.#callBody = [];
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
