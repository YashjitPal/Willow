/**
 * Read tools — the read half of the connectors, live.
 *
 * The counterpart to `action-declarations.ts`, and the reason both files exist is
 * that the write half was live from the start and the read half was not. Willow
 * could create a YouTube playlist the moment YouTube was connected, but could not
 * tell the user what they had liked, because reading only ever happened inside the
 * background profile builder — which aggregates, discards the titles, and runs on
 * its own schedule. "Suggest something based on the videos I like" is a question
 * about the actual videos, asked now, and nothing here could answer it.
 *
 * Same gate as the actions, for the same reason: offered only when the product is
 * connected. A model that can see `list_calendar_events` will use it, and one
 * pointed at a product that was never connected produces a confident summary of an
 * empty week.
 *
 * The descriptions do one extra job the action descriptions do not need to. Each
 * says what the tool *cannot* see, because every one of these has a real limit that
 * a model will otherwise paper over: there is no watch history, Gmail returns no
 * message bodies, and Contacts holds only the relationship labels the user typed
 * themselves. A tool described as "read the user's YouTube" invites an answer about
 * what they have been watching, which is not a thing any OAuth scope grants.
 */

import { connectorById } from '../connectors/registry';
import type { ConnectorId } from '../connectors/types';
import { READ_TOOLS } from './executor';

interface ReadToolSchema {
  name: string;
  description: string;
  properties: Record<string, { type: string; description: string }>;
  required: string[];
  /** Which connector must be connected before this is offered. */
  connector: ConnectorId;
}

const SCHEMAS: ReadToolSchema[] = [
  {
    name: READ_TOOLS.listLikedVideos,
    connector: 'youtube',
    description:
      "List the videos the user has liked on YouTube, newest first, with titles, channels and links. This is the tool for questions about the user's taste in videos — what to watch next, what they are into, which creators they follow. It cannot see watch history: YouTube has no API for that, so likes and subscriptions are the whole picture.",
    properties: {
      limit: { type: 'integer', description: 'How many to fetch, 1 to 50. Defaults to 25.' },
    },
    required: [],
  },
  {
    name: READ_TOOLS.listSubscriptions,
    connector: 'youtube',
    description:
      'List the YouTube channels the user subscribes to, most relevant first. Use alongside liked videos for a fuller picture of what they follow, since a subscription is sustained interest where a like is a single video.',
    properties: {
      limit: { type: 'integer', description: 'How many to fetch, 1 to 50. Defaults to 25.' },
    },
    required: [],
  },
  {
    name: READ_TOOLS.listCalendarEvents,
    connector: 'calendar',
    description:
      "Read the user's Google Calendar over a window of days: titles, times, locations and small attendee lists. Use it for anything about their schedule, and before proposing a time for something — a suggestion that lands on top of an existing meeting is worse than asking. Reads the primary calendar only.",
    properties: {
      days_ahead: {
        type: 'integer',
        description: 'How many days forward to read, 0 to 180. Defaults to 7.',
      },
      days_back: {
        type: 'integer',
        description: 'How many days back to read, 0 to 180. Defaults to 0. Use for "what did I do last week".',
      },
    },
    required: [],
  },
  {
    name: READ_TOOLS.listTasks,
    connector: 'tasks',
    description:
      "Read the user's Google Tasks across their lists, with due dates and notes, soonest first. Use it before adding a task so a duplicate is not created, and for anything about what they have outstanding.",
    properties: {
      include_completed: {
        type: 'boolean',
        description: 'Include tasks already done. Defaults to false.',
      },
    },
    required: [],
  },
  {
    name: READ_TOOLS.listRecentEmails,
    connector: 'gmail',
    description:
      "List recent email in the user's Gmail: sender name, sending domain, subject line and date. It cannot return message contents — Willow holds metadata-only access, so the body of an email is not available to any tool and must never be guessed at from the subject. Skips spam and trash.",
    properties: {
      search: {
        type: 'string',
        description:
          'Optional Gmail search terms, e.g. "from:university" or "is:unread". Applied on top of the recent-mail filter.',
      },
      limit: {
        type: 'integer',
        description: 'How many messages, 1 to 30. Defaults to 15. Each one costs a request, so keep it small.',
      },
    },
    required: [],
  },
  {
    name: READ_TOOLS.listRelationships,
    connector: 'contacts',
    description:
      "List the people in the user's Google Contacts who carry a relationship label the user set themselves — partner, mother, manager and so on. Only the name and the label are available: no addresses, phone numbers or birthdays, and contacts with no label are not returned at all.",
    properties: {},
    required: [],
  },
];

const forConnectors = (connected: ConnectorId[]): ReadToolSchema[] =>
  SCHEMAS.filter((schema) => connected.includes(schema.connector));

/** Gemini's shape. Returns `null` when nothing is connected, so the caller can
 *  skip pushing an empty `functionDeclarations` block. */
export const geminiReadTools = (connected: ConnectorId[]) => {
  const schemas = forConnectors(connected);
  if (schemas.length === 0) return null;
  return {
    functionDeclarations: schemas.map((schema) => ({
      name: schema.name,
      description: schema.description,
      parameters: {
        type: 'OBJECT',
        properties: Object.fromEntries(
          Object.entries(schema.properties).map(([key, value]) => [
            key,
            { type: value.type.toUpperCase(), description: value.description },
          ]),
        ),
        required: schema.required,
      },
    })),
  };
};

export const openaiReadTools = (connected: ConnectorId[]) =>
  forConnectors(connected).map((schema) => ({
    type: 'function' as const,
    function: {
      name: schema.name,
      description: schema.description,
      parameters: { type: 'object', properties: schema.properties, required: schema.required },
    },
  }));

export const anthropicReadTools = (connected: ConnectorId[]) =>
  forConnectors(connected).map((schema) => ({
    name: schema.name,
    description: schema.description,
    input_schema: {
      type: 'object' as const,
      properties: schema.properties,
      required: schema.required,
    },
  }));

/** Which connector a given read tool belongs to. */
export const connectorForRead = (name: string): ConnectorId | undefined =>
  SCHEMAS.find((schema) => schema.name === name)?.connector;

/** Whether any read tool would be declared for this set of connectors. */
export const hasReadTools = (connected: ConnectorId[]): boolean =>
  forConnectors(connected).length > 0;

/**
 * The prompt block that tells the model these tools exist and when to use them.
 *
 * Built from the same table as the declarations rather than written out in
 * `profile/profile-prompt.ts` with the rest of the personalization prose, and that
 * is a deliberate exception to keeping the prompt text in one file. The block names
 * specific tools and specific products; assembled anywhere else it would be a
 * second list that has to be kept in step with this one by hand, and the failure
 * mode of that is a prompt telling the model to call a tool it was never given —
 * which produces a model that keeps trying.
 *
 * The instruction it exists to give is the one thing the tool descriptions cannot:
 * that reading is preferable to inferring. A model holding a stored profile that
 * says "watches science and technology on YouTube" will happily answer "suggest me
 * videos based on what I like" from that line alone, and never call the tool that
 * would have given it the actual titles.
 */
export const connectorReadGuidance = (connected: ConnectorId[]): string => {
  const schemas = forConnectors(connected);
  if (schemas.length === 0) return '';

  const products = [...new Set(schemas.map((schema) => connectorById(schema.connector)?.label))]
    .filter(Boolean)
    .join(', ');

  return `## Connected app data
The user has connected ${products} to Willow, and the tools listed above read them live: ${schemas.map((schema) => `\`${schema.name}\``).join(', ')}.

1. **Read rather than infer.** When a request depends on what is actually in one of these accounts, call the tool. The User Summary is a small, stale, aggregated description — it may say the user likes cooking videos, but only \`list_liked_videos\` knows which ones. Answering from the summary where a tool would have given you the real thing is the most common way to get this wrong.
2. **These are the only ways in.** \`retrieve_personal_data\` searches the user's saved information and past conversations with you. It cannot see a connected account.
3. **Report a failure as a failure.** If a tool says a connection expired or is not connected, tell the user that. Never present a guess as something you read from their account, and never treat an empty result as a reason to invent a plausible one.
4. **Read before you write.** Where a read tool and an action tool cover the same product, check the current state before changing it — an event proposed on top of an existing one, or a task added twice, is a mistake the user has to undo.`;
};
