/**
 * ChatKit-style chat sessions: mint client secrets bound to a workflow (+
 * pinned version + injected state variables), manage threads, and run one
 * workflow execution per user turn with rolling conversation history.
 */

import type { AppConfig } from '../config.ts';
import type {
  ChatSession,
  ChatThread,
  ChatThreadMessage,
  JsonObject,
  ProviderKeys,
  Run,
} from '../domain/types.ts';
import type { RunEngine } from '../engine/executor.ts';
import type { EngineCheckpoint } from '../engine/context.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { ids, nowIso } from '../util/id.ts';

export class ChatService {
  private storage: Storage;
  private engine: RunEngine;
  private config: AppConfig;

  constructor(storage: Storage, engine: RunEngine, config: AppConfig) {
    this.storage = storage;
    this.engine = engine;
    this.config = config;
  }

  async createSession(input: {
    workflowId: string;
    /** 0 = draft, -1/undefined = latest published (falls back to draft when unpublished). */
    version?: number;
    user: string;
    stateVariables?: JsonObject;
    expiresAfterSeconds?: number;
  }): Promise<ChatSession> {
    const wf = await this.storage.get<{ latestVersion: number }>(
      COLLECTIONS.workflows,
      input.workflowId,
    );
    if (!wf) throw new Error(`workflow '${input.workflowId}' not found`);
    let version = input.version ?? -1;
    if (version === -1) version = wf.latestVersion > 0 ? wf.latestVersion : 0;

    const ttl = Math.min(
      Math.max(60, input.expiresAfterSeconds ?? this.config.sessionTtlSeconds),
      24 * 3600,
    );
    const session: ChatSession = {
      id: ids.session(),
      workflowId: input.workflowId,
      workflowVersion: version,
      user: input.user || 'anonymous',
      stateVariables: input.stateVariables,
      clientSecret: ids.secret(),
      status: 'active',
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      createdAt: nowIso(),
    };
    await this.storage.put(COLLECTIONS.sessions, session.id, session, input.workflowId);
    return session;
  }

  async getSession(id: string): Promise<ChatSession | undefined> {
    return this.storage.get<ChatSession>(COLLECTIONS.sessions, id);
  }

  async requireActiveSession(idOrSecret: string): Promise<ChatSession> {
    let session = await this.getSession(idOrSecret);
    if (!session) {
      // allow lookup by client secret
      const all = await this.storage.list<ChatSession>(COLLECTIONS.sessions);
      session = all.map((r) => r.doc).find((s) => s.clientSecret === idOrSecret);
    }
    if (!session) throw new Error('session not found');
    if (session.status !== 'active') throw new Error(`session is ${session.status}`);
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      session.status = 'expired';
      await this.storage.put(COLLECTIONS.sessions, session.id, session, session.workflowId);
      throw new Error('session is expired');
    }
    return session;
  }

  async cancelSession(id: string): Promise<ChatSession | undefined> {
    const session = await this.getSession(id);
    if (!session) return undefined;
    session.status = 'cancelled';
    await this.storage.put(COLLECTIONS.sessions, session.id, session, session.workflowId);
    return session;
  }

  async createThread(sessionId: string): Promise<ChatThread> {
    const session = await this.requireActiveSession(sessionId);
    const thread: ChatThread = {
      id: ids.thread(),
      sessionId: session.id,
      workflowId: session.workflowId,
      messages: [],
      state: session.stateVariables ? structuredClone(session.stateVariables) : undefined,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.storage.put(COLLECTIONS.threads, thread.id, thread, session.id);
    return thread;
  }

  async listThreads(sessionId: string): Promise<ChatThread[]> {
    const rows = await this.storage.list<ChatThread>(COLLECTIONS.threads, { ref: sessionId });
    return rows.map((r) => r.doc);
  }

  async getThread(threadId: string): Promise<ChatThread | undefined> {
    return this.storage.get<ChatThread>(COLLECTIONS.threads, threadId);
  }

  /**
   * One chat turn: append the user message, launch a run seeded with the
   * thread's history + rolling state, and finalize the thread when the run
   * settles. Returns the run (stream events via /runs/:id/events).
   */
  async sendMessage(
    threadId: string,
    text: string,
    requestKeys?: ProviderKeys,
  ): Promise<{ thread: ChatThread; run: Run }> {
    const thread = await this.getThread(threadId);
    if (!thread) throw new Error(`thread '${threadId}' not found`);
    const session = await this.requireActiveSession(thread.sessionId);

    // One turn at a time per thread: a concurrent second message would fork
    // the conversation state (its run seeds from pre-turn history/state).
    const lastUser = [...thread.messages].reverse().find((m) => m.role === 'user');
    if (lastUser?.runId) {
      const prior = await this.engine.getRun(lastUser.runId);
      if (
        prior &&
        ['queued', 'running', 'awaiting_approval', 'awaiting_client_tool'].includes(prior.status)
      ) {
        throw new Error(
          `previous turn is still in progress (run ${prior.id}, status ${prior.status}); ` +
          `wait for it to settle or cancel it first`,
        );
      }
    }

    const userMsg: ChatThreadMessage = {
      id: ids.message(),
      role: 'user',
      content: text,
      at: nowIso(),
    };

    const priorHistory = thread.messages.map((m) => ({
      role: m.role,
      content: m.content,
      at: m.at,
    }));

    const run = await this.engine.createRun({
      workflowId: session.workflowId,
      version: session.workflowVersion,
      sessionId: session.id,
      requestKeys,
      input: {
        input_as_text: text,
        history: priorHistory,
        state_variables: thread.state ?? session.stateVariables,
      },
    });

    userMsg.runId = run.id;
    thread.messages.push(userMsg);
    thread.updatedAt = nowIso();
    await this.storage.put(COLLECTIONS.threads, thread.id, thread, session.id);

    // Finalize the thread when the run settles (fire-and-forget).
    const unsubscribe = this.engine.subscribe(run.id, (event) => {
      if (
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled'
      ) {
        unsubscribe();
        void this.finalizeTurn(thread.id, run.id, event.type === 'run.completed');
      }
    });

    return { thread, run };
  }

  private async finalizeTurn(threadId: string, runId: string, ok: boolean): Promise<void> {
    try {
      const thread = await this.getThread(threadId);
      const run = await this.engine.getRun(runId);
      if (!thread || !run) return;

      let content: string;
      if (ok) {
        content =
          typeof run.output === 'string' ? run.output : JSON.stringify(run.output ?? null);
      } else {
        content = `(run ${run.status}${run.error ? `: ${run.error}` : ''})`;
      }
      thread.messages.push({
        id: ids.message(),
        role: 'assistant',
        content,
        runId,
        at: nowIso(),
      });
      // roll state forward for the next turn
      const cp = run.checkpoint as unknown as EngineCheckpoint | undefined;
      if (run.state && Object.keys(run.state).length) {
        thread.state = structuredClone(run.state);
      } else if (cp?.state && Object.keys(cp.state).length) {
        thread.state = structuredClone(cp.state);
      }
      thread.updatedAt = nowIso();
      await this.storage.put(COLLECTIONS.threads, thread.id, thread, thread.sessionId);
    } catch { /* best-effort */ }
  }
}
