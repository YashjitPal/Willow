import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const files = await importTs(path.join(ROOT, 'platform/storage/src/local-fs/conversation-files.ts'));

const domError = (name) => Object.assign(new Error(name), { name });

/** Just enough of the File System Access API, in memory. `caseInsensitive` behaves like Windows. */
class MemoryFile {
  constructor(name) {
    this.kind = 'file';
    this.name = name;
    this.blob = new Blob([]);
  }
  async getFile() {
    return new File([this.blob], this.name, { type: this.blob.type });
  }
  async createWritable() {
    const chunks = [];
    return {
      write: async (data) => { chunks.push(data); },
      close: async () => { this.blob = new Blob(chunks); },
      abort: async () => {},
    };
  }
  async isSameEntry(other) {
    return other === this;
  }
}

class MemoryDir {
  constructor(name = '', { caseInsensitive = false } = {}) {
    this.kind = 'directory';
    this.name = name;
    this.caseInsensitive = caseInsensitive;
    this.entries = new Map();
  }
  key(name) {
    return this.caseInsensitive ? name.toLowerCase() : name;
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    const found = this.entries.get(this.key(name));
    if (found) {
      if (found.kind !== 'directory') throw domError('TypeMismatchError');
      return found;
    }
    if (!create) throw domError('NotFoundError');
    const dir = new MemoryDir(name, { caseInsensitive: this.caseInsensitive });
    this.entries.set(this.key(name), dir);
    return dir;
  }
  async getFileHandle(name, { create = false } = {}) {
    const found = this.entries.get(this.key(name));
    if (found) {
      if (found.kind !== 'file') throw domError('TypeMismatchError');
      return found;
    }
    if (!create) throw domError('NotFoundError');
    const file = new MemoryFile(name);
    this.entries.set(this.key(name), file);
    return file;
  }
  async removeEntry(name, { recursive = false } = {}) {
    const found = this.entries.get(this.key(name));
    if (!found) throw domError('NotFoundError');
    if (found.kind === 'directory' && found.entries.size && !recursive) throw domError('InvalidModificationError');
    this.entries.delete(this.key(name));
  }
  async *values() {
    for (const entry of [...this.entries.values()]) yield entry;
  }
  async isSameEntry(other) {
    return other === this;
  }
}

/** `{ "a/b.txt": "text" }` for everything under `dir`, with the names the entries carry. */
const tree = async (dir, prefix = '') => {
  const out = {};
  for await (const entry of dir.values()) {
    const at = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') Object.assign(out, await tree(entry, at));
    else out[at] = await (await entry.getFile()).text();
  }
  return out;
};

const textFile = (pathInside, text, extra = {}) => ({ path: pathInside, read: () => new Blob([text]), ...extra });

describe('the name a conversation file is kept as', () => {
  it('keeps the attachment’s own name, tagged with a hash of its id', () => {
    const name = files.conversationFileName('beach.JPG', 'attachment-1', 'image/jpeg');
    assert.match(name, /^beach \[[0-9a-f]{8}\]\.jpg$/);
    assert.equal(files.conversationFileName('beach.JPG', 'attachment-1'), name);
    assert.notEqual(files.conversationFileName('beach.JPG', 'attachment-2'), name);
  });

  it('takes an extension from the type when the name has none', () => {
    assert.match(files.conversationFileName('clipboard image', 'x', 'image/png'), /^clipboard image \[[0-9a-f]{8}\]\.png$/);
    assert.match(files.conversationFileName('', 'x', 'application/pdf'), /^attachment \[[0-9a-f]{8}\]\.pdf$/);
    assert.match(files.conversationFileName('notes.final draft', 'x', 'text/plain'), /^notes\.final draft \[[0-9a-f]{8}\]\.txt$/);
  });

  it('cannot produce a path, a reserved name or a name Windows would trim', () => {
    assert.equal(files.safeFileStem('a/b\\c:d*e?"f<g>h|i'), 'a b c d e f g h i');
    assert.equal(files.safeFileStem('NUL'), 'NUL_');
    assert.equal(files.safeFileStem('trailing... '), 'trailing');
    assert.equal(files.safeFileStem('   '), 'file');
    assert.ok(files.safeFileStem('x'.repeat(300)).length <= 80);
  });

  it('keys bytes that came without an id by their content', () => {
    assert.equal(files.contentKey('aGVsbG8='), files.contentKey('aGVsbG8='));
    assert.notEqual(files.contentKey('aGVsbG8='), files.contentKey('aGVsbG9='));
  });
});

describe('writing a conversation’s files', () => {
  it('puts them in a folder named after the conversation, beside it', async () => {
    const chats = new MemoryDir('Chats');
    const ok = await files.writeConversationFiles(chats, 'Trip ideas', [
      textFile('Attachments/beach [11111111].jpg', 'jpeg bytes'),
      textFile('Attachments/notes [22222222].txt', 'notes'),
    ]);
    assert.equal(ok, true);
    assert.deepEqual(await tree(chats), {
      'Trip ideas/Attachments/beach [11111111].jpg': 'jpeg bytes',
      'Trip ideas/Attachments/notes [22222222].txt': 'notes',
    });
  });

  it('never rewrites a file that is there, unless told to', async () => {
    const dir = new MemoryDir();
    await files.writeConversationFiles(dir, 'c', [textFile('Attachments/a.txt', 'first')]);
    let reads = 0;
    await files.writeConversationFiles(dir, 'c', [{ path: 'Attachments/a.txt', read: () => { reads += 1; return new Blob(['second']); } }]);
    assert.equal(reads, 0);
    await files.writeConversationFiles(dir, 'c', [textFile('Browser/steps.json', '[1]'), textFile('Browser/steps.json', '[1,2]', { replace: true })]);
    assert.equal((await tree(dir))['c/Browser/steps.json'], '[1,2]');
    assert.equal((await tree(dir))['c/Attachments/a.txt'], 'first');
  });

  it('remembers what it wrote, and retries what it could not', async () => {
    const dir = new MemoryDir();
    const known = new Set();
    let ready = false;
    const pending = { path: 'Attachments/late.png', read: () => (ready ? new Blob(['png']) : null) };
    assert.equal(await files.writeConversationFiles(dir, 'c', [textFile('Attachments/a.txt', 'a'), pending], known), false);
    assert.deepEqual([...known], ['Attachments/a.txt']);
    ready = true;
    assert.equal(await files.writeConversationFiles(dir, 'c', [textFile('Attachments/a.txt', 'a'), pending], known), true);
    assert.deepEqual([...known].sort(), ['Attachments/a.txt', 'Attachments/late.png']);
  });

  it('leaves no folder behind for bytes that never arrive', async () => {
    const chats = new MemoryDir('Chats');
    assert.equal(await files.writeConversationFiles(chats, 'Old chat', [{ path: 'Attachments/lost.png', read: () => null }]), false);
    assert.deepEqual([...chats.entries.keys()], []);
  });

  it('refuses a path that would leave the conversation’s folder', async () => {
    const dir = new MemoryDir();
    assert.equal(await files.writeConversationFiles(dir, 'c', [textFile('../escape.txt', 'x')]), false);
    assert.deepEqual(await tree(dir), {});
  });
});

describe('reading, moving and deleting them', () => {
  it('reads one back, and answers null for one that is gone', async () => {
    const dir = new MemoryDir();
    await files.writeConversationFiles(dir, 'c', [textFile('Attachments/a.txt', 'hello')]);
    assert.equal(await (await files.readConversationFile(dir, 'c', 'Attachments/a.txt')).text(), 'hello');
    assert.equal(await files.readConversationFile(dir, 'c', 'Attachments/missing.txt'), null);
    assert.equal(await files.readConversationFile(dir, 'nobody', 'Attachments/a.txt'), null);
  });

  it('follows a rename and a move between folders, leaving nothing behind', async () => {
    const root = new MemoryDir();
    const chats = await root.getDirectoryHandle('Chats', { create: true });
    const notebook = await root.getDirectoryHandle('Notebook', { create: true });
    await files.writeConversationFiles(chats, 'New chat', [textFile('Attachments/a.txt', 'a'), textFile('Browser/001 x.jpg', 'x')]);
    assert.equal(await files.moveConversationFolder(chats, 'New chat', chats, 'Trip ideas'), true);
    assert.equal(await files.moveConversationFolder(chats, 'Trip ideas', notebook, 'Trip ideas'), true);
    assert.deepEqual(await tree(root), {
      'Notebook/Trip ideas/Attachments/a.txt': 'a',
      'Notebook/Trip ideas/Browser/001 x.jpg': 'x',
    });
  });

  it('treats a conversation with no folder as already moved', async () => {
    const dir = new MemoryDir();
    assert.equal(await files.moveConversationFolder(dir, 'none', dir, 'other'), true);
    assert.deepEqual(await tree(dir), {});
  });

  it('survives a rename that only changes case on a case-insensitive disk', async () => {
    const chats = new MemoryDir('Chats', { caseInsensitive: true });
    await files.writeConversationFiles(chats, 'trip ideas', [textFile('Attachments/a.txt', 'a')]);
    assert.equal(await files.moveConversationFolder(chats, 'trip ideas', chats, 'Trip Ideas'), true);
    assert.deepEqual(await tree(chats), { 'Trip Ideas/Attachments/a.txt': 'a' });
  });

  it('deletes the whole folder, and is content when there was none', async () => {
    const dir = new MemoryDir();
    await files.writeConversationFiles(dir, 'c', [textFile('Attachments/a.txt', 'a')]);
    assert.equal(await files.deleteConversationFolder(dir, 'c'), true);
    assert.deepEqual(await tree(dir), {});
    assert.equal(await files.deleteConversationFolder(dir, 'c'), true);
  });
});
