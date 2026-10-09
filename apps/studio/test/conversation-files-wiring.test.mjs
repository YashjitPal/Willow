import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('a Code chat’s files', async () => {
  const { splitChatFiles } = await importTs(path.join(ROOT, 'features/code/src/workbench/chat-files.ts'));
  const png = Buffer.from('fake png bytes').toString('base64');
  const shot = `data:image/png;base64,${Buffer.from('annotated').toString('base64')}`;
  const messages = [
    {
      id: 'u1',
      role: 'user',
      attachments: [
        { type: 'image', mimeType: 'image/png', data: png, name: 'logo.png' },
        { type: 'text', mimeType: 'text/plain', data: 'hello there', name: 'notes.txt' },
      ],
    },
    { id: 'a1', role: 'assistant', steps: [{ id: 's1', kind: 'image', origin: 'annotation', src: shot, caption: 'Header' }] },
    { id: 'u2', role: 'user', attachments: [{ type: 'image', mimeType: 'image/png', data: png, name: 'logo.png' }] },
  ];

  it('moves the bytes out of a project chat’s JSON into files it names', async () => {
    const { messages: disk, files } = splitChatFiles(messages, { keepInline: false });
    const [logo, notes] = disk[0].attachments;
    assert.equal(logo.data, undefined);
    assert.match(logo.file, /^Attachments\/logo \[[0-9a-f]{8}\]\.png$/);
    assert.match(notes.file, /^Attachments\/notes \[[0-9a-f]{8}\]\.txt$/);
    assert.equal(disk[1].steps[0].src, undefined);
    assert.match(disk[1].steps[0].file, /^Screenshots\/Screenshot \[[0-9a-f]{8}\]\.png$/);
    // The same bytes sent twice are one file.
    assert.equal(disk[2].attachments[0].file, logo.file);
    assert.equal(files.length, 3);
    const byPath = Object.fromEntries(await Promise.all(files.map(async (file) => [file.path, Buffer.from(await (await file.read()).arrayBuffer()).toString()])));
    assert.equal(byPath[logo.file], 'fake png bytes');
    assert.equal(byPath[notes.file], 'hello there');
    assert.equal(byPath[disk[1].steps[0].file], 'annotated');
    // The chat the app holds is untouched.
    assert.equal(messages[0].attachments[0].data, png);
  });

  it('keeps the bytes of a chat that is read back from its JSON, and names its files too', () => {
    const { messages: inbox, files } = splitChatFiles(messages, { keepInline: true });
    assert.equal(inbox[0].attachments[0].data, png);
    assert.match(inbox[0].attachments[0].file, /^Attachments\//);
    assert.equal(inbox[1].steps[0].src, shot);
    assert.equal(files.length, 3);
  });

  it('is written beside the chat by both the inbox and the project saves', () => {
    const sidebar = read('features/code/src/workbench/WorkbenchSidebar.tsx');
    assert.match(sidebar, /splitChatFiles\(\s*messages\.map\(\(message\) => \(\{ \.\.\.message, willowMode: 'code' \}\)\),\s*\{ keepInline: true \},\s*\)/);
    assert.match(sidebar, /saveLocalFSChat\(activeId, inboxMessages, codeChatTitle \? codeChatSessionId : null, files, \{ openInChat: false \}\)/);
    assert.match(sidebar, /saveLocalFSProjectChat\(projectName, activeId, diskMessages, codeChatTitle \? codeChatSessionId : null, files\)/);
    assert.match(sidebar, /saveLocalFSProjectChat\(projectName, activeId, diskMessages, designChatTitle \? designChatSessionId : null, files\)/);
  });
});

describe('Chat’s attachments on disk', () => {
  const context = read('platform/storage/src/local-fs/LocalFSContext.tsx');

  it('writes each attachment a saved chat points at into the chat’s folder', () => {
    assert.match(context, /export const chatAttachmentPath = [^;]*`\$\{CONVERSATION_FOLDERS\.attachments\}\/\$\{conversationFileName\(attachment\.name, attachment\.id, attachment\.mimeType\)\}`/);
    assert.match(context, /read: async \(\) => \(await loadChatAttachment\(attachment\.id, scope\)\.catch\(\(\) => null\)\)\?\.blob \?\? null/);
    assert.match(context, /await mirrorChatAttachments\(targetDir, notebookId, chatId, messages, files\);/);
  });

  it('carries the folder through every rename and move, and removes it with the chat', () => {
    // temp id -> title, inside saveLocalFSChat
    assert.match(context, /previousId && previousDir && await moveConversationFolder\(previousDir, previousId, targetDir, chatId\)/);
    // renameLocalFSChat
    assert.match(context, /await moveConversationFolder\(chatsDir, oldChatId, chatsDir, newChatId\)/);
    // filing into / out of a notebook, and the reconciler finishing an interrupted one
    assert.match(context, /await moveConversationFolder\(fromDir, chatId, toDir, chatId\)/);
    assert.match(context, /await moveConversationFolder\(disk\.dir, chatId, targetDir, chatId\)/);
    // delete, and the tombstone sweep: folder first, so a failed file removal retries both — and
    // both into the Recycle Bin, not erased
    assert.match(context, /await deleteConversationFolder\(chatsDir, chatId, bin\);\s*await moveToRecycleBin\(bin, chatsDir, `\$\{chatId\}\.json`\);/);
    assert.match(context, /await deleteConversationFolder\(disk\.dir, chatId, bin\);\s*await moveToRecycleBin\(bin, disk\.dir, `\$\{chatId\}\.json`\);/);
  });

  it('reads one back from the folder when the browser’s copy is gone, and keeps it again', () => {
    assert.match(context, /if \(stored \|\| !source\?\.chatId\) return stored;\s*const blob = await readChatAttachmentFromDisk\(source\.chatId, source\.attachment\)/);
    assert.match(context, /try \{ await saveChatAttachment\(attachment, blob, chatStorageScopeRef\.current\); \} catch \{\}/);
    const view = read('features/chat/src/ChatView.tsx');
    assert.match(view, /restoreSavedChatMessage\(\s*m,\s*await hydrateSavedAttachments\(m\.attachments, activeChatId\),?\s*\)/);
    assert.match(view, /if \(!blob\) return attachment\.kind === 'github' \? attachment : \{ \.\.\.attachment, unavailable: true \};/);
  });

  it('writes the attachments of chats saved before this, once, in the background', () => {
    assert.match(context, /const marker = `willow_conversation_files_backfill:v1:\$\{scopeId\}`;/);
    assert.match(context, /await enqueueChatOperation\(\[chatId\], async \(\) => \{\s*if \(chatSyncRecordsRef\.current\[chatId\]\?\.tombstone\) return;\s*const body = await loadChatBody/);
  });

  it('never persists the runtime-only flag', async () => {
    const attachments = await importTs(path.join(ROOT, 'platform/core/src/attachments.ts'));
    const persisted = attachments.toPersistedChatAttachment({ id: 'a', kind: 'image', name: 'a.png', extension: 'png', mimeType: 'image/png', size: 1, url: 'blob:x', unavailable: true });
    assert.equal('unavailable' in persisted, false);
    assert.equal('url' in persisted, false);
    const blob = attachments.base64ToBlob(`data:text/plain;base64,${Buffer.from('ok').toString('base64')}`, 'text/plain');
    assert.equal(await blob.text(), 'ok');
  });

  it('draws a missing one as a quiet tile, never the broken-image icon', () => {
    const card = read('platform/ui/src/GeminiAttachmentCard.tsx');
    assert.match(card, /if \(attachment\.unavailable \|\| failed\) \{/);
    assert.match(card, />Unavailable<\/span>/);
    assert.match(card, /onError=\{\(\) => setFailed\(true\)\}/);
  });
});

describe('the other areas’ conversations', () => {
  const context = read('platform/storage/src/local-fs/LocalFSContext.tsx');

  it('lets a feature write only into a folder it registered', () => {
    assert.match(context, /const registered = getSyncedFolders\(\)\.some\(\(descriptor\) => descriptor\.folder\.toLowerCase\(\) === folder\.toLowerCase\(\)\);\s*if \(!registered\) return null;/);
  });

  it('writes into a project folder only through the project’s queue', () => {
    assert.match(context, /await runInProjectQueue<void>\(projectName, undefined, async \(queueKey\) => \{/);
    assert.match(context, /const saveLocalFSMediaAgentSession = useCallback\([^)]*\): Promise<boolean> => \(\s*runInProjectQueue\(projectName, false,/);
  });

  it('keeps Media agent chats in a folder the media reconcile never adopts as a collection', async () => {
    const collections = await importTs(path.join(ROOT, 'platform/storage/src/media-collections.ts'));
    assert.equal(collections.MEDIA_AGENT_SESSIONS_FOLDER, 'Agent sessions');
    assert.ok(collections.RESERVED_PROJECT_FOLDERS.has('agent sessions'));
    assert.equal(collections.collectionFolderName('Agent sessions', []), 'Agent sessions (1)');
  });

  it('names a Media upload’s file when it is sent, so it survives a reload', () => {
    const agent = read('features/media/src/agent/agent-session.ts');
    assert.match(agent, /\.\.\.\(att\.file\s*\? \{ file: `\$\{CONVERSATION_FOLDERS\.attachments\}\/\$\{conversationFileName\(att\.name, contentKey\(parsed\.data\), parsed\.mimeType\)\}` \}/);
    assert.match(agent, /\.\.\.\(file \? \{ file \} : \{\}\),/);
    assert.match(agent, /void host\.saveSessionToDisk\?\.\(session, files\)/);
    assert.match(agent, /void host\.deleteSessionFromDisk\?\.\(id\)/);
  });
});
