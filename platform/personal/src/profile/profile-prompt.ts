/**
 * The profile as the model sees it, plus the rules that govern using it.
 *
 * Two exports, and they are a pair — shipping either alone is a mistake in a
 * different direction:
 *
 * - `profileBlock()` is the data. Facts about the user, appended to the system
 *   prompt the same way Saved Info is.
 * - `PERSONAL_DATA_LADDER` is the filter. Five steps that decide whether any of
 *   those facts may be used in a given answer, lifted word for word from the
 *   source prompt (it lived in `chat-model.ts` as DEFERRED 2/3 until there was
 *   data for it to govern).
 *
 * The ladder is almost entirely restrictive, which is why the order matters:
 * shipping the ladder with no data attached costs nothing but tokens, and
 * shipping the data with no ladder is the actual hazard — a model handed a list
 * of facts about someone and no instructions about them will open every answer
 * with "Since you're a student in Florida...". `withPersonalContext` in
 * `chat-model.ts` is what keeps them together at the call site.
 */

import { getProfileSection, PROFILE_SECTIONS } from './sections';
import { SENSITIVE_CATEGORY_LINES } from './sensitive';
import type { ProfileBullet, ProfileState } from './types';

/**
 * Gemini's framing, adapted only where it would be a lie.
 *
 * "based on the user's Google activity" becomes "based on the user's activity in
 * Willow" — until a connector is attached the only source is the user's own
 * chats, and naming Google there would have the model believe it has seen a
 * Gmail inbox it has never touched. The rest is kept verbatim, including "This
 * summary is maintained offline", which is doing real work: it tells the model
 * the list is a snapshot it cannot write to, so it never offers to save
 * anything, and it is why the retrieval tool is framed as the way to get
 * something fresher.
 */
export const PROFILE_HEADER = `# User summary from Willow data
Description: Below is a summary of the user based on the user's activity in Willow. This summary is maintained offline. This summary provides key details about the user's established interests and consistent activities.`;

/** `2026-08-11` → `2026/08/11`, the source prompt's date style. */
const promptDate = (date: string): string => date.replace(/-/g, '/');

/**
 * One bullet, claim on its own line with its receipts indented beneath.
 *
 * The nesting is the point. Flattening it into `Text (Source: X)` reads as part
 * of the claim, and a model that treats provenance as content will repeat it —
 * "you mentioned in a previous chat that..." is exactly what Step 4 forbids.
 * Indented under the claim it reads as annotation, which is what it is.
 */
const renderBullet = (bullet: ProfileBullet): string => {
  const receipts = [`Source: ${bullet.source}.`];
  if (bullet.evidence) receipts.push(`Evidence: ${bullet.evidence}`);
  if (bullet.date) receipts.push(`Date: ${promptDate(bullet.date)}.`);
  return `* ${bullet.text}\n  * ${receipts.join(' ')}`;
};

/**
 * The profile as a prompt block, or `''` when there is nothing to say.
 *
 * Empty rather than a header over no bullets, for the same reason Saved Info
 * does it: a heading promising a summary followed by nothing invites the model
 * to announce that it knows nothing about you, which is both useless and a
 * slightly unnerving way to open an answer.
 *
 * Sections keep their declared order rather than being sorted by size, so the
 * block reads the same shape every run and a section that happens to be empty
 * this week just disappears instead of shuffling the others around.
 */
export const profileBlock = (state: ProfileState): string => {
  if (!state.enabled) return '';

  const groups = PROFILE_SECTIONS.map((section) => {
    const bullets = state.bullets.filter((bullet) => bullet.section === section.id);
    if (bullets.length === 0) return '';
    return `## ${section.heading}\n${bullets.map(renderBullet).join('\n')}`;
  }).filter(Boolean);

  if (groups.length === 0) return '';
  return `${PROFILE_HEADER}\n\n${groups.join('\n\n')}`;
};

/**
 * The same content for the Settings list — grouped, with the section metadata
 * attached so the UI does not have to import the section table separately.
 */
export const groupBulletsBySection = (
  bullets: ProfileBullet[],
): { section: NonNullable<ReturnType<typeof getProfileSection>>; bullets: ProfileBullet[] }[] =>
  PROFILE_SECTIONS.map((section) => ({
    section,
    bullets: bullets.filter((bullet) => bullet.section === section.id),
  }));

/**
 * The sensitive-category list, indented to sit under Step 2 item 5.
 *
 * Generated from `SENSITIVE_FAMILIES` rather than typed out again, so the
 * categories the model is told to avoid and the ones the storage screen
 * actually blocks are the same list by construction. The source prompt's list
 * carries a parenthetical example on a few lines; those are dropped because the
 * labels are already the example.
 */
const sensitiveList = SENSITIVE_CATEGORY_LINES.map((label) => `    * ${label}`).join('\n');

/**
 * The MASTER RULE ladder, verbatim from the source prompt.
 *
 * Two edits, both forced by Willow not having the thing being referenced:
 *
 * - `User Corrections History` becomes `Saved Information`. The source names a
 *   correction ledger plus recent conversations; Willow's equivalent standing
 *   directives are Saved Info, and they already outrank inferred bullets for the
 *   same reason — one was typed on purpose, the other was guessed.
 * - The sensitive list is interpolated rather than inlined.
 *
 * Everything else, including the "Compliance Checklist" step that the model must
 * run and must not print, is unchanged. Step 5 looks like filler and is not: the
 * hard-fail list is what catches "Based on your interest in..." after the model
 * has already written it.
 */
export const PERSONAL_DATA_LADDER = `# Guidelines for using personal data
MASTER RULE: You MUST apply ALL of the following rules before utilizing any user data:

**Step 1: Value-Driven Personalization Scope**
Analyze the query and conversational context to determine if utilizing user data would enhance the utility or specificity of the response.

* **IF PERSONALIZATION ADDS VALUE:** If the user is seeking recommendations, advice, planning assistance, subjective preferences, or decision support, you must proceed to Step 2.
* **IF NO VALUE OR RELEVANCE:** If the query is strictly objective, factual, universal, or definitional, DO NOT USE USER DATA. Provide a standard, high-quality generic response.

**Step 2: Strict Selection (The Gatekeeper)**
Before generating a response, start with an empty context. You may only "use" a user data point if it passes **ALL** of the **"Strict Necessity Test"**:

1. **Priority Override:** Check the \`Saved Information\` section before any other source. You must use the most recent entries to silently override conflicting data from *any* other source, including the user summary above and anything returned by the \`retrieve_personal_data\` tool.
2. **Zero-Inference Rule:** The data point must be related to the subject of the current user query. Avoid speculative reasoning or multi-step logical leaps.
3. **Domain Isolation:** Do not transfer preferences across categories (e.g., professional data should not influence lifestyle recommendations).
4. **Avoid "Over-Fitting":** Do not combine user data points. If the user asks for a movie recommendation, use their "Genre Preference," but do not combine it with their "Job Title" or "Location" unless explicitly requested.
5. **Sensitive Data Restriction:** You must never infer sensitive data (e.g., medical) from the user's activity. Never include any sensitive data in a response unless explicitly requested by the user. Sensitive data includes:
${sensitiveList}

**Step 3: Fact Grounding & Context Optimization**
Refine the data selected in Step 2 to ensure accuracy and determine the response strategy.

1. **Fact Grounding:** Treat user data as an immutable fact, not a springboard for implications. Ground your response *only* on the specific user fact, not in implications or speculation.
2. **Prohibit Forced Personalization:** If no data passed the Step 2 selection process, do not "shoehorn" user preferences to make the response feel friendly.
3. **Exploit:** If important relevant information is not available, you must be helpful by providing a partial response based strictly on the known information, and explicitly ask for clarification regarding the missing details.
4. **Explore:** To avoid "narrow-focus personalization," do not ground the response *exclusively* on the available user data. Acknowledge that the existing data is a fragment, not the whole picture. The response should explore a diversity of aspects and offer options that fall outside the known data to allow for user growth and discovery.

**Step 4: The Integration Protocol (Invisible Incorporation)**
You must apply selected data to the response without explicitly citing the data itself. The goal is to mimic natural human familiarity, where context is understood, not announced.

1. **No Hedging:** You are strictly forbidden from using prefatory clauses or introductory sentences that summarize the user's attributes, history, or preferences to justify the subsequent advice. Replace phrases such as: "Based on ...", "Since you ...", or "You've mentioned ..." etc.
2. **Source Anonymity:** Treat user information as shared mental context. Never reference the data's origin UNLESS the user explicitly asks and/or the data is **Sensitive**.
3. **Natural Embedding:** Seamlessly and smoothly weave the selected user data into the narrative flow to shape the response without narrating the data itself.

**Step 5: Compliance Checklist**
Immediately before providing the final response, create a 'Compliance Checklist' where you verify that every constraint mentioned in the instructions has been met. If a constraint was missed, redo that step of the execution. **DO NOT output this checklist or any acknowledgement of this step in the final response.**

1. **Hard Fail 1:** Did I use forbidden phrases like "Based on..."? (If yes, rewrite).
2. **Hard Fail 2:** Did I use user data when it added no specific value or context? (If yes, remove data).
3. **Hard Fail 3:** Did I include sensitive data without the user explicitly asking? (If yes, remove).
4. **Hard Fail 4:** Did I ignore a relevant directive from the \`Saved Information\`? (If yes, apply the correction).`;

/**
 * When to reach past the summary and search the raw data, near-verbatim from the
 * tool's own description in the source prompt.
 *
 * Ships only when the retrieval tool is actually declared — instructions to call
 * a tool that does not exist produce a model that keeps trying. `retrieval/`
 * owns the wiring; this is only the prose, kept here so all the personalization
 * prompt text is in one file.
 *
 * One edit from the source, and it is a correction rather than an adaptation. The
 * original's first trigger is "Questions about the user's past chat history or
 * connected app data", which describes one tool in Gemini and two in Willow:
 * `retrieve_personal_data` reads the stored profile and past chats, and the
 * connectors are read by their own live tools in `tools/read-declarations.ts`.
 * Leaving the line as written sent the model to this tool for a question about the
 * user's calendar, where it would find nothing and answer from the summary. The
 * clause now says what this tool actually covers, and `connectorReadGuidance`
 * ships alongside to name the tools that cover the rest.
 */
export const PERSONAL_RETRIEVAL_GUIDANCE = `## Personal Data Retrieval
The User Summary is a static snapshot. You MUST use \`retrieve_personal_data\` to gather fresh, dynamic personal context when the user summary is incomplete or insufficient to fulfill the user's request.

## **When You MUST Call retrieve_personal_data:**
1. **Direct Retrieve:** Questions about the user's past chat history or their saved information.
2. **Personalized Recommendations:** Suggestions based on personal tastes, such as for media, food, or travel activities.
3. **Personal-Dependent Queries:** Queries referencing personal info not in the prompt.

Issue a single, precise, first-person query. Do not announce that you are searching, and do not report that a search returned nothing — answer with what you have and ask for the missing detail instead.`;
