/**
 * One build: read the chats that have changed, extract, merge, store.
 *
 * Everything here is injected. This file does not know what a directory handle
 * is, does not import the store's writers directly, and does not fetch — it takes
 * a chat source, an extract runner, and a commit function. That is what makes a
 * build testable without a browser, a folder, or a key, and it is also what lets
 * the same function run over connector data later by passing a different source.
 *
 * A build is incremental, bounded, and abandonable. It reads only chats whose
 * timestamp has moved since they were last folded in, stops after a fixed number
 * of model calls, and checks for cancellation between every one.
 */

import { bulletFingerprint, type ProfileBullet, type ProfileState } from '../profile/types';
import {
  buildExtractRequest,
  EXTRACT_SYSTEM_PROMPT,
  parseExtractResponse,
  type ExtractedBullet,
} from './extract-prompt';
import type { ExtractRunner } from './llm';
import { mergeCandidates, type MergeResult } from './merge';
import { batchTranscripts, buildTranscript, renderTranscript, type RawSavedMessage } from './transcript';

/** Where chats come from. `LocalFSContext` supplies both in the app. */
export interface ChatSource {
  /** Chat ids with their last-modified times. */
  list: () => Promise<{ chatId: string; updatedAt: number }[]>;
  /** `null` when the chat cannot be read — deleted mid-run, or unreadable. */
  load: (chatId: string) => Promise<RawSavedMessage[] | null>;
}

export interface RebuildDeps {
  chats: ChatSource;
  extract: ExtractRunner;
  /** Current state, read once at the start and re-read before committing. */
  getState: () => ProfileState;
  commit: (result: { bullets: ProfileBullet[]; digested: Record<string, number> }) => void;
  signal?: AbortSignal;
  now?: () => Date;
  newId?: () => string;
}

export interface RebuildOutcome {
  status: 'built' | 'nothing-to-do' | 'cancelled' | 'disabled';
  chatsRead: number;
  batches: number;
  stats?: MergeResult['stats'];
}

/**
 * Model calls per run.
 *
 * A first build on a long history could otherwise fire fifty requests on the
 * user's own key, for a job they did not start. Six batches is roughly seventy
 * conversations, which covers most people entirely and covers everyone's recent
 * activity — and because batches are ordered newest first, a truncated run has
 * read the most useful chats. The rest stay undigested and are picked up by the
 * next build.
 */
const MAX_BATCHES_PER_RUN = 6;

/** Below this a run is not worth a model call; the chats wait for company. */
const MIN_CHATS_PER_RUN = 1;

const defaultId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Non-secure contexts throw.
  }
  return `pb-${Math.floor(Math.random() * 1e9).toString(36)}`;
};

/**
 * Which chats have something new in them.
 *
 * A chat is re-read when its timestamp is *newer* than the one recorded at
 * fold-in, not merely different — a clock skew or a folder copy that moved a
 * timestamp backwards should not cause the whole history to be re-read on the
 * user's key.
 */
export const selectPendingChats = (
  available: { chatId: string; updatedAt: number }[],
  digested: Record<string, number>,
): { chatId: string; updatedAt: number }[] =>
  available.filter((chat) => {
    const seenAt = digested[chat.chatId];
    return seenAt === undefined || chat.updatedAt > seenAt;
  });

/**
 * The existing bullets, as plain lines for the "already known" section.
 *
 * Text only — no ids, no evidence, no dates. The extractor's only use for these
 * is to avoid repeating them, and handing it the full records invites it to
 * return edited versions of bullets it was not asked to touch.
 */
const knownLines = (bullets: ProfileBullet[]): string[] =>
  bullets.map((bullet) => bullet.text);

export const runRebuild = async ({
  chats,
  extract,
  getState,
  commit,
  signal,
  now = () => new Date(),
  newId = defaultId,
}: RebuildDeps): Promise<RebuildOutcome> => {
  const startState = getState();
  if (!startState.enabled) return { status: 'disabled', chatsRead: 0, batches: 0 };

  const available = await chats.list();
  if (signal?.aborted) return { status: 'cancelled', chatsRead: 0, batches: 0 };

  const pending = selectPendingChats(available, startState.digested);
  if (pending.length < MIN_CHATS_PER_RUN) {
    return { status: 'nothing-to-do', chatsRead: 0, batches: 0 };
  }

  // Newest first, so a run cut short has read what matters most.
  const ordered = [...pending].sort((a, b) => b.updatedAt - a.updatedAt);
  const transcripts = [];
  const digested: Record<string, number> = {};

  for (const chat of ordered) {
    if (signal?.aborted) return { status: 'cancelled', chatsRead: 0, batches: 0 };
    const messages = await chats.load(chat.chatId);
    if (!messages) continue;
    const transcript = buildTranscript(chat.chatId, messages, chat.updatedAt);
    // A chat too short to be worth reading is still marked digested. It has been
    // considered and found empty, and leaving it pending means every future run
    // re-reads the same false start forever.
    digested[chat.chatId] = chat.updatedAt;
    if (transcript) transcripts.push(transcript);
  }

  if (transcripts.length === 0) {
    // Nothing extractable, but the timestamps still move so this does not repeat.
    if (Object.keys(digested).length > 0) {
      commit({ bullets: getState().bullets.filter((b) => b.origin === 'auto'), digested });
    }
    return { status: 'nothing-to-do', chatsRead: 0, batches: 0 };
  }

  const batches = batchTranscripts(transcripts).slice(0, MAX_BATCHES_PER_RUN);

  // Chats in batches that were cut are NOT marked digested, so the next run
  // picks them up rather than skipping them permanently.
  const readIds = new Set(batches.flat().map((transcript) => transcript.chatId));
  for (const chatId of Object.keys(digested)) {
    const wasParsed = transcripts.some((transcript) => transcript.chatId === chatId);
    if (wasParsed && !readIds.has(chatId)) delete digested[chatId];
  }

  const today = now().toISOString().slice(0, 10);
  const candidates: ExtractedBullet[] = [];
  // Grows as the run proceeds so a later batch does not re-derive what an
  // earlier batch in the same run already produced.
  const known = new Set(knownLines(startState.bullets));

  for (const batch of batches) {
    if (signal?.aborted) return { status: 'cancelled', chatsRead: readIds.size, batches: 0 };
    const conversations = batch.map(renderTranscript).join('\n\n');
    const reply = await extract(
      EXTRACT_SYSTEM_PROMPT,
      buildExtractRequest({ conversations, existing: [...known], today }),
      signal,
    );
    if (!reply) continue;
    for (const bullet of parseExtractResponse(reply)) {
      candidates.push(bullet);
      known.add(bullet.text);
    }
  }

  if (signal?.aborted) return { status: 'cancelled', chatsRead: readIds.size, batches: batches.length };

  // Re-read rather than reusing `startState`: the user may have deleted a bullet
  // while this ran, and committing the pre-edit snapshot would resurrect it.
  const current = getState();
  if (!current.enabled) return { status: 'disabled', chatsRead: readIds.size, batches: batches.length };

  const { bullets, stats } = mergeCandidates({
    candidates,
    existing: current.bullets.filter((bullet) => bullet.origin === 'auto'),
    // Include fingerprints of the user's own bullets: a hand-written bullet and
    // a derived one saying the same thing should not both be in the list, and
    // the hand-written one is the keeper.
    suppressed: [
      ...current.suppressed,
      ...current.bullets.filter((b) => b.origin === 'user').map((b) => bulletFingerprint(b.text)),
    ],
    source: 'Willow chat history',
    now: now(),
    newId,
  });

  commit({ bullets, digested });
  return { status: 'built', chatsRead: readIds.size, batches: batches.length, stats };
};
