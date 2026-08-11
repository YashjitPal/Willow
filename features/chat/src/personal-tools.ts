/**
 * Which personalization tools a chat turn declares.
 *
 * The gate, and it is a real one. A declared tool is a promise the model will
 * act on: told it can look up personal data, it will call that tool the first
 * time someone says "recommend me something", and if the profile is empty and
 * nothing is connected, the call comes back with nothing and the model has burnt
 * a round-trip to learn that. Worse for the action tools — a model that can see
 * `create_calendar_event` will use it, and a user who never connected Calendar
 * gets told an event was created.
 *
 * So the rules are simple and all of them are the user's:
 *
 * - Memory off, or a temporary chat → nothing at all. Not the retrieval tool,
 *   not the actions. Turning personalization off means the model is not told the
 *   feature exists.
 * - No profile and no connected products → no retrieval tool. There is nothing
 *   to retrieve, and offering it produces the empty round-trip above.
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

  // Retrieval is worth offering as soon as there is anything to find — stored
  // bullets, or a connected product whose data the search can reach.
  if (profile.bullets.length > 0 || connected.length > 0) {
    blocks.push(geminiPersonalTool());
  }

  const actions = geminiActionTools(connected);
  if (actions) blocks.push(actions);

  return blocks;
};
