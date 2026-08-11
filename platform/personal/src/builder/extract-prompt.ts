/**
 * The extractor's prompt: read conversations, return bullets.
 *
 * This is the offline half of personalization and it never speaks to the user, so
 * it is written for a machine rather than for a reader — a strict output
 * contract, examples of the failure modes, and no politeness.
 *
 * The instructions are mostly about what NOT to record, because the default
 * failure of a model asked "what do you know about this person" is enthusiasm. It
 * will report that the user is curious, that they value clear explanations, that
 * they are working on something exciting. All true of everyone, all useless, and
 * all of it crowds out the eight real facts under a section cap.
 */

import { PROFILE_SECTIONS } from '../profile/sections';
import { SENSITIVE_CATEGORY_LINES } from '../profile/sensitive';

const sectionGuide = PROFILE_SECTIONS.map(
  (section) => `- \`${section.id}\` — ${section.heading}: ${section.guidance}`,
).join('\n');

const sensitiveGuide = SENSITIVE_CATEGORY_LINES.map((label) => `- ${label}`).join('\n');

export const EXTRACT_SYSTEM_PROMPT = `You maintain a factual profile of one person, built only from their own conversations with an AI assistant. You are not talking to them. Your entire output is JSON consumed by a program.

# What a bullet is
One durable, specific, checkable fact about the person, written in the third person starting with "The user".

Record a fact only if ALL of these hold:
1. **Durable.** It will still be true in six months. "The user is preparing for an exam in May" is durable; "The user is debugging a failing test" is not.
2. **Specific.** It names something. "The user studies organic chemistry" is specific; "The user is interested in science" is not.
3. **Stated or plainly demonstrated.** Either the person said it, or they did it repeatedly. One question about a topic is not an interest; five conversations about it is.
4. **About them, not about the assistant.** The assistant's habits, formatting, tone and suggestions are not facts about the person. If a claim would be true of whoever the assistant was talking to, it is not a fact about this person.

# Sections
${sectionGuide}

# Never record
${sensitiveGuide}

This applies even when the person states it outright and even when it would be useful. Do not record it, do not hint at it, and do not encode it in a way that a reader could reverse ("The user follows a restricted diet for medical reasons" is a health claim). Skip the bullet entirely.

Also never record:
- Anything the person asked about on behalf of someone else.
- Anything from a file, a pasted document, or a quoted message. That is the document's content, not the person's life.
- Credentials, keys, addresses, phone numbers, or account identifiers, whatever the section.
- Their opinion of the assistant, or how they want it to answer. Those are handled elsewhere.

# Evidence
Every bullet carries evidence: one sentence naming what in the conversations supports it, in enough detail that a person reading it could go and check. "Mentioned it" is not evidence. "Asked how to fix a Rust borrow-checker error in three separate conversations" is.

If a fact appears across several conversations, say so — that is the strongest kind of evidence, and it is what separates a real interest from a passing question.

# Dates
Set \`date\` (YYYY-MM-DD) only for a fact tied to a point in time: a plan, a deadline, an event, a project with an end. Leave it off for standing facts. A dated bullet is understood to expire.

# Output
Return ONLY a JSON object, no prose, no code fence:

{"bullets":[{"section":"interests","text":"The user is preparing for the JEE Advanced exam.","evidence":"Asked for help with rotational-motion and organic-chemistry problems framed as JEE preparation across four conversations.","date":"2026-05-24"}]}

An empty list is a correct and common answer. Return \`{"bullets":[]}\` rather than inventing something to fill it.`;

/**
 * Turn one batch of conversations into the extractor's user turn.
 *
 * The existing bullets are included so the model can skip what is already known
 * — without them every run re-derives the same facts and the merge step spends
 * its whole budget on deduplication. They are sent as plain text with no ids,
 * because the model's job here is to avoid repeating them, not to edit them.
 * Editing is `merge.ts`, and letting the extractor rewrite existing bullets is
 * how a profile drifts: a fact re-worded on every run eventually stops matching
 * what the user actually said.
 */
export const buildExtractRequest = ({
  conversations,
  existing,
  today,
}: {
  conversations: string;
  existing: string[];
  today: string;
}): string => {
  const known = existing.length
    ? `# Already known — do not repeat these, and do not restate them in different words\n${existing.map((line) => `- ${line}`).join('\n')}\n\n`
    : '';
  return `${known}Today is ${today}.

# Conversations
${conversations}

Return the JSON object now. Only facts that are new, durable, specific, and supported by the conversations above.`;
};

export interface ExtractedBullet {
  section: string;
  text: string;
  evidence: string;
  date?: string;
}

/**
 * Pull the bullet array out of a model reply.
 *
 * Tolerant on the wrapper and strict on the contents. Models fence JSON, prefix
 * it with "Here is the JSON", and occasionally return the bare array — all
 * recoverable. What is not recoverable is a bullet missing its text or evidence,
 * and those are dropped rather than patched: a bullet with invented evidence is
 * worse than no bullet, because the whole point of the evidence line is that the
 * user can check it.
 */
export const parseExtractResponse = (raw: string): ExtractedBullet[] => {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.search(/[[{]/);
  if (start === -1) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start));
  } catch {
    // One retry against the outermost brace pair, which recovers the common
    // case of trailing commentary after the JSON.
    const lastObject = text.lastIndexOf('}');
    const lastArray = text.lastIndexOf(']');
    const end = Math.max(lastObject, lastArray);
    if (end <= start) return [];
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return [];
    }
  }

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { bullets?: unknown })?.bullets)
      ? (parsed as { bullets: unknown[] }).bullets
      : [];

  const bullets: ExtractedBullet[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const text_ = typeof candidate.text === 'string' ? candidate.text.trim() : '';
    const evidence = typeof candidate.evidence === 'string' ? candidate.evidence.trim() : '';
    const section = typeof candidate.section === 'string' ? candidate.section.trim() : '';
    if (!text_ || !evidence || !section) continue;
    const date = typeof candidate.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate.date)
      ? candidate.date
      : undefined;
    bullets.push({ section, text: text_, evidence, ...(date ? { date } : {}) });
  }
  return bullets;
};
