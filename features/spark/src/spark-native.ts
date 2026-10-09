/**
 * Whether a Spark turn runs natively, on this computer, and the runtime it gets.
 *
 * Only in the desktop app, and only when its local companion answers with the
 * `spark.*` runtime. A task with no folder falls back to the browser workspace
 * when the companion is unreachable, as every task did before; a task in a
 * folder fails instead, because the browser workspace cannot reach the folder
 * and quietly working somewhere else would be worse than saying so.
 */

import { isDesktopApp } from '@willow/core/desktop-bridge';
import { companionNativeHost, probeNativeEnvironment, type NativeEnvironment } from './harness/native/native-host';
import { createSparkNativeRuntime, type SparkNativeRuntime } from './harness/native/native-runtime';
import { createSparkTaskApprovals, sparkTaskProject } from './spark-projects';

let probe: Promise<NativeEnvironment | null> | null = null;

/** This computer, probed once and again after a failure; null in a browser. */
export const sparkNativeEnvironment = (): Promise<NativeEnvironment | null> => {
  if (!isDesktopApp()) return Promise.resolve(null);
  probe ??= probeNativeEnvironment().then((environment) => {
    if (!environment) probe = null;
    return environment;
  });
  return probe;
};

/** The native runtime for one of `taskId`'s turns, or undefined to use the browser workspace. */
export const sparkNativeRuntimeFor = async (
  taskId: string,
  signal: AbortSignal,
  onCapability?: (name: string) => void,
): Promise<SparkNativeRuntime | undefined> => {
  if (!isDesktopApp()) return undefined;
  const project = sparkTaskProject(taskId);
  const environment = await sparkNativeEnvironment();
  if (!environment) {
    if (project) throw new Error(`Spark cannot reach this computer right now, so it cannot work in ${project.name}. Restart Willow and try again.`);
    return undefined;
  }
  return createSparkNativeRuntime({
    host: companionNativeHost,
    environment,
    projectPath: project?.path ?? null,
    owner: taskId,
    approvals: createSparkTaskApprovals(taskId),
    signal,
    onCapability,
  });
};
