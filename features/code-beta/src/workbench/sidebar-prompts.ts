/**
 * The two prompts the sidebar sends to a naming model.
 *
 * Neither is user-visible, but both are load-bearing: the title prompt feeds a
 * 2-4 word session label and the suggestion prompt feeds the follow-up chips, so
 * their wording is what keeps those outputs short and unpunctuated. Kept as
 * builders rather than constants because each interpolates its own context.
 */

/** Prompt that turns a session's opening message into a short title. */
export const buildSessionTitlePrompt = (userPrompt: string): string =>
  `You are an AI assistant. Analyze this initial user prompt for a coding session and summarize it into a very short, creative title of 2 to 4 words. The title should describe what the user wants to build or achieve (e.g., "Create Button Component", "Fix Table Alignment", "Add Search Filter"). Do NOT use any quotes, punctuation, markdown, numbers, or bullet points. Return ONLY the title text.

User Prompt:
"${userPrompt}"`;

/** Prompt that turns the last few turns into follow-up suggestion chips. */
export const buildFollowUpSuggestionsPrompt = (recentMessages: string): string =>
  `Based on this conversation about building an app, suggest 5 short follow-up prompts (2-4 words each) the user might want to ask next. Return ONLY the suggestions, one per line. No numbers, no bullets, no question marks.\n\nConversation:\n${recentMessages}`;
