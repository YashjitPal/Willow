/**
 * The always-on part of a dot: what wakes it, and what happens when it wakes.
 *
 * A bot has no request/response cycle. It has an inbox — the user's messages and
 * events — and a turn runs whenever something new is in it and the bot is not
 * already busy. Things that put something in the inbox:
 *
 * - the user writing (`sendDotMessage`);
 * - a sleep ending, or a routine coming due (timers here, re-armed after every
 *   turn and on start-up, and honoured late if Willow was closed);
 * - a Spark task the bot assigned finishing or needing input (a subscription to
 *   Spark's store);
 * - a background helper finishing;
 * - its triggers firing, and quiet moments for research.
 *
 * Being created wakes nothing: a new bot's conversation starts empty.
 *
 * One turn runs per bot at a time, across tabs: a Web Lock named for the bot
 * serialises them, and whichever tab holds it does the work while the others
 * see the results through the thread store's broadcast. A message that arrives
 * mid-turn needs no special path — it is appended to the thread, and the turn
 * loop sees it on its next request.
 *
 * Compaction runs in the background after turns, never blocking one, except in
 * the rare case where a request would overflow — then it runs first.
 */
import { atom } from 'nanostores';
import type { AiOptions, Attachment } from '@willow/ai/chat';
import { savedInfoBlock } from '@willow/chat/chat-model';
import { isAppInBackground, isDesktopApp, requestNotificationPermission, showNotification, type WillowNotification } from '@willow/core/desktop-bridge';
import {
  canSendMail,
  connectionsStore,
  mailReplyContext,
  PERSONAL_DATA_LADDER,
  PERSONAL_RETRIEVAL_GUIDANCE,
  profileBlock,
  profileStore,
  READ_TOOLS,
  sendApprovedMail,
  watchableApps,
  watchCalendar,
  watchGithub,
  watchMail,
} from '@willow/personal';
import { createOpfsWorkspace, emptySparkWorkspace, type SparkWorkspace } from '../../harness/workspace/workspace';
import { getSparkTaskById, sparkState, sparkTasks } from '../../spark-store';
import { getSparkTaskHost, onSparkTaskHost, waitForSparkTaskHost, type SparkHostModel, type SparkTaskHost } from '../../spark-task-host';
import { sparkDotName, sparkDots, type SparkDot } from '../dots-store';
import { budgetsFor, type DotBudgets } from './memory/budgets';
import { compactDotThread, compactionTiming, needsCompaction, PROMPT_CACHE_MS, type DotSummarizer } from './memory/compaction';
import { learnAboutUser, learnedBlock, learningDue } from './memory/learning';
import { buildDotContext, uncoveredTailTokens } from './memory/context-builder';
import { formatAgo, formatStamp } from './memory/render';
import { calibrateCharsPerToken } from './memory/tokens';
import { createDotSystemPrompt } from './overlay/dot-profile';
import { DotContextOverflowError, defaultDotTransport, runDotTurn, type DotTransport, type DotTurnResult } from './runtime/dot-loop';
import { onDotHelperFinished, runningHelpersFor, stopDotHelpersFor, type DotHelper } from './runtime/helpers';
import type { DotHarnessEvent } from './runtime/protocol';
import {
  approveCommand,
  connectComputer,
  connectWholeComputer,
  declineCommand,
  disconnectComputer,
  forgetCommandPrefix,
  settleInterruptedCommands,
  stopDotJobs,
  stopJob,
  watchDotJobs,
  type DotComputerDeps,
} from './runtime/computer-access';
import { companionComputer, companionReachable, companionRequest, computerProblem, type DotComputerBridge } from './runtime/computer-bridge';
import { phonePush, pushToPhone } from './runtime/phone-push';
import { reactOnTelegram, readTelegram, sendTelegram, setTelegramLink, showTelegramTyping, telegramLink, type TelegramRelay } from './runtime/telegram';
import {
  classifyDiscordEvent,
  describeDiscordMessage,
  discordReplyTarget,
  discordLinkFor,
  discordLinks,
  discordStateFor,
  discordUnreachable,
  openDiscordDm,
  patchDiscordState,
  quoteForDiscord,
  reactOnDiscord,
  readAppSettings,
  readDiscordChannel,
  rememberQuoted,
  rememberSent,
  sendToDiscord,
  setDiscordLink,
  showDiscordTyping,
  unreactOnDiscord,
  verifyDiscordToken,
  whereOf,
  type DiscordEvent,
  type DiscordLink,
  type DiscordMethod,
  type DiscordNext,
  type DiscordRelay,
} from './runtime/discord';
import { applyProposedEdit, declineProposedEdit, pendingEdits, settleInterruptedEdits } from './runtime/edits';
import { canvasRender, visionProfile } from './runtime/screen-view';
import { companionScreen, type DotScreenBridge } from './runtime/screen-bridge';
import { allowScreen, declineScreen, onScreenGrantEnded, pendingScreenRequests, stopScreen, type DotScreenDeps } from './runtime/screen-control';
import { forgetScreenOverlay, hideScreenOverlay } from './runtime/screen-overlay';
import { CONTINUE_EVENT, planNext, reflectEvent } from './runtime/plan';
import {
  declineOutgoing,
  describeOutgoing,
  pendingOutgoing,
  sendOutgoing,
  stopEmailingWithoutAsking,
  stopPostingWithoutAsking,
  type DotMailDeps,
} from './runtime/outgoing';
import {
  declineMachineSetup,
  dismissHelp,
  enterSecret,
  handBackMachine,
  removeMachine,
  resetMachine,
  setUpMachine,
  takeOverMachine,
  turnOffMachine,
  turnOnMachine,
  watchDotMachines,
  type DotMachineDeps,
} from './runtime/machine-access';
import { companionMachine, setDotMachineLook, type DotMachineBridge, type DotMachineLook } from './runtime/machine-bridge';
import { dotBrowserColors, dotWallpaperColors } from '../computer/dot-wallpaper';
import { dotTintHex } from '../dot-tint';
import { withWebLock } from './runtime/web-lock';
import { fireTimeTriggers, forgetDiscordGathered, hearDiscord, hearReturn, hearSparkTasks, nextTimeTriggerAt, runTriggerNow, startTriggerEngine, watchPresence, type FireTrigger } from './triggers/trigger-engine';
import { deleteTrigger, migrateRoutines, setTriggerPaused } from './triggers/trigger-store';
import { SCREEN_SYSTEM, screeningPrompt, screenPasses, type ScreenEvent } from './triggers/trigger-screen';
import type { TriggerSources, WatchedTask } from './triggers/trigger-watch';
import { pendingApprovals } from './tools/computer-tools';
import { openHelpRequests, pendingSetupRequests } from './tools/machine-tools';
import { createDotToolset } from './tools/dot-tools';
import type { DotDiscordAccess, DotToolEnv } from './tools/tool-env';
import { latestSparkResponse } from './tools/spark-task-tools';
import { normalizeReactionEmoji } from './runtime/protocol';
import { allowedInResearch, inQuietHours, isResearchTurn, quietHoursOf, RESEARCH_EVENT, researchDue } from './runtime/proactive';
import { readDotAttachments } from './runtime/dot-attachments';
import { withSentFiles } from './runtime/sent-files';
import { messageExcerpt, plainMessageText, reactionMayAnswer, userReactionsByMessage } from './thread/reactions';
import { appendDotItem, deleteDotThread, dotThreads, getDotThread, loadDotThread, updateDotRuntime, type DotItemDraft } from './thread/thread-store';
import { wakesDot, type DotDiscordPost, type DotDiscordSource, type DotItem, type DotPermissionMode, type DotPlan, type DotThread, type DotTriggerType } from './thread/thread-types';

/* ------------------------------------------------------------------------ */
/* Live activity (what the UI shows while a bot works)                       */
/* ------------------------------------------------------------------------ */

export interface DotActivity {
  working: boolean;
  /** What the bot is doing right now, in a few words, or null. */
  label: string | null;
  /** The message currently being written, if any: the only time "typing…" shows. */
  typingItemId: string | null;
  /** The status line the bot set this turn (`*** Status:`), shown under its name while it works. */
  status?: string | null;
}

export const dotActivity = atom<Record<string, DotActivity>>({});

const setActivity = (dotId: string, patch: Partial<DotActivity>) => {
  const current = dotActivity.get()[dotId] ?? { working: false, label: null, typingItemId: null, status: null };
  dotActivity.set({ ...dotActivity.get(), [dotId]: { ...current, ...patch } });
};

/* ------------------------------------------------------------------------ */
/* Configuration                                                             */
/* ------------------------------------------------------------------------ */

export interface DotNotifier {
  request: () => Promise<boolean>;
  show: (notification: WillowNotification) => Promise<boolean>;
  inBackground: () => boolean;
}

interface RuntimeConfig {
  transport: DotTransport;
  now: () => number;
  timeZone: () => string;
  computer: DotComputerBridge;
  /** The bot's own computer. */
  machine: DotMachineBridge;
  notifier: DotNotifier;
  /** Discord's API and gateway, for bots the user made Discord bots. */
  discord: DiscordRelay;
  /** The user's own screen, mouse and keyboard, with their whole computer connected (desktop app, Windows). */
  screen: DotScreenBridge;
}

const companionDiscord: DiscordRelay = {
  call: <T>(token: string, method: DiscordMethod, path: string, options?: { body?: unknown; query?: Record<string, string | number> }) =>
    companionRequest<{ status: number; body: T }>('discord.call', { token, method, path, ...(options ?? {}) }, 45_000),
  next: (token, options) => companionRequest<DiscordNext>('discord.next', { token, ...options }, options.waitMs + 20_000),
  close: async (token) => {
    await companionRequest('discord.close', { token }, 10_000);
  },
};

const config: RuntimeConfig = {
  transport: defaultDotTransport,
  now: () => Date.now(),
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  computer: companionComputer,
  machine: companionMachine,
  notifier: { request: requestNotificationPermission, show: showNotification, inBackground: isAppInBackground },
  discord: companionDiscord,
  screen: companionScreen,
};

/** Test seam: swap the model transport, the clock, the computers or the notifier. */
export const configureDotRuntime = (patch: Partial<RuntimeConfig>): void => {
  Object.assign(config, patch);
};

/* ------------------------------------------------------------------------ */
/* Per-dot control state                                                     */
/* ------------------------------------------------------------------------ */

interface DotControl {
  running: boolean;
  /** Something arrived while a turn was finishing: run another. */
  again: boolean;
  abort?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  compacting: boolean;
  /** Background compaction failed this many times in a row; the next try waits until `compactAfter`. */
  compactFailures?: number;
  compactAfter?: number;
  /** Turns that failed in a row on something that passes by itself, and the timer for the next try. */
  retries?: number;
  retryTimer?: ReturnType<typeof setTimeout>;
  workspace?: Promise<SparkWorkspace>;
}

const controls = new Map<string, DotControl>();
const control = (dotId: string): DotControl => {
  let entry = controls.get(dotId);
  if (!entry) {
    entry = { running: false, again: false, compacting: false };
    controls.set(dotId, entry);
  }
  return entry;
};

const findDot = (dotId: string): SparkDot | undefined => sparkDots.get().dots.find((dot) => dot.id === dotId);

const machineLook = (dot: SparkDot): DotMachineLook => {
  const tint = dotTintHex(dot);
  return { wallpaper: dotWallpaperColors(tint), browser: dotBrowserColors(tint) };
};

/* ------------------------------------------------------------------------ */
/* The model                                                                 */
/* ------------------------------------------------------------------------ */

const turnOptions = (model: SparkHostModel): Omit<AiOptions, 'signal'> => {
  const { label: _label, effort: _effort, ...options } = model as SparkHostModel & Record<string, unknown>;
  return { ...(options as Omit<AiOptions, 'signal'>), enableSearch: true, includeThoughts: false };
};

const summarizerFor = (model: SparkHostModel): DotSummarizer => async ({ systemPrompt, prompt, signal }) => {
  let text = '';
  await config.transport(
    [{ role: 'user', content: prompt }],
    { ...turnOptions(model), enableSearch: false, enableCodeExecution: false, thinkingLevel: 0, signal } as AiOptions,
    (token) => {
      text += token;
    },
    () => undefined,
    systemPrompt,
    () => undefined,
    async () => ({}),
    () => undefined,
    () => undefined,
  );
  return text;
};

/* ------------------------------------------------------------------------ */
/* What Willow knows about the user                                          */
/* ------------------------------------------------------------------------ */

/**
 * Willow's personal intelligence, assembled as Chat assembles it: Saved Info,
 * then the profile summary, then the rules for using personal data, then the
 * retrieval guidance (the bot is given the retrieval tool whenever Memory is on).
 * All of it answers to the Memory switch.
 */
const aboutUser = (): { text: string; memory: boolean } => {
  const profile = profileStore.get();
  if (!profile.enabled) return { text: '', memory: false };
  const parts = [savedInfoBlock(), profileBlock(profile), PERSONAL_DATA_LADDER, PERSONAL_RETRIEVAL_GUIDANCE];
  return { text: parts.filter(Boolean).join('\n\n'), memory: true };
};

/* ------------------------------------------------------------------------ */
/* Events into the inbox                                                     */
/* ------------------------------------------------------------------------ */

const postEvent = (dotId: string, draft: Omit<DotItemDraft, 'kind'>): DotItem | null => {
  if (!getDotThread(dotId)) return null;
  return appendDotItem(dotId, { kind: 'event', ...draft });
};

const hasUnseenInput = (thread: DotThread): boolean =>
  thread.items.some((item) => item.seq > thread.runtime.lastActedSeq && wakesDot(item));

const SCREEN_TIMEOUT_MS = 30_000;

/**
 * Checks an event against a trigger's condition with one small request to the user's model — the condition and the
 * event, no conversation, no tools, no thinking. Anything that goes wrong lets the event through (trigger-screen.ts).
 */
const screenEvent: ScreenEvent = async (condition, happened) => {
  const model = getSparkTaskHost()?.executionModel();
  if (!model?.apiKey) return true;
  let answer = '';
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SCREEN_TIMEOUT_MS);
  try {
    await config.transport(
      [{ role: 'user', content: screeningPrompt(condition, happened) }],
      { ...turnOptions(model), enableSearch: false, enableCodeExecution: false, thinkingLevel: 0, signal: abort.signal } as AiOptions,
      (token) => {
        answer += token;
      },
      () => undefined,
      SCREEN_SYSTEM,
      () => undefined,
      async () => ({}),
      () => undefined,
      () => undefined,
    );
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
  return screenPasses(answer);
};

/** A trigger fired: its event goes in the inbox, and the bot wakes for it, from a sleep too. */
const postTrigger: FireTrigger = (dotId, trigger, text) => {
  if (!postEvent(dotId, { event: 'trigger', ref: trigger.id, text })) return;
  updateDotRuntime(dotId, (runtime) => (runtime.status === 'sleeping' ? { ...runtime, status: 'idle' } : runtime));
  kick(dotId);
};

/* ------------------------------------------------------------------------ */
/* What triggers watch                                                       */
/* ------------------------------------------------------------------------ */

const PAGE_PROBE_MS = 10 * 60_000;
let pageProbe: { at: number; available: Promise<boolean> } | null = null;

/**
 * Whether this window can read web pages for triggers: through Willow's `/api/fetch-source`. The desktop app always
 * answers it (its server starts on the first request that needs it, so it is not asked just to find out); a hosted
 * deployment does only when it is switched on. Asked without a URL, it answers 400 when it is there and willing — no
 * page is fetched to find out.
 */
const pageWatching = (): Promise<boolean> => {
  if (isDesktopApp()) return Promise.resolve(true);
  if (!pageProbe || config.now() - pageProbe.at > PAGE_PROBE_MS) {
    const available = typeof fetch === 'undefined'
      ? Promise.resolve(false)
      : fetch('/api/fetch-source').then((response) => response.status === 400).catch(() => false);
    pageProbe = { at: config.now(), available };
  }
  return pageProbe.available;
};

const PAGES_UNAVAILABLE = 'watching web pages needs the Willow desktop app';

/** A web page as text, for the bot's `read_web_page`, with failures said for the bot to pass on. */
const readWebPage = async (url: string): Promise<{ text: string; title?: string } | { problem: string }> => {
  try {
    const response = await fetch(`/api/fetch-source?url=${encodeURIComponent(url)}`);
    const payload = await response.json().catch(() => null) as { text?: string; title?: string; error?: string } | null;
    if (!response.ok || typeof payload?.text !== 'string') {
      return { problem: `The page could not be read${payload?.error ? `: ${payload.error}` : ` (HTTP ${response.status})`}.` };
    }
    return { text: payload.text, ...(payload.title ? { title: payload.title } : {}) };
  } catch {
    return { problem: 'The page could not be reached.' };
  }
};

const triggerSources = (): TriggerSources => ({
  mail: (search, known) => watchMail(search, known),
  calendar: (hoursAhead) => watchCalendar(hoursAhead),
  github: (watch) => watchGithub(watch),
  page: async (url) => {
    if (!(await pageWatching())) return { problem: `Willow cannot read web pages here: ${PAGES_UNAVAILABLE}.` };
    try {
      const response = await fetch(`/api/fetch-source?url=${encodeURIComponent(url)}`);
      const payload = await response.json().catch(() => null) as { text?: string; title?: string; error?: string } | null;
      if (!response.ok || typeof payload?.text !== 'string') return { problem: `The page could not be read${payload?.error ? ` (${payload.error})` : ''}; Willow will try again.` };
      return { text: payload.text, ...(payload.title ? { title: payload.title } : {}) };
    } catch {
      return { problem: 'The page could not be reached; Willow will try again.' };
    }
  },
  folder: async (root, path) => {
    try {
      const listing = await config.computer.listFiles(root, path, 4);
      return { entries: listing.entries, truncated: listing.truncated };
    } catch (error) {
      return { problem: `The folder could not be read (${error instanceof Error ? error.message : 'Willow\'s companion is not running'}); Willow will try again.` };
    }
  },
});

/** What this window's triggers cannot watch, each with the reason the bot passes on. */
const triggerLimits = async (thread: DotThread): Promise<Partial<Record<DotTriggerType, string>>> => {
  const apps = watchableApps();
  const off = !profileStore.get().enabled ? 'Personal Intelligence is off in Willow\'s settings' : null;
  const limits: Partial<Record<DotTriggerType, string>> = {};
  if (!apps.gmail) limits.email = off ?? 'Gmail is not connected (Settings → Connected Apps)';
  if (!apps.calendar) limits.calendar = off ?? 'Google Calendar is not connected (Settings → Connected Apps)';
  if (!apps.github) limits.github = off ?? 'GitHub is not connected (Settings → Connected Apps)';
  if (!(await pageWatching())) limits.web_page = PAGES_UNAVAILABLE;
  if (!thread.runtime.computer) limits.folder = 'the user has not connected a folder on their computer (from your profile)';
  if (!discordLinkFor(thread.dotId)) limits.discord = 'you are not on Discord yet: the user sets that up from the Discord button under your name in your profile';
  return limits;
};

const sparkTaskList = (): WatchedTask[] => sparkTasks.get().map((task) => ({ id: task.id, title: task.title, status: task.status }));

const STATUS_SENTENCES: Record<string, string> = {
  complete: 'has finished',
  failed: 'has failed',
  cancelled: 'was stopped',
  'needs-input': 'is waiting for input (a question or a permission)',
};

const latestTaskResponse = (taskId: string): string => {
  const task = getSparkTaskById(taskId);
  return task ? latestSparkResponse(task) ?? '' : '';
};

const reportSparkTasks = (): void => {
  const tasks = sparkTaskList();
  for (const [dotId] of controls) {
    const thread = getDotThread(dotId);
    if (!thread) continue;
    // The bot's own Spark-task triggers, for tasks it did not assign: those it hears about below.
    if (thread.runtime.status !== 'paused' && thread.runtime.triggers?.some((trigger) => trigger.status === 'active' && trigger.when.type === 'spark_task')) {
      const excluded = new Set(thread.runtime.delegations.filter((delegation) => delegation.kind === 'spark-task').map((delegation) => delegation.id));
      void hearSparkTasks(dotId, tasks, { excluded, latestResponse: latestTaskResponse, now: config.now(), screen: screenEvent }, postTrigger);
    }
    let changed = false;
    let posted = false;
    const delegations = thread.runtime.delegations.map((delegation) => {
      if (delegation.kind !== 'spark-task') return delegation;
      const task = getSparkTaskById(delegation.id);
      if (!task || task.status === delegation.status) return delegation;
      const sentence = STATUS_SENTENCES[task.status];
      if (sentence) {
        const response = latestSparkResponse(task);
        const excerpt = response
          ? `\nLatest response (start):\n${response.slice(0, 1_500)}${response.length > 1_500 ? `\n[… ${(response.length - 1_500).toLocaleString('en-US')} more characters; read it with check_spark_task]` : ''}`
          : '';
        postEvent(dotId, { event: 'spark-task', ref: task.id, text: `Spark task "${task.title}" (${task.id}) ${sentence}.${excerpt}` });
        posted = true;
      }
      changed = true;
      return { ...delegation, status: task.status, updatedAt: config.now() };
    });
    if (changed) updateDotRuntime(dotId, { delegations });
    // Spark's store changes on every streamed token; only a reported change wakes the bot.
    if (posted) kick(dotId);
  }
};

const reportHelper = (helper: DotHelper): void => {
  if (!getDotThread(helper.dotId)) return;
  const outcome = helper.status === 'complete' ? 'finished' : helper.status === 'cancelled' ? 'was stopped' : `failed${helper.error ? ` (${helper.error})` : ''}`;
  const report = helper.result.trim();
  const body = report
    ? `\nReport:\n${report.slice(0, 4_000)}${report.length > 4_000 ? `\n[… ${(report.length - 4_000).toLocaleString('en-US')} more characters; read them with check_helper]` : ''}`
    : '';
  postEvent(helper.dotId, { event: 'helper', ref: helper.id, text: `Helper "${helper.name}" (${helper.id}) ${outcome}.${body}` });
  updateDotRuntime(helper.dotId, (runtime) => ({
    ...runtime,
    delegations: runtime.delegations.map((delegation) => (delegation.id === helper.id ? { ...delegation, status: helper.status, updatedAt: config.now() } : delegation)),
  }));
  kick(helper.dotId);
};

/* ------------------------------------------------------------------------ */
/* The user's computer                                                       */
/* ------------------------------------------------------------------------ */

const computerDeps = (): DotComputerDeps => ({ computer: config.computer, now: config.now, wake: (dotId) => kick(dotId), machine: config.machine });

/**
 * Lets the bot ask to run commands inside `folder` on the user's computer.
 * Resolves to a problem to show the user, or null once connected.
 */
export const connectDotComputer = async (dotId: string, folder: string): Promise<string | null> => {
  const dot = findDot(dotId);
  if (!dot) return 'This bot no longer exists.';
  await ensureLoaded(dot);
  return connectComputer(dotId, folder, computerDeps());
};

/**
 * Lets the bot work anywhere on the user's computer, not one folder: the desktop app only, where the companion says
 * where their home is. Resolves to a problem to show the user, or null once connected.
 */
export const connectDotWholeComputer = async (dotId: string): Promise<string | null> => {
  const dot = findDot(dotId);
  if (!dot) return 'This bot no longer exists.';
  if (!isDesktopApp()) return 'The whole computer can be connected in the Willow desktop app. Here, choose a folder instead.';
  await ensureLoaded(dot);
  let env: { platform?: string; home?: string };
  try {
    env = await companionRequest<{ platform?: string; home?: string }>('spark.env', {});
  } catch (error) {
    return computerProblem(error);
  }
  const home = env.home?.trim();
  if (!home) return 'Willow could not find your home folder on this computer.';
  const root = env.platform === 'win32' ? `${home.slice(0, 2).toUpperCase()}\\` : '/';
  return connectWholeComputer(dotId, { root, home }, computerDeps());
};

export const disconnectDotComputer = (dotId: string): Promise<void> => disconnectComputer(dotId, computerDeps());

/** The user stopped one of the bot's background jobs from the conversation. */
export const stopDotJob = (dotId: string, approvalId: string): Promise<void> => stopJob(dotId, approvalId, computerDeps());

/** Whether this window can reach the user's computer at all. */
export const dotComputerReachable = (): Promise<boolean> => companionReachable();

/** The user approved a command the bot asked to run: exactly that runs, and the bot hears how it went. */
/** With `always`, commands starting with the card's offered prefix run in that folder without asking from now on. */
export const approveDotCommand = (dotId: string, approvalId: string, always = false): Promise<void> => approveCommand(dotId, approvalId, computerDeps(), always);

export const forgetDotCommandPrefix = (dotId: string, prefix: string[]): void => forgetCommandPrefix(dotId, prefix);

export const declineDotCommand = (dotId: string, approvalId: string): void => declineCommand(dotId, approvalId, computerDeps());

const screenDeps = (): DotScreenDeps => ({ now: config.now, wake: (dotId) => kick(dotId) });

/** The user let the bot see and use their screen, from its card. */
export const allowDotScreen = (dotId: string, itemId: string): void => allowScreen(dotId, itemId, screenDeps());

export const declineDotScreen = (dotId: string, itemId: string): void => declineScreen(dotId, itemId, screenDeps());

/** The user took their screen back: Stop on the card. */
export const stopDotScreen = (dotId: string): void => stopScreen(dotId, screenDeps());

/** The user applied a change the bot proposed to their files: it is checked against the files as they are, then written. */
export const applyDotEdit = (dotId: string, itemId: string): Promise<void> => applyProposedEdit(dotId, itemId, computerDeps());

export const declineDotEdit = (dotId: string, itemId: string): void => declineProposedEdit(dotId, itemId, computerDeps());

/** A Discord post the user approved, or one in a channel they allowed: as it was written. */
const postToDiscord = async (dotId: string, message: DotDiscordPost): Promise<{ id: string } | { problem: string }> => {
  const link = discordLinkFor(dotId);
  if (!link) return { problem: 'The bot is not on Discord any more: the user disconnected it.' };
  try {
    const sent = await sendToDiscord(link, config.discord, message.channelId, message.text, message.replyTo);
    return 'problem' in sent ? sent : { id: sent.ids[0]! };
  } catch (error) {
    return { problem: discordUnreachable(error) };
  }
};

const mailDeps = (dotId?: string): DotMailDeps => ({
  send: sendApprovedMail,
  ...(dotId ? { post: (message: DotDiscordPost) => postToDiscord(dotId, message) } : {}),
  now: config.now,
  wake: (id) => kick(id),
});

/** The user sent an email (or a Discord post) the bot wrote, and with `always` let it write to those people — or in that channel — again without asking. */
export const sendDotEmail = (dotId: string, itemId: string, always = false): Promise<void> => sendOutgoing(dotId, itemId, { always }, mailDeps(dotId));

export const declineDotEmail = (dotId: string, itemId: string): void => declineOutgoing(dotId, itemId, mailDeps(dotId));

/** From the profile: the bot asks again before emailing `address`. */
export const stopDotEmailingWithoutAsking = (dotId: string, address: string): void => stopEmailingWithoutAsking(dotId, address);

/** From the profile: the bot asks again before posting in a Discord channel. */
export const stopDotPostingWithoutAsking = (dotId: string, channelId: string): void => stopPostingWithoutAsking(dotId, channelId);

/* ------------------------------------------------------------------------ */
/* Notifications                                                             */
/* ------------------------------------------------------------------------ */

/** Turns native notifications for this bot on or off. Resolves to whether they are on. */
export const setDotNotifications = async (dotId: string, enabled: boolean): Promise<boolean> => {
  if (!getDotThread(dotId)) return false;
  const allowed = enabled ? await config.notifier.request().catch(() => false) : false;
  updateDotRuntime(dotId, { notifications: allowed });
  return allowed;
};

/**
 * Tells the user natively about something from the bot, when they asked to be told and Willow is out of sight —
 * and, in their quiet hours, only when the bot is answering something they just wrote.
 */
const notifyUser = (dotId: string, text: string, answering = false): void => {
  const thread = getDotThread(dotId);
  const dot = findDot(dotId);
  if (!thread?.runtime.notifications || !dot || !text || !config.notifier.inBackground()) return;
  if (!answering && inQuietHours(quietHoursOf(thread.runtime), config.now(), config.timeZone())) return;
  const body = text.length > 200 ? `${text.slice(0, 199)}…` : text;
  void config.notifier.show({ title: sparkDotName(dot), body, tag: `willow-dot-${dotId}` }).catch(() => undefined);
  // The user's phone too, when they set it up: out of sight of this window, they may be away from the computer.
  const push = phonePush.get();
  if (push) void pushToPhone(push, sparkDotName(dot), body);
};

/* ------------------------------------------------------------------------ */
/* Timers                                                                    */
/* ------------------------------------------------------------------------ */

const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const LATE_AFTER_MS = 5 * 60_000;

const fireDue = (dotId: string): void => {
  const thread = getDotThread(dotId);
  if (!thread) return;
  const now = config.now();
  const timeZone = config.timeZone();
  let woke = false;
  const runtime = thread.runtime;

  if (runtime.status === 'sleeping' && runtime.wakeAt !== undefined && runtime.wakeAt <= now) {
    const late = now - runtime.wakeAt > LATE_AFTER_MS
      ? ` You meant to wake at ${formatStamp(runtime.wakeAt, timeZone)}, ${formatAgo(now - runtime.wakeAt)}; Willow was not open then.`
      : '';
    postEvent(dotId, { event: late ? 'resumed' : 'wake', text: `Your sleep has ended (${runtime.wakeReason ?? 'planned wake-up'}).${late}` });
    updateDotRuntime(dotId, { status: 'idle', wakeAt: undefined, wakeReason: undefined });
    woke = true;
  }

  migrateRoutines(dotId, timeZone, now);
  if (fireTimeTriggers(dotId, now, postTrigger)) woke = true;

  if (woke) kick(dotId);
  armTimer(dotId);
};

const armTimer = (dotId: string): void => {
  const entry = control(dotId);
  clearTimeout(entry.timer);
  entry.timer = undefined;
  const thread = getDotThread(dotId);
  if (!thread || thread.runtime.status === 'paused') return;
  const candidates: number[] = [];
  const nextTrigger = nextTimeTriggerAt(thread.runtime);
  if (nextTrigger !== undefined) candidates.push(nextTrigger);
  if (thread.runtime.status === 'sleeping' && thread.runtime.wakeAt !== undefined) candidates.push(thread.runtime.wakeAt);
  if (candidates.length === 0) return;
  const delay = Math.max(0, Math.min(...candidates) - config.now());
  entry.timer = setTimeout(() => (delay > MAX_TIMEOUT_MS ? armTimer(dotId) : fireDue(dotId)), Math.min(delay, MAX_TIMEOUT_MS));
};

/* ------------------------------------------------------------------------ */
/* Turns                                                                     */
/* ------------------------------------------------------------------------ */

const delegationLines = (thread: DotThread, now: number): string[] => {
  const lines: string[] = [];
  for (const delegation of thread.runtime.delegations) {
    if (delegation.kind === 'spark-task') {
      const task = getSparkTaskById(delegation.id);
      if (task && (task.status === 'running' || task.status === 'queued' || task.status === 'needs-input')) {
        lines.push(`Spark task "${task.title}" (${task.id}): ${task.status === 'needs-input' ? 'waiting for input' : 'running'}, started ${formatAgo(now - delegation.createdAt)}.`);
      }
    }
  }
  for (const helper of runningHelpersFor(thread.dotId)) {
    lines.push(`Helper "${helper.name}" (${helper.id}): working, started ${formatAgo(now - helper.startedAt)}.`);
  }
  for (const job of thread.runtime.jobs ?? []) {
    if (job.status === 'running') lines.push(`Background job ${job.id} \`${job.command}\` on the user's computer: running, started ${formatAgo(now - job.startedAt)}.`);
  }
  return lines;
};

const workspaceFor = (dotId: string): Promise<SparkWorkspace> => {
  const entry = control(dotId);
  entry.workspace ??= createOpfsWorkspace(`dot-${dotId}`).catch(() => emptySparkWorkspace());
  return entry.workspace;
};

/** The most of a connected folder's AGENTS.md a prompt carries. */
const AGENTS_MD_CHARS = 8_000;

/**
 * The connected folder's own instructions, as Codex reads them: `AGENTS.override.md` when there is one, else
 * `AGENTS.md`, at the folder's top. Read each turn, so an edit to them counts from the next one.
 */
const projectInstructions = async (root: string): Promise<string | undefined> => {
  for (const name of ['AGENTS.override.md', 'AGENTS.md']) {
    try {
      const file = await config.computer.readFile(root, name);
      const text = file.binary ? '' : file.text.trim();
      if (text) return text.length > AGENTS_MD_CHARS ? `${text.slice(0, AGENTS_MD_CHARS)}\n[… the rest of ${name} is in the folder]` : text;
    } catch {
      // Absent, or the companion is out of reach: the turn goes ahead without them.
    }
  }
  return undefined;
};

const COMPACT_CHECK_MS = 60_000;
const COMPACT_RETRY_MS = 2 * 60_000;
const COMPACT_RETRY_MAX_MS = 60 * 60_000;

const learning = new Set<string>();
/** Catch-up passes before a compaction, so a long unread stretch is learned from before it is summarised. */
const LEARN_BEFORE_COMPACTING = 8;

/**
 * Learning about the user (memory/learning.ts), one pass at a time per bot, only while Memory lets personal data
 * reach the model. `passes` lets a compaction catch the profile up first.
 */
const learnInBackground = async (dotId: string, model: SparkHostModel, passes = 1): Promise<void> => {
  const about = aboutUser();
  const dot = findDot(dotId);
  const thread = getDotThread(dotId);
  if (!about.memory || !dot || !thread || thread.runtime.learned?.off || learning.has(dotId)) return;
  learning.add(dotId);
  try {
    await withWebLock(`willow-dot-learn:${dotId}`, async () => {
      for (let pass = 0; pass < passes; pass += 1) {
        const before = getDotThread(dotId)?.runtime.learned?.throughSeq ?? 0;
        await learnAboutUser({
          dotId,
          dotName: sparkDotName(dot),
          purpose: getDotThread(dotId)?.runtime.instructions?.slice(0, 600),
          about: about.text,
          timeZone: config.timeZone(),
          summarize: summarizerFor(model),
          now: config.now,
        });
        if ((getDotThread(dotId)?.runtime.learned?.throughSeq ?? 0) <= before) break;
      }
    });
  } catch (error) {
    console.warn('[bots] learning about the user failed; it will try again later', error);
  } finally {
    learning.delete(dotId);
  }
};

/** Compacts after a turn when it is due, or early when `compactionTiming` says the moment is right. */
const compactInBackground = (dotId: string, model: SparkHostModel, budgets: DotBudgets, early = false): void => {
  const entry = control(dotId);
  const thread = getDotThread(dotId);
  if (entry.compacting || !thread || (entry.compactAfter ?? 0) > config.now()) return;
  if (!early && !needsCompaction(thread, budgets, config.timeZone())) return;
  entry.compacting = true;
  const dot = findDot(dotId);
  // What is about to be summarised is learned from first, so the profile keeps what the summary leaves out.
  void learnInBackground(dotId, model, LEARN_BEFORE_COMPACTING).then(() => withWebLock(`willow-dot-compact:${dotId}`, async () => {
    await compactDotThread({
      dotId,
      budgets,
      timeZone: config.timeZone(),
      dotName: dot ? sparkDotName(dot) : 'dot',
      summarize: summarizerFor(model),
      early,
    });
  }).then(() => {
    entry.compactFailures = 0;
    entry.compactAfter = undefined;
  }, (error) => {
    entry.compactFailures = (entry.compactFailures ?? 0) + 1;
    entry.compactAfter = config.now() + Math.min(COMPACT_RETRY_MS * 2 ** (entry.compactFailures - 1), COMPACT_RETRY_MAX_MS);
    console.warn('[bots] background compaction failed; will try again later', error);
  }).finally(() => {
    entry.compacting = false;
  }));
};

/** Idle bots whose window is nearly full compact while their prompt cache is cold anyway (`compactionTiming`). */
const compactIdleDots = (): void => {
  const model = getSparkTaskHost()?.executionModel();
  if (!model?.apiKey) return;
  const budgets = budgetsFor(model.provider, model.model);
  const now = config.now();
  for (const [dotId, thread] of Object.entries(dotThreads.get())) {
    if (control(dotId).running || thread.runtime.status === 'paused') continue;
    const idle = now - (thread.items.at(-1)?.at ?? now);
    const timing = compactionTiming(thread, budgets, config.timeZone(), idle);
    if (timing !== 'none') compactInBackground(dotId, model, budgets, timing === 'early');
    // Learning changes the memory at the head of the prompt, so it waits, as early compaction does, for a cold cache.
    else if (idle > PROMPT_CACHE_MS && learningDue(thread, now)) void learnInBackground(dotId, model);
  }
};

const failTurn = (dotId: string, message: string) => {
  updateDotRuntime(dotId, { status: 'error', lastError: message });
};

/** Failures a provider recovers from by itself: rate limits, overload, outages, dropped connections. */
const TRANSIENT_ERROR = /\b(408|429|500|502|503|504|529)\b|rate.?limit|too many requests|overloaded|unavailable|timed? ?out|network|fetch failed|ECONN|socket hang up|temporar/i;
const RETRY_DELAYS_MS = [60_000, 4 * 60_000, 15 * 60_000, 60 * 60_000];

/**
 * After a turn failed: when the failure passes by itself, schedules another try — one minute, then four, fifteen
 * and sixty — and returns its delay, so the bot carries on while the user is away instead of waiting for them to
 * press Retry. The input stays unhandled, so the next turn resumes from it.
 */
const retryAfterFailure = (dotId: string, message: string): number | undefined => {
  const entry = control(dotId);
  const attempt = entry.retries ?? 0;
  if (!TRANSIENT_ERROR.test(message) || attempt >= RETRY_DELAYS_MS.length) {
    entry.retries = 0;
    return undefined;
  }
  const delay = RETRY_DELAYS_MS[attempt]!;
  entry.retries = attempt + 1;
  clearTimeout(entry.retryTimer);
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = undefined;
    if (getDotThread(dotId)?.runtime.status !== 'error') return;
    updateDotRuntime(dotId, { status: 'idle', lastError: undefined });
    kick(dotId);
  }, delay);
  return delay;
};

const telegramRelay: TelegramRelay = {
  call: (token, method, params) => companionRequest('relay.telegram', { token, method, params }, 45_000),
};

const deliverFromTelegram = (dotId: string, text: string, messageId?: number): void => {
  if (!getDotThread(dotId)) return;
  const item = appendDotItem(dotId, { kind: 'user', text, via: 'telegram', ...(messageId !== undefined ? { telegram: { messageId } } : {}) });
  quoteOnDiscord(dotId, item, 'on Telegram');
  kick(dotId);
};

/** The bot's reaction on a message the user wrote on Telegram, shown there too. */
const mirrorReactionToTelegram = (dotId: string, reactionId: string): void => {
  const link = telegramLink.get();
  const thread = getDotThread(dotId);
  const reaction = thread?.items.find((item) => item.id === reactionId);
  const target = reaction?.target ? thread?.items.find((item) => item.id === reaction.target) : undefined;
  if (!link || link.dotId !== dotId || !reaction?.emoji || target?.telegram === undefined) return;
  void reactOnTelegram(link, telegramRelay, target.telegram.messageId, reaction.emoji);
};

const pause = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

/** Polls the linked bot while this window holds the lock; another window takes over when this one closes. */
const runTelegramGateway = async (signal: AbortSignal): Promise<void> => {
  while (!signal.aborted) {
    const link = telegramLink.get();
    if (!link) {
      await pause(5_000, signal);
      continue;
    }
    try {
      const next = await readTelegram(link, telegramRelay, deliverFromTelegram);
      const current = telegramLink.get();
      if (current?.token === link.token && current.dotId === link.dotId) {
        setTelegramLink({ ...current, offset: next.offset, chatId: current.chatId ?? next.chatId, chatName: current.chatName ?? next.chatName });
      }
    } catch {
      await pause(20_000, signal);
    }
  }
};

/* ------------------------------------------------------------------------ */
/* Discord                                                                   */
/* ------------------------------------------------------------------------ */

const DISCORD_WAIT_MS = 25_000;
const DISCORD_LOCK_RETRY_MS = 30_000;
const DISCORD_DM_RETRY_MS = 2 * 60_000;

const discordGateways = new Map<string, AbortController>();
const dmTries = new Map<string, { at: number; servers: number }>();
const discordQueues = new Map<string, Promise<void>>();

/** What the user wrote to the bot on Discord, since `sinceSeq`, oldest first. */
const discordInputsSince = (dotId: string, sinceSeq: number): DotItem[] =>
  (getDotThread(dotId)?.items ?? []).filter((item) => item.seq > sinceSeq && item.kind === 'user' && item.via === 'discord' && item.discord);

/** One bot's posts to Discord go one after another, so they arrive in the order they were written. */
const enqueueDiscord = (dotId: string, post: () => Promise<void>): void => {
  discordQueues.set(dotId, (discordQueues.get(dotId) ?? Promise.resolve()).then(post).catch(() => undefined));
};

/** What the user wrote outside Discord, quoted in the bot's DM there, so the DM reads as the whole conversation. */
const quoteOnDiscord = (dotId: string, item: DotItem, from: string): void => {
  const link = discordLinkFor(dotId);
  const channelId = link?.dmChannelId;
  if (!link || !channelId || (!item.text.trim() && !item.attachments?.length)) return;
  const files = item.attachments?.length ? `${item.text.trim() ? '\n' : ''}(attached: ${item.attachments.map((file) => file.name).join(', ')})` : '';
  const text = quoteForDiscord(`${item.text}${files}`, from);
  enqueueDiscord(dotId, async () => {
    const sent = await sendToDiscord(link, config.discord, channelId, text);
    if ('ids' in sent && sent.ids[0]) rememberQuoted(dotId, item.id, sent.ids[0]);
  });
};

/** The user wrote to the bot on Discord: their message, as if written here, and the bot wakes for it as it would here. */
const deliverFromDiscord = (dotId: string, text: string, source: DotDiscordSource): void => {
  if (!getDotThread(dotId)) return;
  appendDotItem(dotId, { kind: 'user', text, via: 'discord', discord: source });
  const thread = getDotThread(dotId)!;
  if (thread.runtime.status === 'sleeping' || thread.runtime.status === 'error') updateDotRuntime(dotId, { status: 'idle', lastError: undefined });
  kick(dotId);
};

/** The user reacted on Discord to one of the bot's messages, or took the reaction back: as if they had here. */
const reactFromDiscord = (dotId: string, itemId: string, raw: string, added: boolean): void => {
  const emoji = normalizeReactionEmoji(raw);
  const thread = getDotThread(dotId);
  if (!emoji || !thread) return;
  if (added) void reactToDotMessage(dotId, itemId, emoji);
  else if (userReactionsByMessage(thread).get(itemId) === emoji) void reactToDotMessage(dotId, itemId, null);
};

const handleDiscordEvent = (dotId: string, link: DiscordLink, event: DiscordEvent): void => {
  const inbound = classifyDiscordEvent(link, event, new Map(discordStateFor(dotId).sent));
  if (inbound.kind === 'user') {
    const current = discordLinkFor(dotId);
    if (!inbound.source.guildId && current?.token === link.token && !current.dmChannelId) setDiscordLink(dotId, { ...current, dmChannelId: inbound.source.channelId });
    deliverFromDiscord(dotId, inbound.text, inbound.source);
  } else if (inbound.kind === 'reaction') {
    reactFromDiscord(dotId, inbound.itemId, inbound.emoji, inbound.added);
  } else if (inbound.kind === 'heard') {
    const status = getDotThread(dotId)?.runtime.status;
    if (status === undefined || status === 'paused') return;
    const line = `- ${whereOf(inbound.message) ?? 'A DM'}: ${describeDiscordMessage(inbound.message, link, config.timeZone())}`;
    hearDiscord(dotId, { ...inbound.message, mentionsBot: inbound.mentionsBot }, line, { now: config.now, screen: screenEvent }, postTrigger);
  }
};

/** Opens the bot's DM with the user once they share a server, so the profile's Discord button goes straight there. */
const openDmFor = async (dotId: string): Promise<void> => {
  const link = discordLinkFor(dotId);
  const servers = discordStateFor(dotId).guilds.length;
  const tried = dmTries.get(dotId);
  if (!link || link.dmChannelId || servers === 0 || (tried && tried.servers === servers && config.now() - tried.at < DISCORD_DM_RETRY_MS)) return;
  dmTries.set(dotId, { at: config.now(), servers });
  const opened = await openDiscordDm(link, config.discord).catch(() => null);
  const current = discordLinkFor(dotId);
  if (opened && 'channelId' in opened && current?.token === link.token) setDiscordLink(dotId, { ...current, dmChannelId: opened.channelId });
};

/** What the application allows now — reading whole channels, anyone adding it — which the user changes in Discord. */
const refreshDiscordContent = async (dotId: string): Promise<void> => {
  const link = discordLinkFor(dotId);
  if (!link) return;
  const settings = await readAppSettings(link, config.discord);
  const current = discordLinkFor(dotId);
  if (!settings || current?.token !== link.token || (current.content === settings.content && Boolean(current.public) === settings.public)) return;
  const { public: _public, ...rest } = current;
  setDiscordLink(dotId, { ...rest, content: settings.content, ...(settings.public ? { public: true } : {}) });
};

/** Reads one bot's Discord gateway while this window holds its lock, until the bot leaves Discord or the window closes. */
const readDiscordGateway = async (dotId: string, signal: AbortSignal): Promise<void> => {
  await refreshDiscordContent(dotId);
  let failures = 0;
  while (!signal.aborted) {
    const link = discordLinkFor(dotId);
    if (!link) return;
    const state = discordStateFor(dotId);
    try {
      const reply = await config.discord.next(link.token, { after: state.after, epoch: state.epoch, guildsVersion: state.guildsVersion, content: link.content, waitMs: DISCORD_WAIT_MS });
      if (signal.aborted || discordLinkFor(dotId)?.token !== link.token) continue;
      failures = 0;
      patchDiscordState(dotId, {
        epoch: reply.epoch,
        after: reply.after,
        guildsVersion: reply.guildsVersion,
        status: reply.state,
        problem: reply.problem,
        contentRefused: reply.contentRefused,
        ...(reply.guilds ? { guilds: reply.guilds } : {}),
      }, config.now());
      for (const event of reply.events) handleDiscordEvent(dotId, link, event);
      if (reply.state === 'online') void openDmFor(dotId);
      // A refused token stays refused until the user connects the bot again.
      if (reply.state === 'error') await pause(60_000, signal);
    } catch (error) {
      failures += 1;
      patchDiscordState(dotId, { status: 'offline', problem: discordUnreachable(error) }, config.now());
      await pause(Math.min(5_000 * 2 ** (failures - 1), 60_000), signal);
    }
  }
};

/** Keeps a gateway reader for a linked bot: in whichever window holds its lock, another taking over when that one closes. */
const runDiscordGateway = (dotId: string): void => {
  if (discordGateways.has(dotId)) return;
  const controller = new AbortController();
  discordGateways.set(dotId, controller);
  void (async () => {
    while (!controller.signal.aborted && discordLinkFor(dotId)) {
      const ran = await withWebLock(`willow-dot-discord:${dotId}`, () => readDiscordGateway(dotId, controller.signal)).catch(() => false);
      if (controller.signal.aborted) break;
      await pause(ran ? 1_000 : DISCORD_LOCK_RETRY_MS, controller.signal);
    }
    if (discordGateways.get(dotId) === controller) discordGateways.delete(dotId);
  })();
};

const syncDiscordGateways = (links: Record<string, DiscordLink>): void => {
  for (const [dotId, controller] of discordGateways) {
    if (links[dotId]) continue;
    controller.abort();
    discordGateways.delete(dotId);
  }
  for (const dotId of Object.keys(links)) runDiscordGateway(dotId);
};

/**
 * A message the bot wrote, on Discord too (`discordReplyTarget`): in the server channel the user is writing to it
 * from — answering their message there the first time — and otherwise in its DM, which mirrors the conversation.
 */
const mirrorToDiscord = (dotId: string, message: DotItem, sinceSeq: number, answered: Set<string>): void => {
  const link = discordLinkFor(dotId);
  if (!link || !message.text.trim()) return;
  const target = discordReplyTarget(getDotThread(dotId)?.items ?? [], sinceSeq, link.dmChannelId);
  if (!target) return;
  const replyTo = target.inputId && !answered.has(target.inputId) ? target.replyTo : undefined;
  if (target.inputId) answered.add(target.inputId);
  enqueueDiscord(dotId, async () => {
    const sent = await sendToDiscord(link, config.discord, target.channelId, message.text, replyTo);
    if ('ids' in sent) rememberSent(dotId, sent.ids, message.id);
  });
};

/** The bot reacted to the user's message: on Discord too, on that message there or on its quote in the DM. */
const mirrorReactionToDiscord = (dotId: string, reactionId: string): void => {
  const link = discordLinkFor(dotId);
  const thread = getDotThread(dotId);
  const reaction = thread?.items.find((item) => item.id === reactionId);
  const target = reaction?.target ? thread?.items.find((item) => item.id === reaction.target) : undefined;
  if (!link || !reaction?.emoji || !target) return;
  const quote = new Map(discordStateFor(dotId).quoted ?? []).get(target.id);
  const place = target.discord ?? (quote && link.dmChannelId ? { channelId: link.dmChannelId, messageId: quote } : undefined);
  if (!place) return;
  const earlier = thread!.items.filter((item) => item.kind === 'reaction' && item.target === target.id && item.seq < reaction.seq).at(-1)?.emoji;
  enqueueDiscord(dotId, async () => {
    const placed = await reactOnDiscord(link, config.discord, place.channelId, place.messageId, reaction.emoji!);
    if (placed === true && earlier && earlier !== reaction.emoji) await unreactOnDiscord(link, config.discord, place.channelId, place.messageId, earlier);
  });
};

/** The bot's Discord account for one turn; `talking` is where the user writes to it from in this turn. */
const discordAccessFor = (dotId: string, link: DiscordLink, sinceSeq: number): DotDiscordAccess => ({
  botName: link.botName,
  content: link.content && !discordStateFor(dotId).contentRefused,
  guilds: () => discordStateFor(dotId).guilds,
  ...(link.dmChannelId ? { dmChannelId: link.dmChannelId } : {}),
  dm: async () => {
    const current = discordLinkFor(dotId) ?? link;
    if (current.dmChannelId) return { channelId: current.dmChannelId };
    const opened = await openDiscordDm(current, config.discord).catch((error) => ({ problem: discordUnreachable(error) }));
    if ('channelId' in opened) setDiscordLink(dotId, { ...current, dmChannelId: opened.channelId });
    return opened;
  },
  read: (channelId, limit, before) =>
    readDiscordChannel(discordLinkFor(dotId) ?? link, config.discord, channelId, { limit, ...(before ? { before } : {}), guilds: discordStateFor(dotId).guilds })
      .catch((error) => ({ problem: discordUnreachable(error) })),
  describe: (message) => describeDiscordMessage(message, link, config.timeZone()),
  react: (channelId, messageId, emoji) =>
    reactOnDiscord(discordLinkFor(dotId) ?? link, config.discord, channelId, messageId, emoji).catch((error) => ({ problem: discordUnreachable(error) })),
  talking: () => new Set(discordInputsSince(dotId, sinceSeq).map((item) => item.discord!.channelId)),
  deps: mailDeps(dotId),
});

/** Whether someone else holds the bot up: the user deciding on a card, or work it delegated still under way. */
const waitingOnSomeone = (thread: DotThread): boolean =>
  ['sleeping', 'paused', 'error'].includes(thread.runtime.status)
  || pendingApprovals(thread).length > 0
  || pendingEdits(thread).length > 0
  || pendingScreenRequests(thread).length > 0
  || pendingOutgoing(thread).length > 0
  || pendingSetupRequests(thread).length > 0
  || openHelpRequests(thread).length > 0
  || thread.runtime.delegations.some((delegation) => delegation.status === 'running');

const patchPlan = (dotId: string, patch: Partial<DotPlan>): void => {
  updateDotRuntime(dotId, (runtime) => (runtime.plan ? { ...runtime, plan: { ...runtime.plan, ...patch } } : runtime));
};

/**
 * After a turn, carry the bot's plan on (runtime/plan.ts): wake it again while it has steps to move, once to look
 * back when it is done, and stop when continuations stop moving it. `before` is when the plan last changed as the
 * turn began; `continuing` whether the turn was one Willow woke it for; `answering` whether the user had written.
 */
const settlePlan = (dotId: string, before: number | undefined, continuing: boolean, answering: boolean): void => {
  const plan = getDotThread(dotId)?.runtime.plan;
  if (!plan) return;
  if (answering) patchPlan(dotId, { stillTurns: 0, stalledAt: undefined });
  else if (continuing && plan.updatedAt === before) patchPlan(dotId, { stillTurns: (plan.stillTurns ?? 0) + 1 });
  const thread = getDotThread(dotId)!;
  const next = planNext(thread.runtime.plan, waitingOnSomeone(thread));
  if (next === 'stall') patchPlan(dotId, { stalledAt: config.now() });
  if (next === 'reflect') patchPlan(dotId, { reflectedAt: config.now() });
  if (next === 'continue' || next === 'reflect') {
    postEvent(dotId, { event: next, text: next === 'continue' ? CONTINUE_EVENT : reflectEvent(thread.runtime.plan!) });
    kick(dotId);
  }
};

const withRetryNote = (message: string, delay: number | undefined): string =>
  delay ? `${message.replace(/[.\s]+$/, '')}. Trying again in ${Math.round(delay / 60_000)} minute${delay === 60_000 ? '' : 's'}.` : message;

const runTurnNow = async (dotId: string): Promise<void> => {
  const entry = control(dotId);
  const thread = getDotThread(dotId);
  const dot = findDot(dotId);
  if (!thread || !dot || thread.runtime.status === 'paused' || !hasUnseenInput(thread)) return;

  const host: SparkTaskHost | null = getSparkTaskHost() ?? (await waitForSparkTaskHost(8_000));
  const model = host?.executionModel() ?? null;
  if (!model || !model.apiKey) {
    failTurn(dotId, 'No model is set up yet. Add an API key in Settings → Models, then send a message to wake your bot.');
    return;
  }

  const timeZone = config.timeZone();
  const budgets = budgetsFor(model.provider, model.model);
  const dotName = sparkDotName(dot);
  // What this turn is for: answering the user (they hear about it even in quiet hours), or a research moment.
  const answering = thread.items.some((item) => item.seq > thread.runtime.lastActedSeq && (item.kind === 'user' || (item.kind === 'user-reaction' && Boolean(item.wakes))));
  const research = isResearchTurn(thread);
  const viaTelegram = thread.items.some((item) => item.seq > thread.runtime.lastActedSeq && item.kind === 'user' && item.via === 'telegram');
  // What the user writes on Discord from here on is answered there.
  const startActed = thread.runtime.lastActedSeq;
  const turnStartedAt = config.now();
  const answeredOnDiscord = new Set<string>();
  // "Typing…" shows where a message is going — Discord, Telegram — only while the bot writes one, as a person's
  // does: working is not typing.
  let typing: ReturnType<typeof setInterval> | undefined;
  const stopTyping = () => {
    clearInterval(typing);
    typing = undefined;
  };
  const startTyping = () => {
    if (typing) return;
    const shows: Array<() => void> = [];
    const link = discordLinkFor(dotId);
    const channelId = link && discordReplyTarget(getDotThread(dotId)?.items ?? [], startActed, link.dmChannelId)?.channelId;
    if (link && channelId) shows.push(() => void showDiscordTyping(link, config.discord, channelId));
    const telegram = telegramLink.get();
    const away = config.notifier.inBackground() && !inQuietHours(quietHoursOf(getDotThread(dotId)!.runtime), config.now(), timeZone);
    if (telegram?.chatId !== undefined && telegram.dotId === dotId && (viaTelegram || away)) shows.push(() => showTelegramTyping(telegram, telegramRelay));
    if (!shows.length) return;
    const show = () => shows.forEach((each) => each());
    show();
    typing = setInterval(show, 4_500);
  };
  const planBefore = thread.runtime.plan?.updatedAt;
  const continuing = thread.items.some((item) => item.seq > thread.runtime.lastActedSeq && item.kind === 'event' && item.event === 'continue');
  const startSeq = thread.items.at(-1)?.seq ?? 0;
  const summarize = summarizerFor(model);
  const abort = new AbortController();
  entry.abort = abort;
  updateDotRuntime(dotId, { status: 'working', lastError: undefined });
  setActivity(dotId, { working: true, label: 'Thinking', typingItemId: null, status: null });

  try {
    // Only when the tail is far past its budget, nearing what a request can carry, does compaction hold up a turn —
    // quietly: the user sees the bot thinking, never its memory being reorganised.
    const current = getDotThread(dotId)!;
    if (uncoveredTailTokens(current, budgets, timeZone) > Math.min(budgets.verbatimHigh * 1.12, budgets.hardCap * 0.9)) {
      await withWebLock(`willow-dot-compact:${dotId}`, async () => {
        await compactDotThread({ dotId, budgets, timeZone, dotName, summarize, signal: abort.signal });
      });
    }

    const about = aboutUser();
    const access = getDotThread(dotId)!.runtime.computer;
    const computer = access ? { root: access.root, shell: config.computer.shell(), ...(access.whole ? { whole: true, home: access.home ?? access.root } : {}) } : undefined;
    const machine = await machineFor(dotId);
    const discordLink = discordLinkFor(dotId);
    const permissions = getDotThread(dotId)!.runtime.permissions ?? 'auto';
    // The user's screen comes with their computer connected — a folder or the whole of it — where the companion reaches
    // it, each system its own way: Windows' shared desktop, macOS's apps in the background, Linux's desktop of its own.
    const screenPlatform = computer && (await config.screen.available().catch(() => false)) ? await config.screen.platform().catch(() => null) : null;
    const toolset = await createDotToolset({
      dotId,
      dotName,
      timeZone,
      now: config.now,
      host,
      personalData: about.memory,
      permissions,
      vision: { profile: visionProfile(model.provider, model.model), render: canvasRender },
      desktop: isDesktopApp(),
      web: (await pageWatching()) ? { read: readWebPage } : undefined,
      mail: watchableApps().gmail ? { canSend: await canSendMail().catch(() => false), deps: mailDeps(dotId), replyContext: mailReplyContext } : undefined,
      computer: computer && { ...computer, bridge: config.computer },
      screen: screenPlatform ? { bridge: config.screen, deps: screenDeps(), platform: screenPlatform, color: dotTintHex(dot) ?? undefined } : undefined,
      machine,
      triggers: { unavailable: await triggerLimits(getDotThread(dotId)!), sparkTasks: sparkTaskList },
      discord: discordLink && discordAccessFor(dotId, discordLink, startActed),
    });
    // A research moment looks and takes notes: everything that sends, changes or controls is left out of it.
    if (research) {
      const readTools = new Set<string>(Object.values(READ_TOOLS));
      for (const id of [...toolset.handlers.keys()]) if (!allowedInResearch(id, readTools)) toolset.handlers.delete(id);
      toolset.docs = toolset.docs.filter((doc) => allowedInResearch(doc.name, readTools));
      setActivity(dotId, { label: 'Looking for ways to help' });
    }
    const systemPrompt = createDotSystemPrompt({
      dotName,
      tools: toolset.docs,
      skills: toolset.skills,
      computer: computer && { ...computer, instructions: computer.whole ? undefined : await projectInstructions(computer.root), ...(screenPlatform ? { screen: screenPlatform } : {}) },
      machine: machine && { ready: machine.ready },
      environment: isDesktopApp() ? 'desktop' : 'web',
      instructions: getDotThread(dotId)!.runtime.instructions,
      discord: discordLink && { botName: discordLink.botName, servers: discordStateFor(dotId).guilds.map((guild) => guild.name) },
      permissions,
    });
    const notified = new Set<string>();
    const workspace = await workspaceFor(dotId);
    let files = await workspace.readFiles().catch(() => ({} as Record<string, string>));
    let pendingWrite: Promise<void> = Promise.resolve();

    let seen = getDotThread(dotId)!.runtime.lastActedSeq;
    const turnId = `t${config.now().toString(36)}`;
    // The files the user sends this turn go with every request of it, each read once, before the first request after
    // it arrived.
    const sent = new Map<string, { names: string[]; files: Attachment[] }>();
    const takeInSentFiles = async () => {
      for (const item of getDotThread(dotId)?.items ?? []) {
        if (item.kind !== 'user' || item.seq <= startActed || !item.attachments?.length || sent.has(item.id)) continue;
        sent.set(item.id, { names: item.attachments.map((file) => file.name), files: await readDotAttachments(item.attachments).catch(() => []) });
      }
    };
    const run = () => runDotTurn({
      dotId,
      turnId,
      model: { options: turnOptions(model), label: model.label },
      transport: config.transport,
      tools: toolset.handlers,
      // Past the line in the middle of a turn, the oldest stretch is compacted while the bot keeps working — the
      // latest stretch, this turn's work with it, stays word for word. The turn waits for it only when the next
      // request would not otherwise fit, so however long the work runs, it never runs out of room.
      beforeRequest: async () => {
        await takeInSentFiles();
        const latest = getDotThread(dotId);
        if (!latest) return;
        const tail = uncoveredTailTokens(latest, budgets, timeZone);
        if (tail <= budgets.verbatimHigh) return;
        if (tail <= budgets.hardCap * 0.9) {
          compactInBackground(dotId, model, budgets);
          return;
        }
        await withWebLock(`willow-dot-compact:${dotId}`, async () => {
          await compactDotThread({ dotId, budgets, timeZone, dotName, summarize, signal: abort.signal });
        });
      },
      workspace: {
        readFiles: () => ({ ...files }),
        writeFiles: (next) => {
          files = { ...next };
          pendingWrite = pendingWrite.then(() => workspace.writeFiles(files)).catch((error) => console.warn('[bots] could not save a workspace file', error));
        },
      },
      context: () => {
        const latest = getDotThread(dotId)!;
        const context = buildDotContext({
          thread: latest,
          systemPrompt,
          about: about.text,
          learned: about.memory ? learnedBlock(latest.runtime.learned, dotName) : '',
          budgets,
          now: config.now(),
          timeZone,
          seenSeq: seen,
          delegations: delegationLines(latest, config.now()),
          turn: { id: turnId, startedAt: turnStartedAt, sinceSeq: startActed },
        });
        seen = latest.items.at(-1)?.seq ?? seen;
        return withSentFiles(context, sent);
      },
      signal: abort.signal,
      onEvent: (event: DotHarnessEvent) => {
        if (event.type === 'read') updateDotRuntime(dotId, (runtime) => (event.seq > (runtime.readSeq ?? 0) ? { ...runtime, readSeq: event.seq } : runtime));
        else if (event.type === 'activity') setActivity(dotId, { label: event.label });
        else if (event.type === 'status') setActivity(dotId, { status: event.text });
        else if (event.type === 'message-start') {
          setActivity(dotId, { typingItemId: event.itemId, label: null });
          startTyping();
        } else if (event.type === 'message-end') {
          setActivity(dotId, { typingItemId: null });
          stopTyping();
          const message = getDotThread(dotId)?.items.find((item) => item.id === event.itemId);
          if (message) {
            notifyUser(dotId, plainMessageText(message.text), answering);
            const link = telegramLink.get();
            const away = config.notifier.inBackground() && !inQuietHours(quietHoursOf(getDotThread(dotId)!.runtime), config.now(), timeZone);
            if (link?.chatId !== undefined && link.dotId === dotId && (viaTelegram || away)) void sendTelegram(link, telegramRelay, plainMessageText(message.text));
            mirrorToDiscord(dotId, message, startActed, answeredOnDiscord);
          }
        } else if (event.type === 'reaction') {
          mirrorReactionToDiscord(dotId, event.itemId);
          mirrorReactionToTelegram(dotId, event.itemId);
        } else if (event.type === 'call-end' && !event.failed) {
          const latest = getDotThread(dotId)!;
          for (const request of pendingApprovals(latest)) {
            if (request.turnId !== turnId || notified.has(request.id)) continue;
            notified.add(request.id);
            notifyUser(dotId, `Asks to run on your computer: ${request.approval!.command}`, answering);
          }
          for (const request of pendingEdits(latest)) {
            if (request.turnId !== turnId || notified.has(request.id)) continue;
            notified.add(request.id);
            const files = request.edit!.files;
            notifyUser(dotId, `Asks to change ${files.length === 1 ? files[0]!.path : `${files.length} files`} on your computer`, answering);
          }
          for (const request of pendingScreenRequests(latest)) {
            if (request.turnId !== turnId || notified.has(request.id)) continue;
            notified.add(request.id);
            notifyUser(dotId, `Asks to see and use your screen: ${request.screen?.reason ?? request.text}`, answering);
          }
          for (const request of [...pendingSetupRequests(latest), ...openHelpRequests(latest)]) {
            if (request.turnId !== turnId || notified.has(request.id)) continue;
            notified.add(request.id);
            notifyUser(dotId, request.kind === 'machine'
              ? 'Asks to set up a computer of its own'
              : request.help?.kind === 'secret'
                ? `Needs ${request.help.label ?? 'a secret'} on its computer`
                : `Needs your help on its computer: ${request.help?.reason ?? ''}`, answering);
          }
          for (const request of pendingOutgoing(latest)) {
            if (request.turnId !== turnId || notified.has(request.id)) continue;
            notified.add(request.id);
            notifyUser(dotId, `Asks to ${describeOutgoing(request)}`, answering);
          }
        }
      },
      onUsage: (usage, promptChars) => {
        updateDotRuntime(dotId, (runtime) => ({
          ...runtime,
          charsPerToken: calibrateCharsPerToken(runtime.charsPerToken, promptChars, usage.inputTokens),
          usage: {
            inputTokens: runtime.usage.inputTokens + (usage.inputTokens ?? 0),
            outputTokens: runtime.usage.outputTokens + (usage.outputTokens ?? 0),
            turns: runtime.usage.turns,
          },
        }));
      },
    });

    let result: DotTurnResult;
    try {
      result = await run();
    } catch (error) {
      if (!(error instanceof DotContextOverflowError)) throw error;
      // The provider counted more than we estimated: compact down to the low mark — the latest stretch stays as it
      // was — then try once more.
      await withWebLock(`willow-dot-compact:${dotId}`, async () => {
        await compactDotThread({ dotId, budgets, timeZone, dotName, summarize, signal: abort.signal, emergencyTarget: budgets.verbatimLow });
      });
      result = await run();
    }
    await pendingWrite;

    const latest = getDotThread(dotId)!;
    // What the user wrote during a research moment met the bot with its tools cut down: it gets a turn of its own.
    const writtenDuring = research ? latest.items.find((item) => item.seq > startSeq && item.kind === 'user') : undefined;
    const lastSeq = writtenDuring ? writtenDuring.seq - 1 : latest.items.at(-1)?.seq ?? latest.runtime.lastActedSeq;
    const retryIn = result.reason === 'error' ? retryAfterFailure(dotId, result.error ?? '') : undefined;
    if (result.reason !== 'error') entry.retries = 0;
    updateDotRuntime(dotId, (runtime) => ({
      ...runtime,
      // A turn that will be tried again leaves its input unhandled, so the next try resumes from it.
      lastActedSeq: retryIn ? runtime.lastActedSeq : lastSeq,
      status: result.reason === 'sleeping' ? 'sleeping' : result.reason === 'error' ? 'error' : runtime.status === 'paused' ? 'paused' : 'idle',
      lastError: result.reason === 'error' ? withRetryNote(result.error ?? 'The turn failed.', retryIn) : undefined,
      usage: { ...runtime.usage, turns: runtime.usage.turns + 1 },
    }));
    if (result.reason !== 'error' && !abort.signal.aborted) settlePlan(dotId, planBefore, continuing, answering);
  } catch (error) {
    if (!abort.signal.aborted) {
      const message = error instanceof Error ? error.message : String(error);
      failTurn(dotId, withRetryNote(message, retryAfterFailure(dotId, message)));
    } else {
      // A stop means stop: what was waiting counts as handled, or the bot would start right back up.
      const latestSeq = getDotThread(dotId)?.items.at(-1)?.seq;
      updateDotRuntime(dotId, (runtime) => ({
        ...runtime,
        lastActedSeq: latestSeq ?? runtime.lastActedSeq,
        status: runtime.status === 'paused' ? 'paused' : 'idle',
      }));
    }
  } finally {
    entry.abort = undefined;
    stopTyping();
    // Between turns the bot is not at the controls: its overlay comes down, and its next use brings it back.
    void hideScreenOverlay(config.screen, dotId);
    setActivity(dotId, { working: false, label: null, typingItemId: null, status: null });
    armTimer(dotId);
    compactInBackground(dotId, model, budgets);
  }
};

/** Runs a turn for the bot if it has something new and is not already working. */
export const kick = (dotId: string): void => {
  const entry = control(dotId);
  if (entry.running) {
    entry.again = true;
    return;
  }
  entry.running = true;
  void (async () => {
    try {
      do {
        entry.again = false;
        const acquired = await withWebLock(`willow-dot-turn:${dotId}`, () => runTurnNow(dotId));
        if (!acquired) {
          // Another tab is running this bot's turn. Look again later in case that tab goes away.
          setTimeout(() => kick(dotId), LOCK_RETRY_MS);
          break;
        }
        const thread = getDotThread(dotId);
        // A message that landed after the turn's last request still needs answering.
        if (thread && thread.runtime.status !== 'paused' && thread.runtime.status !== 'error' && hasUnseenInput(thread)) entry.again = true;
      } while (entry.again);
    } catch (error) {
      console.warn('[bots] turn failed', error);
    } finally {
      entry.running = false;
    }
  })();
};

const LOCK_RETRY_MS = 30_000;

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Bots that predate the harness bring their old messages into the thread —
 * except the placeholder replies the pre-harness mock sent, which would leave
 * the bot believing it once told the user it had no model.
 */
const LEGACY_PLACEHOLDER = /^This is a test reply from .+\. Dots aren't connected to a model yet/;
const seedFromLegacy = (dot: SparkDot) => (): DotItemDraft[] =>
  dot.messages
    .filter((message) => !(message.role === 'dot' && LEGACY_PLACEHOLDER.test(message.text)))
    .map((message) => ({
      kind: message.role === 'user' ? 'user' : 'dot',
      text: message.text,
      at: message.createdAt,
    }));

const ensureLoaded = async (dot: SparkDot): Promise<DotThread> => {
  const thread = await loadDotThread(dot.id, seedFromLegacy(dot));
  control(dot.id);
  return thread;
};

let started = false;
const unsubscribers: Array<() => void> = [];

/**
 * Starts the runtime: loads every bot's thread, re-arms its timers, resolves
 * anything that came due while Willow was closed, and starts watching for work.
 * Idempotent; the Spark workspace calls it on mount.
 */
export const startDotsRuntime = (): void => {
  if (started) return;
  started = true;

  // Windows' overlay goes with the grant it shows, and the user's Stop on its pill — or Esc — is a Stop like the card's.
  unsubscribers.push(onScreenGrantEnded((dotId) => void hideScreenOverlay(config.screen, dotId)));
  unsubscribers.push(config.screen.onStopped(({ session, grant, how }) => {
    forgetScreenOverlay(session);
    if (getDotThread(session)?.runtime.screen?.itemId === grant) stopScreen(session, screenDeps(), how);
  }));

  // A bot's computer wears the bot's colour — wallpaper and browser — and takes a new one when the bot changes colour.
  setDotMachineLook((dotId) => {
    const dot = findDot(dotId);
    return dot ? machineLook(dot) : null;
  });
  const looks = new Map<string, string>();
  unsubscribers.push(sparkDots.subscribe(({ dots }) => {
    for (const dot of dots) {
      const look = JSON.stringify(machineLook(dot));
      const before = looks.get(dot.id);
      looks.set(dot.id, look);
      if (before !== undefined && before !== look) void config.machine.look?.(dot.id).catch(() => undefined);
    }
  }));

  const sync = async (dots: SparkDot[]) => {
    for (const dot of dots) {
      const isNew = !getDotThread(dot.id);
      const thread = await ensureLoaded(dot);
      if (!isNew) continue;
      const runtime = thread.runtime;
      // A turn that was running when the last tab closed resumes from the record.
      if (runtime.status === 'working') updateDotRuntime(dot.id, { status: 'idle' });
      // Helpers do not survive the tab that ran them.
      const orphans = runtime.delegations.filter((delegation) => delegation.kind === 'helper' && delegation.status === 'running');
      for (const orphan of orphans) {
        postEvent(dot.id, { event: 'helper', ref: orphan.id, text: `Helper "${orphan.title}" (${orphan.id}) was interrupted when Willow closed, and its work was lost. Start it again if it is still needed.` });
      }
      if (orphans.length) {
        updateDotRuntime(dot.id, (current) => ({
          ...current,
          delegations: current.delegations.map((delegation) => (orphans.includes(delegation) ? { ...delegation, status: 'cancelled' } : delegation)),
        }));
      }
      settleInterruptedCommands(dot.id, computerDeps());
      settleInterruptedEdits(dot.id, computerDeps());
      // History carried over from before the harness is already handled: never answer it again. A brand-new bot
      // says nothing of its own accord: its conversation starts empty, with whatever the user writes first.
      if (!thread.runtime.introduced && thread.items.length > 0) {
        updateDotRuntime(dot.id, { introduced: true, lastActedSeq: thread.items.at(-1)!.seq });
      }
      fireDue(dot.id);
      reportSparkTasks();
      if (returned && config.now() - returned.at < RETURN_GRACE_MS && getDotThread(dot.id)!.runtime.status !== 'paused') {
        hearReturn(dot.id, returned.awayMs, config.now(), postTrigger);
      }
      if (hasUnseenInput(getDotThread(dot.id)!)) kick(dot.id);
    }
    // Bots deleted elsewhere: stop their work.
    for (const dotId of controls.keys()) {
      if (!dots.some((dot) => dot.id === dotId)) void forgetDot(dotId);
    }
  };

  unsubscribers.push(sparkDots.subscribe(({ dots }) => void sync(dots)));
  unsubscribers.push(sparkState.subscribe(() => reportSparkTasks()));
  unsubscribers.push(onDotHelperFinished(reportHelper));
  unsubscribers.push(watchDotJobs(computerDeps));
  unsubscribers.push(watchDotMachines(machineDeps));
  unsubscribers.push(onSparkTaskHost((host) => {
    if (!host) return;
    for (const [dotId] of controls) {
      const thread = getDotThread(dotId);
      if (thread && thread.runtime.status !== 'paused' && hasUnseenInput(thread)) kick(dotId);
    }
  }));
  // Triggers that look for things, every half minute, for the bots that are not paused.
  unsubscribers.push(startTriggerEngine({
    now: config.now,
    sources: triggerSources(),
    dotIds: () => [...controls.keys()].filter((dotId) => {
      const status = getDotThread(dotId)?.runtime.status;
      return status !== undefined && status !== 'paused';
    }),
    fire: postTrigger,
    folderRoot: (dotId) => getDotThread(dotId)?.runtime.computer?.root,
    screen: screenEvent,
  }));
  // Quiet moments for proactive research. Never without a model: a moment nobody asked for must not end in an error.
  const research = setInterval(() => {
    if (!getSparkTaskHost()?.executionModel()?.apiKey) return;
    const hasApps = profileStore.get().enabled && connectionsStore.get().enabled.length > 0;
    for (const dotId of controls.keys()) {
      const thread = getDotThread(dotId);
      if (!thread || control(dotId).running) continue;
      const slot = researchDue(thread, config.now(), config.timeZone(), { hasApps });
      if (!slot) continue;
      updateDotRuntime(dotId, (runtime) => ({ ...runtime, research: { ...runtime.research, lastAt: config.now(), lastSlot: slot } }));
      postEvent(dotId, { event: 'research', text: RESEARCH_EVENT });
      kick(dotId);
    }
  }, RESEARCH_CHECK_MS);
  unsubscribers.push(() => clearInterval(research));
  const compaction = setInterval(compactIdleDots, COMPACT_CHECK_MS);
  unsubscribers.push(() => clearInterval(compaction));
  const telegram = new AbortController();
  void withWebLock('willow-dots-telegram', () => runTelegramGateway(telegram.signal)).catch(() => undefined);
  unsubscribers.push(() => telegram.abort());
  // Every bot the user made a Discord bot reads its gateway, in one window at a time, from when it is linked.
  unsubscribers.push(discordLinks.subscribe((links) => syncDiscordGateways(links)));
  unsubscribers.push(() => {
    for (const controller of discordGateways.values()) controller.abort();
    discordGateways.clear();
    forgetDiscordGathered();
  });
  // The user coming back after time away, for return triggers: to the bots loaded now, and those that load soon after.
  unsubscribers.push(watchPresence((awayMs) => {
    returned = { awayMs, at: config.now() };
    for (const dotId of controls.keys()) {
      if (getDotThread(dotId)?.runtime.status !== 'paused') hearReturn(dotId, awayMs, config.now(), postTrigger);
    }
  }, config.now));
};

/** The last return to Willow, for bots whose threads load after it was noticed. */
let returned: { awayMs: number; at: number } | null = null;
const RETURN_GRACE_MS = 2 * 60_000;
const RESEARCH_CHECK_MS = 5 * 60_000;

/** For tests: stop everything and forget all state. */
export const stopDotsRuntime = (): void => {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
  dmTries.clear();
  discordQueues.clear();
  for (const [, entry] of controls) {
    entry.abort?.abort();
    clearTimeout(entry.timer);
  }
  controls.clear();
  dotActivity.set({});
  started = false;
};

/** The user wrote to the bot. */
export const sendDotMessage = async (dotId: string, text: string, attachments?: DotItem['attachments']): Promise<DotItem | null> => {
  const body = text.trim();
  const dot = findDot(dotId);
  // A picture on its own is a message too.
  if ((!body && !attachments?.length) || !dot) return null;
  await ensureLoaded(dot);
  const item = appendDotItem(dotId, { kind: 'user', text: body, ...(attachments?.length ? { attachments } : {}) });
  quoteOnDiscord(dotId, item, 'in Willow');
  const thread = getDotThread(dotId)!;
  // Writing to a bot wakes it, from sleep or from an error.
  if (thread.runtime.status === 'sleeping' || thread.runtime.status === 'error') {
    updateDotRuntime(dotId, { status: 'idle', lastError: undefined });
  }
  kick(dotId);
  return item;
};

/**
 * The user reacted to one of the bot's messages, changed their reaction, or took it back (`null`).
 * The bot hears every change; only a reaction that may answer it wakes it (`reactionMayAnswer`).
 */
export const reactToDotMessage = async (dotId: string, messageId: string, emoji: string | null): Promise<void> => {
  const dot = findDot(dotId);
  if (!dot) return;
  await ensureLoaded(dot);
  const thread = getDotThread(dotId)!;
  const message = thread.items.find((item) => item.id === messageId);
  if (!message || message.kind !== 'dot' || message.streaming) return;
  const next = emoji === null ? null : normalizeReactionEmoji(emoji);
  if (emoji !== null && !next) return;
  const current = userReactionsByMessage(thread).get(messageId) ?? null;
  if (current === next) return;
  const text = messageExcerpt(message.text);
  if (next === null) {
    appendDotItem(dotId, { kind: 'user-reaction', target: messageId, emoji: current!, removed: true, text });
    return;
  }
  const wakes = reactionMayAnswer(thread, message, next);
  appendDotItem(dotId, { kind: 'user-reaction', target: messageId, emoji: next, text, ...(wakes ? { wakes } : {}) });
  if (!wakes) return;
  if (thread.runtime.status === 'sleeping' || thread.runtime.status === 'error') {
    updateDotRuntime(dotId, { status: 'idle', lastError: undefined });
  }
  kick(dotId);
};

/** Stops what the bot is doing right now. It stays available. */
export const interruptDot = (dotId: string): void => {
  control(dotId).abort?.abort();
};

/** Pauses the dot: its current turn stops, and nothing wakes it until resumed. */
export const pauseDot = (dotId: string): void => {
  if (!getDotThread(dotId)) return;
  updateDotRuntime(dotId, { status: 'paused' });
  control(dotId).abort?.abort();
  stopDotHelpersFor(dotId);
  armTimer(dotId);
};

export const resumeDot = (dotId: string): void => {
  const thread = getDotThread(dotId);
  if (!thread || thread.runtime.status !== 'paused') return;
  updateDotRuntime(dotId, { status: thread.runtime.wakeAt ? 'sleeping' : 'idle' });
  fireDue(dotId);
  if (hasUnseenInput(getDotThread(dotId)!)) kick(dotId);
};

/** The user wrote how the bot should work with them. Empty clears it. Read into the bot's prompt from its next turn. */
export const setDotInstructions = (dotId: string, text: string): void => {
  if (!getDotThread(dotId)) return;
  const instructions = text.trim().slice(0, MAX_INSTRUCTIONS);
  updateDotRuntime(dotId, (runtime) => ({ ...runtime, instructions: instructions || undefined }));
};

export const MAX_INSTRUCTIONS = 4_000;

/** The user set the bot's quiet hours, or turned them off. */
export const setDotQuietHours = (dotId: string, quiet: { from: string; to: string; off?: boolean }): void => {
  if (!getDotThread(dotId)) return;
  updateDotRuntime(dotId, { quietHours: quiet });
};

/** The user turned the bot's proactive research on or off. */
export const setDotResearch = (dotId: string, on: boolean): void => {
  if (!getDotThread(dotId)) return;
  updateDotRuntime(dotId, (runtime) => ({ ...runtime, research: { ...runtime.research, off: !on } }));
};

/**
 * The user chose how freely the bot acts, in its profile's Permissions. Its tools follow the change at once, in a
 * turn already running too; its instructions, from its next turn.
 */
export const setDotPermissions = (dotId: string, mode: DotPermissionMode): void => {
  if (!getDotThread(dotId)) return;
  updateDotRuntime(dotId, { permissions: mode });
};

/** The user paused or resumed one of the bot's triggers, from its profile or its card. */
export const setDotTriggerPaused = (dotId: string, triggerId: string, paused: boolean): void => {
  if (!getDotThread(dotId)) return;
  setTriggerPaused(dotId, triggerId, paused, config.now());
  armTimer(dotId);
};

/** The user deleted one of the bot's triggers. The bot sees its list without it the next time it acts. */
export const deleteDotTrigger = (dotId: string, triggerId: string): void => {
  if (!getDotThread(dotId)) return;
  deleteTrigger(dotId, triggerId);
  armTimer(dotId);
};

/** The user ran a trigger now, ahead of its condition. Not while the bot is paused: nothing wakes it then. */
export const runDotTriggerNow = (dotId: string, triggerId: string): boolean => {
  const thread = getDotThread(dotId);
  if (!thread || thread.runtime.status === 'paused') return false;
  const ran = runTriggerNow(dotId, triggerId, config.now(), postTrigger);
  armTimer(dotId);
  return ran;
};

/* ------------------------------------------------------------------------ */
/* The bot's own computer                                                    */
/* ------------------------------------------------------------------------ */

const machineDeps = (): DotMachineDeps => ({ machine: config.machine, now: config.now, wake: (dotId) => kick(dotId) });

/**
 * Whether the bot has a computer this turn: where this window can run one (the
 * desktop app, with WSL or able to install it), and ready once the user set it
 * up. Before that its tools ask the user to.
 */
const machineFor = async (dotId: string): Promise<DotToolEnv['machine']> => {
  const status = await config.machine.status(dotId).catch(() => null);
  if (!status || !(status.supported || status.reason === 'wsl-missing')) return undefined;
  const allowed = Boolean(getDotThread(dotId)?.runtime.machine);
  const exists = Boolean(status.machine && status.machine.state !== 'none');
  return { bridge: config.machine, ready: status.supported && allowed && exists };
};

/** The bridge the bot's computer pane draws from. */
export const dotMachine = (): DotMachineBridge => config.machine;

export const setUpDotMachine = (dotId: string): Promise<string | null> => setUpMachine(dotId, machineDeps());
export const declineDotMachine = (dotId: string, itemId: string): void => declineMachineSetup(dotId, itemId, machineDeps());
export const turnOnDotMachine = (dotId: string): Promise<string | null> => turnOnMachine(dotId, machineDeps());
export const turnOffDotMachine = (dotId: string): Promise<string | null> => turnOffMachine(dotId, machineDeps());
export const resetDotMachine = (dotId: string): Promise<string | null> => resetMachine(dotId, machineDeps());
export const takeOverDotMachine = (dotId: string, requestId?: string) => takeOverMachine(dotId, requestId, machineDeps());
export const handBackDotMachine = (dotId: string, requestId: string) => handBackMachine(dotId, requestId, machineDeps());
export const dismissDotHelp = (dotId: string, itemId: string): Promise<string | null> => dismissHelp(dotId, itemId, machineDeps());
export const enterDotSecret = (dotId: string, itemId: string, value: string): Promise<string | null> => enterSecret(dotId, itemId, value, machineDeps());
export const installDotMachineSupport = (): Promise<void> => config.machine.installWsl();

/** After an error: try the waiting work again. */
export const retryDot = (dotId: string): void => {
  const thread = getDotThread(dotId);
  if (!thread || thread.runtime.status !== 'error') return;
  const entry = control(dotId);
  entry.retries = 0;
  clearTimeout(entry.retryTimer);
  // A turn that failed may have counted its input as handled: hand the last of it back, so Retry has something to answer.
  const lastInput = [...thread.items].reverse().find((item) => wakesDot(item));
  const rewind = !hasUnseenInput(thread) && lastInput ? { lastActedSeq: lastInput.seq - 1 } : {};
  updateDotRuntime(dotId, { status: 'idle', lastError: undefined, ...rewind });
  kick(dotId);
};

/** Removes a deleted bot's thread and stops its work. */
export const forgetDot = async (dotId: string): Promise<void> => {
  const entry = controls.get(dotId);
  entry?.abort?.abort();
  clearTimeout(entry?.retryTimer);
  await stopDotJobs(dotId, computerDeps());
  await removeMachine(dotId, machineDeps());
  clearTimeout(entry?.timer);
  controls.delete(dotId);
  stopDotHelpersFor(dotId);
  disconnectDotDiscord(dotId);
  const { [dotId]: _removed, ...rest } = dotActivity.get();
  dotActivity.set(rest);
  await deleteDotThread(dotId);
};

/* ------------------------------------------------------------------------ */
/* Discord                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Makes the bot a Discord bot of the user's: checks the token, learns who the bot and its owner (the user) are, and
 * starts listening. Resolves to a problem to show, or null once it is linked.
 */
export const connectDotDiscord = async (dotId: string, token: string): Promise<string | null> => {
  const dot = findDot(dotId);
  if (!dot) return 'This bot no longer exists.';
  const verified = await verifyDiscordToken(token, config.discord, config.now());
  if ('problem' in verified) return verified.problem;
  const taken = Object.entries(discordLinks.get()).find(([id, link]) => id !== dotId && link.botId === verified.botId);
  if (taken) {
    const other = findDot(taken[0]);
    return `That Discord bot is already ${other ? sparkDotName(other) : 'another bot'}’s. Make a new application for ${sparkDotName(dot)}.`;
  }
  const previous = discordLinkFor(dotId);
  if (previous && previous.token !== verified.token) void config.discord.close(previous.token).catch(() => undefined);
  setDiscordLink(dotId, { ...verified, ...(previous?.botId === verified.botId && previous.dmChannelId ? { dmChannelId: previous.dmChannelId } : {}) });
  patchDiscordState(dotId, { status: 'connecting', problem: undefined, guilds: [], epoch: undefined, after: undefined, guildsVersion: undefined }, config.now());
  return null;
};

/** The bot stops being on Discord: its gateway closes and the token is forgotten. The Discord application stays the user's. */
export const disconnectDotDiscord = (dotId: string): void => {
  const link = discordLinkFor(dotId);
  if (!link) return;
  void config.discord.close(link.token).catch(() => undefined);
  setDiscordLink(dotId, null);
  dmTries.delete(dotId);
  forgetDiscordGathered(dotId);
};

/** Looks again at what the Discord application allows, after the user changed it in Discord. */
export const refreshDotDiscord = (dotId: string): Promise<void> => refreshDiscordContent(dotId);
