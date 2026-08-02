const apiKeys = Object.freeze({
  gemini: Object.freeze([] as string[]),
  openai: Object.freeze([] as string[]),
  anthropic: Object.freeze([] as string[]),
});

const qaUserData = Object.freeze({ apiKeys });

/** Stable identity is required because Agent Builder effects depend on apiKeys. */
export const useUserDataContext = () => qaUserData;
