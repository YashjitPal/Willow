/**
 * A bot's own profile of the user, learned in the background — Willow's Personal Intelligence, kept by one bot
 * about the part of the user's life it works in.
 *
 * Willow's profile is shared and read-only here (`<about_user source="Willow">`). This one is the bot's alone, and
 * it learns what that profile cannot: the user's work as it bears on what this bot does for them, how they like
 * things done, the people, goals and routines that come up in this conversation. A learning pass reads the
 * conversation since the last one and returns changes to make — add, correct, remove — which are checked before
 * they are kept. It runs in quiet moments and always before a stretch is compacted, so what the summary leaves out
 * has already been learned.
 *
 * The record is untouched; the profile is a view the user can read and prune in the bot's profile, and the bot
 * reads it every turn.
 */
import type { DotSummarizer } from './compaction';
import { renderForRecord } from './render';
import { getDotThread, updateDotRuntime } from '../thread/thread-store';
import type { DotItem, DotLearnedFact, DotLearnedProfile, DotLearnedSection, DotThread } from '../thread/thread-types';

export const LEARNED_SECTIONS: { id: DotLearnedSection; title: string; about: string }[] = [
  { id: 'work', title: 'Their work', about: 'what they do and what they are responsible for, as it bears on what you do for them' },
  { id: 'preferences', title: 'How they like things done', about: 'how they like to work, decide and be communicated with' },
  { id: 'people', title: 'People', about: 'the people they mention, and who each is to them' },
  { id: 'projects', title: 'Goals and projects', about: 'what they are working towards, and where it stands' },
  { id: 'routines', title: 'Routines and schedule', about: 'their rhythms, regular commitments and timings' },
  { id: 'facts', title: 'Other things worth knowing', about: 'durable facts that help you help them' },
];

const SECTION_IDS: ReadonlySet<string> = new Set(LEARNED_SECTIONS.map((section) => section.id));
const LEARN_KINDS: ReadonlySet<DotItem['kind']> = new Set(['user', 'dot', 'reaction', 'user-reaction', 'event', 'outgoing', 'edit', 'plan-card', 'trigger-card']);

/** Most facts kept: in all, and in one section. Past them, the least recently confirmed go. */
export const MAX_FACTS = 80;
const MAX_PER_SECTION = 16;
const MAX_FACT_CHARS = 240;
/** The most conversation one pass reads; the rest waits for the next. */
const MAX_PASS_CHARS = 120_000;
/** A pass is due after this many new messages from the user, or after this long with at least one. */
export const LEARN_AFTER_MESSAGES = 6;
export const LEARN_AFTER_MS = 6 * 3_600_000;

const INVISIBLE = /[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b|\b(password|passcode|pin|otp)\b\s*(is|:)/i;

const normalized = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Whether a learning pass is due: something new from the user, and enough of it or long enough since the last. */
export const learningDue = (thread: DotThread, now: number): boolean => {
  const learned = thread.runtime.learned;
  if (learned?.off) return false;
  const since = learned?.throughSeq ?? 0;
  const fresh = thread.items.filter((item) => item.seq > since && item.kind === 'user').length;
  if (fresh === 0) return false;
  return fresh >= LEARN_AFTER_MESSAGES || now - (learned?.learnedAt ?? 0) >= LEARN_AFTER_MS;
};

export interface LearningChange {
  add: { section: string; text: string; sources?: string[] }[];
  update: { id: string; text?: string; section?: string; sources?: string[] }[];
  remove: string[];
}

/** A pass's reply as changes, or nothing when it is not the JSON asked for. */
export const parseLearning = (reply: string): LearningChange => {
  const empty: LearningChange = { add: [], update: [], remove: [] };
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start === -1 || end <= start) return empty;
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1)) as Partial<LearningChange>;
    return {
      add: Array.isArray(parsed.add) ? parsed.add.filter((entry) => entry && typeof entry.text === 'string') : [],
      update: Array.isArray(parsed.update) ? parsed.update.filter((entry) => entry && typeof entry.id === 'string') : [],
      remove: Array.isArray(parsed.remove) ? parsed.remove.filter((id): id is string => typeof id === 'string') : [],
    };
  } catch {
    return empty;
  }
};

const cleanText = (text: string): string | null => {
  const value = text.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  if (!value || SECRET.test(value)) return null;
  return value.length > MAX_FACT_CHARS ? `${value.slice(0, MAX_FACT_CHARS - 1)}…` : value;
};

const cleanSources = (sources: unknown, known: ReadonlySet<string>): string[] =>
  (Array.isArray(sources) ? sources : []).filter((id): id is string => typeof id === 'string' && known.has(id)).slice(0, 6);

let factCounter = 0;
const newFactId = (now: number): string => `f${now.toString(36)}${(factCounter++).toString(36)}`;

/**
 * The profile with a pass's changes made, checked: known sections only, one plain sentence each, nothing that
 * looks like a secret, no duplicates, sources that exist, and within the caps — the least recently confirmed go
 * first. `known` is the set of item ids a source may cite.
 */
export const applyLearning = (profile: DotLearnedProfile, change: LearningChange, now: number, known: ReadonlySet<string>): DotLearnedProfile => {
  const removed = new Set(change.remove);
  let facts: DotLearnedFact[] = profile.facts.filter((fact) => !removed.has(fact.id));
  for (const update of change.update) {
    const index = facts.findIndex((fact) => fact.id === update.id);
    if (index === -1) continue;
    const text = update.text === undefined ? facts[index]!.text : cleanText(update.text);
    if (!text) {
      facts.splice(index, 1);
      continue;
    }
    const section = update.section && SECTION_IDS.has(update.section) ? (update.section as DotLearnedSection) : facts[index]!.section;
    const sources = [...new Set([...facts[index]!.sources, ...cleanSources(update.sources, known)])].slice(-6);
    facts[index] = { ...facts[index]!, text, section, sources, updatedAt: now };
  }
  // What was known before this pass counts too, so a fact it corrected is not added back in its old words.
  const seen = new Set([...profile.facts, ...facts].map((fact) => normalized(fact.text)));
  for (const addition of change.add) {
    if (!SECTION_IDS.has(addition.section)) continue;
    const text = cleanText(addition.text);
    if (!text || seen.has(normalized(text))) continue;
    seen.add(normalized(text));
    facts.push({ id: newFactId(now), section: addition.section as DotLearnedSection, text, sources: cleanSources(addition.sources, known), learnedAt: now, updatedAt: now });
  }
  const byRecency = [...facts].sort((a, b) => b.updatedAt - a.updatedAt);
  const kept = new Set<string>();
  const perSection = new Map<string, number>();
  for (const fact of byRecency) {
    const count = perSection.get(fact.section) ?? 0;
    if (count >= MAX_PER_SECTION || kept.size >= MAX_FACTS) continue;
    perSection.set(fact.section, count + 1);
    kept.add(fact.id);
  }
  facts = facts.filter((fact) => kept.has(fact.id));
  return { ...profile, facts };
};

export const learningSystemPrompt = (options: { dotName: string; purpose?: string }): string => `You keep the profile that ${options.dotName}, an always-on assistant, holds of the one person it works for.${
  options.purpose ? ` ${options.dotName} is there for this: ${options.purpose}` : ''
}

Read the new stretch of their conversation and say how the profile should change, so that ${options.dotName} knows them better from now on. The profile has these sections:
${LEARNED_SECTIONS.map((section) => `- ${section.id}: ${section.about}`).join('\n')}

Rules:
- Keep what is durable and useful later: what will still be true and still matter in weeks. Leave out one-off details, passing moods, and what only mattered to one task.
- Learn about the person, from what they say and do. What the assistant says is not evidence about them unless they confirm it.
- Leave out anything already in what Willow knows about them, and anything secret: passwords, codes, keys, account numbers.
- Correct a fact that has changed, and remove one the conversation shows is no longer true, instead of adding a contradiction.
- Write each fact as one plain sentence about them, in the third person, with the item ids it rests on.
- When nothing durable was learned, change nothing.

Reply with JSON only: {"add": [{"section": "…", "text": "…", "sources": ["i…"]}], "update": [{"id": "f…", "text": "…", "sources": ["i…"]}], "remove": ["f…"]}`;

export const learningUserPrompt = (options: { profile: DotLearnedProfile; about: string; transcript: string }): string => [
  '<profile>',
  options.profile.facts.length ? options.profile.facts.map((fact) => `${fact.id} [${fact.section}] ${fact.text}`).join('\n') : '(nothing yet)',
  '</profile>',
  '',
  '<willow_knows>',
  options.about.trim() ? options.about.trim().slice(0, 6_000) : '(nothing)',
  '</willow_knows>',
  '',
  '<conversation>',
  options.transcript,
  '</conversation>',
].join('\n');

export interface LearningOptions {
  dotId: string;
  dotName: string;
  purpose?: string;
  /** What Willow knows about the user, so the profile does not repeat it. */
  about: string;
  timeZone: string;
  summarize: DotSummarizer;
  now: () => number;
  signal?: AbortSignal;
  /** Read only up to this item: what a compaction is about to summarise. */
  throughSeq?: number;
}

/**
 * One learning pass over what the bot has not learned from yet (oldest first, at most `MAX_PASS_CHARS` of it).
 * Returns how many facts changed. The changes are made on the profile as it is when the pass returns, so a fact
 * the user removed meanwhile stays removed.
 */
export const learnAboutUser = async (options: LearningOptions): Promise<number> => {
  const thread = getDotThread(options.dotId);
  if (!thread) return 0;
  const profile: DotLearnedProfile = thread.runtime.learned ?? { facts: [], throughSeq: 0 };
  if (profile.off) return 0;
  const limit = options.throughSeq ?? Infinity;
  const pending = thread.items.filter((item) => item.seq > profile.throughSeq && item.seq <= limit && LEARN_KINDS.has(item.kind) && !item.streaming);
  if (pending.length === 0) return 0;
  const lines: string[] = [];
  let chars = 0;
  let through = profile.throughSeq;
  for (const item of pending) {
    const line = renderForRecord(item, options.timeZone, 1_500);
    if (chars + line.length > MAX_PASS_CHARS && lines.length) break;
    lines.push(line);
    chars += line.length;
    through = item.seq;
  }
  const read = pending.filter((item) => item.seq <= through);
  const now = options.now();
  if (!read.some((item) => item.kind === 'user')) {
    updateDotRuntime(options.dotId, (runtime) => ({ ...runtime, learned: { ...(runtime.learned ?? profile), throughSeq: through } }));
    return 0;
  }
  const reply = await options.summarize({
    systemPrompt: learningSystemPrompt({ dotName: options.dotName, purpose: options.purpose }),
    prompt: learningUserPrompt({ profile, about: options.about, transcript: lines.join('\n') }),
    signal: options.signal,
  });
  const change = parseLearning(reply);
  const known = new Set(read.map((item) => item.id));
  let changed = 0;
  updateDotRuntime(options.dotId, (runtime) => {
    const latest = runtime.learned ?? profile;
    if (latest.off) return runtime;
    const next = applyLearning(latest, change, now, known);
    const touched = next.facts.filter((fact) => fact.updatedAt === now).length;
    const dropped = latest.facts.filter((fact) => !next.facts.some((kept) => kept.id === fact.id)).length;
    changed = touched + dropped;
    return { ...runtime, learned: { ...next, throughSeq: Math.max(latest.throughSeq, through), learnedAt: now } };
  });
  return changed;
};

/** The profile as the bot reads it each turn, by section; empty when there is nothing yet. */
export const learnedBlock = (profile: DotLearnedProfile | undefined, dotName: string): string => {
  if (!profile || profile.off || profile.facts.length === 0) return '';
  const sections = LEARNED_SECTIONS
    .map((section) => ({ section, facts: profile.facts.filter((fact) => fact.section === section.id) }))
    .filter((entry) => entry.facts.length);
  return [
    `<learned_about_user source="${dotName}'s own conversations">`,
    'What you have learned about the user yourself, kept for you alone. Where it and what Willow knows disagree, the newer one is more likely right.',
    ...sections.map(({ section, facts }) => `## ${section.title}\n${facts.map((fact) => `- ${fact.text}`).join('\n')}`),
    '</learned_about_user>',
  ].join('\n\n');
};

/** From the bot's profile: forget one fact, or everything; turn learning off or on. */
export const forgetLearnedFact = (dotId: string, factId: string): void => {
  updateDotRuntime(dotId, (runtime) => (runtime.learned ? { ...runtime, learned: { ...runtime.learned, facts: runtime.learned.facts.filter((fact) => fact.id !== factId) } } : runtime));
};

export const forgetAllLearned = (dotId: string): void => {
  updateDotRuntime(dotId, (runtime) => {
    const last = getDotThread(dotId)?.items.at(-1)?.seq ?? runtime.learned?.throughSeq ?? 0;
    return { ...runtime, learned: { facts: [], throughSeq: last, learnedAt: Date.now(), off: runtime.learned?.off } };
  });
};

export const setLearning = (dotId: string, on: boolean): void => {
  updateDotRuntime(dotId, (runtime) => ({ ...runtime, learned: { ...(runtime.learned ?? { facts: [], throughSeq: 0 }), off: on ? undefined : true } }));
};
