/**
 * The Canvas tool executor: what actually happens when the model calls
 * `create_canvas` or `update_canvas`.
 *
 * ## Why the document state lives here and not in a store
 *
 * A canvas revision is a fact about a message, not a fact about the app — see
 * `canvas-store.ts` for why. That leaves the executor with a problem it has to
 * solve rather than delegate: `update_canvas` needs the document's *current*
 * text, and during a turn that text exists in two places at once. The versions
 * folded out of the message log are everything up to this turn; anything this
 * turn already wrote is only in `turnRefs`, because the ref does not reach the
 * message log until the turn is saved.
 *
 * So `latestOf` reads this-turn-first and falls back to the fold. Getting that
 * backwards produces a bug with a distinctive shape: two edits in one turn, and
 * the second one silently reverts the first.
 *
 * ## The index is captured at call time
 *
 * `host.contentLength()` is read at the moment the call is executed, not when
 * the turn settles, because that offset is where the card renders. Reading it
 * later would put every card at the end of the reply and lose the "card in the
 * middle of the message" behaviour that Gemini gets from its placeholder token.
 */

import {
  canvasDocId,
  currentCanvasDoc,
  type CanvasDoc,
  type CanvasKind,
  type CanvasRef,
} from './canvas-store';
import {
  applyCanvasUpdates,
  CREATE_CANVAS,
  UPDATE_CANVAS,
  describeCanvasEditResult,
  readCreateCanvasArgs,
  readUpdateCanvasArgs,
  stripCanvasCodeFence,
} from './canvas-tools';

export type CanvasToolResult =
  | { status: 'ok'; result: string }
  | { status: 'error'; error: string };

export interface CanvasToolHost {
  /** Names the document ids. The chat's title, or its session id before naming. */
  chatKey: string;
  /** Documents the thread held before this turn. Folded once by the caller. */
  priorDocs: Map<string, CanvasDoc>;
  /** Characters of reply text written so far — where this card renders. */
  contentLength: () => number;
  /** Publish a revision. Called once per successful tool call. */
  publish: (ref: CanvasRef) => void;
}

/** The state of a document at the moment a tool call reads it. */
interface CanvasSnapshot {
  docId: string;
  kind: CanvasKind;
  language?: string;
  title: string;
  content: string;
}

/**
 * Build the executor for one turn.
 *
 * Stateful on purpose — `turnRefs` is the this-turn half of the document state
 * described above — so it must be constructed per turn, not shared.
 */
export const createCanvasToolExecutor = (host: CanvasToolHost) => {
  const turnRefs: CanvasRef[] = [];

  const latestOf = (docId: string): CanvasSnapshot | null => {
    for (let i = turnRefs.length - 1; i >= 0; i -= 1) {
      const ref = turnRefs[i];
      if (ref.docId === docId) {
        return {
          docId,
          kind: ref.kind,
          language: ref.language,
          title: ref.title,
          content: ref.content,
        };
      }
    }
    const doc = host.priorDocs.get(docId);
    if (!doc) return null;
    const newest = doc.versions[doc.versions.length - 1];
    return {
      docId,
      kind: doc.kind,
      language: doc.language,
      title: newest?.title ?? doc.title,
      content: newest?.content ?? '',
    };
  };

  /** What a bare `update_canvas` means: whatever was written to most recently. */
  const currentDocId = (): string | null => {
    if (turnRefs.length) return turnRefs[turnRefs.length - 1].docId;
    return currentCanvasDoc(host.priorDocs)?.docId ?? null;
  };

  const knownIds = (): string[] => {
    const ids = new Set<string>(host.priorDocs.keys());
    for (const ref of turnRefs) ids.add(ref.docId);
    return [...ids];
  };

  const emit = (snapshot: CanvasSnapshot): CanvasRef => {
    const ref: CanvasRef = {
      docId: snapshot.docId,
      // Read now, not at settle: this offset is where the card renders.
      index: host.contentLength(),
      title: snapshot.title,
      kind: snapshot.kind,
      ...(snapshot.language ? { language: snapshot.language } : {}),
      content: snapshot.content,
      // The chip's second line. Stamped here because this is the only moment the
      // revision exists as an event; `ChatMsg` carries no timestamp of its own,
      // so nothing downstream could recover it later.
      createdAt: Date.now(),
    };
    turnRefs.push(ref);
    host.publish(ref);
    return ref;
  };

  const create = (args: unknown): CanvasToolResult => {
    const parsed = readCreateCanvasArgs(args);
    if (parsed.ok === false) return { status: 'error', error: parsed.error };
    const { kind, title, content, language } = parsed.value;

    /*
     * The id is derived from the title, so calling create twice with one title
     * lands on one document — which is the behaviour that makes "write me a
     * guide to X" followed by "actually make it longer" edit the guide instead of
     * forking it, even when the model reached for the wrong tool. The result
     * string says which happened so the model's next turn is not surprised.
     */
    const docId = canvasDocId(host.chatKey, title, kind, language);
    const existing = latestOf(docId);
    emit({ docId, kind, language, title, content });

    const shape = kind === 'code'
      ? `${content.split('\n').length} lines of ${language || 'html'}`
      : `${content.split(/\s+/).filter(Boolean).length} words`;
    return {
      status: 'ok',
      result: existing
        ? `"${title}" already existed as ${docId}; this replaced its contents (${shape}) and added a version. The user can step back to the previous one.\n\nDo not repeat the document in your reply.`
        : `Created "${title}" as ${docId} (${shape}). It is now open in the Canvas panel beside the conversation, and the user can edit, download and revise it.\n\nDo not repeat the document in your reply — the user is reading it. To change it later, call ${UPDATE_CANVAS} with doc_id "${docId}".`,
    };
  };

  const update = (args: unknown): CanvasToolResult => {
    const parsed = readUpdateCanvasArgs(args);
    if (parsed.ok === false) return { status: 'error', error: parsed.error };
    const { docId: requested, title, language, content, updates } = parsed.value;

    const docId = requested ?? currentDocId();
    if (!docId) {
      return {
        status: 'error',
        error: `There is no Canvas document in this conversation yet. Call ${CREATE_CANVAS} to make one.`,
      };
    }
    const current = latestOf(docId);
    if (!current) {
      const ids = knownIds();
      return {
        status: 'error',
        error: ids.length
          ? `No document with id "${docId}". This conversation has: ${ids.join(', ')}.`
          : `There is no Canvas document in this conversation yet. Call ${CREATE_CANVAS} to make one.`,
      };
    }

    const nextKind = current.kind;
    const nextLanguage = nextKind === 'code' ? (language ?? current.language) : undefined;
    let nextContent = current.content;
    let note = '';

    if (updates?.length) {
      const applied = applyCanvasUpdates(current.content, updates);
      // A call where nothing landed is not a revision, so it does not become a
      // version — the model gets the anchors back and retries in the same turn.
      if (!applied.applied) {
        return { status: 'error', error: describeCanvasEditResult(0, applied.failures) };
      }
      nextContent = applied.content;
      note = describeCanvasEditResult(applied.applied, applied.failures);
    } else if (content !== undefined) {
      nextContent = nextKind === 'code' ? stripCanvasCodeFence(content) : content;
      note = 'Replaced the whole document.';
    }

    const nextTitle = title ?? current.title;
    const unchanged = nextContent === current.content
      && nextTitle === current.title
      && (nextLanguage ?? '') === (current.language ?? '');
    if (unchanged) {
      return {
        status: 'error',
        error: 'That produced an identical document, so nothing was saved. If you meant to change something, send the edit; otherwise just answer in the reply.',
      };
    }

    emit({ docId, kind: nextKind, language: nextLanguage, title: nextTitle, content: nextContent });
    const renamed = nextTitle !== current.title ? ` Renamed to "${nextTitle}".` : '';
    return {
      status: 'ok',
      result: `${note}${renamed} The panel now shows the new version and the user can step back to the previous one.\n\nDo not repeat the document in your reply; describe the change in a sentence at most.`,
    };
  };

  return async (name: string, args: unknown): Promise<CanvasToolResult> => {
    if (name === CREATE_CANVAS) return create(args);
    if (name === UPDATE_CANVAS) return update(args);
    return {
      status: 'error',
      error: `The tool "${name}" is not available in this context. Do not claim it ran; use another approach or tell the user plainly.`,
    };
  };
};



