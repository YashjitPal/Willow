// Single source of truth for provider API endpoints.
//
// The Settings UI lets users point any provider at a custom gateway (a proxy, a
// self-hosted router, a regional mirror). Leaving the field blank — or clearing
// it out — must fall back to that provider's official endpoint rather than
// sending requests to an empty or half-typed URL.

export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'moonshot' | 'spacexai' | 'zhipuai';

export const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  moonshot: 'https://api.moonshot.cn/v1',
  spacexai: 'https://api.x.ai/v1',
  zhipuai: 'https://open.bigmodel.cn/api/paas/v4',
};

/**
 * Normalize a user-entered base URL, falling back to the provider default when
 * it is blank or not yet a usable absolute URL. The second condition matters
 * because Settings saves on every keystroke: mid-edit values like `https:/` or
 * `api.op` would otherwise be handed to an SDK as a real endpoint.
 */
export const resolveBaseUrl = (provider: ProviderId, baseUrl?: string): string => {
  const fallback = DEFAULT_BASE_URLS[provider] ?? '';
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return fallback;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') return fallback;
  } catch {
    return fallback;
  }
  return trimmed;
};

/** True when the resolved endpoint is the provider's own official API. */
export const isOfficialEndpoint = (provider: ProviderId, baseUrl?: string): boolean =>
  resolveBaseUrl(provider, baseUrl) === DEFAULT_BASE_URLS[provider];

const isDevHost = (): boolean =>
  typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.port === '3000'
  );

export type EndpointTransport = {
  /** Value to hand the SDK as its base URL. */
  url: string;
  /** Extra headers the SDK must send (dev proxy target), if any. */
  headers?: Record<string, string>;
};

/**
 * Decide how the browser should reach a provider endpoint.
 *
 * Official endpoints allow direct browser calls. Custom gateways frequently do
 * not answer CORS preflights, so in dev we tunnel them through the Vite
 * `/llm-proxy` middleware, which reads the real target from `x-proxy-target`.
 *
 * `pathStyle` adapts to how each SDK builds request paths:
 *  - `origin`  strips any version suffix (SDK appends `/v1/...` itself)
 *  - `v1`      guarantees a trailing `/v1` (SDK appends only `/chat/completions`)
 *  - `asIs`    uses the URL exactly as resolved
 */
export const resolveEndpointTransport = (
  provider: ProviderId,
  baseUrl: string | undefined,
  pathStyle: 'origin' | 'v1' | 'asIs' = 'asIs',
): EndpointTransport => {
  let resolved = resolveBaseUrl(provider, baseUrl);

  if (pathStyle === 'origin') {
    resolved = resolved.replace(/\/v1(beta)?$/, '');
  } else if (pathStyle === 'v1' && !/\/v\d+(beta)?$/.test(resolved)) {
    /*
     * ANY version segment counts, not just `/v1`.
     *
     * Zhipu's OpenAI-compatible base is `https://open.bigmodel.cn/api/paas/v4`, and
     * a `/v1$` test does not see the `v4` — so every GLM request went to
     * `/api/paas/v4/v1/chat/completions`, which is a 404. Measured by driving the
     * real adapter: the provider was unusable, not merely unpolished.
     */
    resolved = `${resolved}/v1`;
  }

  if (isOfficialEndpoint(provider, baseUrl) || !isDevHost()) {
    return { url: resolved };
  }

  return {
    url: `${window.location.origin}/llm-proxy`,
    headers: { 'x-proxy-target': resolved },
  };
};
