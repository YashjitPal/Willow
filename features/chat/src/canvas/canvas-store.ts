/**
 * Canvas documents: the data model, derived from the message log rather than
 * stored beside it.
 *
 * ## Why derived
 *
 * The obvious design is a separate document store that the tool executor writes
 * into. It is the wrong one here, and the reason is persistence: a chat is saved
 * as a list of messages, so a side store needs its own save path, its own
 * migration, and its own answer to "what happens when the two disagree". None of
 * that buys anything, because the message log *already is* the version history.
 *
 * This mirrors what Gemini actually does on the wire (measured — see
 * `CANVAS-UI-SPEC.md` §7). Its assistant turns carry a placeholder token in the
 * visible text plus a sidecar entry naming a stable document id and a version
 * stamp:
 *
 *     ["http://googleusercontent.com/immersive_entry_chip/0"],
 *     "c_0708e76e54ca12fd_photosynthesis_guide.md",   <- stable across revisions
 *     "A Quick Guide to Photosynthesis",
 *     [1788008161, 82410095],                          <- changes per revision
 *     1                                                <- 1 = text, 2 = code
 *
 * Six consecutive turns editing one document shared one id and differed only in
 * the version stamp. So "the document" is not a thing that lives somewhere and
 * gets mutated — it is the fold of every turn that touched it. Replaying the
 * refs in message order reconstructs the whole history, which makes
 * Previous/Next version a walk over messages rather than a stack to maintain.
 *
 * Two consequences worth stating because they are easy to regress:
 *
 *  - **Each ref carries the FULL document as of that turn**, not a diff. A diff
 *    chain cannot be rebuilt if one message is dropped (and messages *are*
 *    dropped — `hasSavedMessageContent` filters empty turns), and it would make
 *    rendering the card O(history). The redundancy is the point.
 *
 *    IN MEMORY. On disk it is diffed, because seven revisions of a 40KB document
 *    wrote 280KB per save — see `canvas-diff.ts`, which reverses the chain so the
 *    newest text is the one stored whole and only history is derived.
 *  - **`index` is an offset into the turn's own `content`**, like `citations`
 *    and `codeExecutions`. The chip renders at that position, so a model that
 *    writes a preamble before calling the tool gets a card *below the preamble*
 *    — which is the "a card appears in between the message" behaviour, and it
 *    falls out of the data rather than needing layout rules.
 */

import { atom } from 'nanostores';
import type { MessageCitations } from '@willow/ai/grounding';
import type { ChatMsg } from '../chat-message';

export type CanvasKind = 'text' | 'code';

/**
 * One turn's contribution to a document: a full snapshot plus where its chip
 * belongs in that turn's text.
 *
 * Stored on `ChatMsg.canvasRefs`, so it is saved and reloaded by the existing
 * chat persistence with no extra path.
 */
export interface CanvasRef {
  /** Stable across every revision of this document, like Gemini's doc id. */
  docId: string;
  /** Character offset into the message's `content` where the chip renders. */
  index: number;
  title: string;
  kind: CanvasKind;
  /** Highlighting hint for code documents; ignored for text. */
  language?: string;
  /** The complete document as of this turn. See the note above on why not a diff. */
  content: string;
  /**
   * What the MODEL wrote, present only once the user has edited this revision by
   * hand.
   *
   * A hand edit used to overwrite `content` and leave the version count alone,
   * which the user filed: "if I make some changes in the codebase and then press
   * undo, it wouldn't revert my manual changes rather it would make the version
   * same as the previous version before the last version the ai gave". So the
   * model's text moves here and `content` becomes the user's, and the fold turns
   * one ref into two versions — Undo from a hand-edited document now lands on the
   * model's own text, which is what Undo was reaching for.
   *
   * Only ever set ONCE per revision, so typing does not mint a version per
   * keystroke: the first edit moves the model's text aside and every later
   * keystroke rewrites `content` in place. A new model revision starts a new ref,
   * and therefore a new pair.
   */
  originalContent?: string;
  /**
   * When this revision was written, `Date.now()` at the moment the tool ran.
   *
   * Here rather than on `ChatMsg` because `ChatMsg` has no timestamp at all, and
   * the collapsed chip needs one: Gemini's second line is `Aug 29, 6:39 PM`, not
   * a version count. Optional, because every ref written before this field
   * existed is on disk without it — `CanvasCard` falls back to the old
   * `Code · Canvas` subtitle rather than inventing a date.
   */
  createdAt?: number;
  /** When the user last typed into it; the hand-edited version's own stamp. */
  editedAt?: number;
}

/** A document folded out of every ref that names it, oldest first. */
export interface CanvasDoc {
  docId: string;
  kind: CanvasKind;
  language?: string;
  /** The newest title wins — a rename in a later turn should stick. */
  title: string;
  versions: CanvasVersion[];
  /**
   * Index in the message log of the turn that last touched this document.
   *
   * Not the same as position in the returned Map, and the difference is load
   * bearing: the Map is keyed in *first-seen* order, so with A created, then B
   * created, then A edited, the last key is B while the document the user is
   * working on is A. "The current document" — what `update_canvas` means with no
   * id, and what the panel reopens — is this, not insertion order.
   */
  lastTouchedIndex: number;
}


export interface CanvasVersion {
  content: string;
  title: string;
  /** The message this revision came from, so the card can scroll to its turn. */
  messageId: string;
  /**
   * Which ref of that message produced it.
   *
   * With `messageId` it identifies the ref exactly, which is what a card needs to
   * find its own version — a turn that touched one document twice has two refs
   * with the same message id, and a hand-edited ref contributes TWO versions. The
   * card wants the last version its own ref produced, and counting hits per
   * message cannot express that.
   */
  refIndex: number;
  /** Copied off the ref; absent for anything written before the field existed. */
  createdAt?: number;
  /** `user` for the hand-edited half of a ref — see `CanvasRef.originalContent`. */
  origin?: 'model' | 'user';
}

/**
 * Fold the message log into documents.
 *
 * Linear in the history and cheap enough to run per render at realistic thread
 * lengths, but callers on a hot path should memoise on `messages`.
 */
export const buildCanvasDocs = (messages: ChatMsg[]): Map<string, CanvasDoc> => {
  const docs = new Map<string, CanvasDoc>();
  messages.forEach((message, messageIndex) => {
    (message.canvasRefs ?? []).forEach((ref, refIndex) => {
      /*
       * A hand-edited ref is TWO versions: the model's text, then the user's. In
       * that order because that is the order they happened, and Undo walks the
       * list — from a hand-edited document it must land on what the model wrote.
       */
      const edited = typeof ref.originalContent === 'string'
        && ref.originalContent.length > 0
        && ref.originalContent !== ref.content;
      const snapshots: CanvasVersion[] = [];
      if (edited) {
        snapshots.push({
          content: ref.originalContent,
          title: ref.title,
          messageId: message.id,
          refIndex,
          origin: 'model',
          ...(ref.createdAt ? { createdAt: ref.createdAt } : {}),
        });
      }
      snapshots.push({
        content: ref.content,
        title: ref.title,
        messageId: message.id,
        refIndex,
        ...(edited ? { origin: 'user' as const } : {}),
        /* The hand-edited half is stamped when it was typed, not when the tool
         * ran — the chip and the version nav both read this. */
        ...(edited
          ? (ref.editedAt ? { createdAt: ref.editedAt } : {})
          : (ref.createdAt ? { createdAt: ref.createdAt } : {})),
      });
      const existing = docs.get(ref.docId);
      if (existing) {
        existing.versions.push(...snapshots);
        // Later turns win for the display fields: a document renamed or
        // re-languaged mid-conversation should read as its current self.
        existing.title = ref.title;
        if (ref.language) existing.language = ref.language;
        existing.lastTouchedIndex = messageIndex;
      } else {
        docs.set(ref.docId, {
          docId: ref.docId,
          kind: ref.kind,
          language: ref.language,
          title: ref.title,
          versions: snapshots,
          lastTouchedIndex: messageIndex,
        });
      }
    });
  });
  return docs;
};

/** The document a bare "update it" means: the one most recently written to. */
export const currentCanvasDoc = (docs: Map<string, CanvasDoc>): CanvasDoc | null => {
  let newest: CanvasDoc | null = null;
  for (const doc of docs.values()) {
    if (!newest || doc.lastTouchedIndex >= newest.lastTouchedIndex) newest = doc;
  }
  return newest;
};


/**
 * Which document the full-bleed panel is showing, and at which revision.
 *
 * `version` is an index into `CanvasDoc.versions`, not a count — Previous/Next
 * step it, and it is clamped on read because a chat can be reloaded with a
 * stale index pointing past a shorter history.
 */
export interface OpenCanvas {
  docId: string;
  version: number;
}

export const $openCanvas = atom<OpenCanvas | null>(null);

/**
 * Which inline cards are expanded, keyed `messageId:docId`.
 *
 * A Set rather than a single id because expansion is genuinely not exclusive —
 * measured on the live app, two cards stayed open at once with no interference.
 * Newly generated turns still arrive collapsed, so in normal use one is open;
 * that is a property of how they are created, not a rule to enforce here.
 */
export const $expandedCanvasCards = atom<ReadonlySet<string>>(new Set());

export const canvasCardKey = (messageId: string, docId: string): string =>
  `${messageId}:${docId}`;

export const toggleCanvasCard = (messageId: string, docId: string): void => {
  const key = canvasCardKey(messageId, docId);
  const next = new Set($expandedCanvasCards.get());
  if (next.has(key)) next.delete(key); else next.add(key);
  $expandedCanvasCards.set(next);
};

export const setCanvasCardExpanded = (
  messageId: string,
  docId: string,
  expanded: boolean,
): void => {
  const key = canvasCardKey(messageId, docId);
  const current = $expandedCanvasCards.get();
  if (current.has(key) === expanded) return;
  const next = new Set(current);
  if (expanded) next.add(key); else next.delete(key);
  $expandedCanvasCards.set(next);
};

/**
 * Collapsing the panel expands that document's card in the thread.
 *
 * The measured behaviour, and the reason it is one function rather than two
 * calls at the call site: the panel and the card are the same document in two
 * places, so "close the panel" without "show the card" loses the user's place in
 * a way that reads as the document having been discarded.
 */
export const collapseCanvasToCard = (messageId: string, docId: string): void => {
  setCanvasCardExpanded(messageId, docId, true);
  $openCanvas.set(null);
};

/**
 * Forget every expanded card for one document.
 *
 * Called when the document opens in the panel, and it is a BUG FIX, not
 * housekeeping: `collapseCanvasToCard` above leaves the chip expanded, so
 * collapse → reopen used to show the document twice at once — a full editor in
 * the panel and a second one inline, each with its own toolbar. Nothing ever
 * cleared that flag, so the duplicate survived for the rest of the session.
 *
 * Keys are `messageId:docId`, so this drops every turn's card for the document
 * while leaving other documents' cards alone.
 */
export const collapseCanvasCardsFor = (docId: string): void => {
  const current = $expandedCanvasCards.get();
  const suffix = `:${docId}`;
  let changed = false;
  const next = new Set<string>();
  for (const key of current) {
    if (key.endsWith(suffix)) { changed = true; continue; }
    next.add(key);
  }
  if (changed) $expandedCanvasCards.set(next);
};

/**
 * Write a user edit back into the message log.
 *
 * The edit lands on the NEWEST ref naming this document, because that ref *is*
 * the document's current text (see the header): the fold reads the last one, the
 * panel shows the last one, and `update_canvas` hands the last one to the model
 * as the base for its next revision. Editing an older ref would rewrite history
 * and leave the newest version untouched.
 *
 * ## It appends exactly one version, not one per keystroke
 *
 * The first hand edit of a revision moves the model's text into
 * `originalContent`, which makes the fold emit two versions for that ref — the
 * model's, then the user's. Every later keystroke rewrites `content` only, so the
 * pair stays a pair however long the typing goes on. That is the fix for "if I
 * make some changes in the codebase and then press undo, it wouldn't revert my
 * manual changes": Undo from a hand-edited document now steps to the model's own
 * text, and Redo comes back to the user's.
 *
 * An edit that restores the model's text exactly REMOVES the pair rather than
 * leaving a version that is a duplicate of the one before it.
 *
 * Returns the same array when nothing changed, so a caller can hand the result
 * straight to `setMessages` without forcing a save of an unmodified thread.
 */
export const applyCanvasEdit = (
  messages: ChatMsg[],
  docId: string,
  content: string,
  now = Date.now(),
): ChatMsg[] => {
  let messageIndex = -1;
  let refIndex = -1;
  messages.forEach((message, mi) => {
    (message.canvasRefs ?? []).forEach((ref, ri) => {
      if (ref.docId !== docId) return;
      messageIndex = mi;
      refIndex = ri;
    });
  });
  if (messageIndex < 0) return messages;
  const message = messages[messageIndex];
  const refs = message.canvasRefs || [];
  const current = refs[refIndex];
  if (current.content === content) return messages;
  const original = typeof current.originalContent === 'string' && current.originalContent.length > 0
    ? current.originalContent
    : current.content;
  const nextRefs = refs.map((ref, index) => {
    if (index !== refIndex) return ref;
    if (original === content) {
      /* Typed back to what the model wrote: drop the pair. `originalContent` is
       * what makes the extra version exist, so removing it is what removes it. */
      const { originalContent, editedAt, ...rest } = ref;
      return { ...rest, content };
    }
    return { ...ref, content, originalContent: original, editedAt: now };
  });
  const next = messages.slice();
  next[messageIndex] = { ...message, canvasRefs: nextRefs };
  return next;
};

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * The collapsed chip's second line: `Aug 29, 6:39 PM`.
 *
 * Composed by hand rather than with `toLocaleString`, which renders that exact
 * request as "Aug 29 at 6:39 PM" on current ICU — the "at" is not in Gemini's
 * chip. The year is appended only when it is not the current one, so a
 * this-year document reads exactly as measured and an old one is not ambiguous.
 */
export const formatCanvasTimestamp = (at: number, now = Date.now()): string => {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const clock = `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
  const year = date.getFullYear() === new Date(now).getFullYear()
    ? ''
    : `, ${date.getFullYear()}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${year}, ${clock}`;
};

/**
 * Where a card's character offset can actually split the reply text.
 *
 * `CanvasRef.index` is a raw character count, captured mid-stream, so it can
 * land in the middle of a line. Handing StreamingMarkdown two halves of one
 * paragraph would render two paragraphs, and two halves of a fenced code block
 * would render an unterminated fence — so the offset moves FORWARD to the next
 * line break, and out of an open fence entirely. Moving forward rather than back
 * keeps the card below the text that introduces it, which is the whole point of
 * the offset.
 */
export const canvasSplitOffset = (text: string, index: number): number => {
  if (index <= 0) return 0;
  if (index >= text.length) return text.length;
  const lineStart = text[index - 1] === '\n'
    ? index
    : (() => {
      const next = text.indexOf('\n', index);
      return next === -1 ? text.length : next + 1;
    })();
  if (lineStart >= text.length) return text.length;
  // An odd number of fences before the split means it is inside one.
  const fences = text.slice(0, lineStart).match(/^[ \t]*```/gm);
  if (!fences || fences.length % 2 === 0) return lineStart;
  const close = /^[ \t]*```.*$/m.exec(text.slice(lineStart));
  if (!close || close.index === undefined) return text.length;
  const after = text.indexOf('\n', lineStart + close.index);
  return after === -1 ? text.length : after + 1;
};

/**
 * Re-base one segment's citations after a split.
 *
 * Offsets are absolute into the turn's whole text, and each segment is rendered
 * by its own StreamingMarkdown, which reads them as offsets into what it was
 * given. `sources` is passed through WHOLE and unsliced: `sourceIndices` index
 * into it, so filtering it would repoint every chip at the wrong publisher.
 */
export const canvasSliceCitations = (
  citations: MessageCitations | undefined,
  start: number,
  end: number,
): MessageCitations | undefined => {
  if (!citations) return undefined;
  if (start === 0 && end >= Number.MAX_SAFE_INTEGER) return citations;
  const length = end - start;
  const sliced = citations.citations
    .filter((citation) => citation.startIndex < end && citation.endIndex > start)
    .map((citation) => ({
      ...citation,
      startIndex: Math.max(0, citation.startIndex - start),
      endIndex: Math.min(length, citation.endIndex - start),
    }));
  return { sources: citations.sources, citations: sliced };
};

/** Clamp a possibly-stale version index against the document's real history. */
export const clampVersion = (doc: CanvasDoc, version: number): number =>
  Math.max(0, Math.min(version, doc.versions.length - 1));

/**
 * A document id for a new canvas.
 *
 * Shaped like Gemini's (`c_<conversation hash>_<filename>`) because the filename
 * half is load-bearing for the user, not decoration: it is what Export and
 * Download name the file, and what makes two documents in one chat
 * distinguishable in the thread. The slug is derived from the title so a second
 * document about the same subject collides *deliberately* — the model asking for
 * "Photosynthesis Guide" twice means the same document, which is the behaviour
 * that makes follow-up edits land on the original instead of forking it.
 */
export const canvasDocId = (
  chatKey: string,
  title: string,
  kind: CanvasKind,
  language?: string,
): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'document';
  const ext = kind === 'code' ? codeExtension(language) : 'md';
  return `c_${hashChatKey(chatKey)}_${slug}.${ext}`;
};

/** Short, stable, non-cryptographic — this only has to be unique within a chat. */
const hashChatKey = (key: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

const CODE_EXTENSIONS: Record<string, string> = {
  html: 'html', javascript: 'js', typescript: 'ts', jsx: 'jsx', tsx: 'tsx',
  python: 'py', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs', go: 'go',
  rust: 'rs', ruby: 'rb', php: 'php', swift: 'swift', kotlin: 'kt',
  sql: 'sql', bash: 'sh', shell: 'sh', json: 'json', yaml: 'yaml',
  css: 'css', markdown: 'md',
};

export const codeExtension = (language?: string): string =>
  CODE_EXTENSIONS[(language || '').toLowerCase()] ?? 'html';

/**
 * Can this code document be run in the preview iframe?
 *
 * Only HTML is honestly previewable: a Python or Go file has no browser
 * runtime, and showing an empty Preview tab beside working code reads as a bug
 * in Willow rather than an inapplicable feature. Gemini reaches the same place
 * from the other direction — its code canvas is preview-first and its documents
 * are `index.html`.
 */
export const isPreviewable = (doc: Pick<CanvasDoc, 'kind' | 'language'>): boolean => {
  if (doc.kind !== 'code') return false;
  const language = (doc.language || '').toLowerCase();
  // No language means the model did not say; HTML is the default for a code
  // canvas, so an unlabelled document is treated as previewable.
  return language === '' || language === 'html' || language === 'htm';
};
