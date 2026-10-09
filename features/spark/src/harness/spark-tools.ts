import { localCompanion } from '@willow/code/local-companion';
import { skillLibrary } from '@willow/core/skill-library';
import {
  normalizeSkillName,
  scheduleInputFrom,
  skillInputFrom,
  type LibraryScheduleInput,
  type LibrarySkillInput,
} from '@willow/core/spark-library';
import { nextId } from './runtime/tools';
import type { AppCall, CommandCall, ComputerUseCall, McpCall, SkillCall, ToolContext, ToolHandler, ToolResult } from './runtime/protocol';

/** One `computer` call: what the user reviews in the permission card and the browser agent runs. */
export interface SparkComputerRequest {
  /** The thread's row label, e.g. "Find Alan Turing's birth date". */
  title: string;
  /** The self-contained instruction. Shown as "Review the plan:" before anything opens. */
  task: string;
  /** Where the browser starts, when the agent knows. */
  url?: string;
}

export interface SparkComputerReport {
  completed: boolean;
  report: string;
  url?: string;
  title?: string;
}

/**
 * The remote browser, as the host wires it.
 *
 * Permission is per thread, as Gemini's is ("You've allowed Gemini to interact
 * with websites for this thread"). Without it, a call records a request — the
 * host shows the permission card — and ends the turn there; the user's answer
 * arrives as the next turn. See `runSparkHarnessTurn`'s `browserDecision`.
 */
export interface SparkComputerCapability {
  isAllowed: () => boolean;
  requestPermission: (request: SparkComputerRequest) => void;
  run: (request: SparkComputerRequest, signal?: AbortSignal) => Promise<SparkComputerReport>;
}

/**
 * One live tool of a connected app — Willow's connectors (`@willow/personal`), as the host wires
 * them. Called as `app:<name>`; the row on the timeline carries the app's logo.
 */
export interface SparkConnectorTool {
  /** The tool's own name, e.g. `list_recent_emails`. */
  name: string;
  /** The app it belongs to, keyed like the timeline's logos: `gmail`, `google-calendar`, … */
  app: string;
  appLabel: string;
  description: string;
  /** The arguments as a line the model can copy: `{ search?: string, limit?: integer }`. */
  signature: string;
  run: (args: Record<string, unknown>) => Promise<{ text: string; failed?: boolean }>;
}

export interface SparkMcpTool {
  /** `mcp__<server>__<tool>`, called as `mcp:<name>`. */
  name: string;
  /** The server's name, for the timeline row. */
  server?: string;
  description?: string;
  signature?: string;
  call: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Saving what the user asked for: a schedule Spark runs on its own, a skill applied with "/".
 * The host saves it the way Spark's own pages would, puts its timeline row and its card on
 * the turn (`label` is the row: "Created weekly science fact schedule"), and reports what it
 * saved, or null when it could not.
 */
export interface SparkLibraryCapability {
  createSchedule: (input: LibraryScheduleInput, label?: string) => { title: string; when: string } | null;
  createSkill: (input: LibrarySkillInput, label?: string) => { name: string } | null;
}

export interface SparkCapabilityContext {
  /** See `SparkProfileContext.skills` — `description` drives selection. */
  skills: readonly { name: string; description?: string; instructions: string }[];
  /** Apps with no action adapter. Kept for callers that still declare them; Spark passes none. */
  connectedApps: readonly { id: string; label: string }[];
  connectors?: readonly SparkConnectorTool[];
  mcp?: readonly SparkMcpTool[];
  /** The remote browser. Absent, `computer` is not registered and the prompt does not offer it. */
  computer?: SparkComputerCapability;
  /** Schedules and skills. Absent, `create_schedule` and `create_skill` are neither registered nor offered. */
  library?: SparkLibraryCapability;
  onCapability?: (name: string) => void;
}

/** Gemini's sentence, verbatim, above the permission card. */
export const BROWSER_PERMISSION_RESPONSE = "Before I open a browser, I want to make sure you're okay with that.";

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const shortLabel = (value: string): string => {
  const label = value.replace(/\s+/g, ' ').replace(/[.:]+$/, '').trim();
  return label.length > 80 ? `${label.slice(0, 77).trimEnd()}…` : label;
};

/**
 * Splits the step label off a connector or MCP call. `_title` is Spark's, not the tool's — a tool
 * may well have a `title` argument of its own (`create_task` does) — so it never reaches the tool.
 */
export const splitStepTitle = (args: Record<string, unknown>): { title?: string; args: Record<string, unknown> } => {
  const { _title, ...rest } = args;
  const title = shortLabel(text(_title));
  return { title: title || undefined, args: rest };
};

const MAX_CONNECTOR_RESULT_CHARS = 40_000;
const clip = (value: string): string => (
  value.length > MAX_CONNECTOR_RESULT_CHARS ? `${value.slice(0, MAX_CONNECTOR_RESULT_CHARS)}\n[…truncated]` : value
);

/** The arguments of a `computer` call, tolerating the spellings models reach for. */
export const computerRequestFrom = (args: Record<string, unknown>): SparkComputerRequest | null => {
  const task = text(args.task) || text(args.instruction) || text(args.instructions) || text(args.prompt) || text(args.goal);
  if (!task) return null;
  const title = (text(args.title) || text(args.label) || task).replace(/\s+/g, ' ').replace(/[.:]+$/, '');
  return {
    title: title.length > 80 ? `${title.slice(0, 77).trimEnd()}…` : title,
    task,
    url: text(args.url) || text(args.start_url) || undefined,
  };
};

/** What the main agent reads back from a finished browser run. */
export const computerObservation = (request: SparkComputerRequest, result: SparkComputerReport): string => [
  `Browser agent ${result.completed ? 'finished' : 'stopped before finishing'}: ${request.title}.`,
  result.url ? `Final page: ${result.url}${result.title ? ` (${result.title})` : ''}` : '',
  'Report:',
  result.report.trim() || '(no report)',
].filter(Boolean).join('\n');

/** Runs one approved request as a `computer` call on the timeline, and returns its observation. */
export const runComputerRequest = async (
  computer: SparkComputerCapability,
  request: SparkComputerRequest,
  toolContext: Pick<ToolContext, 'emit' | 'patch' | 'signal'>,
): Promise<ToolResult> => {
  const callId = toolContext.emit({
    id: nextId('call'), kind: 'computer', status: 'running', startedAt: Date.now(),
    objective: request.task, title: request.title, actions: [],
  } as ComputerUseCall);
  try {
    const result = await computer.run(request, toolContext.signal);
    toolContext.patch(callId, {
      status: result.completed ? 'success' : 'error',
      endedAt: Date.now(),
      result: result.report,
    } as Partial<ComputerUseCall>);
    return { observation: computerObservation(request, result), failed: !result.completed && !result.report };
  } catch (error) {
    const cancelled = toolContext.signal?.aborted || (error as Error)?.name === 'AbortError';
    const message = cancelled ? 'The browser task was stopped.' : `The browser could not run: ${(error as Error)?.message || 'unknown error'}.`;
    toolContext.patch(callId, { status: cancelled ? 'cancelled' : 'error', endedAt: Date.now(), error: message } as Partial<ComputerUseCall>);
    if (cancelled) throw error;
    return { observation: message, failed: true };
  }
};

export const createSparkCapabilityTools = (context: SparkCapabilityContext): ToolHandler[] => {
  const tools: ToolHandler[] = [];
  if (context.skills.length) {
    tools.push({
      id: 'use_skill',
      async run(args, toolContext): Promise<ToolResult> {
        const requested = text(args.skill).replace(/^\//, '');
        const match = context.skills.find((skill) => skill.name.toLowerCase() === requested.toLowerCase());
        if (!match) return { observation: `No Spark skill named ${JSON.stringify(requested)} is available.`, failed: true };
        context.onCapability?.(`skill:${match.name}`);
        // Gemini puts reading a skill on the timeline: "Check resources for <name> skill".
        const now = Date.now();
        toolContext?.emit?.({ id: nextId('call'), kind: 'skill', status: 'success', startedAt: now, endedAt: now, skill: match.name } as SkillCall);
        return { observation: `Apply the ${match.name} skill for this task:\n\n${match.instructions}` };
      },
    });
  }
  for (const connector of context.connectors ?? []) {
    tools.push({
      id: `app:${connector.name}`,
      async run(rawArgs, toolContext): Promise<ToolResult> {
        const { title, args } = splitStepTitle(rawArgs);
        context.onCapability?.(`app:${connector.app}`);
        const callId = toolContext.emit({
          id: nextId('call'), kind: 'app', status: 'running', startedAt: Date.now(),
          app: connector.app, action: connector.name, title: title ?? connector.appLabel, input: args,
        } as AppCall);
        try {
          const result = await connector.run(args);
          const output = clip(result.text);
          toolContext.patch(callId, { status: result.failed ? 'error' : 'success', endedAt: Date.now(), output } as Partial<AppCall>);
          return { observation: output, failed: result.failed };
        } catch (error) {
          const observation = `${connector.appLabel} could not be reached: ${(error as Error)?.message || 'unknown error'}. Do not guess at what it would have returned.`;
          toolContext.patch(callId, { status: 'error', endedAt: Date.now(), error: observation, output: observation } as Partial<AppCall>);
          return { observation, failed: true };
        }
      },
    });
  }
  if (context.connectedApps.length) {
    tools.push({
      id: 'connected_app',
      async run(args, toolContext): Promise<ToolResult> {
        const app = text(args.app);
        const match = context.connectedApps.find((candidate) => candidate.id === app || candidate.label.toLowerCase() === app.toLowerCase());
        context.onCapability?.(`app:${match?.id ?? app}`);
        const callId = toolContext.emit({
          id: nextId('call'), kind: 'app', status: 'running', startedAt: Date.now(),
          app: match?.label ?? app, action: text(args.action) || 'use', input: args,
        } as AppCall);
        const observation = match
          ? `The ${match.label} connection is enabled, but this Spark build has no action adapter for it yet. Do not claim to have read or changed it.`
          : `No connected app named ${JSON.stringify(app)} is available.`;
        toolContext.patch(callId, { status: 'error', endedAt: Date.now(), error: observation, output: observation } as Partial<AppCall>);
        return { observation: match
          ? observation
          : observation, failed: true };
      },
    } as ToolHandler);
  }
  if (context.mcp?.length) {
    for (const mcp of context.mcp) {
      tools.push({
        id: `mcp:${mcp.name}`,
        async run(rawArgs, toolContext): Promise<ToolResult> {
          const { title, args } = splitStepTitle(rawArgs);
          const server = mcp.server ?? mcp.name;
          context.onCapability?.(`mcp:${server}`);
          const callId = toolContext.emit({
            id: nextId('call'), kind: 'mcp', status: 'running', startedAt: Date.now(),
            server, tool: mcp.name, title: title ?? server, input: args,
          } as McpCall);
          try {
            const result = await mcp.call(args);
            const output = clip(typeof result === 'string' ? result : JSON.stringify(result));
            toolContext.patch(callId, { status: 'success', endedAt: Date.now(), output } as Partial<McpCall>);
            return { observation: output };
          } catch (error) {
            const observation = `MCP ${mcp.name} failed: ${error instanceof Error ? error.message : 'unknown error'}`;
            toolContext.patch(callId, { status: 'error', endedAt: Date.now(), error: observation, output: observation } as Partial<McpCall>);
            return { observation, failed: true };
          }
        },
      } as ToolHandler);
    }
  }
  if (context.computer) {
    const computer = context.computer;
    tools.push({
      id: 'computer',
      async run(args, toolContext): Promise<ToolResult> {
        const request = computerRequestFrom(args);
        if (!request) {
          return { observation: 'computer requires a "task": the complete instruction for the browser agent.', failed: true };
        }
        context.onCapability?.('computer');
        if (computer.isAllowed()) return runComputerRequest(computer, request, toolContext);
        /*
         * The first browser call in a thread asks first. The row still goes on
         * the timeline — Gemini shows the call above its permission card — and
         * the turn ends with Gemini's sentence; the user's answer is a new turn.
         */
        const callId = toolContext.emit({
          id: nextId('call'), kind: 'computer', status: 'running', startedAt: Date.now(),
          objective: request.task, title: request.title, actions: [],
        } as ComputerUseCall);
        computer.requestPermission(request);
        toolContext.patch(callId, { status: 'success', endedAt: Date.now() } as Partial<ComputerUseCall>);
        toolContext.stopTurn?.(BROWSER_PERMISSION_RESPONSE);
        return { observation: 'The user is being asked to allow the browser. Stop here; their answer arrives as the next message.' };
      },
    });
  }
  if (context.library) {
    const library = context.library;
    // A call repeated within a run gets its first answer again, not a second copy.
    const savedThisRun = new Map<string, ToolResult>();
    tools.push({
      id: 'create_schedule',
      async run(rawArgs): Promise<ToolResult> {
        const { title: label, args } = splitStepTitle(rawArgs);
        const parsed = scheduleInputFrom(args);
        if ('error' in parsed) return { observation: parsed.error, failed: true };
        const { title, frequency, weekdays, time, instructions } = parsed.input;
        const key = JSON.stringify(['create_schedule', title, frequency, weekdays, time, instructions]);
        const repeat = savedThisRun.get(key);
        if (repeat) return repeat;
        const saved = library.createSchedule(parsed.input, label);
        if (!saved) return { observation: 'The schedule could not be saved. Tell the user plainly, and do not say it was created.', failed: true };
        const result: ToolResult = {
          observation: `Saved the schedule "${saved.title}": ${saved.when}. It is switched on and listed on the Schedules page, `
            + 'and the user sees it as a card below your reply. Confirm it in a sentence and a short list (task, frequency, content); '
            + 'do not repeat its instructions.',
        };
        savedThisRun.set(key, result);
        return result;
      },
    });
    tools.push({
      id: 'create_skill',
      async run(rawArgs): Promise<ToolResult> {
        const { title: label, args } = splitStepTitle(rawArgs);
        const key = JSON.stringify(['create_skill', normalizeSkillName(args.name)]);
        const repeat = savedThisRun.get(key);
        if (repeat) return repeat;
        const parsed = skillInputFrom(args, skillLibrary.get().map((skill) => skill.name));
        if ('error' in parsed) return { observation: parsed.error, failed: true };
        const saved = library.createSkill(parsed.input, label);
        if (!saved) return { observation: 'The skill could not be saved. Tell the user plainly, and do not say it was created.', failed: true };
        const result: ToolResult = {
          observation: `Saved the skill "${saved.name}". It is active: the user can apply it with /${saved.name}, and you use it `
            + 'whenever a request fits its description. They see it as a card below your reply. Confirm it in a sentence or two; '
            + 'do not repeat its instructions.',
        };
        savedThisRun.set(key, result);
        return result;
      },
    });
  }
  tools.push({
    id: 'run_command',
    async run(args, toolContext): Promise<ToolResult> {
      const command = text(args.command);
      if (!command) return { observation: 'run_command requires a command.', failed: true };
      context.onCapability?.('run_command');
      const callId = toolContext.emit({
        id: nextId('call'), kind: 'command', status: 'running', startedAt: Date.now(),
        command, cwd: text(args.cwd) || '/workspace', output: [],
      } as CommandCall);
      try {
        let workspaceId = text(args.workspaceId);
        if (!workspaceId && text(args.root)) {
          const authorised = await localCompanion.request<{ workspaceId: string }>('workspace.authorize', { root: text(args.root) });
          workspaceId = authorised.workspaceId;
        }
        if (!workspaceId) throw new Error('Authorise a local workspace before running commands.');
        const result = await localCompanion.request<{ code: number | null; signal?: string; stdout?: string; stderr?: string }>('shell.exec', {
          command,
          cwd: text(args.cwd) || '.',
          timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 30_000,
          workspaceId,
        });
        const output = [
          result.stdout ? { stream: 'stdout' as const, text: result.stdout } : null,
          result.stderr ? { stream: 'stderr' as const, text: result.stderr } : null,
        ].filter((entry): entry is { stream: 'stdout' | 'stderr'; text: string } => Boolean(entry));
        toolContext.patch(callId, { status: result.code === 0 ? 'success' : 'error', endedAt: Date.now(), output, exitCode: result.code ?? undefined } as Partial<CommandCall>);
        return { observation: JSON.stringify(result), failed: result.code !== 0 };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Command execution is unavailable.';
        toolContext.patch(callId, { status: 'error', endedAt: Date.now(), error: message } as Partial<CommandCall>);
        return { observation: message, failed: true };
      }
    },
  });
  return tools;
};
