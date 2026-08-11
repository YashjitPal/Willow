/**
 * The model call the builder makes, and nothing else.
 *
 * Deliberately not `streamChat`. That function exists to drive a chat turn — it
 * streams tokens, emits phases, declares search and code-execution tools, and
 * loops on tool calls. The builder wants one request, one string back, no tools,
 * no streaming, and no chance of the extractor deciding to run a web search on
 * the user's private conversations. `chat-title.ts` makes the same call for the
 * same reasons; this is that shape with a system prompt added.
 *
 * Like the title generator, it never throws. A build that fails is a build that
 * did not happen — the old profile stays, the chats stay undigested, and the
 * next run tries again. There is nobody watching to show an error to.
 */

/** `any` for the same reason `chat-title.ts` uses it: the caller passes auth's
 *  `ApiKeys` interface, which has no index signature, and this looks providers
 *  up by a runtime string. */
type ApiKeyMap = any;

export type ExtractProvider = 'gemini' | 'openai' | 'anthropic';

export interface ExtractModel {
  provider: ExtractProvider;
  modelId: string;
  apiKey: string;
}

/**
 * The only thing `rebuild.ts` needs from this file, so tests can pass a function
 * returning canned JSON and never touch the network.
 */
export type ExtractRunner = (
  system: string,
  user: string,
  signal?: AbortSignal,
) => Promise<string>;

/**
 * A small, cheap model is the right default and not a compromise.
 *
 * The extractor's job is reading comprehension against a rigid output contract.
 * That is what small models are good at, and the alternative — the user's main
 * chat model — would spend Pro-tier tokens on a background job the user did not
 * ask for and cannot see, repeatedly, on their own key.
 */
const DEFAULT_MODELS: Record<ExtractProvider, string> = {
  gemini: 'gemini-3.1-flash-lite',
  openai: 'gpt-5-mini',
  anthropic: 'claude-haiku-4-5-20251001',
};

/** Preference order, and also the order of "cheapest small model available". */
const PROVIDER_ORDER: ExtractProvider[] = ['gemini', 'openai', 'anthropic'];

/**
 * Pick a model to extract with, or `null` when the user has no usable key.
 *
 * Null is a normal outcome, not an error: someone can run Willow entirely on a
 * provider this does not support, and the correct response is to leave the
 * profile empty rather than to nag. The Settings page says the profile has not
 * been built; nothing else happens.
 */
export const resolveExtractModel = (apiKeys: ApiKeyMap): ExtractModel | null => {
  for (const provider of PROVIDER_ORDER) {
    const key = apiKeys?.[provider]?.[0];
    if (typeof key === 'string' && key.trim()) {
      return { provider, modelId: DEFAULT_MODELS[provider], apiKey: key.trim() };
    }
  }
  return null;
};

/** Long enough for a batch of a dozen conversations, short enough that a hung
 *  request cannot keep a background job alive across a whole session. */
const REQUEST_TIMEOUT_MS = 60_000;

/** The contract caps a batch's output well below this; it is a runaway guard. */
const MAX_OUTPUT_TOKENS = 2048;

const withTimeout = (signal?: AbortSignal): { signal: AbortSignal; done: () => void } => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
};

/**
 * A runner bound to one model.
 *
 * Temperature is 0 everywhere it can be set. Two builds over the same
 * conversations should produce the same bullets — a profile that reshuffles its
 * own wording every night is one the user cannot recognise as theirs, and the
 * fingerprint dedupe would treat each rewording as a new claim.
 */
export const createExtractRunner = (model: ExtractModel): ExtractRunner =>
  async (system, user, signal) => {
    const { signal: requestSignal, done } = withTimeout(signal);
    try {
      if (model.provider === 'gemini') {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model.modelId}:generateContent?key=${model.apiKey}`,
          {
            method: 'POST',
            signal: requestSignal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: 'user', parts: [{ text: user }] }],
              generationConfig: {
                temperature: 0,
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                responseMimeType: 'application/json',
              },
            }),
          },
        );
        if (!response.ok) return '';
        const data = await response.json();
        return String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
      }

      if (model.provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          signal: requestSignal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${model.apiKey}`,
          },
          body: JSON.stringify({
            model: model.modelId,
            temperature: 0,
            max_completion_tokens: MAX_OUTPUT_TOKENS,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        });
        if (!response.ok) return '';
        const data = await response.json();
        return String(data?.choices?.[0]?.message?.content ?? '');
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: requestSignal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': model.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-cors-bypass': 'true',
        },
        body: JSON.stringify({
          model: model.modelId,
          system,
          temperature: 0,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!response.ok) return '';
      const data = await response.json();
      return String(data?.content?.[0]?.text ?? '');
    } catch {
      // Timeout, offline, CORS, a revoked key — all the same to the caller.
      return '';
    } finally {
      done();
    }
  };
