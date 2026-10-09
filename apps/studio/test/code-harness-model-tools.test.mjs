/**
 * The Code tab's tools, as the model calls them.
 *
 * Each Tools-menu entry is a model tool too: `propose_plan`, `generate_image`,
 * `create_design`, `annotate`, `inspect` and `computer`. These tests pin what
 * runs without a browser — argument parsing, the observation the model reads,
 * the image and design tools against stand-ins, the image client against a fake
 * API — and that the menu and the registered tools cannot drift apart. What
 * needs a real page (clicks, typing, screenshots) is exercised in a browser.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (file) => path.join(repoRoot, 'features', 'code', 'src', 'harness', file);

const { parseActions, parseTarget, makeBrowserTools, MAX_ACTIONS_PER_CALL } = await importTs(harness('browser/browser-tools.ts'));
const { parseKeyCombo, describeEntry } = await importTs(harness('browser/page-driver.ts'));
const { formatObservation } = await importTs(harness('browser/preview-session.ts'));
const { CODE_TOOLS, codeTool } = await importTs(harness('code-tools.ts'));
const { BUILTIN_TOOLS } = await importTs(harness('tools.ts'));
const { makeImageTool } = await importTs(harness('image-tool.ts'));
const { makeDesignTool, importedModules } = await importTs(harness('design-tool.ts'));
const { BUILTIN_SKILLS, withBuiltinSkills, APP_TESTING_SKILL_ID } = await importTs(harness('builtin-skills.ts'));
const { makeSkillTools } = await importTs(harness('skills.ts'));
const { Workspace } = await importTs(harness('workspace.ts'));
const { generateGeminiImage } = await importTs(path.join(repoRoot, 'platform', 'ai', 'src', 'image-generation.ts'));

const context = (files = {}) => {
  const steps = [];
  return {
    workspace: new Workspace(files),
    check: async () => ({ buildErrors: [], runtimeErrors: [], warnings: [], console: [], durationMs: 0 }),
    readSkills: new Set(),
    mode: 'build',
    record: { add: (step) => (steps.push(step), step.id), patch: () => {} },
    steps,
  };
};

/* ====================================================================== */
/* computer: what the model may send                                      */
/* ====================================================================== */

it('reads one action or a batch, in the shapes other computer-use tools taught models', () => {
  assert.deepEqual(parseActions({ action: 'click', ref: 7 }), { actions: [{ action: 'click', target: { ref: 7 }, double: false, right: false }] });
  assert.deepEqual(parseActions({ action: 'left_click', coordinate: [120, 48] }).actions[0].target, { x: 120, y: 48 });
  assert.deepEqual(parseActions({ action: 'click', ref: '[3]' }).actions[0].target, { ref: 3 });
  assert.deepEqual(parseActions({ action: 'click', text: 'Save' }).actions[0].target, { text: 'Save' });
  assert.equal(parseActions({ action: 'double_click', ref: 2 }).actions[0].double, true);

  const batch = parseActions({ actions: [
    { action: 'type', ref: 4, text: 'Buy milk', enter: true },
    { action: 'key', keys: 'Escape' },
    { action: 'scroll' },
  ] });
  assert.deepEqual(batch.actions, [
    { action: 'type', target: { ref: 4 }, text: 'Buy milk', clear: false, enter: true },
    { action: 'press', key: 'Escape' },
    { action: 'scroll', direction: 'down', amount: 600, target: undefined },
  ]);
});

it('keeps what to type apart from where to type it', () => {
  assert.deepEqual(parseActions({ action: 'type', text: 'hello' }).actions[0], { action: 'type', target: undefined, text: 'hello', clear: false, enter: false });
  assert.deepEqual(parseActions({ action: 'type', target: 'Email', text: 'a@b.co', clear: true }).actions[0].target, { text: 'Email' });
  assert.deepEqual(parseActions({ action: 'select', ref: 9, option: 'Weekly' }).actions[0], { action: 'select', target: { ref: 9 }, option: 'Weekly' });
});

it('parses drags, waits, routes and screen sizes, and refuses what it cannot do', () => {
  assert.deepEqual(parseActions({ action: 'drag', from: { ref: 2 }, to: 'Done' }).actions[0], { action: 'drag', from: { ref: 2 }, to: { text: 'Done' } });
  assert.deepEqual(parseActions({ action: 'left_click_drag', start_coordinate: [1, 2], end_coordinate: [30, 40] }).actions[0], { action: 'drag', from: { x: 1, y: 2 }, to: { x: 30, y: 40 } });
  assert.equal(parseActions({ action: 'wait', seconds: 30 }).actions[0].ms, 5_000, 'waits are capped');
  assert.deepEqual(parseActions({ action: 'navigate', to: '#/settings' }).actions[0], { action: 'navigate', to: '#/settings' });
  assert.deepEqual(parseActions({ action: 'viewport', size: 'iPhone' }).actions[0], { action: 'viewport', size: 'mobile' });

  assert.match(parseActions({ action: 'navigate', url: 'https://example.com' }).error, /cannot open other websites/);
  assert.match(parseActions({ action: 'fly' }).error, /"fly" is not an action\. Actions: screenshot, click/);
  assert.match(parseActions({ action: 'click' }).error, /needs "ref"/);
  assert.match(parseActions({ actions: Array.from({ length: MAX_ACTIONS_PER_CALL + 1 }, () => ({ action: 'screenshot' })) }).error, /At most 12 actions/);
  assert.equal(parseTarget({}), null);
});

it('turns key names into the events a keyboard sends', () => {
  assert.deepEqual(parseKeyCombo('Control+Shift+a'), { key: 'a', code: 'KeyA', keyCode: 65, ctrl: true, shift: true, alt: false, meta: false });
  assert.equal(parseKeyCombo('Enter').keyCode, 13);
  assert.equal(parseKeyCombo('esc').key, 'Escape');
  assert.deepEqual([parseKeyCombo('space').key, parseKeyCombo('space').code], [' ', 'Space']);
  assert.equal(parseKeyCombo('Cmd+K').meta, true);
  assert.equal(parseKeyCombo('Launch the rockets'), null);
});

/* ====================================================================== */
/* What the model reads back                                              */
/* ====================================================================== */

it('describes the screen as numbered things to act on, with the code behind each', () => {
  const entry = { ref: 3, element: null, role: 'button', name: 'Add task', box: { x: 600, y: 100, width: 80, height: 40 }, source: '/components/TaskForm.tsx:31', state: ['disabled'] };
  assert.equal(describeEntry(entry, 0.5), '[3] button "Add task" at 320,60 (disabled) — /components/TaskForm.tsx:31');

  const text = formatObservation(
    { entries: [entry], viewport: { width: 1280, height: 800 }, scroll: { y: 200, maxY: 1600 }, route: '#/tasks', title: 'Tasks', hiddenAbove: 0, hiddenBelow: 4, text: 'Tasks · 3 left', dialog: 'Delete task?' },
    { data: 'X', mimeType: 'image/jpeg', width: 640, height: 400, scale: 0.5 },
    ['error: Warning: Each child in a list should have a unique "key" prop.'],
    0.5,
  );
  assert.match(text, /^Screen: 640×400 screenshot, route #\/tasks, scrolled 200 of 1600px\./);
  assert.match(text, /A dialog is open: "Delete task\?"/);
  assert.match(text, /\[3\] button "Add task" at 320,60/);
  assert.match(text, /More controls off screen: 4 below\. Scroll to reach them\./);
  assert.match(text, /Text on screen: Tasks · 3 left/);
  assert.match(text, /Console since the last step:\n- error: Warning: Each child/);
});

/* ====================================================================== */
/* The menu and the tools cannot drift apart                              */
/* ====================================================================== */

it('backs every Tools-menu entry with a tool the model can call', () => {
  const preview = { prepare: async () => null, lastScan: null, scale: 1 };
  const registered = new Set([
    ...BUILTIN_TOOLS.map((tool) => tool.name),
    ...makeBrowserTools(preview).map((tool) => tool.name),
    makeImageTool({ resolveModel: () => ({ missing: 'none' }) }).name,
    makeDesignTool({ addToCanvas: () => 'node' }).name,
  ]);
  for (const tool of CODE_TOOLS) {
    assert.ok(registered.has(tool.modelTool), `${tool.label} is built on ${tool.modelTool}, which nothing registers`);
    if (tool.directive) assert.match(tool.directive, new RegExp(`\`${tool.modelTool}\``), `${tool.label}'s direction should name its tool`);
  }
  assert.equal(codeTool('prototype').label, 'Visual Edits');
  assert.equal(codeTool('agent'), undefined);
});

/* ====================================================================== */
/* generate_image                                                         */
/* ====================================================================== */

const image = (overrides = {}) => makeImageTool({
  resolveModel: () => ({ model: 'gemini-3-pro-image', name: 'Nano Banana Pro', apiKey: 'key' }),
  generate: async (request) => {
    image.lastRequest = request;
    return { mimeType: 'image/png', data: 'UE5H' };
  },
  ...overrides,
});

it('saves a generated image into the project under a path made from the prompt', async () => {
  const ctx = context({ '/assets/sunset-over-the-hills-warm.jpg': 'data:image/jpeg;base64,OLD' });
  const tool = image({ encode: async (picture, format) => ({ mimeType: `image/${format}`, data: `${picture.data}-${format}` }) });
  const result = await tool.run({ prompt: 'Sunset over the hills, warm film grain', aspect_ratio: '16:9' }, ctx);

  assert.equal(result.isError, undefined);
  assert.equal(result.step.path, '/assets/sunset-over-the-hills-warm-2.jpg', 'an existing file is not overwritten unasked');
  assert.equal(ctx.workspace.read('/assets/sunset-over-the-hills-warm-2.jpg'), 'data:image/jpeg;base64,UE5H-jpeg');
  assert.equal(image.lastRequest.aspectRatio, '16:9');
  assert.match(result.output, /Saved \/assets\/sunset-over-the-hills-warm-2\.jpg \(16:9, \d+ KB\), made with Nano Banana Pro/);

  const png = await tool.run({ prompt: 'App icon', path: '/public/icon.png' }, ctx);
  assert.match(ctx.workspace.read('/public/icon.png'), /^data:image\/png;base64,UE5H-png$/);
  assert.equal(png.step.path, '/public/icon.png');
});

it('tells the model plainly when there is no image model, and never substitutes one', async () => {
  const missing = makeImageTool({ resolveModel: () => ({ missing: 'No image was made: the user has no Gemini image model added.' }), generate: async () => assert.fail('must not generate') });
  const result = await missing.run({ prompt: 'A cat' }, context());
  assert.equal(result.isError, true);
  assert.match(result.output, /no Gemini image model added/);

  const bad = await image().run({ prompt: 'A cat', aspect_ratio: '7:5' }, context());
  assert.match(bad.output, /"7:5" is not an aspect ratio/);
});

/* ====================================================================== */
/* create_design                                                          */
/* ====================================================================== */

const SCREEN = "import React from 'react';\nimport { Check } from 'lucide-react';\nexport default function PricingPage() { return <div><Check /></div>; }\n";

it('puts a self-contained screen on the Design canvas', async () => {
  const placed = [];
  const tool = makeDesignTool({ addToCanvas: (design) => (placed.push(design), 'design-42') });
  const ctx = context({ '/Designs/PricingPage.tsx': SCREEN });
  const result = await tool.run({ path: '/Designs/PricingPage.tsx' }, ctx);

  assert.equal(result.isError, undefined);
  assert.deepEqual(placed, [{ name: 'Pricing Page', code: SCREEN, fileName: 'PricingPage' }]);
  assert.deepEqual([result.step.name, result.step.nodeId], ['Pricing Page', 'design-42']);
  assert.deepEqual(importedModules(SCREEN), ['react', 'lucide-react']);
});

it('refuses a design it cannot show, and says why', async () => {
  const tool = makeDesignTool({ addToCanvas: () => assert.fail('must not place'), validate: async () => 'Runtime errors:\n- boom' });
  const ctx = context({
    '/Designs/Card.tsx': "import { Card } from '../components/Card';\nexport default () => <Card />;\n",
    '/Designs/NoExport.tsx': 'const A = () => null;\n',
    '/Designs/Broken.tsx': SCREEN,
    '/components/Header.tsx': SCREEN,
  });
  assert.match((await tool.run({ path: '/Designs/Missing.tsx' }, ctx)).output, /There is no \/Designs\/Missing\.tsx yet/);
  assert.match((await tool.run({ path: '/components/Header.tsx' }, ctx)).output, /Designs live in \/Designs\//);
  assert.match((await tool.run({ path: '/Designs/NoExport.tsx' }, ctx)).output, /no default export/);
  assert.match((await tool.run({ path: '/Designs/Card.tsx' }, ctx)).output, /can only import react and lucide-react; .* imports \.\.\/components\/Card/);
  assert.match((await tool.run({ path: '/Designs/Broken.tsx' }, ctx)).output, /does not run on its own:\nRuntime errors/);
});

/* ====================================================================== */
/* The image client                                                       */
/* ====================================================================== */

it('asks Gemini for one image and returns it, with readable failures', async () => {
  const realFetch = globalThis.fetch;
  try {
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url: String(url), body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] }), { status: 200 });
    };
    const picture = await generateGeminiImage({ apiKey: 'k 1', model: 'gemini-3-pro-image', prompt: 'A fox', aspectRatio: '4:3' });
    assert.deepEqual(picture, { mimeType: 'image/png', data: 'AAAA' });
    assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=k%201');
    assert.deepEqual(request.body.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:3', imageSize: '1K' } });

    await generateGeminiImage({ apiKey: 'k', model: 'm', prompt: 'p', baseUrl: 'https://proxy.example/v1beta/' });
    assert.equal(request.url, 'https://proxy.example/v1beta/models/m:generateContent?key=k', 'a versioned base URL is not versioned twice');

    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429 });
    await assert.rejects(generateGeminiImage({ apiKey: 'k', model: 'm', prompt: 'p' }), /rate limited/);

    globalThis.fetch = async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 });
    await assert.rejects(generateGeminiImage({ apiKey: 'k', model: 'm', prompt: 'p' }), /safety/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ====================================================================== */
/* The testing skill                                                      */
/* ====================================================================== */

it('ships the app-testing skill, readable like any other and not shadowed by a user skill', async () => {
  const [testing] = BUILTIN_SKILLS;
  assert.equal(testing.id, APP_TESTING_SKILL_ID);
  for (const topic of ['"ref"', '"actions"', 'screenshot', 'Reporting', 'Never claim a check you did not do']) {
    assert.ok(testing.instructions.includes(topic), `the skill should cover ${topic}`);
  }

  const merged = withBuiltinSkills([{ id: 'app-testing', name: 'Mine', description: '', instructions: 'x', enabled: true }, { id: 'brand', name: 'Brand', description: '', instructions: 'y', enabled: true }]);
  assert.deepEqual(merged.map((skill) => skill.name), ['App testing', 'Brand']);

  const ctx = context();
  const [readSkill] = makeSkillTools(merged);
  const result = await readSkill.run({ name: 'skill://app-testing' }, ctx);
  assert.match(result.output, /# Testing the app in the preview/);
  assert.ok(ctx.readSkills.has('app-testing'), 'reading it is what unlocks the computer tool');
});
