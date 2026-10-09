/**
 * Gems: the store's parsing and ids, the system prompt a Gem chat runs with, notebooks as
 * knowledge, and the layout rules measured against Gemini at 1536, 800 and 390 wide.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const gemsFile = (file) => path.join(repoRoot, 'features', 'gems', 'src', file);
const readRepo = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const css = fs.readFileSync(gemsFile('gems.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The bodies of every `@media <query>` block, joined. */
const mediaBodies = (source, query) => {
  const out = [];
  let at = source.indexOf(`@media ${query}`);
  while (at !== -1) {
    const open = source.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    while (depth && i < source.length) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') depth -= 1;
      i += 1;
    }
    out.push(source.slice(open + 1, i - 1));
    at = source.indexOf(`@media ${query}`, i);
  }
  return out.join('\n');
};

/** A rule whose selector list starts the line, so `.a .b {` never matches `.b`. */
const rule = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
};

const outsideMedia = css.replace(/@media[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
const narrow = mediaBodies(css, '(max-width: 960px)');

test('a stored Gem written before default tools and knowledge parses leniently', async () => {
  const { parseGem, sortGems } = await importTs(gemsFile('gems-store.ts'));
  const legacy = parseGem('Old', { name: 'Old', instructions: 'Be brief.', defaultTool: 'flux', createdAt: 1, updatedAt: 1 });
  assert.equal(legacy.defaultTool, 'none');
  assert.deepEqual(legacy.knowledge, []);
  assert.equal(legacy.hideCitations, false);
  assert.equal(parseGem('x', 'not an object'), null);

  const withFile = parseGem('K', {
    name: 'K', instructions: '', defaultTool: 'research', createdAt: 1, updatedAt: 1,
    knowledge: [{ id: 'k1', name: 'a.txt', mimeType: 'text/plain', size: 3, addedAt: 1 }],
  });
  assert.deepEqual(withFile.knowledge, [{ id: 'k1', name: 'a.txt', mimeType: 'text/plain', size: 3, addedAt: 1 }]);
  assert.equal(withFile.defaultTool, 'research');

  const sorted = sortGems([{ ...legacy, updatedAt: 1 }, { ...withFile, updatedAt: 5 }]);
  assert.deepEqual(sorted.map((gem) => gem.id), ['K', 'Old']);
});

test('creating Gems with one name keeps every id distinct, and copies are named "Copy of"', async () => {
  const store = await importTs(gemsFile('gems-store.ts'));
  const { emptyGemDraft } = await importTs(gemsFile('gem-types.ts'));
  store.gemsStore.set([]);
  const first = store.createGem({ ...emptyGemDraft(), name: 'Trip Planner' });
  const second = store.createGem({ ...emptyGemDraft(), name: 'Trip Planner' });
  assert.notEqual(first.id, second.id);
  assert.equal(store.getGem(second.id).name, 'Trip Planner');
  assert.equal(store.copyGemDraft(first).name, 'Copy of Trip Planner');

  store.updateGem(first.id, { ...emptyGemDraft(), name: 'Trip Planner', instructions: 'Plan by day.' });
  assert.equal(store.getGem(first.id).instructions, 'Plan by day.');
  store.deleteGem(first.id);
  store.deleteGem(second.id);
  assert.equal(store.gemsStore.get().length, 0);
});

test('a premade Gem resolves by id and starts on its default tool', async () => {
  const { resolveGem } = await importTs(gemsFile('gems-store.ts'));
  const { gemStartingTool } = await importTs(gemsFile('gem-chat-store.ts'));
  const resolved = resolveGem('brainstormer', []);
  assert.equal(resolved.kind, 'premade');
  assert.equal(resolved.gem.starters.length, 4);
  assert.equal(gemStartingTool(resolved), null);
  assert.equal(gemStartingTool({ kind: 'custom', gem: { defaultTool: 'images' } }), 'images');
  assert.equal(resolveGem('no-such-gem', []), null);
});

test('the premade Gems are text-only: no image Gems, two of Willow\'s own in their slots', async () => {
  const { PREMADE_GEMS } = await importTs(gemsFile('premade-gems.ts'));
  const ids = PREMADE_GEMS.map((gem) => gem.id);
  assert.deepEqual(ids, ['language-tutor', 'career-guide', 'trip-planner', 'learning-coach', 'brainstormer', 'coding-partner', 'writing-editor', 'productivity-helper']);
  for (const gem of PREMADE_GEMS) {
    assert.equal(gem.defaultTool, 'none', gem.id);
    assert.equal(gem.starters.length, 4, gem.id);
    assert.equal(gem.logo.kind, 'symbol', gem.id);
    assert.ok(!gem.experiment, gem.id);
    assert.ok(gem.instructions.length > 100, gem.id);
  }
  assert.equal(new Set(PREMADE_GEMS.map((gem) => gem.palette)).size >= 6, true);

  const app = readRepo('apps/studio/src/app/App.tsx');
  assert.match(app, /if \(!resolveGem\(gemRouteId\)\) \{\s*navigate\('\/gems', \{ replace: true \}\);/);
});

test('the system prompt puts the instructions first and keeps knowledge uncited when asked', async () => {
  const { buildGemSystemPrompt } = await importTs(gemsFile('gem-chat-store.ts'));
  const gem = {
    name: 'Recipe Helper',
    instructions: 'Suggest one dinner.',
    knowledge: [{ id: 'k1', name: 'pantry.txt', mimeType: 'text/plain', size: 20, content: 'Rice, eggs, spinach.', addedAt: 1 }],
    hideCitations: true,
  };
  const prompt = await buildGemSystemPrompt(gem, { query: 'what can I cook with rice' });
  assert.ok(prompt.indexOf('Suggest one dinner.') < prompt.indexOf('--- KNOWLEDGE ---'));
  assert.match(prompt, /You are "Recipe Helper", a Gem/);
  assert.match(prompt, /Rice, eggs, spinach\./);
  assert.match(prompt, /Do not name, quote the titles of, or cite these files/);

  const bare = await buildGemSystemPrompt({ ...gem, instructions: '', knowledge: [] });
  assert.doesNotMatch(bare, /KNOWLEDGE/);
});

test('a notebook added as knowledge is a snapshot of its readable sources', async () => {
  const { notebookKnowledge } = await importTs(gemsFile('gem-knowledge.ts'));
  const { MAX_KNOWLEDGE_CHARS } = await importTs(gemsFile('gems-store.ts'));
  const file = notebookKnowledge({
    id: 'n1', title: 'Biology', sources: [
      { id: 's1', title: 'Cells.pdf', kind: 'file', content: 'Cells divide.' },
      { id: 's2', title: 'Diagram.png', kind: 'file' },
    ],
  });
  assert.equal(file.name, 'Biology');
  assert.equal(file.mimeType, 'text/markdown');
  assert.equal(file.content, '## Cells.pdf\n\nCells divide.');
  assert.equal(file.problem, undefined);

  const empty = notebookKnowledge({ id: 'n2', title: '', sources: [] });
  assert.equal(empty.name, 'Untitled notebook');
  assert.equal(empty.content, undefined);
  assert.match(empty.problem, /no sources/);

  const huge = notebookKnowledge({ id: 'n3', title: 'Big', sources: [{ id: 's', title: 'x', kind: 'text', content: 'a'.repeat(MAX_KNOWLEDGE_CHARS + 10) }] });
  assert.equal(huge.content.length, MAX_KNOWLEDGE_CHARS);
  assert.match(huge.problem, /truncated/);
});

test('desktop geometry: rows, Gem chat zero state, the editor select and its menus', () => {
  assert.match(rule(outsideMedia, '.gems-list'), /gap:\s*10px/);
  assert.match(rule(outsideMedia, '.gems-row-title'), /flex:\s*none/);
  assert.match(rule(outsideMedia, '.gem-zero'), /padding:\s*16px 20px 18px/);
  assert.match(rule(outsideMedia, '.gem-zero-card'), /width:\s*fit-content/);
  assert.match(rule(outsideMedia, '.gem-zero-card'), /align-items:\s*flex-start/);
  assert.match(rule(outsideMedia, '.gem-zero-description'), /text-align:\s*start/);
  assert.match(rule(outsideMedia, '.gem-editor-select'), /font-size:\s*17px/);
  assert.match(rule(outsideMedia, '.gem-editor-select'), /"wght" 370/);
  assert.match(rule(outsideMedia, '.gems-menu.is-wide .gems-menu-item'), /gap:\s*16px/);
  assert.match(rule(outsideMedia, '.gems-menu.is-upload'), /width:\s*216px/);
  assert.match(rule(outsideMedia, '.gems-menu.is-upload .gems-menu-item'), /min-height:\s*36px/);
  assert.match(rule(outsideMedia, '.gem-editor-form'), /gem-editor-form-grow 300ms/);
  assert.match(css, /16\.667% \{ transform: scale\(0\.95\); animation-timing-function: cubic-bezier\(0\.2, 0, 0, 1\); \}/);
  assert.match(rule(outsideMedia, '.gem-nb-dialog'), /max-height:\s*min\(576px, 100%\)/);
  assert.match(rule(outsideMedia, '.gem-nb-dialog-row.is-selected'), /rgb\(4, 64, 159\)/);
});

test('narrow geometry: the 68px bar, sideways premade cards, a pinned editor header', () => {
  assert.match(rule(narrow, '.gems-page'), /margin-top:\s*68px/);
  assert.match(rule(narrow, '.gems-show-more'), /display:\s*none/);
  assert.match(rule(narrow, '.gems-premade-cards-inner'), /flex-wrap:\s*nowrap/);
  assert.match(rule(narrow, '.gems-premade-cards-inner'), /padding:\s*0 24px/);
  assert.match(narrow, /\.gems-premade-cards,\s*\.gems-premade-cards\.is-expanded\s*\{[^}]*margin:\s*0 -24px/);
  assert.match(narrow, /\.gems-premade-cards,\s*\.gems-premade-cards\.is-expanded\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(rule(narrow, '.gem-zero'), /padding:\s*84px 20px 6px/);
  assert.match(rule(narrow, '.gem-editor'), /overflow:\s*hidden/);
  assert.match(rule(narrow, '.gem-editor-form'), /overflow-y:\s*auto/);
  assert.match(rule(narrow, '.gem-editor-tabs'), /height:\s*49\.6px/);
  assert.match(rule(narrow, '.gem-editor-instructions'), /min-height:\s*120px/);
});

test('the shell wires Gems: routes, the top bar, the model picker and the Gem chat buttons', () => {
  const app = readRepo('apps/studio/src/app/App.tsx');
  assert.match(app, /isGemsEditor=\{\/\^\\\/gems\\\/\(create\|edit\\\/\)\/\.test\(location\.pathname\)\}/);
  const gemsView = app.slice(app.indexOf('<GemsView'));
  assert.match(gemsView.slice(0, 2400), /renderModelPicker=\{/);

  const layout = readRepo('apps/studio/src/shell/StudioLayout.tsx');
  assert.match(layout, /currentView === 'notebook-create' \|\| currentView === 'gems'(\)| \|\|)/);
  assert.match(layout, /!\(currentView === 'gems' && isGemsEditor\)/);
  assert.match(layout, /const isGemChat = isChatExperience && !!chatGemId;/);
  assert.match(layout, /\(isChatOngoing \|\| isGemChat\)/);

  const editor = fs.readFileSync(gemsFile('GemEditor.tsx'), 'utf8');
  assert.match(editor, /const anchor = anchorOf\(event\.currentTarget\);\s*setToolMenu/);
  assert.match(editor, /const anchor = anchorOf\(event\.currentTarget\);\s*setUploadMenu/);
  assert.match(editor, /variant="upload"/);
  assert.match(editor, /<GithubImportDialog/);
  assert.match(editor, /<GemAddNotebookDialog onAdd=\{addNotebooks\}/);
  assert.ok(!fs.existsSync(gemsFile('CreateGemView.tsx')), 'the old create view is gone');
});
