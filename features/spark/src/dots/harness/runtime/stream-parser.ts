/**
 * Incremental segmentation of a bot's response into private prose, actions,
 * patches and calls.
 *
 * Forked from the Spark harness's `ResponseStreamParser`, keeping its
 * load-bearing rules: it works line by line, finds an opener wherever it sits on
 * a line (models glue markers onto sentences), never flushes a fragment that
 * could still grow into a marker, and delivers an unterminated envelope on
 * `end()` rather than dropping it.
 *
 * What the fork adds is the message envelope, which streams at token rather
 * than line granularity — the user watches it being typed — plus the one-line
 * `React:` and `Status:` actions. Spark's `Work Title` and `Final Response`
 * markers do not exist here: a bot's visible output is its messages.
 */
import {
  CALL_BEGIN,
  CALL_END,
  MESSAGE_BEGIN,
  MESSAGE_END,
  PATCH_BEGIN,
  PATCH_END,
  REACT_BEGIN,
  STATUS_BEGIN,
} from './protocol';

export interface DotStreamHandlers {
  /** Private prose. */
  onText: (chunk: string) => void;
  onMessageOpen: () => void;
  /** Message text as it streams; may end mid-line. */
  onMessageText: (chunk: string) => void;
  onMessageClose: () => void;
  /** The raw remainder of a `*** React:` line. */
  onReact: (rest: string) => void;
  onStatus: (text: string) => void;
  onPatchOpen: () => void;
  onPatchLine: (line: string) => void;
  onPatchClose: (patch: string) => void;
  onCall: (name: string, body: string) => void;
}

type Mode = 'text' | 'message' | 'patch' | 'call';

const MARKER_PREFIX = '***';
const OPENERS = [MESSAGE_BEGIN, REACT_BEGIN, STATUS_BEGIN, PATCH_BEGIN, CALL_BEGIN] as const;
const STRAY_CLOSERS = new Set([CALL_END, PATCH_END, MESSAGE_END]);

// A closer as models also write it: its asterisks escaped as Markdown or written as lookalikes, spaced or cased
// otherwise, with invisible characters in it or a stray asterisk after. Matched as it stands in the line, so what is
// before and after it is kept.
const ASTERISK = '(?:\\\\?[*\\u2217\\uFF0A\\u2731\\uFE61])';
const GAP = '[\\s\\u00A0\\u200B-\\u200D\\uFEFF]';
const closer = (word: string) => new RegExp(`${ASTERISK}${GAP}?${ASTERISK}${GAP}?${ASTERISK}${GAP}*end${GAP}+${word}(?![a-z])`, 'i');
const MESSAGE_CLOSER = closer('message');
const CALL_CLOSER = closer('call');
// What may trail a closer to the end of its line and mean nothing: a stray asterisk, a full stop, something invisible.
const TRAILING = /^[\s*\\\u2217\uFF0A\u2731\uFE61.!\u00A0\u200B-\u200D\uFEFF]*$/;

/** Where a closer stands in a line, and the line on either side of it; null when there is none. */
const findCloser = (raw: string, pattern: RegExp): { before: string; after: string } | null => {
  const match = pattern.exec(raw);
  if (!match) return null;
  const after = raw.slice(match.index + match[0].length);
  return { before: raw.slice(0, match.index), after: TRAILING.test(after) ? '' : after };
};

const isBareCloser = (raw: string): boolean =>
  [MESSAGE_CLOSER, CALL_CLOSER].some((pattern) => {
    const found = findCloser(raw, pattern);
    return found !== null && found.before.trim() === '' && found.after.trim() === '';
  });

// What may still grow into a marker, which streaming text holds back until its line is whole.
const MARKER_START = new RegExp(`^(?:${ASTERISK}${GAP}?){3}`);
const MARKER_GROWING = new RegExp(`^(?:${ASTERISK}${GAP}?){0,2}\\\\?$`);

export class DotStreamParser {
  #buffer = '';
  #mode: Mode = 'text';
  #patchLines: string[] = [];
  #callName = '';
  #callBody: string[] = [];

  constructor(private readonly handlers: DotStreamHandlers) {}

  push(chunk: string): void {
    this.#buffer += chunk;
    let newline = this.#buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      this.#line(line);
      newline = this.#buffer.indexOf('\n');
    }
    if ((this.#mode === 'text' || this.#mode === 'message') && this.#buffer.length > 0) {
      const cut = this.#flushBoundary(this.#buffer);
      if (cut > 0) {
        const text = this.#buffer.slice(0, cut);
        this.#buffer = this.#buffer.slice(cut);
        if (this.#mode === 'text') this.handlers.onText(text);
        else this.handlers.onMessageText(text);
      }
    }
  }

  end(): void {
    if (this.#buffer.length > 0) {
      this.#line(this.#buffer);
      this.#buffer = '';
    }
    if (this.#mode === 'message') this.#closeMessage();
    if (this.#mode === 'patch' && this.#patchLines.length > 0) {
      this.#patchLines.push(PATCH_END);
      this.handlers.onPatchClose(this.#patchLines.join('\n'));
      this.#patchLines = [];
    }
    if (this.#mode === 'call' && this.#callName !== '') this.#closeCall();
    this.#mode = 'text';
  }

  #findOpener(text: string): { index: number; opener: (typeof OPENERS)[number] } | null {
    let found: { index: number; opener: (typeof OPENERS)[number] } | null = null;
    for (const opener of OPENERS) {
      const index = text.indexOf(opener);
      if (index !== -1 && (found === null || index < found.index)) found = { index, opener };
    }
    return found;
  }

  /** Every marker begins `***`, however it is written; nothing from there on may be flushed until the line is whole. */
  #flushBoundary(buffer: string): number {
    for (let i = 0; i < buffer.length; i += 1) {
      const suffix = buffer.slice(i);
      if (suffix.startsWith(MARKER_PREFIX)) return i;
      if (suffix.length < MARKER_PREFIX.length && MARKER_PREFIX.startsWith(suffix)) return i;
      if (MARKER_START.test(suffix) || MARKER_GROWING.test(suffix)) return i;
    }
    return buffer.length;
  }

  #line(raw: string): void {
    const trimmed = raw.trim();

    if (this.#mode === 'message') {
      // Wherever it stands, because the closer is often glued to the last sentence.
      const closed = findCloser(raw, MESSAGE_CLOSER);
      if (closed) {
        if (closed.before.trim() !== '') this.handlers.onMessageText(closed.before);
        this.#closeMessage();
        if (closed.after.trim() !== '') this.#line(closed.after);
        return;
      }
      // A new envelope inside a message (another message included) means the
      // closer was forgotten: close the message there instead of sending the
      // protocol to the user.
      const found = this.#findOpener(raw);
      if (found) {
        const before = raw.slice(0, found.index);
        if (before.trim() !== '') this.handlers.onMessageText(before);
        this.#closeMessage();
        this.#line(raw.slice(found.index));
        return;
      }
      this.handlers.onMessageText(`${raw}\n`);
      return;
    }

    if (this.#mode === 'text') {
      if (STRAY_CLOSERS.has(trimmed) || isBareCloser(raw)) return;
      const found = this.#findOpener(raw);
      if (!found) {
        this.handlers.onText(`${raw}\n`);
        return;
      }
      const before = raw.slice(0, found.index);
      if (before.trim() !== '') this.handlers.onText(before);
      const rest = raw.slice(found.index + found.opener.length);

      switch (found.opener) {
        case MESSAGE_BEGIN: {
          this.#mode = 'message';
          this.handlers.onMessageOpen();
          // `*** Message` may carry text on its own line; a lone `:` is decoration.
          const inline = rest.replace(/^\s*:?/, '');
          if (inline.trim() !== '') this.#line(inline);
          return;
        }
        case REACT_BEGIN:
          this.handlers.onReact(rest.trim());
          return;
        case STATUS_BEGIN: {
          const text = rest.trim().replace(/\s+/g, ' ').slice(0, 200);
          if (text) this.handlers.onStatus(text);
          return;
        }
        case PATCH_BEGIN:
          this.#mode = 'patch';
          this.#patchLines = [PATCH_BEGIN];
          this.handlers.onPatchOpen();
          this.handlers.onPatchLine(PATCH_BEGIN);
          if (rest.trim() !== '') this.#line(rest);
          return;
        case CALL_BEGIN:
          this.#mode = 'call';
          this.#callName = rest.trim();
          this.#callBody = [];
          return;
      }
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
    const ended = findCloser(raw, CALL_CLOSER);
    if (ended) {
      if (ended.before.trim() !== '') this.#callBody.push(ended.before.trim());
      this.#closeCall();
      if (ended.after.trim() !== '') this.#line(ended.after);
      return;
    }
    this.#callBody.push(raw);
  }

  #closeMessage(): void {
    this.#mode = 'text';
    this.handlers.onMessageClose();
  }

  #closeCall(): void {
    this.#mode = 'text';
    this.handlers.onCall(this.#callName, this.#callBody.join('\n'));
    this.#callName = '';
    this.#callBody = [];
  }
}

export { parseCallBody } from '../../../harness/runtime/stream-parser';
