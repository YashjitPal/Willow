/**
 * The tool the model is offered, in each provider's schema dialect.
 *
 * One tool, one method: search the user's own stored information. That is the
 * whole surface, and it matches what Gemini exposes — a `personal_context` tool
 * whose only method is `retrieve_personal_data`. There is deliberately no
 * `store_personal_data` counterpart. Writing is done offline by `builder/`, from
 * conversations that have already finished, which is what keeps the model from
 * deciding mid-sentence that something the user said deserves to be filed away.
 *
 * The description is doing real work. A tool described as "get information about
 * the user" gets called on every turn, which spends a round-trip per message and
 * teaches the model to open replies by reciting the profile. So the description
 * says when to call it and, more usefully, when not to.
 */

export const RETRIEVE_PERSONAL_DATA = 'retrieve_personal_data';

const DESCRIPTION = `Search the user's own saved information and their past conversations with you. Use this when answering well requires something about this specific user that you do not already have in context — their preferences, their situation, a project they are working on, or something they told you in an earlier conversation.

Call this when:
- The user refers to something from a previous conversation ("the thing I mentioned", "my project", "like last time").
- The request depends on a fact about them you were not told ("what should I cook", "help me plan my week").
- The user asks directly what you know or remember about them.

Do NOT call this when:
- The question is general knowledge and their situation does not change the answer.
- The context you need is already in this conversation.
- You have already called it this turn. Call it once, with the fullest query, rather than several times with variations.

The query is natural language, not keywords. Returns passages from the user's information and past conversations, each labelled with its source and date, or a note that nothing was found — which is a normal result and means you should ask instead of guessing.`;

const QUERY_DESCRIPTION =
  "What you are looking for, in plain language — e.g. 'the user's dietary preferences' or 'what the user decided about their thesis topic'. Written as a description of the information wanted, not as search keywords.";

/** Gemini: `functionDeclarations`, with its uppercase type names. */
export const geminiPersonalTool = () => ({
  functionDeclarations: [
    {
      name: RETRIEVE_PERSONAL_DATA,
      description: DESCRIPTION,
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: QUERY_DESCRIPTION },
        },
        required: ['query'],
      },
    },
  ],
});

/** OpenAI: a flat function object with a JSON Schema. */
export const openaiPersonalTool = () => ({
  type: 'function' as const,
  function: {
    name: RETRIEVE_PERSONAL_DATA,
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: QUERY_DESCRIPTION },
      },
      required: ['query'],
    },
  },
});

/** Anthropic: `input_schema` rather than `parameters`, and no wrapper object. */
export const anthropicPersonalTool = () => ({
  name: RETRIEVE_PERSONAL_DATA,
  description: DESCRIPTION,
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: QUERY_DESCRIPTION },
    },
    required: ['query'],
  },
});

/** True when a tool call is this one. */
export const isPersonalToolCall = (name: string | undefined): boolean =>
  name === RETRIEVE_PERSONAL_DATA;

/**
 * Pull the query out of a tool call's arguments.
 *
 * Providers disagree on whether arguments arrive parsed or as a JSON string, and
 * models occasionally send the query bare rather than in an object. All three are
 * handled here so the executor does not have to care.
 */
export const readQueryArgument = (args: unknown): string => {
  if (typeof args === 'string') {
    const text = args.trim();
    if (!text) return '';
    if (!text.startsWith('{')) return text;
    try {
      return readQueryArgument(JSON.parse(text));
    } catch {
      return text;
    }
  }
  if (args && typeof args === 'object') {
    const value = (args as Record<string, unknown>).query;
    if (typeof value === 'string') return value.trim();
  }
  return '';
};
