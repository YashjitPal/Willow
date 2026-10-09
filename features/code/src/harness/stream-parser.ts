/**
 * Incremental parsing of a model reply into prose and action blocks.
 *
 * Fed raw tokens, in whatever pieces the provider sends them. Prose is passed
 * on as soon as it cannot be the start of a tag, so text appears as it is typed;
 * an action is reported the moment its opening tag is complete (so the
 * transcript can name the file being written) and again when it closes.
 *
 * Everything here exists because a model did it:
 *
 * - **A tag can start mid-sentence.** "Let me fix that.<willow-edit …>" with no
 *   newline. Openers are found anywhere, not only at line starts.
 * - **A tag can arrive split across tokens.** `<wil` + `low-write pa` + `th="…">`.
 *   Anything that could still become a tag is held back until it cannot.
 * - **Tags get wrapped in code fences.** A fence line directly before an opener
 *   is dropped, and so is the matching closing fence after the block.
 * - **Closers get forgotten.** A new opener at the start of a line inside a
 *   write closes the block before it, rather than becoming file contents.
 *   Attribute-only tags (`<willow-delete …>`) are complete at their opener,
 *   whether or not they were written self-closing.
 * - **Stray closers appear** when a model loses track. They are dropped, never
 *   shown.
 * - **The reply can end inside a block** (output limit, cancellation). The block
 *   is still reported, marked incomplete, so the caller can refuse it and say so.
 *
 * Block bodies are kept as a chunk list with a short searchable tail, so a large
 * file costs linear time to parse rather than a copy of the whole body per token.
 */

import { ATTRIBUTE_ONLY_KINDS, nextId, type BlockKind, type ParsedBlock } from './protocol';

export interface BlockProgress {
  /** Characters of body received so far. */
  length: number;
  /** Newlines in the body so far. */
  lines: number;
}

export interface StreamParserHandlers {
  onText: (chunk: string) => void;
  /** An action's opening tag is complete; its body has not arrived yet. */
  onBlockOpen?: (block: Pick<ParsedBlock, 'id' | 'kind' | 'tag' | 'attrs'>) => void;
  /** More of an open block's body arrived. */
  onBlockProgress?: (id: string, progress: BlockProgress) => void;
  onBlock: (block: ParsedBlock) => void;
}

const TAG_KINDS: Record<string, BlockKind> = {
  'willow-write': 'write',
  'willow-file': 'write',
  'willow-create': 'write',
  'willow-edit': 'edit',
  'willow-delete': 'delete',
  'willow-remove': 'delete',
  'willow-rename': 'rename',
  'willow-move': 'rename',
  'willow-dependency': 'dependency',
  'willow-add-dependency': 'dependency',
  'willow-plan': 'plan',
  'willow-tool': 'tool',
  // The bolt format the Code tab used before, tolerated so an old habit in the
  // conversation still lands as a write.
  boltAction: 'write',
  boltArtifact: 'ignored',
  // The feedback envelopes, which a model sometimes imitates in its own reply.
  tool_result: 'ignored',
  willow_feedback: 'ignored',
};

/**
 * Tags dropped together with their body. A tool result the model writes itself
 * is invented, and the user never sees the real ones either.
 */
const ECHO_TAGS = new Set(['tool_result', 'willow_feedback']);

/** What a `<` has to begin with before it is worth holding back. */
const TAG_PREFIXES = [
  '<willow-', '</willow-',
  '<boltAction', '</boltAction', '<boltArtifact', '</boltArtifact',
  '<tool_result', '</tool_result', '<willow_feedback', '</willow_feedback',
];
const OPENER_PREFIXES = TAG_PREFIXES.filter((prefix) => !prefix.startsWith('</'));

const PATCH_BEGIN = '*** Begin Patch';
const PATCH_END = '*** End Patch';

/** A tag longer than this without a `>` is prose that happens to contain one. */
const MAX_TAG_LENGTH = 600;

/** Body characters kept unjoined, so closers and openers can be found across pushes. */
const TAIL_KEEP = 64;

/** A line that is only a code fence: ``` or ```lang. */
const FENCE_LINE = /^[ \t]*```[\w+.-]*[ \t]*$/;

/** A complete fence line at the very end of some text, and anything blank after it. */
const TRAILING_FENCE = /(^|\n)([ \t]*```[\w+.-]*[ \t]*\n[ \t]*)$/;

/** An opener at the start of a line, which implicitly closes an unclosed block. */
const LINE_START_OPENER = /\n[ \t]*<willow-(write|edit|delete|rename|dependency|plan|tool|file|create|remove|move)\b/;

interface OpenBlock {
  id: string;
  kind: BlockKind;
  tag: string;
  closer: string;
  attrs: Record<string, string>;
  chunks: string[];
  /** The last few characters of body, still searchable. */
  tail: string;
  length: number;
  lines: number;
}

interface ParsedTag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: Record<string, string>;
}

/** Parses one complete tag, `<name a="b">` or `</name>`. */
export function parseTag(text: string): ParsedTag | null {
  const match = /^<(\/)?\s*([A-Za-z][\w-]*)([\s\S]*?)(\/)?\s*>$/.exec(text);
  if (!match) return null;
  const attrs: Record<string, string> = {};
  for (const attr of (match[3] ?? '').matchAll(/([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attrs[attr[1]!] = attr[2] ?? attr[3] ?? attr[4] ?? '';
  }
  return { name: match[2]!, closing: Boolean(match[1]), selfClosing: Boolean(match[4]), attrs };
}

/**
 * Where the `>` closing a tag that starts at 0 is, honouring quoted attribute
 * values — `query="a > b"` must not end the tag early. -1 when it has not
 * arrived yet; -2 when this cannot be a tag.
 */
function findTagEnd(text: string): number {
  let quote: string | null = null;
  for (let i = 1; i < text.length; i += 1) {
    const char = text[i]!;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if ((char === '"' || char === "'") && /=\s*$/.test(text.slice(Math.max(0, i - 4), i))) {
      quote = char;
      continue;
    }
    if (char === '>') return i;
    if (char === '<') return -2;
    if (i > MAX_TAG_LENGTH) return -2;
  }
  return -1;
}

/** Length of the longest suffix of `text` that is a proper prefix of `token`. */
function partialSuffix(text: string, token: string): number {
  const max = Math.min(text.length, token.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (token.startsWith(text.slice(text.length - length))) return length;
  }
  return 0;
}

/** True when `text` begins with one of `prefixes`, or could once more arrives. */
function beginsWithAny(text: string, prefixes: readonly string[]): boolean {
  const head = text.slice(0, 24);
  return prefixes.some((prefix) => (head.length >= prefix.length ? head.startsWith(prefix) : prefix.startsWith(head)));
}

/** Index of the first `<` that starts — or may yet start — one of our tags. */
function findTagStart(text: string): number {
  let at = text.indexOf('<');
  while (at !== -1) {
    if (beginsWithAny(text.slice(at), TAG_PREFIXES)) return at;
    at = text.indexOf('<', at + 1);
  }
  return -1;
}

const countNewlines = (text: string): number => {
  let count = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count += 1;
  return count;
};

export class StreamParser {
  #buffer = '';
  #mode: 'text' | 'block' | 'patch' = 'text';
  #block: OpenBlock | null = null;
  #patchLines: string[] = [];
  #patchId = '';
  /** True when position 0 of the buffer is the start of a line. */
  #atLineStart = true;
  /** A fence line held until we know whether an action follows it. */
  #heldFence: string | null = null;
  /** A fence was dropped before a block, so its closing partner is dropped too. */
  #dropClosingFence = false;
  /** An attribute-only tag closed at its opener; swallow a closer that follows. */
  #swallowCloser: string | null = null;

  constructor(private readonly handlers: StreamParserHandlers) {}

  push(chunk: string): void {
    if (!chunk) return;
    this.#buffer += chunk;
    this.#drain(false);
  }

  /** Flushes everything. Call once, when the reply has ended. */
  end(): void {
    this.#drain(true);

    if (this.#mode === 'block' && this.#block) {
      const block = this.#block;
      this.#block = null;
      this.#mode = 'text';
      const body = block.chunks.join('') + block.tail + this.#buffer;
      this.#buffer = '';
      if (block.kind !== 'ignored') {
        this.handlers.onBlock({ id: block.id, kind: block.kind, tag: block.tag, attrs: block.attrs, body, complete: false });
      }
    } else if (this.#mode === 'patch') {
      if (this.#buffer) this.#patchLines.push(this.#buffer);
      this.#buffer = '';
      this.#mode = 'text';
      const body = this.#patchLines.join('\n');
      this.#patchLines = [];
      this.handlers.onBlock({ id: this.#patchId, kind: 'patch', tag: 'patch', attrs: {}, body, complete: false });
    }

    if (this.#heldFence) {
      this.handlers.onText(this.#heldFence);
      this.#heldFence = null;
    }
    if (this.#buffer) {
      this.handlers.onText(this.#buffer);
      this.#buffer = '';
    }
  }

  /** True while the reply is inside an unfinished action. */
  get insideBlock(): boolean {
    return this.#mode !== 'text';
  }

  #drain(final: boolean): void {
    for (let guard = 0; guard < 100_000; guard += 1) {
      const progressed =
        this.#mode === 'text' ? this.#drainText(final)
        : this.#mode === 'block' ? this.#drainBlock()
        : this.#drainPatch();
      if (!progressed) return;
    }
  }

  /**
   * Emits `text` as prose.
   *
   * A complete fence line at the very end is held rather than emitted: if the
   * next thing is an action, the fence was wrapping it and is dropped.
   */
  #pass(text: string): void {
    if (!text) return;
    if (this.#heldFence) {
      this.handlers.onText(this.#heldFence);
      this.#heldFence = null;
    }
    const fence = TRAILING_FENCE.exec(text);
    if (fence && (fence.index > 0 || fence[1] === '\n' || this.#atLineStart)) {
      const fenceStart = fence.index + fence[1]!.length;
      if (fenceStart > 0) this.handlers.onText(text.slice(0, fenceStart));
      this.#heldFence = text.slice(fenceStart);
      this.#atLineStart = true;
      return;
    }
    this.handlers.onText(text);
    this.#atLineStart = text.endsWith('\n');
  }

  #drainText(final: boolean): boolean {
    if (this.#buffer === '') return false;

    // The closer of an attribute-only tag that was already handled.
    if (this.#swallowCloser) {
      const trimmed = this.#buffer.replace(/^[ \t]*/, '');
      if (trimmed.startsWith(this.#swallowCloser)) {
        this.#buffer = trimmed.slice(this.#swallowCloser.length);
        this.#swallowCloser = null;
        return true;
      }
      if (!final && this.#swallowCloser.startsWith(trimmed)) return false;
      this.#swallowCloser = null;
    }

    // The closing partner of a fence that wrapped an action.
    if (this.#dropClosingFence) {
      const closing = /^\s*```[ \t]*(\r?\n|$)/.exec(this.#buffer);
      if (closing && (closing[1] || final)) {
        this.#buffer = this.#buffer.slice(closing[0].length);
        this.#dropClosingFence = false;
        this.#atLineStart = true;
        return true;
      }
      if (!final && /^\s*`{0,3}[ \t]*$/.test(this.#buffer)) return false;
      const next = this.#buffer.replace(/^\s+/, '');
      // Several actions inside one fence: keep waiting for the fence's end.
      if (next && !beginsWithAny(next, OPENER_PREFIXES) && !next.startsWith(PATCH_BEGIN)) {
        this.#dropClosingFence = false;
      }
    }

    // An incomplete line that may still become a fence is held.
    if (this.#atLineStart && this.#buffer.startsWith('`') && this.#buffer.indexOf('\n') === -1) {
      const couldBeFence = this.#buffer.length < 3 ? '```'.startsWith(this.#buffer) : this.#buffer.startsWith('```');
      if (couldBeFence && !final && this.#buffer.length < 80) return false;
    }

    // A held fence waits to see what follows it.
    if (this.#heldFence) {
      const trimmed = this.#buffer.replace(/^\s+/, '');
      if (trimmed === '') {
        if (!final) return false;
      } else if (beginsWithAny(trimmed, OPENER_PREFIXES) || PATCH_BEGIN.startsWith(trimmed.slice(0, PATCH_BEGIN.length)) || trimmed.startsWith(PATCH_BEGIN)) {
        const decided = trimmed.length >= 12 || trimmed.startsWith(PATCH_BEGIN);
        if (!decided && !final) return false;
        if (decided) {
          this.#heldFence = null;
          this.#dropClosingFence = true;
          this.#buffer = trimmed;
        }
      } else if (FENCE_LINE.test(trimmed.split('\n')[0]!) && trimmed.includes('\n')) {
        // An empty fenced block; let it through as written.
        this.handlers.onText(this.#heldFence);
        this.#heldFence = null;
      }
    }

    const tagAt = findTagStart(this.#buffer);
    let patchAt = this.#buffer.indexOf(PATCH_BEGIN);
    if (patchAt === -1 && !final) {
      const partial = partialSuffix(this.#buffer, PATCH_BEGIN);
      if (partial > 0) patchAt = this.#buffer.length - partial;
    }

    const candidates = [tagAt, patchAt].filter((index) => index !== -1);
    if (candidates.length === 0) {
      // Hold back a trailing line that might yet become a fence.
      const lastNewline = this.#buffer.lastIndexOf('\n');
      const tail = this.#buffer.slice(lastNewline + 1);
      const tailAtLineStart = lastNewline !== -1 || this.#atLineStart;
      if (!final && tailAtLineStart && tail.startsWith('`') && tail.length < 80 &&
          (tail.length < 3 ? '```'.startsWith(tail) : tail.startsWith('```'))) {
        const head = this.#buffer.slice(0, lastNewline + 1);
        if (!head) return false;
        this.#buffer = tail;
        this.#pass(head);
        return true;
      }
      const text = this.#buffer;
      this.#buffer = '';
      this.#pass(text);
      return true;
    }

    const cut = Math.min(...candidates);
    if (cut > 0) {
      const text = this.#buffer.slice(0, cut);
      this.#buffer = this.#buffer.slice(cut);
      this.#pass(text);
      return true;
    }

    if (cut === patchAt) {
      if (!this.#buffer.startsWith(PATCH_BEGIN)) {
        if (!final) return false;
        const text = this.#buffer;
        this.#buffer = '';
        this.#pass(text);
        return true;
      }
      if (this.#heldFence) {
        this.#heldFence = null;
        this.#dropClosingFence = true;
      }
      this.#mode = 'patch';
      this.#patchId = nextId('patch');
      this.#patchLines = [PATCH_BEGIN];
      this.#buffer = this.#buffer.slice(PATCH_BEGIN.length).replace(/^[ \t]*\r?\n?/, '');
      this.handlers.onBlockOpen?.({ id: this.#patchId, kind: 'patch', tag: 'patch', attrs: {} });
      return true;
    }

    return this.#openTag(final);
  }

  #openTag(final: boolean): boolean {
    const end = findTagEnd(this.#buffer);
    if (end === -1 && !final && beginsWithAny(this.#buffer, TAG_PREFIXES)) return false;
    if (end < 0) {
      this.#pass('<');
      this.#buffer = this.#buffer.slice(1);
      return true;
    }

    const tag = parseTag(this.#buffer.slice(0, end + 1));
    const kind = tag ? TAG_KINDS[tag.name] : undefined;
    if (!tag || (!kind && !tag.name.startsWith('willow-'))) {
      this.#pass('<');
      this.#buffer = this.#buffer.slice(1);
      return true;
    }

    // A fence held before this tag was wrapping it.
    if (this.#heldFence && !tag.closing) {
      this.#heldFence = null;
      this.#dropClosingFence = true;
    }

    this.#buffer = this.#buffer.slice(end + 1);

    // A closer with nothing open is protocol noise, never prose.
    if (tag.closing) return true;

    const id = nextId('block');

    // An unknown `willow-` tag is still an attempted action: report it so the
    // model can be told, rather than leaving markup in the transcript.
    if (!kind) {
      this.handlers.onBlock({ id, kind: 'ignored', tag: tag.name, attrs: tag.attrs, body: '', complete: true });
      return true;
    }
    if (kind === 'ignored' && !ECHO_TAGS.has(tag.name)) return true;

    // bolt's shell and start actions have nothing to run here; their bodies are skipped.
    const isBolt = tag.name === 'boltAction';
    const effectiveKind: BlockKind = isBolt && tag.attrs.type !== 'file' ? 'ignored' : kind;
    const attrs = isBolt && tag.attrs.filePath ? { ...tag.attrs, path: tag.attrs.filePath } : tag.attrs;

    if (tag.selfClosing || ATTRIBUTE_ONLY_KINDS.has(effectiveKind)) {
      if (!tag.selfClosing) this.#swallowCloser = `</${tag.name}>`;
      if (effectiveKind !== 'ignored') {
        this.handlers.onBlock({ id, kind: effectiveKind, tag: tag.name, attrs, body: '', complete: true });
      }
      return true;
    }

    this.#block = {
      id,
      kind: effectiveKind,
      tag: tag.name,
      closer: `</${tag.name}>`,
      attrs,
      chunks: [],
      tail: '',
      length: 0,
      lines: 0,
    };
    this.#mode = 'block';
    if (effectiveKind !== 'ignored') {
      this.handlers.onBlockOpen?.({ id, kind: effectiveKind, tag: tag.name, attrs });
    }
    return true;
  }

  #drainBlock(): boolean {
    const block = this.#block;
    if (!block) {
      this.#mode = 'text';
      return true;
    }
    if (this.#buffer === '') return false;

    const work = block.tail + this.#buffer;
    const closeAt = work.indexOf(block.closer);

    // A new opener at the start of a line, before any closer, means this block
    // was never closed. Only bodies that are prose-like can be mistaken.
    let implicitAt = -1;
    if (block.kind === 'write' || block.kind === 'edit' || block.kind === 'plan' || ECHO_TAGS.has(block.tag)) {
      const match = LINE_START_OPENER.exec(work);
      if (match) implicitAt = match.index;
    }

    if (closeAt !== -1 && (implicitAt === -1 || closeAt < implicitAt)) {
      this.#finishBlock(work.slice(0, closeAt));
      this.#buffer = work.slice(closeAt + block.closer.length);
      this.#atLineStart = false;
      return true;
    }
    if (implicitAt !== -1) {
      this.#finishBlock(work.slice(0, implicitAt));
      this.#buffer = work.slice(implicitAt + 1);
      this.#atLineStart = true;
      return true;
    }

    // No end yet: hold back anything that could be the start of one.
    const hold = Math.max(partialSuffix(work, block.closer), this.#partialOpenerHold(work));
    const safe = work.length - hold;
    const previousTail = block.tail.length;
    if (safe <= previousTail) return false;

    const commit = Math.max(0, safe - TAIL_KEEP);
    if (commit > 0) block.chunks.push(work.slice(0, commit));
    block.tail = work.slice(commit, safe);
    this.#buffer = work.slice(safe);

    block.length += safe - previousTail;
    block.lines += countNewlines(work.slice(previousTail, safe));
    if (block.kind !== 'ignored') {
      this.handlers.onBlockProgress?.(block.id, { length: block.length, lines: block.lines });
    }
    return false;
  }

  /** A trailing `\n<willow-…` that may be the start of an implicit close. */
  #partialOpenerHold(text: string): number {
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline === -1) return 0;
    const tail = text.slice(lastNewline + 1).replace(/^[ \t]+/, '');
    if (tail.length > 24) return 0;
    if (tail === '' || '<willow-'.startsWith(tail) || tail.startsWith('<willow-')) return text.length - lastNewline;
    return 0;
  }

  #finishBlock(rest: string): void {
    const block = this.#block!;
    this.#block = null;
    this.#mode = 'text';
    if (block.kind === 'ignored') return;
    const body = block.chunks.join('') + rest;
    this.handlers.onBlock({ id: block.id, kind: block.kind, tag: block.tag, attrs: block.attrs, body, complete: true });
  }

  #drainPatch(): boolean {
    let progressed = false;
    for (let newline = this.#buffer.indexOf('\n'); newline !== -1; newline = this.#buffer.indexOf('\n')) {
      const line = this.#buffer.slice(0, newline).replace(/\r$/, '');
      this.#buffer = this.#buffer.slice(newline + 1);
      progressed = true;
      if (line.trim().endsWith(PATCH_END)) {
        this.#closePatch(line);
        return true;
      }
      // The rest of the opener's own line, when its newline arrived separately.
      if (this.#patchLines.length === 1 && line.trim() === '') continue;
      this.#patchLines.push(line);
      this.handlers.onBlockProgress?.(this.#patchId, { length: 0, lines: this.#patchLines.length });
    }
    // `*** End Patch` with no newline after it yet.
    if (this.#buffer.trim().endsWith(PATCH_END)) {
      const line = this.#buffer;
      this.#buffer = '';
      this.#closePatch(line);
      return true;
    }
    return progressed;
  }

  #closePatch(line: string): void {
    const before = line.trim().slice(0, -PATCH_END.length);
    if (before.trim()) this.#patchLines.push(before);
    this.#patchLines.push(PATCH_END);
    this.#mode = 'text';
    this.#atLineStart = true;
    const body = this.#patchLines.join('\n');
    this.#patchLines = [];
    this.handlers.onBlock({ id: this.#patchId, kind: 'patch', tag: 'patch', attrs: {}, body, complete: true });
  }
}

/* ------------------------------------------------------------------------ */
/* Body clean-up                                                             */
/* ------------------------------------------------------------------------ */

/**
 * A write's body, as the file it means.
 *
 * Drops the newline right after the opening tag and the one right before the
 * closer, unwraps a code fence the model put inside the tag, and undoes HTML
 * escaping when a model escaped a whole file (a TSX file with no raw `<` but
 * plenty of `&lt;` was escaped, not written that way).
 */
export function cleanFileBody(body: string): string {
  let text = body.replace(/\r\n/g, '\n');
  text = text.replace(/^[ \t]*\n/, '');
  text = text.replace(/\n[ \t]*$/, '');

  const fenced = /^\s*```[\w+.-]*[ \t]*\n([\s\S]*?)\n?[ \t]*```\s*$/.exec(text);
  if (fenced) text = fenced[1]!;

  const escapedTags = (text.match(/&lt;/g) ?? []).length;
  if (escapedTags >= 2 && !text.includes('<')) {
    text = text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  return text.length > 0 && !text.endsWith('\n') ? `${text}\n` : text;
}
