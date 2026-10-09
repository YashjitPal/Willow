/**
 * A Code project's chats read back from `Code/<project>/Chat sessions/` into sessions,
 * for a copy of Willow whose browser storage no longer has them.
 *
 * The chats are written with the real writers (`splitChatFiles`, `saveProjectChatToDisk`,
 * `writeConversationFiles`) into an in-memory folder, read back with the real readers,
 * and stored through the real `updateCodeSessions` against a minimal in-memory IndexedDB.
 * The sidebar and provider wiring is asserted on the source.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importTs } from './ts-module.mjs';
import { memoryStorage, useStorage } from './memory-fs.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const source = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// `blobToBase64` reads through FileReader, which Node does not have.
globalThis.FileReader ??= class FileReader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(
      (buffer) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onload?.();
      },
      (error) => {
        this.error = error;
        this.onerror?.();
      },
    );
  }
};

const disk = await importTs(path.join(ROOT, 'platform/storage/src/local-fs/code-disk.ts'));
const conversationFiles = await importTs(path.join(ROOT, 'platform/storage/src/local-fs/conversation-files.ts'));
const chatFiles = await importTs(path.join(ROOT, 'features/code/src/workbench/chat-files.ts'));
const resume = await importTs(path.join(ROOT, 'features/code/src/workbench/resume-code-chat.ts'));
const restore = await importTs(path.join(ROOT, 'features/code/src/workbench/restore-project-chats.ts'));
const db = await importTs(path.join(ROOT, 'platform/storage/src/indexeddb/willow-db.ts'));

/* ------------------------------ in-memory folder ------------------------------ */

const domError = (name) => Object.assign(new Error(name), { name });
let clock = 1_000;

/** Bytes kept as a Blob, so binary attachments survive; every write moves `lastModified` on. */
class MemoryFile {
  constructor(name) {
    this.kind = 'file';
    this.name = name;
    this.blob = new Blob([]);
    this.mtime = clock++;
  }
  async getFile() {
    return new File([this.blob], this.name, { type: this.blob.type, lastModified: this.mtime });
  }
  async createWritable() {
    const chunks = [];
    return {
      write: async (data) => { chunks.push(data); },
      close: async () => { this.blob = new Blob(chunks); this.mtime = clock++; },
      abort: async () => {},
    };
  }
  async isSameEntry(other) {
    return other === this;
  }
}

/** Names compare without case, as Windows compares them. */
class MemoryDir {
  constructor(name = '') {
    this.kind = 'directory';
    this.name = name;
    this.entries = new Map();
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    const found = this.entries.get(name.toLowerCase());
    if (found) {
      if (found.kind !== 'directory') throw domError('TypeMismatchError');
      return found;
    }
    if (!create) throw domError('NotFoundError');
    const dir = new MemoryDir(name);
    this.entries.set(name.toLowerCase(), dir);
    return dir;
  }
  async getFileHandle(name, { create = false } = {}) {
    const found = this.entries.get(name.toLowerCase());
    if (found) {
      if (found.kind !== 'file') throw domError('TypeMismatchError');
      return found;
    }
    if (!create) throw domError('NotFoundError');
    const file = new MemoryFile(name);
    this.entries.set(name.toLowerCase(), file);
    return file;
  }
  async removeEntry(name, { recursive = false } = {}) {
    const found = this.entries.get(name.toLowerCase());
    if (!found) throw domError('NotFoundError');
    if (found.kind === 'directory' && found.entries.size && !recursive) throw domError('InvalidModificationError');
    this.entries.delete(name.toLowerCase());
  }
  async *values() {
    for (const entry of [...this.entries.values()]) yield entry;
  }
  async isSameEntry(other) {
    return other === this;
  }
}

const deps = (root, rename = (name) => name) => ({ getActiveHandle: async () => root, resolveCurrentProjectName: rename });

const sessionsDir = async (root, project) =>
  (await (await root.getDirectoryHandle('Code')).getDirectoryHandle(project)).getDirectoryHandle('Chat sessions');

/** What the sidebar's save does for a project chat (`saveLocalFSProjectChat`). */
const saveChat = async (root, project, chatId, messages) => {
  const { messages: diskMessages, files } = chatFiles.splitChatFiles(messages, { keepInline: false });
  assert.equal(await disk.saveProjectChatToDisk(deps(root), project, chatId, diskMessages), true);
  assert.equal(await conversationFiles.writeConversationFiles(await sessionsDir(root, project), chatId, files), true);
};

const writeRaw = async (dir, name, text) => {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writable.write(text);
  await writable.close();
};

/* ---------------------------------- fixtures ---------------------------------- */

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
// Bytes that are not text in any encoding: a mangled read cannot pass for these.
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x7f, 0x01]);
const pdfBytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xe2, 0xe3, 0xcf, 0xd3]);
const shotBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0xff]);
const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

const conversation = () => [
  {
    id: 'initial-prompt',
    role: 'user',
    content: 'Build a todo app like this mock',
    timestamp: 1_700_000_000_000,
    attachments: [
      { type: 'image', mimeType: 'image/png', data: b64(pngBytes), name: 'mock.png' },
      { type: 'text', mimeType: 'text/plain', data: 'Notes – ünïcödé ✓\nsecond line', name: 'notes.txt' },
      { type: 'file', mimeType: 'application/pdf', data: b64(pdfBytes), name: 'spec.pdf' },
    ],
  },
  {
    id: 'reply-1',
    role: 'assistant',
    content: 'Here is the app.',
    timestamp: 1_700_000_005_000,
    hasCodeChanges: true,
    isGenerating: false,
    filesSnapshot: { '/App.tsx': 'export default () => <ul />;', '/index.css': 'body { margin: 0 }' },
    steps: [
      { id: 'step-1', kind: 'text', text: 'Writing App.tsx' },
      { id: 'step-2', kind: 'image', caption: 'The preview', src: `data:image/png;base64,${b64(shotBytes)}` },
      { id: 'step-3', kind: 'image', caption: 'Annotated', src: `data:image/jpeg;base64,${b64(jpegBytes)}` },
    ],
  },
  { id: 'msg-3', role: 'user', content: 'Add a done filter', timestamp: 1_700_000_010_000 },
  {
    id: 'reply-2',
    role: 'assistant',
    content: 'Added.',
    timestamp: 1_700_000_015_000,
    hasCodeChanges: true,
    filesSnapshot: { '/App.tsx': 'export default () => <ul data-filter />;', '/index.css': 'body { margin: 0 }' },
  },
];

const otherChat = () => [
  { id: 'other-1', role: 'user', content: 'Add dark mode', timestamp: 1_700_000_100_000 },
  { id: 'other-2', role: 'assistant', content: 'Done.', timestamp: 1_700_000_101_000 },
];

/** A restored chat as a resumed inline one reads, but for the `file` its screenshots keep. */
const withoutStepFiles = (messages) => messages.map((message) => (
  message.steps ? { ...message, steps: message.steps.map(({ file: _file, ...step }) => step) } : message
));

const restoreFrom = async (root, project) => restore.readProjectChatSessions(await disk.readProjectChatsFromDisk(deps(root), project));

/* ----------------------------------- disk ------------------------------------ */

describe('reading a project chat back off disk', () => {
  it('brings back its messages, attachments, screenshots and revert checkpoints', async () => {
    const root = new MemoryDir();
    await saveChat(root, 'Todo', 'Todo app', conversation());
    const json = await (await (await (await sessionsDir(root, 'Todo')).getFileHandle('Todo app.json')).getFile()).text();
    assert.ok(!json.includes(b64(pngBytes)) && !json.includes(b64(shotBytes)), 'the project JSON names its files rather than holding them');

    const sessions = await restoreFrom(root, 'Todo');
    assert.equal(sessions.length, 1);
    const [session] = sessions;
    assert.deepEqual(withoutStepFiles(session.messages), resume.sanitizeResumedCodeMessages(conversation()));

    const [image, text, pdf] = session.messages[0].attachments;
    assert.deepEqual(Buffer.from(image.data, 'base64'), Buffer.from(pngBytes));
    assert.equal(text.data, 'Notes – ünïcödé ✓\nsecond line');
    assert.deepEqual(Buffer.from(pdf.data, 'base64'), Buffer.from(pdfBytes));
    assert.equal(session.messages[1].steps[1].src, `data:image/png;base64,${b64(shotBytes)}`);
    assert.equal(session.messages[1].steps[2].src, `data:image/jpeg;base64,${b64(jpegBytes)}`);
    assert.deepEqual(session.messages[1].filesSnapshot, conversation()[1].filesSnapshot);
    assert.equal(session.messages[1].isGenerating, undefined);

    assert.equal(session.name, 'Todo app');
    assert.match(session.id, /^session_1700000000000_[0-9a-f]{8}$/);
    assert.equal(session.createdAt, 1_700_000_000_000);
    assert.equal(session.updatedAt, 1_700_000_015_000);
    assert.deepEqual(session.filesSnapshot, conversation()[3].filesSnapshot);
    assert.equal(session.activeSnapshotId, null);
  });

  it('saved again, a restored chat names the same files instead of writing new ones', async () => {
    const root = new MemoryDir();
    await saveChat(root, 'Todo', 'Todo app', conversation());
    const [session] = await restoreFrom(root, 'Todo');
    const paths = (messages) => chatFiles.splitChatFiles(messages, { keepInline: false }).files.map((file) => file.path).sort();
    assert.deepEqual(paths(session.messages), paths(conversation()));
    assert.equal(paths(conversation()).length, 5);
  });

  it('a chat on disk once per screen that showed it comes back once, as its longest copy, under a name it had', async () => {
    const root = new MemoryDir();
    await saveChat(root, 'Todo', '2026-01-02T10-00-00_abc123', conversation());
    await saveChat(root, 'Todo', 'Todo app', conversation().slice(0, 2));
    await saveChat(root, 'Todo', 'Todo app builder', conversation().slice(0, 3));
    await saveChat(root, 'Todo', 'Dark mode', otherChat());

    const sessions = await restoreFrom(root, 'Todo');
    assert.deepEqual(sessions.map((session) => session.name), ['Dark mode', 'Todo app builder']);
    assert.equal(sessions[1].messages.length, 4);
    assert.deepEqual(Buffer.from(sessions[1].messages[0].attachments[0].data, 'base64'), Buffer.from(pngBytes));
  });

  it('a chat only ever on its generated id gets the placeholder the session naming looks for', async () => {
    const root = new MemoryDir();
    await saveChat(root, 'Todo', '2026-01-02T10-00-00_abc123', otherChat());
    const [session] = await restoreFrom(root, 'Todo');
    assert.equal(session.name, 'Initial Chat');
  });

  it('skips a Design chat and every file that is not a chat', async () => {
    const root = new MemoryDir();
    await saveChat(root, 'Todo', 'Todo app', conversation());
    await saveChat(root, 'Todo', 'Hero section', [
      { id: 'd1', role: 'user', content: 'A hero section', timestamp: 1_700_000_200_000 },
      { id: 'd2', role: 'assistant', content: 'Made it.', timestamp: 1_700_000_201_000, designNodeId: 'node-7' },
    ]);
    const dir = await sessionsDir(root, 'Todo');
    await writeRaw(dir, 'notes.json', '{"not":"a chat"}');
    await writeRaw(dir, 'broken.json', '{"unterminated');
    await writeRaw(dir, 'empty.json', JSON.stringify([{ id: 'e1', role: 'user', content: '   ', timestamp: 3 }]));
    await writeRaw(dir, 'readme.txt', JSON.stringify(otherChat()));
    await dir.getDirectoryHandle('Folder.json', { create: true });

    const chats = await disk.readProjectChatsFromDisk(deps(root), 'Todo');
    assert.deepEqual(chats.map((chat) => chat.chatId).sort(), ['broken', 'empty', 'Hero section', 'notes', 'Todo app'].sort());
    const sessions = await restore.readProjectChatSessions(chats);
    assert.deepEqual(sessions.map((session) => session.name), ['Todo app']);
  });

  it('drops an attachment whose file is gone, and keeps a screenshot step without its picture', async () => {
    const root = new MemoryDir();
    await saveChat(root, 'Todo', 'Todo app', conversation());
    const chatDir = await (await sessionsDir(root, 'Todo')).getDirectoryHandle('Todo app');
    await chatDir.removeEntry('Attachments', { recursive: true });
    await chatDir.removeEntry('Screenshots', { recursive: true });

    const [session] = await restoreFrom(root, 'Todo');
    assert.equal(session.messages.length, 4);
    assert.equal(session.messages[0].content, 'Build a todo app like this mock');
    assert.equal(session.messages[0].attachments, undefined);
    const shot = session.messages[1].steps[1];
    assert.equal(shot.src, undefined);
    assert.match(shot.file, /^Screenshots\/Screenshot \[[0-9a-f]{8}\]\.png$/);
    assert.deepEqual(session.messages[1].filesSnapshot, conversation()[1].filesSnapshot);
  });

  it('answers [] with no chats saved, null when the folder cannot be read, and creates nothing', async () => {
    const root = new MemoryDir();
    assert.deepEqual(await disk.readProjectChatsFromDisk(deps(root), 'Todo'), []);
    assert.equal(root.entries.size, 0);
    await (await (await root.getDirectoryHandle('Code', { create: true })).getDirectoryHandle('Todo', { create: true }))
      .getDirectoryHandle('Codebase', { create: true });
    assert.deepEqual(await disk.readProjectChatsFromDisk(deps(root), 'Todo'), []);
    assert.equal((await root.getDirectoryHandle('Code')).entries.get('todo').entries.has('chat sessions'), false);

    assert.equal(await disk.readProjectChatsFromDisk(deps(null), 'Todo'), null);

    await saveChat(root, 'Todo', 'Todo app', otherChat());
    const locked = new MemoryFile('locked.json');
    locked.getFile = async () => { throw domError('NotReadableError'); };
    (await sessionsDir(root, 'Todo')).entries.set('locked.json', locked);
    assert.equal(await disk.readProjectChatsFromDisk(deps(root), 'Todo'), null);
    assert.deepEqual(await restore.readProjectChatSessions(null), []);
  });

  it('follows a rename that is still moving the project', async () => {
    const root = new MemoryDir();
    await saveChat(root, 'New name', 'Todo app', otherChat());
    const chats = await disk.readProjectChatsFromDisk(deps(root, (name) => (name === 'Old name' ? 'New name' : name)), 'Old name');
    assert.deepEqual(chats.map((chat) => chat.chatId), ['Todo app']);
  });
});

/* -------------------------------- joinChatFiles -------------------------------- */

describe('joinChatFiles', () => {
  it('reads each named file once, leaves bytes it already holds, and keeps an entry whose file is missing', async () => {
    const blobs = {
      'Attachments/a [11111111].png': new Blob([pngBytes]),
      'Screenshots/Screenshot [22222222].webp': new Blob([shotBytes]),
    };
    const calls = [];
    const read = async (file) => {
      calls.push(file);
      if (file === 'Attachments/locked.png') throw domError('NotReadableError');
      return blobs[file] ?? null;
    };
    const messages = [
      {
        id: 'm1', role: 'user', content: 'a', timestamp: 1,
        attachments: [
          { type: 'image', mimeType: 'image/png', name: 'a.png', file: 'Attachments/a [11111111].png' },
          { type: 'image', mimeType: 'image/png', name: 'kept.png', data: 'AAAA', file: 'Attachments/kept [33333333].png' },
          { type: 'image', mimeType: 'image/png', name: 'gone.png', file: 'Attachments/gone [44444444].png' },
          { type: 'image', mimeType: 'image/png', name: 'locked.png', file: 'Attachments/locked.png' },
        ],
      },
      {
        id: 'm2', role: 'assistant', content: 'b', timestamp: 2,
        attachments: [{ type: 'image', mimeType: 'image/png', name: 'a.png', file: 'Attachments/a [11111111].png' }],
        steps: [
          { id: 's1', kind: 'image', caption: '', file: 'Screenshots/Screenshot [22222222].webp' },
          { id: 's2', kind: 'text', text: 'hi' },
        ],
      },
    ];

    const joined = await chatFiles.joinChatFiles(messages, read);
    assert.deepEqual(calls.sort(), [
      'Attachments/a [11111111].png',
      'Attachments/gone [44444444].png',
      'Attachments/locked.png',
      'Screenshots/Screenshot [22222222].webp',
    ]);
    assert.equal(joined[0].attachments[0].data, b64(pngBytes));
    assert.equal(joined[0].attachments[1].data, 'AAAA');
    assert.equal(joined[0].attachments[2].data, undefined);
    assert.equal(joined[0].attachments[2].file, 'Attachments/gone [44444444].png');
    assert.equal(joined[0].attachments[3].data, undefined);
    assert.equal(joined[1].attachments[0].data, b64(pngBytes));
    assert.equal(joined[1].steps[0].src, `data:image/webp;base64,${b64(shotBytes)}`);
    assert.equal(joined[1].steps[1], messages[1].steps[1]);
    assert.equal(messages[0].attachments[0].data, undefined, 'the messages passed in are not changed');
  });
});

/* ------------------------------ withRestoredChats ------------------------------ */

const restoredRoot = new MemoryDir();
await saveChat(restoredRoot, 'Todo', 'Todo app', conversation());
await saveChat(restoredRoot, 'Todo', 'Dark mode', otherChat());
const [darkMode, todo] = await restoreFrom(restoredRoot, 'Todo');

describe('withRestoredChats', () => {
  it('stores every restored chat when nothing is stored, and nothing when there is none', () => {
    assert.deepEqual(restore.withRestoredChats(null, [darkMode, todo]), [darkMode, todo]);
    assert.equal(restore.withRestoredChats(null, []), null);
  });

  it('never replaces or repeats a chat the browser has, even one it has carried further', () => {
    const browsers = { id: 'session_browser', name: 'Mine', messages: [...conversation(), { id: 'msg-5', role: 'user', content: 'More', timestamp: 1_700_000_020_000 }] };
    const merged = restore.withRestoredChats([browsers], [darkMode, todo]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0], browsers);
    assert.equal(merged[1], darkMode);
    assert.equal(restore.withRestoredChats([browsers, darkMode], [darkMode, todo]), null);
  });

  it('adds one chat once, even when it is restored twice', () => {
    const fresh = { id: 'session_new', name: 'New Chat', messages: [] };
    assert.deepEqual(restore.withRestoredChats([fresh], [todo, todo]), [fresh, todo]);
  });
});

/* -------------------------- storing through IndexedDB -------------------------- */

/** Just enough of IndexedDB for the code-session store. Each transaction runs whole, in one turn. */
const memoryIndexedDB = () => {
  const stores = new Map();
  let writes = 0;
  class Transaction {
    constructor() {
      this.queue = [];
      this.error = null;
      setImmediate(() => {
        while (this.queue.length) this.queue.shift()();
        this.oncomplete?.();
      });
    }
    request(op) {
      const request = { result: undefined, error: null };
      this.queue.push(() => {
        request.result = op();
        request.onsuccess?.({ target: request });
      });
      return request;
    }
    objectStore(name) {
      const data = stores.get(name);
      return {
        put: (value, key) => this.request(() => { writes += 1; data.set(key, structuredClone(value)); return key; }),
        get: (key) => this.request(() => (data.has(key) ? structuredClone(data.get(key)) : undefined)),
        delete: (key) => this.request(() => { data.delete(key); }),
        openCursor: (range) => {
          const keys = [...data.keys()].filter((key) => !range || (key >= range.lower && key <= range.upper)).sort();
          const request = { result: null, error: null };
          let at = -1;
          const advance = () => this.queue.push(() => {
            at += 1;
            const key = keys[at];
            request.result = at < keys.length
              ? { key, value: structuredClone(data.get(key)), delete: () => { data.delete(key); }, continue: advance }
              : null;
            request.onsuccess?.({ target: request });
          });
          advance();
          return request;
        },
      };
    }
  }
  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name) => { stores.set(name, new Map()); },
    transaction: () => new Transaction(),
    close: () => {},
  };
  return {
    stores,
    get writes() { return writes; },
    open: () => {
      const request = { result: null, error: null };
      setImmediate(() => {
        request.result = database;
        if (stores.size === 0) request.onupgradeneeded?.({ target: request });
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };
};

const idb = memoryIndexedDB();
globalThis.indexedDB = idb;
globalThis.IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) };
useStorage(memoryStorage());
const scope = 'user-1::folder-1::My Willow';
db.setCodeSessionStorageScope(scope);
const physical = (key) => `scope:${encodeURIComponent(scope)}:code-session:${key}`;

const typed = {
  id: 'session_typed',
  name: 'New Chat',
  messages: [{ id: 'typed-1', role: 'user', content: 'Typed while the folder was read', timestamp: 1_700_000_300_000 }],
  filesSnapshot: {},
  activeSnapshotId: null,
  createdAt: 1_700_000_300_000,
  updatedAt: 1_700_000_300_000,
};

describe('storing restored chats', () => {
  it('stores them like any session: checkpoints deduplicated into code_blobs, read back whole', async () => {
    const key = 'willow_chat_sessions_Todo';
    assert.equal(await db.loadCodeSessions(key), null);
    const stored = await db.updateCodeSessions(key, (current) => restore.withRestoredChats(current, [todo]));
    assert.deepEqual(stored, [todo]);

    const raw = idb.stores.get('code_sessions').get(physical(key));
    assert.ok(raw[0].messages[1].filesSnapshot.__refs, 'per-message checkpoints are stored as references');
    const blobs = [...idb.stores.get('code_blobs').keys()].filter((blobKey) => blobKey.startsWith(`${physical(key)}\u0000`));
    assert.equal(blobs.length, 3, 'one blob per distinct file content across every checkpoint');
    assert.deepEqual(await db.loadCodeSessions(key), [todo]);
  });

  it('hands the update what a save queued before it left, so a session typed during the read is kept', async () => {
    const key = 'willow_chat_sessions_Race';
    let seen;
    const saving = db.saveCodeSessions(key, [typed]);
    const restoring = db.updateCodeSessions(key, (current) => {
      seen = current;
      return restore.withRestoredChats(current, [todo]);
    });
    await saving;
    assert.deepEqual((await restoring).map((session) => session.id), ['session_typed', todo.id]);
    assert.deepEqual(seen, [typed]);
    assert.deepEqual((await db.loadCodeSessions(key)).map((session) => session.id), ['session_typed', todo.id]);
  });

  it('lets a save queued after it land after it', async () => {
    const key = 'willow_chat_sessions_Later';
    const restoring = db.updateCodeSessions(key, (current) => restore.withRestoredChats(current, [todo]));
    const saving = db.saveCodeSessions(key, [typed]);
    await Promise.all([restoring, saving]);
    assert.deepEqual((await db.loadCodeSessions(key)).map((session) => session.id), ['session_typed']);
  });

  it('writes nothing when the update leaves the sessions as they are', async () => {
    const key = 'willow_chat_sessions_Kept';
    await db.saveCodeSessions(key, [typed]);
    const before = idb.writes;
    assert.deepEqual(await db.updateCodeSessions(key, () => null), [typed]);
    assert.equal(idb.writes, before);
  });

  it('works in the scope that is active, which the getter reports', async () => {
    assert.equal(db.getCodeSessionStorageScope(), scope);
    db.setCodeSessionStorageScope('user-2::folder-1::My Willow');
    try {
      assert.equal(await db.loadCodeSessions('willow_chat_sessions_Todo'), null);
    } finally {
      db.setCodeSessionStorageScope(scope);
    }
    db.setCodeSessionStorageScope('');
    assert.equal(db.getCodeSessionStorageScope(), 'signed-out::browser::My Willow');
    db.setCodeSessionStorageScope(scope);
  });
});

/* ----------------------------------- wiring ----------------------------------- */

describe('wiring', () => {
  it('the sidebar restores only a project with nothing stored, opened rather than started or resumed, in the scope it read', () => {
    const sidebar = source('features/code/src/workbench/WorkbenchSidebar.tsx');
    const start = sidebar.indexOf('const sessionScope = getCodeSessionStorageScope();');
    const end = sidebar.indexOf('if (parsed && parsed.length > 0) {');
    assert.ok(start > 0 && end > start, 'the restore sits between reading the bucket and using it');
    const load = sidebar.slice(start, end);
    assert.match(load, /let parsed = \(await loadCodeSessions\(storageKey\)\) as ChatSession\[\] \| null;/);
    assert.match(load, /if \(parsed === null && projectName && isLocalFolderConnected && !prompt && !resumeChatId && messages\.length === 0\) \{/);
    assert.match(load, /const restored = await readProjectChatSessions\(await loadLocalFSProjectChats\(projectName\)\);\s*if \(cancelled\) return;/);
    assert.match(load, /if \(restored\.length > 0 && getCodeSessionStorageScope\(\) === sessionScope\) \{\s*parsed = \(await updateCodeSessions\(storageKey, \(stored\) => withRestoredChats\(stored, restored\)\)\)/);
    assert.match(load, /\} catch \{\}\s*if \(cancelled\) return;\s*\}\s*$/);
    assert.match(sidebar, /\}, \[projectName, prompt, chatScopeId, isLocalFolderConnected, loadLocalFSProject, loadLocalFSProjectChats, loadLatestProject, onProjectHydrated\]\);/);
  });

  it('the provider reads the folder in the project queue, and not for a project deleted here', () => {
    const context = source('platform/storage/src/local-fs/LocalFSContext.tsx');
    const reader = /const loadLocalFSProjectChats = useCallback\([\s\S]*?\}, \[getActiveHandle, resolveCurrentProjectName, runInProjectQueue\]\);/.exec(context)?.[0];
    assert.ok(reader, 'loadLocalFSProjectChats is defined');
    assert.match(reader, /runInProjectQueue<ProjectChatOnDisk\[\] \| null>\(projectName, null,/);
    assert.match(reader, /if \(isProjectSaveBlocked\(queueKey, scopeId\)\) return null;/);
    assert.match(reader, /readProjectChatsFromDisk\(\{ getActiveHandle, resolveCurrentProjectName \}, queueKey\)/);
    assert.match(reader, /return chatScopeIdRef\.current === scopeId \? chats : null;/);
    assert.match(context, /\n\s+loadLocalFSProjectChats,\r?\n/);
  });
});
