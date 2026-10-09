/**
 * The full-screen fab's floating chat, as data: which of the thread's turns it shows and
 * when it closes itself. Gemini's `floating-chat-window` rules, read off its bundle and
 * the live app:
 *
 *  - The window shows every turn asked since the pill opened, not just the newest, and
 *    puts a just-sent question on screen before its turn exists.
 *  - A plain answer stays. The window closes itself only once the newest answer is
 *    complete AND wrote the canvas, and turns that wrote it are left out of the list.
 *  - The dots show while the thread generates.
 */

/** A question asked in the thread and its answer, as the floating window shows them. */
export interface CanvasFloatingTurn {
  /** The question's message id. */
  id: string;
  prompt: string;
  /** The answer so far: the live buffer while it streams. */
  reply: string;
  /** Finished, failed or stopped. */
  done: boolean;
  /** The answer wrote the canvas. */
  editedCanvas: boolean;
}

/** The slice of a chat message the window reads. */
export interface FloatingThreadMessage {
  id: string;
  role: string;
  content: string;
  isGenerating?: boolean;
  canvasRefs?: readonly unknown[];
}

/**
 * Every question in the thread with the answer that follows it. `streaming` is the
 * thread's one live buffer, so only the generating answer may read it; a question with
 * no answer yet is done once the thread is no longer generating.
 */
export const floatingTurns = (
  messages: readonly FloatingThreadMessage[],
  streaming: string,
  isGenerating: boolean,
): CanvasFloatingTurn[] => {
  const turns: CanvasFloatingTurn[] = [];
  messages.forEach((message, index) => {
    if (message.role !== 'user') return;
    const next = messages[index + 1];
    const reply = next && next.role === 'assistant' ? next : undefined;
    turns.push({
      id: message.id,
      prompt: message.content,
      reply: reply ? (reply.isGenerating ? streaming : reply.content) : '',
      done: reply ? !reply.isGenerating : !isGenerating,
      editedCanvas: !!reply?.canvasRefs?.length,
    });
  });
  return turns;
};

/** Sent from the window; `base` is the turn count it was sent at. */
export interface FloatingPending {
  text: string;
  base: number;
}

export interface FloatingWindowView {
  /** The sent question, until the thread grows past `base` and it is a turn. */
  pendingShown: FloatingPending | null;
  /** The turns the window lists. */
  entries: CanvasFloatingTurn[];
  /** Gemini's `closeChat`: the newest answer is complete and wrote the canvas. */
  closeForEdit: boolean;
  thinking: boolean;
}

/** What the window shows, for a session that started when the thread held `start` turns. */
export const floatingWindowView = (
  turns: readonly CanvasFloatingTurn[],
  start: number,
  pending: FloatingPending | null,
  isGenerating: boolean,
): FloatingWindowView => {
  const pendingShown = pending && turns.length <= pending.base ? pending : null;
  const session = turns.slice(start);
  const newest = session[session.length - 1];
  return {
    pendingShown,
    entries: session.filter((turn) => !(turn.done && turn.editedCanvas)),
    closeForEdit: !pendingShown && !!newest && newest.done && newest.editedCanvas,
    thinking: pendingShown !== null || isGenerating,
  };
};
