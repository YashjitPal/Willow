/**
 * What the Tool Builder shows when a turn fails, and its thought chip, as Flow words and draws
 * them: the error card's message and button per failure (I_b in Flow's bundle), the debug menu's
 * mock errors, and the chip's label (G_b). Kept apart from the session so the pages and tests
 * reach them without the harness.
 */

/** Flow's error card: its message, its one button, and what the button does. */
export interface BuilderError {
  message: string;
  button: string | null;
  action: 'RETRY' | 'FEEDBACK' | 'NAVIGATE' | 'SETTINGS' | 'NONE';
}

/** The debug menu's "Mock Error on Next Send" list, in Flow's order and wording. */
export const MOCK_ERRORS: readonly { code: string | null; label: string }[] = [
  { code: null, label: 'None (real BE)' },
  { code: 'PUBLIC_ERROR_UNSAFE_GENERATION', label: 'Unsafe Generation' },
  { code: 'PUBLIC_ERROR_HIGH_TRAFFIC', label: 'High Traffic' },
  { code: 'PUBLIC_ERROR_USER_QUOTA_REACHED', label: 'Quota Reached' },
  { code: 'PUBLIC_ERROR_USER_REQUESTS_THROTTLED', label: 'Throttled' },
  { code: 'PUBLIC_ERROR_SOMETHING_WENT_WRONG', label: 'Something Went Wrong' },
  { code: 'PUBLIC_ERROR_NON_ENGLISH_PROMPT', label: 'Non-English Prompt' },
  { code: 'PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED', label: 'Prominent People' },
  { code: 'PUBLIC_ERROR_MINOR', label: 'Minor Harm' },
  { code: 'PUBLIC_ERROR_SEXUAL', label: 'Sexual Filter' },
  { code: 'PUBLIC_ERROR_DANGER_FILTER', label: 'Danger Filter' },
  { code: 'PUBLIC_ERROR_APPLET_STORAGE_QUOTA_EXCEEDED', label: 'Storage Quota Exceeded' },
  { code: 'UNKNOWN_ERROR_CODE', label: 'Unknown (generic fallback)' },
];

const QUOTA_CODES = new Set([
  'PUBLIC_ERROR_USER_QUOTA_REACHED', 'PUBLIC_ERROR_PER_MODEL_DAILY_QUOTA_REACHED', 'PUBLIC_ERROR_PER_MODEL_DAILY_QUOTA_REACHED_UPGRADEABLE',
  'PUBLIC_ERROR_WORKSPACE_ACCOUNT_QUOTA_REACHED', 'PUBLIC_ERROR_VERTEX_QUOTA_EXHAUSTED', 'PUBLIC_ERROR_VERTEX_QUOTA_EXHAUSTED_ADMIN',
]);

/** An error that is one of Flow's codes (`PUBLIC_ERROR_HIGH_TRAFFIC`) rather than a model's words. */
export const isErrorCode = (error: string | undefined): boolean => !!error && /^[A-Z][A-Z0-9_]+$/.test(error);
/** A quota error replaces the prompt box with its card instead of showing in the chat. */
export const isQuotaError = (code: string | undefined): boolean => !!code && QUOTA_CODES.has(code);
/** The tool is over its storage limit: the page shows Flow's banner asking the agent. */
export const isStorageError = (code: string | undefined): boolean =>
  code === 'PUBLIC_ERROR_APPLET_SIZE_LIMIT_EXCEEDED' || code === 'PUBLIC_ERROR_APPLET_STORAGE_QUOTA_EXCEEDED';

const RETRY = 'Try again';

function describeCode(code: string): BuilderError {
  if (isQuotaError(code)) {
    return {
      message: code === 'PUBLIC_ERROR_PER_MODEL_DAILY_QUOTA_REACHED_UPGRADEABLE'
        ? "You've reached your Agent quota limit. Come back tomorrow or upgrade to chat more!"
        : "You've reached your Agent quota limit. Come back tomorrow to chat more.",
      button: null,
      action: 'NONE',
    };
  }
  if (code === 'PUBLIC_ERROR_HIGH_TRAFFIC' || code === 'PUBLIC_ERROR_MODEL_OVERLOADED') {
    return { message: 'Tool Builder is experiencing high demand. Please try again later.', button: RETRY, action: 'RETRY' };
  }
  if (['STREAM_ERROR_THROTTLED', 'STREAM_ERROR_RATE_LIMIT', 'PUBLIC_ERROR_USER_REQUESTS_THROTTLED', 'PUBLIC_ERROR_CONCURRENT_LIMIT_REACHED'].includes(code)) {
    return { message: 'You are sending messages too fast. Please wait a moment and try again.', button: RETRY, action: 'RETRY' };
  }
  if (['STREAM_ERROR_TIMEOUT', 'STREAM_ERROR_TIMEOUT_408', 'STREAM_ERROR_TIMEOUT_504', 'PUBLIC_ERROR_VIDEO_GENERATION_TIMED_OUT'].includes(code)) {
    return { message: 'The request timed out. Please try again.', button: RETRY, action: 'RETRY' };
  }
  if (isStorageError(code)) return { message: 'You have reached the tool storage limit. Try deleting old tools.', button: 'Back to gallery', action: 'NAVIGATE' };
  if (/UNSAFE|SAFETY|FILTER|SEXUAL|VIOLENCE|DANGER|MINOR|REPUTATIONAL/.test(code)) {
    return { message: 'This response was blocked because it may violate our safety policies.', button: 'Send feedback', action: 'FEEDBACK' };
  }
  return { message: 'Something went wrong. Please try again.', button: RETRY, action: 'RETRY' };
}

/** Flow's wording per failure: its codes exactly, a model's errors by what they say, and Willow's missing-model case. */
export function describeBuilderError(error: string | undefined): BuilderError {
  const text = error ?? '';
  if (isErrorCode(text)) return describeCode(text);
  if (/API Key for .* is missing|no chat model/i.test(text)) {
    return { message: 'Tool Builder needs a chat model. Add one and its API key in Settings → Models.', button: 'Open settings', action: 'SETTINGS' };
  }
  if (/overload|high demand|503|529|unavailable/i.test(text)) return describeCode('PUBLIC_ERROR_HIGH_TRAFFIC');
  if (/rate.?limit|429|too many requests|throttl|quota/i.test(text)) return describeCode('STREAM_ERROR_RATE_LIMIT');
  if (/timed? ?out|timeout|408|504/i.test(text)) return describeCode('STREAM_ERROR_TIMEOUT');
  if (/safety|blocked|unsafe/i.test(text)) return describeCode('PUBLIC_ERROR_UNSAFE_GENERATION');
  return describeCode('');
}

/** Flow's thought chip: the summary's last bold heading, and what follows it as the detail. */
export function thoughtChip(thoughts: string | undefined): { label: string; detail?: string } | null {
  const text = thoughts?.trim();
  if (!text) return null;
  const headings = [...text.matchAll(/\*\*([^*]+)\*\*/g)];
  const last = headings[headings.length - 1];
  if (!last) return { label: '', detail: text };
  const detail = text.slice(last.index! + last[0].length).trim();
  return { label: last[1]!.trim(), ...(detail ? { detail } : {}) };
}
