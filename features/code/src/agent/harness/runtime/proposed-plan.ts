/**
 * The `<proposed_plan>` block — Plan mode's output format.
 *
 * A port of `codex-rs/utils/stream-parser/src/proposed_plan.rs` and the
 * `TaggedLineParser` underneath it.
 *
 * ## Why a parser rather than a regex
 *
 * Because it has to work on a token stream. The plan block is the *deliverable*
 * of a Plan mode turn, and the mode document tells the model to wrap it so "the
 * client can render it specially" — which means the client has to know it is
 * inside the block while the block is still arriving, not after. Upstream
 * streams `item/plan/delta` events for exactly this.
 *
 * ## The rule that makes it correct
 *
 * **A tag counts only when it is alone on its line.** Leading and trailing
 * whitespace is allowed; anything else on the line is not. Upstream pins this
 * with a test — `"  <proposed_plan> extra\n"` comes back as ordinary text, tag
 * and all — and the reason is that plans discuss their own format. A model
 * writing "wrap it in a `<proposed_plan>` block" mid-sentence must not open one.
 *
 * Achieving that on a stream is the whole of the design: each line is buffered
 * while it is still *possible* for it to be a bare tag, and released as text the
 * moment that becomes impossible. `isTagPrefix` is the test for "still
 * possible", which is why it compares against prefixes rather than equality.
 */

const OPEN_TAG = '<proposed_plan>';
const CLOSE_TAG = '</proposed_plan>';

export type ProposedPlanSegment =
  | { kind: 'normal'; text: string }
  | { kind: 'start' }
  | { kind: 'delta'; text: string }
  | { kind: 'end' };

export interface StreamTextChunk {
  /** Assistant text with plan blocks removed — what the user reads. */
  visibleText: string;
  /** Ordered segments, including `normal` ones, so ordering is recoverable. */
  extracted: ProposedPlanSegment[];
}

/**
 * `push_segment`: drops empty text and coalesces adjacent runs of the same kind.
 *
 * The coalescing is not cosmetic — it is what makes the segment list
 * comparable, and it is why one logical paragraph arriving as forty tokens
 * produces one segment.
 */
function pushSegment(segments: ProposedPlanSegment[], segment: ProposedPlanSegment): void {
  const last = segments[segments.length - 1];

  if (segment.kind === 'normal') {
    if (segment.text === '') return;
    if (last?.kind === 'normal') {
      last.text += segment.text;
      return;
    }
    segments.push(segment);
    return;
  }

  if (segment.kind === 'delta') {
    if (segment.text === '') return;
    if (last?.kind === 'delta') {
      last.text += segment.text;
      return;
    }
    segments.push(segment);
    return;
  }

  segments.push(segment);
}

/** `ProposedPlanParser` + `TaggedLineParser`, specialised to the one tag. */
export class ProposedPlanParser {
  private inPlan = false;
  private detectTag = true;
  private lineBuffer = '';

  push(delta: string): StreamTextChunk {
    const segments: ProposedPlanSegment[] = [];
    let run = '';

    for (const ch of delta) {
      if (this.detectTag) {
        if (run !== '') {
          this.pushText(run, segments);
          run = '';
        }
        this.lineBuffer += ch;

        if (ch === '\n') {
          this.finishLine(segments);
          continue;
        }

        const slug = this.lineBuffer.replace(/^\s+/, '');
        // Still empty, or still a viable prefix of a tag: keep buffering.
        if (slug === '' || isTagPrefix(slug)) continue;

        // It cannot be a bare tag any more, so release it as text and stop
        // buffering until the next line starts.
        const buffered = this.lineBuffer;
        this.lineBuffer = '';
        this.detectTag = false;
        this.pushText(buffered, segments);
        continue;
      }

      run += ch;
      if (ch === '\n') {
        this.pushText(run, segments);
        run = '';
        this.detectTag = true;
      }
    }

    if (run !== '') this.pushText(run, segments);

    return toChunk(segments);
  }

  /**
   * `finish`: resolve a half-buffered final line, then close an open block.
   *
   * The unconditional `end` at the bottom is upstream's, and it matters: a
   * stream that dies mid-plan still produces a complete, renderable plan
   * segment rather than a card that never closes.
   */
  finish(): StreamTextChunk {
    const segments: ProposedPlanSegment[] = [];

    if (this.lineBuffer !== '') {
      const buffered = this.lineBuffer;
      this.lineBuffer = '';
      const slug = stripTrailingNewline(buffered).trim();

      if (slug === OPEN_TAG && !this.inPlan) {
        pushSegment(segments, { kind: 'start' });
        this.inPlan = true;
      } else if (slug === CLOSE_TAG && this.inPlan) {
        pushSegment(segments, { kind: 'end' });
        this.inPlan = false;
      } else {
        this.pushText(buffered, segments);
      }
    }

    if (this.inPlan) {
      pushSegment(segments, { kind: 'end' });
      this.inPlan = false;
    }

    this.detectTag = true;
    return toChunk(segments);
  }

  private finishLine(segments: ProposedPlanSegment[]): void {
    const line = this.lineBuffer;
    this.lineBuffer = '';
    const slug = stripTrailingNewline(line).trim();

    if (slug === OPEN_TAG && !this.inPlan) {
      pushSegment(segments, { kind: 'start' });
      this.inPlan = true;
      this.detectTag = true;
      return;
    }

    if (slug === CLOSE_TAG && this.inPlan) {
      pushSegment(segments, { kind: 'end' });
      this.inPlan = false;
      this.detectTag = true;
      return;
    }

    this.detectTag = true;
    this.pushText(line, segments);
  }

  /** `push_text`: inside a block it is plan content, outside it is prose. */
  private pushText(text: string, segments: ProposedPlanSegment[]): void {
    pushSegment(segments, this.inPlan ? { kind: 'delta', text } : { kind: 'normal', text });
  }
}

const stripTrailingNewline = (value: string): string =>
  value.endsWith('\n') ? value.slice(0, -1) : value;

/** `is_tag_prefix`. Trailing whitespace is tolerated, so `"<tag> "` still matches. */
function isTagPrefix(slug: string): boolean {
  const trimmed = slug.replace(/\s+$/, '');
  return OPEN_TAG.startsWith(trimmed) || CLOSE_TAG.startsWith(trimmed);
}

function toChunk(segments: ProposedPlanSegment[]): StreamTextChunk {
  let visibleText = '';
  for (const segment of segments) {
    if (segment.kind === 'normal') visibleText += segment.text;
  }
  return { visibleText, extracted: segments };
}

/** `strip_proposed_plan_blocks`. */
export function stripProposedPlanBlocks(text: string): string {
  const parser = new ProposedPlanParser();
  return parser.push(text).visibleText + parser.finish().visibleText;
}

/**
 * `extract_proposed_plan_text`.
 *
 * Returns the *last* block when several appear — `plan_text.clear()` on each
 * start — which matches the mode document's "any new `<proposed_plan>` must be
 * a complete replacement".
 */
export function extractProposedPlanText(text: string): string | null {
  const parser = new ProposedPlanParser();
  const segments = [...parser.push(text).extracted, ...parser.finish().extracted];

  let planText = '';
  let sawPlanBlock = false;
  for (const segment of segments) {
    if (segment.kind === 'start') {
      sawPlanBlock = true;
      planText = '';
    } else if (segment.kind === 'delta') {
      planText += segment.text;
    }
  }

  return sawPlanBlock ? planText : null;
}
