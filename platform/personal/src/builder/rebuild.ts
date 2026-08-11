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

import { bulletFingerprint, type CandidateBullet, type ProfileBullet, type ProfileState } from '../profile/types';
import {
  buildExtractRequest,
  EXTRACT_SYSTEM_PROMPT,
  parseExtractResponse,
  type ExtractedBullet,
} from './extract-prompt';
import type { ExtractRunner } from './llm';
import { mergeCandidates, type MergeCandidate, type MergeResult } from './merge';
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
  /**
   * Connected products, read for facts the chats cannot supply.
   *
   * Optional and injected, so the builder never imports the connector layer:
   * a build with no connectors is the normal case and must not drag OAuth code
   * into the path. Returns already-shaped candidates because each connector
   * knows its own section and writes its own evidence — there is no model call
   * on this side, which is why connector signals cost nothing to refresh.
   */
  connectors?: () => Promise<CandidateBullet[]>;
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

/**
 * Everything a new bullet is not allowed to duplicate.
 *
 * The user's deletions, plus the user's own hand-written bullets — a derived
 * bullet saying what the user already wrote is the same fact twice, and the
 * hand-written one is the keeper.
 */
const suppressionSet = (state: ProfileState): string[] => [
  ...state.suppressed,
  ...state.bullets
    .filter((bullet) => bullet.origin === 'user')
    .map((bullet) => bulletFingerprint(bullet.text)),
];

/**
 * Drop stored bullets that this run's connectors are about to restate.
 *
 * Connector data is not incremental. A calendar read today returns a different
 * set of events than it did last week, and the merge keeps existing bullets over
 * new ones — so without this, last week's events would win the collision and the
 * profile would describe a week that has already happened.
 *
 * Which bullets to clear is worked out from the fresh candidates' own `source`
 * values rather than a hardcoded list of product names, so it stays right when a
 * connector is added and, importantly, clears nothing when a connector could not
 * be read: no fresh Calendar bullets means the stored ones are still the best
 * information available and should stay.
 */
const dropRefreshedSources = (
  bullets: ProfileBullet[],
  fresh: MergeCandidate[],
): ProfileBullet[] => {
  const refreshed = new Set(
    fresh.map((candidate) => candidate.source?.trim()).filter((source): source is string => Boolean(source)),
  );
  if (refreshed.size === 0) return bullets;
  return bullets.filter((bullet) => !refreshed.has(bullet.source));
};

/**
 * Read the connected products, if any. Never throws.
 *
 * A failing connector must not fail a build that also read chats successfully —
 * the chat half is the part that cost model calls, and throwing it away because
 * a Calendar token expired would be the expensive half paying for the free one.
 */
const readConnectors = async (
  connectors: RebuildDeps['connectors'],
): Promise<MergeCandidate[]> => {
  if (!connectors) return [];
  try {
    return await connectors();
  } catch {
    return [];
  }
};

export const runRebuild = async ({
  chats,
  extract,
  connectors,
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

  // Connector data is re-read on every build, including builds where no chat
  // changed. A calendar is not incremental — last week's events are gone and
  // next week's are new — so carrying the old bullets forward would leave the
  // profile describing a week that has already happened.
  if (pending.length < MIN_CHATS_PER_RUN) {
    const fromConnectors = await readConnectors(connectors);
    if (fromConnectors.length === 0 || signal?.aborted) {
      return { status: signal?.aborted ? 'cancelled' : 'nothing-to-do', chatsRead: 0, batches: 0 };
    }
    const current = getState();
    if (!current.enabled) return { status: 'disabled', chatsRead: 0, batches: 0 };
    const { bullets, stats } = mergeCandidates({
      candidates: fromConnectors,
      existing: dropRefreshedSources(
        current.bullets.filter((bullet) => bullet.origin === 'auto'),
        fromConnectors,
      ),
      suppressed: suppressionSet(current),
      source: 'Connected apps',
      now: now(),
      newId,
    });
    commit({ bullets, digested: {} });
    return { status: 'built', chatsRead: 0, batches: 0, stats };
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

  // Connector signals join the same merge as the extractor's bullets, so they
  // share the dedupe, the caps and the sensitive screen. Read *after* the
  // batches: a connector is one network round-trip and the batches are model
  // calls, so this is the free half of the run.
  const fromConnectors = await readConnectors(connectors);

  const { bullets, stats } = mergeCandidates({
    candidates: [...candidates, ...fromConnectors],
    existing: dropRefreshedSources(
      current.bullets.filter((bullet) => bullet.origin === 'auto'),
      fromConnectors,
    ),
    // Include fingerprints of the user's own bullets: a hand-written bullet and
    // a derived one saying the same thing should not both be in the list, and
    // the hand-written one is the keeper.
    suppressed: suppressionSet(current),
    source: 'Willow chat history',
    now: now(),
    newId,
  });

  commit({ bullets, digested });
  return { status: 'built', chatsRead: readIds.size, batches: batches.length, stats };
};
