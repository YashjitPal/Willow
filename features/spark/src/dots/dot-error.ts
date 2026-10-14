/**
 * A failed turn in words the user can act on. A provider's SDK fails in its own words — a class tag, the whole request
 * URL, the HTTP status in brackets and the API's error as JSON — which are for whoever debugs it. This says in a
 * sentence whose service it was, what went wrong and what to do; the original is kept, for anyone who wants it, as the
 * details. A message that is not a provider's (the harness's own) is already readable, and stays as it is.
 */

export interface DotTurnErrorText {
  /** What went wrong and what to do, in a sentence or two. */
  message: string;
  /** The provider's own words, when the message is not them. */
  detail?: string;
}

/** The note the runtime adds when it will try the turn again by itself (`withRetryNote` in harness/dot-runtime.ts). */
const RETRY_NOTE = /\s*Trying again in \d+ minutes?\.\s*$/;

// Whose error it is, by what it names: OpenRouter first, since what it relays names the model's maker too.
const PROVIDERS: [RegExp, string][] = [
  [/openrouter/i, 'OpenRouter'],
  [/GoogleGenerativeAI|generativelanguage\.googleapis\.com|\bgemini\b/i, 'Gemini'],
  [/anthropic|\bclaude\b/i, 'Anthropic'],
  [/api\.openai\.com|\bopenai\b/i, 'OpenAI'],
  [/\bx\.ai\b|\bxai\b|\bgrok\b/i, 'xAI'],
  [/deepseek/i, 'DeepSeek'],
  [/mistral/i, 'Mistral'],
  [/\bgroq\b/i, 'Groq'],
  [/bigmodel|zhipu|\bglm\b/i, 'Zhipu'],
];

const SETTINGS = 'Settings › Models & API';

const providerOf = (text: string): string | null => PROVIDERS.find(([pattern]) => pattern.test(text))?.[1] ?? null;

/** The API's own message inside the JSON it sent, when there is one. */
const messageIn = (text: string): string => {
  const match = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return '';
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
};

const asSentence = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim().replace(/[:;,]$/, '');
  return !flat ? '' : /[.!?…]$/.test(flat) ? flat : `${flat}.`;
};

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** A key that rides in a URL is never shown, even folded away. */
const withoutKeys = (text: string): string => text.replace(/([?&](?:key|api[_-]?key|access_token)=)[^&\s":]+/gi, '$1…');

export const readableTurnError = (raw: string): DotTurnErrorText => {
  const original = withoutKeys(raw.trim());
  const retry = original.match(RETRY_NOTE)?.[0].trim() ?? '';
  const error = original.replace(RETRY_NOTE, '').trim();
  const provider = providerOf(error);
  const who = provider ?? 'The model’s provider';

  // The SDK's tag and the request it was making say nothing to the user; the status and the API's words do.
  let rest = error.replace(/^\[[^\]]*Error\]:\s*/i, '');
  let status: number | null = null;
  let model: string | null = null;
  // The URL has colons of its own; the one that ends it is followed by a space.
  const fetching = rest.match(/^Error (?:fetching|reading) from (\S+?):\s+(?:\[(\d{3})[^\]]*\])?\s*([\s\S]*)$/i);
  if (fetching) {
    model = fetching[1].match(/models\/([^/:?]+)/)?.[1] ?? null;
    status = fetching[2] ? Number(fetching[2]) : null;
    rest = fetching[3];
  } else {
    const leading = rest.match(/^(\d{3})\b[\s:-]*([\s\S]*)$/);
    if (leading) {
      status = Number(leading[1]);
      rest = leading[2];
    }
  }
  const json = rest.search(/[[{]\s*["{]/);
  const said = asSentence(json >= 0 ? rest.slice(0, json) : rest) || asSentence(messageIn(rest));
  const text = `${error} ${said}`;
  const fromProvider = status !== null || Boolean(provider) || Boolean(fetching);

  const done = (message: string): DotTurnErrorText => ({
    message: retry ? `${message} ${retry}` : message,
    ...(message !== error ? { detail: error } : {}),
  });
  const later = retry ? '' : ' Try again in a moment.';

  if (/failed to fetch|fetch failed|networkerror|network error|load failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(text) && status === null) {
    return done(`Couldn’t reach ${provider ?? 'the model’s provider'}. Check the internet connection.${later}`);
  }
  if (!fromProvider) return { message: clip(original, 400) };

  if (/API_KEY_INVALID|api[\s_-]*key (?:not valid|is invalid|invalid|expired)|invalid[\s_-]*(?:x-)?api[\s_-]*key|incorrect api key|authentication_error|unauthenticated/i.test(text)
    || ((status === 401 || status === 403) && /key|auth|credential/i.test(text))) {
    return done(`${who} didn’t accept the API key. Check it in ${SETTINGS}, or choose another model.`);
  }
  if (status === 429 || /rate.?limit|too many requests|quota|RESOURCE_EXHAUSTED|insufficient_quota|credit balance|billing/i.test(text)) {
    return done(`${who} is turning requests away for now: the account’s rate limit or quota is used up.${retry ? '' : ' Try again later, or choose another model.'}`);
  }
  if (/context.{0,20}(?:length|window)|too many tokens|maximum context|prompt is too long|input token count|exceeds the maximum number of tokens/i.test(text)) {
    return done(`${who} says the conversation is now too long for this model. Choose one that takes more, or try again once it has been condensed.`);
  }
  if (status === 404 || /\bNOT_FOUND\b|model.{0,40}(?:not found|does not exist|is not supported)|unknown model/i.test(text)) {
    return done(`${who} doesn’t offer ${model ? `the model “${model}”` : 'that model'}. Choose another model.`);
  }
  if ((status !== null && status >= 500) || /overloaded|unavailable|internal error|bad gateway/i.test(text)) {
    return done(`${who} is having trouble right now${status ? ` (error ${status})` : ''}.${later}`);
  }
  if (/timed? ?out|deadline exceeded/i.test(text)) return done(`${who} took too long to answer.${later}`);
  if (/\bSAFETY\b|PROHIBITED_CONTENT|content.?filter|blocked.{0,30}(?:safety|policy)/i.test(text)) {
    return done(`${who} held the reply back under its safety rules.`);
  }
  return done(`${who} returned an error${status ? ` (${status})` : ''}${said ? `: ${clip(said, 220)}` : '.'}`);
};
