/**
 * A bot's computer as this window sees it: the machine as the companion last
 * described it, what is on its screen, its step history, and its pane — open,
 * or taken over. Frames and the pointer live in a store of their own, so the
 * ten-a-second picture redraws the viewer and nothing else.
 *
 * One subscription to the companion feeds every bot; a pane that is showing
 * asks for frames while it shows (`watchDotComputer`).
 */
import { map } from 'nanostores';
import {
  dotMachine,
  handBackDotMachine,
  resetDotMachine,
  setUpDotMachine,
  takeOverDotMachine,
  turnOffDotMachine,
  turnOnDotMachine,
} from '../harness/dot-runtime';
import type {
  DotMachineControl,
  DotMachineCursor,
  DotMachineProgress,
  DotMachineScreen,
  DotMachineShot,
  DotMachineStatus,
  DotMachineSummary,
} from '../harness/runtime/machine-bridge';

export interface DotComputerView {
  status: DotMachineStatus | null;
  summary: DotMachineSummary | null;
  screen: DotMachineScreen | null;
  control: DotMachineControl | null;
  progress: DotMachineProgress | null;
  shots: DotMachineShot[];
  paneOpen: boolean;
  /** This window has the wheel: the takeover view is up. */
  inControl: boolean;
  busy: 'setting-up' | 'starting' | 'stopping' | 'resetting' | 'taking-over' | null;
  problem: string | null;
  /** When the user last closed the pane: the bot's next burst of activity leaves it closed for a while. */
  closedAt: number;
}

export interface DotComputerFrame {
  /** The latest picture of the screen, as a data URL, and its size: the whole desktop, or a page alone. */
  frame: string | null;
  width?: number;
  height?: number;
  cursor: DotMachineCursor | null;
}

const EMPTY: DotComputerView = {
  status: null,
  summary: null,
  screen: null,
  control: null,
  progress: null,
  shots: [],
  paneOpen: false,
  inControl: false,
  busy: null,
  problem: null,
  closedAt: 0,
};

/** Spark's pane opens as its browser starts; a bot's opens as the bot starts acting, unless just closed. */
const REOPEN_AFTER_MS = 5 * 60_000;
const SHOTS_KEPT = 300;

export const dotComputers = map<Record<string, DotComputerView>>({});
export const dotComputerFrames = map<Record<string, DotComputerFrame>>({});

export const dotComputerView = (dotId: string): DotComputerView => dotComputers.get()[dotId] ?? EMPTY;

const update = (dotId: string, patch: Partial<DotComputerView> | ((view: DotComputerView) => Partial<DotComputerView>)) => {
  const view = dotComputerView(dotId);
  dotComputers.setKey(dotId, { ...view, ...(typeof patch === 'function' ? patch(view) : patch) });
};

const updateFrame = (dotId: string, patch: Partial<DotComputerFrame>) => {
  const current = dotComputerFrames.get()[dotId] ?? { frame: null, cursor: null };
  dotComputerFrames.setKey(dotId, { ...current, ...patch });
};

const watchers = new Map<string, number>();
let listening = false;

const loadShots = async (dotId: string) => {
  const reply = await dotMachine().call<{ shots?: DotMachineShot[] }>(dotId, { method: 'GET', path: '/shots', timeoutMs: 15_000 }).catch(() => null);
  if (reply?.status === 200) update(dotId, { shots: (reply.body.shots ?? []).slice(-SHOTS_KEPT) });
};

const onScreen = (dotId: string, screen: DotMachineScreen) => {
  const view = dotComputerView(dotId);
  const startedActing = screen.agentActive && !view.screen?.agentActive;
  update(dotId, {
    screen,
    ...(startedActing && !view.paneOpen && Date.now() - view.closedAt > REOPEN_AFTER_MS ? { paneOpen: true } : {}),
  });
};

const listen = () => {
  if (listening) return;
  listening = true;
  dotMachine().subscribe((event) => {
    switch (event.type) {
      case 'connected':
        // A new socket is a new session at the companion: watching starts over.
        for (const [dotId, count] of watchers) if (count > 0) void dotMachine().watch(dotId, true).catch(() => undefined);
        for (const dotId of Object.keys(dotComputers.get())) void refreshDotComputer(dotId);
        break;
      case 'state': {
        const view = dotComputerView(event.dotId);
        update(event.dotId, {
          summary: event.summary,
          control: event.summary.control ?? view.control,
          progress: event.summary.progress,
          ...(event.summary.state === 'running' ? {} : { inControl: false, screen: null }),
        });
        // A computer that is not on has no screen to show: its last frame would come back as the next run's.
        if (event.summary.state !== 'running' && dotComputerFrames.get()[event.dotId]?.frame) updateFrame(event.dotId, { frame: null, cursor: null });
        if (event.summary.screen) onScreen(event.dotId, event.summary.screen);
        if (event.summary.state === 'running' && view.summary?.state !== 'running') void loadShots(event.dotId);
        break;
      }
      case 'progress':
        if (event.dotId) update(event.dotId, { progress: event.progress });
        else {
          for (const [dotId, view] of Object.entries(dotComputers.get())) {
            if (view.summary?.state === 'creating' || view.summary?.state === 'resetting') update(dotId, { progress: event.progress });
          }
        }
        break;
      case 'screen':
        onScreen(event.dotId, event.screen);
        break;
      case 'control':
        update(event.dotId, (view) => ({ control: event.control, inControl: view.inControl && event.control.holder === 'human' }));
        break;
      case 'shot':
        update(event.dotId, (view) => ({ shots: [...view.shots.filter((shot) => shot.id !== event.shot.id), event.shot].slice(-SHOTS_KEPT) }));
        break;
      case 'frame':
        updateFrame(event.dotId, { frame: `data:image/jpeg;base64,${event.data}`, width: event.width, height: event.height });
        break;
      case 'cursor':
        updateFrame(event.dotId, { cursor: event.cursor });
        break;
    }
  });
  // Keeps the companion's socket open, and every view true, between events.
  setInterval(() => {
    for (const dotId of Object.keys(dotComputers.get())) void refreshDotComputer(dotId);
  }, 20_000);
};

/** Asks the companion how the bot's computer is. */
export const refreshDotComputer = async (dotId: string): Promise<void> => {
  listen();
  const status = await dotMachine().status(dotId).catch(() => null);
  if (!status) return;
  const view = dotComputerView(dotId);
  const machine = status.machine;
  update(dotId, {
    status,
    summary: machine ?? view.summary,
    control: machine?.control ?? view.control,
    progress: machine?.progress ?? (status.base.building ? status.base.progress : null),
    ...(machine && machine.state !== 'running' ? { screen: null } : {}),
  });
  if (machine?.screen) onScreen(dotId, machine.screen);
  if (machine?.state === 'running' && view.shots.length === 0) void loadShots(dotId);
};

/** Frames flow while a pane shows the computer. Returns the stop. */
export const watchDotComputer = (dotId: string): (() => void) => {
  listen();
  const count = (watchers.get(dotId) ?? 0) + 1;
  watchers.set(dotId, count);
  if (count === 1) void dotMachine().watch(dotId, true).catch(() => undefined);
  return () => {
    const left = Math.max(0, (watchers.get(dotId) ?? 1) - 1);
    watchers.set(dotId, left);
    if (left === 0) void dotMachine().watch(dotId, false).catch(() => undefined);
  };
};

const shotImages = new Map<string, string>();

/** One step's picture, from the computer (and kept here a while). */
export const loadDotShot = async (dotId: string, shot: DotMachineShot): Promise<string | null> => {
  const key = `${dotId}\u0000${shot.id}`;
  const held = shotImages.get(key);
  if (held) return held;
  const reply = await dotMachine().call<{ data?: string }>(dotId, { method: 'GET', path: `/shots/${shot.id}`, timeoutMs: 15_000 }).catch(() => null);
  if (reply?.status !== 200 || !reply.body.data) return null;
  const url = `data:image/jpeg;base64,${reply.body.data}`;
  shotImages.set(key, url);
  if (shotImages.size > 40) shotImages.delete(shotImages.keys().next().value!);
  return url;
};

export const openDotComputer = (dotId: string) => {
  update(dotId, { paneOpen: true });
  void refreshDotComputer(dotId);
};

export const closeDotComputer = (dotId: string) => update(dotId, { paneOpen: false, closedAt: Date.now() });

const act = async (dotId: string, busy: NonNullable<DotComputerView['busy']>, work: () => Promise<string | null>) => {
  update(dotId, { busy, problem: null });
  const problem = await work().catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  update(dotId, { busy: null, problem });
  void refreshDotComputer(dotId);
  return problem;
};

export const setUpDotComputer = (dotId: string) => act(dotId, 'setting-up', () => setUpDotMachine(dotId));
export const turnOnDotComputer = (dotId: string) => act(dotId, 'starting', () => turnOnDotMachine(dotId));
export const turnOffDotComputer = (dotId: string) => act(dotId, 'stopping', () => turnOffDotMachine(dotId));
export const resetDotComputer = (dotId: string) => act(dotId, 'resetting', () => resetDotMachine(dotId));

/** The user takes the wheel — answering a request for help, or unasked — and the takeover view opens. */
export const takeOverDotComputer = async (dotId: string, requestId?: string): Promise<string | null> => {
  update(dotId, { busy: 'taking-over', problem: null, paneOpen: true });
  const { control, problem } = await takeOverDotMachine(dotId, requestId);
  update(dotId, (view) => ({ busy: null, problem, ...(control ? { control, inControl: control.holder === 'human' } : {}), paneOpen: view.paneOpen }));
  return problem;
};

export const handBackDotComputer = async (dotId: string): Promise<string | null> => {
  const requestId = dotComputerView(dotId).control?.request?.id;
  update(dotId, { inControl: false });
  if (!requestId) return null;
  const { control, problem } = await handBackDotMachine(dotId, requestId);
  update(dotId, (view) => ({ control: control ?? view.control, problem }));
  return problem;
};

const inputQueues = new Map<string, Promise<unknown>>();

/** The user's mouse and keyboard, in order: each event waits for the one before it to land. */
export const sendDotInput = (dotId: string, path: string, body: Record<string, unknown> = {}): Promise<unknown> => {
  const next = (inputQueues.get(dotId) ?? Promise.resolve())
    .then(() => dotMachine().call(dotId, { method: 'POST', path, body, timeoutMs: 15_000 }))
    .catch(() => undefined);
  inputQueues.set(dotId, next);
  return next;
};
