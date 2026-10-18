/**
 * Gemini's Library (`/library` and `/library/documents`): what it lists out of Willow's chats, how
 * it pages, deletes and opens items, and the looks measured from Gemini at 1536×826, 800×1280 and
 * 390×844 and read out of its island's source (tools/ui-research/captures/gemini/library/).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const DIR = 'features/chat/src/library-page';
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\})\\s*${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
};

const css = stripComments(read(`${DIR}/library.css`));
const page = read(`${DIR}/LibraryPage.tsx`);
const overlays = read(`${DIR}/LibraryOverlays.tsx`);
const tile = read(`${DIR}/LibraryTile.tsx`);
const lightbox = read(`${DIR}/LibraryLightbox.tsx`);
const app = read('apps/studio/src/app/App.tsx');
const sidebar = read('apps/studio/src/shell/sidebar/Sidebar.tsx');
const layout = read('apps/studio/src/shell/StudioLayout.tsx');
const chatView = read('features/chat/src/ChatView.tsx');
const generatedImage = read('features/chat/src/media/GeneratedImage.tsx');

const items = await importTs(path.join(ROOT, DIR, 'library-items.ts'));
const { LibraryScanner, forgetLibraryChat } = await importTs(path.join(ROOT, DIR, 'library-scan.ts'));
const open = await importTs(path.join(ROOT, DIR, 'library-open.ts'));

const attachment = (id, mimeType = 'image/png') => ({ id, name: `${id}.bin`, mimeType, size: 1 });

describe('what the Library lists', () => {
  it('folds a canvas into one document however many turns rewrote it: last title, latest time, last writer', () => {
    const { documents } = items.libraryItemsFromChat('Chat A', [
      { id: 'u1', role: 'user', canvasRefs: [{ docId: 'mine', content: 'x', title: 'Never listed' }] },
      { id: 'a1', role: 'assistant', canvasRefs: [{ docId: 'd1', kind: 'code', title: 'First', content: '<p>', createdAt: 100 }] },
      { id: 'a2', role: 'assistant', canvasRefs: [{ docId: 'd1', kind: 'code', title: 'Second', content: '<p>2', createdAt: 50, editedAt: 300 }] },
      { id: 'a3', role: 'assistant', canvasRefs: [{ docId: 'd2', kind: 'text', title: '  ', content: '# Hi' }, { docId: 'empty', content: '' }] },
    ], 42);
    assert.deepEqual(
      documents.map((d) => [d.key, d.docId, d.kind, d.title, d.updatedAt, d.messageId]),
      [
        ['Chat A\u0000canvas\u0000d1', 'd1', 'code', 'Second', 300, 'a2'],
        ['Chat A\u0000canvas\u0000d2', 'd2', 'text', 'Untitled document', 42, 'a3'],
      ],
    );
  });

  it('lists a Deep Research run once its report exists, dated when it finished', () => {
    const { documents } = items.libraryItemsFromChat('C', [
      { id: 'r1', role: 'assistant', research: { status: 'done', title: 'Bikes', report: '# R', startedAt: 10, finishedAt: 20 } },
      { id: 'r2', role: 'assistant', research: { status: 'running', title: 'Not yet', report: '' } },
      { id: 'r3', role: 'assistant', research: { status: 'done', title: 'No report', report: '' } },
    ]);
    assert.deepEqual(documents.map((d) => [d.kind, d.title, d.updatedAt, d.messageId, d.docId]), [['research', 'Bikes', 20, 'r1', undefined]]);
  });

  it('takes media once it is done, with what each tile shows: the image, a track’s cover, a video’s own frame', () => {
    const image = attachment('img');
    const { media } = items.libraryItemsFromChat('C', [{
      id: 'a',
      role: 'assistant',
      media: [
        { id: 'm1', kind: 'image', status: 'done', attachment: image, prompt: 'cat', createdAt: 5 },
        { id: 'm2', kind: 'music', status: 'done', attachment: attachment('trk', 'audio/mpeg'), cover: attachment('cov'), title: ' Song ', createdAt: 6 },
        { id: 'm3', kind: 'video', status: 'done', attachment: attachment('vid', 'video/mp4') },
        { id: 'm4', kind: 'image', status: 'generating', attachment: image },
        { id: 'm5', kind: 'image', status: 'done' },
        { id: 'm6', kind: 'audio', status: 'done', attachment: image },
      ],
    }], 99);
    assert.deepEqual(
      media.map((m) => [m.mediaId, m.kind, m.title, m.thumbnail?.id, m.file.id, m.createdAt, m.messageId]),
      [['m1', 'image', '', 'img', 'img', 5, 'a'], ['m2', 'music', 'Song', 'cov', 'trk', 6, 'a'], ['m3', 'video', '', 'vid', 'vid', 99, 'a']],
    );
  });

  it('orders newest first, and equal times by key so a page never reshuffles', () => {
    assert.deepEqual(items.sortDocuments([{ key: 'b', updatedAt: 1 }, { key: 'a', updatedAt: 1 }, { key: 'c', updatedAt: 5 }]).map((d) => d.key), ['c', 'a', 'b']);
    assert.deepEqual(items.sortMedia([{ key: 'b', createdAt: 1 }, { key: 'a', createdAt: 1 }, { key: 'c', createdAt: 5 }]).map((d) => d.key), ['c', 'a', 'b']);
  });

  it('uses Gemini’s glyphs and labels', () => {
    assert.deepEqual(['code', 'text', 'research'].map(items.documentIcon), ['code', 'article', 'deep_research']);
    assert.deepEqual(['image', 'video', 'music'].map(items.mediaBadgeIcon), [null, 'videocam', 'music_note']);
    assert.deepEqual(['image', 'video', 'music'].map(items.mediaTypeIcon), ['image_create', 'videocam', 'music_note']);
    assert.equal(items.mediaTitle({ title: '' }), 'Untitled');
    assert.equal(items.mediaTitle({ title: 'Past the County Line' }), 'Past the County Line');
  });

  it('dates rows as Gemini’s shortDateTime does, in the language it is given', () => {
    const midday = Date.UTC(2026, 9, 15, 12, 0);
    assert.match(items.formatLibraryDate(midday, 'en-US'), /^Oct 1[456], \d{1,2}:\d{2}\s[AP]M$/);
    assert.match(items.formatLibraryDate(midday, 'en-IN'), /^1[456] Oct, \d{1,2}:\d{2}\s[ap]m$/);
    assert.equal(items.formatLibraryDate(0), '');
  });

  it('names a download after the track or the prompt, with the file’s extension', () => {
    assert.equal(items.mediaFileName({ title: '', prompt: 'A cat: on/a mat?', kind: 'image', file: { extension: 'png', mimeType: 'image/png' } }), 'A cat on a mat.png');
    assert.equal(items.mediaFileName({ title: 'Song', prompt: 'x', kind: 'music', file: { extension: 'mp3', mimeType: 'audio/mpeg' } }), 'Song.mp3');
    assert.equal(items.mediaFileName({ title: '', prompt: '', kind: 'video', file: { mimeType: 'video/mp4' } }), 'Generated video.mp4');
  });

  it('deletes one item from its message, and writes nothing when it is already gone', () => {
    const messages = [
      { id: 'u', role: 'user' },
      { id: 'a', role: 'assistant', content: 'x', media: [{ id: 'm1' }, { id: 'm2' }] },
      { id: 'b', role: 'assistant', media: [{ id: 'm3' }] },
    ];
    const next = items.withoutMedia(messages, 'a', 'm1');
    assert.deepEqual(next[1], { id: 'a', role: 'assistant', content: 'x', media: [{ id: 'm2' }] });
    assert.equal(next[0], messages[0], 'other messages are passed through as they are');
    assert.equal(next[2], messages[2]);
    assert.equal('media' in items.withoutMedia(messages, 'b', 'm3')[2], false, 'the last one takes the list with it');
    assert.equal(items.withoutMedia(messages, 'a', 'gone'), null);
    assert.equal(items.withoutMedia(messages, 'b', 'm1'), null, 'only the message it came from');
    assert.equal(messages[1].media.length, 2, 'the saved messages are not changed in place');
  });

  it('pages as Gemini does: three documents on the overview, thirty to a page', () => {
    assert.equal(items.DOCUMENTS_PREVIEW, 3);
    assert.equal(items.LIBRARY_PAGE_SIZE, 30);
  });
});

describe('reading the chats a page at a time', () => {
  /** `count` chats of `perChat` images each, the first chat newest. */
  const library = (count, perChat = 5) => {
    const chats = Array.from({ length: count }, (_, c) => `chat ${c}`);
    const bodies = new Map(chats.map((chatId, c) => [chatId, [{
      id: `a${c}`,
      role: 'assistant',
      media: Array.from({ length: perChat }, (_, m) => ({ id: `m${c}-${m}`, kind: 'image', status: 'done', attachment: attachment(`f${c}-${m}`), createdAt: 1_000_000 - (c * perChat + m) })),
    }]]));
    return { chats, bodies };
  };
  let scopes = 0;
  const scope = () => `test scope ${scopes += 1}`;

  it('reads four chats at a time and stops once the page is full', async () => {
    const { chats, bodies } = library(14);
    const reads = [];
    const scanner = new LibraryScanner(chats, scope(), async (chatId) => { reads.push(chatId); return bodies.get(chatId); }, () => 1);
    await scanner.scan((s) => s.media.length >= 30);
    assert.deepEqual(reads, chats.slice(0, 8));
    assert.equal(scanner.media.length, 40);
    assert.equal(scanner.done, false);
    await scanner.scan((s) => s.media.length >= 90);
    assert.equal(reads.length, 14);
    assert.equal(scanner.done, true);
  });

  it('orders the first page, then appends each later page in order, so tiles on screen never move', async () => {
    const { chats, bodies } = library(8);
    // The last chat holds the newest item of all.
    bodies.get('chat 7')[0].media[0].createdAt = 2_000_000;
    const scanner = new LibraryScanner(chats, scope(), async (chatId) => bodies.get(chatId), () => 1);
    await scanner.scan((s) => s.media.length >= 20);
    scanner.settle();
    const firstPage = scanner.media.map((m) => m.mediaId);
    assert.deepEqual(firstPage.slice(0, 2), ['m0-0', 'm0-1']);
    await scanner.scan(() => false);
    assert.deepEqual(scanner.media.slice(0, 20).map((m) => m.mediaId), firstPage);
    assert.equal(scanner.media[20].mediaId, 'm7-0', 'the next page is in order within itself');
  });

  it('keeps each chat’s items for the session against its timestamp', async () => {
    const { chats, bodies } = library(4);
    const where = scope();
    const stamps = new Map(chats.map((chatId) => [chatId, 1]));
    const reads = [];
    const readChat = async (chatId) => { reads.push(chatId); return bodies.get(chatId); };
    await new LibraryScanner(chats, where, readChat, (chatId) => stamps.get(chatId)).scan(() => false);
    assert.equal(reads.length, 4);
    await new LibraryScanner(chats, where, readChat, (chatId) => stamps.get(chatId)).scan(() => false);
    assert.equal(reads.length, 4, 'nothing changed, nothing read');
    stamps.set('chat 2', 2);
    forgetLibraryChat(where, 'chat 0');
    await new LibraryScanner(chats, where, readChat, (chatId) => stamps.get(chatId)).scan(() => false);
    assert.deepEqual(reads.slice(4).sort(), ['chat 0', 'chat 2']);
  });

  it('keeps a batch read for a caller that has gone, and never runs two scans at once', async () => {
    const { chats, bodies } = library(8);
    let gone = false;
    const scanner = new LibraryScanner(chats, scope(), async (chatId) => { gone = true; return bodies.get(chatId); }, () => 1);
    await scanner.scan(() => false, () => gone);
    assert.equal(scanner.media.length, 20, 'the batch in flight is kept: its chats are behind the cursor');
    await scanner.scan(() => false);
    assert.equal(scanner.media.length, 40);

    const many = library(12);
    let inFlight = 0;
    let most = 0;
    const slow = new LibraryScanner(many.chats, scope(), async (chatId) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return many.bodies.get(chatId);
    }, () => 1);
    await Promise.all([slow.scan(() => false), slow.scan(() => false)]);
    assert.equal(most, 4);
    assert.equal(new Set(slow.media.map((m) => m.key)).size, 60);
  });

  it('skips a chat it cannot read, and takes an item out and back where it was', async () => {
    const { chats, bodies } = library(3);
    const scanner = new LibraryScanner(chats, scope(), async (chatId) => {
      if (chatId === 'chat 1') throw new Error('unreadable');
      return bodies.get(chatId);
    }, () => 1);
    await scanner.scan(() => false);
    scanner.settle();
    assert.equal(scanner.media.length, 10);
    const key = scanner.media[3].key;
    const taken = scanner.remove(key);
    assert.equal(taken.index, 3);
    assert.equal(scanner.media.length, 9);
    assert.equal(scanner.remove(key), null);
    scanner.restore(taken.index, taken.item);
    assert.equal(scanner.media[3].key, key);
  });
});

describe('opening an item from the Library', () => {
  it('asks the chat to open it once loaded, for 15 seconds and that chat only', () => {
    open.requestLibraryOpen({ chatId: 'C', docId: 'd' });
    const request = open.$libraryOpenRequest.get();
    assert.equal(request.chatId, 'C');
    assert.equal(request.docId, 'd');
    assert.equal(open.pendingLibraryOpen(request, 'C', request.at + 15_000), request);
    assert.equal(open.pendingLibraryOpen(request, 'C', request.at + 15_001), null);
    assert.equal(open.pendingLibraryOpen(request, 'D', request.at), null);
    assert.equal(open.pendingLibraryOpen(request, null, request.at), null);
    assert.equal(open.pendingLibraryOpen(null, 'C'), null);
    open.$libraryOpenRequest.set(null);
  });

  it('opens the canvas or the report once the chat’s messages hold it, then lets the request go', () => {
    assert.match(chatView, /import \{ \$libraryOpenRequest, pendingLibraryOpen \} from '\.\/library-page\/library-open';/);
    assert.match(chatView, /const request = pendingLibraryOpen\(libraryOpen, activeChatId\);/);
    assert.match(chatView, /if \(!canvasDocsInChat\.has\(request\.docId\)\) return;\s*handleOpenCanvas\(request\.docId\);/);
    assert.match(chatView, /if \(!messages\.some\(\(m\) => m\.id === request\.researchMessageId && m\.research\)\) return;/);
    assert.match(chatView, /setOpenResearchId\(request\.researchMessageId\);\s*\}\s*\$libraryOpenRequest\.set\(null\);/);
  });

  it('opens a row in its chat, an image in the lightbox, and anything else in its chat (Code chats in Code)', () => {
    assert.match(page, /requestLibraryOpen\(doc\.kind === 'research'\s*\? \{ chatId: doc\.chatId, researchMessageId: doc\.messageId \}\s*: \{ chatId: doc\.chatId, docId: doc\.docId \}\);\s*openChat\(doc\.chatId\);/);
    assert.match(page, /if \(item\.kind === 'image'\) setLightbox\(item\);\s*else openChat\(item\.chatId\);/);
    assert.match(page, /if \(isCode\) \{\s*requestCodeChatOpen\(chatId\);\s*return;\s*\}\s*void fs\.selectLocalFSInboxChat\(chatId\);\s*onOpenChat\(chatId\);/);
    assert.match(page, /onGoToChat=\{\(\) => \{ const item = lightbox; setLightbox\(null\); if \(item\) openChat\(item\.chatId\); \}\}/);
  });

  it('gives the lightbox Gemini’s actions, held back until the picture is in', () => {
    for (const [icon, label] of [['content_copy', 'Copy image'], ['download', 'Download full size'], ['chat', 'Go to chat'], ['delete', 'Delete']]) {
      assert.match(lightbox, new RegExp(`<IconButton icon="${icon}" label="${label}" disabled=\\{!ready\\}`));
    }
    assert.match(lightbox, /<IconButton icon="arrow_back" label="Close" size="m" tooltip=\{false\} onClick=\{onClose\} \/>/);
    assert.match(generatedImage, /export const copyImage = async \(url: string\): Promise<void> =>/);
  });
});

describe('paging, and staying put while the chats change', () => {
  it('asks for a first page of Gemini’s size, then a page at a time, shown only once it is all read', () => {
    assert.match(page, /\? \{ documents: DOCUMENTS_PREVIEW \+ 1, media: LIBRARY_PAGE_SIZE \}\s*: \{ documents: LIBRARY_PAGE_SIZE, media: 0 \};/);
    assert.match(page, /want\.current = subpage === 'overview'\s*\? \{ \.\.\.shown, media: shown\.media \+ LIBRARY_PAGE_SIZE \}\s*: \{ \.\.\.shown, documents: shown\.documents \+ LIBRARY_PAGE_SIZE \};/);
    assert.match(page, /publish\(scanner, \{ loadingNext: false, shown: \{ \.\.\.want\.current \} \}\);/);
    assert.match(page, /const shownMedia = Math\.min\(state\.media\.length, state\.shown\.media\);/);
  });

  it('holds the next page’s place with Gemini’s skeletons, under a 1px trigger that stays while it loads', () => {
    assert.match(page, /<SkeletonTiles count=\{isMobile \? 3 : 5\} \/>/);
    assert.match(page, /if \(loading\) body = <SkeletonRows count=\{8\} \/>;/);
    assert.match(page, /\{data\.loadingNext && <SkeletonRows count=\{4\} \/>\}/);
    assert.equal((page.match(/<InfiniteTrigger onReach=\{data\.loadNext\} loading=\{data\.loadingNext\} \/>/g) ?? []).length, 2);
    assert.match(page, /if \(!el \|\| loading\) return undefined;/);
    assert.match(page, /return <div ref=\{ref\} style=\{\{ width: '100%', height: 1 \}\} \/>;/);
  });

  it('reads a changed chat list again behind what is shown, and only starts over for a new page, account or Retry', () => {
    assert.match(page, /const key = `\$\{subpage\}\\u0000\$\{chatScopeId\}\\u0000\$\{attempt\}`;\s*const refresh = shownFor\.current === key;\s*if \(!refresh\) \{/);
    assert.match(page, /if \(scannerRef\.current !== from\) return;/);
    assert.match(page, /const media = data\.media\.slice\(0, data\.shownMedia\);/);
    assert.doesNotMatch(page, /data\.scanner/, 'the page shows what was published, never a scanner mid-read');
  });

  it('deletes at once, writes the chat without the item, and puts it back if that fails', () => {
    assert.match(overlays, />Delete item\?<\/h2>/);
    assert.match(overlays, /This action cannot be undone\. The item will be deleted from the chat where it was created\./);
    assert.match(page, /const removed = removeItem\(item\.key\);/);
    assert.match(page, /withoutMedia\(messages, item\.messageId, item\.mediaId\)/);
    assert.match(page, /fs\.saveLocalFSChat\(item\.chatId, next, null, undefined, \{ openInChat: false \}\)/);
    assert.match(page, /forgetLibraryChat\(fs\.chatScopeId, item\.chatId\);\s*showCopyToast\('Item deleted'\);/);
    assert.match(page, /if \(removed\) restoreItem\(removed\);\s*showCopyToast\('Failed to delete item'\);/);
    assert.match(page, /if \(scannerRef\.current !== removed\.from\) return;/);
  });

  it('says what Gemini says when there is nothing yet', () => {
    assert.match(page, /Any documents or media that you create will appear here/);
    assert.match(page, /Documents that you create will appear here/);
    assert.match(page, /Images, videos and music that you create will appear here/);
    assert.match(page, /No documents saved in your library/);
    assert.match(page, /Couldn&apos;t load more\. Retry/);
    assert.match(tile, /aria-label="Loading thumbnail"/);
    assert.match(tile, /Couldn&apos;t load image/);
  });
});

describe('the looks, as measured', () => {
  const tokens = /\.gm-library,\s*\.gm-library-layer \{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('gives the page and its portalled overlays one set of Luminous’s dark tokens, phones’ after them', () => {
    for (const token of ['--gm-lib-surface: #0f0f0f', '--gm-lib-surface-dim: #171717', '--gm-lib-surface-bright: #1c1c1c', '--gm-lib-surface-highest: #353637', '--gm-lib-on-surface: #e3e3e3', '--gm-lib-on-surface-variant: #e6e6e6', '--gm-lib-primary: var(--sync-a8c7fa, #a7c7fa)', '--gm-lib-scrim: rgba(0, 0, 0, 0.32)']) {
      assert.ok(tokens.includes(token), token);
    }
    const phones = css.indexOf('@media (max-width: 767px)');
    assert.ok(css.indexOf('--gm-lib-surface: #0f0f0f') < phones, 'the phone values come after, so they win');
    assert.match(css.slice(phones, phones + 200), /--gm-lib-surface-dim: #141414;\s*--gm-lib-on-surface-variant: #e0e0e0;/);
    assert.match(css, /@media \(max-width: 960px\) \{\s*\.gm-library \{\s*height: calc\(100% - 68px\);\s*margin-top: 68px;/);
  });

  it('lays out the column, header and type as Gemini’s', () => {
    assert.match(rule(css, '.gm-library-guard'), /max-width: 800px;\s*margin: 0 auto;\s*padding: 0 20px;/);
    assert.match(rule(css, '.gm-library-header'), /padding: 20px 0;/);
    assert.match(rule(css, '.gm-library-headline'), /font-size: 24px;\s*font-weight: 380;\s*line-height: 28px;\s*font-variation-settings: "ROND" 20, "slnt" 0, "wdth" 100, "wght" 380;/);
    assert.match(rule(css, '.gm-library-sections'), /gap: 16px;/);
    assert.match(rule(css, '.gm-library-section'), /gap: 8px;/);
    assert.match(rule(css, '.gm-library-section-head'), /padding: 4px 0;/);
    assert.match(rule(css, '.gm-library-viewport'), /mask-image: linear-gradient\(to bottom, transparent 0, black min\(40px, var\(--gm-lib-overflow-start, 0px\)\), black calc\(100% - min\(40px, var\(--gm-lib-overflow-end, 0px\)\)\), transparent 100%\);/);
  });

  it('draws the loading bar and the skeletons’ glimmer', () => {
    assert.match(rule(css, '.gm-library-progress'), /height: 4px;[\s\S]*background-color: var\(--gm-lib-surface-highest\);/);
    assert.match(rule(css, '.gm-library-progress-bar'), /animation: gm-library-progress 1\.5s cubic-bezier\(0\.4, 0, 0\.2, 1\) infinite;/);
    assert.match(rule(css, '.gm-library-skeleton'), /opacity: 0\.08;\s*animation: gm-library-glimmer 1\.2s ease-in-out infinite;/);
    assert.match(css, /@keyframes gm-library-glimmer \{\s*0% \{ opacity: 0\.08; \}\s*50% \{ opacity: 0\.18; \}\s*to \{ opacity: 0\.08; \}\s*\}/);
    assert.match(rule(css, '.gm-library-skeleton-icon'), /border-radius: 8px;/);
    assert.match(rule(css, '.gm-library-skeleton-lines'), /gap: 4px;/);
  });

  it('draws documents as 16px-cornered rows and media as a grid of 140px squares, 1px apart', () => {
    assert.match(rule(css, '.gm-library-row'), /border-radius: 16px;\s*background-color: var\(--gm-lib-surface-dim\);/);
    assert.match(rule(css, '.gm-library-row-link'), /padding: 20px;/);
    assert.match(rule(css, '.gm-library-row-body'), /gap: 16px;/);
    assert.match(rule(css, '.gm-library-grid'), /gap: 1px;\s*grid-template-columns: repeat\(auto-fill, minmax\(140px, 1fr\)\);/);
    assert.match(rule(css, '.gm-library-tile-card'), /aspect-ratio: 1;[\s\S]*background-color: var\(--gm-lib-surface-highest\);/);
    assert.match(rule(css, '.gm-library-badge'), /bottom: 8px;\s*left: 8px;[\s\S]*width: 36px;\s*height: 36px;[\s\S]*opacity: 0\.6;/);
    assert.match(css, /@media \(min-width: 769px\) \{\s*\.gm-library-tile-delete \{\s*display: flex;\s*\}\s*\.gm-library-tile-more \{\s*display: none;\s*\}\s*\}/);
  });

  it('draws the hover, press and focus layers of Luminous’s interactive surface', () => {
    assert.match(rule(css, '.gm-library-press::before'), /border: 3px solid currentColor;/);
    assert.match(rule(css, '.gm-library-press::after'), /background-color: color-mix\(in srgb, currentColor 8%, transparent\);/);
    assert.match(rule(css, '.gm-library-press:active::after'), /background-color: color-mix\(in srgb, currentColor 12%, transparent\);/);
    assert.match(css, /transition: opacity 0\.15s ease-in-out;/);
  });

  it('sizes the tooltip and the dialog on Gemini’s portal line height of 18.4px', () => {
    const tooltip = rule(css, '.gm-library-tooltip');
    assert.match(tooltip, /max-width: 200px;\s*padding: 8px 16px;\s*border-radius: 12px;\s*background-color: #e3e3e3;/);
    assert.match(tooltip, /line-height: 18\.4px;/);
    assert.match(tooltip, /animation: gm-library-tooltip-in 0\.15s cubic-bezier\(0, 0, 0\.2, 1\) forwards;/);
    assert.match(css, /@keyframes gm-library-tooltip-in \{\s*0% \{ opacity: 0; transform: scale\(0\.8\); \}/);
    assert.match(rule(css, '.gm-library-dialog'), /width: 420px;[\s\S]*border-radius: 40px;\s*background-color: var\(--gm-lib-surface-bright\);/);
    assert.match(rule(css, '.gm-library-dialog-body'), /gap: 16px;\s*padding: 28px 28px 0;/);
    assert.match(rule(css, '.gm-library-dialog-body > div'), /line-height: 18\.4px;/);
    assert.match(rule(css, '.gm-library-dialog-title'), /font-size: 20px;\s*font-weight: 470;\s*line-height: 24px;\s*font-variation-settings: "ROND" 20, "slnt" 0, "wdth" 94, "wght" 470;/);
    assert.match(rule(css, '.gm-library-dialog-actions'), /gap: 8px;\s*padding: 20px;/);
  });

  it('raises phones’ item sheet as Base UI’s drawer, following a drag', () => {
    const sheet = rule(css, '.gm-library-sheet');
    assert.match(sheet, /border-radius: 28px 28px 0 0;/);
    assert.match(sheet, /transform: translateY\(var\(--gm-lib-sheet-drag, 0px\)\);\s*transition: transform 0\.3s cubic-bezier\(0\.2, 0, 0, 1\);\s*touch-action: none;/);
    assert.match(rule(css, '.gm-library-sheet[data-swiping]'), /transition: none;/);
    assert.match(rule(css, '.gm-library-sheet-handle > span'), /width: 36px;\s*height: 4px;/);
    assert.match(rule(css, '.gm-library-sheet-item'), /height: 48px;[\s\S]*padding: 12px 16px 12px 8px;/);
  });

  it('closes the sheet on Base UI’s swipe: past half its height or at 0.5px/ms, from 10px of drag', () => {
    assert.match(overlays, /const SWIPE_START = 10;\s*const SWIPE_VELOCITY = 0\.5;\s*const SWIPE_VELOCITY_WINDOW = 80;/);
    assert.match(overlays, /if \(dy > 0 && \(velocity >= SWIPE_VELOCITY \|\| dy > Math\.max\(sheet\.offsetHeight \* 0\.5, SWIPE_START\)\)\) closeRef\.current\(\);\s*else setOffset\(0\);/);
    assert.match(overlays, /const recent = samples\.find\(\(sample\) => event\.timeStamp - sample\.t <= SWIPE_VELOCITY_WINDOW\);/);
    assert.match(overlays, /sheet\.addEventListener\('click', onClick, true\);/, 'a swipe that ends on a row does not choose it');
  });

  it('shows the lightbox over the picture blurred behind a 90% scrim', () => {
    assert.match(rule(css, '.gm-library-lightbox-ambient'), /filter: blur\(24px\);\s*transform: scale\(1\.1\);/);
    assert.match(rule(css, '.gm-library-lightbox-scrim'), /background-color: rgba\(30, 30, 30, 0\.9\);[\s\S]*backdrop-filter: blur\(4px\);/);
    assert.match(rule(css, '.gm-library-lightbox-media > img'), /max-height: calc\(100vh - 180px\);/);
    assert.match(rule(css, '.gm-library-lightbox-actions'), /padding: 8px 12px;/);
    assert.match(rule(css, '.gm-library-lightbox-close'), /top: 16px;\s*left: 16px;/);
  });

  it('opens and closes the lightbox in one frame, so the blurred copy never shows through a fading scrim', () => {
    // Gemini's lightbox mounts and unmounts whole. A fade left the full-strength blurred copy on
    // screen while the scrim came in and went out (tools/ui-research/captures/gemini/library/willow/rec).
    assert.doesNotMatch(lightbox, /useOverlayPhase/);
    assert.doesNotMatch(lightbox, /data-state/);
    for (const selector of ['.gm-library-lightbox-scrim', '.gm-library-lightbox-stage', '.gm-library-lightbox-ambient']) {
      assert.doesNotMatch(rule(css, selector), /transition|animation/, selector);
    }
    assert.doesNotMatch(css, /\.gm-library-lightbox-(scrim|stage)\[data-state/);
  });

  it('drops the last picture before a new one paints', () => {
    assert.match(lightbox, /if \(\(item\?\.key \?\? null\) !== shownKey\) \{\s*setShownKey\(item\?\.key \?\? null\);\s*setUrl\(null\);\s*setLoaded\(false\);\s*setFailed\(false\);/);
    assert.match(lightbox, /\}, \[item\?\.key, loadUrl\]\);/);
  });

  it('keeps still for reduced motion', () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.gm-library-progress-bar,\s*\.gm-library-skeleton,\s*\.gm-library-tooltip \{\s*animation: none;/);
  });
});

describe('where the Library sits in Willow', () => {
  it('has its own row in the sidebar, Gemini’s `features` glyph', () => {
    assert.match(sidebar, /export type ViewType = [^;]*\| 'library'[ ;]/);
    assert.match(sidebar, /symbol="features"\s*label="Library"\s*isCollapsed=\{isCollapsed\}\s*active=\{currentView === 'library'\}\s*onClick=\{\(\) => onViewChange\('library'\)\}/);
  });

  it('lives at Gemini’s paths, `/library` and `/library/documents`', () => {
    assert.match(app, /const LibraryPage = React\.lazy\(\(\) => import\('@willow\/chat\/library-page\/LibraryPage'\)\);/);
    assert.match(app, /const isLibraryPath = \(pathname: string\): boolean => \/\^\\\/library\(\\\/documents\)\?\\\/\?\$\/\.test\(pathname\);/);
    assert.match(app, /<Route path="\/library" element=\{null\} \/>\s*<Route path="\/library\/documents" element=\{null\} \/>/);
    assert.match(app, /else if \(view === 'library'\) navigate\('\/library'\);/);
    assert.match(app, /subpage=\{location\.pathname\.startsWith\('\/library\/documents'\) \? 'documents' : 'overview'\}/);
  });

  it('shows the wordmark alone in the narrow bar, as Gemini’s Library has no New chat there', () => {
    assert.match(layout, /currentView === 'customize' \|\| currentView === 'library' \|\| currentView === 'download'\) && \(/);
    assert.match(layout, /\{currentView !== 'library' && currentView !== 'download' && currentView !== 'customize' && \(/);
  });
});
