/**
 * Ask Willow about selected text, from the desktop app's right-click menu: what is sent with the
 * question, the menu's entry for it and where the menu opens, and the window it opens — the
 * canvas's floating prompt and window, reused rather than redrawn.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8');
const MENU = read('apps', 'studio', 'src', 'shell', 'rail', 'ContextMenu.tsx');
const WINDOW = read('features', 'chat', 'src', 'AskWillow.tsx');
const MENUS_RS = read('apps', 'desktop', 'src-tauri', 'src', 'menus.rs');

const { askAboutPrompt, askWillowAbout, closeAskWillow, $askWillow } = await importTs(
  path.join(repo, 'features', 'chat', 'src', 'ask-willow.ts'),
);

it('sends the first question with the passage it is about, quoted line by line', () => {
  assert.equal(
    askAboutPrompt('  First line\n\nSecond line ', 'What does this mean?'),
    'About this text:\n\n> First line\n> Second line\n\nWhat does this mean?',
  );
});

it('sends a long selection cut short rather than a whole page', () => {
  const prompt = askAboutPrompt('a'.repeat(20000), 'Summarise');
  assert.ok(prompt.length < 8100, `${prompt.length} characters`);
  assert.match(prompt, /a…\n\nSummarise$/);
});

it('opens a new window for each selection asked about', () => {
  const near = { left: 1, top: 2, right: 3, bottom: 4 };
  askWillowAbout('one', near);
  const first = $askWillow.get();
  askWillowAbout('two', near);
  assert.notEqual($askWillow.get().id, first.id);
  assert.equal($askWillow.get().text, 'two');
  closeAskWillow();
  assert.equal($askWillow.get(), null);
});

it('offers Ask Willow first, and only with text selected', () => {
  assert.match(MENU, /const entries: MenuPanelEntry\[\] = selection\s*\?\s*\[\s*\{\s*label: 'Ask Willow'/);
  assert.match(MENU, /:\s*commands;/);
  assert.match(MENUS_RS, /SelectionText/);
});

it("opens the menu where it was clicked: WebView2's point, in the page's own pixels", () => {
  assert.match(MENUS_RS, /ZoomFactor/);
  assert.doesNotMatch(MENU, /devicePixelRatio/);
});

it("leaves out Copy link to highlight, a link for a browser's address bar", () => {
  assert.match(MENUS_RS, /LEFT_OUT: \[&str; \d+\] = \[[^\]]*"copyLinkToHighlight"/);
});

it("is the canvas's own floating prompt and window", () => {
  assert.match(WINDOW, /import \{ CanvasCoCreateInput, FloatingReply, ThinkingDots \} from '\.\/canvas\/CanvasPrompt'/);
  assert.match(WINDOW, /cv-float-card--window/);
  assert.match(WINDOW, /className="cv-float-window"/);
});
