/**
 * Web search as a CLIENT tool, for every endpoint that cannot run one itself.
 *
 * ## Why this exists
 *
 * Server-side search is the provider's own tool — `googleSearch`, Anthropic's
 * `web_search_20250305`, OpenAI's `web_search` — and it only works if the endpoint
 * actually implements it. A relay usually does not. It proxies the Messages or
 * Chat Completions shape faithfully and quietly drops the tool block, so the model
 * is asked to search, has nothing to search with, and answers "I can't search" —
 * which reads as Willow being broken rather than as the endpoint lacking a feature.
 *
 * Claude Code solves the same problem the same way: its own web search is a tool
 * the CLI declares and executes, which is exactly why it keeps working through a
 * third-party endpoint that has no server-side tool suite at all.
 *
 * So this declares `web_search` as an ordinary function and answers it here. Every
 * adapter already translates Gemini-shaped declarations into its own dialect and
 * runs the executor, so nothing provider-specific is needed: the tool reaches
 * Claude as `input_schema`, GPT as a nested `function`, Grok the same, GLM the
 * same.
 *
 * ## What answers it
 *
 * A grounded Gemini call — the one search Willow can always reach, because it is
 * the one provider whose search runs inside the model rather than beside it. The
 * query goes out with `googleSearch` enabled and comes back as prose plus real
 * `groundingChunks`, which are the same sources the chat's own citation cards are
 * built from. That means the answer this returns is CITED: the calling model gets
 * URLs it can quote rather than a summary it has to trust.
 *
 * It is gated on a Gemini key being present. A declared tool with no executor
 * behind it is worse than no tool — the model announces a search it cannot run.
 */
import { streamChat } from './chat';
import type { GroundingSource } from './grounding';

/** The name every model sees. Deliberately the plain one, because it is the plain
 *  thing: a search tool. Only ever declared when no server-side tool of the same
 *  name is being sent, so there is nothing for it to collide with. */
export const WEB_SEARCH_TOOL_NAME = 'web_search';

/**
 * Gemini-shaped, like every other declaration in this codebase: the adapters
 * translate outward, so one shape in means the tool works on all five formats.
 */
export const webSearchToolDeclaration = (): { functionDeclarations: any[] }[] => [{
  functionDeclarations: [{
    name: WEB_SEARCH_TOOL_NAME,
    description:
      'Search the web for current information and return summarised results with '
      + 'source URLs. Use it whenever the answer depends on anything recent, '
      + 'anything you are unsure of, or anything the user asks you to look up.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'The search query, phrased as a search engine query rather than a question.',
        },
      },
      required: ['query'],
    },
  }],
}];

export interface WebSearchResult {
  /** Grounded prose, already summarised — what the calling model reads. */
  text: string;
  sources: GroundingSource[];
}

/*
 * Short and imperative on purpose: this model is a search back end, not a
 * correspondent. Anything conversational it adds is text the calling model has to
 * read past to reach the facts.
 */
const SEARCH_SYSTEM_PROMPT = [
  'You are a search back end. Search the web for the query and report what you found.',
  'Answer in at most 200 words of plain prose. Lead with the specific facts — names,',
  'numbers, dates, quotes. Attribute each claim to the site it came from. If the',
  'search returns nothing useful, say so in one sentence rather than guessing.',
].join(' ');

export interface RunWebSearchOptions {
  query: string;
  /** A Gemini key. Absent means the tool must not have been declared. */
  apiKey: string;
  /** Cheap and fast by default; grounding does the work, not the model. */
  model?: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

/**
 * Run one grounded query.
 *
 * Errors are RETURNED, not thrown: a failed search is a tool result the model can
 * react to ("the search failed, answer from what you know"), while a throw would
 * take down a turn that was otherwise fine.
 */
export const runWebSearch = async ({
  query,
  apiKey,
  model = 'gemini-3.5-flash-lite',
  baseUrl,
  signal,
}: RunWebSearchOptions): Promise<WebSearchResult> => {
  let text = '';
  let sources: GroundingSource[] = [];
  try {
    await streamChat(
      [{ role: 'user', content: query }],
      {
        provider: 'gemini',
        model,
        apiKey,
        thinkingLevel: 0,
        enableSearch: true,
        /* No client tools of its own, and no code execution: this call exists to
           ground a query, and anything else it could reach is a way for it to take
           longer or fail. */
        enableCodeExecution: false,
        toolPolicy: 'provider-native',
        baseUrl,
        signal,
      },
      (token: string) => { text += token; },
      () => {},
      SEARCH_SYSTEM_PROMPT,
      undefined,
      undefined,
      undefined,
      (citations) => { sources = citations.sources ?? []; },
    );
  } catch (error: any) {
    return {
      text: `The web search could not be completed: ${String(error?.message || error)}`,
      sources: [],
    };
  }
  return { text: text.trim(), sources };
};

/**
 * The tool result, as the calling model reads it.
 *
 * URLs are listed explicitly rather than left implicit in the prose, because the
 * model is expected to cite them and cannot cite what it was not given.
 */
export const formatWebSearchResult = (result: WebSearchResult): string => {
  const lines = [result.text || 'The search returned no usable results.'];
  if (result.sources.length) {
    lines.push('', 'Sources:');
    result.sources.slice(0, 10).forEach((source, index) => {
      const title = source.title || source.domain || source.uri;
      lines.push(`[${index + 1}] ${title} — ${source.uri}`);
    });
  }
  return lines.join('\n');
};
