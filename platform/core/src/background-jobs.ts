/**
 * Work that outlives the tab it started in.
 *
 * A running job (a chat reply, a Spark run) holds a Web Lock named after it for
 * as long as it runs, and leaves a small record in localStorage saying what it
 * is. Every other open tab that can run that kind of job queues for the same
 * lock. Closing a tab releases its locks, so the first tab in the queue is
 * granted the lock, finds the record still there, and resumes the job while
 * holding the lock it was just given. A job that ends normally removes its
 * record before releasing, so a tab granted the lock afterwards finds nothing
 * and lets go at once.
 *
 * The record holds ids and choices, never content. Each kind resumes from what
 * it already saved (the chat file, the Spark task), so the record only has to
 * say which thing to pick up and how it was started.
 *
 * A record whose heartbeat has stopped for `JOB_STALE_MS` is not resumed: that is
 * every tab having closed a while ago, and reopening Willow tomorrow should not
 * quietly start spending tokens on yesterday's question.
 */

export interface BackgroundJob<P = Record<string, unknown>> {
  id: string;
  kind: string;
  scopeId: string;
  payload: P;
  /** The page instance running it now. */
  owner: string;
  startedAt: number;
  heartbeatAt: number;
  /** How many times another tab has picked it up. */
  takeovers: number;
}

export interface BackgroundJobSpec<P> {
  id: string;
  kind: string;
  scopeId: string;
  payload: P;
}

export interface BackgroundJobHandle<P> {
  readonly id: string;
  /** True when this run picked up a job that a closed tab left behind. */
  readonly resumed: boolean;
  /** Merges into the record's payload, so a takeover sees the latest ids. */
  update(patch: Partial<P>): void;
  /** Removes the record and releases the lock. Safe to call more than once. */
  finish(): void;
}

export interface BackgroundJobKind<P> {
  /** False to pass for now (another tab may take it, or this one retries shortly). */
  canTakeOver?(job: BackgroundJob<P>): boolean;
  /**
   * Resume `job` in this tab by starting it again with `startBackgroundJob` and
   * the same id, which adopts the lock this tab already holds. A kind that cannot
   * resume simply does not start it; the record is dropped after a short wait.
   */
  takeOver(job: BackgroundJob<P>): unknown;
  /** The record went stale before any tab could resume it. */
  abandon?(job: BackgroundJob<P>): void;
}

export interface BackgroundJobsEnv {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | null;
  locks: Pick<LockManager, 'request'> | null;
  now: () => number;
  /** Called with the changed key (null when storage was cleared) from other tabs. */
  subscribe: (onChange: (key: string | null) => void) => () => void;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  /** Page Lifecycle: told just before the browser freezes this page, and when it resumes it. */
  onLifecycle?: (onFreeze: () => void, onResume: () => void) => () => void;
}

export interface BackgroundJobs {
  readonly instanceId: string;
  start<P>(spec: BackgroundJobSpec<P>): BackgroundJobHandle<P>;
  register<P>(kind: string, handler: BackgroundJobKind<P>): () => void;
  list(): BackgroundJob[];
  dispose(): void;
}

export const JOB_RECORD_PREFIX = 'willow:job:';
export const JOB_LOCK_PREFIX = 'willow-job:';
export const JOB_HEARTBEAT_MS = 15_000;
/*
 * Generous on purpose: a hidden tab's timers can be throttled to once a minute,
 * so its last heartbeat may already be a minute old when it closes.
 */
export const JOB_STALE_MS = 3 * 60_000;
/* A job that keeps taking its tab down with it should not walk through every tab. */
export const JOB_MAX_TAKEOVERS = 2;
const ADOPT_WAIT_MS = 15_000;
const RETRY_PASS_MS = 5_000;

const randomId = () => globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const isJob = (value: unknown): value is BackgroundJob => {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<BackgroundJob>;
  return typeof job.id === 'string'
    && typeof job.kind === 'string'
    && typeof job.scopeId === 'string'
    && typeof job.owner === 'string'
    && typeof job.heartbeatAt === 'number'
    && typeof job.takeovers === 'number'
    && !!job.payload && typeof job.payload === 'object';
};

interface OwnedJob {
  job: BackgroundJob<any>;
  resumed: boolean;
}

export const createBackgroundJobs = (env: BackgroundJobsEnv): BackgroundJobs => {
  const instanceId = randomId();
  const kinds = new Map<string, BackgroundJobKind<any>>();
  /* Jobs this page is running, by id. */
  const owned = new Map<string, OwnedJob>();
  /* Releases for locks this page holds, by job id. */
  const held = new Map<string, () => void>();
  const acquiring = new Set<string>();
  /* Queued requests for other tabs' jobs. */
  const watches = new Map<string, AbortController>();
  /* Takeovers granted and waiting for their kind to start the job again. */
  const resuming = new Map<string, BackgroundJob<any>>();
  const timers = new Set<unknown>();
  let heartbeat: unknown = null;
  let disposed = false;
  /*
   * A frozen page runs no script, so a lock granted to it waits until the
   * browser wakes it — and every awake tab behind it in the queue waits too.
   * A page about to freeze leaves the queues, and rejoins when it resumes.
   */
  let frozen = false;

  const read = (id: string): BackgroundJob | null => {
    try {
      const raw = env.storage?.getItem(JOB_RECORD_PREFIX + id);
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      return isJob(value) && value.id === id ? value : null;
    } catch {
      return null;
    }
  };

  const write = (job: BackgroundJob<any>) => {
    try { env.storage?.setItem(JOB_RECORD_PREFIX + job.id, JSON.stringify(job)); } catch {}
  };

  const remove = (id: string) => {
    try { env.storage?.removeItem(JOB_RECORD_PREFIX + id); } catch {}
  };

  const listIds = (): string[] => {
    const storage = env.storage;
    if (!storage) return [];
    const ids: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(JOB_RECORD_PREFIX)) ids.push(key.slice(JOB_RECORD_PREFIX.length));
    }
    return ids;
  };

  const later = (callback: () => void, ms: number) => {
    const handle = env.setTimeout(() => {
      timers.delete(handle);
      if (!disposed) callback();
    }, ms);
    timers.add(handle);
  };

  const release = (id: string) => {
    const unlock = held.get(id);
    held.delete(id);
    unlock?.();
  };

  const syncHeartbeat = () => {
    if (owned.size && heartbeat === null) {
      heartbeat = env.setInterval(() => {
        const at = env.now();
        owned.forEach((entry) => {
          if (!held.has(entry.job.id)) return;
          entry.job.heartbeatAt = at;
          write(entry.job);
        });
      }, JOB_HEARTBEAT_MS);
    } else if (!owned.size && heartbeat !== null) {
      env.clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const cancelWatch = (id: string) => {
    watches.get(id)?.abort();
    watches.delete(id);
  };

  /* Takes the lock for a job this page just started; the record is written once it is held. */
  const hold = (id: string, ifAvailable = true) => {
    if (!env.locks || held.has(id) || acquiring.has(id)) return;
    acquiring.add(id);
    env.locks.request(JOB_LOCK_PREFIX + id, { ifAvailable }, (lock) => {
      acquiring.delete(id);
      const entry = owned.get(id);
      if (!entry || disposed) return undefined;
      if (!lock) {
        // A tab that just finished this id may still be letting go; wait in line.
        later(() => { if (owned.get(id) === entry) hold(id, false); }, 0);
        return undefined;
      }
      write(entry.job);
      return new Promise<void>((resolve) => { held.set(id, resolve); });
    }).catch(() => { acquiring.delete(id); });
  };

  const start = <P>(spec: BackgroundJobSpec<P>): BackgroundJobHandle<P> => {
    const pending = resuming.get(spec.id);
    const previous = owned.get(spec.id);
    const now = env.now();
    const entry: OwnedJob = {
      resumed: Boolean(pending),
      job: {
        id: spec.id,
        kind: spec.kind,
        scopeId: spec.scopeId,
        payload: { ...spec.payload },
        owner: instanceId,
        startedAt: pending?.startedAt ?? now,
        heartbeatAt: now,
        takeovers: pending?.takeovers ?? previous?.job.takeovers ?? 0,
      },
    };
    resuming.delete(spec.id);
    cancelWatch(spec.id);
    owned.set(spec.id, entry);
    if (held.has(spec.id) || !env.locks) write(entry.job);
    else hold(spec.id);
    syncHeartbeat();

    return {
      id: spec.id,
      resumed: entry.resumed,
      update: (patch) => {
        if (owned.get(spec.id) !== entry) return;
        entry.job.payload = { ...entry.job.payload, ...patch };
        entry.job.heartbeatAt = env.now();
        if (held.has(spec.id) || !env.locks) write(entry.job);
      },
      finish: () => {
        if (owned.get(spec.id) !== entry) return;
        owned.delete(spec.id);
        remove(spec.id);
        release(spec.id);
        syncHeartbeat();
      },
    };
  };

  const granted = async (id: string): Promise<void> => {
    const job = read(id);
    if (!job || owned.has(id) || disposed) return;
    const kind = kinds.get(job.kind);
    if (!kind) return;
    const willing = !kind.canTakeOver || kind.canTakeOver(job);
    if (env.now() - job.heartbeatAt > JOB_STALE_MS || job.takeovers >= JOB_MAX_TAKEOVERS) {
      remove(id);
      if (willing) { try { kind.abandon?.(job); } catch {} }
      return;
    }
    if (!willing) {
      later(() => watch(id), RETRY_PASS_MS);
      return;
    }
    const resumed: BackgroundJob = { ...job, owner: instanceId, heartbeatAt: env.now(), takeovers: job.takeovers + 1 };
    write(resumed);
    await new Promise<void>((resolve) => {
      held.set(id, resolve);
      resuming.set(id, resumed);
      const giveUp = () => {
        if (resuming.get(id) !== resumed) return;
        resuming.delete(id);
        if (owned.has(id)) return;
        remove(id);
        release(id);
      };
      void Promise.resolve()
        .then(() => kind.takeOver(resumed))
        .then(() => later(giveUp, ADOPT_WAIT_MS), giveUp);
    });
  };

  function watch(id: string) {
    if (!env.locks || disposed || frozen || watches.has(id) || owned.has(id) || held.has(id)) return;
    const job = read(id);
    if (!job || job.owner === instanceId || !kinds.has(job.kind)) return;
    const controller = new AbortController();
    watches.set(id, controller);
    env.locks.request(JOB_LOCK_PREFIX + id, { signal: controller.signal }, async () => {
      if (watches.get(id) === controller) watches.delete(id);
      await granted(id);
    }).catch(() => {
      if (watches.get(id) === controller) watches.delete(id);
    });
  }

  const scan = () => {
    if (disposed) return;
    listIds().forEach(watch);
  };

  const unsubscribe = env.subscribe((key) => {
    if (key === null || key.startsWith(JOB_RECORD_PREFIX)) scan();
  });
  const unsubscribeLifecycle = env.onLifecycle?.(() => {
    frozen = true;
    watches.forEach((controller) => controller.abort());
    watches.clear();
  }, () => {
    frozen = false;
    scan();
  }) ?? (() => {});

  return {
    instanceId,
    start,
    register: (kind, handler) => {
      kinds.set(kind, handler);
      scan();
      return () => {
        if (kinds.get(kind) !== handler) return;
        kinds.delete(kind);
        watches.forEach((controller, id) => {
          if (read(id)?.kind !== kind) return;
          controller.abort();
          watches.delete(id);
        });
      };
    },
    list: () => listIds().map(read).filter((job): job is BackgroundJob => Boolean(job)),
    dispose: () => {
      disposed = true;
      unsubscribe();
      unsubscribeLifecycle();
      watches.forEach((controller) => controller.abort());
      watches.clear();
      timers.forEach((handle) => env.clearTimeout(handle));
      timers.clear();
      if (heartbeat !== null) env.clearInterval(heartbeat);
      heartbeat = null;
      held.forEach((unlock) => unlock());
      held.clear();
    },
  };
};

const browserEnv = (): BackgroundJobsEnv => {
  const storage = (() => {
    try { return globalThis.localStorage ?? null; } catch { return null; }
  })();
  const locks = typeof navigator !== 'undefined' ? navigator.locks ?? null : null;
  return {
    storage,
    locks,
    now: () => Date.now(),
    subscribe: (onChange) => {
      if (typeof window === 'undefined') return () => {};
      const listener = (event: StorageEvent) => {
        if (event.storageArea && event.storageArea !== storage) return;
        onChange(event.key);
      };
      window.addEventListener('storage', listener);
      return () => window.removeEventListener('storage', listener);
    },
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
    clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
    onLifecycle: (onFreeze, onResume) => {
      if (typeof document === 'undefined') return () => {};
      document.addEventListener('freeze', onFreeze);
      document.addEventListener('resume', onResume);
      return () => {
        document.removeEventListener('freeze', onFreeze);
        document.removeEventListener('resume', onResume);
      };
    },
  };
};

/**
 * The record for `id` while a tab is running it, or was until moments ago and
 * another may yet resume it. Null once it finished, or when every tab closed
 * long enough ago that it will not be resumed.
 *
 * What a saved "running" state means depends on this: with a live record the
 * work is still happening somewhere, without one it was interrupted.
 */
export const readLiveBackgroundJob = (id: string, now = Date.now()): BackgroundJob | null => {
  try {
    const raw = globalThis.localStorage?.getItem(JOB_RECORD_PREFIX + id);
    if (!raw) return null;
    const job: unknown = JSON.parse(raw);
    if (!isJob(job) || job.id !== id) return null;
    return now - job.heartbeatAt > JOB_STALE_MS ? null : job;
  } catch {
    return null;
  }
};

let defaultJobs: BackgroundJobs | null = null;
const jobs = () => (defaultJobs ??= createBackgroundJobs(browserEnv()));

export const startBackgroundJob = <P>(spec: BackgroundJobSpec<P>): BackgroundJobHandle<P> => jobs().start(spec);

export const registerBackgroundJobKind = <P>(kind: string, handler: BackgroundJobKind<P>): (() => void) =>
  jobs().register(kind, handler);

export const listBackgroundJobs = (): BackgroundJob[] => jobs().list();
