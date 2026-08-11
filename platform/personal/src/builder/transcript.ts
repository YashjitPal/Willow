/**
 * Saved chat files → compact transcripts for the extractor.
 *
 * A chat file on disk is an array of serialized messages carrying thought
 * summaries, model snapshots, citations, attachment records and timing. Almost
 * none of that says anything about the user, and all of it costs tokens, so this
 * reduces a chat to the few things worth reading: who said what, trimmed.
 *
 * The reduction is aggressive on assistant turns for a reason that is easy to
 * get backwards. What the user says is evidence about the user. What the model
 * says is evidence about the model — and folding it in produces a profile that
 * describes Willow's own habits back at it ("the user is interested in
 * step-by-step explanations" when the model is simply fond of numbered lists).
 * Assistant turns are kept only as short context so a bare "yes, that one"
 * still has an antecedent.
 */

/** Shape read off disk. Every field is optional because the file is user-editable. */
export interface RawSavedMessage {
  role?: unknown;
  content?: unknown;
  attachments?: unknown;
}

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface Transcript {
  chatId: string;
  title: string;
  /** Chat's last-modified time, used for recency ordering and Date: stamps. */
  updatedAt: number;
  turns: TranscriptTurn[];
  /** Rough size guide for batching, not a real tokenizer. */
  approxTokens: number;
}

/** Enough for a paragraph-long question with its detail intact. */
const USER_TURN_CHARS = 1400;
/** Assistant turns are context only, so a couple of sentences is the whole job. */
const ASSISTANT_TURN_CHARS = 320;
/** Past this a single chat starts to crowd out every other chat in its batch. */
const TRANSCRIPT_CHARS = 12_000;
/** A chat with one exchange in it is usually a false start. */
const MIN_TURNS = 2;

const CHARS_PER_TOKEN = 4;

/**
 * Strip the parts of a message that are formatting rather than content.
 *
 * Fenced code goes first and is replaced by a marker rather than deleted: that a
 * user pastes Python is a real signal, but the body of the paste is a hundred
 * lines saying nothing further. Images and links collapse to their text for the
 * same reason — a base64 data URI can be a megabyte of noise.
 */
const condense = (text: string): string =>
  text
    .replace(/```[\w-]*\n?([\s\S]*?)```/g, (_match, body: string) => {
      const lines = body.split('\n').length;
      return `[code, ${lines} line${lines === 1 ? '' : 's'}]`;
    })
    .replace(/`([^`\n]{1,80})`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[image]')
    .replace(/\[([^\]]{1,80})\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const clip = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;

const asRole = (value: unknown): 'user' | 'assistant' | null =>
  value === 'user' || value === 'assistant' ? value : null;

/**
 * Build a transcript from a saved chat, or `null` if there is nothing in it.
 *
 * Trimming runs from the END when a chat is over length. The last exchanges are
 * where a conversation has resolved into something concrete — an early message
 * is usually the user still working out what they want, and the correction that
 * matters ("no, I meant the other one") always comes later.
 */
export const buildTranscript = (
  chatId: string,
  messages: RawSavedMessage[],
  updatedAt: number,
): Transcript | null => {
  const turns: TranscriptTurn[] = [];

  for (const message of messages) {
    const role = asRole(message?.role);
    if (!role) continue;
    const raw = typeof message?.content === 'string' ? message.content : '';
    const attachmentCount = Array.isArray(message?.attachments) ? message.attachments.length : 0;
    let text = condense(raw);
    if (!text && attachmentCount === 0) continue;
    text = clip(text, role === 'user' ? USER_TURN_CHARS : ASSISTANT_TURN_CHARS);
    if (role === 'user' && attachmentCount > 0) {
      text = `${text} [attached ${attachmentCount} file${attachmentCount === 1 ? '' : 's'}]`.trim();
    }
    turns.push({ role, text });
  }

  if (turns.filter((turn) => turn.role === 'user').length === 0) return null;
  if (turns.length < MIN_TURNS) return null;

  let total = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  let start = 0;
  while (total > TRANSCRIPT_CHARS && start < turns.length - MIN_TURNS) {
    total -= turns[start].text.length;
    start += 1;
  }
  const kept = turns.slice(start);

  return {
    chatId,
    title: chatId,
    updatedAt,
    turns: kept,
    approxTokens: Math.ceil(total / CHARS_PER_TOKEN),
  };
};

/** `You:` / `Willow:` — plainer than role tags and cheaper than JSON. */
export const renderTranscript = (transcript: Transcript): string => {
  const date = new Date(transcript.updatedAt || Date.now()).toISOString().slice(0, 10);
  const body = transcript.turns
    .map((turn) => `${turn.role === 'user' ? 'You' : 'Willow'}: ${turn.text}`)
    .join('\n');
  return `--- Conversation "${transcript.title}" (${date}) ---\n${body}`;
};

/**
 * Group transcripts into model-sized batches, newest first.
 *
 * Newest first so that a run cut short by a token budget or a closed window has
 * still read the most recent conversations, which are the ones most likely to
 * contain something the profile does not already know.
 */
export const batchTranscripts = (
  transcripts: Transcript[],
  maxTokensPerBatch = 24_000,
): Transcript[][] => {
  const ordered = [...transcripts].sort((a, b) => b.updatedAt - a.updatedAt);
  const batches: Transcript[][] = [];
  let current: Transcript[] = [];
  let budget = 0;

  for (const transcript of ordered) {
    // A single oversized transcript still gets its own batch rather than being
    // dropped — it is already clipped to TRANSCRIPT_CHARS, so it cannot run away.
    if (current.length > 0 && budget + transcript.approxTokens > maxTokensPerBatch) {
      batches.push(current);
      current = [];
      budget = 0;
    }
    current.push(transcript);
    budget += transcript.approxTokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
};
