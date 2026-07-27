import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { useAuth } from '../../context/AuthContext';
import { useUserDataContext } from '../../context/UserDataContext';
import {
  isAbortError,
  streamChat,
  type ChatMessage as AiChatMessage,
  type StreamPhase,
} from '../../lib/ai';
import {
  deleteSparkAttachmentPayloads,
  resolveSparkTaskAttachments,
} from '../../lib/spark-attachment-storage';
import {
  appendSparkTaskTurn,
  createSparkCustomApp,
  createSparkSchedule,
  createSparkSkill,
  createSparkTask,
  deleteSparkCustomApp,
  deleteSparkSchedule,
  deleteSparkSkill,
  deleteSparkTask,
  goToAllSparkTasks,
  goToSparkApps,
  getActiveSparkStorageScope,
  goToSparkHome,
  goToSparkScheduleEditor,
  goToSparkSchedules,
  goToSparkSkillEditor,
  goToSparkSkills,
  goToSparkTask,
  hydrateSparkState,
  isSparkStateHydratedForScope,
  isSparkScheduleRunClaimCurrent,
  renameSparkTask,
  replaceSparkLocation,
  restoreSparkLocation,
  setSparkAppConnection,
  setSparkCustomAppConnected,
  setSparkTaskReaction,
  setSparkTaskTurnReaction,
  SPARK_HISTORY_STATE_KEY,
  sparkState,
  toggleSparkTaskPinned,
  updateSparkSchedule,
  updateSparkSkill,
  updateSparkTask,
  updateSparkTaskResponseTransient,
  updateSparkTaskThinkingTransient,
  updateSparkTaskTurn,
  updateSparkTaskTurnResponseTransient,
  updateSparkTaskTurnThinkingTransient,
  type SparkTaskAttachment,
} from '../../lib/stores/spark-store';
import type {
  SparkReaction,
  SparkSchedule,
  SparkSkill,
  SparkTask,
  SparkTaskTurn,
} from './spark-types';
import { SparkAllTasks } from './SparkAllTasks';
import { SparkHome } from './SparkHome';
import {
  SPARK_SCHEDULE_WEEKDAYS,
  SparkScheduleEditor,
  type SparkScheduleDraft,
  type SparkScheduleWeekday,
} from './SparkScheduleEditor';
import { SparkSkillEditor, type SparkSkillDraft } from './SparkSkillEditor';
import { SparkComputerUsePanel } from './SparkComputerUsePanel';
import { SparkTaskDetail } from './SparkTaskDetail';
import { ConnectedAppsPage, SchedulesPage, SkillsPage } from './SparkCustomisePages';
import './SparkWorkspace.css';

interface SparkWorkspaceProps {
  backgroundOnly?: boolean;
  modelConfig?: any;
  selectedModelId?: string;
}

const SPARK_SYSTEM_PROMPT =
  'You are Willow Spark, a task-focused AI assistant. Complete the user task as far as the available tools allow, ' +
  'state the useful result directly, and clearly identify any action that still needs user approval. Use concise ' +
  'Markdown when it improves readability. Never claim that you performed an external action you did not perform.';

const BROWSER_REQUEST_PATTERN = /(?:https?:\/\/|\b(?:browse|navigate|visit|open)\b.{0,32}\b(?:site|website|page|url)\b)/i;

const TOOL_LABELS: Record<string, string> = {
  images: 'Create image',
  thinking: 'Thinking',
  research: 'Deep research',
  web: 'Web search',
  learn: 'Study and learn',
  canvas: 'Canvas',
  github: 'GitHub',
  quizzes: 'Quizzes',
  spotify: 'Spotify',
};

const CONNECTION_LABELS: Record<string, string> = {
  workspace: 'Google Workspace',
  'youtube-music': 'YouTube Music',
  contacts: 'Contacts',
  opentable: 'OpenTable',
};

const getExecutionModelLabel = (
  selected: any,
  provider: string,
  model: string,
  thinkingLevel: number,
): string => {
  const configuredName = typeof selected?.name === 'string' ? selected.name.trim() : '';
  const fallbackName = model
    .replace(/^gemini[-_]?/i, 'Gemini ')
    .replace(/[-_]+/g, ' ')
    .replace(/\bflash lite\b/i, 'Flash-Lite')
    .replace(/\bpro\b/i, 'Pro')
    .replace(/\b(\w)/g, (match: string) => match.toUpperCase())
    .trim();
  const rawBase = configuredName || (provider === 'gemini' ? fallbackName : `${provider} ${fallbackName}`);
  const base = provider === 'gemini' ? rawBase.replace(/^Gemini\s+/i, '') : rawBase;
  return thinkingLevel > 0 && !/extended$/i.test(base) ? `${base} Extended` : base;
};

const formatScheduledDate = (value: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const getNextScheduleRunAt = (schedule: Pick<SparkSchedule, 'frequency' | 'time' | 'weekdays'>, after = new Date()): string => {
  const [rawHour, rawMinute] = schedule.time.split(':').map(Number);
  const hour = Number.isFinite(rawHour) ? Math.min(23, Math.max(0, rawHour)) : 9;
  const minute = Number.isFinite(rawMinute) ? Math.min(59, Math.max(0, rawMinute)) : 0;
  const allowedDays = new Set(schedule.weekdays);
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(after);
    candidate.setSeconds(0, 0);
    candidate.setDate(after.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    const matchesDay = schedule.frequency === 'Daily'
      || allowedDays.has(weekdayNames[candidate.getDay()]);
    if (matchesDay && candidate.getTime() > after.getTime()) return candidate.toISOString();
  }

  const fallback = new Date(after);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(hour, minute, 0, 0);
  return fallback.toISOString();
};

const getPhaseLabel = (phase: StreamPhase): string => {
  switch (phase) {
    case 'thinking': return 'Thinking';
    case 'searching': return 'Searching the web';
    case 'executing': return 'Using tools';
    case 'responding': return 'Writing';
  }
};

const appendDisplayableThinkingSteps = (steps: string[], thought: string): string[] => {
  const startsNewStep = /^\s*\n{2,}/.test(thought);
  const incoming = thought
    .split(/\n{2,}/)
    .map((step) => step.replace(/\s+/g, ' ').trim().slice(0, 600))
    .filter(Boolean);
  if (!incoming.length) return steps;
  const next = [...steps];
  incoming.forEach((step, index) => {
    const shouldStartNew = startsNewStep || index > 0 || next.length === 0;
    if (shouldStartNew) {
      if (next[next.length - 1] !== step) next.push(step);
      return;
    }
    const lastIndex = next.length - 1;
    const previous = next[lastIndex];
    if (step === previous || previous.endsWith(step)) return;
    if (step.startsWith(previous)) {
      next[lastIndex] = step;
      return;
    }
    const separator = /^[,.;:!?)}\]]/.test(step) ? '' : ' ';
    next[lastIndex] = `${previous}${separator}${step}`.slice(0, 600);
  });
  return next.slice(-12);
};

const getTaskAttachmentIds = (task: SparkTask): string[] => [
  ...(task.attachments ?? []).map((attachment) => attachment.id),
  ...task.turns.flatMap((turn) => (turn.attachments ?? []).map((attachment) => attachment.id)),
];

const sparkRunControllers = new Map<string, AbortController>();

const beginSparkRun = (scopeId: string, taskId: string) => {
  const key = `${scopeId}:${taskId}`;
  sparkRunControllers.get(key)?.abort();
  const controller = new AbortController();
  sparkRunControllers.set(key, controller);
  return { controller, key };
};

const finishSparkRun = (key: string, controller: AbortController) => {
  if (sparkRunControllers.get(key) === controller) sparkRunControllers.delete(key);
};

const updateLinkedScheduleRunStatus = (
  taskId: string,
  lastRunLabel: string,
  finished = false,
) => {
  const linkedSchedule = sparkState.get().schedules.find((schedule) => schedule.taskId === taskId);
  if (!linkedSchedule) return;
  updateSparkSchedule(linkedSchedule.id, {
    lastRunLabel,
    ...(finished ? { lastRunAt: new Date().toISOString() } : {}),
  });
};

export const SparkWorkspace: React.FC<SparkWorkspaceProps> = ({
  backgroundOnly = false,
  modelConfig,
  selectedModelId = '',
}) => {
  const { user } = useAuth();
  const { apiKeys } = useUserDataContext();
  const { connections, customApps, location, schedules, skills, tasks } = useStore(sparkState);
  const schedulerBusyRef = useRef(false);
  const orderedTasks = useMemo(() => [...tasks].sort((left, right) => {
    if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  }), [tasks]);
  const task = location.page === 'task'
    ? tasks.find((candidate) => candidate.id === location.taskId)
    : undefined;
  const taskSchedule = task
    ? schedules.find((candidate) => candidate.taskId === task.id)
    : undefined;
  const schedule = location.page === 'schedule-editor' && location.scheduleId
    ? schedules.find((candidate) => candidate.id === location.scheduleId)
    : undefined;
  const skill = location.page === 'skill-editor' && location.skillId
    ? skills.find((candidate) => candidate.id === location.skillId)
    : undefined;
  const locationKey = location.page === 'task'
    ? `${location.page}:${location.taskId}`
    : location.page;
  const computerUseApiKey = useMemo(() => (
    (apiKeys as unknown as Record<string, string[] | undefined> | undefined)?.gemini
      ?.find((key) => key.trim())
      ?.trim()
  ), [apiKeys]);

  useEffect(() => {
    const scopeId = user?.uid ?? 'guest';
    if (!isSparkStateHydratedForScope(scopeId)) hydrateSparkState(scopeId);
    try {
      const hydratedLocation = sparkState.get().location;
      window.history.replaceState(
        { ...(window.history.state ?? {}), [SPARK_HISTORY_STATE_KEY]: hydratedLocation },
        '',
        window.location.href,
      );
    } catch {
      // History state is optional in embedded previews.
    }
  }, [user?.uid]);

  useEffect(() => {
    const restoreFromHistory = (event: PopStateEvent) => {
      restoreSparkLocation(event.state?.[SPARK_HISTORY_STATE_KEY]);
    };
    window.addEventListener('popstate', restoreFromHistory);
    return () => window.removeEventListener('popstate', restoreFromHistory);
  }, []);

  useEffect(() => {
    if (location.page === 'task' && !task) replaceSparkLocation({ page: 'all-tasks' });
    if (location.page === 'schedule-editor' && location.scheduleId && !schedule) {
      replaceSparkLocation({ page: 'schedules' });
    }
    if (location.page === 'skill-editor' && location.skillId && !skill) {
      replaceSparkLocation({ page: 'skills' });
    }
  }, [location, schedule, skill, task]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.spark-dashboard-scroll')?.scrollTo({
        top: 0,
        left: 0,
        behavior: 'auto',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [locationKey]);

  const resolveExecutionModel = useCallback(() => {
    const availableModels = [
      ...(modelConfig?.gemini?.savedModels ?? []).map((model: any) => ({ ...model, provider: 'gemini' })),
      ...(modelConfig?.openai?.savedModels ?? []).map((model: any) => ({ ...model, provider: 'openai' })),
      ...(modelConfig?.anthropic?.savedModels ?? []).map((model: any) => ({ ...model, provider: 'anthropic' })),
      ...(modelConfig?.moonshot?.savedModels ?? []).map((model: any) => ({ ...model, provider: 'moonshot' })),
      ...(modelConfig?.spacexai?.savedModels ?? []).map((model: any) => ({ ...model, provider: 'spacexai' })),
      ...(modelConfig?.zhipuai?.savedModels ?? []).map((model: any) => ({ ...model, provider: 'zhipuai' })),
    ];
    const selected = availableModels.find((model) => model.id === selectedModelId) ?? availableModels[0];
    const provider = selected?.provider ?? 'gemini';
    const model = selected?.modelId ?? modelConfig?.[provider]?.model ?? 'gemini-3.6-flash';
    const apiKey = (apiKeys as unknown as Record<string, string[] | undefined> | undefined)?.[provider]
      ?.find((key) => key.trim())
      ?.trim();

    return {
      provider,
      model,
      apiKey,
      thinkingLevel: Number(selected?.thinkingLevel ?? modelConfig?.[provider]?.thinkingLevel ?? 0),
      modelLabel: getExecutionModelLabel(
        selected,
        provider,
        model,
        Number(selected?.thinkingLevel ?? modelConfig?.[provider]?.thinkingLevel ?? 0),
      ),
      baseUrl: modelConfig?.[provider]?.baseUrl,
    };
  }, [apiKeys, modelConfig, selectedModelId]);

  const buildSystemPrompt = useCallback((tools: readonly string[]) => {
    const toolList = tools.map((tool) => {
      if (tool.startsWith('app:')) return CONNECTION_LABELS[tool.slice(4)] ?? tool.slice(4);
      return TOOL_LABELS[tool] ?? tool;
    }).join(', ');
    const skillContext = skills
      .slice(0, 12)
      .map((savedSkill) => `- ${savedSkill.name}: ${savedSkill.instructions.slice(0, 4000)}`)
      .join('\n');
    const connectedBuiltIns = Object.entries(connections)
      .filter(([, connected]) => connected)
      .map(([id]) => CONNECTION_LABELS[id] ?? id);
    const connectedCustomApps = customApps
      .filter((app) => app.connected)
      .map((app) => `${app.name} (${app.url})`);
    const connectedAppList = [...connectedBuiltIns, ...connectedCustomApps].join(', ');

    return [
      SPARK_SYSTEM_PROMPT,
      toolList ? `The user explicitly selected these capabilities: ${toolList}.` : '',
      tools.includes('learn') ? 'Teach step by step and check understanding.' : '',
      tools.includes('quizzes') ? 'When useful, finish with a concise knowledge-check quiz.' : '',
      skillContext
        ? `Apply these saved skills only when relevant:\n${skillContext}`
        : '',
      connectedAppList
        ? `The user has enabled these app connections: ${connectedAppList}. Treat this as preference context only; do not claim to have read an app unless a real tool result supplies its data.`
        : '',
    ].filter(Boolean).join('\n\n');
  }, [connections, customApps, skills]);

  const getExecutionSettings = useCallback((prompt: string, tools: readonly string[]) => {
    const execution = resolveExecutionModel();
    const selectedTools = new Set(tools);
    const needsMoreThinking = selectedTools.has('thinking') || selectedTools.has('research');
    const thinkingLevel = needsMoreThinking
      ? Math.max(execution.thinkingLevel, selectedTools.has('research') ? 3 : 2)
      : execution.thinkingLevel;
    return {
      ...execution,
      thinkingLevel,
      modelLabel: getExecutionModelLabel(
        { name: execution.modelLabel.replace(/ Extended$/i, '') },
        execution.provider,
        execution.model,
        thinkingLevel,
      ),
      enableSearch: selectedTools.has('web')
        || selectedTools.has('research')
        || BROWSER_REQUEST_PATTERN.test(prompt),
      enableCodeExecution: selectedTools.has('canvas') || selectedTools.has('github'),
    };
  }, [resolveExecutionModel]);

  const executeTask = useCallback(async (
    taskId: string,
    prompt: string,
    history: AiChatMessage[] = [],
    tools: string[] = [],
    attachments: SparkTaskAttachment[] = [],
  ) => {
    const executionScope = getActiveSparkStorageScope();
    const execution = getExecutionSettings(prompt, tools);
    const { controller, key: runKey } = beginSparkRun(executionScope, taskId);
    const isCurrentRun = () => sparkRunControllers.get(runKey) === controller
      && getActiveSparkStorageScope() === executionScope
      && sparkState.get().tasks.some((candidate) => candidate.id === taskId);
    if (!execution.apiKey) {
      updateSparkTask(taskId, {
        status: 'failed',
        description: 'A model API key is required',
        progressLabel: 'Could not start',
        response: `Add an API key for ${execution.provider} in Settings > Models, then retry this task.`,
        modelLabel: execution.modelLabel,
        reaction: undefined,
      });
      updateLinkedScheduleRunStatus(taskId, 'Failed', true);
      finishSparkRun(runKey, controller);
      return;
    }

    updateSparkTask(taskId, {
      status: 'running',
      description: 'Working on your task',
      progressLabel: 'Thinking',
      response: '',
      modelLabel: execution.modelLabel,
      thinkingSteps: [],
      reaction: undefined,
      tools,
    });

    let response = '';
    let thinkingSteps: string[] = [];
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    const publishResponse = () => {
      publishTimer = undefined;
      if (isCurrentRun()) updateSparkTaskResponseTransient(taskId, response);
    };
    const queueResponsePublish = () => {
      if (!publishTimer) publishTimer = setTimeout(publishResponse, 80);
    };
    const publishThought = (thought: string) => {
      const nextSteps = appendDisplayableThinkingSteps(thinkingSteps, thought);
      if (nextSteps === thinkingSteps) return;
      thinkingSteps = nextSteps;
      if (isCurrentRun()) updateSparkTaskThinkingTransient(taskId, thinkingSteps);
    };

    try {
      const resolvedAttachments = await resolveSparkTaskAttachments(attachments, executionScope);
      if (attachments.length && resolvedAttachments.length !== attachments.length) {
        throw new Error('One or more attached files are no longer available. Reattach them and retry.');
      }
      await streamChat(
        [...history, {
          role: 'user',
          content: prompt,
          attachments: resolvedAttachments,
        }],
        {
          provider: execution.provider,
          model: execution.model,
          apiKey: execution.apiKey,
          thinkingLevel: execution.thinkingLevel,
          includeThoughts: execution.thinkingLevel > 0,
          enableSearch: execution.enableSearch,
          enableCodeExecution: execution.enableCodeExecution,
          baseUrl: execution.baseUrl,
          signal: controller.signal,
        },
        (token: string) => {
          if (!isCurrentRun()) return;
          response += token;
          queueResponsePublish();
        },
        () => undefined,
        buildSystemPrompt(tools),
        (phase: StreamPhase) => {
          if (isCurrentRun() && !response) updateSparkTask(taskId, { progressLabel: getPhaseLabel(phase) });
        },
        async (name: string) => ({
          status: 'unavailable',
          error: `The ${name} tool is not connected to this Spark runtime. Do not claim that it succeeded.`,
        }),
        publishThought,
      );

      if (publishTimer) clearTimeout(publishTimer);
      if (!isCurrentRun()) return;
      updateSparkTask(taskId, {
        status: 'complete',
        description: 'Task completed',
        progressLabel: 'Done',
        response: response.trim() || 'The task completed without a text response.',
        modelLabel: execution.modelLabel,
        thinkingSteps,
        tools,
        approval: undefined,
      });
      updateLinkedScheduleRunStatus(taskId, 'Completed', true);
    } catch (error) {
      if (publishTimer) clearTimeout(publishTimer);
      if (isAbortError(error) || controller.signal.aborted) return;
      if (!isCurrentRun()) return;
      updateSparkTask(taskId, {
        status: 'failed',
        description: 'Task failed',
        progressLabel: 'Failed',
        response: response.trim() || `Something went wrong: ${error instanceof Error ? error.message : 'Unknown error.'}`,
        modelLabel: execution.modelLabel,
        thinkingSteps,
      });
      updateLinkedScheduleRunStatus(taskId, 'Failed', true);
    } finally {
      finishSparkRun(runKey, controller);
    }
  }, [buildSystemPrompt, getExecutionSettings]);

  const createTask = useCallback((
    prompt: string,
    attachments: SparkTaskAttachment[] = [],
    tools: string[] = [],
    title?: string,
  ) => {
    const requiresApproval = BROWSER_REQUEST_PATTERN.test(prompt);
    const execution = getExecutionSettings(prompt, tools);
    const approval = requiresApproval ? {
      kind: 'browser' as const,
      title: 'Let Gemini interact with websites for you?',
      description: 'To work on your tasks, Gemini will need to use a browser:',
      prompt,
    } : undefined;
    const createdTask = createSparkTask(prompt, {
      title,
      description: requiresApproval ? 'Waiting for your approval' : 'Getting started',
      status: requiresApproval ? 'needs-input' : 'running',
      progressLabel: requiresApproval ? 'Approval needed' : 'Planning the next steps',
      response: requiresApproval
        ? 'Before I open the browser and proceed, I need you to confirm you are ok to use it.'
        : '',
      modelLabel: execution.modelLabel,
      attachments,
      tools,
      approval,
    });
    if (createdTask && !requiresApproval) {
      void executeTask(createdTask.id, prompt, [], tools, attachments);
    }
  }, [executeTask, getExecutionSettings]);

  const buildTurnHistory = useCallback(async (
    activeTask: SparkTask,
    targetTurnId: string,
    scopeId: string,
  ): Promise<AiChatMessage[]> => {
    const resolveRequiredAttachments = async (
      attachments: readonly SparkTaskAttachment[] | undefined,
    ) => {
      const resolved = await resolveSparkTaskAttachments(attachments, scopeId);
      if ((attachments?.length ?? 0) !== resolved.length) {
        throw new Error('A file from the task history is no longer available. Reattach it in a new follow-up.');
      }
      return resolved;
    };
    const history: AiChatMessage[] = [{
      role: 'user',
      content: activeTask.prompt,
      attachments: await resolveRequiredAttachments(activeTask.attachments),
    }];
    if (activeTask.response) history.push({ role: 'assistant', content: activeTask.response });

    for (const previousTurn of activeTask.turns) {
      if (previousTurn.id === targetTurnId) break;
      history.push({
        role: 'user',
        content: previousTurn.prompt,
        attachments: await resolveRequiredAttachments(previousTurn.attachments),
      });
      if (previousTurn.response) history.push({ role: 'assistant', content: previousTurn.response });
    }
    return history;
  }, []);

  const executeTurn = useCallback(async (taskId: string, turnId: string) => {
    const executionScope = getActiveSparkStorageScope();
    const activeTask = sparkState.get().tasks.find((candidate) => candidate.id === taskId);
    const turn = activeTask?.turns.find((candidate) => candidate.id === turnId);
    if (!activeTask || !turn) return;
    const tools = activeTask.tools ?? [];
    const execution = getExecutionSettings(turn.prompt, tools);
    const { controller, key: runKey } = beginSparkRun(executionScope, taskId);
    const isCurrentRun = () => sparkRunControllers.get(runKey) === controller
      && getActiveSparkStorageScope() === executionScope
      && Boolean(sparkState.get().tasks.find((candidate) => candidate.id === taskId)
        ?.turns.some((candidate) => candidate.id === turnId));

    updateSparkTaskTurn(taskId, turnId, {
      response: '',
      modelLabel: execution.modelLabel,
      thinkingSteps: [],
      reaction: undefined,
    });
    updateSparkTask(taskId, {
      status: 'running',
      description: 'Working on your follow-up',
      progressLabel: 'Thinking',
    });
    if (!execution.apiKey) {
      updateSparkTaskTurn(taskId, turnId, {
        response: `Add an API key for ${execution.provider} in Settings > Models, then retry this follow-up.`,
        modelLabel: execution.modelLabel,
      });
      updateSparkTask(taskId, {
        status: 'failed',
        description: 'A model API key is required',
        progressLabel: 'Could not start',
      });
      finishSparkRun(runKey, controller);
      return;
    }

    let response = '';
    let thinkingSteps: string[] = [];
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    const publishResponse = () => {
      publishTimer = undefined;
      if (isCurrentRun()) updateSparkTaskTurnResponseTransient(taskId, turnId, response);
    };
    const publishThought = (thought: string) => {
      const nextSteps = appendDisplayableThinkingSteps(thinkingSteps, thought);
      if (nextSteps === thinkingSteps) return;
      thinkingSteps = nextSteps;
      if (isCurrentRun()) updateSparkTaskTurnThinkingTransient(taskId, turnId, thinkingSteps);
    };

    try {
      const history = await buildTurnHistory(activeTask, turnId, executionScope);
      const resolvedAttachments = await resolveSparkTaskAttachments(turn.attachments, executionScope);
      if ((turn.attachments?.length ?? 0) !== resolvedAttachments.length) {
        throw new Error('One or more attached files are no longer available. Reattach them and retry.');
      }
      await streamChat(
        [...history, {
          role: 'user',
          content: turn.prompt,
          attachments: resolvedAttachments,
        }],
        {
          provider: execution.provider,
          model: execution.model,
          apiKey: execution.apiKey,
          thinkingLevel: execution.thinkingLevel,
          includeThoughts: execution.thinkingLevel > 0,
          enableSearch: execution.enableSearch,
          enableCodeExecution: execution.enableCodeExecution,
          baseUrl: execution.baseUrl,
          signal: controller.signal,
        },
        (token: string) => {
          if (!isCurrentRun()) return;
          response += token;
          if (!publishTimer) publishTimer = setTimeout(publishResponse, 80);
        },
        () => undefined,
        buildSystemPrompt(tools),
        (phase: StreamPhase) => {
          if (isCurrentRun() && !response) updateSparkTask(taskId, { progressLabel: getPhaseLabel(phase) });
        },
        async (name: string) => ({
          status: 'unavailable',
          error: `The ${name} tool is not connected to this Spark runtime. Do not claim that it succeeded.`,
        }),
        publishThought,
      );
      if (publishTimer) clearTimeout(publishTimer);
      if (!isCurrentRun()) return;
      updateSparkTaskTurn(taskId, turnId, {
        response: response.trim() || 'The follow-up completed without a text response.',
        modelLabel: execution.modelLabel,
        thinkingSteps,
      });
      updateSparkTask(taskId, {
        status: 'complete',
        description: 'Task updated',
        progressLabel: 'Done',
      });
    } catch (error) {
      if (publishTimer) clearTimeout(publishTimer);
      if (isAbortError(error) || controller.signal.aborted) return;
      if (!isCurrentRun()) return;
      updateSparkTaskTurn(taskId, turnId, {
        response: response.trim() || `Something went wrong: ${error instanceof Error ? error.message : 'Unknown error.'}`,
        modelLabel: execution.modelLabel,
        thinkingSteps,
      });
      updateSparkTask(taskId, {
        status: 'failed',
        description: 'Follow-up failed',
        progressLabel: 'Failed',
      });
    } finally {
      finishSparkRun(runKey, controller);
    }
  }, [buildSystemPrompt, buildTurnHistory, getExecutionSettings]);

  const submitFollowUp = useCallback((
    taskId: string,
    prompt: string,
    attachments: SparkTaskAttachment[] = [],
    tools: string[] = [],
  ) => {
    const activeTask = sparkState.get().tasks.find((candidate) => candidate.id === taskId);
    if (!activeTask
      || activeTask.status === 'running'
      || activeTask.status === 'queued'
      || activeTask.status === 'needs-input'
      || (activeTask.approval && activeTask.approvalDecision !== 'allowed')) return false;
    const turn = appendSparkTaskTurn(taskId, { prompt, response: '', attachments });
    if (!turn) return false;
    updateSparkTask(taskId, {
      tools: [...new Set([...(activeTask.tools ?? []), ...tools])],
    });
    void executeTurn(taskId, turn.id);
    return true;
  }, [executeTurn]);

  const retryTask = useCallback((taskId: string) => {
    const retryTarget = sparkState.get().tasks.find((candidate) => candidate.id === taskId);
    if (!retryTarget) return;
    if (retryTarget.approval && retryTarget.approvalDecision !== 'allowed') {
      updateSparkTask(taskId, {
        status: 'needs-input',
        approvalDecision: undefined,
        description: 'Waiting for your approval',
        progressLabel: 'Approval needed',
        response: 'Before I open the browser and proceed, I need you to confirm you are ok to use it.',
        reaction: undefined,
      });
      return;
    }
    if (!getExecutionSettings(retryTarget.prompt, retryTarget.tools ?? []).apiKey) {
      void executeTask(
        taskId,
        retryTarget.prompt,
        [],
        retryTarget.tools ?? [],
        retryTarget.attachments ?? [],
      );
      return;
    }
    const removedAttachmentIds = retryTarget.turns
      .flatMap((turn) => (turn.attachments ?? []).map((attachment) => attachment.id));
    if (retryTarget.turns.length) updateSparkTask(taskId, { turns: [] });
    if (removedAttachmentIds.length) {
      void deleteSparkAttachmentPayloads(
        removedAttachmentIds,
        getActiveSparkStorageScope(),
      ).catch(() => undefined);
    }
    void executeTask(
      taskId,
      retryTarget.prompt,
      [],
      retryTarget.tools ?? [],
      retryTarget.attachments ?? [],
    );
  }, [executeTask, getExecutionSettings]);

  const retryTurn = useCallback((taskId: string, turnId: string) => {
    const retryTarget = sparkState.get().tasks.find((candidate) => candidate.id === taskId);
    const turnIndex = retryTarget?.turns.findIndex((turn) => turn.id === turnId) ?? -1;
    if (!retryTarget || turnIndex < 0) return;
    const retryTurnTarget = retryTarget.turns[turnIndex];
    if (!getExecutionSettings(retryTurnTarget.prompt, retryTarget.tools ?? []).apiKey) {
      void executeTurn(taskId, turnId);
      return;
    }
    const removedTurns = retryTarget.turns.slice(turnIndex + 1);
    if (removedTurns.length) {
      updateSparkTask(taskId, { turns: retryTarget.turns.slice(0, turnIndex + 1) });
      void deleteSparkAttachmentPayloads(
        removedTurns.flatMap((turn) => (turn.attachments ?? []).map((attachment) => attachment.id)),
        getActiveSparkStorageScope(),
      ).catch(() => undefined);
    }
    void executeTurn(taskId, turnId);
  }, [executeTurn, getExecutionSettings]);

  const changeResponseReaction = useCallback((
    taskId: string,
    turnId: string | null,
    reaction: SparkReaction,
  ) => {
    if (turnId) setSparkTaskTurnReaction(taskId, turnId, reaction);
    else setSparkTaskReaction(taskId, reaction);
  }, []);

  const editSparkMessage = useCallback((taskId: string, turnId: string | null, nextPrompt: string) => {
    const prompt = nextPrompt.trim();
    if (!prompt) return;
    if (turnId) updateSparkTaskTurn(taskId, turnId, { prompt });
    else updateSparkTask(taskId, { prompt, title: prompt });
  }, []);

  const deleteTaskWithAttachments = useCallback((taskId: string) => {
    const deleteTarget = sparkState.get().tasks.find((candidate) => candidate.id === taskId);
    if (!deleteTarget) return;
    const scopeId = getActiveSparkStorageScope();
    sparkRunControllers.get(`${scopeId}:${taskId}`)?.abort();
    if (deleteSparkTask(taskId)) {
      void deleteSparkAttachmentPayloads(getTaskAttachmentIds(deleteTarget), scopeId).catch(() => undefined);
    }
  }, []);

  const changeScheduleEnabled = useCallback((scheduleId: string, enabled: boolean) => {
    const activeSchedule = sparkState.get().schedules.find((candidate) => candidate.id === scheduleId);
    if (!activeSchedule) return;
    updateSparkSchedule(scheduleId, {
      enabled,
      ...(enabled ? { nextRunAt: getNextScheduleRunAt(activeSchedule) } : {}),
    });
  }, []);

  const closeEditor = useCallback((editorPage: 'schedule-editor' | 'skill-editor', fallback: 'schedules' | 'skills') => {
    const historyLocation = window.history.state?.[SPARK_HISTORY_STATE_KEY] as { page?: string } | undefined;
    if (historyLocation?.page === editorPage && window.history.length > 1) {
      window.history.back();
      window.setTimeout(() => {
        if (sparkState.get().location.page === editorPage) {
          replaceSparkLocation({ page: fallback });
        }
      }, 160);
      return;
    }
    replaceSparkLocation({ page: fallback });
  }, []);

  const requestStructuredSuggestion = useCallback(async (prompt: string): Promise<Record<string, unknown>> => {
    const savedGeminiModels = modelConfig?.gemini?.savedModels ?? [];
    const selectedGeminiModel = savedGeminiModels.find((model: any) => model.id === selectedModelId)
      ?? savedGeminiModels[0];
    const apiKey = (apiKeys as unknown as Record<string, string[] | undefined> | undefined)?.gemini
      ?.find((key) => key.trim())
      ?.trim();
    if (!apiKey) throw new Error('Add a Gemini API key in Settings > Models first.');
    const model = selectedGeminiModel?.modelId ?? modelConfig?.gemini?.model ?? 'gemini-3.6-flash';
    const thinkingLevel = Number(
      selectedGeminiModel?.thinkingLevel ?? modelConfig?.gemini?.thinkingLevel ?? 0,
    );
    let response = '';
    await streamChat(
      [{ role: 'user', content: prompt }],
      {
        provider: 'gemini',
        model,
        apiKey,
        thinkingLevel,
        includeThoughts: false,
        enableSearch: false,
        enableCodeExecution: false,
        baseUrl: modelConfig?.gemini?.baseUrl,
      },
      (token: string) => { response += token; },
      () => undefined,
      'Return only one valid JSON object. Do not use Markdown fences or explanatory text.',
      undefined,
      async (name: string) => ({ status: 'unavailable', error: `${name} is unavailable.` }),
    );
    const start = response.indexOf('{');
    const end = response.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('The model did not return a JSON object.');
    const parsed = JSON.parse(response.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('The model returned an invalid suggestion.');
    }
    return parsed as Record<string, unknown>;
  }, [apiKeys, modelConfig, selectedModelId]);

  const askGeminiForSchedule = useCallback(async (
    draft: SparkScheduleDraft,
  ): Promise<Partial<SparkScheduleDraft>> => {
    const suggestion = await requestStructuredSuggestion(
      `Improve this recurring schedule. Preserve the user's intent and return fields title, frequency (Daily or Weekly), `
      + `weekdays (full English weekday names), time (24-hour HH:mm), and instructions. Current draft: ${JSON.stringify(draft)}`,
    );
    const weekdays = Array.isArray(suggestion.weekdays)
      ? suggestion.weekdays.filter((weekday): weekday is SparkScheduleWeekday =>
          typeof weekday === 'string'
          && SPARK_SCHEDULE_WEEKDAYS.includes(weekday as SparkScheduleWeekday))
      : undefined;
    return {
      title: typeof suggestion.title === 'string' ? suggestion.title : draft.title,
      frequency: suggestion.frequency === 'Daily' ? 'Daily' : suggestion.frequency === 'Weekly' ? 'Weekly' : draft.frequency,
      weekdays: weekdays?.length ? weekdays : draft.weekdays,
      time: typeof suggestion.time === 'string' && /^(?:[01]\d|2[0-3]):(?:00|30)$/.test(suggestion.time)
        ? suggestion.time
        : draft.time,
      instructions: typeof suggestion.instructions === 'string' ? suggestion.instructions : draft.instructions,
    };
  }, [requestStructuredSuggestion]);

  const askGeminiForSkill = useCallback(async (
    draft: SparkSkillDraft,
  ): Promise<Partial<SparkSkillDraft>> => {
    const suggestion = await requestStructuredSuggestion(
      `Improve this reusable AI skill. Return fields name, description, and instructions. Make the instructions specific, `
      + `practical, and reusable. Current draft: ${JSON.stringify(draft)}`,
    );
    return {
      name: typeof suggestion.name === 'string' ? suggestion.name : draft.name,
      description: typeof suggestion.description === 'string' ? suggestion.description : draft.description,
      instructions: typeof suggestion.instructions === 'string' ? suggestion.instructions : draft.instructions,
    };
  }, [requestStructuredSuggestion]);

  const importSkill = useCallback(async (file: File) => {
    const importScope = getActiveSparkStorageScope();
    const isZip = file.type === 'application/zip' || /\.zip$/i.test(file.name);
    let instructions = '';
    let sourceName = file.name;
    if (isZip) {
      if (file.size > 5_000_000) throw new Error('The skill ZIP is too large.');
      const { default: JSZip } = await import('jszip');
      const archive = await JSZip.loadAsync(file);
      const candidates = Object.values(archive.files)
        .filter((entry) => !entry.dir && /(?:^|\/)(?:skill\.md|[^/]+\.(?:md|txt))$/i.test(entry.name))
        .sort((left, right) => Number(/(?:^|\/)skill\.md$/i.test(right.name))
          - Number(/(?:^|\/)skill\.md$/i.test(left.name)));
      const entry = candidates[0];
      if (!entry) throw new Error('The ZIP does not contain SKILL.md, Markdown, or text instructions.');
      const expandedSize = Number((entry as any)._data?.uncompressedSize ?? 0);
      if (expandedSize > 500_000) throw new Error('The skill instructions in this ZIP are too large.');
      instructions = await entry.async('string');
      sourceName = entry.name.split('/').pop() || entry.name;
    } else {
      if (file.size > 1_000_000) throw new Error('The skill file is too large.');
      instructions = await file.text();
    }
    instructions = instructions.trim();
    if (!instructions || instructions.length > 500_000) throw new Error('The skill instructions are empty or too large.');
    if (getActiveSparkStorageScope() !== importScope) {
      throw new Error('The active account changed before the skill could be imported.');
    }

    const heading = instructions.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const fallbackName = sourceName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Imported skill';
    const created = createSparkSkill({
      name: heading || fallbackName,
      description: `Imported from ${file.name}`,
      instructions,
      source: 'upload',
      fileName: file.name,
    });
    if (!created) throw new Error('Could not create the imported skill.');
  }, []);

  useEffect(() => {
    let disposed = false;
    const checkSchedules = async () => {
      if (disposed || schedulerBusyRef.current) return;
      schedulerBusyRef.current = true;
      try {
        const now = new Date();
        const currentSchedules = sparkState.get().schedules;
        for (const currentSchedule of currentSchedules) {
          if (!currentSchedule.enabled) continue;
          const nextRunTime = currentSchedule.nextRunAt
            ? new Date(currentSchedule.nextRunAt).getTime()
            : Number.NaN;
          if (!Number.isFinite(nextRunTime)) {
            updateSparkSchedule(currentSchedule.id, {
              nextRunAt: getNextScheduleRunAt(currentSchedule, now),
            });
            continue;
          }
          if (nextRunTime > now.getTime()) continue;

          const expectedNextRunAt = currentSchedule.nextRunAt!;
          const claimAndRun = async () => {
            if (disposed || !isSparkScheduleRunClaimCurrent(currentSchedule.id, expectedNextRunAt)) return;
            const claimedAt = new Date();
            const nextRunAt = getNextScheduleRunAt(
              currentSchedule,
              new Date(claimedAt.getTime() + 1000),
            );
            const requiresApproval = BROWSER_REQUEST_PATTERN.test(currentSchedule.instructions);
            updateSparkSchedule(currentSchedule.id, {
              lastRunLabel: requiresApproval ? 'Waiting for approval' : 'Running...',
              nextRunAt,
            });
            const scheduledTask = createSparkTask(currentSchedule.instructions, {
              title: currentSchedule.title,
              description: requiresApproval ? 'Waiting for your approval' : 'Scheduled task started',
              status: requiresApproval ? 'needs-input' : 'running',
              response: requiresApproval
                ? 'Before I open the browser and proceed, I need you to confirm you are ok to use it.'
                : '',
              progressLabel: requiresApproval ? 'Approval needed' : 'Working',
              scheduledLabel: currentSchedule.title,
              scheduledTime: formatScheduledDate(expectedNextRunAt),
              approval: requiresApproval ? {
                kind: 'browser',
                title: 'Let Gemini interact with websites for you?',
                description: 'To work on your tasks, Gemini will need to use a browser:',
                prompt: currentSchedule.instructions,
              } : undefined,
              openTask: false,
            });
            if (!scheduledTask) {
              updateSparkSchedule(currentSchedule.id, {
                lastRunLabel: 'Failed',
                lastRunAt: new Date().toISOString(),
              });
              return;
            }
            updateSparkSchedule(currentSchedule.id, { taskId: scheduledTask.id });
            if (!requiresApproval) {
              void executeTask(scheduledTask.id, currentSchedule.instructions);
            }
          };

          const locks = (navigator as Navigator & {
            locks?: { request: (name: string, callback: () => Promise<void>) => Promise<void> };
          }).locks;
          if (locks?.request) {
            await locks.request(
              `willow-spark-schedule:${getActiveSparkStorageScope()}:${currentSchedule.id}`,
              claimAndRun,
            );
          } else {
            await claimAndRun();
          }
        }
      } finally {
        schedulerBusyRef.current = false;
      }
    };

    void checkSchedules();
    const timer = window.setInterval(() => { void checkSchedules(); }, 30_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [executeTask, user?.uid]);

  if (backgroundOnly) return null;

  if (location.page === 'task' && task) {
    return (
      <SparkTaskDetail
        task={task}
        tasks={orderedTasks}
        schedule={taskSchedule}
        onOpenTask={goToSparkTask}
        onCreateTask={createTask}
        onBack={goToAllSparkTasks}
        onRenameTask={renameSparkTask}
        onDeleteTask={deleteTaskWithAttachments}
        onTogglePin={toggleSparkTaskPinned}
        onEditMessage={editSparkMessage}
        onSubmitFollowUp={submitFollowUp}
        onResponseReactionChange={changeResponseReaction}
        onRetryTask={retryTask}
        onRetryTurn={retryTurn}
        computerUse={task.approval?.kind === 'browser' && task.approvalDecision === 'allowed' ? (
          <SparkComputerUsePanel
            taskId={task.id}
            prompt={task.approval.prompt || task.prompt}
            apiKey={computerUseApiKey}
            autoStart={task.status === 'running' && !task.response}
            conversationHistory={[
              { role: 'user' as const, content: task.prompt },
              ...(task.response ? [{ role: 'assistant' as const, content: task.response }] : []),
              ...task.turns.flatMap((turn) => [
                { role: 'user' as const, content: turn.prompt },
                ...(turn.response ? [{ role: 'assistant' as const, content: turn.response }] : []),
              ]),
            ]}
            onProgress={(message) => {
              updateSparkTask(task.id, {
                status: 'running',
                description: 'Using the local browser',
                progressLabel: message,
              });
            }}
            onResponse={(response) => {
              updateSparkTaskResponseTransient(task.id, response);
            }}
            onComplete={(result, stopped) => {
              const status = stopped
                ? 'cancelled' as const
                : result.completed || result.limited
                  ? 'complete' as const
                  : 'failed' as const;
              const progressLabel = stopped
                ? 'Stopped'
                : result.completed
                  ? 'Done'
                  : result.limited
                    ? 'Limited access'
                    : 'Failed';
              updateSparkTask(task.id, {
                status,
                description: result.completed
                  ? 'Browser task completed'
                  : result.limited
                    ? 'Browser opened with limited local access'
                    : stopped
                      ? 'Browser task stopped'
                      : 'Browser task failed',
                progressLabel,
                response: result.explanation,
              });
              updateLinkedScheduleRunStatus(
                task.id,
                result.completed ? 'Completed' : result.limited ? 'Limited access' : stopped ? 'Stopped' : 'Failed',
                true,
              );
            }}
          />
        ) : undefined}
        onRespondToApproval={(_taskId, allowed) => {
          updateSparkTask(task.id, allowed
            ? {
                status: 'running',
                approvalDecision: 'allowed',
                description: 'Continuing with the approved task',
                progressLabel: 'Opening the local browser',
                response: '',
              }
            : {
                status: 'cancelled',
                approvalDecision: 'denied',
                description: 'Browser access was not allowed',
                progressLabel: 'Stopped',
                response: 'I stopped before opening the website.',
              });
          if (allowed) {
            // The task-oriented computer-use panel owns the iframe and starts
            // its local action loop as soon as the approved frame is ready.
          } else {
            updateLinkedScheduleRunStatus(task.id, 'Skipped', true);
          }
        }}
        onScheduleEnabledChange={changeScheduleEnabled}
      />
    );
  }

  if (location.page === 'all-tasks') {
    return (
      <SparkAllTasks
        tasks={orderedTasks}
        onSubmit={createTask}
        onOpenTask={goToSparkTask}
        onRenameTask={renameSparkTask}
        onTogglePin={toggleSparkTaskPinned}
        onDeleteTask={deleteTaskWithAttachments}
      />
    );
  }

  if (location.page === 'schedule-editor') {
    return (
      <SparkScheduleEditor
        recordKey={schedule?.id ?? 'new-schedule'}
        isEditing={Boolean(schedule)}
        initialDraft={schedule ? {
          title: schedule.title,
          frequency: schedule.frequency,
          weekdays: schedule.weekdays as SparkScheduleWeekday[],
          time: schedule.time,
          instructions: schedule.instructions,
          enabled: schedule.enabled,
        } : undefined}
        onBack={() => closeEditor('schedule-editor', 'schedules')}
        onAskGemini={askGeminiForSchedule}
        onDelete={schedule ? () => {
          deleteSparkSchedule(schedule.id);
          closeEditor('schedule-editor', 'schedules');
        } : undefined}
        onLearnMore={() => window.open('https://support.google.com/gemini?p=scheduled_actions', '_blank', 'noopener,noreferrer')}
        onSubmit={(draft) => {
          const input = {
            title: draft.title,
            frequency: draft.frequency,
            weekdays: draft.weekdays,
            time: draft.time,
            instructions: draft.instructions,
            enabled: draft.enabled,
            taskId: schedule?.taskId,
            lastRunLabel: schedule?.lastRunLabel,
            lastRunAt: schedule?.lastRunAt,
            nextRunAt: getNextScheduleRunAt(draft),
          };
          if (schedule) {
            updateSparkSchedule(schedule.id, input);
          } else {
            createSparkSchedule(input);
          }
          closeEditor('schedule-editor', 'schedules');
        }}
      />
    );
  }

  if (location.page === 'skill-editor') {
    const template = location.template?.trim();
    const templateDraft = template ? {
      name: template,
      description: `Reusable guidance to ${template.charAt(0).toLowerCase()}${template.slice(1)}`,
      instructions: `When this skill is relevant, help me ${template.toLowerCase()}. Ask for any context you need, then provide a clear and practical result.`,
      source: 'recommended' as const,
    } : undefined;

    return (
      <SparkSkillEditor
        recordKey={skill?.id ?? `new-skill:${location.mode}:${location.template ?? ''}`}
        mode={location.mode === 'recommended' ? 'recommended' : location.mode}
        isEditing={Boolean(skill)}
        initialDraft={skill ? {
          name: skill.name,
          description: skill.description,
          instructions: skill.instructions,
          source: skill.source,
          fileName: skill.fileName,
        } : templateDraft}
        onBack={() => closeEditor('skill-editor', 'skills')}
        onAskGemini={askGeminiForSkill}
        onDelete={skill ? () => {
          deleteSparkSkill(skill.id);
          closeEditor('skill-editor', 'skills');
        } : undefined}
        onLearnMore={() => window.open('https://support.google.com/gemini?p=skills', '_blank', 'noopener,noreferrer')}
        onSubmit={(draft) => {
          if (skill) updateSparkSkill(skill.id, draft);
          else createSparkSkill(draft);
          closeEditor('skill-editor', 'skills');
        }}
      />
    );
  }

  if (location.page === 'schedules') {
    return (
      <SchedulesPage
        schedules={schedules}
        onCreateManually={() => goToSparkScheduleEditor()}
        onCreateWithGemini={() => createTask('Help me schedule a task.', [], [], 'Creating a schedule')}
        onDeleteSchedule={deleteSparkSchedule}
        onScheduleEnabledChange={changeScheduleEnabled}
        onLearnMore={() => window.open('https://support.google.com/gemini?p=scheduled_actions', '_blank', 'noopener,noreferrer')}
        onOpenSchedule={goToSparkScheduleEditor}
      />
    );
  }

  if (location.page === 'skills') {
    return (
      <SkillsPage
        skills={skills}
        onCreateManually={() => goToSparkSkillEditor('manual')}
        onCreateWithGemini={() => createTask('Help me create a skill.', [], [], 'Creating a skill')}
        onDeleteSkill={deleteSparkSkill}
        onLearnMore={() => window.open('https://support.google.com/gemini?p=skills', '_blank', 'noopener,noreferrer')}
        onOpenSkill={(skillId) => goToSparkSkillEditor('manual', { skillId })}
        onRecommendedSkillSelect={(template) => goToSparkSkillEditor('recommended', { template })}
        onUploadSkill={importSkill}
      />
    );
  }

  if (location.page === 'apps') {
    return (
      <ConnectedAppsPage
        connections={connections}
        customApps={customApps}
        onAddCustomApp={(url) => Boolean(createSparkCustomApp({ name: '', url }))}
        onConnectionChange={setSparkAppConnection}
        onCustomAppConnectionChange={setSparkCustomAppConnected}
        onDeleteCustomApp={deleteSparkCustomApp}
        onPhotosSettings={() => window.open('https://photos.google.com/settings', '_blank', 'noopener,noreferrer')}
        onPromptSelect={(prompt, appId) => createTask(prompt, [], [`app:${appId}`])}
      />
    );
  }

  return (
    <SparkHome
      tasks={orderedTasks.slice(0, 3)}
      onSubmitTask={createTask}
      onOpenTask={goToSparkTask}
      onViewAllTasks={goToAllSparkTasks}
      onOpenWhatsNew={() => window.open('https://gemini.google.com/updates', '_blank', 'noopener,noreferrer')}
      onTrendingSelect={() => undefined}
    />
  );
};

export const sparkWorkspaceNavigation = {
  home: goToSparkHome,
  tasks: goToAllSparkTasks,
  schedules: goToSparkSchedules,
  skills: goToSparkSkills,
  apps: goToSparkApps,
};

export default SparkWorkspace;
