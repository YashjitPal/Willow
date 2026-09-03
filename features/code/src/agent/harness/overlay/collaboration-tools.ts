/**
 * The six collaboration tools, as upstream describes them to the model.
 *
 * A transcription of `codex-rs/core/src/tools/handlers/multi_agents_spec.rs`
 * (the `*_v2` variants) and the usage hints from
 * `codex-rs/core/src/session/multi_agents.rs`. Every string the model reads is
 * upstream's; nothing here is written for Willow.
 *
 * ## Why the descriptions are copied rather than summarised
 *
 * These are not blurbs. `spawn_agent`'s description is the *only* place the
 * addressing rule is explained — that a child of `/root/task1` named `task_3`
 * is `/root/task1/task_3`, that its parent may call it either name, and that a
 * cousin must use the full path. A model that has not read that sentence
 * cannot use `send_message` correctly, because it will guess the wrong target.
 *
 * The same is true of `wait_agent`: its description is where the model learns
 * that the call returns *a summary of which agents have updates*, not the
 * content. Paraphrase it and the model waits, receives a summary, assumes it
 * has the answer, and invents the rest.
 *
 * ## The two role hints
 *
 * `ROOT_USAGE_HINT` and `SUBAGENT_USAGE_HINT` are
 * `DEFAULT_MULTI_AGENT_V2_{ROOT_AGENT,SUBAGENT}_USAGE_HINT_TEXT`. They are the
 * documents that tell an agent who it is and what the message envelope looks
 * like, and they are the reason a sub-agent knows it may spawn its own
 * sub-agents. Upstream sends one or the other depending on whether the agent is
 * the root.
 */

/* ------------------------------------------------------------------------ */
/* Limits, verified against codex-rs/core/src/config/mod.rs                  */
/* ------------------------------------------------------------------------ */

/** `DEFAULT_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION`. */
export const DEFAULT_MAX_CONCURRENT_AGENTS = 4;

/** `DEFAULT_WAIT_TIMEOUT_MS`, `MIN_WAIT_TIMEOUT_MS`, `MAX_WAIT_TIMEOUT_MS`. */
export const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
export const MIN_WAIT_TIMEOUT_MS = 10_000;
export const MAX_WAIT_TIMEOUT_MS = 3_600_000;

/**
 * Upstream namespaces these six under `collaboration`
 * (`DEFAULT_MULTI_AGENT_V2_TOOL_NAMESPACE`), so the model calls
 * `functions.collaboration.spawn_agent`.
 *
 * Willow's harness has no tool namespaces — every tool is a bare name in a
 * `*** Call:` envelope — so the names are used unqualified. The namespace is
 * recorded here because upstream's shared usage hint refers to it by name, and
 * that sentence is dropped rather than reproduced with a namespace that does
 * not exist here.
 */
export const COLLABORATION_NAMESPACE = 'collaboration';

/* ------------------------------------------------------------------------ */
/* Tool descriptions, verbatim                                               */
/* ------------------------------------------------------------------------ */

/** `spawn_agent_tool_description_v2`, without the model-override guidance. */
export const SPAWN_AGENT_DESCRIPTION = `Spawns an agent to work on the specified task. If your current task is \`/root/task1\` and you spawn_agent with task_name "task_3" the agent will have canonical task name \`/root/task1/task_3\`.
You are then able to refer to this agent as \`task_3\` or \`/root/task1/task_3\` interchangeably. However an agent \`/root/task2/task_3\` would only be able to communicate with this agent via its canonical name \`/root/task1/task_3\`.
The spawned agent will have the same tools as you and the ability to spawn its own subagents.
Only call this tool for a concrete, bounded subtask that can run independently alongside useful local work; otherwise continue locally.
It will be able to send you and other running agents messages, and its final answer will be provided to you when it finishes.
The new agent's canonical task name will be provided to it along with the message.

Note that passing \`fork_turns="none"\` will not pass any surrounding context to the spawned subagent, which may cause the agent to lack the context it needs to complete its task, whereas \`fork_turns="all"\` will provide the subagent with all surrounding context.`;

/** `create_send_message_tool`. */
export const SEND_MESSAGE_DESCRIPTION =
  'Send a message to an existing agent. The message will be delivered promptly. ' +
  'Does not trigger a new turn.';

/** `create_followup_task_tool`. */
export const FOLLOWUP_TASK_DESCRIPTION =
  'Send a follow-up task to an existing non-root target agent and trigger a turn ' +
  'if it is idle. If the target is already running, deliver the task promptly at ' +
  'message boundaries while sampling, or after the pending tool call completes.';

/** `create_wait_agent_tool_v2`. */
export const WAIT_AGENT_DESCRIPTION =
  'Wait for a mailbox update from any live agent, including queued messages and ' +
  'final-status notifications. The wait also ends early when new user input is ' +
  'steered into the active turn. Does not return the content; returns either a ' +
  'summary of which agents have updates (if any), an interruption summary for ' +
  'steered input, or a timeout summary if no activity arrives before the deadline.';

/** `create_interrupt_agent_tool_v2`. */
export const INTERRUPT_AGENT_DESCRIPTION =
  "Interrupt an agent's current turn, if any, and return its previous status. The " +
  'agent remains available for messages and follow-up tasks.';

/** `create_list_agents_tool`. */
export const LIST_AGENTS_DESCRIPTION =
  'List live agents in the current root thread tree. Optionally filter by ' +
  'task-path prefix.';

/* ------------------------------------------------------------------------ */
/* Parameter descriptions, verbatim                                          */
/* ------------------------------------------------------------------------ */

export const PARAM_DESCRIPTIONS = {
  task_name:
    'Task name for the new agent. Use lowercase letters, digits, and underscores.',
  message: 'Initial plain-text task for the new agent.',
  agent_type:
    'Agent type override for the new agent. Omit unless explicitly asked. The ' +
    'selected role applies regardless of how much parent history is inherited.',
  fork_turns:
    'Optional number of turns to fork. Defaults to `all`. Use `none`, `all`, or a ' +
    'positive integer string such as `3` to fork only the most recent turns.',
  send_message_target: 'Relative or canonical task name to message (from spawn_agent).',
  send_message_message: 'Message text to queue on the target agent.',
  followup_target:
    'Agent id or canonical task name to send a follow-up task to (from spawn_agent).',
  followup_message: 'Message text to send to the target agent.',
  interrupt_target: 'Agent id or canonical task name to interrupt (from spawn_agent).',
  path_prefix:
    'Task-path prefix filter without a trailing slash. Omit to list all live agents.',
  timeout_ms:
    `Timeout in milliseconds. Defaults to ${DEFAULT_WAIT_TIMEOUT_MS}, ` +
    `min ${MIN_WAIT_TIMEOUT_MS}, max ${MAX_WAIT_TIMEOUT_MS}.`,
} as const;

/* ------------------------------------------------------------------------ */
/* Role usage hints, verbatim                                                */
/* ------------------------------------------------------------------------ */

/**
 * `DEFAULT_MULTI_AGENT_V2_ROOT_AGENT_USAGE_HINT_TEXT`.
 *
 * The `fork_turns` sentence and the message-envelope block are the load-bearing
 * parts: the envelope is the format the runtime actually delivers messages in,
 * so this text and `collaboration.ts` have to agree.
 */
export const ROOT_USAGE_HINT = `You are \`/root\`, the primary agent in a team of agents collaborating to fulfill the user's goals.

At the start of your turn, you are the active agent.
You can spawn sub-agents to handle subtasks, and those sub-agents can spawn their own sub-agents.
All agents in the team, including the agents that you can assign tasks to, are equally intelligent and capable, and have access to the same set of tools.

You can use \`spawn_agent\` to create a new agent, \`followup_task\` to give an existing agent a new task and trigger a turn, and \`send_message\` to pass a message to a running agent without triggering a turn.
Child agents can also spawn their own sub-agents.
You can decide how much context you want to propagate to your sub-agents with the \`fork_turns\` parameter.

You will receive messages in the analysis channel in the form:
\`\`\`
Message Type: MESSAGE | FINAL_ANSWER
Task name: <recipient>
Sender: <author>
Payload:
<payload text>
\`\`\`
They may be addressed as to=/root`;

/** `DEFAULT_MULTI_AGENT_V2_SUBAGENT_USAGE_HINT_TEXT`. */
export const SUBAGENT_USAGE_HINT = `You are an agent in a team of agents collaborating to complete a task.

You can spawn sub-agents to handle subtasks, and those sub-agents can spawn their own sub-agents. All agents in the team, including the agents that you can assign tasks to, are equally intelligent and capable, and have access to the same set of tools.

You can use \`spawn_agent\` to create a new agent, \`followup_task\` to give an existing agent a new task and trigger a turn, and \`send_message\` to pass a message to a running agent.
Child agents can also spawn their own sub-agents.

When you provide a response in the final channel, that content is immediately delivered back to your parent agent.

You will receive messages in the analysis channel in the form:
\`\`\`
Message Type: NEW_TASK | MESSAGE | FINAL_ANSWER
Task name: <recipient>
Sender: <author>
Payload:
<payload text>
\`\`\`
You may also see them addressed as to=/root/..., which indicates your identity is /root/...`;

/** `DEFAULT_MULTI_AGENT_V2_WAIT_AGENT_USAGE_HINT_TEXT`. */
export const WAIT_AGENT_USAGE_HINT =
  'When calling `wait_agent`, prefer longer waits (minutes) to avoid busy polling.';

/**
 * `DEFAULT_MULTI_AGENT_V2_SHARED_USAGE_HINT_TEXT`, minus its first paragraph.
 *
 * That paragraph is about `functions.exec` and tool namespaces, neither of which
 * exists here — reproducing it would tell the model to address tools in a form
 * this harness cannot parse. The filesystem paragraph is kept because it is
 * true and load-bearing: all agents share one project, so an edit by one is
 * immediately visible to the rest, and that is what makes delegation coherent.
 */
export const SHARED_USAGE_HINT = `All agents share the same project files. In detail:
- All agents have access to the same project as you.
- All agents see the same file tree.
- As a result, edits made by one agent are immediately visible to all other agents.`;

/**
 * The agent roles upstream ships as built-ins.
 *
 * Upstream has exactly two role configs in `core/assets/agent/builtins/`:
 * `explorer.toml` and `awaiter.toml`. `agent_type` is a free string validated
 * against whatever roles are configured, and the description below is
 * upstream's own for `explorer` — the only one with model-facing guidance.
 *
 * Willow ships `explorer` alone. `awaiter` exists upstream to babysit a
 * long-running shell command until it terminates, and there is no such thing in
 * a browser sandbox, so offering it would be offering a role that cannot do its
 * job.
 */
export const AGENT_ROLES = ['explorer'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Upstream's `explorer` guidance, from `role.rs`. */
export const AGENT_TYPE_DESCRIPTION = `Use \`explorer\` for specific codebase questions.
- In order to avoid redundant work, you should avoid exploring the same problem that explorers have already covered. Typically, you should trust the explorer results without additional verification. You are still allowed to inspect the code yourself to gain the needed context!
- You are encouraged to spawn up multiple explorers in parallel when you have multiple distinct questions to ask about the codebase that can be answered independently. This allows you to get more information faster without waiting for one question to finish before asking the next. While waiting for the explorer results, you can continue working on other local tasks that do not depend on those results. This parallelism is a key advantage of delegation, so use it whenever you have multiple questions to ask.
- Reuse existing explorers for related questions.`;
