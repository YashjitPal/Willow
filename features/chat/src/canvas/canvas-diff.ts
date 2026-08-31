/**
 * Canvas history on disk: one full document plus reverse patches.
 *
 * ## The shape, and why it is reversed
 *
 * A `CanvasRef` carries the FULL document as of its turn, and in memory it stays
 * that way — the fold, the panel, the cards and the model context all read whole
 * strings, and nothing here changes that. What this module changes is the file: a
 * seven-revision code canvas wrote seven copies of the same 40KB document into
 * every save, which is what the user asked to stop ("store... in the form of diff
 * instead of storing all the code versions separately").
 *
 * The chain runs BACKWARDS. The NEWEST version of each document is stored whole,
 * and every older one is a patch that reconstructs it from the version after it.
 * Forward chains are the obvious design and they put the risk in the wrong place:
 * the current document — the one the user is reading, the one the model is handed
 * as the base for its next revision — would be the end of a chain of applications,
 * so one unreadable link would cost the live document rather than an old revision.
 * Reversed, a broken link costs history only, and the current text is never
 * derived from anything.
 *
 * Two more properties worth stating, because both are load bearing:
 *
 *  - **A file with no patches at all decodes correctly.** Every ref written before
 *    this existed has full `content`, and the decoder prefers a full string
 *    wherever it finds one. Old chats keep working, and so does anything written
 *    by a save path that does not encode (the turn runner's mid-turn checkpoint).
 *  - **Encoding happens after the empty-turn filter**, so the chain is built over
 *    exactly the messages being written. `hasSavedMessageContent` drops turns, and
 *    a chain built before that filter could reference a ref that never lands.
 */

/**
 * One step over the source's lines. `=` keeps, `-` drops, `+` inserts.
 *
 * Arrays rather than objects, and short tags, because this is written into every
 * save of the chat: `["=",12]` against `{"op":"keep","count":12}`.
 */
export type CanvasPatchOp = ['=', number] | ['-', number] | ['+', string[]];
export type CanvasPatch = CanvasPatchOp[];

/*
 * Above this many lines on either side of the changed region, the LCS table is
 * not worth building: 900² is ~3MB of Int32 and it runs on the save debounce.
 * Past it the middle is emitted as a replace, which is correct but uncompressed —
 * a document that large is also one where a single edit rarely stays local.
 */
const LCS_LINE_LIMIT = 900;

/** Longest common subsequence of two line arrays, as a keep/drop/insert script. */
const lcsOps = (from: string[], to: string[]): CanvasPatchOp[] => {
  const n = from.length;
  const m = to.length;
  /* (n+1) x (m+1), row-major. */
  const table = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * (m + 1) + j] = from[i] === to[j]
        ? table[(i + 1) * (m + 1) + j + 1] + 1
        : Math.max(table[(i + 1) * (m + 1) + j], table[i * (m + 1) + j + 1]);
    }
  }
  const ops: CanvasPatchOp[] = [];
  /* Runs are coalesced as they are emitted: three separate `["-",1]` for three
   * deleted lines would cost more than the lines themselves. */
  const push = (op: CanvasPatchOp) => {
    const last = ops[ops.length - 1];
    if (last && last[0] === op[0]) {
      if (op[0] === '+') (last[1] as string[]).push(...(op[1] as string[]));
      else (last as ['=' | '-', number])[1] += op[1] as number;
      return;
    }
    ops.push(op);
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (from[i] === to[j]) { push(['=', 1]); i += 1; j += 1; continue; }
    if (table[(i + 1) * (m + 1) + j] >= table[i * (m + 1) + j + 1]) { push(['-', 1]); i += 1; }
    else { push(['+', [to[j]]]); j += 1; }
  }
  if (i < n) push(['-', n - i]);
  if (j < m) push(['+', to.slice(j)]);
  return ops;
};

/**
 * A patch turning `from` into `to`, line-wise.
 *
 * The common head and tail are matched before anything else. That is not only an
 * optimisation: a revision that rewrites one function in a 2000-line file reduces
 * to two `=` runs around a small middle, and the middle is what the LCS limit
 * above is measured against.
 */
export const diffCanvasText = (from: string, to: string): CanvasPatch => {
  const a = from.split('\n');
  const b = to.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head
    && tail < b.length - head
    && a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) tail += 1;

  const middleA = a.slice(head, a.length - tail);
  const middleB = b.slice(head, b.length - tail);
  const ops: CanvasPatchOp[] = [];
  if (head) ops.push(['=', head]);
  if (middleA.length > LCS_LINE_LIMIT || middleB.length > LCS_LINE_LIMIT) {
    if (middleA.length) ops.push(['-', middleA.length]);
    if (middleB.length) ops.push(['+', middleB]);
  } else {
    ops.push(...lcsOps(middleA, middleB));
  }
  if (tail) ops.push(['=', tail]);
  return ops;
};

/** Replay a patch. `null` on anything that does not fit — a malformed op, or a
 *  cursor that runs off the end of the source. */
export const applyCanvasPatch = (from: string, patch: unknown): string | null => {
  if (!Array.isArray(patch)) return null;
  const lines = from.split('\n');
  const out: string[] = [];
  let cursor = 0;
  for (const op of patch) {
    if (!Array.isArray(op) || op.length !== 2) return null;
    const [tag, value] = op as [string, unknown];
    if (tag === '=' || tag === '-') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
      if (cursor + value > lines.length) return null;
      if (tag === '=') for (let i = 0; i < value; i += 1) out.push(lines[cursor + i]);
      cursor += value;
      continue;
    }
    if (tag !== '+') return null;
    if (!Array.isArray(value) || value.some((line) => typeof line !== 'string')) return null;
    out.push(...(value as string[]));
  }
  if (cursor !== lines.length) return null;
  return out.join('\n');
};

/*
 * The two texts a ref can hold, oldest first.
 *
 * `originalContent` is only present on a ref the user has edited by hand: it is
 * what the model wrote, kept so the edit becomes its own version instead of
 * overwriting the model's (see `applyCanvasEdit`). So a hand-edited turn
 * contributes two links to the chain, in this order.
 */
const SLOT_FIELDS = [
  { text: 'originalContent', patch: 'originalPatch' },
  { text: 'content', patch: 'contentPatch' },
] as const;

interface Slot { ref: any; text: string; patch: string }

/** Every text a document's history holds, oldest first, across all messages. */
const chainSlots = (messages: any[], present: (ref: any, slot: { text: string; patch: string }) => boolean) => {
  const chains = new Map<string, Slot[]>();
  for (const message of messages) {
    const refs = message && Array.isArray(message.canvasRefs) ? message.canvasRefs : [];
    for (const ref of refs) {
      if (!ref || typeof ref !== 'object' || typeof ref.docId !== 'string') continue;
      for (const slot of SLOT_FIELDS) {
        if (!present(ref, slot)) continue;
        const chain = chains.get(ref.docId);
        const entry: Slot = { ref, text: slot.text, patch: slot.patch };
        if (chain) chain.push(entry); else chains.set(ref.docId, [entry]);
      }
    }
  }
  return chains;
};

/** Shallow clone down to the refs, so neither direction mutates its input. */
const cloneForRewrite = (messages: any[]): any[] => messages.map((message) => (
  message && Array.isArray(message.canvasRefs)
    ? { ...message, canvasRefs: message.canvasRefs.map((ref: any) => (ref && typeof ref === 'object' ? { ...ref } : ref)) }
    : message
));

/**
 * Squeeze every document's history down to its newest text plus reverse patches.
 *
 * Call this LAST, on the array that is about to be written — after
 * `serializeChatMessage` and after the empty-turn filter, so the chain matches
 * the file. A document whose texts are not all usable strings is left whole
 * rather than half-encoded.
 */
export const encodeCanvasHistory = (messages: any[]): any[] => {
  if (!Array.isArray(messages)) return messages;
  const out = cloneForRewrite(messages);
  const chains = chainSlots(out, (ref, slot) => typeof ref[slot.text] === 'string' && ref[slot.text].length > 0);
  for (const chain of chains.values()) {
    if (chain.length < 2) continue;
    const texts = chain.map((slot) => slot.ref[slot.text] as string);
    for (let i = 0; i < chain.length - 1; i += 1) {
      chain[i].ref[chain[i].patch] = diffCanvasText(texts[i + 1], texts[i]);
      delete chain[i].ref[chain[i].text];
    }
  }
  return out;
};

/**
 * Rebuild full texts from whatever the file holds.
 *
 * Runs on RAW parsed JSON, before `sanitizeSavedCanvasRefs`, because that
 * function drops a ref with no `content` — which every patch-only ref is until
 * this has run. A link that will not apply is left empty rather than guessed at,
 * and sanitize then drops it: losing an old revision is recoverable, inventing
 * one is not.
 */
export const decodeCanvasHistory = (messages: any[]): any[] => {
  if (!Array.isArray(messages)) return messages;
  const out = cloneForRewrite(messages);
  const chains = chainSlots(
    out,
    (ref, slot) => typeof ref[slot.text] === 'string' || Array.isArray(ref[slot.patch]),
  );
  for (const chain of chains.values()) {
    let known: string | null = null;
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const { ref, text, patch } = chain[i];
      if (typeof ref[text] === 'string' && ref[text].length > 0) {
        known = ref[text];
      } else if (known !== null && Array.isArray(ref[patch])) {
        const rebuilt = applyCanvasPatch(known, ref[patch]);
        if (rebuilt === null) known = null;
        else { ref[text] = rebuilt; known = rebuilt; }
      } else {
        known = null;
      }
      delete ref[patch];
    }
  }
  return out;
};
