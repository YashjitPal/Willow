import { atom, computed } from 'nanostores';
import type {
  SparkConnectedAppId,
  SparkCustomApp,
  SparkLocation,
  SparkSchedule,
  SparkReaction,
  SparkSkill,
  SparkTask,
  SparkActivityPhase,
  SparkTaskAttachment,
  SparkTaskStatus,
  SparkTaskTurn,
  SparkActivityEntry,
} from './spark-types';

export type {
  SparkConnectedAppId,
  SparkCustomApp,
  SparkLocation,
  SparkSchedule,
  SparkReaction,
  SparkSkill,
  SparkTask,
  SparkActivityPhase,
  SparkTaskAttachment,
  SparkTaskStatus,
  SparkTaskTurn,
  SparkActivityEntry,
} from './spark-types';

export interface SparkState {
  location: SparkLocation;
  tasks: SparkTask[];
  schedules: SparkSchedule[];
  skills: SparkSkill[];
  connections: Record<SparkConnectedAppId, boolean>;
  customApps: SparkCustomApp[];
}

export type SparkTaskUpdate = Partial<
  Omit<SparkTask, 'id' | 'createdAt' | 'updatedAt'>
>;

export interface CreateSparkTaskOptions extends SparkTaskUpdate {
  id?: string;
  openTask?: boolean;
}

export interface AppendSparkTaskTurnInput {
  id?: string;
  prompt: string;
  response: string;
  modelLabel?: string;
  thinkingSteps?: string[];
  activityTitle?: string;
  activityLog?: SparkActivityEntry[];
  usedTools?: string[];
  activityPhase?: SparkActivityPhase;
  attachments?: SparkTaskAttachment[];
  createdAt?: string;
}

export type SparkTaskTurnUpdate = Partial<Omit<SparkTaskTurn, 'id' | 'createdAt'>>;

export type SparkScheduleInput = Omit<SparkSchedule, 'id' | 'createdAt' | 'updatedAt'>;
export type SparkSkillInput = Omit<SparkSkill, 'id' | 'createdAt' | 'updatedAt'>;
export type SparkCustomAppInput = Pick<SparkCustomApp, 'name' | 'url'>;

// New account scopes start without another user's copied demo history. Existing
// persisted tasks and schedules continue to hydrate normally.
export const INITIAL_SPARK_TASKS: readonly SparkTask[] = [];

export const INITIAL_SPARK_SCHEDULES: readonly SparkSchedule[] = [];

export const INITIAL_SPARK_CONNECTIONS: Record<SparkConnectedAppId, boolean> = {
  workspace: true,
  'youtube-music': false,
  contacts: false,
  opentable: false,
};

const cloneInitialTasks = () => INITIAL_SPARK_TASKS.map((task) => ({
  ...task,
  attachments: task.attachments?.map((attachment) => ({ ...attachment })),
    thinkingSteps: task.thinkingSteps ? [...task.thinkingSteps] : undefined,
    activityTitle: task.activityTitle,
    activityLog: task.activityLog ? task.activityLog.map((entry) => ({ ...entry })) : undefined,
    activityPhase: task.activityPhase,
  tools: task.tools ? [...task.tools] : undefined,
  usedTools: task.usedTools ? [...task.usedTools] : undefined,
  turns: task.turns.map((turn) => ({
    ...turn,
    thinkingSteps: turn.thinkingSteps ? [...turn.thinkingSteps] : undefined,
    activityTitle: turn.activityTitle,
    activityLog: turn.activityLog ? turn.activityLog.map((entry) => ({ ...entry })) : undefined,
    activityPhase: turn.activityPhase,
    usedTools: turn.usedTools ? [...turn.usedTools] : undefined,
    attachments: turn.attachments?.map((attachment) => ({ ...attachment })),
  })),
}));

const cloneInitialSchedules = () => INITIAL_SPARK_SCHEDULES.map((schedule) => ({
  ...schedule,
  weekdays: [...schedule.weekdays],
}));

const createInitialState = (): SparkState => ({
  location: { page: 'home' },
  tasks: cloneInitialTasks(),
  schedules: cloneInitialSchedules(),
  skills: [],
  connections: { ...INITIAL_SPARK_CONNECTIONS },
  customApps: [],
});

export const sparkState = atom<SparkState>(createInitialState());

export const sparkLocation = computed(sparkState, ({ location }) => location);
export const sparkTasks = computed(sparkState, ({ tasks }) => tasks);
export const sparkSchedules = computed(sparkState, ({ schedules }) => schedules);
export const sparkSkills = computed(sparkState, ({ skills }) => skills);

const cleanSingleLine = (value: string) => value.replace(/\s+/g, ' ').trim();

export const getSparkTaskTitle = (prompt: string): string => {
  const singleLine = cleanSingleLine(prompt);
  return singleLine.length > 64 ? `${singleLine.slice(0, 61)}...` : singleLine;
};

const createTaskId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `spark-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createTaskTurnId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `spark-turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createRecordId = (prefix: string): string =>
  globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const SPARK_STORAGE_VERSION = 1;
export const SPARK_HISTORY_STATE_KEY = 'willowSparkLocation';
let activeSparkStorageScope = 'guest';
let hasHydratedSparkState = false;

export const getActiveSparkStorageScope = (): string => activeSparkStorageScope;
export const isSparkStateHydratedForScope = (scopeId = 'guest'): boolean =>
  hasHydratedSparkState && activeSparkStorageScope === (scopeId || 'guest');

const getSparkStorageKey = (scopeId: string) =>
  `willow:spark:v${SPARK_STORAGE_VERSION}:${encodeURIComponent(scopeId || 'guest')}`;

const omitAttachmentPayload = ({ data: _data, ...attachment }: SparkTaskAttachment) => attachment;

const createPersistableSparkState = (state: SparkState): SparkState => ({
  ...state,
  tasks: state.tasks.map((task) => ({
    ...task,
    attachments: task.attachments?.map(omitAttachmentPayload),
    turns: task.turns.map((turn) => ({
      ...turn,
      attachments: turn.attachments?.map(omitAttachmentPayload),
    })),
  })),
});

const SPARK_SYNC_CHANNEL = 'willow-spark-state';
let sparkSyncChannel: BroadcastChannel | null = null;

type SparkSyncCollection = 'customApps' | 'schedules' | 'skills' | 'tasks';

interface SparkSyncDeletions {
  customApps: string[];
  schedules: string[];
  skills: string[];
  tasks: string[];
}

interface SparkSyncStamp {
  actor: string;
  counter: number;
}

interface SparkSyncEntry {
  deleted: boolean;
  stamp: SparkSyncStamp;
}

interface SparkSyncMetadata {
  connections: Partial<Record<SparkConnectedAppId, SparkSyncStamp>>;
  records: Record<SparkSyncCollection, Record<string, SparkSyncEntry>>;
  version: 1;
}

interface PersistedSparkState extends SparkState {
  sync?: SparkSyncMetadata;
}

interface SparkSnapshot {
  state: SparkState;
  sync: SparkSyncMetadata;
}

const createEmptySparkSyncMetadata = (): SparkSyncMetadata => ({
  version: 1,
  connections: {},
  records: {
    customApps: {},
    schedules: {},
    skills: {},
    tasks: {},
  },
});

const sparkSyncActor = globalThis.crypto?.randomUUID?.()
  ?? `spark-tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
let sparkSyncClock = 0;
let activeSparkSyncMetadata = createEmptySparkSyncMetadata();

const compareSparkSyncStamps = (left: SparkSyncStamp, right: SparkSyncStamp): number =>
  left.counter - right.counter || left.actor.localeCompare(right.actor);

const absorbSparkSyncClock = (metadata: SparkSyncMetadata): void => {
  const counters = [
    ...Object.values(metadata.connections).map((stamp) => stamp?.counter ?? 0),
    ...Object.values(metadata.records).flatMap((entries) =>
      Object.values(entries).map((entry) => entry.stamp.counter)),
  ];
  sparkSyncClock = Math.max(sparkSyncClock, ...counters);
};

const nextSparkSyncStamp = (): SparkSyncStamp => ({
  actor: sparkSyncActor,
  counter: ++sparkSyncClock,
});

const cloneSparkSyncMetadata = (metadata: SparkSyncMetadata): SparkSyncMetadata => ({
  version: 1,
  connections: Object.fromEntries(
    Object.entries(metadata.connections).map(([id, stamp]) => [id, stamp ? { ...stamp } : stamp]),
  ) as Partial<Record<SparkConnectedAppId, SparkSyncStamp>>,
  records: {
    customApps: Object.fromEntries(Object.entries(metadata.records.customApps).map(([id, entry]) => [
      id,
      { deleted: entry.deleted, stamp: { ...entry.stamp } },
    ])),
    schedules: Object.fromEntries(Object.entries(metadata.records.schedules).map(([id, entry]) => [
      id,
      { deleted: entry.deleted, stamp: { ...entry.stamp } },
    ])),
    skills: Object.fromEntries(Object.entries(metadata.records.skills).map(([id, entry]) => [
      id,
      { deleted: entry.deleted, stamp: { ...entry.stamp } },
    ])),
    tasks: Object.fromEntries(Object.entries(metadata.records.tasks).map(([id, entry]) => [
      id,
      { deleted: entry.deleted, stamp: { ...entry.stamp } },
    ])),
  },
});

const normalizeSparkSyncStamp = (value: unknown): SparkSyncStamp | null => {
  if (!isRecord(value)
    || typeof value.actor !== 'string'
    || !Number.isSafeInteger(value.counter)
    || Number(value.counter) < 0) return null;
  return { actor: value.actor, counter: Number(value.counter) };
};

const normalizeSparkSyncMetadata = (value: unknown): SparkSyncMetadata => {
  const metadata = createEmptySparkSyncMetadata();
  if (!isRecord(value)) return metadata;

  if (isRecord(value.connections)) {
    (Object.keys(INITIAL_SPARK_CONNECTIONS) as SparkConnectedAppId[]).forEach((id) => {
      const stamp = normalizeSparkSyncStamp(value.connections?.[id]);
      if (stamp) metadata.connections[id] = stamp;
    });
  }

  if (isRecord(value.records)) {
    (Object.keys(metadata.records) as SparkSyncCollection[]).forEach((collection) => {
      const rawEntries = value.records?.[collection];
      if (!isRecord(rawEntries)) return;
      Object.entries(rawEntries).forEach(([id, rawEntry]) => {
        if (!id || !isRecord(rawEntry)) return;
        const stamp = normalizeSparkSyncStamp(rawEntry.stamp);
        if (!stamp) return;
        metadata.records[collection][id] = {
          deleted: rawEntry.deleted === true,
          stamp,
        };
      });
    });
  }

  absorbSparkSyncClock(metadata);
  return metadata;
};

const selectSparkSyncEntry = (
  local: SparkSyncEntry | undefined,
  incoming: SparkSyncEntry | undefined,
): 'incoming' | 'local' | undefined => {
  if (!local) return incoming ? 'incoming' : undefined;
  if (!incoming) return 'local';
  const comparison = compareSparkSyncStamps(local.stamp, incoming.stamp);
  if (comparison !== 0) return comparison > 0 ? 'local' : 'incoming';
  if (local.deleted !== incoming.deleted) return local.deleted ? 'local' : 'incoming';
  return 'incoming';
};

const mergeSparkRecords = <T extends { id: string; updatedAt: string }>(
  local: readonly T[],
  incoming: readonly T[],
  localEntries: Readonly<Record<string, SparkSyncEntry>>,
  incomingEntries: Readonly<Record<string, SparkSyncEntry>>,
): { entries: Record<string, SparkSyncEntry>; records: T[] } => {
  const localRecords = new Map(local.map((item) => [item.id, item]));
  const incomingRecords = new Map(incoming.map((item) => [item.id, item]));
  const orderedIds = [...new Set([
    ...local.map((item) => item.id),
    ...incoming.map((item) => item.id),
    ...Object.keys(localEntries),
    ...Object.keys(incomingEntries),
  ])];
  const records: T[] = [];
  const entries: Record<string, SparkSyncEntry> = {};

  orderedIds.forEach((id) => {
    const localRecord = localRecords.get(id);
    const incomingRecord = incomingRecords.get(id);
    const localEntry = localEntries[id]
      ?? (localRecord ? { deleted: false, stamp: { actor: '', counter: 0 } } : undefined);
    const incomingEntry = incomingEntries[id]
      ?? (incomingRecord ? { deleted: false, stamp: { actor: '', counter: 0 } } : undefined);
    let winner = selectSparkSyncEntry(localEntry, incomingEntry);

    if (winner && localEntry && incomingEntry
      && compareSparkSyncStamps(localEntry.stamp, incomingEntry.stamp) === 0
      && !localEntry.deleted && !incomingEntry.deleted) {
      const localTime = localRecord ? Date.parse(localRecord.updatedAt) : Number.NEGATIVE_INFINITY;
      const incomingTime = incomingRecord ? Date.parse(incomingRecord.updatedAt) : Number.NEGATIVE_INFINITY;
      winner = incomingTime >= localTime ? 'incoming' : 'local';
    }

    const entry = winner === 'local' ? localEntry : winner === 'incoming' ? incomingEntry : undefined;
    const record = winner === 'local' ? localRecord : winner === 'incoming' ? incomingRecord : undefined;
    if (!entry) return;
    if (entry.deleted || !record) {
      if (entry.deleted) entries[id] = { deleted: true, stamp: { ...entry.stamp } };
      return;
    }

    records.push(record);
    if (entry.stamp.counter > 0 || entry.stamp.actor) {
      entries[id] = { deleted: false, stamp: { ...entry.stamp } };
    }
  });

  return { entries, records };
};

const mergeSparkConnections = (
  local: Record<SparkConnectedAppId, boolean>,
  incoming: Record<SparkConnectedAppId, boolean>,
  localStamps: Partial<Record<SparkConnectedAppId, SparkSyncStamp>>,
  incomingStamps: Partial<Record<SparkConnectedAppId, SparkSyncStamp>>,
): {
  connections: Record<SparkConnectedAppId, boolean>;
  stamps: Partial<Record<SparkConnectedAppId, SparkSyncStamp>>;
} => {
  const connections = { ...local };
  const stamps: Partial<Record<SparkConnectedAppId, SparkSyncStamp>> = {};
  (Object.keys(INITIAL_SPARK_CONNECTIONS) as SparkConnectedAppId[]).forEach((id) => {
    const localStamp = localStamps[id];
    const incomingStamp = incomingStamps[id];
    const winner = localStamp && incomingStamp
      ? (compareSparkSyncStamps(localStamp, incomingStamp) > 0 ? 'local' : 'incoming')
      : localStamp ? 'local' : 'incoming';
    connections[id] = winner === 'local' ? local[id] : incoming[id];
    const stamp = winner === 'local' ? localStamp : incomingStamp;
    if (stamp) stamps[id] = { ...stamp };
  });
  return { connections, stamps };
};

const mergeSparkSnapshots = (
  local: SparkSnapshot,
  incoming: SparkSnapshot,
  location: SparkLocation,
): SparkSnapshot => {
  const tasks = mergeSparkRecords(
    local.state.tasks,
    incoming.state.tasks,
    local.sync.records.tasks,
    incoming.sync.records.tasks,
  );
  const schedules = mergeSparkRecords(
    local.state.schedules,
    incoming.state.schedules,
    local.sync.records.schedules,
    incoming.sync.records.schedules,
  );
  const skills = mergeSparkRecords(
    local.state.skills,
    incoming.state.skills,
    local.sync.records.skills,
    incoming.sync.records.skills,
  );
  const customApps = mergeSparkRecords(
    local.state.customApps,
    incoming.state.customApps,
    local.sync.records.customApps,
    incoming.sync.records.customApps,
  );
  const connections = mergeSparkConnections(
    local.state.connections,
    incoming.state.connections,
    local.sync.connections,
    incoming.sync.connections,
  );
  const sync: SparkSyncMetadata = {
    version: 1,
    connections: connections.stamps,
    records: {
      customApps: customApps.entries,
      schedules: schedules.entries,
      skills: skills.entries,
      tasks: tasks.entries,
    },
  };
  absorbSparkSyncClock(sync);
  return {
    state: {
      location,
      tasks: tasks.records,
      schedules: schedules.records,
      skills: skills.records,
      connections: connections.connections,
      customApps: customApps.records,
    },
    sync,
  };
};

const deriveLocalSparkSyncMetadata = (
  previous: SparkState,
  next: SparkState,
  base: SparkSyncMetadata,
): SparkSyncMetadata => {
  const metadata = cloneSparkSyncMetadata(base);
  const collections: Array<{
    key: SparkSyncCollection;
    previous: readonly { id: string }[];
    next: readonly { id: string }[];
  }> = [
    { key: 'tasks', previous: previous.tasks, next: next.tasks },
    { key: 'schedules', previous: previous.schedules, next: next.schedules },
    { key: 'skills', previous: previous.skills, next: next.skills },
    { key: 'customApps', previous: previous.customApps, next: next.customApps },
  ];

  collections.forEach(({ key, previous: previousRecords, next: nextRecords }) => {
    const previousById = new Map(previousRecords.map((record) => [record.id, record]));
    const nextById = new Map(nextRecords.map((record) => [record.id, record]));
    previousById.forEach((_record, id) => {
      if (!nextById.has(id)) {
        metadata.records[key][id] = { deleted: true, stamp: nextSparkSyncStamp() };
      }
    });
    nextById.forEach((record, id) => {
      const previousRecord = previousById.get(id);
      if (previousRecord === record) return;
      if (previousRecord && metadata.records[key][id]?.deleted) return;
      metadata.records[key][id] = { deleted: false, stamp: nextSparkSyncStamp() };
    });
  });

  (Object.keys(INITIAL_SPARK_CONNECTIONS) as SparkConnectedAppId[]).forEach((id) => {
    if (previous.connections[id] !== next.connections[id]) {
      metadata.connections[id] = nextSparkSyncStamp();
    }
  });
  return metadata;
};

const applyLegacySparkDeletions = (
  metadata: SparkSyncMetadata,
  deletions: Partial<SparkSyncDeletions> | undefined,
): SparkSyncMetadata => {
  if (!deletions) return metadata;
  const next = cloneSparkSyncMetadata(metadata);
  (Object.keys(next.records) as SparkSyncCollection[]).forEach((collection) => {
    const ids = deletions[collection];
    if (!Array.isArray(ids)) return;
    ids.forEach((id) => {
      if (typeof id === 'string' && id && !next.records[collection][id]) {
        next.records[collection][id] = { deleted: true, stamp: nextSparkSyncStamp() };
      }
    });
  });
  return next;
};

const getSparkSyncChannel = (): BroadcastChannel | null => {
  if (sparkSyncChannel || typeof BroadcastChannel === 'undefined') return sparkSyncChannel;
  try {
    sparkSyncChannel = new BroadcastChannel(SPARK_SYNC_CHANNEL);
    sparkSyncChannel.onmessage = (event: MessageEvent) => {
      const message = event.data as {
        deletions?: Partial<SparkSyncDeletions>;
        scopeId?: unknown;
        state?: unknown;
        sync?: unknown;
      } | undefined;
      if (message?.scopeId !== activeSparkStorageScope || !isRecord(message.state)) return;
      const incoming = message.state as unknown as SparkState;
      if (!Array.isArray(incoming.tasks)
        || !Array.isArray(incoming.schedules)
        || !Array.isArray(incoming.skills)
        || !Array.isArray(incoming.customApps)) return;
      const current = sparkState.get();
      let incomingSync = normalizeSparkSyncMetadata(message.sync);
      incomingSync = applyLegacySparkDeletions(incomingSync, message.deletions);
      let merged = mergeSparkSnapshots(
        { state: current, sync: activeSparkSyncMetadata },
        { state: incoming, sync: incomingSync },
        current.location,
      );
      const durable = readPersistedSparkSnapshot();
      if (durable) merged = mergeSparkSnapshots(merged, durable, current.location);
      activeSparkSyncMetadata = merged.sync;
      sparkState.set(merged.state);
      const viewedMergedState = markSparkTaskViewed(merged.state, current.location);
      if (viewedMergedState === merged.state) {
        persistSparkState(merged.state, merged.sync);
      } else {
        publishSparkState(viewedMergedState);
      }
    };
  } catch {
    sparkSyncChannel = null;
  }
  return sparkSyncChannel;
};

const persistSparkState = (
  state: SparkState,
  sync: SparkSyncMetadata = activeSparkSyncMetadata,
): void => {
  try {
    const payload: PersistedSparkState = {
      ...createPersistableSparkState(state),
      sync: cloneSparkSyncMetadata(sync),
    };
    globalThis.localStorage?.setItem(
      getSparkStorageKey(activeSparkStorageScope),
      JSON.stringify(payload),
    );
  } catch {
    // Spark remains usable when browser storage is unavailable.
  }
};

const publishSparkState = (state: SparkState): void => {
  const previous = sparkState.get();
  const removedIds = <T extends { id: string }>(before: readonly T[], after: readonly T[]) => {
    const remaining = new Set(after.map((item) => item.id));
    return before.filter((item) => !remaining.has(item.id)).map((item) => item.id);
  };
  const durable = readPersistedSparkSnapshot();
  const baseSync = durable
    ? mergeSparkSnapshots(
        { state: previous, sync: activeSparkSyncMetadata },
        durable,
        previous.location,
      ).sync
    : activeSparkSyncMetadata;
  absorbSparkSyncClock(baseSync);
  const proposed: SparkSnapshot = {
    state,
    sync: deriveLocalSparkSyncMetadata(previous, state, baseSync),
  };
  const merged = durable
    ? mergeSparkSnapshots(proposed, durable, state.location)
    : proposed;
  const deletions: SparkSyncDeletions = {
    tasks: removedIds(previous.tasks, merged.state.tasks),
    schedules: removedIds(previous.schedules, merged.state.schedules),
    skills: removedIds(previous.skills, merged.state.skills),
    customApps: removedIds(previous.customApps, merged.state.customApps),
  };
  activeSparkSyncMetadata = merged.sync;
  sparkState.set(merged.state);
  persistSparkState(merged.state, merged.sync);
  try {
    getSparkSyncChannel()?.postMessage({
      scopeId: activeSparkStorageScope,
      state: createPersistableSparkState(merged.state),
      deletions,
      sync: cloneSparkSyncMetadata(merged.sync),
    });
  } catch {
    // Cross-tab synchronization is optional.
  }
};

const isSparkLocation = (value: unknown): value is SparkLocation => {
  if (!value || typeof value !== 'object' || !('page' in value)) return false;
  const candidate = value as Record<string, unknown>;
  switch (candidate.page) {
    case 'home':
    case 'all-tasks':
    case 'schedules':
    case 'skills':
    case 'apps':
      return true;
    case 'task':
      return typeof candidate.taskId === 'string' && Boolean(candidate.taskId);
    case 'schedule-editor':
      return candidate.scheduleId === undefined || typeof candidate.scheduleId === 'string';
    case 'skill-editor':
      return ['manual', 'gemini', 'upload', 'recommended'].includes(String(candidate.mode))
        && (candidate.skillId === undefined || typeof candidate.skillId === 'string')
        && (candidate.template === undefined || typeof candidate.template === 'string');
    default:
      return false;
  }
};

const markSparkTaskViewed = (state: SparkState, location: SparkLocation): SparkState => {
  if (location.page !== 'task') return state;
  let changed = false;
  const tasks = state.tasks.map((task) => {
    if (task.id !== location.taskId || !task.hasUnreadCompletion) return task;
    changed = true;
    return { ...task, hasUnreadCompletion: false };
  });
  return changed ? { ...state, tasks } : state;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asReaction = (value: unknown): SparkReaction | undefined => {
  if (value === 'like' || value === 'dislike') return value;
  if (value === null) return null;
  return undefined;
};

const normalizeThinkingSteps = (value: unknown): string[] => (
  Array.isArray(value)
    ? value
      .filter((step): step is string => typeof step === 'string')
      .map((step) => step.replace(/\s+/g, ' ').trim().slice(0, 600))
      .filter(Boolean)
      .slice(0, 12)
    : []
);

const normalizeActivityLog = (value: unknown): SparkActivityEntry[] => (
  Array.isArray(value)
    ? value.filter((entry): entry is SparkActivityEntry => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.kind !== 'string') return false;
      if (entry.kind === 'narration') return typeof entry.text === 'string' && Boolean(entry.text.trim());
      return entry.kind === 'tool' && typeof entry.tool === 'string' && Boolean(entry.tool.trim());
    }).slice(-40)
    : []
);

const normalizeAttachment = (value: unknown): SparkTaskAttachment | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  return {
    id: value.id,
    name: value.name,
    mimeType: asString(value.mimeType, 'application/octet-stream'),
    size: typeof value.size === 'number' && Number.isFinite(value.size) ? value.size : 0,
    type: value.type === 'image' || value.type === 'text' || value.type === 'file'
      ? value.type
      : undefined,
  };
};

const normalizeTurn = (value: unknown): SparkTaskTurn | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.prompt !== 'string') return null;
  return {
    id: value.id,
    prompt: value.prompt,
    response: asString(value.response),
    modelLabel: asString(value.modelLabel) || undefined,
    thinkingSteps: normalizeThinkingSteps(value.thinkingSteps),
    activityTitle: asString(value.activityTitle).replace(/\s+/g, ' ').trim().slice(0, 160) || undefined,
    activityLog: normalizeActivityLog(value.activityLog),
    usedTools: Array.isArray(value.usedTools)
      ? value.usedTools.filter((tool): tool is string => typeof tool === 'string')
      : undefined,
    attachments: Array.isArray(value.attachments)
      ? value.attachments.map(normalizeAttachment).filter((item): item is SparkTaskAttachment => Boolean(item))
      : [],
    reaction: asReaction(value.reaction),
    createdAt: asString(value.createdAt, new Date().toISOString()),
  };
};

const TASK_STATUSES = new Set<SparkTaskStatus>([
  'queued',
  'running',
  'needs-input',
  'complete',
  'failed',
  'cancelled',
]);

const normalizeTask = (value: unknown): SparkTask | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.prompt !== 'string') return null;
  const now = new Date().toISOString();
  const wasInterrupted = value.status === 'running' || value.status === 'queued';
  const turns = Array.isArray(value.turns)
    ? value.turns.map(normalizeTurn).filter((item): item is SparkTaskTurn => Boolean(item))
    : [];
  const recoveredTurns = wasInterrupted
    ? turns.map((turn, index) => index === turns.length - 1 && !turn.response
      ? { ...turn, response: 'This follow-up was interrupted when Willow closed. Retry it to continue.' }
      : turn)
    : turns;
  const approvalValue = isRecord(value.approval) && value.approval.kind === 'browser'
    ? {
        kind: 'browser' as const,
        title: asString(value.approval.title, 'Let Gemini interact with websites for you?'),
        description: asString(value.approval.description, 'To work on your tasks, Gemini will need to use a browser:'),
        prompt: asString(value.approval.prompt, value.prompt),
      }
    : undefined;

  return {
    id: value.id,
    title: asString(value.title, getSparkTaskTitle(value.prompt)),
    description: wasInterrupted ? 'Run interrupted' : asString(value.description, 'Task'),
    time: asString(value.time, 'Just now'),
    status: wasInterrupted
      ? 'failed'
      : TASK_STATUSES.has(value.status as SparkTaskStatus)
        ? value.status as SparkTaskStatus
        : 'failed',
    prompt: value.prompt,
    response: wasInterrupted && !value.response && recoveredTurns.length === 0
      ? 'This task was interrupted when Willow closed. Retry it to continue.'
      : asString(value.response),
    modelLabel: asString(value.modelLabel) || undefined,
    thinkingSteps: normalizeThinkingSteps(value.thinkingSteps),
    activityTitle: asString(value.activityTitle).replace(/\s+/g, ' ').trim().slice(0, 160) || undefined,
    activityLog: normalizeActivityLog(value.activityLog),
    turns: recoveredTurns,
    attachments: Array.isArray(value.attachments)
      ? value.attachments.map(normalizeAttachment).filter((item): item is SparkTaskAttachment => Boolean(item))
      : [],
    tools: Array.isArray(value.tools) ? value.tools.filter((tool): tool is string => typeof tool === 'string') : [],
    usedTools: Array.isArray(value.usedTools)
      ? value.usedTools.filter((tool): tool is string => typeof tool === 'string')
      : undefined,
    reaction: asReaction(value.reaction),
    approval: approvalValue,
    approvalDecision: value.approvalDecision === 'allowed' || value.approvalDecision === 'denied'
      ? value.approvalDecision
      : undefined,
    progressLabel: wasInterrupted ? 'Interrupted' : asString(value.progressLabel) || undefined,
    scheduledLabel: asString(value.scheduledLabel) || undefined,
    scheduledTime: asString(value.scheduledTime) || undefined,
    hasUnreadCompletion: Boolean(value.hasUnreadCompletion),
    isPinned: Boolean(value.isPinned),
    createdAt: asString(value.createdAt, now),
    updatedAt: wasInterrupted ? now : asString(value.updatedAt, now),
  };
};

const normalizeSchedule = (value: unknown): SparkSchedule | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') return null;
  const now = new Date().toISOString();
  return {
    id: value.id,
    title: value.title,
    frequency: value.frequency === 'Daily' ? 'Daily' : 'Weekly',
    weekdays: Array.isArray(value.weekdays)
      ? value.weekdays.filter((weekday): weekday is string => typeof weekday === 'string')
      : [],
    time: asString(value.time, '09:00'),
    instructions: asString(value.instructions),
    enabled: value.enabled !== false,
    taskId: asString(value.taskId) || undefined,
    lastRunLabel: asString(value.lastRunLabel) || undefined,
    lastRunAt: asString(value.lastRunAt) || undefined,
    nextRunAt: asString(value.nextRunAt) || undefined,
    createdAt: asString(value.createdAt, now),
    updatedAt: asString(value.updatedAt, now),
  };
};

const normalizeSkill = (value: unknown): SparkSkill | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  const now = new Date().toISOString();
  const source = value.source === 'gemini' || value.source === 'upload' || value.source === 'recommended'
    ? value.source
    : 'manual';
  return {
    id: value.id,
    name: value.name,
    description: asString(value.description),
    instructions: asString(value.instructions),
    source,
    fileName: asString(value.fileName) || undefined,
    createdAt: asString(value.createdAt, now),
    updatedAt: asString(value.updatedAt, now),
  };
};

const normalizeCustomApp = (value: unknown): SparkCustomApp | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.url !== 'string') return null;
  const now = new Date().toISOString();
  return {
    id: value.id,
    name: asString(value.name, value.url),
    url: value.url,
    connected: value.connected !== false,
    createdAt: asString(value.createdAt, now),
    updatedAt: asString(value.updatedAt, now),
  };
};

function readPersistedSparkSnapshot(): SparkSnapshot | null {
  try {
    const raw = globalThis.localStorage?.getItem(getSparkStorageKey(activeSparkStorageScope));
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<PersistedSparkState>;
    if (!Array.isArray(saved.tasks)
      || !Array.isArray(saved.schedules)
      || !Array.isArray(saved.skills)
      || !Array.isArray(saved.customApps)
      || !isRecord(saved.connections)) return null;

    const fallback = createInitialState();
    const connections = Object.fromEntries(
      Object.entries(fallback.connections).map(([id, defaultValue]) => [
        id,
        typeof saved.connections?.[id as SparkConnectedAppId] === 'boolean'
          ? saved.connections[id as SparkConnectedAppId]
          : defaultValue,
      ]),
    ) as Record<SparkConnectedAppId, boolean>;
    const state: SparkState = {
      location: isSparkLocation(saved.location) ? saved.location : fallback.location,
      tasks: saved.tasks,
      schedules: saved.schedules,
      skills: saved.skills,
      connections,
      customApps: saved.customApps,
    };
    const sync = normalizeSparkSyncMetadata(saved.sync);
    const emptyState: SparkState = {
      ...state,
      tasks: [],
      schedules: [],
      skills: [],
      customApps: [],
    };
    return mergeSparkSnapshots(
      { state: emptyState, sync: createEmptySparkSyncMetadata() },
      { state, sync },
      state.location,
    );
  } catch {
    return null;
  }
}

/** Loads the signed-in user's Spark workspace while retaining defaults for new fields. */
export const hydrateSparkState = (scopeId = 'guest'): void => {
  activeSparkStorageScope = scopeId || 'guest';
  hasHydratedSparkState = true;
  getSparkSyncChannel();
  const fallback = createInitialState();

  try {
    const raw = globalThis.localStorage?.getItem(getSparkStorageKey(activeSparkStorageScope));
    if (!raw) {
      activeSparkSyncMetadata = createEmptySparkSyncMetadata();
      sparkState.set(fallback);
      persistSparkState(fallback, activeSparkSyncMetadata);
      return;
    }

    const saved = JSON.parse(raw) as Partial<PersistedSparkState>;
    const hydratedTasks = Array.isArray(saved.tasks)
      ? saved.tasks.map(normalizeTask).filter((item): item is SparkTask => Boolean(item))
      : fallback.tasks;
    const hydratedSchedules = Array.isArray(saved.schedules)
      ? saved.schedules.map(normalizeSchedule).filter((item): item is SparkSchedule => Boolean(item))
      : fallback.schedules;
    const hydratedSkills = Array.isArray(saved.skills)
      ? saved.skills.map(normalizeSkill).filter((item): item is SparkSkill => Boolean(item))
      : fallback.skills;
    const hydratedCustomApps = Array.isArray(saved.customApps)
      ? saved.customApps.map(normalizeCustomApp).filter((item): item is SparkCustomApp => Boolean(item))
      : fallback.customApps;
    const savedConnections = isRecord(saved.connections) ? saved.connections : {};
    const connections = Object.fromEntries(
      Object.entries(fallback.connections).map(([id, defaultValue]) => [
        id,
        typeof savedConnections[id] === 'boolean' ? savedConnections[id] : defaultValue,
      ]),
    ) as Record<SparkConnectedAppId, boolean>;

    const hydratedState: SparkState = {
      location: isSparkLocation(saved.location) ? saved.location : fallback.location,
      tasks: hydratedTasks,
      schedules: hydratedSchedules,
      skills: hydratedSkills,
      connections,
      customApps: hydratedCustomApps,
    };
    const hydratedSync = normalizeSparkSyncMetadata(saved.sync);
    const emptyState: SparkState = {
      ...hydratedState,
      tasks: [],
      schedules: [],
      skills: [],
      customApps: [],
    };
    const hydrated = mergeSparkSnapshots(
      { state: emptyState, sync: createEmptySparkSyncMetadata() },
      { state: hydratedState, sync: hydratedSync },
      hydratedState.location,
    );
    const hydratedLocation = hydrated.state.location;
    if (hydratedLocation.page === 'task'
      && !hydrated.state.tasks.some((task) => task.id === hydratedLocation.taskId)) {
      hydrated.state.location = { page: 'all-tasks' };
    }
    activeSparkSyncMetadata = hydrated.sync;
    sparkState.set(hydrated.state);
    const viewedHydratedState = markSparkTaskViewed(hydrated.state, hydrated.state.location);
    if (viewedHydratedState === hydrated.state) {
      persistSparkState(hydrated.state, hydrated.sync);
    } else {
      publishSparkState(viewedHydratedState);
    }
  } catch {
    activeSparkSyncMetadata = createEmptySparkSyncMetadata();
    sparkState.set(fallback);
    persistSparkState(fallback, activeSparkSyncMetadata);
  }
};

export const isSparkScheduleRunClaimCurrent = (
  scheduleId: string,
  expectedNextRunAt: string,
): boolean => {
  try {
    const raw = globalThis.localStorage?.getItem(getSparkStorageKey(activeSparkStorageScope));
    if (raw) {
      const saved = JSON.parse(raw) as Partial<SparkState>;
      const schedule = Array.isArray(saved.schedules)
        ? saved.schedules.find((candidate) => candidate?.id === scheduleId)
        : undefined;
      return Boolean(
        schedule
        && schedule.enabled
        && schedule.nextRunAt === expectedNextRunAt,
      );
    }
  } catch {
    // Fall back to the current in-memory state.
  }
  const schedule = sparkState.get().schedules.find((candidate) => candidate.id === scheduleId);
  return Boolean(schedule?.enabled && schedule.nextRunAt === expectedNextRunAt);
};

export const navigateSpark = (location: SparkLocation): void => {
  const current = sparkState.get();
  publishSparkState(markSparkTaskViewed({ ...current, location }, location));
  try {
    globalThis.history?.pushState(
      { ...(globalThis.history.state ?? {}), [SPARK_HISTORY_STATE_KEY]: location },
      '',
      globalThis.location?.href,
    );
  } catch {
    // Navigation still works in embedded contexts without History API access.
  }
};

export const replaceSparkLocation = (location: SparkLocation): void => {
  const current = sparkState.get();
  publishSparkState(markSparkTaskViewed({ ...current, location }, location));
  try {
    globalThis.history?.replaceState(
      { ...(globalThis.history.state ?? {}), [SPARK_HISTORY_STATE_KEY]: location },
      '',
      globalThis.location?.href,
    );
  } catch {
    // Navigation still works in embedded contexts without History API access.
  }
};

export const restoreSparkLocation = (location: unknown): boolean => {
  if (!isSparkLocation(location)) return false;
  const current = sparkState.get();
  publishSparkState(markSparkTaskViewed({ ...current, location }, location));
  return true;
};

export const goToSparkHome = (): void => navigateSpark({ page: 'home' });
export const goToAllSparkTasks = (): void => navigateSpark({ page: 'all-tasks' });
export const goToSparkTask = (taskId: string): void => navigateSpark({ page: 'task', taskId });
export const goToSparkSchedules = (): void => navigateSpark({ page: 'schedules' });
export const goToSparkScheduleEditor = (scheduleId?: string): void =>
  navigateSpark({ page: 'schedule-editor', scheduleId });
export const goToSparkSkills = (): void => navigateSpark({ page: 'skills' });
export const goToSparkSkillEditor = (
  mode: Extract<SparkLocation, { page: 'skill-editor' }>['mode'],
  options: { skillId?: string; template?: string } = {},
): void => navigateSpark({ page: 'skill-editor', mode, ...options });
export const goToSparkApps = (): void => navigateSpark({ page: 'apps' });

/** Creates the record and opens it in one store publication. */
export const createSparkTask = (
  prompt: string,
  options: CreateSparkTaskOptions = {},
): SparkTask | null => {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) return null;

  const now = new Date().toISOString();
  const id = options.id ?? createTaskId();
  const status = options.status ?? 'running';
  const task: SparkTask = {
    id,
    title: options.title?.trim() || getSparkTaskTitle(cleanPrompt),
    description: options.description?.trim() || 'Getting started',
    time: options.time ?? 'Just now',
    status,
    prompt: options.prompt?.trim() || cleanPrompt,
    response: options.response ?? '',
    modelLabel: options.modelLabel?.trim() || undefined,
    thinkingSteps: options.thinkingSteps ? [...options.thinkingSteps] : [],
    activityTitle: options.activityTitle?.trim() || undefined,
    activityLog: options.activityLog ? options.activityLog.map((entry) => ({ ...entry })) : [],
    activityPhase: options.activityPhase ?? (status === 'running' ? 'queued' : undefined),
    turns: options.turns?.map((turn) => ({
      ...turn,
      thinkingSteps: turn.thinkingSteps ? [...turn.thinkingSteps] : undefined,
      activityTitle: turn.activityTitle,
      activityLog: turn.activityLog ? turn.activityLog.map((entry) => ({ ...entry })) : undefined,
      usedTools: turn.usedTools ? [...turn.usedTools] : undefined,
    })) ?? [],
    attachments: options.attachments?.map((attachment) => ({ ...attachment })) ?? [],
    tools: options.tools ? [...options.tools] : [],
    usedTools: options.usedTools ? [...options.usedTools] : [],
    reaction: options.reaction,
    approval: options.approval ? { ...options.approval } : undefined,
    approvalDecision: options.approvalDecision,
    progressLabel: options.progressLabel ?? 'Working',
    scheduledLabel: options.scheduledLabel,
    scheduledTime: options.scheduledTime,
    hasUnreadCompletion: options.hasUnreadCompletion
      ?? (status === 'complete' && options.openTask === false),
    isPinned: options.isPinned ?? false,
    createdAt: now,
    updatedAt: now,
  };

  const current = sparkState.get();
  publishSparkState({
    ...current,
    location: options.openTask === false ? current.location : { page: 'task', taskId: id },
    tasks: [task, ...current.tasks.filter((candidate) => candidate.id !== id)],
  });

  if (options.openTask !== false) {
    try {
      const nextLocation: SparkLocation = { page: 'task', taskId: id };
      globalThis.history?.pushState(
        { ...(globalThis.history.state ?? {}), [SPARK_HISTORY_STATE_KEY]: nextLocation },
        '',
        globalThis.location?.href,
      );
    } catch {
      // The task still opens if History API access is unavailable.
    }
  }

  return task;
};

export const updateSparkTask = (taskId: string, update: SparkTaskUpdate): SparkTask | null => {
  const current = sparkState.get();
  const existing = current.tasks.find((task) => task.id === taskId);
  if (!existing) return null;

  const nextStatus = update.status ?? existing.status;
  let hasUnreadCompletion = update.hasUnreadCompletion ?? existing.hasUnreadCompletion ?? false;
  if (update.hasUnreadCompletion === undefined && update.status !== undefined && update.status !== existing.status) {
    hasUnreadCompletion = nextStatus === 'complete'
      && !(current.location.page === 'task' && current.location.taskId === taskId);
  }
  const updated: SparkTask = {
    ...existing,
    ...update,
    hasUnreadCompletion,
    title: update.title?.trim() || existing.title,
    prompt: update.prompt?.trim() || existing.prompt,
    thinkingSteps: update.thinkingSteps
      ? [...update.thinkingSteps]
      : existing.thinkingSteps,
    activityTitle: Object.prototype.hasOwnProperty.call(update, 'activityTitle')
      ? update.activityTitle?.trim() || undefined
      : existing.activityTitle,
    activityLog: update.activityLog
      ? update.activityLog.map((entry) => ({ ...entry }))
      : existing.activityLog,
    usedTools: update.usedTools
      ? [...update.usedTools]
      : existing.usedTools,
    time: update.time ?? 'Just now',
    updatedAt: new Date().toISOString(),
  };

  publishSparkState({
    ...current,
    tasks: current.tasks.map((task) => (task.id === taskId ? updated : task)),
  });
  return updated;
};

/**
 * Paints streamed response text in the current tab without creating a durable
 * sync revision. The surrounding running/final task updates remain persisted,
 * so a closed or interrupted tab still recovers through the normal status path.
 */
export const updateSparkTaskResponseTransient = (
  taskId: string,
  response: string,
): SparkTask | null => {
  const current = sparkState.get();
  const existing = current.tasks.find((task) => task.id === taskId);
  if (!existing) return null;
  if (existing.response === response) return existing;

  const updated: SparkTask = { ...existing, response };
  sparkState.set({
    ...current,
    tasks: current.tasks.map((task) => (task.id === taskId ? updated : task)),
  });
  return updated;
};

/** Paints streamed, displayable thought summaries without creating a sync revision. */
export const updateSparkTaskThinkingTransient = (
  taskId: string,
  thinkingSteps: readonly string[],
): SparkTask | null => {
  const current = sparkState.get();
  const existing = current.tasks.find((task) => task.id === taskId);
  if (!existing) return null;
  const nextSteps = [...thinkingSteps];
  if (JSON.stringify(existing.thinkingSteps ?? []) === JSON.stringify(nextSteps)) return existing;

  const updated: SparkTask = { ...existing, thinkingSteps: nextSteps };
  sparkState.set({
    ...current,
    tasks: current.tasks.map((task) => (task.id === taskId ? updated : task)),
  });
  return updated;
};

export const updateSparkTaskActivityTransient = (
  taskId: string,
  activityLog: readonly SparkActivityEntry[],
): SparkTask | null => {
  const current = sparkState.get();
  const existing = current.tasks.find((task) => task.id === taskId);
  if (!existing) return null;
  const nextLog = activityLog.map((entry) => ({ ...entry }));
  if (JSON.stringify(existing.activityLog ?? []) === JSON.stringify(nextLog)) return existing;

  const updated: SparkTask = { ...existing, activityLog: nextLog };
  sparkState.set({
    ...current,
    tasks: current.tasks.map((task) => (task.id === taskId ? updated : task)),
  });
  return updated;
};

export const appendSparkTaskTurn = (
  taskId: string,
  input: AppendSparkTaskTurnInput,
): SparkTaskTurn | null => {
  const prompt = input.prompt.trim();
  if (!prompt) return null;

  const current = sparkState.get();
  const existing = current.tasks.find((task) => task.id === taskId);
  if (!existing) return null;

  const now = input.createdAt ?? new Date().toISOString();
  const turn: SparkTaskTurn = {
    id: input.id ?? createTaskTurnId(),
    prompt,
    response: input.response.trim(),
    modelLabel: input.modelLabel?.trim() || undefined,
    thinkingSteps: input.thinkingSteps ? [...input.thinkingSteps] : [],
    activityTitle: input.activityTitle?.trim() || undefined,
    activityLog: input.activityLog ? input.activityLog.map((entry) => ({ ...entry })) : [],
    activityPhase: input.activityPhase,
    usedTools: input.usedTools ? [...input.usedTools] : [],
    attachments: input.attachments?.map((attachment) => ({ ...attachment })),
    reaction: undefined,
    createdAt: now,
  };
  const updated: SparkTask = {
    ...existing,
    turns: [...(existing.turns ?? []), turn],
    time: 'Just now',
    updatedAt: now,
  };

  publishSparkState({
    ...current,
    tasks: current.tasks.map((task) => (task.id === taskId ? updated : task)),
  });
  return turn;
};

export const updateSparkTaskTurn = (
  taskId: string,
  turnId: string,
  update: SparkTaskTurnUpdate,
): SparkTaskTurn | null => {
  const current = sparkState.get();
  const existingTask = current.tasks.find((task) => task.id === taskId);
  const existingTurn = existingTask?.turns.find((turn) => turn.id === turnId);
  if (!existingTask || !existingTurn) return null;

  const updatedTurn: SparkTaskTurn = {
    ...existingTurn,
    ...update,
    prompt: update.prompt === undefined ? existingTurn.prompt : update.prompt.trim(),
    response: update.response === undefined ? existingTurn.response : update.response.trim(),
    thinkingSteps: update.thinkingSteps
      ? [...update.thinkingSteps]
      : existingTurn.thinkingSteps,
    activityTitle: Object.prototype.hasOwnProperty.call(update, 'activityTitle')
      ? update.activityTitle?.trim() || undefined
      : existingTurn.activityTitle,
    activityLog: update.activityLog
      ? update.activityLog.map((entry) => ({ ...entry }))
      : existingTurn.activityLog,
    activityPhase: update.activityPhase === undefined ? existingTurn.activityPhase : update.activityPhase,
    usedTools: update.usedTools
      ? [...update.usedTools]
      : existingTurn.usedTools,
    attachments: update.attachments
      ? update.attachments.map((attachment) => ({ ...attachment }))
      : existingTurn.attachments,
  };
  const now = new Date().toISOString();
  const updatedTask: SparkTask = {
    ...existingTask,
    turns: existingTask.turns.map((turn) => turn.id === turnId ? updatedTurn : turn),
    time: 'Just now',
    updatedAt: now,
  };
  publishSparkState({
    ...current,
    tasks: current.tasks.map((task) => task.id === taskId ? updatedTask : task),
  });
  return updatedTurn;
};

/** Atom-only counterpart to updateSparkTaskTurn for streamed response text. */
export const updateSparkTaskTurnResponseTransient = (
  taskId: string,
  turnId: string,
  response: string,
): SparkTaskTurn | null => {
  const current = sparkState.get();
  const existingTask = current.tasks.find((task) => task.id === taskId);
  const existingTurn = existingTask?.turns.find((turn) => turn.id === turnId);
  if (!existingTask || !existingTurn) return null;
  if (existingTurn.response === response) return existingTurn;

  const updatedTurn: SparkTaskTurn = { ...existingTurn, response };
  const updatedTask: SparkTask = {
    ...existingTask,
    turns: existingTask.turns.map((turn) => turn.id === turnId ? updatedTurn : turn),
  };
  sparkState.set({
    ...current,
    tasks: current.tasks.map((task) => task.id === taskId ? updatedTask : task),
  });
  return updatedTurn;
};

/** Atom-only counterpart for streamed, displayable thought summaries. */
export const updateSparkTaskTurnThinkingTransient = (
  taskId: string,
  turnId: string,
  thinkingSteps: readonly string[],
): SparkTaskTurn | null => {
  const current = sparkState.get();
  const existingTask = current.tasks.find((task) => task.id === taskId);
  const existingTurn = existingTask?.turns.find((turn) => turn.id === turnId);
  if (!existingTask || !existingTurn) return null;
  const nextSteps = [...thinkingSteps];
  if (JSON.stringify(existingTurn.thinkingSteps ?? []) === JSON.stringify(nextSteps)) return existingTurn;

  const updatedTurn: SparkTaskTurn = { ...existingTurn, thinkingSteps: nextSteps };
  const updatedTask: SparkTask = {
    ...existingTask,
    turns: existingTask.turns.map((turn) => turn.id === turnId ? updatedTurn : turn),
  };
  sparkState.set({
    ...current,
    tasks: current.tasks.map((task) => task.id === taskId ? updatedTask : task),
  });
  return updatedTurn;
};

export const updateSparkTaskTurnActivityTransient = (
  taskId: string,
  turnId: string,
  activityLog: readonly SparkActivityEntry[],
): SparkTaskTurn | null => {
  const current = sparkState.get();
  const existingTask = current.tasks.find((task) => task.id === taskId);
  const existingTurn = existingTask?.turns.find((turn) => turn.id === turnId);
  if (!existingTask || !existingTurn) return null;
  const nextLog = activityLog.map((entry) => ({ ...entry }));
  if (JSON.stringify(existingTurn.activityLog ?? []) === JSON.stringify(nextLog)) return existingTurn;

  const updatedTurn: SparkTaskTurn = { ...existingTurn, activityLog: nextLog };
  const updatedTask: SparkTask = {
    ...existingTask,
    turns: existingTask.turns.map((turn) => turn.id === turnId ? updatedTurn : turn),
  };
  sparkState.set({
    ...current,
    tasks: current.tasks.map((task) => task.id === taskId ? updatedTask : task),
  });
  return updatedTurn;
};

export const renameSparkTask = (taskId: string, title: string): SparkTask | null => {
  const cleanTitle = cleanSingleLine(title);
  if (!cleanTitle) return null;
  return updateSparkTask(taskId, { title: cleanTitle });
};

export const setSparkTaskReaction = (taskId: string, reaction: SparkReaction): SparkTask | null => {
  const current = sparkState.get();
  const existing = current.tasks.find((task) => task.id === taskId);
  if (!existing) return null;
  const updated = { ...existing, reaction };
  publishSparkState({
    ...current,
    tasks: current.tasks.map((task) => task.id === taskId ? updated : task),
  });
  return updated;
};

export const setSparkTaskTurnReaction = (
  taskId: string,
  turnId: string,
  reaction: SparkReaction,
): SparkTaskTurn | null => {
  const current = sparkState.get();
  const existingTask = current.tasks.find((task) => task.id === taskId);
  const existingTurn = existingTask?.turns.find((turn) => turn.id === turnId);
  if (!existingTask || !existingTurn) return null;
  const updatedTurn = { ...existingTurn, reaction };
  publishSparkState({
    ...current,
    tasks: current.tasks.map((task) => task.id === taskId
      ? {
          ...task,
          turns: task.turns.map((turn) => turn.id === turnId ? updatedTurn : turn),
        }
      : task),
  });
  return updatedTurn;
};

export const deleteSparkTask = (taskId: string): boolean => {
  const current = sparkState.get();
  if (!current.tasks.some((task) => task.id === taskId)) return false;

  const isOpenTask = current.location.page === 'task' && current.location.taskId === taskId;
  publishSparkState({
    ...current,
    location: isOpenTask ? { page: 'all-tasks' } : current.location,
    tasks: current.tasks.filter((task) => task.id !== taskId),
    schedules: current.schedules.map((schedule) => schedule.taskId === taskId
      ? { ...schedule, taskId: undefined, updatedAt: new Date().toISOString() }
      : schedule),
  });
  return true;
};

export const setSparkTaskPinned = (taskId: string, isPinned: boolean): SparkTask | null =>
  updateSparkTask(taskId, { isPinned });

export const toggleSparkTaskPinned = (taskId: string): SparkTask | null => {
  const task = sparkState.get().tasks.find((candidate) => candidate.id === taskId);
  return task ? setSparkTaskPinned(taskId, !task.isPinned) : null;
};

export const getSparkTaskById = (taskId: string): SparkTask | undefined =>
  sparkState.get().tasks.find((task) => task.id === taskId);

export const createSparkSchedule = (input: SparkScheduleInput): SparkSchedule | null => {
  const title = cleanSingleLine(input.title);
  const instructions = input.instructions.trim();
  if (!title || !instructions) return null;

  const current = sparkState.get();
  const now = new Date().toISOString();
  const schedule: SparkSchedule = {
    ...input,
    id: createRecordId('spark-schedule'),
    title,
    instructions,
    weekdays: [...input.weekdays],
    createdAt: now,
    updatedAt: now,
  };
  const scheduledTime = schedule.nextRunAt
    ? new Date(schedule.nextRunAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : `${schedule.frequency} around ${schedule.time}`;
  publishSparkState({
    ...current,
    schedules: [schedule, ...current.schedules],
    tasks: schedule.taskId
      ? current.tasks.map((task) => task.id === schedule.taskId
        ? {
            ...task,
            scheduledLabel: schedule.title,
            scheduledTime: task.scheduledTime ?? scheduledTime,
          }
        : task)
      : current.tasks,
  });
  return schedule;
};

export const updateSparkSchedule = (
  scheduleId: string,
  update: Partial<SparkScheduleInput>,
): SparkSchedule | null => {
  const current = sparkState.get();
  const existing = current.schedules.find((schedule) => schedule.id === scheduleId);
  if (!existing) return null;

  const updated: SparkSchedule = {
    ...existing,
    ...update,
    title: update.title === undefined ? existing.title : cleanSingleLine(update.title),
    instructions: update.instructions === undefined ? existing.instructions : update.instructions.trim(),
    weekdays: update.weekdays ? [...update.weekdays] : [...existing.weekdays],
    updatedAt: new Date().toISOString(),
  };
  if (!updated.title || !updated.instructions) return null;

  publishSparkState({
    ...current,
    schedules: current.schedules.map((schedule) => schedule.id === scheduleId ? updated : schedule),
    tasks: current.tasks.map((task) => {
      if (task.id !== updated.taskId) return task;
      return {
        ...task,
        scheduledLabel: updated.title,
        scheduledTime: task.scheduledTime ?? (updated.nextRunAt
          ? new Date(updated.nextRunAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
          : `${updated.frequency} around ${updated.time}`),
      };
    }),
  });
  return updated;
};

export const deleteSparkSchedule = (scheduleId: string): boolean => {
  const current = sparkState.get();
  const schedule = current.schedules.find((candidate) => candidate.id === scheduleId);
  if (!schedule) return false;
  publishSparkState({
    ...current,
    schedules: current.schedules.filter((schedule) => schedule.id !== scheduleId),
  });
  return true;
};

export const setSparkScheduleEnabled = (scheduleId: string, enabled: boolean): SparkSchedule | null =>
  updateSparkSchedule(scheduleId, { enabled });

export const createSparkSkill = (input: SparkSkillInput): SparkSkill | null => {
  const name = cleanSingleLine(input.name);
  const instructions = input.instructions.trim();
  if (!name || !instructions) return null;

  const current = sparkState.get();
  const now = new Date().toISOString();
  const skill: SparkSkill = {
    ...input,
    id: createRecordId('spark-skill'),
    name,
    description: input.description.trim(),
    instructions,
    createdAt: now,
    updatedAt: now,
  };
  publishSparkState({
    ...current,
    skills: [skill, ...current.skills],
  });
  return skill;
};

export const updateSparkSkill = (skillId: string, update: Partial<SparkSkillInput>): SparkSkill | null => {
  const current = sparkState.get();
  const existing = current.skills.find((skill) => skill.id === skillId);
  if (!existing) return null;

  const updated: SparkSkill = {
    ...existing,
    ...update,
    name: update.name === undefined ? existing.name : cleanSingleLine(update.name),
    description: update.description === undefined ? existing.description : update.description.trim(),
    instructions: update.instructions === undefined ? existing.instructions : update.instructions.trim(),
    updatedAt: new Date().toISOString(),
  };
  if (!updated.name || !updated.instructions) return null;

  publishSparkState({
    ...current,
    skills: current.skills.map((skill) => skill.id === skillId ? updated : skill),
  });
  return updated;
};

export const deleteSparkSkill = (skillId: string): boolean => {
  const current = sparkState.get();
  if (!current.skills.some((skill) => skill.id === skillId)) return false;
  publishSparkState({
    ...current,
    skills: current.skills.filter((skill) => skill.id !== skillId),
  });
  return true;
};

export const setSparkAppConnection = (appId: SparkConnectedAppId, connected: boolean): void => {
  const current = sparkState.get();
  publishSparkState({
    ...current,
    connections: { ...current.connections, [appId]: connected },
  });
};

export const createSparkCustomApp = (input: SparkCustomAppInput): SparkCustomApp | null => {
  const url = input.url.trim();
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const now = new Date().toISOString();
    const app: SparkCustomApp = {
      id: createRecordId('spark-app'),
      name: cleanSingleLine(input.name) || parsed.hostname,
      url: parsed.toString(),
      connected: false,
      createdAt: now,
      updatedAt: now,
    };
    const current = sparkState.get();
    publishSparkState({ ...current, customApps: [app, ...current.customApps] });
    return app;
  } catch {
    return null;
  }
};

export const setSparkCustomAppConnected = (appId: string, connected: boolean): SparkCustomApp | null => {
  const current = sparkState.get();
  const existing = current.customApps.find((app) => app.id === appId);
  if (!existing) return null;
  const updated = { ...existing, connected, updatedAt: new Date().toISOString() };
  publishSparkState({
    ...current,
    customApps: current.customApps.map((app) => app.id === appId ? updated : app),
  });
  return updated;
};

export const deleteSparkCustomApp = (appId: string): boolean => {
  const current = sparkState.get();
  if (!current.customApps.some((app) => app.id === appId)) return false;
  publishSparkState({
    ...current,
    customApps: current.customApps.filter((app) => app.id !== appId),
  });
  return true;
};

export const resetSparkState = (): void => {
  publishSparkState(createInitialState());
};
