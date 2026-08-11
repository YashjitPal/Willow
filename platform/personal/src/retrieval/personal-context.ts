/**
 * `retrieve_personal_data` — what actually runs when the model calls the tool.
 *
 * Gemini exposes exactly one method on its personal-context tool, and this is the
 * equivalent: the model asks a question in plain language, and gets back passages
 * from the user's own history. Nothing here writes. The profile is built offline
 * by `builder/`, and a tool that could also store facts would mean the model
 * deciding mid-conversation what is worth remembering about someone — which is
 * exactly the design that produces "I've saved that to your profile!" after
 * someone mentions they are tired.
 *
 * Two sources, in one response:
 *
 * - **The profile.** Cheap, already built, and the answer to most questions of
 *   the "what do you know about me" shape.
 * - **Chat history.** Searched only when the profile does not obviously answer
 *   it, because the index has to be built on first use and that costs a read of
 *   every chat file.
 *
 * The index is cached for the session and invalidated by a chat count that has
 * moved. Cheap, and wrong only in the case where a chat was edited without any
 * being added — which costs one stale result in a session, not a broken feature.
 */

import { profileStore } from '../profile/profile-store';
import { PROFILE_SECTIONS } from '../profile/sections';
import type { ProfileBullet } from '../profile/types';
import { buildIndex, EMPTY_INDEX, indexChat, type ChatIndex } from './index-chats';
import { searchResultTexts } from './search';
import type { ChatSource } from '../builder/rebuild';

/** Results returned to the model per call. More than this and the tool response
 *  starts to crowd out the conversation it was meant to inform. */
const MAX_RESULTS = 5;

/** Profile bullets included alongside search results. */
const MAX_PROFILE_LINES = 12;

export interface PersonalContextDeps {
  chats: ChatSource;
  /** Overridable for tests; the app leaves it alone. */
  getProfile?: () => { enabled: boolean; bullets: ProfileBullet[] };
  now?: () => number;
}

export interface RetrieveResult {
  /** Rendered text handed straight back as the tool result. */
  text: string;
  /** For the UI's tool chip: how many conversations were quoted. */
  matches: number;
}

let cached: { index: ChatIndex; chatCount: number } | null = null;

/** Called when chats change on disk, so the next tool call rebuilds. */
export const invalidatePersonalIndex = (): void => {
  cached = null;
};

const ensureIndex = async (chats: ChatSource, now: number): Promise<ChatIndex> => {
  const available = await chats.list();
  if (cached && cached.chatCount === available.length) return cached.index;

  const indexed = [];
  for (const chat of available) {
    const messages = await chats.load(chat.chatId);
    if (!messages) continue;
    const entry = indexChat(chat.chatId, messages, chat.updatedAt);
    if (entry) indexed.push(entry);
  }

  const index = buildIndex(indexed, now);
  cached = { index, chatCount: available.length };
  return index;
};

/**
 * Profile bullets relevant to a query, or the whole profile for a broad one.
 *
 * The relevance test is deliberately loose — one shared word is enough. A
 * profile is a few dozen lines, so the cost of returning a marginally relevant
 * one is a wasted line, while the cost of filtering out the right one is the
 * model answering "I don't know anything about that" about something written in
 * the file it was just handed.
 */
const profileLines = (bullets: ProfileBullet[], query: string): string[] => {
  const queryWords = new Set(
    query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4),
  );

  const scored = bullets.map((bullet) => {
    const words = new Set(bullet.text.toLowerCase().split(/[^\p{L}\p{N}]+/u));
    let overlap = 0;
    for (const word of queryWords) if (words.has(word)) overlap += 1;
    return { bullet, overlap };
  });

  const anyOverlap = scored.some((entry) => entry.overlap > 0);
  const chosen = anyOverlap
    ? scored.filter((entry) => entry.overlap > 0).sort((a, b) => b.overlap - a.overlap)
    : scored;

  const headingFor = (bullet: ProfileBullet): string =>
    PROFILE_SECTIONS.find((section) => section.id === bullet.section)?.heading ?? 'About';

  return chosen
    .slice(0, MAX_PROFILE_LINES)
    .map((entry) => `[${headingFor(entry.bullet)}] ${entry.bullet.text} (${entry.bullet.source})`);
};

/**
 * Run one retrieval.
 *
 * Never throws and never returns an empty string. "Nothing found" is a real,
 * useful answer — it tells the model to stop guessing and ask — and an empty
 * tool result reads to a model as a malfunction, which it then apologises for.
 */
export const retrievePersonalData = async (
  query: string,
  deps: PersonalContextDeps,
): Promise<RetrieveResult> => {
  const now = deps.now?.() ?? Date.now();
  const state = deps.getProfile?.() ?? profileStore.get();

  if (!state.enabled) {
    return { text: 'Personalization is turned off, so no personal data is available.', matches: 0 };
  }

  const trimmed = query.trim();
  if (!trimmed) return { text: 'No search query was provided.', matches: 0 };

  const sections: string[] = [];

  const lines = profileLines(state.bullets, trimmed);
  if (lines.length > 0) {
    sections.push(`What Willow knows about the user:\n${lines.join('\n')}`);
  }

  let matches = 0;
  try {
    const index = await ensureIndex(deps.chats, now);
    const results = searchResultTexts(index, trimmed, { limit: MAX_RESULTS, now });
    matches = results.length;
    if (results.length > 0) {
      sections.push(`From past conversations:\n\n${results.join('\n\n')}`);
    }
  } catch {
    // A failed index read leaves the profile half, which is still an answer.
  }

  if (sections.length === 0) {
    return {
      text: `No stored information about "${trimmed}" was found in the user's profile or past conversations.`,
      matches: 0,
    };
  }

  return { text: sections.join('\n\n'), matches };
};

export const personalIndexState = (): { built: boolean; chats: number } => ({
  built: cached !== null,
  chats: cached?.index.chats.length ?? EMPTY_INDEX.chats.length,
});
