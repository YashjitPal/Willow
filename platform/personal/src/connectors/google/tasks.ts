/**
 * Google Tasks.
 *
 * Both halves of a connector in one file, because they are the same product.
 *
 * **Read** gives a genuinely good personalization signal and a cheap one: a task
 * list is a person stating, in their own words, what they intend to do. No
 * inference required. Only titles with due dates in the near future are kept —
 * an undated task is a someday-list item, and someday-list items are where
 * everyone's abandoned intentions live.
 *
 * **Write** is why most people will connect this at all: "add that to my tasks"
 * is one of the few requests where doing it beats describing how.
 */

import { query } from '../google-fetch';
import type { ConnectorFetch, ConnectorReader, ConnectorSignal } from '../types';

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tasks due inside this window describe what someone is doing now. */
const LOOK_AHEAD_DAYS = 30;
const MAX_LISTS = 5;
const PAGE_SIZE = 100;

export interface TaskList {
  id?: string;
  title?: string;
}

export interface Task {
  id?: string;
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  due?: string;
  completed?: string;
}

/** The user's task lists, newest first. Used by both halves. */
export const listTaskLists = async (
  fetchJson: ConnectorFetch,
  signal?: AbortSignal,
): Promise<TaskList[]> => {
  const page = await fetchJson<{ items?: TaskList[] }>(
    `${TASKS_API}/users/@me/lists${query({ maxResults: MAX_LISTS })}`,
    { signal },
  );
  return page?.items ?? [];
};

/** Open tasks on one list. */
export const listTasks = async (
  fetchJson: ConnectorFetch,
  listId: string,
  options: { includeCompleted?: boolean; signal?: AbortSignal } = {},
): Promise<Task[]> => {
  const page = await fetchJson<{ items?: Task[] }>(
    `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks${query({
      maxResults: PAGE_SIZE,
      showCompleted: options.includeCompleted ?? false,
      showHidden: false,
    })}`,
    { signal: options.signal },
  );
  return page?.items ?? [];
};

export const readTasksSignals = async (
  fetchJson: ConnectorFetch,
  signal?: AbortSignal,
): Promise<ConnectorSignal[]> => {
  const lists = await listTaskLists(fetchJson, signal);
  if (lists.length === 0) return [];

  const now = Date.now();
  const horizon = now + LOOK_AHEAD_DAYS * DAY_MS;
  const signals: ConnectorSignal[] = [];

  for (const list of lists) {
    if (signal?.aborted) break;
    if (!list.id) continue;
    const tasks = await listTasks(fetchJson, list.id, { signal });

    for (const task of tasks) {
      const title = (task.title ?? '').trim();
      if (!title || task.status === 'completed') continue;
      if (!task.due) continue;

      const dueMs = Date.parse(task.due);
      if (!Number.isFinite(dueMs) || dueMs > horizon) continue;

      const date = task.due.slice(0, 10);
      signals.push({
        section: 'events',
        // The title only. Task notes are where people paste the details they did
        // not want to retype — account numbers, addresses, whole messages — and
        // none of that belongs in a file read into every future prompt.
        text: `Has a task due: ${title}`,
        source: 'Google Tasks',
        evidence: `Open task on the "${list.title ?? 'Tasks'}" list, due ${date}.`,
        ...(/^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}),
      });
      // A profile is not a to-do list mirror. A handful of dated commitments is
      // the signal; forty is the user's task app, and they already have that.
      if (signals.length >= 6) return signals;
    }
  }

  return signals;
};

/** Create a task. Returns the created task, or null if the call failed. */
export const createTask = async (
  fetchJson: ConnectorFetch,
  input: { listId?: string; title: string; notes?: string; due?: string },
  signal?: AbortSignal,
): Promise<Task | null> => {
  let listId = input.listId;
  if (!listId) {
    const lists = await listTaskLists(fetchJson, signal);
    listId = lists[0]?.id;
  }
  if (!listId) return null;

  return fetchJson<Task>(`${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The API wants an RFC 3339 timestamp and ignores the time part of `due`.
    body: JSON.stringify({
      title: input.title,
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.due ? { due: `${input.due.slice(0, 10)}T00:00:00.000Z` } : {}),
    }),
    signal,
  });
};

/** Mark a task done. */
export const completeTask = async (
  fetchJson: ConnectorFetch,
  listId: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<Task | null> =>
  fetchJson<Task>(
    `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
      signal,
    },
  );

export const tasksConnector: ConnectorReader = {
  id: 'tasks',
  readSignals: readTasksSignals,
};
