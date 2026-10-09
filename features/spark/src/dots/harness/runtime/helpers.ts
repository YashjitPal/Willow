/**
 * Background helpers: private agents a bot runs in parallel.
 *
 * A helper is a headless run of the Spark harness — unchanged — with the user's
 * model and tools (minus the browser) and no task record, so nothing appears in
 * Spark's lists. Its final response goes back to the bot as an event, and only
 * the bot decides what, if anything, the user hears about it. Reusing Spark's
 * harness gives helpers its files, skills, connected apps, MCP servers and its
 * own sub-agents without a second copy of any of it.
 *
 * Helpers live in this tab's memory. If the tab closes mid-run the helper is
 * gone; the runtime notices the orphaned delegation on the next start and tells
 * the bot it was interrupted.
 */
import { runSparkHarnessTurn } from '../../../harness/spark-harness';
import type { SparkTaskHost } from '../../../spark-task-host';

export type DotHelperStatus = 'running' | 'complete' | 'failed' | 'cancelled';

export interface DotHelper {
  id: string;
  dotId: string;
  name: string;
  instructions: string;
  status: DotHelperStatus;
  result: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
  controller: AbortController;
}

export const MAX_CONCURRENT_HELPERS = 4;

const helpers = new Map<string, DotHelper>();
const listeners = new Set<(helper: DotHelper) => void>();

export const onDotHelperFinished = (listener: (helper: DotHelper) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getDotHelper = (id: string): DotHelper | undefined => helpers.get(id);

export const runningHelpersFor = (dotId: string): DotHelper[] =>
  [...helpers.values()].filter((helper) => helper.dotId === dotId && helper.status === 'running');

export const stopDotHelper = (id: string): boolean => {
  const helper = helpers.get(id);
  if (!helper || helper.status !== 'running') return false;
  helper.controller.abort();
  return true;
};

export const stopDotHelpersFor = (dotId: string): void => {
  for (const helper of runningHelpersFor(dotId)) helper.controller.abort();
};

export const helperPrompt = (dotName: string, instructions: string) => `You are working as a background helper for ${dotName}, an assistant who looks after the user in an ongoing conversation. You work privately: the user does not see you, your final response goes to ${dotName}, not to the user, and nobody can answer a question from you while you work — where something is unclear, take the most sensible reading, note it, and carry on.

Do the work below as thoroughly as it deserves. Base everything you report on what your tools actually returned: look things up rather than recall them, try another way when a search comes back thin, and never fill a gap with something invented. Keep names, figures, quotes and links exactly as you found them. Stay within what the instructions ask, and leave alone anything they did not ask you to change.

Finish with a complete, self-contained report in the shape the instructions ask for: what you found or produced, with its sources, anything you changed, and what you could not do or verify.

${instructions}`;

let counter = 0;

/** Starts a helper and returns it, or a reason it could not start. */
export const startDotHelper = (options: {
  dotId: string;
  dotName: string;
  name: string;
  instructions: string;
  host: SparkTaskHost;
}): DotHelper | string => {
  if (runningHelpersFor(options.dotId).length >= MAX_CONCURRENT_HELPERS) {
    return `You already have ${MAX_CONCURRENT_HELPERS} helpers running. Wait for one to finish or stop one first.`;
  }
  const model = options.host.executionModel();
  if (!model) return 'No model is configured, so a helper cannot run.';
  counter += 1;
  const helper: DotHelper = {
    id: `h${Date.now().toString(36)}${counter}`,
    dotId: options.dotId,
    name: options.name,
    instructions: options.instructions,
    status: 'running',
    result: '',
    startedAt: Date.now(),
    controller: new AbortController(),
  };
  helpers.set(helper.id, helper);

  void (async () => {
    try {
      const capabilities = await options.host.capabilities();
      const result = await runSparkHarnessTurn({
        prompt: helperPrompt(options.dotName, options.instructions),
        history: [],
        model,
        scope: `${options.host.scope()}::dot-helper::${options.dotId}`,
        threadId: helper.id,
        capabilities: { ...capabilities, connectedApps: [], selectedCapabilities: [] },
        signal: helper.controller.signal,
        onEvent: () => undefined,
      });
      helper.result = result.response;
      helper.status = result.reason === 'complete' ? 'complete' : result.reason === 'cancelled' ? 'cancelled' : 'failed';
      if (result.error) helper.error = result.error;
    } catch (error) {
      helper.status = helper.controller.signal.aborted ? 'cancelled' : 'failed';
      helper.error = error instanceof Error ? error.message : String(error);
    } finally {
      helper.endedAt = Date.now();
      for (const listener of listeners) listener(helper);
    }
  })();

  return helper;
};
