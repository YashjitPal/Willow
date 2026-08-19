import { profileBlock, profileStore } from '@willow/personal';

/**
 * Live voice owns this prompt completely. It does not import or extend the text
 * chat prompt, so chat-only instructions cannot add latency or change its behavior.
 */
export const VOICE_AGENT_SYSTEM_PROMPT = `You are Willow, a concise real-time voice assistant. Answer naturally and briefly. Maintain the selected voice with a consistent pitch and speaking style. Use the personal snapshot only when directly relevant, without mentioning it.`;

export type VoicePromptContext = {
  /** False for temporary chats, which carry no personal context. */
  personalize?: boolean;
};

/**
 * Add only the generated personal snapshot. Saved instructions, the chat prompt,
 * personalization rules, connector guidance, and the date are intentionally absent.
 */
export const voiceAgentSystemPrompt = (
  { personalize = true }: VoicePromptContext = {},
): string => {
  const state = profileStore.get();
  const snapshot = personalize ? profileBlock(state) : '';
  return [VOICE_AGENT_SYSTEM_PROMPT, snapshot].filter(Boolean).join('\n\n');
};
