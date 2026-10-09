/**
 * The Media agent's harness: the tools it declares, the prompt it is given, and the pure rules
 * that turn a project into that prompt. The turns themselves are driven against a fake Gemini
 * in the browser simulation; these run the rules a turn depends on.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { importTs } from './ts-module.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const tools = await importTs(path.join(REPO_ROOT, 'features/media/src/agent/agent-tools.ts'));
const context = await importTs(path.join(REPO_ROOT, 'features/media/src/agent/agent-context.ts'));
const voices = await importTs(path.join(REPO_ROOT, 'features/media/src/characters/voices.ts'));

const IMAGE_MODELS = [{ id: 'gemini-3-pro-image', name: 'Nano Banana Pro' }];
const VIDEO_MODELS = [{ id: 'veo-3.1-fast', name: 'Veo 3.1 Fast' }, { id: 'omni-flash', name: 'Gemini Omni Flash 1' }];
const declarations = () => tools.buildMediaAgentToolDeclarations(IMAGE_MODELS, VIDEO_MODELS)[0].functionDeclarations;
const tool = (name) => declarations().find((d) => d.name === name);

const item = (id, extra = {}) => ({
  id, kind: 'image', status: 'completed', url: `data:image/png;base64,${id}`, prompt: `prompt ${id}`,
  modelId: 'm', modelName: 'M', ratio: '16:9', timestamp: 0, ...extra,
});
const host = (over = {}) => ({
  mediaItems: [], characters: [], scenes: [], collections: [], focus: { tab: 'All media', selection: [] }, ...over,
});
const promptFor = (h, collections = new Map()) => tools.buildMediaAgentSystemPrompt({
  imageModels: IMAGE_MODELS,
  videoModels: VIDEO_MODELS,
  defaults: { imageModel: 'gemini-3-pro-image', imageRatio: '16:9', imageCount: 2, videoModel: 'veo-3.1-fast', videoRatio: '16:9', videoCount: 1, videoDuration: '8s' },
  confirmBeforeGenerating: false,
  instructions: [],
  inventory: context.toInventory(h.mediaItems, collections),
  characters: context.toPromptCharacters(h),
  scenes: context.toPromptScenes(h),
  focus: context.toPromptFocus(h, collections),
});

test('declares eight tools, one job each, and lists exactly those', () => {
  const names = declarations().map((d) => d.name);
  assert.deepEqual(names, [...tools.MEDIA_AGENT_TOOL_NAMES]);
  assert.equal(names.length, 8);
  assert.equal(new Set(names).size, names.length);
});

test('every required parameter is declared, and the contract stays small', () => {
  for (const d of declarations()) {
    for (const key of d.parameters.required ?? []) assert.ok(key in d.parameters.properties, `${d.name} requires an undeclared ${key}`);
    assert.ok(d.description.length <= 420, `${d.name}'s description has grown to ${d.description.length} characters`);
  }
  // Sent with every request, so growth is a cost on every turn.
  assert.ok(JSON.stringify(declarations()).length < 14000, `the declarations are ${JSON.stringify(declarations()).length} characters`);
});

test('characters can be featured in images and videos, and voices are the 30 the page offers', () => {
  assert.ok(tool('generate_image').parameters.properties.character_ids);
  assert.match(tool('generate_video').parameters.properties.character_ids.description, /first_frame_id/);
  assert.deepEqual(tool('create_character').parameters.properties.voice.enum, voices.CHARACTER_VOICES.map((v) => v.name));
  assert.deepEqual(tool('create_character').parameters.required, ['name', 'description']);
  assert.equal(voices.findVoice('kore')?.name, 'Kore');
  assert.equal(voices.findVoice('Nobody'), undefined);
});

test('the inventory is the grid: each history as its newest version, and no character images', () => {
  const root = item('root', { timestamp: 1, historyGroupId: 'root' });
  const edit = item('edit', { timestamp: 5, historyGroupId: 'root', historyParentId: 'root' });
  const portrait = item('portrait', { timestamp: 9, characterId: 'c1' });
  const other = item('other', { timestamp: 3, collectionId: 'col' });
  const inventory = context.toInventory([root, edit, portrait, other], new Map([['col', 'Cars']]));
  assert.deepEqual(inventory.map((e) => e.id), ['edit', 'other']);
  assert.equal(inventory[1].collection, 'Cars');
});

test('characters and scenes reach the prompt, trashed scenes and portraits do not', () => {
  const h = host({
    mediaItems: [
      item('p1', { characterId: 'c1' }),
      item('v1', { kind: 'video', prompt: 'A fox runs' }),
      item('v2', { kind: 'video', prompt: 'A fox sleeps' }),
    ],
    characters: [{ id: 'c1', name: 'Mira', prompt: 'A red-haired pilot', personality: 'Brave and dry-witted', voice: { name: 'Kore' }, portraitId: 'p1' }],
    scenes: [
      { id: 's1', name: 'Fox day', aspectRatio: '16:9', clips: [
        { id: 'k1', mediaId: 'v1', trimStart: 0, trimEnd: 8, sourceDuration: 8 },
        { id: 'k2', mediaId: 'v2', trimStart: 1, trimEnd: 5, sourceDuration: 8 },
      ] },
      { id: 's2', name: 'Old cut', aspectRatio: '16:9', trashedAt: 1, clips: [] },
    ],
  });
  const prompt = promptFor(h);
  assert.match(prompt, /- c1 · "Mira" · portrait ready · voice Kore \(female, firm, mid pitch\)/);
  assert.match(prompt, /Look: A red-haired pilot/);
  assert.match(prompt, /Info: Brave and dry-witted/);
  assert.match(prompt, /- s1 · "Fox day" · 16:9 · 2 clips, 12s/);
  assert.match(prompt, /Clips: 1\. v1 "A fox runs" 8s; 2\. v2 "A fox sleeps" 4s/);
  assert.ok(!prompt.includes('Old cut'), 'a trashed scene was listed');
  assert.ok(!/- p1 · image/.test(prompt), 'a portrait was listed as a gallery item');
  assert.match(prompt, /Nothing is selected in the gallery/);
});

test('an empty project says so instead of listing nothing', () => {
  const prompt = promptFor(host());
  assert.match(prompt, /Characters\nNone yet\./);
  assert.match(prompt, /Scenes\nNone yet\./);
  assert.match(prompt, /The gallery for this project is empty/);
});

test('what is selected and open is on screen, the selection oldest first', () => {
  const h = host({
    mediaItems: [item('late', { kind: 'video', timestamp: 5, prompt: 'Late clip' }), item('early', { kind: 'video', timestamp: 1, prompt: 'Early clip' })],
    scenes: [{ id: 's1', name: 'Fox day', aspectRatio: '16:9', clips: [] }],
    characters: [{ id: 'c1', name: '', prompt: 'x' }],
    collections: [{ id: 'col', name: 'Cars' }],
    focus: {
      tab: 'Videos',
      collectionId: 'col',
      sceneId: 's1',
      characterId: 'c1',
      selection: [{ kind: 'media', id: 'late' }, { kind: 'scene', id: 's1' }, { kind: 'media', id: 'early' }],
    },
  });
  const prompt = promptFor(h, new Map([['col', 'Cars']]));
  assert.match(prompt, /- Tab: Videos\./);
  assert.match(prompt, /Inside the collection "Cars" \(col\)/);
  assert.match(prompt, /Open in the Scenebuilder: scene s1 "Fox day"/);
  assert.match(prompt, /page of character c1 "Untitled character"/);
  const selected = prompt.slice(prompt.indexOf('Selected in the gallery (3), oldest first:'));
  assert.ok(selected.indexOf('early') < selected.indexOf('late') && selected.indexOf('late') < selected.indexOf('- s1 · scene'), selected.slice(0, 300));
});

test('a cast travels as numbered references, and in words where a model cannot see them', () => {
  const mira = { character: { id: 'c1', name: 'Mira', prompt: 'A red-haired pilot', personality: 'Brave', voice: { name: 'Kore' } }, name: 'Mira', images: [item('p1'), item('b1')] };
  const kai = { character: { id: 'c2', name: 'Kai', prompt: 'A tall mechanic' }, name: 'Kai', images: [item('p2')] };
  const image = context.castNote([mira, kai], 'image', true, 2);
  assert.match(image, /Keep each one exactly as in their reference images/);
  assert.match(image, /- Mira: reference images 2–3\./);
  assert.match(image, /- Kai: reference image 4\./);
  assert.ok(!/acts:|voice:/.test(image), 'an image prompt carries no acting or voice');
  const veo = context.castNote([mira], 'video', false, 1);
  assert.match(veo, /- Mira: A red-haired pilot; acts: Brave; voice: Kore \(female, firm, mid pitch\)\./);
});

test('a new clip order keeps trims, allows a repeat and drops what is left out', () => {
  const clips = [
    { id: 'k1', mediaId: 'v1', trimStart: 2, trimEnd: 6, sourceDuration: 8 },
    { id: 'k2', mediaId: 'v2', trimStart: 0, trimEnd: 8, sourceDuration: 8 },
    { id: 'k3', mediaId: 'v3', trimStart: 0, trimEnd: 4, sourceDuration: 4 },
  ];
  const videoFor = (id) => (id === 'gone' ? 'not found' : item(id, { kind: 'video' }));
  const { plan, skipped } = context.planSceneClips(clips, ['v2', 'v1', 'v1', 'gone'], ['v9'], videoFor);
  assert.deepEqual(plan.map((e) => ('clip' in e ? `clip:${e.clip.id}` : `new:${e.video.id}`)), ['clip:k2', 'clip:k1', 'new:v1', 'new:v9']);
  assert.deepEqual(skipped, [{ id: 'gone', reason: 'not found' }]);
  const appended = context.planSceneClips(clips, null, ['v4'], videoFor).plan;
  assert.deepEqual(appended.map((e) => ('clip' in e ? e.clip.id : e.video.id)), ['k1', 'k2', 'k3', 'v4']);
});

test('the prompt teaches the scene and keyframe workflows, and only Omni Flash takes a cast on video', () => {
  const prompt = promptFor(host());
  assert.match(prompt, /call generate_video once per shot in the same step/);
  assert.match(prompt, /then call create_scene with the finished video IDs in story order/);
  assert.match(prompt, /Only Gemini Omni Flash 1 takes character_ids for video/);
  assert.match(prompt, /first_frame_id/);
  assert.ok(!/music_generation/.test(prompt), 'the deferred capability block reached the prompt');
});

test('a card sits where its reply made it, between the text before and after; one saved before cards had a place goes last', () => {
  const content = 'Here is the plan.\n\nNow a shot.\n\n![Generated media](media-id:x)\n\nDone.';
  const label = (p) => ('card' in p ? `card:${p.card.id}` : `text:${p.text.trim().slice(0, 9)}`);
  const parts = context.splitReplyAtCards(content, [{ kind: 'character', id: 'c1', at: content.indexOf('Now a shot') }, { kind: 'scene', id: 's1' }]);
  assert.deepEqual(parts.map(label), ['text:Here is t', 'card:c1', 'text:Now a sho', 'card:s1']);
  // A card at the very start, and one past the end of the text, keep their order.
  assert.deepEqual(context.splitReplyAtCards('Hi.', [{ id: 'b', at: 99 }, { id: 'a', at: 0 }]).map((p) => ('card' in p ? p.card.id : p.text)), ['a', 'Hi.', 'b']);
  assert.deepEqual(context.splitReplyAtCards('Hi.', undefined), [{ text: 'Hi.' }]);
});

test('each tool call is kept as a line, and a reply without its own history says what it did and whether it finished', () => {
  assert.equal(
    context.describeToolCall('generate_image', { prompt: 'A lighthouse at dusk' }, { status: 'partial', items: [{ id: 'm1', status: 'completed' }, { id: 'm2', status: 'failed' }] }),
    'generate_image "A lighthouse at dusk", made m1 (partial)',
  );
  assert.equal(
    context.describeToolCall('generate_video', { prompt: 'Waves' }, { status: 'stopped', started: ['v1'] }),
    'generate_video "Waves", started v1, still generating in the gallery (stopped)',
  );
  assert.equal(context.describeToolCall('create_character', { name: 'Lio' }, { status: 'completed', character: { id: 'character-1', name: 'Lio' } }), 'create_character character-1 "Lio" (completed)');
  assert.equal(context.describeToolCall('create_scene', { name: 'Cut' }, { status: 'failed', error: 'None of those can go in a scene.' }), 'create_scene "Cut" (failed: None of those can go in a scene.)');

  assert.equal(
    context.replyForHistory({ status: 'stopped', actions: ['generate_image "A", made m1 (completed)'] }, 'Shot 1 of 3.'),
    'Shot 1 of 3.\n\n[What this reply did: generate_image "A", made m1 (completed)]\n\n[This reply did not finish: it was stopped before the end.]',
  );
  assert.equal(context.replyForHistory({ status: 'error', error: 'quota' }, ''), '(No reply.)\n\n[This reply did not finish: it failed (quota).]');
  assert.equal(context.replyForHistory({ status: 'done' }, 'All set.'), 'All set.');
  assert.match(promptFor(host()), /carry on with that request from where it stopped: keep what it already made, do not make it again/);
});

test('the session places each card, keeps every tool call with the reply, and sends a reply without history with its notes', () => {
  const session = fs.readFileSync(path.join(REPO_ROOT, 'features/media/src/agent/agent-session.ts'), 'utf8');
  assert.match(session, /\{ \.\.\.link, at: t\.answer\.length \}/);
  assert.match(session, /t\.actions\.push\(describeToolCall\(name, args, result\)\);/);
  assert.match(session, /: \{ role: 'assistant', content: replyForHistory\(m, stripMediaMarkdown\(m\.content\)\) \}/);
  assert.match(session, /\.\.\.\(message\.actions\?\.length \? \{ actions: \[\.\.\.message\.actions\] \} : \{\}\)/, 'the actions are not saved with the session');
});

test('while a reply is written the chat ends at it, so a scroll down stops there instead of being pulled back', () => {
  const sidebar = fs.readFileSync(path.join(REPO_ROOT, 'features/media/src/AgentSidebar.tsx'), 'utf8');
  assert.doesNotMatch(sidebar, /onScroll=\{handleScroll\}|scrollTop = maxAllowedScroll|'60vh'/, 'a scroll pulled back after it was drawn makes the chat jump');
  assert.match(sidebar, /const observer = new ResizeObserver\(fit\);\s*\[container, question, reply\]\.forEach\(\(el\) => observer\.observe\(el\)\);/);
  assert.match(sidebar, /const height = Math\.max\(0, Math\.round\(end \+ container\.clientHeight - spacer\.offsetTop - padding\)\);/);
});
