/**
 * Running a personal tool call and shaping the result.
 *
 * The chat pipeline hands over a tool name and arguments; this returns text. It
 * is the only place that knows both halves, which is what keeps `platform/ai`
 * free of any knowledge of profiles, connectors or OAuth.
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
}

/** The action side, kept behind an interface so the executor never imports OAuth. */
export interface PersonalActions {
  createTask: (input: { title: string; notes?: string; due?: string }) => Promise<string>;
  createCalendarEvent: (input: {
    title: string; start: string; end?: string; description?: string; location?: string;
  }) => Promise<string>;
  createDocument: (input: { title: string; body?: string }) => Promise<string>;
  createPlaylist: (input: { title: string; description?: string }) => Promise<string>;
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

/** Action tool names, kept together so the gating in `chat.ts` is one check. */
export const ACTION_TOOLS = {
  createTask: 'create_task',
  createCalendarEvent: 'create_calendar_event',
  createDocument: 'create_document',
  createPlaylist: 'create_youtube_playlist',
} as const;

export const isPersonalActionCall = (name: string | undefined): boolean =>
  Object.values(ACTION_TOOLS).includes(name as never);

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
      default:
        return null;
    }
  } catch {
    // The action layer already turns expected failures into readable text, so
    // reaching here means something unexpected — still not worth breaking a turn.
    return { name, text: 'That action could not be completed. The connection may have expired.' };
  }
};
