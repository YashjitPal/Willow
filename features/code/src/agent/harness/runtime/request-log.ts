/**
 * A record of every model request the harness makes.
 *
 * A turn is not one request. It is a fresh request per round — the model
 * answers, the harness runs what it asked for, and the whole conversation goes
 * back up for the next round. So a pause between two paragraphs is not the
 * model thinking mid-sentence; it is a new request being made, queued, and
 * waiting on its first token.
 *
 * That distinction is invisible from the outside, which is why this exists.
 * Each entry separates *waiting for the endpoint* (time to first token) from
 * *receiving the answer* (first token to last), so a slow provider and a large
 * prompt look different rather than both looking like "it hung".
 *
 * The API key is never recorded. Neither is message content — sizes only. A log
 * that copies the transcript is a second place for a user's code to leak from,
 * and the sizes are what actually explain the timings.
 */

import { atom } from 'nanostores';

export interface RequestLogEntry {
  kind: 'request';
  id: string;
  /** Wall-clock start, for correlating with anything else the user saw. */
  startedAt: number;
  provider: string;
  model: string;
  /** What was asked for, after clamping. */
  reasoningEffort?: string;
  thinkingLevel?: number;
  /** Host only — never the key, never the full URL with query. */
  endpoint?: string;

  /** Prompt size, which is what grows across a turn and slows each round. */
  systemChars: number;
  messageCount: number;
  promptChars: number;

  /** Milliseconds from request start to the first token. Endpoint latency. */
  firstTokenMs?: number;
  /** Milliseconds from request start to completion. */
  totalMs?: number;
  /** How much came back. */
  responseChars: number;
  tokenEvents: number;

  status: 'running' | 'ok' | 'error' | 'aborted';
  error?: { name: string; message: string };
}

/**
 * A tool execution, timed the same way.
 *
 * Without these the log has a blind spot exactly where the harness spends time
 * that is not a model request. A turn showed a two-minute gap between two
 * rounds with nothing in flight, and no way to tell whether that was a slow
 * tool, a preview rebuild, or the user reading — `computer_use` in particular
 * drives its own model session that never passes through this transport.
 */
export interface ToolLogEntry {
  kind: 'tool';
  id: string;
  startedAt: number;
  /** Tool name, e.g. `computer_use`. Arguments are not recorded. */
  name: string;
  totalMs?: number;
  status: 'running' | 'ok' | 'error';
  error?: { name: string; message: string };
}

export type LogEntry = RequestLogEntry | ToolLogEntry;

/* ---------------------------------------------------------------------- */
/* Persistence                                                             */
/* ---------------------------------------------------------------------- */

const STORAGE_KEY = 'willow:code:agent-requests';

/**
 * Where finished entries are appended during dev.
 *
 * Served by `agentRequestLog` in the Vite config, which writes to
 * `.agent/requests.jsonl`. In the browser a long turn is dozens of console
 * groups and a reload loses all of them; a file can just be read afterwards.
 */
const SINK_URL = '/__agent/log';

function loadStored(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStored(entries: LogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* Quota or private mode. The in-memory log still works. */
  }
}

/**
 * Appends one finished entry to the file.
 *
 * Fire-and-forget and silent on failure: logging must never be able to break or
 * slow the turn it is describing. `keepalive` lets the last request of a
 * session survive the page going away.
 */
function appendToFile(entry: LogEntry): void {
  if (typeof fetch !== 'function') return;
  try {
    void fetch(SINK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* No dev server, or the endpoint is not mounted. */
  }
}

/* ---------------------------------------------------------------------- */

/** Most recent last. Bounded, because a long session would otherwise grow without limit. */
export const requestLog = atom<LogEntry[]>(
  typeof window === 'undefined' ? [] : loadStored(),
);

const LIMIT = 200;

function record(entry: LogEntry): void {
  const next = [...requestLog.get(), entry];
  requestLog.set(next.length > LIMIT ? next.slice(next.length - LIMIT) : next);
}

/**
 * Persists an entry once it has finished.
 *
 * Only on completion, not on creation: an in-flight request has no timings, and
 * writing it twice would put a `running` line in the file that is contradicted
 * two lines later.
 */
function persist(entry: LogEntry): void {
  if (typeof window === 'undefined') return;
  saveStored(requestLog.get());
  appendToFile(entry);
}

/** Generic in the entry kind, so each caller keeps its own status union. */
function update<T extends LogEntry>(id: string, patch: Partial<T>): T | undefined {
  const all = requestLog.get();
  const index = all.findIndex((entry) => entry.id === id);
  if (index === -1) return undefined;

  const merged = { ...all[index]!, ...patch } as T;
  const next = [...all];
  next[index] = merged;
  requestLog.set(next);
  return merged;
}

let counter = 0;
const nextId = (): string => `req_${Date.now().toString(36)}_${(counter += 1).toString(36)}`;

/**
 * Console output, in the browser only.
 *
 * Tests drive the same transport and would otherwise fill their output with
 * request chatter that says nothing about the assertion that failed.
 */
const canLog = (): boolean => typeof window !== 'undefined' && typeof console !== 'undefined';

const ms = (value: number | undefined): string =>
  value === undefined ? '—' : value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;

function announce(entry: RequestLogEntry): void {
  if (!canLog()) return;

  const headline =
    `%c[agent] ${entry.provider}/${entry.model} ` +
    `· ${entry.status} · first token ${ms(entry.firstTokenMs)} · total ${ms(entry.totalMs)}`;
  const colour =
    entry.status === 'error' ? 'color:#f2555a' : entry.status === 'aborted' ? 'color:#c9a227' : 'color:#7c9';

  // Collapsed: one line per request until something is worth opening.
  console.groupCollapsed(headline, colour);
  console.log('prompt', {
    systemChars: entry.systemChars,
    messages: entry.messageCount,
    promptChars: entry.promptChars,
    effort: entry.reasoningEffort,
    thinkingLevel: entry.thinkingLevel,
    endpoint: entry.endpoint,
  });
  console.log('response', {
    chars: entry.responseChars,
    tokenEvents: entry.tokenEvents,
    firstTokenMs: entry.firstTokenMs,
    totalMs: entry.totalMs,
  });
  if (entry.error) console.error(entry.error.name, entry.error.message);
  console.groupEnd();
}

/** Host of a base URL, for identifying a relay without exposing a full URL. */
function hostOf(baseUrl: unknown): string | undefined {
  if (typeof baseUrl !== 'string' || baseUrl === '') return undefined;
  try {
    return new URL(baseUrl).host;
  } catch {
    return undefined;
  }
}

/**
 * Wraps a transport so every call it makes is timed and recorded.
 *
 * A wrapper rather than logging inside the turn loop, because the loop is not
 * the only caller: sub-agents run their own requests through the same path, and
 * those are exactly the ones you cannot otherwise account for.
 */
export function instrumentTransport<T extends (...args: never[]) => Promise<unknown>>(
  transport: T,
): T {
  const wrapped = async (...args: unknown[]) => {
    const [messages, options, onToken, onStart, systemPrompt, ...rest] = args as [
      { role: string; content: string }[],
      Record<string, unknown>,
      (token: string) => void,
      () => void,
      string,
      ...unknown[],
    ];

    const id = nextId();
    const started = Date.now();

    const entry: RequestLogEntry = {
      kind: 'request',
      id,
      startedAt: started,
      provider: String(options?.provider ?? 'unknown'),
      model: String(options?.model ?? 'unknown'),
      reasoningEffort: options?.reasoningEffort as string | undefined,
      thinkingLevel: options?.thinkingLevel as number | undefined,
      endpoint: hostOf(options?.baseUrl),
      systemChars: systemPrompt?.length ?? 0,
      messageCount: messages?.length ?? 0,
      promptChars: (messages ?? []).reduce((sum, m) => sum + (m.content?.length ?? 0), 0),
      responseChars: 0,
      tokenEvents: 0,
      status: 'running',
    };
    record(entry);

    let firstTokenAt: number | undefined;
    let responseChars = 0;
    let tokenEvents = 0;

    const timedToken = (token: string) => {
      if (firstTokenAt === undefined) firstTokenAt = Date.now();
      responseChars += token.length;
      tokenEvents += 1;
      onToken(token);
    };

    try {
      const result = await (transport as unknown as (...a: unknown[]) => Promise<unknown>)(
        messages,
        options,
        timedToken,
        onStart,
        systemPrompt,
        ...rest,
      );

      const done = update<RequestLogEntry>(id, {
        status: 'ok',
        firstTokenMs: firstTokenAt === undefined ? undefined : firstTokenAt - started,
        totalMs: Date.now() - started,
        responseChars,
        tokenEvents,
      })!;
      announce(done);
      persist(done);
      return result;
    } catch (error) {
      const err = error as Error;
      // An abort is the user pressing stop, not a failure. Logged distinctly so
      // a session full of cancellations does not read as a session full of
      // errors.
      const aborted =
        err?.name === 'AbortError' || (options?.signal as AbortSignal | undefined)?.aborted;

      const failed = update<RequestLogEntry>(id, {
        status: aborted ? 'aborted' : 'error',
        firstTokenMs: firstTokenAt === undefined ? undefined : firstTokenAt - started,
        totalMs: Date.now() - started,
        responseChars,
        tokenEvents,
        error: { name: err?.name ?? 'Error', message: err?.message ?? String(error) },
      })!;
      announce(failed);
      persist(failed);
      throw error;
    }
  };

  return wrapped as unknown as T;
}

/**
 * Times one tool execution.
 *
 * Returns the finisher rather than taking a callback so the caller keeps its
 * own control flow — `runCall` already has error handling that must not change
 * shape just to be measured.
 */
export function beginToolLog(name: string): (error?: unknown) => void {
  const id = nextId();
  const started = Date.now();

  record({ kind: 'tool', id, startedAt: started, name, status: 'running' });

  return (error?: unknown) => {
    const err = error as Error | undefined;
    const entry = update<ToolLogEntry>(id, {
      status: error ? 'error' : 'ok',
      totalMs: Date.now() - started,
      error: error
        ? { name: err?.name ?? 'Error', message: err?.message ?? String(error) }
        : undefined,
    });
    if (!entry) return;

    if (canLog()) {
      const tool = entry;
      // eslint-disable-next-line no-console
      console.log(
        `%c[agent] tool ${tool.name} · ${tool.status} · ${ms(tool.totalMs)}`,
        tool.status === 'error' ? 'color:#f2555a' : 'color:#89a',
      );
    }
    persist(entry);
  };
}

/** Everything recorded so far, for pasting into a bug report. */
export function dumpRequestLog(): string {
  return JSON.stringify(requestLog.get(), null, 2);
}

/** Clears the in-memory log, what is stored, and the file behind it. */
export function clearRequestLog(): void {
  requestLog.set([]);
  if (typeof window === 'undefined') return;
  saveStored([]);
  try {
    void fetch(SINK_URL, { method: 'DELETE' }).catch(() => {});
  } catch {
    /* No dev server. */
  }
}
