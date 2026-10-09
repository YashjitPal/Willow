// Media's character Body slot and the All media composer's @ mentions, as Flow's (measured live
// against Flow by tools/ui-research/scrapers/flow/media/w-character-body.cjs and w-mention.cjs):
// Create body starts from the portrait, Format writes Flow's triptych instructions, "@" opens the
// add menu as a popover over the prompt box and a pick becomes a chip and an ingredient, and a
// character ingredient is sent as its portrait and body under its name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importTs } from './ts-module.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
const refs = await importTs(path.join(REPO_ROOT, 'features/media/src/characters/character-references.ts'));

const image = (id) => ({ id, kind: 'image', status: 'completed', url: `data:image/png;base64,${id}`, prompt: id, modelId: 'm', modelName: 'M', ratio: '16:9', timestamp: 0 });

test('a character ingredient is sent as its portrait and body, and the text says which images are it', () => {
  const images = { mira: [image('portrait'), image('body')] };
  const out = refs.expandCharacterReferences('Mira at the harbor', [
    { id: 'mira', url: 'data:portrait', name: 'Mira', kind: 'image', characterId: 'mira' },
    { id: 'harbor', url: 'data:harbor', name: 'Harbor', kind: 'image' },
  ], (id) => images[id] ?? []);
  assert.deepEqual(out.attachments.map((a) => a.id), ['portrait', 'body', 'harbor']);
  assert.deepEqual(out.attachments.slice(0, 2).map((a) => a.name), ['Mira', 'Mira']);
  assert.equal(out.prompt, 'Mira at the harbor\n\n("Mira" is the character shown in reference images 1 and 2.)');
});

test('without a character the input goes as it is, and a character with no image adds nothing', () => {
  const plain = [{ id: 'a', url: 'data:a', name: 'A', kind: 'image' }];
  assert.deepEqual(refs.expandCharacterReferences('p', plain, () => []), { prompt: 'p', attachments: plain });
  const out = refs.expandCharacterReferences('p', [{ id: 'c', url: '', name: 'Nobody', kind: 'image', characterId: 'c' }, ...plain], () => []);
  assert.deepEqual(out, { prompt: 'p', attachments: plain });
});

test('several characters are numbered by where their images land', () => {
  const images = { a: [image('a1')], b: [image('b1'), image('b2')] };
  const out = refs.expandCharacterReferences('Ann meets Bo', [
    { id: 'img', url: 'data:img', name: 'I', kind: 'image' },
    { id: 'a', url: 'data:a', name: 'Ann', kind: 'image', characterId: 'a' },
    { id: 'b', url: 'data:b', name: 'Bo', kind: 'image', characterId: 'b' },
  ], (id) => images[id]);
  assert.deepEqual(out.attachments.map((a) => a.id), ['img', 'a1', 'b1', 'b2']);
  assert.match(out.prompt, /\("Ann" is the character shown in reference image 2; "Bo" is the character shown in reference images 3 and 4\.\)$/);
});

test('Create body switches slot, empties the box and starts an empty body from the portrait', () => {
  const page = read('features/media/src/characters/CharacterEditPage.tsx');
  assert.match(page, /const selectSlot = \(next: CharacterSlot\) => \{\s*if \(next === slot\) return;\s*setPrompt\(''\);\s*setRefs\(next === 'body' && !body && portrait\?\.url && !portraitPending \? \[portrait\] : \[\]\);\s*setSlot\(next\);/);
  assert.match(page, /label=\{body \? 'Body' : 'Create body'\}/);
  // Flow disables the other chip while a slot is made, and Create body until there is a portrait.
  assert.match(page, /disabled=\{slot === 'body' && pending\}/);
  assert.match(page, /disabled=\{\(slot === 'portrait' && pending\) \|\| portraitPending \|\| \(!portrait && !body\)\}/);
  assert.match(page, /placeholder=\{current \? 'What do you want to change\?' : slot === 'body' \? 'Describe body and outfit\\u2026' : 'Describe your character\\u2026'\}/);
  assert.match(page, /onClear=\{\(\) => \{ setPrompt\(''\); setRefs\(\[\]\); \}\}/);
});

test("Format on the body writes Flow's triptych instructions in front of the text, once", () => {
  const box = read('features/media/src/characters/CharacterPromptBox.tsx');
  assert.ok(box.includes("export const BODY_TRIPTYCH = 'Full-body triptych, three distinct views: front facing, 3/4 side view, and back view. High resolution, flat studio lighting, consistent anatomical proportions across all views, solid white background.';"));
  assert.match(box, /const bodyFormatted = slot === 'body' && value\.trimStart\(\)\.startsWith\(BODY_TRIPTYCH\);/);
  assert.match(box, /if \(slot === 'body'\) \{ onChange\(`\$\{BODY_TRIPTYCH\} \$\{value\.trim\(\)\}`\); return; \}/);
  // While a version is made: Flow's white 20px spinner in Generate, and the model select disabled.
  assert.match(box, /<FlowSpinner size=\{20\} \/>/);
  assert.match(box, /className="cp-chip cp-chip--model"\s*disabled=\{!!busy\}/);
  assert.match(read('features/media/src/scenes/scene-builder.css'), /\.sb-generate \.sb-spinner \{ color: var\(--sb-fg-000\); \}/);
});

test('"@" opens the add menu as a popover 8px above the prompt box, centred on it', () => {
  const picker = read('features/media/src/scenes/SceneMediaPicker.tsx');
  assert.match(picker, /style=\{popover \? \{ left: anchor\.left \+ anchor\.width \/ 2, bottom: window\.innerHeight - anchor\.top \+ 8 \} : undefined\}/);
  assert.match(picker, /\{ id: 'characters', label: 'Characters', icon: 'accessibility_new' \}/);
  // The menu keeps its category; a click adds; the arrows stop at the ends.
  assert.match(picker, /if \(mode === 'composer'\) composerCategory = next;/);
  assert.match(picker, /onClick=\{\(\) => \{ setActiveKey\(entry\.key\); if \(popover\) take\(entry, null\); \}\}/);
  assert.match(picker, /Math\.max\(0, Math\.min\(list\.length - 1, at \+ \(e\.key === 'ArrowDown' \? 1 : -1\)\)\)/);
  const css = read('features/media/src/scenes/scene-picker.css');
  assert.match(css, /\.sb-popover-backdrop \{[^}]*background: rgba\(0, 0, 0, 0\.32\);[^}]*animation: sb-backdrop-in 400ms/);
  assert.match(css, /\.sb-picker\.sb-picker--popover \{ position: fixed; z-index: 1000; transform: translateX\(-50%\); animation: none; \}/);
});

test("the field's trigger is Flow's: \"@\" at the start, after a space, a line break or a chip", () => {
  const editor = read('features/media/src/PromptEditor.tsx');
  assert.match(editor, /if \(offset > 0\) return \/\\s\/\.test\(node\.data\[offset - 1\]\);/);
  assert.match(editor, /return prev instanceof HTMLElement && \(prev\.tagName === 'BR' \|\| prev\.dataset\.mentionId !== undefined\);/);
  assert.match(editor, /chip\.contentEditable = 'false';/);
  const css = read('features/media/src/prompt-editor.css');
  assert.match(css, /\.prompt-editor \.mention-chip \{[^}]*padding: 3px 6px;[^}]*border-radius: 8px;[^}]*background-color: rgba\(218, 220, 224, 0\.15\);[^}]*font-size: 11\.008px;/);
  assert.match(css, /\.prompt-editor \.mention-chip\.mention-chip-invalid \{[^}]*border: 1px solid rgba\(218, 220, 224, 0\.25\);[^}]*color: rgba\(218, 220, 224, 0\.5\);/);
});

test('MediaView wires the mention: a pick lands as a chip and an ingredient; a chip is valid only for an ingredient', () => {
  const view = read('features/media/src/MediaView.tsx');
  assert.match(view, /new Set\(attachments\.filter\(Boolean\)\.map\(\(att\) => att\.characterId \?\? att\.id\)\)/);
  assert.match(view, /landPick\(\{ id: character\.id, title: characterName\(character\), type: 'entity' \}\);/);
  assert.match(view, /landPick\(\{ id: item\.id, title, type: 'media' \}\);/);
  // "@" leaves the chip; the add button, which opens the same menu, leaves only the ingredient.
  assert.match(view, /if \(addMenuFromRef\.current === 'mention'\) promptEditorRef\.current\?\.insertMention\(mention\);/);
  assert.match(view, /else if \(!mentionPickedRef\.current\) promptEditorRef\.current\?\.cancelMention\(\);/);
  assert.match(view, /onClick=\{\(e\) => \(mentionOpen \? closeMention\(\) : openAddMenu\(e\.currentTarget\)\)\}/);
  // In Frames mode a character can't be an ingredient, so its chip stays invalid.
  assert.match(view, /if \(!isFramesMode\) attachCharacter\(character\);/);
  assert.match(view, /<SceneMediaPicker\s*open=\{mentionOpen\}\s*mode="composer"\s*anchor=\{mentionAnchor\}/);
});

test("the prompt box rests at Flow's 97.6px: a 1px edge, 8px between the rows, a 32px control row", () => {
  const view = read('features/media/src/MediaView.tsx');
  assert.match(view, /padding: '12px 8px 8px 10px',\s*gap: '8px',/);
  assert.match(view, /border: `1px solid \$\{isComposerFocused \? 'rgba\(218, 220, 224, 0\.15\)' : 'rgba\(218, 220, 224, 0\.05\)'\}`,/);
  assert.doesNotMatch(view, /inset 0 0 0 1px rgba\(218, 220, 224, 0\.1\)/);
  assert.match(view, /<div className="flex items-center justify-between h-8">/);
  // The add glyph is Flow's thin add, close while the menu is open, and gone in Frames mode.
  assert.match(view, /name=\{mentionOpen \|\| \(isAssetMenuOpen && assetMenuSource === 'main'\) \? 'close' : 'add'\}/);
  assert.match(view, /\{!isFramesMode && \(\s*<button\s*ref=\{assetMenuPlusRef/);
  // The send button: an 18px unfilled arrow, at 50% on the 5% fill, rgb(32,33,36) on white.
  assert.match(view, /style=\{\{ color: !prompt\.trim\(\) \? 'rgba\(218, 220, 224, 0\.5\)' : 'rgb\(32, 33, 36\)' \}\}/);
  assert.match(read('features/media/src/prompt-editor.css'), /\.prompt-editor__placeholder \{[^}]*color: rgba\(218, 220, 224, 0\.5\);/);
  // Frames mode: Flow's 56px chips with the swap button between.
  assert.match(read('features/media/src/prompt-editor.css'), /\.composer-frame-empty \{[^}]*width: 56px;[^}]*height: 56px;[^}]*border: 1px solid rgba\(218, 220, 224, 0\.15\);[^}]*border-radius: 12px;/);
  assert.match(view, /aria-label="Swap frames"/);
});

test("All media lists the characters among its tiles, by when they were made, as Flow's does", () => {
  const view = read('features/media/src/MediaView.tsx');
  assert.match(view, /const CHARACTER_ITEM_PREFIX = 'character:';/);
  assert.match(view, /if \(activeSidebarTab === 'all' && !openCollection\) \{\s*const characterTiles = characters/);
  assert.match(view, /ratio: '1:1',\s*timestamp: c\.createdAt,/);
  assert.match(view, /if \(item\.id\.startsWith\(CHARACTER_ITEM_PREFIX\)\) \{[\s\S]{0,200}<CharacterTile/);
  // Add to prompt adds the character itself, as an @ pick does.
  assert.match(view, /attachCharacter\(c\);\s*setTimeout\(\(\) => promptEditorRef\.current\?\.focus\(\), 50\);/);
});

test("the add menu's character preview is Flow's: 16:9, thumbnails for two images, the voice card", () => {
  const picker = read('features/media/src/scenes/SceneMediaPicker.tsx');
  assert.match(picker, /\{slots\.length > 1 && \(/);
  assert.match(picker, /\{voice && <PreviewVoice voice=\{voice\} \/>\}/);
  const css = read('features/media/src/scenes/scene-picker.css');
  assert.match(css, /\.sb-character-preview__hero \{[^}]*aspect-ratio: 16 \/ 9;/);
  assert.match(css, /\.sb-character-preview__image \{[^}]*object-fit: cover;/);
  // Unlike Flow's, the @ menu's search shows no focus ring.
  assert.match(css, /\.sb-picker--popover \.sb-picker__search:focus-within \{ outline: none; \}/);
});

test("the ingredient row, its hover card and the clear button sit where Flow's do", () => {
  const view = read('features/media/src/MediaView.tsx');
  // 4px under the thumbs, then the box's 8px gap.
  assert.match(view, /style=\{\{ padding: '0 16px 4px 8px' \}\}/);
  // The previews leave the shell, which clips its overflow — and so are not drawn
  // while the editor is kept alive off screen.
  assert.match(view, /\{!isBackground && hoveredAttachmentRect && hoveredAttachmentCharacterId && createPortal\(/);
  assert.match(view, /\{!isBackground && hoveredAttachmentUrl && hoveredAttachmentRect && !hoveredAttachmentCharacterId && createPortal\(/);
  // Clear sits in the shell's corner, above the ingredients, and clears them with the text.
  assert.match(view, /\{\(prompt\) => \(prompt \|\| hasActiveAttachments\) && \(\s*<button\s*onClick=\{\(\) => \{ promptStore\.set\(''\); setAttachments\(\[\]\); \}\}/);
  assert.match(view, /className="absolute right-2 top-2 w-8 h-8/);
  const css = read('features/media/src/characters/characters.css');
  assert.match(css, /\.cp-ingredient-card \{[^}]*padding: 4px;[^}]*border-radius: 12px;[^}]*background-color: var\(--sb-bg-200\);/);
  assert.match(css, /\.cp-ingredient-card__image-box \{ position: relative; width: 200px; height: 200px;/);
  assert.match(read('features/media/src/prompt-editor.css'), /\.composer-ingredient:hover \.composer-type-badge \{ opacity: 0; \}/);
});
