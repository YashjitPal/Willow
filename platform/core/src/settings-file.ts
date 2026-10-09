/**
 * `settings.json` — Willow's settings, API keys included, in one file in the user's folder.
 *
 *   <chosen folder>/settings.json
 *
 * Every setting is kept in this browser's storage by the store that owns it, which a new copy of
 * Willow (a reinstall, a fresh profile, the web version on the same folder) starts without. The file
 * is the copy that travels with the folder, and it is meant to be read and edited by hand, as
 * Claude Code's is: indented, one top-level key per part of Willow, and an edit made in a text
 * editor is taken up within seconds.
 *
 * The stores stay where they are and keep working with no folder at all. A part of Willow joins by
 * registering a section (`registerSettingsSection`): what it holds now, how to take a value from
 * the file, and when it changed. `@willow/storage` hands the file over once a folder is connected
 * (`attachSettingsFile`), the same way it hands Saved Info its file.
 *
 * Which copy wins:
 * - **On attach**, the file wins when it changed since this browser last wrote or read it, and this
 *   browser's settings win when it did not (they changed while it was away). What this browser
 *   remembers is a hash of the text per folder, so the first time it meets a folder's file the file
 *   wins too, except where a section merges instead: a key typed here is not lost to a file that
 *   never had one.
 * - **After that**, a change on either side is written to the other. The file is read every few
 *   seconds while the page is visible, and only the sections whose value changed in it are taken,
 *   so a hand edit to one part never reverts an unsaved change to another.
 * - A file that does not parse is left exactly as it is, and nothing is written until it parses
 *   again: it is most likely open in an editor, half typed. A file deleted is written again at once.
 *
 * Keys nobody registered are kept as they are, so a key the user added by hand survives Willow
 * writing the file.
 */

export const SETTINGS_FILE_NAME = 'settings.json';
export const SETTINGS_FILE_VERSION = 1;

export interface SettingsSection {
  /** What this copy holds now, ready for JSON. `undefined` leaves the key as the file has it. */
  read(): unknown;
  /** Take a value from the file. The file is the user's to edit, so narrow it here. */
  apply(value: unknown): void;
  /** Calls `onChange` whenever `read()` may answer differently; returns how to stop. */
  subscribe(onChange: () => void): () => void;
  /**
   * The first time this browser meets the folder's file, the value to keep from the two, where the
   * file's alone would lose something. Without it the file's value is taken.
   */
  merge?(fromFile: unknown, local: unknown): unknown;
  /** Where the key sits in the file, lowest first; sections without one follow in registration order. */
  order?: number;
}

export interface SettingsFileDisk {
  /** Which folder this is: what this browser last synced is remembered per folder. */
  id: string;
  /** The file's text and when it last changed, or `null` when there is no file. Throws when it cannot be read. */
  read(): Promise<{ text: string; modified: number } | null>;
  /** Writes the whole file and answers when it now last changed. Throws when it cannot. */
  write(text: string): Promise<number>;
}

type Body = Record<string, unknown>;
type Known = { text: string; modified: number; body: Body };
type AttachMode = 'file' | 'merge' | 'local';

const RECORD_KEY = 'willow:settings-file:synced';
const WRITE_DELAY_MS = 400;
const WATCH_INTERVAL_MS = 3000;

const sections = new Map<string, { section: SettingsSection; stop: () => void }>();
let disk: SettingsFileDisk | null = null;
/** Bumped on every attach and detach; work started for an earlier folder checks it and stops. */
let session = 0;
/** The file as last read or written in this session. */
let known: Known | null = null;
/** The file is there but is not a JSON object: leave it alone until it is. */
let broken = false;
/** The attach has decided which copy wins; until it has, a check runs the attach instead. */
let settled = false;
/** How the attach settled, so a section registered later settles the same way. */
let attachMode: AttachMode = 'file';
/** Keys the file has news for that no section has taken yet: their part of Willow is not loaded. */
const untaken = new Set<string>();
let applying = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let watchTimer: ReturnType<typeof setInterval> | null = null;
let queue: Promise<void> = Promise.resolve();

const isObject = (value: unknown): value is Body =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
};

/** Equal values compare equal however their keys are ordered. */
const canonical = (value: unknown): string => JSON.stringify(sortKeys(value)) ?? 'undefined';

const parseBody = (text: string): Body | null => {
  try {
    const value = JSON.parse(text) as unknown;
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
};

/** FNV-1a: enough to tell one text from another, and no copy of the keys in it. */
const hashText = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
};

const readRecords = (): Record<string, string> => {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(RECORD_KEY) ?? 'null') as unknown;
    return isObject(value) ? Object.fromEntries(Object.entries(value).filter(([, hash]) => typeof hash === 'string')) as Record<string, string> : {};
  } catch {
    return {};
  }
};

const remember = (id: string, text: string): void => {
  try {
    globalThis.localStorage?.setItem(RECORD_KEY, JSON.stringify({ ...readRecords(), [id]: hashText(text) }));
  } catch {
    // Unremembered, the next attach lets the file win, which is the safe way round.
  }
};

const enqueue = (task: () => Promise<void>): Promise<void> => {
  const run = queue.then(task).catch((error: unknown) => {
    console.warn('[settings.json]', error);
  });
  queue = run;
  return run;
};

const ordered = (): Array<[string, SettingsSection]> => {
  const entries = [...sections].map(([key, { section }], index) => ({ key, section, index }));
  entries.sort((a, b) => (a.section.order ?? Number.MAX_SAFE_INTEGER) - (b.section.order ?? Number.MAX_SAFE_INTEGER) || a.index - b.index);
  return entries.map(({ key, section }) => [key, section]);
};

const readSection = (section: SettingsSection): unknown => {
  try {
    return section.read();
  } catch (error) {
    console.warn('[settings.json] A section could not be read:', error);
    return undefined;
  }
};

const applySection = (key: string, section: SettingsSection, value: unknown): void => {
  if (canonical(value) === canonical(readSection(section))) return;
  applying = true;
  try {
    section.apply(value);
  } catch (error) {
    console.warn(`[settings.json] "${key}" could not be applied:`, error);
  } finally {
    applying = false;
  }
};

/** What the file should say now: every section's value, then what only the file has. */
const compose = (): Body => {
  const body: Body = { version: SETTINGS_FILE_VERSION };
  for (const [key, section] of ordered()) {
    const value = readSection(section);
    if (value !== undefined) body[key] = value;
  }
  if (known) {
    for (const [key, value] of Object.entries(known.body)) {
      if (!(key in body)) body[key] = value;
    }
  }
  return body;
};

const writeNow = async (target: SettingsFileDisk, mine: number): Promise<void> => {
  if (mine !== session || broken) return;
  const body = compose();
  if (known && canonical(body) === canonical(known.body)) return;
  const text = `${JSON.stringify(body, null, 2)}\n`;
  const modified = await target.write(text);
  if (mine !== session) return;
  known = { text, modified, body: parseBody(text) ?? body };
  remember(target.id, text);
};

/** Takes what changed in the file since it was last known; recreates it when it is gone. */
const checkNow = async (target: SettingsFileDisk, mine: number): Promise<void> => {
  if (mine !== session) return;
  if (!settled) {
    await syncOnAttach(target, mine);
    return;
  }
  const file = await target.read();
  if (mine !== session) return;
  if (!file) {
    known = null;
    broken = false;
    await writeNow(target, mine);
    return;
  }
  if (known && file.text === known.text) {
    known = { ...known, modified: file.modified };
    return;
  }
  const body = parseBody(file.text);
  if (!body) {
    broken = true;
    return;
  }
  const base = broken || !known ? {} : known.body;
  broken = false;
  for (const key of Object.keys(body)) {
    if (key === 'version' || canonical(body[key]) === canonical(base[key])) continue;
    const section = sections.get(key)?.section;
    if (section) applySection(key, section, body[key]);
    else untaken.add(key);
  }
  known = { text: file.text, modified: file.modified, body };
  remember(target.id, file.text);
};

const syncOnAttach = async (target: SettingsFileDisk, mine: number): Promise<void> => {
  const file = await target.read();
  if (mine !== session) return;
  if (!file) {
    attachMode = 'local';
    settled = true;
    await writeNow(target, mine);
    return;
  }
  const body = parseBody(file.text);
  if (!body) {
    // Settled once it parses: until then nothing is taken from it or written over it.
    broken = true;
    known = { text: file.text, modified: file.modified, body: {} };
    return;
  }
  broken = false;
  settled = true;
  const synced = readRecords()[target.id];
  attachMode = synced === undefined ? 'merge' : synced === hashText(file.text) ? 'local' : 'file';
  known = { text: file.text, modified: file.modified, body };
  if (attachMode !== 'local') {
    for (const key of Object.keys(body)) {
      if (key === 'version') continue;
      const section = sections.get(key)?.section;
      if (!section) {
        untaken.add(key);
        continue;
      }
      const value = attachMode === 'merge' && section.merge ? section.merge(body[key], readSection(section)) : body[key];
      applySection(key, section, value);
    }
  }
  // Whatever the file lacks — a section it never had, what a merge added, this browser's own
  // changes — goes back out; nothing is written when there is no difference.
  await writeNow(target, mine);
  if (mine === session && known) remember(target.id, known.text);
};

const onLocalChange = (): void => {
  if (applying || !disk) return;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const target = disk;
    const mine = session;
    if (!target) return;
    // Read first, so a hand edit made in the last moment is taken rather than written over.
    void enqueue(async () => {
      await checkNow(target, mine);
      await writeNow(target, mine);
    });
  }, WRITE_DELAY_MS);
};

const onWake = (): void => {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  void checkSettingsFileNow();
};

const startWatching = (): void => {
  if (typeof window === 'undefined' || watchTimer) return;
  watchTimer = setInterval(onWake, WATCH_INTERVAL_MS);
  window.addEventListener('focus', onWake);
  document.addEventListener('visibilitychange', onWake);
};

const stopWatching = (): void => {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  if (typeof window === 'undefined') return;
  window.removeEventListener('focus', onWake);
  document.removeEventListener('visibilitychange', onWake);
};

/**
 * Join the file under `key`. Registering again under the same key replaces the section.
 * A section registered after the folder was attached takes what the file had for it that no one
 * took — at the attach, or edited since — and otherwise writes its own value.
 */
export function registerSettingsSection(key: string, section: SettingsSection): () => void {
  if (key === 'version') throw new Error('registerSettingsSection: "version" is the file\'s own key');
  sections.get(key)?.stop();
  sections.set(key, { section, stop: section.subscribe(onLocalChange) });
  const target = disk;
  if (target) {
    const mine = session;
    void enqueue(async () => {
      if (mine !== session || !settled || !known || broken) return;
      if (untaken.delete(key) && key in known.body) {
        const value = attachMode === 'merge' && section.merge ? section.merge(known.body[key], readSection(section)) : known.body[key];
        applySection(key, section, value);
      }
      await writeNow(target, mine);
    });
  }
  return () => {
    const entry = sections.get(key);
    if (entry?.section !== section) return;
    entry.stop();
    sections.delete(key);
  };
}

/** Point the file at a folder, or at none. Resolves once the two copies have been settled. */
export function attachSettingsFile(next: SettingsFileDisk | null): Promise<void> {
  session += 1;
  disk = next;
  known = null;
  broken = false;
  settled = false;
  attachMode = 'file';
  untaken.clear();
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  stopWatching();
  if (!next) return Promise.resolve();
  const mine = session;
  return enqueue(async () => {
    if (mine !== session) return;
    try {
      await syncOnAttach(next, mine);
    } finally {
      if (mine === session) startWatching();
    }
  });
}

/** Reads the file now and takes what changed in it. */
export function checkSettingsFileNow(): Promise<void> {
  const target = disk;
  if (!target) return Promise.resolve();
  const mine = session;
  return enqueue(() => checkNow(target, mine));
}

/** Test seam. Not for app code. */
export function __resetSettingsFileForTest(): void {
  for (const { stop } of sections.values()) stop();
  sections.clear();
  void attachSettingsFile(null);
}

/** Writes a pending change now instead of after the short wait. */
export function flushSettingsFile(): Promise<void> {
  const target = disk;
  if (!writeTimer || !target) return queue;
  clearTimeout(writeTimer);
  writeTimer = null;
  const mine = session;
  return enqueue(async () => {
    await checkNow(target, mine);
    await writeNow(target, mine);
  });
}
