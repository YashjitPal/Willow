/**
 * The pet's keeper: the half of BetterGravity's Pets plugin that is not the pet.
 *
 * One tab keeps the pet at a time (a Web Lock), because every tab is a page of
 * its own and the pet is one. That tab reads Spark's tasks into activity
 * entries (pet-sensor.ts), runs the surface — on the desktop in the app's
 * overlay window, or inside its own page — and carries out what the pet asks:
 * open a task, answer it, stop it, start one, put the cards or the pet away.
 *
 * On the desktop any tab can keep it, and the first one does; when that tab
 * closes another takes over where it left off. Inside Willow's window the pet
 * has to be in the tab on screen, so the tab in front keeps it.
 */
import {
  closeDesktopOverlay,
  isDesktopApp,
  onDesktopMessage,
  openDesktopOverlay,
  postDesktopOverlay,
  reportDesktopPetShown,
  showInDesktopTab,
  type DesktopPetSprite,
} from '@willow/core/desktop-bridge';
import { getSparkTaskById, sparkPendingQuestions, sparkTasks } from '../spark-store';
import { getSparkTaskHost, waitForSparkTaskHost } from '../spark-task-host';
import { petSurface } from './surface/surface.js';
import petCss from './surface/pet.css?raw';
import hudCss from './surface/hud.css?raw';
import rockyUrl from './assets/rocky.webp?url';
import {
  activityOf,
  dismissEntry,
  entriesFrom,
  greetingFor,
  GREETING_KEY,
  PetSensorMemory,
  readSparkTasks,
  signatureOf,
  type PetActivityEntry,
} from './pet-sensor';
import { loadPetSprite } from './pet-library';
import {
  petBadgeCorner,
  petDetails,
  petGreeted,
  petPillsVisible,
  petPosition,
  petSelection,
  petSettings,
  petShown,
  petStatusLine,
  type PetBadgeCorner,
} from './pet-store';

const LOCK = 'willow-pets';
/** Store changes drive the tray; the interval catches what they miss, and expiries. */
const POLL_INTERVAL_MS = 2000;
const ACTIVITY_COALESCE_MS = 50;
/** How long the overlay has to prove there is a pet standing in it. */
const HELLO_TIMEOUT_MS = 4000;
/** What the sensor knew, for the tab taking the pet over. A relaunch starts afresh, as the plugin does. */
const MEMORY_KEY = 'willow:pets:memory';
const MEMORY_FRESH_MS = 60_000;
const SHEET_TOKEN = 'url("../assets/rocky.webp")';

interface Surface {
  where: 'desktop' | 'window';
  send(message: unknown): void;
  close(): void;
}

/* ── The pet's styles ───────────────────────────────────────────────────── */

let desktopStyles: Promise<string> | null = null;

/**
 * The overlay page is another origin with no way to fetch Willow's assets, so
 * the bundled sheet goes across inside the stylesheet, as a data URL.
 */
const stylesForDesktop = (): Promise<string> => desktopStyles ??= (async () => {
  const blob = await (await fetch(rockyUrl)).blob();
  const sheet = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return `${petCss}\n${hudCss}`.replaceAll(SHEET_TOKEN, `url(${JSON.stringify(sheet)})`);
})();

const stylesForWindow = (): string =>
  `${petCss}\n${hudCss}`.replaceAll(SHEET_TOKEN, `url(${JSON.stringify(new URL(rockyUrl, window.location.href).href)})`);

/* ── The status row ─────────────────────────────────────────────────────── */

const DOING: Record<string, string> = {
  idle: 'resting',
  running: 'working',
  waiting: 'waiting for you',
  review: 'ready for you',
  failed: 'blocked',
  waving: 'waving',
  jumping: 'jumping',
  'running-left': 'running',
  'running-right': 'running',
};

const LABELS: Record<string, string> = {
  running: 'working',
  waiting: 'needs input',
  failed: 'blocked',
  review: 'ready',
  idle: 'idle',
};

/* ── Keeping the pet ────────────────────────────────────────────────────── */

const restoreMemory = (): PetSensorMemory => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(MEMORY_KEY) ?? 'null') as { savedAt?: number; memory?: unknown } | null;
    if (saved && typeof saved.savedAt === 'number' && Date.now() - saved.savedAt < MEMORY_FRESH_MS) return PetSensorMemory.fromJSON(saved.memory);
  } catch {
    // Nothing to take over from.
  }
  return new PetSensorMemory();
};

/** Runs the pet until `signal` aborts, which is when this tab stops keeping it. */
async function keepPet(signal: AbortSignal): Promise<void> {
  const memory = restoreMemory();
  let surface: Surface | null = null;
  let generation = 0;
  let requested = 0;
  let chain: Promise<void> = Promise.resolve();
  let activity: PetActivityEntry[] = [];
  let working = false;
  let signature = '';
  let playing = 'idle';
  let greeting: PetActivityEntry | null = null;
  let greetingTimer: number | undefined;
  let activityTimer: number | undefined;
  let saveTimer: number | undefined;
  let trouble = '';
  let sprite: DesktopPetSprite | null = null;
  let lastLine = '';
  const cleanups: (() => void)[] = [];

  const settings = () => petSettings.get();

  /** Which sheet is being worn, as the thing a greeting is remembered by. */
  const sheetId = (): string => (sprite ? `custom:${sprite.id}` : settings().sheet.trim() || 'rocky');

  /** The name it gives: the chosen pet's, Rocky's, or a sheet URL's file name in words. */
  const petName = (): string => {
    const details = petDetails.get();
    if (sprite) return details[`custom:${sprite.id}`]?.displayName || sprite.displayName;
    const id = sheetId();
    if (id === 'rocky') return details.rocky?.displayName || 'Rocky';
    const file = id.split(/[?#]/, 1)[0].replace(/\.[a-z0-9]+$/i, '');
    const words = file
      .slice(file.lastIndexOf('/') + 1)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 0)
      .map((word) => word[0].toUpperCase() + word.slice(1));
    return words.length === 0 ? 'Rocky' : words.join(' ').slice(0, 32);
  };

  const configOf = () => ({
    size: settings().size,
    force: settings().force,
    sheet: sprite?.spritesheetDataUrl ?? settings().sheet,
    activity: settings().activity,
    bounce: settings().bounce,
  });

  const saveMemory = () => {
    try {
      window.localStorage.setItem(MEMORY_KEY, JSON.stringify({ savedAt: Date.now(), memory: memory.toJSON() }));
    } catch {
      // A handoff then starts from what it can see.
    }
  };
  const scheduleSave = () => {
    if (saveTimer !== undefined) return;
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      saveMemory();
    }, 2000);
  };

  const describeStatus = (): string => {
    if (!petShown.get()) return 'Put away. The paw in the tab bar brings it back.';
    if (surface === null) return trouble === '' ? 'Waking up.' : `No pet: ${trouble}`;
    const where = surface.where === 'desktop'
      ? 'On the desktop'
      : settings().home === 'desktop'
        ? `In Willow's window, because the desktop did not work out: ${trouble || 'no reason given'}`
        : "In Willow's window";
    const position = petPosition.get();
    const spot = position === null ? '' : ` at ${Math.round(position.x)}, ${Math.round(position.y)}`;
    const held = settings().force === 'auto' ? '' : ', held by the Pets page';
    // The greeting is a card, but it is not a task, so it is not counted as one.
    const tasks = activity.filter((entry) => entry.status !== 'greeting');
    const reporting = !settings().activity
      ? 'cards hidden'
      : tasks.length === 0
        ? activity.length === 0 ? 'nothing to report' : 'saying hello'
        : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}, ${LABELS[tasks[0].status] ?? tasks[0].status} first`;
    return `${where}${spot} — ${DOING[playing] ?? playing}${held}, ${reporting}.`;
  };
  const publishStatus = () => {
    const line = describeStatus();
    if (line === lastLine) return;
    lastLine = line;
    petStatusLine.set(line);
  };

  const read = () => {
    const now = Date.now();
    const entries = entriesFrom(memory, readSparkTasks(sparkTasks.get(), sparkPendingQuestions.get(), now), now);
    const result = activityOf(entries, memory, greeting, settings().activity, now);
    greeting = result.greeting;
    return result;
  };

  const poll = () => {
    if (surface === null) return;
    const next = read();
    scheduleSave();
    const nextSignature = signatureOf(next.entries, next.working);
    if (nextSignature === signature) return;
    activity = next.entries;
    working = next.working;
    signature = nextSignature;
    surface.send({ t: 'activity', entries: activity, working });
    publishStatus();
  };

  const scheduleActivity = () => {
    // Throttles a burst of store writes without restarting on each one.
    if (surface === null || activityTimer !== undefined) return;
    activityTimer = window.setTimeout(() => {
      activityTimer = undefined;
      poll();
    }, ACTIVITY_COALESCE_MS);
  };

  /** A greeting, or nothing: once per pet for good, and only while there are cards to show it on. */
  const wake = () => {
    const id = sheetId();
    const greeted = petGreeted.get();
    if (greeted.includes(id)) return;
    petGreeted.set([...greeted, id]);
    greeting = greetingFor(petName(), Date.now());
  };

  /* What the pet asks for. */

  const openTask = (key: string) => {
    if (key === GREETING_KEY) {
      showInDesktopTab({ composer: true, raise: true });
      return;
    }
    showInDesktopTab({ taskId: key, raise: true });
  };

  const host = async () => getSparkTaskHost() ?? (await waitForSparkTaskHost(1500));

  /**
   * Aimed at a card, a follow-up in that task, which is opened as it is sent.
   * Unaimed, a new task of its own — Codex's quick chat targets nothing.
   */
  const askTask = async (key: unknown, text: string): Promise<boolean> => {
    const tasks = await host();
    if (!tasks) return false;
    if (typeof key === 'string' && key.length > 0 && key !== GREETING_KEY) {
      if (!getSparkTaskById(key)) return false;
      showInDesktopTab({ taskId: key, raise: false });
      return tasks.followUp(key, text);
    }
    const id = tasks.startTask(text);
    if (!id) return false;
    showInDesktopTab({ taskId: id, raise: true });
    return true;
  };

  const stopTask = async (key: string) => {
    const tasks = await host();
    if (!tasks || !getSparkTaskById(key)) return;
    showInDesktopTab({ taskId: key, raise: false });
    tasks.stop(key);
  };

  /** Told to the pet at once: the card is already gone as far as whoever pressed it is concerned. */
  const dismiss = (key: string) => {
    const next = dismissEntry(memory, activity, key);
    if (!next) return;
    activity = next;
    signature = signatureOf(activity, working);
    surface?.send({ t: 'activity', entries: activity, working });
    scheduleSave();
    publishStatus();
  };

  const fromSurface = (message: unknown) => {
    if (message === null || typeof message !== 'object') return;
    const said = message as Record<string, unknown>;
    if (said.type === 'bettergravity:overlay-context-menu') {
      surface?.send({ type: 'bettergravity:overlay-context-menu-result', requestId: said.requestId, unsupported: true });
      return;
    }
    switch (said.t) {
      case 'hide':
        petShown.set(false);
        break;
      case 'badge-corner':
        if (['top-start', 'top-end', 'bottom-start', 'bottom-end'].includes(said.corner as string)) petBadgeCorner.set(said.corner as PetBadgeCorner);
        break;
      case 'activity-visibility':
        if (typeof said.visible === 'boolean' && said.visible !== petPillsVisible.get()) petPillsVisible.set(said.visible);
        break;
      case 'at':
        if (Number.isFinite(said.x) && Number.isFinite(said.y)) {
          petPosition.set({ x: said.x as number, y: said.y as number });
          publishStatus();
        }
        break;
      case 'playing':
        if (typeof said.state === 'string') {
          playing = said.state;
          publishStatus();
        }
        break;
      case 'poke':
        showInDesktopTab({ composer: true, raise: true });
        break;
      case 'open':
        if (typeof said.key === 'string') openTask(said.key);
        break;
      case 'stop':
        if (typeof said.key === 'string') void stopTask(said.key);
        break;
      case 'dismiss':
        if (typeof said.key === 'string') dismiss(said.key);
        break;
      case 'ask':
        if (typeof said.text === 'string' && said.text.length > 0) {
          const destination = surface;
          const respond = (ok: boolean) => {
            if (typeof said.requestId !== 'string' || destination === null || destination !== surface) return;
            destination.send({ t: 'reply-result', key: said.key, requestId: said.requestId, ok });
          };
          void askTask(said.key, said.text).then((ok) => respond(ok === true), () => respond(false));
        }
        break;
    }
  };

  /* The two places it can live. Both run the same petSurface. */

  const windowSurface = (data: Record<string, unknown>): Surface => {
    const style = document.createElement('style');
    style.dataset.willowPet = '';
    style.textContent = stylesForWindow();
    document.head.append(style);
    const listeners = new Set<(message: unknown) => void>();
    petSurface(
      {
        send: fromSurface,
        setInteractive: () => undefined,
        setFocusable: () => undefined,
        onMessage: (listener) => {
          listeners.add(listener);
          return () => void listeners.delete(listener);
        },
      },
      { ...data, desktop: false },
    );
    const send = (message: unknown) => {
      for (const listener of [...listeners]) listener(message);
    };
    return {
      where: 'window',
      send,
      close: () => {
        send({ t: 'bye' });
        listeners.clear();
        style.remove();
      },
    };
  };

  /** The pet on the desktop, or null when the overlay could not be opened or no pet appeared in it. */
  const desktopSurface = async (data: Record<string, unknown>, mine: number): Promise<Surface | null> => {
    let styles: string;
    try {
      styles = await stylesForDesktop();
    } catch (error) {
      trouble = `the pet's sheet could not be read (${error instanceof Error ? error.message : String(error)})`;
      return null;
    }
    let alive = true;
    let greeted = false;
    let hello: (said: unknown) => void = () => undefined;
    const said = new Promise<unknown>((resolve) => {
      hello = resolve;
    });
    // Before opening: the pet can say hello before the open call has returned.
    const off = onDesktopMessage((message) => {
      if (!alive || message.kind !== 'overlay') return;
      const content = message.message as { t?: unknown } | null;
      if (!greeted && content?.t === 'hello') {
        greeted = true;
        hello(content);
        return;
      }
      fromSurface(content);
    });
    const status = await openDesktopOverlay({ script: String(petSurface), styles, data: { ...data, desktop: true }, display: 'primary' });
    if (!status.open) {
      alive = false;
      off();
      trouble = status.message ?? 'the overlay was refused';
      return null;
    }
    const answered = await Promise.race([said, new Promise((resolve) => window.setTimeout(() => resolve(null), HELLO_TIMEOUT_MS))]);
    if (answered === null || mine !== generation || signal.aborted) {
      alive = false;
      off();
      if (answered === null) trouble = 'the desktop window opened but no pet appeared in it';
      closeDesktopOverlay();
      return null;
    }
    return {
      where: 'desktop',
      send: postDesktopOverlay,
      close: () => {
        alive = false;
        off();
        closeDesktopOverlay();
      },
    };
  };

  const stopSurface = () => {
    window.clearTimeout(activityTimer);
    activityTimer = undefined;
    const live = surface;
    surface = null;
    live?.close();
  };

  const loadSelection = async () => {
    const selection = petSelection.get();
    if (!selection.startsWith('custom:')) {
      sprite = null;
      return;
    }
    try {
      sprite = await loadPetSprite(selection.slice(7));
    } catch (error) {
      sprite = null;
      trouble = error instanceof Error ? error.message : String(error);
    }
  };

  const start = async () => {
    const mine = ++generation;
    stopSurface();
    window.clearTimeout(greetingTimer);
    if (!petShown.get()) {
      publishStatus();
      return;
    }
    trouble = '';
    await loadSelection();
    if (mine !== generation || signal.aborted) return;

    // The greeting is a notification, so it only exists where cards do, and the
    // flag is only spent when one was made: turning cards on later still gets an introduction.
    if (settings().activity) wake();

    const snapshot = read();
    activity = snapshot.entries;
    working = snapshot.working;
    signature = signatureOf(activity, working);
    const data = {
      config: configOf(),
      entries: activity,
      working,
      at: petPosition.get(),
      activityPillsVisible: petPillsVisible.get(),
      badgeCorner: petBadgeCorner.get(),
    };

    const next = settings().home === 'desktop'
      ? (await desktopSurface(data, mine)) ?? windowSurface(data)
      : windowSurface(data);
    // A newer start began while the window was opening; that one owns the pet.
    if (mine !== generation || signal.aborted) {
      next.close();
      return;
    }
    surface = next;
    poll();
    publishStatus();
    // The greeting is the only entry with an expiry of its own; without this the pet keeps waving past its welcome.
    if (greeting?.expiresAtMs !== undefined) {
      greetingTimer = window.setTimeout(poll, Math.max(0, greeting.expiresAtMs - Date.now()) + 1);
    }
  };

  /** Starts are run one at a time, and only the latest of any that queued up. */
  const begin = () => {
    const wanted = ++requested;
    chain = chain
      .then(() => (wanted === requested && !signal.aborted ? start() : undefined))
      .catch((error: unknown) => {
        trouble = error instanceof Error ? error.message : String(error);
        publishStatus();
      });
  };

  /* Keeping in step with Spark, the Pets page, and the app. */

  cleanups.push(sparkTasks.listen(scheduleActivity));
  cleanups.push(sparkPendingQuestions.listen(scheduleActivity));
  const poller = window.setInterval(poll, POLL_INTERVAL_MS);
  cleanups.push(() => window.clearInterval(poller));

  let previousSettings = settings();
  cleanups.push(petSettings.store.listen((next) => {
    const before = previousSettings;
    previousSettings = next;
    // Moving house means a new surface; everything else the live one can be told.
    if (next.home !== before.home) {
      begin();
      return;
    }
    if (next.sheet !== before.sheet && next.sheet.trim()) sprite = null;
    signature = '';
    surface?.send({ t: 'config', config: configOf() });
    poll();
    publishStatus();
  }));

  let previousSelection = petSelection.get();
  cleanups.push(petSelection.store.listen((next) => {
    if (next === previousSelection) return;
    previousSelection = next;
    // A sheet of one's own just took over: the pet is redrawn, not restarted.
    if (next === 'rocky' && settings().sheet.trim()) {
      sprite = null;
      surface?.send({ t: 'config', config: configOf() });
      return;
    }
    begin();
  }));

  cleanups.push(petShown.store.listen((shown) => {
    reportDesktopPetShown(shown);
    if (shown) begin();
    else {
      generation++;
      stopSurface();
      publishStatus();
    }
  }));

  cleanups.push(petDetails.store.listen(() => {
    if (greeting !== null) {
      greeting = { ...greeting, title: `Hi, I'm ${petName()}` };
      signature = '';
      poll();
    }
  }));

  cleanups.push(onDesktopMessage((message) => {
    if (message.kind === 'pets-toggle') {
      petShown.set(!petShown.get());
      return;
    }
    if (message.kind !== 'pets-changed') return;
    // The chosen pet's package changed on disk: wear the new sheet.
    const selection = petSelection.get();
    if (!selection.startsWith('custom:')) return;
    void loadPetSprite(selection.slice(7)).then(
      (next) => {
        if (next.spritesheetDataUrl !== sprite?.spritesheetDataUrl) begin();
      },
      () => undefined,
    );
  }));

  window.addEventListener('pagehide', saveMemory);
  cleanups.push(() => window.removeEventListener('pagehide', saveMemory));

  reportDesktopPetShown(petShown.get());
  begin();

  await new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });

  generation++;
  requested++;
  for (const cleanup of cleanups.splice(0)) {
    try {
      cleanup();
    } catch {
      // One teardown failing must not strand the rest.
    }
  }
  window.clearTimeout(greetingTimer);
  window.clearTimeout(saveTimer);
  stopSurface();
  saveMemory();
}

/**
 * Starts this tab's part in keeping the pet. Every tab of the desktop app calls
 * it; the one holding the lock keeps the pet. A no-op in a browser.
 */
export function startPets(): () => void {
  if (!isDesktopApp() || typeof navigator === 'undefined' || !navigator.locks) return () => undefined;
  let held: AbortController | null = null;
  let stopped = false;
  // Inside Willow's window the pet has to be in the tab on screen.
  const wanted = () => !stopped && (petSettings.get().home === 'desktop' || document.visibilityState === 'visible');
  const update = () => {
    if (!wanted()) {
      held?.abort();
      held = null;
      return;
    }
    if (held) return;
    const controller = new AbortController();
    held = controller;
    navigator.locks
      .request(LOCK, { signal: controller.signal }, () => keepPet(controller.signal))
      .catch(() => undefined)
      .finally(() => {
        if (held !== controller) return;
        held = null;
        window.setTimeout(update, 1000);
      });
  };
  document.addEventListener('visibilitychange', update);
  const off = petSettings.store.listen(update);
  update();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', update);
    off();
    held?.abort();
    held = null;
  };
}
