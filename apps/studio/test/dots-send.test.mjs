/**
 * `send_file`: a bot sending the user a file or a picture — from their computer, its own, its workspace, or the screen
 * it last looked at — as a message of its own with the file on it, against stand-ins for both computers and for the
 * browser's storage. What it sends is kept whole, a picture comes back to the bot, and what holds secrets never goes.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

/** Just enough of IndexedDB for Spark's attachment payloads. Each transaction runs whole, in one turn. */
const memoryIndexedDB = () => {
  const databases = new Map();
  class Transaction {
    constructor(stores) {
      this.stores = stores;
      this.queue = [];
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
      const data = this.stores.get(name);
      return {
        put: (value, key) => this.request(() => { data.set(key, structuredClone(value)); return key; }),
        get: (key) => this.request(() => (data.has(key) ? structuredClone(data.get(key)) : undefined)),
        count: (key) => this.request(() => (data.has(key) ? 1 : 0)),
        delete: (key) => this.request(() => { data.delete(key); }),
      };
    }
  }
  return {
    open: (name) => {
      const request = { result: null, error: null };
      setImmediate(() => {
        const fresh = !databases.has(name);
        if (fresh) databases.set(name, new Map());
        const stores = databases.get(name);
        request.result = {
          objectStoreNames: { contains: (store) => stores.has(store) },
          createObjectStore: (store) => { stores.set(store, new Map()); },
          transaction: () => new Transaction(stores),
          close: () => {},
        };
        if (fresh) request.onupgradeneeded?.({ target: request });
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };
};
globalThis.indexedDB = memoryIndexedDB();
// The browser's FileReader, as far as Spark's storage reads a file: as a data URL.
globalThis.FileReader ??= class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onload?.({ target: this });
    }, (error) => {
      this.error = error;
      this.onerror?.({ target: this });
    });
  }
};

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (...parts) => path.join(repoRoot, 'features', 'spark', 'src', 'dots', 'harness', ...parts);
const store = await importTs(harness('thread', 'thread-store.ts'));
const { memoryPersistence } = await importTs(harness('thread', 'thread-persistence.ts'));
const { sendFileTool, typeOf } = await importTs(harness('tools', 'send-tools.ts'));
const { rememberScreen } = await importTs(harness('runtime', 'last-screen.ts'));
const { dotAttachmentData } = await importTs(harness('runtime', 'dot-attachments.ts'));
const render = await importTs(harness('memory', 'render.ts'));

store.setDotThreadPersistence(memoryPersistence());

const HOME = 'C:\\Users\\Sam';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).toString('base64');
let counter = 0;
const newDot = async () => {
  counter += 1;
  const dotId = `dot-send-${counter}`;
  await store.loadDotThread(dotId);
  return dotId;
};

const setup = async ({ theirs = {}, yours = {}, machineReady = true } = {}) => {
  const dotId = await newDot();
  const delivered = [];
  const env = {
    dotId, dotName: 'Pip', timeZone: 'UTC', now: () => Date.UTC(2026, 9, 14, 21, 20, 3), host: null, personalData: false,
    computer: {
      root: 'C:\\', shell: 'cmd.exe on Windows', whole: true, home: HOME,
      bridge: {
        readBytes: async (root, at, offset) => {
          const data = theirs[`${root}|${at}`];
          if (data === undefined) throw new Error('ENOENT: no such file');
          return { data, size: Buffer.from(data, 'base64').length, next: null, offset };
        },
      },
    },
    machine: {
      ready: machineReady,
      bridge: {
        call: async (_dotId, request) => {
          const data = yours[request.body.path];
          return data === undefined ? { status: 404, body: { error: 'No such file.' } } : { status: 200, body: { data, bytes: Buffer.from(data, 'base64').length, next: null } };
        },
      },
    },
    screen: { bridge: {}, deps: {}, platform: 'windows' },
  };
  const tool = sendFileTool(env).handler;
  const context = { turnId: 't1', readFiles: () => ({ '/notes/report.md': '# Report\n\nAll good.' }), delivered: (id) => delivered.push(id) };
  return { dotId, tool, context, delivered, doc: sendFileTool(env).doc };
};

it('sends a picture from the user\'s computer as a message of its own, kept whole, and shows the bot what it sent', async () => {
  const { dotId, tool, context, delivered, doc } = await setup({ theirs: { 'C:\\|Users/Sam/Downloads/cat.png': PNG } });
  assert.match(doc.description, /"theirs" for one on the user's computer/);
  assert.match(doc.description, /"screenshot" for the screen you last took a picture of/);
  const sent = await tool.run({ from: 'theirs', path: 'Downloads\\cat.png', message: 'Here it is.' }, context);
  assert.equal(sent.failed, undefined, sent.observation);
  assert.match(sent.observation, /^Sent C:\\Users\\Sam\\Downloads\\cat\.png to the user \(i\d+, 16 B\)\. It comes with this step's results\.$/);
  assert.deepEqual(sent.images, [{ type: 'image', mimeType: 'image/png', data: PNG }], 'the bot sees what it sent');
  const message = store.getDotThread(dotId).items.at(-1);
  assert.equal(message.kind, 'dot');
  assert.equal(message.text, 'Here it is.');
  assert.deepEqual(message.attachments.map(({ name, mimeType, size, type }) => ({ name, mimeType, size, type })), [{ name: 'cat.png', mimeType: 'image/png', size: 16, type: 'image' }]);
  assert.equal(await dotAttachmentData(message.attachments[0]), PNG, 'kept as it was');
  assert.deepEqual(delivered, [message.id], 'it goes out as the bot\'s messages do');
  assert.equal(render.renderOutput({ ...message, text: '' }), '', 'a file with no words is told by its call and result, not an empty message');
});

it('sends the screen it last looked at, a file from its own computer or its workspace, and never what holds secrets', async () => {
  const { dotId, tool, context } = await setup({ theirs: { 'C:\\|Users/Sam/.ssh/id_rsa': PNG }, yours: { 'reports/summary.pdf': Buffer.from('%PDF-1.7 report').toString('base64') } });
  assert.match((await tool.run({ from: 'screenshot' }, context)).observation, /^Take a screenshot first/);
  rememberScreen(dotId, { data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]).toString('base64'), mimeType: 'image/jpeg', width: 1920, height: 1080, of: 'the user\'s screen', at: Date.UTC(2026, 9, 14, 21, 20, 3) });
  const screen = await tool.run({ from: 'screenshot', message: 'Chrome, as it is now.' }, context);
  assert.match(screen.observation, /^Sent the screenshot of the user's screen to the user/);
  assert.equal(screen.images, undefined, 'the bot saw that screen already');
  assert.equal(store.getDotThread(dotId).items.at(-1).attachments[0].name, 'Screenshot 2026-10-14 at 21.20.03.jpg');

  const report = await tool.run({ from: 'yours', path: 'reports/summary.pdf' }, context);
  assert.match(report.observation, /^Sent reports\/summary\.pdf from your computer to the user/);
  assert.equal(store.getDotThread(dotId).items.at(-1).attachments[0].mimeType, 'application/pdf');
  const notes = await tool.run({ from: 'workspace', path: '/notes/report.md' }, context);
  assert.match(notes.observation, /^Sent \/notes\/report\.md from your workspace/);
  assert.equal(store.getDotThread(dotId).items.at(-1).attachments[0].mimeType, 'text/markdown');

  assert.match((await tool.run({ from: 'theirs', path: '.ssh/id_rsa' }, context)).observation, /holds secrets, so it is never sent/);
  assert.match((await tool.run({ from: 'yours', path: '/etc/passwd' }, context)).observation, /"path" is a file in your folder/);
  assert.match((await tool.run({ from: 'workspace', path: '/missing.md' }, context)).observation, /is not in your workspace/);
  assert.match((await tool.run({ from: 'somewhere' }, context)).observation, /^Say "from"/);
});

it('knows a picture by its first bytes, whatever its name says', () => {
  assert.equal(typeOf('photo', Buffer.from(PNG, 'base64')), 'image/png');
  assert.equal(typeOf('photo.png', Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(typeOf('notes.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(typeOf('unknown.xyz'), 'application/octet-stream');
});
