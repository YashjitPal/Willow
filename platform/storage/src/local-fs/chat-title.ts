/**
 * Asking a model to name a chat.
 *
 * Lifted out of LocalFSProvider because it closes over nothing but the two
 * values it now takes as arguments. The provider still wraps it in a useCallback
 * keyed on those two, so the context value identity is unchanged.
 *
 * Every provider branch sends the same prompt and post-processes the reply the
 * same way; both are constants here so the three branches cannot drift apart.
 */

/**
 * Shape of the provider-keyed API key map this needs.
 *
 * `any`, not a Record, because the caller passes auth's `ApiKeys` — an interface,
 * so TypeScript gives it no implicit index signature and it will not assign to a
 * string-keyed Record. This function looks the provider up by a runtime string,
 * so the alternative is exporting that interface and widening another package's
 * public surface. `modelConfig` alongside it is `any` for the same reason.
 */
type ApiKeyMap = any;

/**
 * The naming prompt.
 *
 * It insists on no quotes, punctuation, or extension because the reply becomes
 * a directory name on disk.
 *
 * The assistant half is optional, and the `Assistant:` line is omitted entirely
 * when there is none — a dangling empty label reads to the naming model as a
 * reply that exists and said nothing. Chat naming runs off the user's prompt
 * alone (see the title effect in ChatView), so the no-reply form is the common
 * case, not a degraded one.
 */
const buildTitlePrompt = (userMessage: string, assistantMessage?: string): string => {
  const transcript = assistantMessage?.trim()
    ? `User: ${userMessage}\nAssistant: ${assistantMessage}`
    : `User: ${userMessage}`;
  return `Summarize this chat starting message into a very short, concise, and clean file/folder name (maximum 5 to 6 words). Return ONLY the rephrased name itself, with no quotation marks, punctuation, file extension, or introduction.\n\n${transcript}`;
};

/**
 * Strips the characters Windows and POSIX forbid in a filename, then caps the
 * length so the title cannot overflow a path.
 */
const toSafeTitle = (text: string): string => text.replace(/[\/:*?"<>|]/g, '').trim().slice(0, 80) || 'Untitled Chat';

/**
 * Returns a short title for a chat, or '' when it cannot produce one.
 *
 * Never throws and never rejects: the caller renames a chat with the result, so
 * a naming failure has to degrade to "keep the current name", not break the save.
 * The request is abandoned after 10s for the same reason.
 */
export const generateChatTitleWith = async (
  modelConfig: any,
  apiKeys: ApiKeyMap,
  userMessage: string,
  assistantMessage?: string,
): Promise<string> => {
  // 1. Resolve which model the user has selected for Chat Naming
  const chatNamingSelectionId = modelConfig?.systemDefaults?.chatRenaming || 'gemini-3.1-flash-lite';
  
  // 2. Look it up across all providers to get the provider + API key
  const allModels = [
    ...(modelConfig?.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' as const })),
    ...(modelConfig?.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' as const })),
    ...(modelConfig?.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' as const })),
    ...(modelConfig?.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'moonshot' as const })),
    ...(modelConfig?.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'spacexai' as const })),
    ...(modelConfig?.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'zhipuai' as const })),
  ];
  
  let targetProvider = 'gemini';
  let targetModelId = 'gemini-3.1-flash-lite';
  
  // If it's the exact default string, we know what it is
  if (chatNamingSelectionId === 'gemini-3.1-flash-lite') {
    targetProvider = 'gemini';
    targetModelId = 'gemini-3.1-flash-lite';
  } else if (chatNamingSelectionId === 'gemini-3.5-flash-lite') {
    targetProvider = 'gemini';
    targetModelId = 'gemini-3.5-flash-lite';
  } else if (chatNamingSelectionId === 'gemini-3.7-flash') {
    targetProvider = 'gemini';
    targetModelId = 'gemini-3.7-flash';
  } else if (chatNamingSelectionId === 'gemini-3.6-flash') {
    targetProvider = 'gemini';
    targetModelId = 'gemini-3.6-flash';
  } else if (chatNamingSelectionId === 'claude-sonnet-4.5') {
      targetProvider = 'anthropic';
      targetModelId = 'claude-sonnet-4.5';
  } else {
      // It's a custom saved model
      const sel = allModels.find((m) => m.modelId === chatNamingSelectionId);
      if (sel) {
        targetProvider = sel.provider;
        targetModelId = sel.modelId;
      }
  }
  
  const apiKey = apiKeys?.[targetProvider]?.[0];
  if (!apiKey) return ''; // Cannot generate if the target provider has no key
  
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 10000);
  try {
    if (targetProvider === 'gemini') {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${targetModelId}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: buildTitlePrompt(userMessage, assistantMessage)
                }]
              }]
            })
          }
        );
        if (response.ok) {
          const data = await response.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) {
            return toSafeTitle(text);
          }
        }
    } else if (targetProvider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: targetModelId,
            messages: [{
              role: 'user',
              content: buildTitlePrompt(userMessage, assistantMessage)
            }]
          })
        });
        if (response.ok) {
            const data = await response.json();
            const text = data?.choices?.[0]?.message?.content?.trim();
            if (text) {
                return toSafeTitle(text);
            }
        }
    } else if (targetProvider === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-cors-bypass': 'true'
            },
            body: JSON.stringify({
              model: targetModelId,
              max_tokens: 50,
              messages: [{
                role: 'user',
                content: buildTitlePrompt(userMessage, assistantMessage)
              }]
            })
          });
          if (response.ok) {
              const data = await response.json();
              const text = data?.content?.[0]?.text?.trim();
              if (text) {
                  return toSafeTitle(text);
              }
          }
    }
  } catch (err) {
    // Ignored
  } finally {
    window.clearTimeout(timeoutId);
  }
  return '';
};
