/** `start_helper`, `check_helper`, `stop_helper`: a bot's private background agents. */
import { formatAgo } from '../memory/render';
import { getDotHelper, startDotHelper, stopDotHelper } from '../runtime/helpers';
import { updateDotRuntime } from '../thread/thread-store';
import { fail, ok, stringArg, type DotToolEntry, type DotToolEnv } from './tool-env';

const RESULT_PAGE_CHARS = 6_000;

export const helperTools = (env: DotToolEnv): DotToolEntry[] => [
  {
    doc: {
      name: 'start_helper',
      args: '{"name": "…", "instructions": "…"}',
      description: 'Start a background agent that works privately and reports only to you, with the user\'s tools and web search. Give it complete, self-contained instructions: the goal, what to report back and in what shape, the bounds, and what is decided already. Its report arrives as an event when it finishes, so there is no need to check on it meanwhile.',
    },
    handler: {
      id: 'start_helper',
      async run(args) {
        if (!env.host) return fail('Helpers are not available right now. Try again shortly, or do the work yourself.');
        const name = stringArg(args, 'name') ?? 'Helper';
        const instructions = stringArg(args, 'instructions');
        if (!instructions) return fail('Give the helper complete "instructions".');
        const started = startDotHelper({ dotId: env.dotId, dotName: env.dotName, name, instructions, host: env.host });
        if (typeof started === 'string') return fail(started);
        updateDotRuntime(env.dotId, (runtime) => ({
          ...runtime,
          delegations: [...runtime.delegations, { kind: 'helper', id: started.id, title: name, status: 'running', createdAt: started.startedAt, updatedAt: started.startedAt }],
        }));
        return ok(`Started helper "${name}" (${started.id}). Its report will arrive as an event.`);
      },
    },
  },
  {
    doc: {
      name: 'check_helper',
      args: '{"id": "…", "offset": 0}',
      description: 'Read a helper\'s status, and its report once it has finished.',
    },
    handler: {
      id: 'check_helper',
      async run(args) {
        const id = stringArg(args, 'id');
        const helper = id ? getDotHelper(id) : undefined;
        if (!helper) return fail(`No helper with id "${id ?? ''}" is known in this session.`);
        const elapsed = formatAgo(env.now() - helper.startedAt).replace(' ago', '');
        if (helper.status === 'running') return ok(`Helper "${helper.name}" is still working (started ${elapsed} ago).`);
        const offset = Math.max(0, Math.floor(Number(args.offset ?? 0)) || 0);
        const page = helper.result.slice(offset, offset + RESULT_PAGE_CHARS);
        const more = helper.result.length - offset - page.length;
        return ok([
          `Helper "${helper.name}" ${helper.status === 'complete' ? 'finished' : helper.status === 'cancelled' ? 'was stopped' : 'failed'}${helper.error ? `: ${helper.error}` : ''}.`,
          page ? `Report:\n${page}` : 'It produced no report.',
          more > 0 ? `[${more.toLocaleString('en-US')} more characters: call check_helper with "offset": ${offset + page.length}.]` : '',
        ].filter(Boolean).join('\n'));
      },
    },
  },
  {
    doc: {
      name: 'stop_helper',
      args: '{"id": "…"}',
      description: 'Stop a running helper.',
    },
    handler: {
      id: 'stop_helper',
      async run(args) {
        const id = stringArg(args, 'id');
        if (!id || !stopDotHelper(id)) return fail(`No running helper with id "${id ?? ''}".`);
        return ok('Stopping the helper.');
      },
    },
  },
];
