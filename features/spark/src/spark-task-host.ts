/**
 * The seam that lets code outside the Spark page start and steer Spark tasks.
 *
 * Running a task is owned by `SparkWorkspace`: model resolution, capabilities,
 * the harness call, streaming into the store and the `spark-run` background job
 * all live in its callbacks. Rather than lift that out (and risk changing how
 * Spark runs), the mounted workspace registers a host built from those same
 * callbacks. Exactly one workspace is mounted at a time — the routed page, or
 * the background-only instance above the routes — so there is exactly one host,
 * and a task started through it runs, survives a closed tab and gets taken over
 * in another tab exactly like one started from Spark's own composer.
 *
 * Bots are the first caller: it is how a bot assigns Spark tasks and how its
 * background helpers get a model and the user's tools.
 */
import type { SparkHarnessOptions } from './harness/spark-harness';
import type { SparkCapabilityContext } from './harness/spark-tools';

export type SparkHostModel = SparkHarnessOptions['model'];

export type SparkHostCapabilities = Pick<SparkCapabilityContext, 'skills' | 'connectedApps' | 'connectors' | 'mcp'>;

export interface SparkStartTaskOptions {
  title?: string;
  /** Shown under the title in Spark's lists while the task runs. */
  description?: string;
  /** Composer tools to run with (`research`, `thinking`, `plan`…), as Spark records them. */
  tools?: string[];
  /**
   * Desktop app: the folder on the user's computer the task works in, with Spark's native tools there (commands
   * and edits, under the folder's approval policy). Absent, a task works across the computer.
   */
  folder?: string;
}

export interface SparkTaskHost {
  /** The model a Spark run would use right now, or null when no API key is configured. */
  executionModel(): SparkHostModel | null;
  /** The user's skills, connector tools and MCP tools, as a Spark run receives them (no browser). */
  capabilities(): Promise<SparkHostCapabilities>;
  /** Creates a task without opening it, starts it, and returns its id. */
  startTask(prompt: string, options?: SparkStartTaskOptions): string | null;
  /** Sends a follow-up turn to a task. False while the task is still running. */
  followUp(taskId: string, prompt: string): boolean;
  /** Stops a task's in-flight run. */
  stop(taskId: string): void;
  /** The storage scope runs execute under, for headless runs' workspaces. */
  scope(): string;
}

let current: SparkTaskHost | null = null;
const listeners = new Set<(host: SparkTaskHost | null) => void>();

export const registerSparkTaskHost = (host: SparkTaskHost): (() => void) => {
  current = host;
  for (const listener of listeners) listener(host);
  return () => {
    if (current !== host) return;
    current = null;
    for (const listener of listeners) listener(null);
  };
};

export const getSparkTaskHost = (): SparkTaskHost | null => current;

export const onSparkTaskHost = (listener: (host: SparkTaskHost | null) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * The host, waiting briefly for one. The workspace is lazily loaded and swaps
 * between its routed and background instances, so a caller can arrive in the
 * gap between one unmounting and the next registering.
 */
export const waitForSparkTaskHost = (timeoutMs = 10_000): Promise<SparkTaskHost | null> => {
  if (current) return Promise.resolve(current);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(current);
    }, timeoutMs);
    const unsubscribe = onSparkTaskHost((host) => {
      if (!host) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(host);
    });
  });
};
