/**
 * Spark tasks as a bot's visible delegation.
 *
 * A task a bot assigns is an ordinary Spark task: it appears in Spark's lists
 * marked "Assigned by <bot>", the user can open, follow and steer it, and it
 * runs through Spark's own runner via the task host — so it survives a closed
 * tab and is taken over by another tab like any other. The runtime watches the
 * bot's tasks and wakes the bot when one finishes or needs input, which is why
 * there is no blocking "wait" tool: the bot ends its turn and is told.
 */
import { ensureSparkTaskBodyLoaded, getSparkTaskById } from '../../../spark-store';
import type { SparkTask } from '../../../spark-types';
import { formatAgo } from '../memory/render';
import { getDotThread, updateDotRuntime } from '../thread/thread-store';
import type { DotDelegation } from '../thread/thread-types';
import { fail, ok, stringArg, type DotToolEntry, type DotToolEnv } from './tool-env';

const RESPONSE_PAGE_CHARS = 6_000;

export const latestSparkResponse = (task: SparkTask): string => {
  for (let index = (task.turns?.length ?? 0) - 1; index >= 0; index -= 1) {
    const response = task.turns[index]!.response?.trim();
    if (response) return response;
  }
  return task.response?.trim() ?? '';
};

const STATUS_WORDS: Record<string, string> = {
  queued: 'queued',
  running: 'running',
  'needs-input': 'waiting for input',
  complete: 'finished',
  failed: 'failed',
  cancelled: 'stopped',
};

export const describeSparkTask = (task: SparkTask, now: number, offset = 0): string => {
  const response = latestSparkResponse(task);
  const lines = [
    `Spark task "${task.title || task.prompt.slice(0, 60)}" (${task.id}) is ${STATUS_WORDS[task.status] ?? task.status}; last updated ${formatAgo(now - Date.parse(task.updatedAt || task.createdAt))}.`,
  ];
  if (task.status === 'needs-input') {
    lines.push('It is waiting for an answer or a permission. The user can answer it in Spark, or you can send it a follow-up with message_spark_task if you know the answer.');
  }
  if (task.turns?.length) lines.push(`It has ${task.turns.length} follow-up turn${task.turns.length === 1 ? '' : 's'}.`);
  if (response) {
    const page = response.slice(offset, offset + RESPONSE_PAGE_CHARS);
    const more = response.length - offset - page.length;
    lines.push(`Latest response${offset ? ` from character ${offset}` : ''}:\n${page}`);
    if (more > 0) lines.push(`[${more.toLocaleString('en-US')} more characters: call check_spark_task with "offset": ${offset + page.length}.]`);
  } else {
    lines.push('It has no response yet.');
  }
  return lines.join('\n');
};

const recordDelegation = (dotId: string, delegation: DotDelegation) => {
  updateDotRuntime(dotId, (runtime) => ({
    ...runtime,
    delegations: [...runtime.delegations.filter((entry) => entry.id !== delegation.id), delegation],
  }));
};

const noHost = () => fail('Spark is not available right now, so tasks cannot be assigned. Try again shortly.');

const isAbsoluteFolder = (path: string): boolean => /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/');

export const sparkTaskTools = (env: DotToolEnv): DotToolEntry[] => [
  {
    doc: {
      name: 'assign_spark_task',
      args: env.desktop ? '{"title": "…", "instructions": "…", "folder": "absolute path, optional"}' : '{"title": "…", "instructions": "…"}',
      description: `Create a Spark task and start it: a visible, durable job the user can open and steer. Write complete instructions for a reader who has not seen your conversation: the goal, what to deliver, the bounds, what is decided already and how the result will be judged. You are told when it finishes or needs input.${env.desktop ? ' For work on a project on the user\'s computer, give its "folder": the task works there with Spark\'s coding tools — commands, edits, tests — asking the user before anything the folder\'s settings do not allow.' : ''}`,
    },
    handler: {
      id: 'assign_spark_task',
      async run(args) {
        if (!env.host) return noHost();
        const title = stringArg(args, 'title');
        const instructions = stringArg(args, 'instructions');
        if (!title || !instructions) return fail('Give a "title" and complete "instructions".');
        const folder = stringArg(args, 'folder');
        if (folder && !env.desktop) return fail('Spark tasks work in a folder on the user\'s computer only in the desktop app. Leave "folder" out.');
        if (folder && !isAbsoluteFolder(folder)) return fail(`"${folder}" is not an absolute path. Give the folder's full path.`);
        const tools = Array.isArray(args.tools) ? args.tools.map(String) : [];
        const id = env.host.startTask(instructions, { title: title.slice(0, 120), description: `Assigned by ${env.dotName}`, tools, ...(folder ? { folder } : {}) });
        if (!id) return fail('Spark could not create the task. Check that a model and API key are configured.');
        const now = env.now();
        recordDelegation(env.dotId, { kind: 'spark-task', id, title, status: 'running', createdAt: now, updatedAt: now });
        return ok(`Assigned Spark task "${title}" (${id})${folder ? ` in ${folder}` : ''}. It is running; you will be told when it finishes or needs input.`);
      },
    },
  },
  {
    doc: {
      name: 'check_spark_task',
      args: '{"task_id": "…", "offset": 0}',
      description: 'Read a Spark task\'s status and latest response. Use "offset" to page through a long response.',
    },
    handler: {
      id: 'check_spark_task',
      async run(args) {
        const id = stringArg(args, 'task_id');
        if (!id) return fail('Give "task_id".');
        const task = ensureSparkTaskBodyLoaded(id) ?? getSparkTaskById(id);
        if (!task) return fail(`No Spark task with id "${id}".`);
        const offset = Math.max(0, Math.floor(Number(args.offset ?? 0)) || 0);
        return ok(describeSparkTask(task, env.now(), offset));
      },
    },
  },
  {
    doc: {
      name: 'message_spark_task',
      args: '{"task_id": "…", "message": "…"}',
      description: 'Send a follow-up to a Spark task that has finished or is waiting for input. It runs again with your message.',
    },
    handler: {
      id: 'message_spark_task',
      async run(args) {
        if (!env.host) return noHost();
        const id = stringArg(args, 'task_id');
        const message = stringArg(args, 'message');
        if (!id || !message) return fail('Give "task_id" and "message".');
        const task = getSparkTaskById(id);
        if (!task) return fail(`No Spark task with id "${id}".`);
        if (!env.host.followUp(id, message)) {
          return fail(task.status === 'running' || task.status === 'queued'
            ? 'That task is still running. Wait until you are told it has finished, or stop it first.'
            : 'Spark did not accept the follow-up for that task.');
        }
        const now = env.now();
        const existing = getDotThread(env.dotId)?.runtime.delegations.find((entry) => entry.id === id);
        recordDelegation(env.dotId, { kind: 'spark-task', id, title: existing?.title ?? task.title, status: 'running', createdAt: existing?.createdAt ?? now, updatedAt: now });
        return ok(`Sent the follow-up; "${task.title}" is running again.`);
      },
    },
  },
  {
    doc: {
      name: 'stop_spark_task',
      args: '{"task_id": "…"}',
      description: 'Stop a Spark task that is running. Work it already did stays done.',
    },
    handler: {
      id: 'stop_spark_task',
      async run(args) {
        if (!env.host) return noHost();
        const id = stringArg(args, 'task_id');
        if (!id) return fail('Give "task_id".');
        const task = getSparkTaskById(id);
        if (!task) return fail(`No Spark task with id "${id}".`);
        env.host.stop(id);
        return ok(`Asked "${task.title}" to stop.`);
      },
    },
  },
  {
    doc: {
      name: 'list_spark_tasks',
      args: '{}',
      description: 'List the Spark tasks you have assigned and their current status.',
    },
    handler: {
      id: 'list_spark_tasks',
      async run() {
        const delegations = getDotThread(env.dotId)?.runtime.delegations.filter((entry) => entry.kind === 'spark-task') ?? [];
        if (delegations.length === 0) return ok('You have not assigned any Spark tasks.');
        const now = env.now();
        return ok(delegations.map((delegation) => {
          const task = getSparkTaskById(delegation.id);
          if (!task) return `- "${delegation.title}" (${delegation.id}): deleted by the user.`;
          return `- "${task.title}" (${task.id}): ${STATUS_WORDS[task.status] ?? task.status}, updated ${formatAgo(now - Date.parse(task.updatedAt || task.createdAt))}.`;
        }).join('\n'));
      },
    },
  },
];
