/**
 * The shape of a bot's single, never-ending thread.
 *
 * Everything that ever happens between a bot and its user is an item in one
 * append-only list. Items are never rewritten or deleted by the harness — the
 * list is the record, and every other layer of memory (episodes, the notebook,
 * the verbatim window the model reads) is a view of it. That is what lets the
 * bot "never forget": a summary can lose a detail, the record cannot, and every
 * summary points back into the record by item id.
 */

/** What an item is. Inputs come from outside the bot; outputs are its own. */
export type DotItemKind =
  /** A message the user wrote. Input. */
  | 'user'
  /** Something that happened: a wake-up, delegated work finishing, a routine coming due. Input. */
  | 'event'
  /** A tool result handed back to the bot. Input. */
  | 'result'
  /** A message the bot sent. Visible to the user. */
  | 'dot'
  /** A reaction the bot placed on one of the user's messages. Visible to the user. */
  | 'reaction'
  /**
   * A reaction the user placed on one of the bot's messages, or took back. Input; visible on that
   * message. Its `text` is the start of that message, which is how the bot knows which one it was:
   * the bot's own output carries no ids in its view.
   */
  | 'user-reaction'
  /** The bot's private prose between actions. Never shown in the conversation. */
  | 'work'
  /** A tool call the bot made. Private. */
  | 'call'
  /** The bot's "Up next" status line changed. Visible as status, not as a message. */
  | 'status'
  /** The bot asked to run a command on the user's computer and is waiting for approval. Visible as a card. */
  | 'approval'
  /** The bot asked the user to set up its own computer. Visible as a card. */
  | 'machine'
  /** The bot — or a page it was on — asked the user to take over its computer, or to type in a secret. Visible as a card. */
  | 'help'
  /**
   * The bot set up or changed one of its triggers. Visible as a card showing the trigger as it is now; `ref` is the
   * trigger's id and `text` what it was when the card was made.
   */
  | 'trigger-card'
  /** The bot asked to send an email in the user's name; a card showing the message and, until decided, Send. */
  | 'outgoing'
  /** The bot changed files in the user's connected folder; a card listing what changed. */
  | 'edit'
  /** The bot started a plan; a card showing the plan as it is now (`ref` is its id, `text` its steps then). */
  | 'plan-card'
  /** The bot asked to see and use the user's own screen — their mouse and keyboard; a card that allows it, and stops it. */
  | 'screen';

export const INPUT_KINDS: ReadonlySet<DotItemKind> = new Set(['user', 'user-reaction', 'event', 'result']);
export const VISIBLE_KINDS: ReadonlySet<DotItemKind> = new Set(['user', 'dot', 'reaction', 'user-reaction', 'approval', 'machine', 'help', 'trigger-card', 'outgoing', 'edit', 'plan-card', 'screen']);

/** Steps the bot hears about but has nothing to do with yet: what it acts on comes next. */
const QUIET_MACHINE_STEPS: ReadonlySet<DotMachineStep> = new Set(['allowed', 'taken', 'reset', 'off']);

/**
 * Whether an item asks for the bot's attention: anything from outside it,
 * except interim notes — an approved command starting (its output follows), an
 * approved email being sent (whether it went follows),
 * its computer being set up (it hears when it is ready), the user taking the
 * wheel (it hears when they hand it back), and changes the user made to its
 * computer that ask nothing of it. A reaction from the user wakes the bot only
 * when it may answer something (`DotItem.wakes`); any other is an
 * acknowledgement the bot reads the next time it acts.
 */
export const wakesDot = (item: DotItem): boolean =>
  item.kind === 'user'
  || (item.kind === 'user-reaction' && Boolean(item.wakes))
  || (item.kind === 'event' && !item.quiet && item.approvalStep !== 'approved' && item.outgoingStep !== 'sending' && item.editStep !== 'applying' && !(item.machineStep && QUIET_MACHINE_STEPS.has(item.machineStep)));

export type DotEventKind =
  /** In older records: the bot was just created and introduced itself. New bots start silent. */
  | 'introduce'
  /** A sleep the bot set has ended. */
  | 'wake'
  /** One of the bot's recurring routines came due. Routines became schedule triggers; older records keep the name. */
  | 'routine'
  /** One of the bot's triggers fired: a time came, or something it watches for happened. */
  | 'trigger'
  /** A quiet moment for proactive research, with tools that can only look. */
  | 'research'
  /** A Spark task the bot assigned changed state. */
  | 'spark-task'
  /** A background helper finished. */
  | 'helper'
  /** The bot is resuming after Willow was closed through a planned wake-up. */
  | 'resumed'
  /** The user answered a command approval; carries the command's output when it ran. */
  | 'approval'
  /** What became of an email the bot asked to send: sent, declined, or failed and why. */
  | 'outgoing'
  /** What became of changes the bot proposed to the user's files: applied, declined, or failed and why. */
  | 'edit'
  /** The bot's plan has steps left and nothing waits on the user: carry on. */
  | 'continue'
  /** The bot reacted that it was on something and ended its turn without starting: a reminder, once per message. */
  | 'follow-through'
  /** What became of the bot's request to use the user's screen: allowed, declined, stopped by them, or ended. */
  | 'screen'
  /** The bot finished its plan: look back once, for skills and lessons worth keeping. */
  | 'reflect'
  /** Something happened to the bot's own computer: set up, handed over and back, reset. */
  | 'machine'
  /** A harness notice the bot should know about (an error it hit, a limit). */
  | 'notice';

/**
 * A step in the life of the bot's own computer, for the `machine` or `help`
 * item in `ref` when there is one: the user allowed it, it became `ready` (or
 * `failed`), they `declined`; they took it (`taken`) and gave it back
 * (`returned`), or a request for help was `cancelled`, `expired` or
 * `interrupted`; a secret was `entered`; the user `reset` it or turned it `off`.
 */
export type DotMachineStep = 'allowed' | 'ready' | 'failed' | 'declined' | 'taken' | 'returned' | 'cancelled' | 'expired' | 'interrupted' | 'entered' | 'reset' | 'off';

/** Who asked for a person at the bot's computer: the bot, the user unasked, or a page that wants a human. */
export type DotHelpSource = 'model' | 'person' | 'cloudflare' | 'visible-challenge';

/** What a `help` card asks of the user. */
export interface DotHelpCard {
  /** The computer's id for the request, which the wheel is handed over by. */
  requestId: string;
  /** Take the computer over, or type one secret into one field. */
  kind: 'takeover' | 'secret';
  reason: string;
  source: DotHelpSource;
  /** `secret`: what is wanted, in a few words. */
  label?: string;
  /** The page it was on when it asked. */
  url?: string;
  title?: string;
}

export interface DotCommandApproval {
  command: string;
  /** Working directory, relative to `root`. */
  cwd: string;
  /** The connected folder the command is confined to. */
  root: string;
  /** Why the bot wants to run it, in its own words. */
  reason: string;
  /** Foreground commands only: how long it may run before it is stopped. */
  timeoutSeconds: number;
  /** A background job: it keeps running after approval, and the bot hears when it ends. */
  background?: boolean;
  /** The prefix the user may approve for good with it, when one is safe to offer (Codex's `prefix_rule`). */
  prefix?: string[];
}

/** Files the bot changed in the connected folder in one edit, for the card that shows it. */
export interface DotEditRecord {
  root: string;
  /** Each file changed, with the lines it gained and lost — or, for a file copied from the bot's computer, its `bytes`. */
  files: { path: string; kind: 'add' | 'update'; added: number; removed: number; bytes?: number }[];
  /**
   * Proposed, not made: the bot checks with the user first, and the files change when they apply it — a `patch`, or a
   * `copy` of a file in the bot's folder on its own computer to `root`/`path`. `scope` is what was connected when it
   * was proposed: its paths mean nothing anywhere else.
   */
  proposed?: { patch?: string; copy?: { from: string; root: string; path: string }; scope: { root: string; whole?: boolean } };
}

export interface DotOutgoingMail {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  /** Why the bot is sending it, in its own words. */
  reason: string;
  /** A reply: the thread, and the message it answers. */
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  /**
   * Sent without asking: under the user's standing permission for every recipient, or (`mode`) because the user lets
   * the bot act without asking.
   */
  standing?: boolean | 'mode';
}

/** Where on Discord the user wrote a message, so the bot's answer — and its reactions — go back there. */
export interface DotDiscordSource {
  channelId: string;
  messageId: string;
  /** A server's channel rather than the bot's DM with the user: everyone in the channel reads the answer. */
  guildId?: string;
  /** The channel and server, in words. */
  where?: string;
}

/** A message the bot asked to post on Discord where people other than the user read it. What is approved is what goes. */
export interface DotDiscordPost {
  channelId: string;
  /** The channel and server, in words. */
  where: string;
  text: string;
  /** The Discord message it answers. */
  replyTo?: string;
  /** Why the bot is posting it, in its own words. */
  reason: string;
  /**
   * Posted without asking: under the user's standing permission for the channel, or (`mode`) because the user lets
   * the bot act without asking.
   */
  standing?: boolean | 'mode';
}

/** A Discord channel the user lets this bot post in without asking each time. Granted from a post card. */
export interface DotDiscordPermission {
  channelId: string;
  where: string;
  grantedAt: number;
}

/** A step of a plan: Codex's three states, and `waiting` for a step that waits on someone or something else. */
export interface DotPlanStep {
  step: string;
  status: 'pending' | 'in_progress' | 'waiting' | 'completed';
}

/** The bot's plan for work that takes several steps: kept in view each turn, and carried on until it is done. */
export interface DotPlan {
  id: string;
  /** How the bot will know the work is done. */
  goal?: string;
  steps: DotPlanStep[];
  createdAt: number;
  updatedAt: number;
  /** Turns in a row Willow woke the bot to carry on that left the plan as it was. */
  stillTurns?: number;
  /** Willow stopped waking the bot for it: it did not move in that many turns. Cleared when the plan changes. */
  stalledAt?: number;
  /** When the bot was asked to look back on the finished plan. */
  reflectedAt?: number;
}

/** What a bot's own profile of the user is divided into: what it needs to know to do its job for them. */
export type DotLearnedSection = 'work' | 'preferences' | 'people' | 'projects' | 'routines' | 'facts';

/** One thing a bot learned about the user from its own conversations. */
export interface DotLearnedFact {
  id: string;
  section: DotLearnedSection;
  /** One plain sentence about the user, in the third person. */
  text: string;
  /** The items it was learned from. */
  sources: string[];
  learnedAt: number;
  updatedAt: number;
}

/**
 * A bot's own profile of the user, learned in the background from its conversations: this bot's alone — not
 * shared with other bots, not written into Willow's Personal Intelligence. It outlasts compaction, because it is
 * learned from every stretch before that stretch is summarised.
 */
export interface DotLearnedProfile {
  facts: DotLearnedFact[];
  /** The last item the learner has read. */
  throughSeq: number;
  learnedAt?: number;
  /** The user switched learning off for this bot. */
  off?: boolean;
}

/** Someone the user lets this bot email without asking each time. Granted from a send card; removed in its profile. */
export interface DotSendPermission {
  /** Lower-cased address. */
  address: string;
  grantedAt: number;
}

/** A background job the bot started on the user's computer, after the user approved it. */
export interface DotJob {
  /** The approval it ran from; the bot refers to the job by this id. */
  id: string;
  /** The companion's id for the process. */
  jobId: string;
  command: string;
  root: string;
  cwd: string;
  startedAt: number;
  status: 'running' | 'finished' | 'failed' | 'stopped' | 'lost';
  endedAt?: number;
  code?: number | null;
  /** How far the bot has read its output, as an offset into everything the job printed. */
  readTo?: number;
}

/** A file that came with a message. Its bytes are Spark's attachment payloads (`attachment-storage.ts`), by `id`. */
export interface DotAttachmentRef {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
  type?: 'image' | 'text' | 'file';
}

export interface DotItem {
  /** Model-visible, stable id: `i<seq>`. */
  id: string;
  seq: number;
  kind: DotItemKind;
  /** Epoch milliseconds. */
  at: number;
  /** The turn that produced it. Inputs from outside carry none. */
  turnId?: string;
  text: string;
  /** `call` / `result`: the tool involved. */
  tool?: string;
  /** `result`: the id of the `call` item it answers. */
  callId?: string;
  /** `call`: the parsed arguments. */
  args?: Record<string, unknown>;
  /** `result`: the tool failed and said why in `text`. */
  failed?: boolean;
  /** `reaction`: the id of the user message reacted to; `user-reaction`: the id of the bot's message. */
  target?: string;
  emoji?: string;
  label?: string;
  /** `user-reaction`: the user took this emoji back. */
  removed?: boolean;
  /**
   * `user-reaction`: it may answer the bot — the message it is on asked the
   * user something they have not written back about, or the emoji says they
   * are unsure — so it wakes the bot.
   */
  wakes?: boolean;
  /** `event`: what kind of event. */
  event?: DotEventKind;
  /** `event`: what it is about, e.g. a Spark task id. */
  ref?: string;
  /** `user`: files that came with the message. */
  attachments?: DotAttachmentRef[];
  /** `user`: written somewhere other than Willow, where the bot's answer goes too. */
  via?: 'telegram' | 'discord';
  /** `user` written on Discord: where. */
  discord?: DotDiscordSource;
  /**
   * Where the model met this input, when that differs from `seq`. An input that
   * arrives while the bot is writing gets a lower seq than the output it did not
   * see; the transcript places it after that output instead, so the model never
   * reads its own reply as if written with the message in view. The conversation
   * the user sees stays in `seq` order.
   */
  order?: number;
  /** `bot`: still being written. Only ever true in memory, never persisted. */
  streaming?: boolean;
  /**
   * `approval`: the exact command the bot wants to run, where, and why. What the
   * user approves is what runs — the model never re-issues it after the fact.
   */
  approval?: DotCommandApproval;
  /**
   * `approval` events: which step of an approval this records, for the item in
   * `ref`. `approved` is written before a command starts, so a reload can never
   * offer to run it twice; `started` marks a background job running; `finished`
   * carries what it printed.
   */
  approvalStep?: 'approved' | 'started' | 'declined' | 'withdrawn' | 'finished';
  /** `outgoing`: the email, exactly as it will be sent. What the user approves is what goes. */
  outgoing?: DotOutgoingMail;
  /** `outgoing`: a Discord post instead of an email, exactly as it will go. */
  discordPost?: DotDiscordPost;
  /** `edit`: what changed in the connected folder. */
  edit?: DotEditRecord;
  /**
   * `outgoing` events: what became of the email in `ref`. `sending` is written before the send, so a reload never
   * sends it twice; `sent`, `declined` or `failed` (with why in `text`) close it.
   */
  outgoingStep?: 'sending' | 'sent' | 'declined' | 'failed';
  /** A `failed` outgoing step (or a card sent under a standing permission): why the email did not go, for the user. */
  problem?: string;
  /** `edit` events: what became of the proposed change in `ref`. `applying` is written before anything is. */
  editStep?: 'applying' | 'applied' | 'declined' | 'failed';
  /** A message the user wrote on Telegram: its id there, where the bot's reaction on it goes too. */
  telegram?: { messageId: number };
  /** `screen`: why the bot wants the user's screen, and — `standing: 'mode'` — that it had it at once, as its Permissions allow. */
  screen?: { reason: string; standing?: 'mode' };
  /** `screen` events: what became of the request in `ref`. */
  screenStep?: 'allowed' | 'declined' | 'stopped' | 'ended';
  /** An event kept for the record, which tells the bot nothing it does not already know: it never wakes it. */
  quiet?: boolean;
  /** `help`: what the bot asked the user to do at its computer. */
  help?: DotHelpCard;
  /** `machine` events: which step this records. */
  machineStep?: DotMachineStep;
}

/**
 * A summary of a stretch of the record.
 *
 * Level 1 episodes summarise raw items; level 2 and above summarise episodes
 * (a "chapter"). Only top-level episodes — those no higher episode absorbed —
 * are shown to the model, oldest first, so the whole past stays covered at a
 * bounded size while recent stretches keep more detail than old ones.
 */
export interface DotEpisode {
  id: string;
  level: number;
  fromSeq: number;
  toSeq: number;
  fromAt: number;
  toAt: number;
  text: string;
  /** Estimated tokens of `text`. */
  tokens: number;
  /** For level 2+: the episodes this one absorbed. */
  childIds?: string[];
  /** Set once a higher-level episode has absorbed this one. */
  absorbedBy?: string;
  createdAt: number;
}

export interface DotNotebookFile {
  text: string;
  updatedAt: number;
}

export type DotRoutineEvery = 'hour' | 'day' | 'weekday' | 'week';

export interface DotRoutine {
  id: string;
  every: DotRoutineEvery;
  /** `HH:MM` in the user's local time. Ignored for `hour`, which uses `minute`. */
  at?: string;
  /** For `hour`: the minute past each hour. */
  minute?: number;
  /** For `week`: weekdays, 0 = Sunday. */
  days?: number[];
  instruction: string;
  nextAt: number;
  /** The routine stops after this instant (epoch ms). Absent: it repeats until removed. */
  until?: number;
  createdAt: number;
}

/** How often a repeating trigger runs. Times of day are wall-clock times in the trigger's zone. */
export type DotTriggerEvery = 'minutes' | 'hours' | 'day' | 'weekday' | 'week' | 'month' | 'year';

/** What makes a trigger fire. */
export type DotTriggerWhen =
  /** Once, at an instant. */
  | { type: 'once'; at: number }
  /**
   * On a repeating schedule. `interval` counts minutes or hours; `at` is `HH:MM`; `days` are weekdays, 0 = Sunday;
   * a yearly one falls on `month` (1–12) and `dayOfMonth`.
   */
  | { type: 'schedule'; every: DotTriggerEvery; interval?: number; at?: string; minute?: number; days?: number[]; dayOfMonth?: number; month?: number }
  /** A new email matching a Gmail search arrives. */
  | { type: 'email'; query: string }
  /** A calendar event, optionally one whose title contains `match`, is `minutesBefore` from starting. */
  | { type: 'calendar'; minutesBefore: number; match?: string }
  /** A GitHub pull request or issue involving the user is opened or updated, optionally in one repository or matching words. */
  | { type: 'github'; watch: 'pull_requests' | 'issues'; repo?: string; match?: string }
  /** A Spark task the bot did not assign itself reaches a status, optionally one whose title contains `match`. */
  | { type: 'spark_task'; status: 'complete' | 'failed' | 'needs-input' | 'any'; match?: string }
  /** A web page changes, or comes to contain `contains`; checked every `everyMinutes`. */
  | { type: 'web_page'; url: string; contains?: string; everyMinutes: number }
  /** Files change in the folder the user connected, or in `path` inside it. */
  | { type: 'folder'; path?: string }
  /** The user comes back to Willow after at least `awayHours` away. */
  | { type: 'user_returns'; awayHours: number }
  /**
   * A message on Discord, where the user made the bot a Discord bot: in a channel (an id or a name, or `dm` for its
   * DMs) or server, from someone, containing words, or only those that mention the bot.
   */
  | { type: 'discord'; channel?: string; server?: string; from?: string; match?: string; mentions?: boolean };

export type DotTriggerType = DotTriggerWhen['type'];

/**
 * How the user wants to hear about a trigger's runs: every time, only when a run finds something that matters
 * (the default), or not at all — the bot does the work and keeps it for when they ask.
 */
export type DotTriggerNotify = 'always' | 'important' | 'never';

/**
 * "When this happens, do that": a standing instruction with a condition — a time, or something in the user's
 * world the bot watches for. Firing posts a `trigger` event, which wakes the bot with the instruction.
 */
export interface DotTrigger {
  /** `t1`, `t2`, … */
  id: string;
  /** A few words, shown to the user. */
  name: string;
  when: DotTriggerWhen;
  /** What the bot does each time it fires. */
  instruction: string;
  /**
   * Event triggers: what an event must also be, in plain words, for the bot to wake for it. The source's own
   * filter narrows what is looked at; this is the judgement left over, and a small screening request checks it
   * against each event first, so the ones that fail it never cost the bot a turn.
   */
  condition?: string;
  /** A schedule kept as a heartbeat: a regular check-in on something with no event to fire on. */
  heartbeat?: boolean;
  notify: DotTriggerNotify;
  status: 'active' | 'paused' | 'ended';
  /** The zone its times are in, fixed when it was made, as a schedule set somewhere keeps that place's clock. */
  timeZone: string;
  createdAt: number;
  updatedAt: number;
  /** Time triggers: when it fires next. Event triggers: when to look next. */
  nextAt?: number;
  /** It ends after this instant. */
  until?: number;
  /** It ends after this many runs. */
  maxRuns?: number;
  runs: number;
  lastRunAt?: number;
  /** Events its condition screened out, which woke nobody, and when the last was. */
  screened?: number;
  lastScreenedAt?: number;
  /** Event triggers: keys of what has already been seen, so only what is new fires it. Newest last, capped. */
  seen?: string[];
  /** `web_page`: a fingerprint of the page's text when last looked at, and whether it contained the text then. */
  fingerprint?: string;
  contained?: boolean;
  /** Event triggers: the first look happened. It records what is already there, so old things never fire it. */
  primed?: boolean;
  /** Why the last look failed, in a sentence for the user; cleared when one succeeds. */
  problem?: string;
  /** Why it ended, when it did. */
  endedBecause?: string;
}

export type DotDelegationKind = 'spark-task' | 'helper';

export interface DotDelegation {
  kind: DotDelegationKind;
  id: string;
  title: string;
  /** Last status the bot was told about, so a change is reported once. */
  status: string;
  createdAt: number;
  updatedAt: number;
}

export type DotStatus = 'idle' | 'working' | 'sleeping' | 'paused' | 'error';

/**
 * How freely the bot acts, as the user set it in its profile: ask before doing anything; ask when it needs to (the
 * default: reversible work freely, anything that acts on the world with their go-ahead); or act at once.
 */
export type DotPermissionMode = 'ask' | 'auto' | 'act';

export interface DotRuntimeState {
  status: DotStatus;
  /** When a sleep ends. */
  wakeAt?: number;
  wakeReason?: string;
  /** The bot's own first-person "Up next" line. */
  upNext?: string;
  /** The highest item seq the bot has already acted on. Items after it are new to it. */
  lastActedSeq: number;
  /**
   * The highest item seq a model request has had in hand, counted at the model's first sign of life rather than when
   * the request was sent: the user's "Seen". Unset in threads from before it, which read `lastActedSeq` instead.
   */
  readSeq?: number;
  /** Every item at or below this seq is covered by a level-1 episode. */
  lastCompactedSeq: number;
  /** Routines from before triggers. Each becomes a schedule trigger when the thread loads; empty after that. */
  routines: DotRoutine[];
  /** The bot's triggers: what wakes it besides the user, its sleeps and its delegated work. */
  triggers?: DotTrigger[];
  delegations: DotDelegation[];
  /** Why the last turn failed, shown to the user until the next turn succeeds. */
  lastError?: string;
  usage: { inputTokens: number; outputTokens: number; turns: number };
  /** Measured characters per token for this bot's model, from provider usage. */
  charsPerToken?: number;
  /**
   * History from before the harness has been taken as handled. (Bots once introduced themselves when created and
   * set this then; a new bot now starts silent, and its conversation empty.)
   */
  introduced?: boolean;
  /**
   * The folder on the user's computer the bot works in, when connected. `rules` are the command prefixes the user
   * approved for good there, each as its words (`["npm", "test"]`), as Codex keeps them.
   */
  computer?: {
    root: string;
    connectedAt: number;
    rules?: string[][];
    /** The whole computer rather than a folder (the desktop app): `root` is the drive `home` is on, and any drive can be reached. */
    whole?: boolean;
    home?: string;
  };
  /** Background jobs the bot started on the user's computer, newest last. */
  jobs?: DotJob[];
  /**
   * The user's screen, while they let the bot see and use it: the request that allowed it, since when, and when the
   * bot last used it. It lapses after a quiet spell (`runtime/screen-control.ts`).
   */
  screen?: { itemId: string; since: number; lastAt: number };
  /** Notify the user natively when the bot writes while Willow is out of sight. */
  notifications?: boolean;
  /**
   * Hours, `HH:MM` local, when the bot holds what can wait and notifications stay quiet unless the user is writing
   * to it. Absent: 22:00 to 08:00.
   */
  quietHours?: { from: string; to: string; off?: boolean };
  /** Proactive moments (look, take notes, plan), every few hours of the user's day. Absent: on. `lastSlot` is the last one used. */
  research?: { off?: boolean; lastAt?: number; lastSlot?: string };
  /** What the user wrote, in the profile, about how the bot should work with them. Read into its prompt every turn. */
  instructions?: string;
  /** How freely it acts, from its profile's Permissions. Absent: `auto`, asking when it needs to. */
  permissions?: DotPermissionMode;
  /** People the user lets this bot email without approving each message. */
  sendTo?: DotSendPermission[];
  /** Discord channels the user lets this bot post in without approving each message. */
  discordChannels?: DotDiscordPermission[];
  /** The plan the bot is working through, if any. */
  plan?: DotPlan;
  /** What the bot has learned about the user from its own conversations. */
  learned?: DotLearnedProfile;
  /**
   * The bot's own computer, once the user has set it up. `blockedAt` marks an
   * action refused because a person had the computer, so their handing it back
   * wakes the bot to carry on.
   */
  machine?: { allowedAt: number; blockedAt?: number };
}

export interface DotThread {
  version: 1;
  dotId: string;
  items: DotItem[];
  nextSeq: number;
  episodes: DotEpisode[];
  notebook: Record<string, DotNotebookFile>;
  runtime: DotRuntimeState;
}

export const itemIdFor = (seq: number): string => `i${seq}`;

export const emptyRuntime = (): DotRuntimeState => ({
  status: 'idle',
  lastActedSeq: 0,
  lastCompactedSeq: 0,
  routines: [],
  delegations: [],
  usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
});

export const emptyThread = (dotId: string): DotThread => ({
  version: 1,
  dotId,
  items: [],
  nextSeq: 1,
  episodes: [],
  notebook: {},
  runtime: emptyRuntime(),
});

/** Episodes the model sees: top-level ones, oldest first. */
export const visibleEpisodes = (thread: Pick<DotThread, 'episodes'>): DotEpisode[] =>
  thread.episodes.filter((episode) => !episode.absorbedBy).sort((a, b) => a.fromSeq - b.fromSeq);
