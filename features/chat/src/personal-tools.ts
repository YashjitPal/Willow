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
 *   not the actions. Turning personalization off means the model is not told the
 *   feature exists.
 * - Memory on → the retrieval tool, always. It searches saved chats as well as
 *   the profile, so there is something to find from the first conversation
 *   onward and the feature does not need seeding before it works.
 * - Action tools → only for products actually connected, decided per product by
 *   `geminiActionTools`.
 *
 * This lives in the chat feature rather than in `@willow/personal` because the
 * decision needs the turn's own context (temporary chat or not), which the
 * package has no business knowing about.
 */

import {
  connectionsStore,
  geminiActionTools,
  geminiPersonalTool,
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

  const actions = geminiActionTools(connected);
  if (actions) blocks.push(actions);

  return blocks;
};
