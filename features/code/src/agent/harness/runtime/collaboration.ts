/**
 * Multi-agent collaboration — a port of upstream Codex's multi-agent V2.
 *
 * Sources: `codex-rs/core/src/agent/{control,registry,role}.rs`,
 * `codex-rs/core/src/tools/handlers/multi_agents_{spec,common,v2}.rs`,
 * `codex-rs/core/src/session/multi_agents.rs`, and
 * `codex-rs/protocol/src/agent_path.rs`.
 *
 * ## What this replaces, and why it had to
 *
 * The harness previously had one tool called `task`. It started a helper, blocked
 * until the helper finished, and returned a paragraph. `task` does not exist
 * anywhere in codex-rs.
 *
 * That mattered most for Ultra. Ultra's entire effect is flipping delegation
 * from "only when asked" to "when it would help" — and upstream's own role
 * guidance says why that is worth anything:
 *
 *   "You are encouraged to spawn up multiple explorers in parallel… This allows
 *    you to get more information faster without waiting for one question to
 *    finish before asking the next. **While waiting for the explorer results,
 *    you can continue working on other local tasks that do not depend on those
 *    results.** This parallelism is a key advantage of delegation."
 *
 * A blocking `task` cannot do any of that. Ultra granted a permission the model
 * had no way to spend.
 *
 * ## The five things that make it work
 *
 * 1. **Spawning does not block.** `spawn_agent` starts the child and returns its
 *    canonical name immediately. The parent keeps writing code.
 * 2. **Agents have addresses.** `/root`, `/root/explore`, `/root/explore/deeper`.
 *    A parent may call its own child by its short name; anyone else needs the
 *    full path. That asymmetry is upstream's and lives in `agent-path.ts`.
 * 3. **Agents can spawn agents.** No depth limit in V2 — `collab_tools_enabled`
 *    only depth-limits V1. A child gets the same six tools its parent had.
 * 4. **Agents can be talked to while running.** `send_message` queues a note,
 *    `followup_task` queues a new job and wakes an idle agent, and
 *    `interrupt_agent` stops a turn without killing the agent.
 * 5. **`wait_agent` returns a summary, not content.** It tells you *which*
 *    agents have news. The news itself arrives as a message in your inbox. That
 *    is upstream's design and its description says so explicitly; a model that
 *    thinks `wait_agent` returns the answer will invent one.
 *
 * ## The one browser divergence
 *
 * Upstream's session outlives a turn, so a parent may finish while its children
 * keep working and the user watches them in the TUI. Willow has no such place
 * to watch: when `runTurn` resolves the composer unlocks and the turn is marked
 * done. Children still running would then rewrite the user's files *after* they
 * were told the work finished.
 *
 * So `drain()` holds the turn open until the tree is quiet. Spawning is still
 * non-blocking and the parallelism is real — the model delegates and carries on
 * exactly as upstream intends. Only the final turn boundary waits, which is the
 * difference between "the turn is still going" and "your files changed by
 * themselves".
 */

import {
  AGENT_ROLES,
  DEFAULT_MAX_CONCURRENT_AGENTS,
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
  MIN_WAIT_TIMEOUT_MS,
  type AgentRole,
} from '../overlay/collaboration-tools';
import {
  ROOT_PATH,
  agentPathName,
  isPathError,
  parentAgentPath,
  resolveAgentPath,
  slugifyAgentName,
  uniqueChildPath,
  validateAgentName,
} from './agent-path';
import {
  isFinalAgentStatus,
  type AgentStatus,
  type CallSink,
  type HarnessEvent,
  type IterationRunner,
  type SubAgent,
  type ToolCall,
  type ToolHandler,
  type ToolResult,
  type TurnGates,
} from './protocol';

/* ------------------------------------------------------------------------ */
/* The message envelope                                                      */
/* ------------------------------------------------------------------------ */

export type MessageType = 'NEW_TASK' | 'MESSAGE' | 'FINAL_ANSWER';

export interface Envelope {
  messageType: MessageType;
  /** Canonical path of the agent this is addressed to. */
  taskName: string;
  /** Canonical path of the agent that wrote it. */
  sender: string;
  payload: string;
}

/**
 * Renders an envelope in the format the role hints promise.
 *
 * Both usage hints tell the agent it will receive messages "in the analysis
 * channel in the form: Message Type: … / Task name: … / Sender: … / Payload:".
 * That promise has to be kept literally — an agent told to expect this shape
 * and handed loose prose has to guess who sent what.
 */
export function renderEnvelope(envelope: Envelope): string {
  return [
    `Message Type: ${envelope.messageType}`,
    `Task name: ${envelope.taskName}`,
    `Sender: ${envelope.sender}`,
    'Payload:',
    envelope.payload,
  ].join('\n');
}

/* ------------------------------------------------------------------------ */
/* Registry                                                                  */
/* ------------------------------------------------------------------------ */

type Conversation = { role: 'user' | 'assistant'; content: string }[];

interface AgentRecord {
  /** Canonical path. Also this record's key in the registry. */
  path: string;
  /** Display label, kept separate from the address. */
  nickname: string;
  role: AgentRole | null;
  status: AgentStatus;
  /** Aborts only the current turn; the agent survives and can be re-tasked. */
  controller: AbortController;
  /** Envelopes delivered to this agent, drained at its next turn boundary. */
  inbox: Envelope[];
  conversation: Conversation;
  /** The in-flight turn, when running. */
  run?: Promise<void>;
  /** Transcript card id. */
  uiId: string;
  lastTaskMessage: string;
  calls: ToolCall[];
  forkTurns: string;
}

export interface CollaborationDeps {
  /** Runs one streamed response. Supplied by `agent.ts`. */
  runIteration: IterationRunner;
  /** Builds the tool registry an agent at `path` should get. */
  buildRegistry: (
    collaborationTools: ToolHandler[],
    agentPath: string,
  ) => Map<string, ToolHandler>;
  /** The system prompt for an agent at `path`, including its role hint. */
  systemPromptFor: (agentPath: string) => string;
  /** A fresh project manifest, for an agent's opening message. */
  projectContext: () => string;
  /** Shrinks an assistant turn before it goes back as history. */
  compactForHistory: (raw: string) => string;
  onEvent: (event: HarnessEvent) => void;
  /** For the transcript footer on each agent card. */
  modelLabel: string;
  /** How many agents may run at once. Upstream's default is 4. */
  maxConcurrent?: number;
  /** Iteration bound for one agent turn. */
  maxIterations: number;
  gates: TurnGates;
  signal?: AbortSignal;
}

let counter = 0;
const nextUiId = (): string =>
  `agent_${Date.now().toString(36)}_${(counter += 1).toString(36)}`;

const statusToRunStatus = (status: AgentStatus): SubAgent['status'] => {
  switch (status.kind) {
    case 'running':
    case 'pending_init':
      return 'running';
    case 'completed':
      return 'success';
    case 'errored':
      return 'error';
    case 'interrupted':
    case 'shutdown':
      return 'cancelled';
    case 'not_found':
      return 'error';
  }
};

/** How `list_agents` and `interrupt_agent` serialise a status for the model. */
const serialiseStatus = (status: AgentStatus): unknown => {
  switch (status.kind) {
    case 'completed':
      return { completed: status.message };
    case 'errored':
      return { errored: status.message };
    default:
      return status.kind;
  }
};

export class CollaborationRuntime {
  /** Keyed by canonical path. The tree is encoded in the keys. */
  private readonly agents = new Map<string, AgentRecord>();
  /** Envelopes waiting for each agent, including `/root`. */
  private readonly mailboxes = new Map<string, Envelope[]>();
  /** Resolvers for `wait_agent` calls, keyed by the waiting agent's path. */
  private readonly waiters = new Map<string, Set<() => void>>();

  constructor(private readonly deps: CollaborationDeps) {}

  private get maxConcurrent(): number {
    return Math.max(1, this.deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_AGENTS);
  }

  /** Live agents, in creation order. */
  snapshot(): SubAgent[] {
    return [...this.agents.values()].map((record) => this.toSubAgent(record));
  }

  /** True while any agent's turn is in flight. */
  hasLiveAgents(): boolean {
    return [...this.agents.values()].some((record) => record.status.kind === 'running');
  }

  /**
   * Holds the turn open until the tree is quiet.
   *
   * The browser divergence described in the module comment. Loops rather than
   * awaiting once, because a draining agent can spawn another one — which is
   * legal, and which a single `Promise.all` would miss.
   */
  async drain(): Promise<void> {
    // A generous bound rather than `while (true)`: an agent that spawns a
    // replacement every time one finishes would otherwise hold the turn open
    // for as long as it kept doing it.
    for (let pass = 0; pass < 64; pass += 1) {
      const running = [...this.agents.values()]
        .map((record) => record.run)
        .filter((run): run is Promise<void> => Boolean(run));
      if (running.length === 0) return;
      await Promise.allSettled(running);
      for (const record of this.agents.values()) {
        if (record.status.kind !== 'running') record.run = undefined;
      }
    }
  }

  /** Aborts every agent. Called when the root turn is cancelled or fails. */
  cancelAll(): void {
    for (const record of this.agents.values()) {
      record.controller.abort();
    }
    for (const resolvers of this.waiters.values()) {
      for (const resolve of resolvers) resolve();
    }
    this.waiters.clear();
  }

  /* -------------------------------------------------------------------- */
  /* Tools                                                                 */
  /* -------------------------------------------------------------------- */

  /**
   * The six tools, bound to one caller.
   *
   * `callerPath` is what makes relative names work: `send_message` with
   * `target: "explore"` means a different agent depending on who called it.
   * `forkSource` is the caller's own conversation, which is what `fork_turns`
   * slices.
   */
  tools(callerPath: string, forkSource: () => Conversation): ToolHandler[] {
    return [
      this.spawnTool(callerPath, forkSource),
      this.sendMessageTool(callerPath),
      this.followupTool(callerPath),
      this.waitTool(callerPath),
      this.interruptTool(callerPath),
      this.listTool(callerPath),
    ];
  }

  private spawnTool(callerPath: string, forkSource: () => Conversation): ToolHandler {
    return {
      id: 'spawn_agent',
      run: async (args): Promise<ToolResult> => {
        const rawName = typeof args.task_name === 'string' ? args.task_name.trim() : '';
        const message = typeof args.message === 'string' ? args.message.trim() : '';

        if (!message) {
          return { observation: 'spawn_agent requires a "message".', failed: true };
        }
        if (!rawName) {
          return { observation: 'spawn_agent requires a "task_name".', failed: true };
        }

        /*
         * The name is validated, not coerced.
         *
         * Upstream rejects a bad `task_name` and lets the model retry, and the
         * schema tells it the rule ("lowercase letters, digits, and
         * underscores"). Silently slugifying would give the agent an address
         * the model did not ask for and would then fail to find.
         */
        const invalid = validateAgentName(rawName);
        if (invalid) return { observation: `spawn_agent: ${invalid}`, failed: true };

        const running = [...this.agents.values()].filter(
          (record) => record.status.kind === 'running',
        ).length;
        if (running >= this.maxConcurrent) {
          return {
            observation:
              `${running} agents are already running and the limit is ${this.maxConcurrent}. ` +
              'Call wait_agent to let one finish, or continue the work yourself.',
            failed: true,
          };
        }

        const role = this.resolveRole(args.agent_type);
        if (typeof role === 'string') return { observation: role, failed: true };

        const forkTurns = typeof args.fork_turns === 'string' ? args.fork_turns.trim() : 'all';
        const forked = forkConversation(forkSource(), forkTurns);
        if (forked === null) {
          return {
            observation:
              'fork_turns must be `none`, `all`, or a positive integer string such as `3`.',
            failed: true,
          };
        }

        // De-duplicated rather than rejected: two legitimate calls asking for
        // the same name need distinct addresses, not an error.
        const path = uniqueChildPath(callerPath, rawName, (candidate) =>
          this.agents.has(candidate),
        );

        const record: AgentRecord = {
          path,
          nickname: displayName(rawName),
          role: role ?? null,
          status: { kind: 'running' },
          controller: new AbortController(),
          inbox: [],
          conversation: forked,
          uiId: nextUiId(),
          lastTaskMessage: message,
          calls: [],
          forkTurns: forkTurns || 'all',
        };
        this.agents.set(path, record);
        this.mailboxes.set(path, []);
        this.deps.onEvent({ type: 'agents-start', agents: [this.toSubAgent(record)] });

        /*
         * Started, not awaited. This single line is the whole point of the
         * rewrite — the parent's next statement runs while the child works.
         *
         * The rejection is swallowed here because `runAgent` already converts
         * every outcome into a status and an envelope; an unhandled rejection
         * escaping a fire-and-forget promise would take down the tab.
         */
        record.run = this.runAgent(record, {
          messageType: 'NEW_TASK',
          taskName: path,
          sender: callerPath,
          payload: message,
        }).catch(() => {});

        return {
          observation: JSON.stringify({ task_name: path, nickname: record.nickname }),
        };
      },
    };
  }

  private sendMessageTool(callerPath: string): ToolHandler {
    return {
      id: 'send_message',
      run: async (args): Promise<ToolResult> => {
        const found = this.resolveTarget(callerPath, args.target);
        if (typeof found === 'string') return { observation: found, failed: true };

        const message = typeof args.message === 'string' ? args.message.trim() : '';
        if (!message) {
          return { observation: 'send_message requires a "message".', failed: true };
        }

        // "Does not trigger a new turn." An idle agent stays idle and reads
        // this the next time it is given something to do.
        this.deliver(found, {
          messageType: 'MESSAGE',
          taskName: found.path,
          sender: callerPath,
          payload: message,
        });

        return { observation: JSON.stringify({ delivered: true, target: found.path }) };
      },
    };
  }

  private followupTool(callerPath: string): ToolHandler {
    return {
      id: 'followup_task',
      run: async (args): Promise<ToolResult> => {
        const found = this.resolveTarget(callerPath, args.target);
        if (typeof found === 'string') return { observation: found, failed: true };

        const message = typeof args.message === 'string' ? args.message.trim() : '';
        if (!message) {
          return { observation: 'followup_task requires a "message".', failed: true };
        }
        // "an existing non-root target agent" — the root is the user's turn.
        if (found.path === ROOT_PATH) {
          return {
            observation: 'followup_task cannot target the root agent.',
            failed: true,
          };
        }

        const envelope: Envelope = {
          messageType: 'NEW_TASK',
          taskName: found.path,
          sender: callerPath,
          payload: message,
        };

        // Running: queue it, and the agent picks it up at its next turn
        // boundary. Idle: this is what wakes it.
        if (found.status.kind === 'running') {
          found.inbox.push(envelope);
          return {
            observation: JSON.stringify({ target: found.path, queued: true, status: 'running' }),
          };
        }

        found.controller = new AbortController();
        found.status = { kind: 'running' };
        found.lastTaskMessage = message;
        this.patchAgent(found, { status: 'running', endedAt: undefined, activity: undefined });
        found.run = this.runAgent(found, envelope).catch(() => {});

        return { observation: JSON.stringify({ target: found.path, status: 'running' }) };
      },
    };
  }

  private waitTool(callerPath: string): ToolHandler {
    return {
      id: 'wait_agent',
      run: async (args): Promise<ToolResult> => {
        const requested = Number(args.timeout_ms ?? DEFAULT_WAIT_TIMEOUT_MS);
        const timeoutMs = Number.isFinite(requested)
          ? Math.min(MAX_WAIT_TIMEOUT_MS, Math.max(MIN_WAIT_TIMEOUT_MS, requested))
          : DEFAULT_WAIT_TIMEOUT_MS;

        /*
         * A summary, never the content. Upstream's description is explicit:
         * "Does not return the content; returns either a summary of which
         * agents have updates (if any) … or a timeout summary".
         *
         * The content arrives as a message in the caller's next turn. Returning
         * it here would make the model believe one `wait_agent` call is the
         * whole conversation with its children.
         */
        const senders = (): string[] => {
          const mailbox = this.mailboxes.get(callerPath) ?? [];
          return [...new Set(mailbox.map((envelope) => envelope.sender))];
        };

        const summarise = (timedOut: boolean): ToolResult => {
          const waiting = senders();
          if (waiting.length > 0) {
            return {
              observation: JSON.stringify({
                message: `Updates waiting from: ${waiting.join(', ')}. They are delivered with your next message.`,
                timed_out: false,
              }),
            };
          }
          if (timedOut) {
            return {
              observation: JSON.stringify({
                message: `No agent activity within ${timeoutMs}ms.`,
                timed_out: true,
              }),
            };
          }
          return {
            observation: JSON.stringify({
              message: 'No live agents remain.',
              timed_out: false,
            }),
          };
        };

        if (senders().length > 0) return summarise(false);
        if (!this.hasLiveAgents()) return summarise(false);

        const timedOut = await this.waitForMailbox(callerPath, timeoutMs);
        return summarise(timedOut);
      },
    };
  }

  private interruptTool(callerPath: string): ToolHandler {
    return {
      id: 'interrupt_agent',
      run: async (args): Promise<ToolResult> => {
        const found = this.resolveTarget(callerPath, args.target);
        if (typeof found === 'string') return { observation: found, failed: true };

        const previous = serialiseStatus(found.status);

        /*
         * "The agent remains available for messages and follow-up tasks."
         *
         * So the turn is aborted but the record stays, and the status becomes
         * `interrupted` — which `is_final` deliberately treats as non-final.
         */
        found.controller.abort();
        if (found.status.kind === 'running') {
          found.status = { kind: 'interrupted' };
          this.patchAgent(found, { status: 'cancelled', activity: undefined });
        }

        return { observation: JSON.stringify({ previous_status: previous }) };
      },
    };
  }

  private listTool(callerPath: string): ToolHandler {
    return {
      id: 'list_agents',
      run: async (args): Promise<ToolResult> => {
        const rawPrefix = typeof args.path_prefix === 'string' ? args.path_prefix.trim() : '';
        let prefix = '';
        if (rawPrefix) {
          const resolved = resolveAgentPath(callerPath, rawPrefix);
          if (isPathError(resolved)) {
            return { observation: `list_agents: ${resolved.error}`, failed: true };
          }
          prefix = resolved;
        }

        const agents = [...this.agents.values()]
          .filter((record) => !prefix || record.path === prefix || record.path.startsWith(`${prefix}/`))
          .map((record) => ({
            agent_name: record.path,
            agent_status: serialiseStatus(record.status),
          }));

        return { observation: JSON.stringify({ agents }) };
      },
    };
  }

  /* -------------------------------------------------------------------- */
  /* Running one agent                                                     */
  /* -------------------------------------------------------------------- */

  /**
   * One agent's turn, start to finish.
   *
   * The agent gets the same six collaboration tools its parent had — that is
   * upstream's rule ("The spawned agent will have the same tools as you and the
   * ability to spawn its own subagents") and it is what makes the tree deeper
   * than one level.
   */
  private async runAgent(record: AgentRecord, task: Envelope): Promise<void> {
    const sink = this.agentSink(record);
    const registry = this.deps.buildRegistry(
      this.tools(record.path, () => record.conversation),
      record.path,
    );
    const systemPrompt = this.deps.systemPromptFor(record.path);

    record.conversation.push({
      role: 'user',
      content: `${this.deps.projectContext()}\n\n${renderEnvelope(task)}`,
    });

    let report = '';

    try {
      for (let step = 0; step < this.deps.maxIterations; step += 1) {
        if (record.controller.signal.aborted || this.deps.signal?.aborted) {
          throw new DOMException('interrupted', 'AbortError');
        }

        this.patchAgent(record, { progress: step / this.deps.maxIterations });

        const iteration = await this.deps.runIteration(
          record.conversation,
          systemPrompt,
          sink,
          registry,
          this.deps.gates,
        );
        report = iteration.text.trim() || report;

        const inbound = record.inbox.splice(0, record.inbox.length);
        if (!iteration.wantsMore && inbound.length === 0) break;

        record.conversation.push({
          role: 'assistant',
          content: this.deps.compactForHistory(iteration.raw),
        });

        // Observations and inbound messages arrive together, so a note sent
        // mid-turn is read at the very next boundary rather than at the end.
        const next = [
          ...iteration.observations,
          ...inbound.map(renderEnvelope),
        ].join('\n\n---\n\n');
        record.conversation.push({ role: 'user', content: next });
      }

      this.complete(record, { kind: 'completed', message: report || null }, report);
    } catch (error) {
      const aborted =
        record.controller.signal.aborted ||
        (error as Error)?.name === 'AbortError' ||
        (error as Error)?.name === 'Cancelled';

      if (aborted) {
        // Interrupted, not dead. It keeps its record and can be re-tasked.
        record.status = { kind: 'interrupted' };
        this.patchAgent(record, {
          status: 'cancelled',
          endedAt: Date.now(),
          activity: undefined,
        });
        this.notifyParent(record, 'MESSAGE', 'Interrupted before finishing.');
        return;
      }

      const message = (error as Error).message;
      this.complete(record, { kind: 'errored', message }, message);
    }
  }

  /** Records a final status, tells the UI, and posts the result to the parent. */
  private complete(record: AgentRecord, status: AgentStatus, result: string): void {
    record.status = status;
    record.run = undefined;
    this.patchAgent(record, {
      status: statusToRunStatus(status),
      agentStatus: status,
      endedAt: Date.now(),
      progress: 1,
      activity: undefined,
      result: result.slice(0, 400),
    });

    /*
     * "its final answer will be provided to you when it finishes."
     *
     * FINAL_ANSWER for a clean finish, MESSAGE for a failure — the sub-agent
     * hint documents both types, and a failure is not an answer.
     */
    this.notifyParent(
      record,
      status.kind === 'completed' ? 'FINAL_ANSWER' : 'MESSAGE',
      result || '(no output)',
    );
  }

  private notifyParent(record: AgentRecord, messageType: MessageType, payload: string): void {
    const parent = parentAgentPath(record.path);
    this.push(parent, { messageType, taskName: parent, sender: record.path, payload });
  }

  /** Delivers to a live agent's inbox *and* its mailbox. */
  private deliver(record: AgentRecord, envelope: Envelope): void {
    record.inbox.push(envelope);
    this.push(record.path, envelope);
  }

  /** Posts to a mailbox and wakes anyone waiting on it. */
  private push(path: string, envelope: Envelope): void {
    const mailbox = this.mailboxes.get(path) ?? [];
    mailbox.push(envelope);
    this.mailboxes.set(path, mailbox);

    // Only this path's waiters. Waking every waiter on any delivery is a busy
    // loop dressed up as an event.
    const resolvers = this.waiters.get(path);
    if (!resolvers) return;
    for (const resolve of resolvers) resolve();
    this.waiters.delete(path);
  }

  /** Drains and returns everything addressed to `path`. */
  takeMailbox(path: string): Envelope[] {
    const mailbox = this.mailboxes.get(path) ?? [];
    this.mailboxes.set(path, []);
    return mailbox;
  }

  private waitForMailbox(path: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (timedOut: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.get(path)?.delete(wake);
        resolve(timedOut);
      };

      const wake = (): void => finish(false);
      const timer = setTimeout(() => finish(true), timeoutMs);

      const resolvers = this.waiters.get(path) ?? new Set<() => void>();
      resolvers.add(wake);
      this.waiters.set(path, resolvers);
    });
  }

  /* -------------------------------------------------------------------- */
  /* Helpers                                                               */
  /* -------------------------------------------------------------------- */

  /** Resolves a model-supplied target, or returns the message to hand back. */
  private resolveTarget(callerPath: string, target: unknown): AgentRecord | string {
    const raw = typeof target === 'string' ? target.trim() : '';
    if (!raw) return 'a "target" is required: a relative or canonical task name.';

    const resolved = resolveAgentPath(callerPath, raw);
    if (isPathError(resolved)) return resolved.error;

    const record = this.agents.get(resolved);
    if (record) return record;

    // Upstream's message, from `resolve_agent_reference`.
    return `live agent path \`${resolved}\` not found`;
  }

  /** Validates `agent_type` against the roles that exist. */
  private resolveRole(value: unknown): AgentRole | null | string {
    if (value === undefined || value === null || value === '') return null;
    const raw = String(value).trim().toLowerCase();
    if ((AGENT_ROLES as readonly string[]).includes(raw)) return raw as AgentRole;
    return `agent_type must be one of: ${AGENT_ROLES.join(', ')}.`;
  }

  private toSubAgent(record: AgentRecord): SubAgent {
    return {
      id: record.uiId,
      path: record.path,
      name: agentPathName(record.path),
      parentPath: parentAgentPath(record.path),
      kind: record.role ?? 'agent',
      objective: record.lastTaskMessage,
      status: statusToRunStatus(record.status),
      agentStatus: record.status,
      startedAt: Date.now(),
      progress: 0,
      calls: record.calls,
      model: this.deps.modelLabel,
      tokensUsed: 0,
      forkTurns: record.forkTurns,
    };
  }

  private patchAgent(record: AgentRecord, patch: Partial<SubAgent>): void {
    this.deps.onEvent({ type: 'agent-progress', id: record.uiId, patch });
  }

  /** Where one agent's output goes: its own card, never the main transcript. */
  private agentSink(record: AgentRecord): CallSink {
    return {
      // An agent's prose is its reasoning, not the user's answer.
      onText: () => {},
      onThought: () => {},
      emit: (call) => {
        record.calls = [...record.calls, call];
        this.patchAgent(record, { calls: record.calls });
        return call.id;
      },
      patch: (id, patch) => {
        record.calls = record.calls.map((call) =>
          call.id === id ? ({ ...call, ...patch } as ToolCall) : call,
        );
        this.patchAgent(record, { calls: record.calls });
      },
      activity: (label) => this.patchAgent(record, { activity: label ?? undefined }),
    };
  }
}

/* ------------------------------------------------------------------------ */
/* fork_turns                                                               */
/* ------------------------------------------------------------------------ */

/**
 * `fork_turns` — how much of the parent's conversation a child inherits.
 *
 * `all` (the default) copies everything, `none` starts the child clean, and a
 * positive integer keeps that many trailing turns. Returns `null` for a value
 * that is none of those, so the model gets told rather than silently receiving
 * a full fork it did not ask for.
 *
 * A "turn" is a user/assistant pair, which is why the count is doubled.
 * Upstream's own tool description warns what the extremes cost: `none` "may
 * cause the agent to lack the context it needs", `all` gives it everything.
 */
export function forkConversation(
  source: Conversation,
  forkTurns: string | undefined,
): Conversation | null {
  const mode = (forkTurns ?? 'all').trim().toLowerCase();
  if (mode === '' || mode === 'all') return source.map((entry) => ({ ...entry }));
  if (mode === 'none') return [];

  if (!/^\d+$/.test(mode)) return null;
  const turns = Number.parseInt(mode, 10);
  if (turns <= 0) return null;

  return source.slice(-turns * 2).map((entry) => ({ ...entry }));
}

/** A human label from an identifier segment: `read_files` → `Read files`. */
function displayName(raw: string): string {
  const slug = slugifyAgentName(raw);
  const spaced = slug.replace(/_+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : 'Agent';
}

export { isFinalAgentStatus };
