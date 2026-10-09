import { atom } from 'nanostores';
import {
  designMessagesStore,
  designNodesStore,
  selectedDesignNodeIds,
  type DesignChatMessage,
  type DesignNodeData,
} from './design-store';

/** A Design project's screens and chat: `Design/<project>/design.json`, and this browser's copy between runs. */
export interface DesignProjectState {
  nodes: DesignNodeData[];
  messages: DesignChatMessage[];
}

/** Where a project's file is read and written (`readLocalFSDesignFile` / `writeLocalFSDesignFile`). */
export interface DesignFolder {
  /** The file's text, `null` when it isn't there; throws when it can't be read. */
  read: (projectName: string, path: string) => Promise<string | null>;
  write: (projectName: string, path: string, content: string) => Promise<boolean>;
}

/** This browser's copy of a project, with the `design.json` text it last wrote or read. */
export interface SavedDesign extends DesignProjectState {
  file?: string;
}

/** This browser's copy of each project, by project name. */
export interface DesignSaved {
  read: (projectName: string) => Promise<SavedDesign | null>;
  write: (projectName: string, state: SavedDesign) => Promise<void>;
}

export const DESIGN_STATE_FILE = 'design.json';
const SAVE_DELAY_MS = 500;

/** True while the project being opened is read: its canvas and chat wait for it. */
export const designProjectLoading = atom(false);

const isRecord = (value: unknown): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value);

export function parseDesignState(text: string): DesignProjectState | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.messages)) return null;
    const nodes = value.nodes.filter(
      (node): node is DesignNodeData => isRecord(node) && typeof node.id === 'string' && typeof node.code === 'string',
    );
    const messages = value.messages.filter(
      (message): message is DesignChatMessage =>
        isRecord(message) && typeof message.id === 'string' && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string',
    );
    return { nodes, messages };
  } catch {
    return null;
  }
}

/** Thumbnails are a cache of the screen's own code, and a reply still streaming isn't one yet. */
export function designStateFile(state: DesignProjectState): string {
  return JSON.stringify(
    {
      nodes: state.nodes.map(({ thumbnailUrl: _thumbnail, ...node }) => node),
      messages: state.messages.filter((message) => !message.isGenerating),
    },
    null,
    2,
  );
}

const DATABASE = 'willow-design';
const STORE = 'projects';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export const designSaved: DesignSaved = {
  async read(projectName) {
    const value = await inStore<unknown>('readonly', (store) => store.get(projectName));
    return isRecord(value) && Array.isArray(value.nodes) && Array.isArray(value.messages) ? (value as unknown as SavedDesign) : null;
  },
  async write(projectName, state) {
    await inStore('readwrite', (store) => store.put(state, projectName));
  },
};

interface OpenProject {
  name: string;
  folder: DesignFolder;
  saved: DesignSaved;
  /** Off when the folder's copy couldn't be read: this session's canvas mustn't replace it. */
  saving: boolean;
}

let open: OpenProject | null = null;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Each project's latest state this session, so reopening it never waits on a write still landing. */
const latest = new Map<string, SavedDesign>();

function saveNow(): void {
  clearTimeout(timer);
  timer = undefined;
  const project = open;
  if (!project?.saving) return;
  const state: DesignProjectState = { nodes: designNodesStore.get(), messages: designMessagesStore.get() };
  const file = designStateFile(state);
  const previous = latest.get(project.name)?.file;
  latest.set(project.name, { ...state, file: previous });
  // `file` names what the folder holds, so it moves only once the folder has it.
  void project.folder
    .write(project.name, DESIGN_STATE_FILE, file)
    .catch(() => false)
    .then((written) => {
      const kept: SavedDesign = { ...state, file: written ? file : previous };
      const now = latest.get(project.name);
      if (written && now?.nodes === state.nodes && now.messages === state.messages) latest.set(project.name, kept);
      return project.saved.write(project.name, kept);
    })
    .catch(() => undefined);
}

const scheduleSave = (): void => {
  if (!open?.saving) return;
  clearTimeout(timer);
  timer = setTimeout(saveNow, SAVE_DELAY_MS);
};
designNodesStore.listen(scheduleSave);
designMessagesStore.listen(scheduleSave);

/**
 * Shows `projectName`'s screens and chat, and saves every change to them after. The project's
 * `design.json` wins when this browser has no copy (a reinstall, Willow's storage cleared) or when
 * it differs from the text this browser last wrote (another copy of Willow changed it). A file that
 * can't be read leaves this session's changes unsaved rather than written over it. `fresh` is a
 * project just made, which has neither.
 */
export async function openDesignProjectState(
  projectName: string,
  folder: DesignFolder,
  { fresh = false, saved = designSaved }: { fresh?: boolean; saved?: DesignSaved } = {},
): Promise<void> {
  if (timer) saveNow();
  const current = ++generation;
  open = null;
  designProjectLoading.set(true);
  selectedDesignNodeIds.set([]);

  let state: SavedDesign = { nodes: [], messages: [] };
  let saving = true;
  const opened = latest.get(projectName);
  if (opened) state = opened;
  else if (!fresh) {
    const held = await saved.read(projectName).catch(() => null);
    if (held) state = held;
    try {
      const text = await folder.read(projectName, DESIGN_STATE_FILE);
      if (text !== null && text !== held?.file) {
        const parsed = parseDesignState(text);
        if (!parsed) throw new Error(`Design/${projectName}/${DESIGN_STATE_FILE} isn't a Design project's state`);
        state = { ...parsed, file: text };
      }
    } catch {
      saving = false;
    }
  }
  if (current !== generation) return;

  designNodesStore.set(state.nodes);
  designMessagesStore.set(state.messages);
  latest.set(projectName, state);
  open = { name: projectName, folder, saved, saving };
  designProjectLoading.set(false);
}
