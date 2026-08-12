/**
 * Which personalization tools a chat turn declares.
 *
 * The gate, and it is a real one. A declared tool is a promise the model will
 * act on, so the cost of declaring one it cannot honour is a wrong answer rather
 * than a slow one: a model that can see `create_calendar_event` will use it, and
 * a user who never connected Calendar gets told an event was created. That is
 * why the action tools are gated per product and the retrieval tool is not —
 * retrieval over an empty profile still has the user's chats to read, and an
 * honest "I didn't find anything about that" is a fine answer.
 *
 * So the rules are simple and all of them are the user's:
 *
 * - Memory off, or a temporary chat → nothing at all. Not the retrieval tool,
 *   not the reads, not the actions. Turning personalization off means the model is
 *   not told the feature exists.
 * - Memory on → the retrieval tool, always. It searches saved chats as well as
 *   the profile, so there is something to find from the first conversation
 *   onward and the feature does not need seeding before it works.
 * - Read and action tools → only for products actually connected, decided per
 *   product by `geminiReadTools` and `geminiActionTools`.
 *
 * The read tools are gated on the same switch as everything else here, which is a
 * deliberate answer to a question that could have gone the other way. They read
 * live and store nothing, so they are not "learning about you" in the sense the
 * profile is — but the switch says Willow does not know who the user is, and an app
 * that still reaches into their calendar when it is off is not honouring that.
 *
 * They are *not* gated on the per-product "feeds my profile" toggle, which is a
 * different promise: that toggle governs what gets written into the stored profile
 * in the background. Answering a question the user just asked is not that, and the
 * action tools have always worked the same way.
 *
 * This lives in the chat feature rather than in `@willow/personal` because the
 * decision needs the turn's own context (temporary chat or not), which the
 * package has no business knowing about.
 */

import {
  connectionsStore,
  geminiActionTools,
  geminiPersonalTool,
  geminiReadTools,
  profileStore,
} from '@willow/personal';

export interface PersonalToolContext {
  /** False in a temporary chat, which carries nothing personal in either. */
  personalize?: boolean;
}

export const personalChatTools = (
  { personalize = true }: PersonalToolContext = {},
): { functionDeclarations: any[] }[] => {
  if (!personalize) return [];

  const profile = profileStore.get();
  if (!profile.enabled) return [];

  const connected = connectionsStore.get().enabled;
  const blocks: { functionDeclarations: any[] }[] = [];

  // Retrieval ships whenever Memory is on. It reads the user's own past chats as
  // well as the profile, so "no bullets and nothing connected" is not an empty
  // search — it is a search over the conversation history, which is the case the
  // feature is most useful in and the one a first-run user is actually in.
  blocks.push(geminiPersonalTool());

  // Reads before actions, which is not cosmetic: several of these pair up ("read
  // my tasks, then add one"), and a model that has both listed in that order is
  // likelier to check before it writes.
  const reads = geminiReadTools(connected);
  if (reads) blocks.push(reads);

  const actions = geminiActionTools(connected);
  if (actions) blocks.push(actions);

  return blocks;
};
