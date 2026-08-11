/**
 * Action tools — the write half of the connectors.
 *
 * Offered to the model only when the matching product is connected, which is the
 * single most important thing about this file. A model that can see
 * `create_calendar_event` will use it, and if nothing is wired behind it the user
 * gets "I've added that to your calendar" about an event that does not exist.
 * `platform/ai` already learned this with the media tools; the same rule holds
 * here, and `toolsForConnectors` is how it is enforced.
 *
 * The descriptions are written to make the model ask first. Creating a calendar
 * event is a change to something the user relies on, and a model that silently
 * files a meeting from an offhand remark is worse than one that asks.
 */

import type { ConnectorId } from '../connectors/types';
import { ACTION_TOOLS } from './executor';

interface ToolSchema {
  name: string;
  description: string;
  properties: Record<string, { type: string; description: string }>;
  required: string[];
  /** Which connector must be connected before this is offered. */
  connector: ConnectorId;
}

const SCHEMAS: ToolSchema[] = [
  {
    name: ACTION_TOOLS.createTask,
    connector: 'tasks',
    description:
      "Add a task to the user's Google Tasks. Use only when the user asks for something to be added to their tasks or to-do list. Do not use it to keep notes for yourself.",
    properties: {
      title: { type: 'string', description: 'The task, as a short imperative line.' },
      notes: { type: 'string', description: 'Optional detail. Keep it brief.' },
      due: { type: 'string', description: 'Optional due date as YYYY-MM-DD.' },
    },
    required: ['title'],
  },
  {
    name: ACTION_TOOLS.createCalendarEvent,
    connector: 'calendar',
    description:
      "Create an event in the user's Google Calendar. Confirm the date, time and title with the user before calling this unless they have already stated all three — a wrongly created event is harder to notice than a question.",
    properties: {
      title: { type: 'string', description: 'Event title.' },
      start: {
        type: 'string',
        description:
          'Start time as an ISO 8601 timestamp (2026-08-14T15:00:00) or a YYYY-MM-DD date for an all-day event.',
      },
      end: { type: 'string', description: 'End time, same format. Defaults to one hour after the start.' },
      description: { type: 'string', description: 'Optional details for the event body.' },
      location: { type: 'string', description: 'Optional location.' },
    },
    required: ['title', 'start'],
  },
  {
    name: ACTION_TOOLS.createDocument,
    connector: 'docs',
    description:
      "Create a Google Doc in the user's Drive with the given title and contents. Use this when the user asks for something to be written into a document — not as a place to put an answer they only asked to see.",
    properties: {
      title: { type: 'string', description: 'Document title.' },
      body: { type: 'string', description: 'The document contents as plain text.' },
    },
    required: ['title'],
  },
  {
    name: ACTION_TOOLS.createPlaylist,
    connector: 'youtube',
    description:
      "Create a private YouTube playlist for the user. Videos cannot be added by search — the playlist is created empty for the user to fill, so say that rather than implying it has been populated.",
    properties: {
      title: { type: 'string', description: 'Playlist title.' },
      description: { type: 'string', description: 'Optional playlist description.' },
    },
    required: ['title'],
  },
];

const forConnectors = (connected: ConnectorId[]): ToolSchema[] =>
  SCHEMAS.filter((schema) => connected.includes(schema.connector));

/** Gemini's shape. Returns `null` when nothing is connected, so the caller can
 *  skip pushing an empty `functionDeclarations` block. */
export const geminiActionTools = (connected: ConnectorId[]) => {
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

export const openaiActionTools = (connected: ConnectorId[]) =>
  forConnectors(connected).map((schema) => ({
    type: 'function' as const,
    function: {
      name: schema.name,
      description: schema.description,
      parameters: { type: 'object', properties: schema.properties, required: schema.required },
    },
  }));

export const anthropicActionTools = (connected: ConnectorId[]) =>
  forConnectors(connected).map((schema) => ({
    name: schema.name,
    description: schema.description,
    input_schema: {
      type: 'object' as const,
      properties: schema.properties,
      required: schema.required,
    },
  }));

/** Which connector a given action tool belongs to, for scope requests. */
export const connectorForAction = (name: string): ConnectorId | undefined =>
  SCHEMAS.find((schema) => schema.name === name)?.connector;
