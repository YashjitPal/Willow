/**
 * Spark's native runtime for one turn in the desktop app: Codex's tools against
 * the user's computer, through the local companion.
 *
 * A task with a project folder works in it; a task without one works from the
 * home folder, across the computer. Either way the turn gets:
 *
 * - `exec_command`, `write_stdin` and the disk file tools (`./native-tools.ts`),
 *   which replace the web runtime's tools of the same ids;
 * - patches applied to files on disk (`./native-disk-patches.ts`);
 * - Codex's environment context, permissions instructions and AGENTS.md
 *   (`./native-context.ts`), sent with the turn's user message;
 * - the desktop refusals and prompt profile.
 */

import type { DiskPatchEngine } from '../runtime/agent';
import type { ToolHandler } from '../runtime/protocol';
import { nativeRefusalFor } from '../overlay/tool-policy';
import type { SparkNativeProfile } from '../overlay/spark-native-profile';
import type { NativeApprovals } from './native-approvals';
import { discoverAgentsMd, renderAgentsMd, renderEnvironmentContext, renderPermissionsInstructions } from './native-context';
import { createDiskPatchEngine } from './native-disk-patches';
import type { NativeEnvironment, SparkNativeHost } from './native-host';
import { createNativePaths, type NativePaths } from './native-paths';
import { createNativeTools, forgetNativeSessions, nativeToolDeclarations } from './native-tools';

export interface SparkNativeRuntimeOptions {
  host: SparkNativeHost;
  environment: NativeEnvironment;
  /** The task's project folder, absolute. Null works from the home folder, across the computer. */
  projectPath: string | null;
  /** Owns the task's processes: the task's id. */
  owner: string;
  approvals: NativeApprovals;
  signal?: AbortSignal;
  now?: Date;
  timezone?: string;
  onCapability?: (name: string) => void;
}

export interface SparkNativeRuntime {
  paths: NativePaths;
  profile: SparkNativeProfile;
  tools: ToolHandler[];
  /** The tools as function declarations, so the model has a terminal among its tools. */
  toolDeclarations: { functionDeclarations: Record<string, unknown>[] };
  diskPatches: DiskPatchEngine;
  /** The environment context, permissions instructions and AGENTS.md, for the turn's user message. */
  turnContext: string;
  refusalFor: (toolName: string) => string | null;
  /** Stops every process the task started. */
  stop: () => Promise<void>;
}

export class NativeFolderMissingError extends Error {
  constructor(readonly path: string) {
    super(`The folder ${path} no longer exists. Add it again, or move the task out of it.`);
    this.name = 'NativeFolderMissingError';
  }
}

export const createSparkNativeRuntime = async (options: SparkNativeRuntimeOptions): Promise<SparkNativeRuntime> => {
  const { host, environment, approvals } = options;
  const paths = createNativePaths(options.projectPath ?? environment.home, { platform: environment.platform, home: environment.home });
  const folder = await host.stat(paths.cwd);
  if (!folder.exists || !folder.isDirectory) throw new NativeFolderMissingError(paths.cwd);

  const shell = environment.shell.name;
  const tools = createNativeTools({ host, paths, approvals, owner: options.owner, shell, onCapability: options.onCapability });
  const diskPatches = createDiskPatchEngine({
    host,
    paths,
    approvals,
    writableRoot: options.projectPath ? paths.cwd : null,
    signal: options.signal,
  });
  const agentsMd = await discoverAgentsMd(host, paths).catch(() => []);
  const turnContext = [
    renderEnvironmentContext({
      cwd: paths.cwd,
      shell,
      now: options.now ?? new Date(),
      timezone: options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    renderPermissionsInstructions(approvals.mode(), approvals.rules()),
    renderAgentsMd(agentsMd),
  ].filter(Boolean).join('\n\n');

  return {
    paths,
    profile: { platform: environment.platform, shell, project: Boolean(options.projectPath) },
    tools,
    toolDeclarations: nativeToolDeclarations(environment.platform),
    diskPatches,
    turnContext,
    refusalFor: nativeRefusalFor,
    async stop() {
      await host.execKill({ owner: options.owner }).catch(() => undefined);
      forgetNativeSessions(options.owner);
    },
  };
};
