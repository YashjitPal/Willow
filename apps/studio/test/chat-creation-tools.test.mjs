/**
 * The chat's creation tools beyond the chip: a turn with no tool picked offers image, video and
 * music to the model (Gemini draws when asked to), and the sidebar's Images and Videos are
 * creation pages with Gemini's addresses, `/images` with its own template set.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const tools = await importTs(path.join(ROOT, 'features/chat/src/media/media-tools.ts'));
const { IMAGES_PAGE_TEMPLATES } = await importTs(path.join(ROOT, 'features/chat/src/media/images-page-templates.ts'));

const names = (mode) => tools.mediaChatTools(mode).flatMap((block) => block.functionDeclarations.map((d) => d.name));

describe('media tools on a turn with no tool picked', () => {
  it('offers all three with no chip, and only the chip\'s one with it', () => {
    assert.deepEqual(names('auto'), ['generate_image', 'generate_video', 'generate_music']);
    assert.deepEqual(names('image'), ['generate_image']);
    assert.deepEqual(names('music'), ['generate_music']);
    assert.deepEqual(names(null), []);
  });

  it('tells the model to make media only when it is asked for', () => {
    const text = tools.mediaInstructions('auto');
    for (const name of ['generate_image', 'generate_video', 'generate_music']) assert.match(text, new RegExp(name));
    assert.match(text, /never make one on your own initiative/);
    assert.match(tools.mediaInstructions('image', { aspectRatio: '16:9' }), /turned on "Create image"/, 'the chip still insists on its tool');
    assert.equal(tools.mediaInstructions(null), '');
  });

  it('is offered only with a Gemini key and no tool attached', () => {
    const setup = read('features/chat/src/chat-turn-setup.ts');
    assert.match(setup, /mediaKindForTool\(tool\) \?\? \(!tool && mediaKey \? 'auto' : null\)/,
      'a chip wins; no chip and a key offers all three; another tool (Canvas, Deep research) offers none');
    assert.match(read('features/chat/src/ChatView.tsx'), /if \(tool === 'images' \|\| tool === 'video' \|\| !tool\)/,
      'a no-tool message\'s images go along, as the source to edit or animate');
  });
});

describe('the sidebar\'s creation pages', () => {
  it('has Images and Videos rows that ask the chat for their page', () => {
    const sidebar = read('apps/studio/src/shell/sidebar/Sidebar.tsx');
    assert.match(sidebar, /symbol="image_create"\s+label="Images"/);
    assert.match(sidebar, /symbol="movie"\s+label="Videos"/);
    assert.match(sidebar, /\$chatCreationPageRequest\.set\(page\)/);
    assert.match(sidebar, /active=\{currentView === 'home' && studioMode === 'chat' && !isChatOngoing && !creationPage\}/,
      'New chat is not lit while a creation page is');
  });

  it('routes /images and /videos to the shell', () => {
    const app = read('apps/studio/src/app/App.tsx');
    for (const route of ['/images', '/videos']) assert.ok(app.includes(`<Route path="${route}" element={null} />`), route);
    assert.match(app, /<ShellKeepAlive onShow=\{isMainShellRoute\}>\{mainAppShell\}<\/ShellKeepAlive>/);
  });

  it('carries every /images template with its art, its dialog line and a prompt', () => {
    assert.ok(IMAGES_PAGE_TEMPLATES.length >= 30, `${IMAGES_PAGE_TEMPLATES.length} templates`);
    for (const t of IMAGES_PAGE_TEMPLATES) {
      assert.ok(t.image && t.preview && t.line && t.prompt, t.name);
      assert.doesNotMatch(t.line, /Add a photo/, `${t.name}: the dialog adds that line itself`);
    }
    assert.equal(new Set(IMAGES_PAGE_TEMPLATES.map((t) => t.id)).size, IMAGES_PAGE_TEMPLATES.length, 'ids are unique');
  });
});
