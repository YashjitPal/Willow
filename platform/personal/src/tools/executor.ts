/**
 * Running a personal tool call and shaping the result.
 *
 * The chat pipeline hands over a tool name and arguments; this returns text. It
 * is the only place that knows every kind — retrieval over the stored profile,
 * live reads of the user's Google products, and the actions that write to them —
 * which is what keeps `platform/ai` free of any knowledge of profiles, connectors
 * or OAuth.
 *
 * Every result is a string, including every failure. A tool that throws breaks
 * the turn; a tool that returns "that didn't work because X" lets the model tell
 * the user what happened, and "your Calendar connection expired, reconnect it in
 * Settings" is a far better outcome than a red error bubble.
 */

import { retrievePersonalData, type PersonalContextDeps } from '../retrieval/personal-context';
import { isPersonalToolCall, readQueryArgument, RETRIEVE_PERSONAL_DATA } from './declarations';

export interface PersonalToolDeps extends PersonalContextDeps {
  /**
   * Action tools, injected. Absent means the connectors are not configured, and
   * the tools are then never offered — so this is only ever missing in tests and
   * in builds with no OAuth client id.
   */
  actions?: PersonalActions;
  /** Live connector reads, injected on the same terms as `actions`. */
  reads?: PersonalReads;
}

/** The action side, kept behind an interface so the executor never imports OAuth. */
export interface PersonalActions {
  createTask: (input: { title: string; notes?: string; due?: string }) => Promise<string>;
  createCalendarEvent: (input: {
    title: string; start: string; end?: string; description?: string; location?: string;
  }) => Promise<string>;
  createDocument: (input: { title: string; body?: string }) => Promise<string>;
  createPlaylist: (input: { title: string; description?: string }) => Promise<string>;
  /**
   * A Spotify playlist, filled in.
   *
   * `tracks` is a list of free-text searches — "Radiohead Weird Fishes" — not ids,
   * because a model has titles and Spotify needs URIs. Resolving them is the
   * action's job, and it reports which ones it could not find rather than quietly
   * making a shorter playlist than was asked for.
   *
   * This is the one action that can do what its YouTube counterpart cannot: YouTube
   * has no API for adding a video to a playlist on a user's behalf, so
   * `createPlaylist` there creates an empty playlist and says so.
   */
  createSpotifyPlaylist: (input: {
    title: string;
    description?: string;
    tracks?: string[];
  }) => Promise<string>;
}

/**
 * The live-read side: the user's Google products, read at the moment they ask.
 *
 * Separate from the profile on purpose, and the difference is what the whole read
 * surface exists for. The profile is a small stored description of the person,
 * built in the background and deliberately aggregated — it knows the user watches
 * science videos, and it threw the titles away. These read the real thing, once,
 * for one reply, and keep the detail: the titles, the events, the subject lines.
 *
 * Every method returns text, including every failure, for the same reason as the
 * actions: "your YouTube connection expired, reconnect it in Settings" is an answer
 * the user can act on, and a thrown error is a broken turn.
 */
export interface PersonalReads {
  listLikedVideos: (input: { limit?: number }) => Promise<string>;
  listSubscriptions: (input: { limit?: number }) => Promise<string>;
  listCalendarEvents: (input: { daysAhead?: number; daysBack?: number }) => Promise<string>;
  listTasks: (input: { includeCompleted?: boolean }) => Promise<string>;
  listRecentEmails: (input: { search?: string; limit?: number }) => Promise<string>;
  listRelationships: () => Promise<string>;
  listTopMusic: (input: { kind?: string; timeRange?: string; limit?: number }) => Promise<string>;
  listSavedTracks: (input: { limit?: number }) => Promise<string>;
  listSpotifyPlaylists: (input: { limit?: number }) => Promise<string>;
}

export interface ToolCallResult {
  name: string;
  text: string;
  /** For the UI chip; absent for actions, which report their own outcome. */
  matches?: number;
}

const asRecord = (args: unknown): Record<string, unknown> => {
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
};

const readString = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

/**
 * A number argument, however the model spelled it.
 *
 * Models hand back `"7"` about as often as `7`, and a limit that arrives as a
 * string turns into `NaN` two functions later where it is much harder to see.
 */
const readNumber = (args: Record<string, unknown>, key: string): number | undefined => {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const readBoolean = (args: Record<string, unknown>, key: string): boolean | undefined => {
  const value = args[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

/**
 * A list of strings, however the model spelled it.
 *
 * Three real shapes, all seen from production models: a proper array, a JSON array
 * inside a string, and one comma-separated string. The last is the reason this is
 * not a two-line function — a model asked for a playlist of five songs quite often
 * sends `"a, b, c, d, e"`, and reading that as a single track title produces one
 * failed search instead of five successful ones.
 */
const readStringArray = (args: Record<string, unknown>, key: string): string[] | undefined => {
  const value = args[key];

  const clean = (items: unknown[]): string[] =>
    items.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);

  if (Array.isArray(value)) {
    const items = clean(value);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === 'string' && value.trim()) {
    const text = value.trim();
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          const items = clean(parsed);
          return items.length > 0 ? items : undefined;
        }
      } catch {
        // Fall through to the comma split, which handles a malformed array better
        // than giving up does.
      }
    }
    const items = clean(text.split(','));
    return items.length > 0 ? items : undefined;
  }

  return undefined;
};

/** Action tool names, kept together so the gating in `chat.ts` is one check. */
export const ACTION_TOOLS = {
  createTask: 'create_task',
  createCalendarEvent: 'create_calendar_event',
  createDocument: 'create_document',
  createPlaylist: 'create_youtube_playlist',
  createSpotifyPlaylist: 'create_spotify_playlist',
} as const;

/** Live-read tool names. Same arrangement as `ACTION_TOOLS`, same reason. */
export const READ_TOOLS = {
  listLikedVideos: 'list_liked_videos',
  listSubscriptions: 'list_youtube_subscriptions',
  listCalendarEvents: 'list_calendar_events',
  listTasks: 'list_tasks',
  listRecentEmails: 'list_recent_emails',
  listRelationships: 'list_contact_relationships',
  listTopMusic: 'list_top_music',
  listSavedTracks: 'list_saved_tracks',
  listSpotifyPlaylists: 'list_spotify_playlists',
} as const;

export const isPersonalActionCall = (name: string | undefined): boolean =>
  Object.values(ACTION_TOOLS).includes(name as never);

export const isPersonalReadCall = (name: string | undefined): boolean =>
  Object.values(READ_TOOLS).includes(name as never);

/**
 * Run one live read.
 *
 * Split out of `executePersonalTool` because the two halves fail differently. An
 * action that cannot run has changed nothing and says so; a read that cannot run
 * has to be unmistakable about it, because the alternative is a model that treats
 * silence as "no liked videos" and answers a question about the user's own account
 * with an invention. Hence a sentence naming the product and what to do about it,
 * never an empty result.
 */
const runRead = async (
  name: string,
  args: unknown,
  deps: PersonalToolDeps,
): Promise<ToolCallResult> => {
  const reads = deps.reads;
  if (!reads) {
    return {
      name,
      text: 'That app is not connected, so there is nothing to read. The user can connect it in Settings → Connected Apps. Do not guess at what it would have contained.',
    };
  }

  const fields = asRecord(args);

  try {
    switch (name) {
      case READ_TOOLS.listLikedVideos:
        return { name, text: await reads.listLikedVideos({ limit: readNumber(fields, 'limit') }) };
      case READ_TOOLS.listSubscriptions:
        return { name, text: await reads.listSubscriptions({ limit: readNumber(fields, 'limit') }) };
      case READ_TOOLS.listCalendarEvents:
        return {
          name,
          text: await reads.listCalendarEvents({
            daysAhead: readNumber(fields, 'days_ahead'),
            daysBack: readNumber(fields, 'days_back'),
          }),
        };
      case READ_TOOLS.listTasks:
        return {
          name,
          text: await reads.listTasks({ includeCompleted: readBoolean(fields, 'include_completed') }),
        };
      case READ_TOOLS.listRecentEmails:
        return {
          name,
          text: await reads.listRecentEmails({
            search: readString(fields, 'search'),
            limit: readNumber(fields, 'limit'),
          }),
        };
      case READ_TOOLS.listRelationships:
        return { name, text: await reads.listRelationships() };
      case READ_TOOLS.listTopMusic:
        return {
          name,
          text: await reads.listTopMusic({
            kind: readString(fields, 'kind'),
            timeRange: readString(fields, 'time_range'),
            limit: readNumber(fields, 'limit'),
          }),
        };
      case READ_TOOLS.listSavedTracks:
        return { name, text: await reads.listSavedTracks({ limit: readNumber(fields, 'limit') }) };
      case READ_TOOLS.listSpotifyPlaylists:
        return {
          name,
          text: await reads.listSpotifyPlaylists({ limit: readNumber(fields, 'limit') }),
        };
      default:
        // Unreachable while `READ_TOOLS` and this switch agree, which
        // `isPersonalReadCall` is what guarantees.
        return { name, text: 'That read is not available.' };
    }
  } catch {
    return {
      name,
      text: 'That could not be read. The connection may have expired — the user can reconnect it in Settings → Connected Apps. Do not guess at the contents.',
    };
  }
};

/**
 * Execute a tool call, or return `null` if it is not one of ours.
 *
 * Returning null rather than an error string matters: the chat pipeline runs
 * several tool executors and this one must pass through the calls that belong to
 * another, instead of answering "unknown tool" on their behalf.
 */
export const executePersonalTool = async (
  name: string,
  args: unknown,
  deps: PersonalToolDeps,
): Promise<ToolCallResult | null> => {
  if (isPersonalToolCall(name)) {
    const query = readQueryArgument(args);
    const result = await retrievePersonalData(query, deps);
    return { name: RETRIEVE_PERSONAL_DATA, text: result.text, matches: result.matches };
  }

  if (isPersonalReadCall(name)) return runRead(name, args, deps);

  if (!isPersonalActionCall(name)) return null;

  const actions = deps.actions;
  if (!actions) {
    return {
      name,
      text: 'That app is not connected. The user can connect it in Settings → Connected Apps.',
    };
  }

  const fields = asRecord(args);

  try {
    switch (name) {
      case ACTION_TOOLS.createTask: {
        const title = readString(fields, 'title');
        if (!title) return { name, text: 'A task needs a title.' };
        return {
          name,
          text: await actions.createTask({
            title,
            notes: readString(fields, 'notes'),
            due: readString(fields, 'due'),
          }),
        };
      }
      case ACTION_TOOLS.createCalendarEvent: {
        const title = readString(fields, 'title');
        const start = readString(fields, 'start');
        if (!title || !start) {
          return { name, text: 'A calendar event needs a title and a start time.' };
        }
        return {
          name,
          text: await actions.createCalendarEvent({
            title,
            start,
            end: readString(fields, 'end'),
            description: readString(fields, 'description'),
            location: readString(fields, 'location'),
          }),
        };
      }
      case ACTION_TOOLS.createDocument: {
        const title = readString(fields, 'title');
        if (!title) return { name, text: 'A document needs a title.' };
        return {
          name,
          text: await actions.createDocument({ title, body: readString(fields, 'body') }),
        };
      }
      case ACTION_TOOLS.createPlaylist: {
        const title = readString(fields, 'title');
        if (!title) return { name, text: 'A playlist needs a title.' };
        return {
          name,
          text: await actions.createPlaylist({
            title,
            description: readString(fields, 'description'),
          }),
        };
      }
      case ACTION_TOOLS.createSpotifyPlaylist: {
        const title = readString(fields, 'title');
        if (!title) return { name, text: 'A playlist needs a title.' };
        return {
          name,
          text: await actions.createSpotifyPlaylist({
            title,
            description: readString(fields, 'description'),
            // Tracks are optional, and an empty list is not an error: "make me a
            // playlist for X" without named songs is a real request, and it gets an
            // empty playlist plus a sentence saying so.
            tracks: readStringArray(fields, 'tracks'),
          }),
        };
      }
      default:
        return null;
    }
  } catch {
    // The action layer already turns expected failures into readable text, so
    // reaching here means something unexpected — still not worth breaking a turn.
    return { name, text: 'That action could not be completed. The connection may have expired.' };
  }
};
