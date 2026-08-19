/**
 * Chat ↔ notebook wiring.
 *
 * A notebook is a container for chats, so sending from a notebook has to reach
 * the chat surface — and the chat surface is `ChatView`, which owns its own
 * composer, model state, streaming, and persistence. Forking it for notebooks
 * would mean maintaining two chat implementations, so instead the notebook page
 * hands off through these atoms and `ChatView` picks the message up.
 *
 * The flow:
 *
 *   1. Notebook page's composer submits → `startNotebookChat()` sets `$notebookHandoff`
 *      and the caller navigates to the chat surface.
 *   2. `ChatView` mounts, sees a handoff whose `consumed` is false, marks it
 *      consumed, and calls its own `handleSend` with the prompt.
 *   3. `$chatNotebookId` stays set for as long as that chat is the active one, so
 *      the chat knows which notebook it belongs to and new turns keep grounding
 *      on its sources.
 *
 * `consumed` exists because React 18 StrictMode double-invokes effects in dev.
 * A plain "read then clear" fires the send twice — the flag makes the read
 * idempotent without depending on effect-run counts. See
 * [[harness-must-match-strictmode]] for why that matters here specifically.
 */
import { atom } from 'nanostores';

import type { Notebook, NotebookSource } from './notebook-types';
import { selectChunks, type EmbeddingModel } from './source-retrieval';

export interface NotebookHandoff {
  notebookId: string;
  prompt: string;
  /** Flipped by the consumer instead of clearing, so a double-effect is a no-op. */
  consumed: boolean;
}

export const $notebookHandoff = atom<NotebookHandoff | null>(null);

/**
 * The notebook the *currently open chat* belongs to, or null for a normal chat.
 *
 * Separate from the handoff: the handoff is a one-shot message, this persists for
 * the life of the chat so every later turn can still be grounded.
 */
export const $chatNotebookId = atom<string | null>(null);

/**
 * Build the grounding preamble for a notebook's sources.
 *
 * Deliberately plain text folded into the turn rather than provider-specific
 * "file" parts: Willow talks to several providers through `platform/ai`, and a
 * text preamble is the one representation all of them accept identically. Sources
 * with no inlined content contribute their title and URL only, which is still
 * useful context and never silently drops the source from the list.
 *
 * Truncated per source. A notebook can hold large pasted documents and the whole
 * set is prepended to *every* grounded turn, so an unbounded preamble would grow
 * the request until the model's context is exhausted — a failure that would show
 * up as an unrelated-looking API error much later.
 */
export const buildGrounding = async (
  sources: readonly NotebookSource[],
  options: { query?: string; model?: EmbeddingModel | null } = {},
): Promise<string> => {
  if (sources.length === 0) return '';

  /*
   * Retrieval, not the first N characters of everything.
   *
   * `selectChunks` sends the whole corpus when it fits and ranks passages when it
   * does not — which is what Google describes for Gemini Notebook, and what the
   * old fixed 12,000-character head-slice per source could not do: ask about the
   * end of a long document and it only ever saw the beginning.
   */
  const selection = await selectChunks({
    query: options.query ?? '',
    sources,
    model: options.model ?? null,
  });

  const withText = new Set(selection.chunks.map((chunk) => chunk.sourceId));
  const blocks = sources.map((source, index) => {
    const head = `[${index + 1}] ${source.title}${source.url ? ` (${source.url})` : ''}`;
    if (source.content && withText.has(source.id)) {
      /*
       * Passages are labelled with their character offset, so the model can say
       * where in a source something came from and two passages from one document
       * are visibly not contiguous — without it a model narrates across a gap as
       * though the text ran on.
       */
      const body = selection.chunks
        .filter((chunk) => chunk.sourceId === source.id)
        .map((chunk) => `(from character ${chunk.offset})\n${chunk.text}`)
        .join('\n\n…\n\n');
      return `${head}\n${body}`;
    }
    /*
     * Has text, but nothing scored well enough to fit the budget. Named anyway,
     * because a source the model is not told about is a source the user thinks it
     * read — and it must not claim to have consulted a passage it never saw.
     */
    if (source.content) {
      return `${head}\n(in this notebook, but no passage of it matched this question closely enough to include)`;
    }
    /*
     * No inlined text. Say *why* rather than listing a bare name: a model told
     * only "[2] chart.png" will cheerfully invent its contents, whereas one told
     * the contents are unavailable says so. Websites are the common case —
     * the page is never downloaded, only referenced.
     */
    if (source.kind === 'website') {
      return `${head}\n(link only — page text was not downloaded; use it as a reference, do not invent its contents)`;
    }
    if (source.mimeType?.startsWith('image/')) {
      return `${head}\n(image attached to this notebook; describe it only if it was provided to you in this turn)`;
    }
    return `${head}\n(${source.mimeType || 'file'} — contents not extracted; do not invent them)`;
  });
  return [
    'You are chatting inside a notebook. Ground your answers in these sources and',
    'say so plainly when the answer is not in them.',
    '',
    '--- SOURCES ---',
    blocks.join('\n\n'),
    '--- END SOURCES ---',
  ].join('\n');
};

/** Queue a first message for a notebook. The caller navigates afterwards. */
export const startNotebookChat = (notebook: Notebook, prompt: string): void => {
  $chatNotebookId.set(notebook.id);
  $notebookHandoff.set({ notebookId: notebook.id, prompt, consumed: false });
};

/**
 * The grounding block for whichever notebook the open chat belongs to, or `''`.
 *
 * Read from the store at call time rather than captured, because it is consumed
 * from inside the per-turn system-prompt build: a source added mid-conversation
 * has to reach the *next* turn, which a captured value would miss.
 *
 * This is why grounding goes in the system prompt and NOT into the user's message.
 * Folding it into the message text put the whole preamble in the visible bubble —
 * the user saw "You are chatting inside a notebook…" as their own words — and it
 * only ever grounded the first turn. The system prompt is rebuilt every turn and
 * is never rendered.
 */
export const getActiveNotebookGrounding = async (
  notebooks: readonly Notebook[],
  options: { query?: string; model?: EmbeddingModel | null } = {},
): Promise<string> => {
  const notebookId = $chatNotebookId.get();
  if (!notebookId) return '';
  const notebook = notebooks.find((candidate) => candidate.id === notebookId);
  if (!notebook) return '';
  return buildNotebookSystemPrompt(notebook, options);
};

/**
 * The notebook's full contribution to a turn's system prompt: the user's own
 * instructions from the settings sheet, then the source grounding.
 *
 * Instructions come FIRST and are labelled as the user's, because they are the thing
 * most likely to be overridden by the grounding block's own imperatives ("ground your
 * answers in these sources") if they trail it.
 *
 * Either half can be empty — a notebook with instructions but no sources is a normal
 * state, and so is the reverse — so the two are joined rather than nested.
 */
export const buildNotebookSystemPrompt = async (
  notebook: Notebook,
  options: { query?: string; model?: EmbeddingModel | null } = {},
): Promise<string> => {
  const parts: string[] = [];
  const instructions = (notebook.instructions ?? '').trim();
  if (instructions) {
    parts.push([
      'The user has set these instructions for this notebook. Follow them for every',
      'response here unless they conflict with a safety requirement.',
      '',
      instructions,
    ].join('\n'));
  }
  const grounding = await buildGrounding(notebook.sources, options);
  if (grounding) parts.push(grounding);
  return parts.join('\n\n');
};

/** Mark the pending handoff as taken, returning it if this call won the race. */
export const consumeNotebookHandoff = (): NotebookHandoff | null => {
  const handoff = $notebookHandoff.get();
  if (!handoff || handoff.consumed) return null;
  $notebookHandoff.set({ ...handoff, consumed: true });
  return handoff;
};

export const clearNotebookChatContext = (): void => {
  $notebookHandoff.set(null);
  $chatNotebookId.set(null);
};
