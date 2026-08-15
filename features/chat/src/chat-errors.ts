/** Messages shown in the conversation after the complete upstream retry budget is exhausted. */
export const FRIENDLY_CHAT_ERROR_MESSAGES = [
  'Something went wrong. Please try sending the message again.',
  "Sorry, I couldn't help with that. Could you try editing the prompt and sending it again?",
  "That request did not go through. Please revise your prompt and try once more.",
  "I still could not complete that request. Try changing the wording and sending it again.",
] as const;

/** Five retries after the original request, as requested by the chat UX. */
export const MAX_UPSTREAM_RETRIES = 5;

/** Backoff keeps a transient provider outage from receiving six requests at once. */
export const UPSTREAM_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;

type ErrorHistoryItem = { role: 'user' | 'assistant'; isError?: boolean; content?: string };

/** Pick friendly copy randomly, without immediately repeating the previous failed reply. */
export const friendlyChatErrorFor = (
  history: readonly ErrorHistoryItem[],
  random: () => number = Math.random,
): string => {
  let previousErrorMessage: string | undefined;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.role !== 'assistant') continue;
    if (item.isError) previousErrorMessage = item.content;
    break;
  }

  const choices = previousErrorMessage
    ? FRIENDLY_CHAT_ERROR_MESSAGES.filter((message) => message !== previousErrorMessage)
    : [...FRIENDLY_CHAT_ERROR_MESSAGES];
  const roll = Math.max(0, Math.min(0.999999, random()));
  return choices[Math.floor(roll * choices.length)];
};

/**
 * Preserve the useful provider code/status and the final message, without
 * dumping an SDK object (or a stack trace) into the normal assistant bubble.
 */
export const formatUpstreamError = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return String(error ?? 'Unknown error.');

  const value = error as Record<string, any>;
  const message = typeof value.message === 'string' ? value.message : '';
  const code = value.code ?? value.status ?? value.statusCode;
  const codeLine = code !== undefined && code !== null ? `Error code: ${String(code)}` : '';
  const details = typeof value.response?.data === 'string'
    ? value.response.data
    : typeof value.error?.message === 'string'
      ? value.error.message
      : '';
  return [codeLine, message, details]
    .filter(Boolean)
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join('\n') || String(error);
};
