// End-to-end check of the Media agent against a scripted fake Gemini, in a real Chrome.
//
//   node tools/scratch/media-agent-sim.mjs            (dev server on :3000 must be running)
//   ONLY=character-create,scene-from-selection node tools/scratch/media-agent-sim.mjs
//
// Runs in a temporary Chrome profile with a fake key. Every request to
// generativelanguage.googleapis.com is answered inside the page: turns follow a scripted
// "brain" per scenario, images are solid-colour PNGs, and Veo videos are
// assets/media-samples/Coffee.mp4. Nothing real is called. Screenshots and results.json go to
// SIM_OUT (default: %TEMP%/willow-media-agent-sim).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(REPO, 'package.json'));
const puppeteer = require('puppeteer');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = process.env.SIM_OUT || path.join(os.tmpdir(), 'willow-media-agent-sim');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const VIDEO_B64 = fs.readFileSync(path.join(REPO, 'assets/media-samples/Coffee.mp4')).toString('base64');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── In the page: fake keys, models and Gemini ────────────────────────────────
function installFakes() {
  // `stores()` finds modules by their resource entries; the default 250 drops the later ones.
  performance.setResourceTimingBufferSize(10000);
  localStorage.setItem('willow:apiKeys:guest', JSON.stringify({ gemini: ['FAKE-KEY'], openai: [], anthropic: [], moonshot: [], spacexai: [], zhipuai: [] }));
  const noImageModels = sessionStorage.getItem('__noImageModels') === '1';
  const added = (modelId, name) => ({ id: `sim-${modelId}`, modelId, name, thinkingLevel: 0, thinkingLabel: 'None' });
  localStorage.setItem('modelConfig', JSON.stringify({
    gemini: {
      model: 'gemini-3.7-flash',
      savedModels: [
        { id: 'sim-text', modelId: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', thinkingLevel: 3, thinkingLabel: 'High' },
        ...(noImageModels ? [] : [added('gemini-3-pro-image', 'Nano Banana Pro')]),
        added('veo-3.1-fast', 'Veo 3.1 Fast'),
      ],
    },
    openai: { savedModels: [] }, anthropic: { savedModels: [] }, moonshot: { savedModels: [] }, spacexai: { savedModels: [] }, zhipuai: { savedModels: [] },
    modelOrder: [],
  }));

  const realFetch = window.fetch.bind(window);
  const encoder = new TextEncoder();
  const sim = (window.__sim = { log: [], scenario: null, scenarios: {}, imageDelay: 500, imageFail: null, tokenDelay: 12, imageCount: 0, videoCount: 0 });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const textResponse = (text) => json({ candidates: [{ index: 0, content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] });
  const pngBase64 = (hue) => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    const g = c.getContext('2d');
    g.fillStyle = `hsl(${hue} 70% 50%)`;
    g.fillRect(0, 0, 320, 180);
    return c.toDataURL('image/png').split(',')[1];
  };
  // `thoughts` stream first as Gemini's thought summary, `thoughtDelay` apart.
  const planToChunks = (plan) => {
    const chunks = [];
    for (const text of plan.thoughts || []) {
      chunks.push({ candidates: [{ index: 0, content: { role: 'model', parts: [{ text, thought: true }] } }], __delay: plan.thoughtDelay });
    }
    const words = (plan.text || '').split(/(\s+)/);
    for (let i = 0; i < words.length; i += 6) {
      const text = words.slice(i, i + 6).join('');
      if (text) chunks.push({ candidates: [{ index: 0, content: { role: 'model', parts: [{ text }] } }] });
    }
    if (plan.calls?.length) {
      chunks.push({ candidates: [{ index: 0, content: { role: 'model', parts: plan.calls.map((c) => ({ functionCall: { name: c.name, args: c.args || {} } })) } }] });
    }
    chunks.push({ candidates: [{ index: 0, content: { role: 'model', parts: [] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } });
    return chunks;
  };
  const sse = (chunks, delay, signal) => new Response(new ReadableStream({
    async start(controller) {
      for (const { __delay, ...chunk } of chunks) {
        if (signal?.aborted) { controller.error(abortError()); return; }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`));
        await wait(__delay ?? delay);
      }
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('generativelanguage.googleapis.com')) return realFetch(input, init);
    const signal = init.signal;
    if (signal?.aborted) throw abortError();
    if (url.includes('/upload/')) return new Response('unavailable', { status: 503 });
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
    const model = (url.match(/models\/([^:?/]+)/) || [])[1] || '';

    if (url.includes(':streamGenerateContent')) {
      sim.log.push({ kind: 'stream', model, body, at: Date.now() });
      const plan = sim.scenario ? sim.scenario(body) : { text: 'OK.' };
      return sse(planToChunks(plan), sim.tokenDelay, signal);
    }
    if (url.includes(':predictLongRunning')) {
      const n = ++sim.videoCount;
      sim.log.push({ kind: 'video', model, body, at: Date.now() });
      return json({ name: `models/${model}/operations/op-${n}` });
    }
    if (/\/operations\/op-\d+/.test(url)) {
      const n = url.match(/op-(\d+)/)[1];
      return json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `https://generativelanguage.googleapis.com/v1beta/files/vid-${n}:download?alt=media` } }] } } });
    }
    if (url.includes(':download')) {
      const b64 = await window.__simVideoBytes();
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'video/mp4' } });
    }
    if (url.includes(':generateContent')) {
      const text = JSON.stringify(body.contents || '');
      if (body?.generationConfig?.responseModalities?.includes('IMAGE')) {
        sim.log.push({ kind: 'image', model, body, at: Date.now() });
        const n = ++sim.imageCount;
        await wait(sim.imageDelay);
        if (sim.imageFail) return json({ error: { code: 400, message: sim.imageFail } }, 400);
        return json({ candidates: [{ index: 0, content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: pngBase64((n * 53) % 360) } }] }, finishReason: 'STOP' }] });
      }
      if (text.includes('Rephrase this image generation prompt')) { sim.log.push({ kind: 'rename', model }); return textResponse('Named by the sim'); }
      if (model.includes('flash-lite')) { sim.log.push({ kind: 'title', model }); return textResponse('Sim Session'); }
      sim.log.push({ kind: 'analyze', model, body });
      return textResponse('A test image.');
    }
    sim.log.push({ kind: 'other', url });
    return json({ error: { code: 404, message: 'not faked' } }, 404);
  };

  // ── Scenario brains: what the fake model does on each request ──
  const lastParts = (body) => body.contents[body.contents.length - 1]?.parts || [];
  const responses = (body) => lastParts(body).filter((p) => p.functionResponse).map((p) => p.functionResponse);
  const sysOf = (body) => (body.systemInstruction?.parts || []).map((p) => p.text || '').join('\n');
  const idOf = (body, name) => sysOf(body).match(new RegExp(`- (character-[^\\s]+) · "${name}"`))?.[1];
  const sceneIdOf = (body, name) => sysOf(body).match(new RegExp(`- (scene-[^\\s]+) · "${name}"`))?.[1];
  const selectedVideos = (body) => {
    const sys = sysOf(body);
    const start = sys.indexOf('Selected in the gallery');
    if (start < 0) return [];
    const section = sys.slice(start, sys.indexOf('\n\n', start) < 0 ? undefined : sys.indexOf('\n\n', start));
    return [...section.matchAll(/- ([^\s]+) · video/g)].map((m) => m[1]);
  };
  const say = (text) => ({ text });
  sim.scenarios = {
    text: () => say('Hello! I can make images, videos, characters and scenes for this project.'),
    makeCharacter: (body) => (responses(body).length
      ? say(`Character result: ${responses(body)[0].response.result.status}.`)
      : {
          text: 'Creating Mira.',
          calls: [{ name: 'create_character', args: {
            name: 'Mira',
            description: 'A red-haired pilot in a worn leather flight jacket, freckles, green eyes, cinematic realism',
            personality: 'Brave, dry humour, talks fast when nervous',
            voice: 'Kore',
            full_body: true,
          } }],
        }),
    useCharacter: (body) => (responses(body).length
      ? say(`Image result: ${responses(body)[0].response.result.status} with ${(responses(body)[0].response.result.characters || []).join(', ')}.`)
      : { text: 'Making it.', calls: [{ name: 'generate_image', args: { prompt: 'Mira waving from the cockpit of a small plane at sunrise', character_ids: [idOf(body, 'Mira')], count: 1 } }] }),
    updateCharacter: (body) => (responses(body).length
      ? say(`Update result: ${responses(body)[0].response.result.status}.`)
      : { text: 'Changing her.', calls: [{ name: 'update_character', args: { character_id: idOf(body, 'Mira'), name: 'Captain Mira', change_look: 'short silver hair' } }] }),
    veoCharacter: (body) => (responses(body).length
      ? say(`Video result: ${responses(body)[0].response.result.status}.`)
      : { text: 'Filming.', calls: [{ name: 'generate_video', args: { prompt: 'She checks the instruments and says "Clear skies."', character_ids: [idOf(body, 'Captain Mira')], count: 1 } }] }),
    sceneFromSelection: (body) => (responses(body).length
      ? say(`Scene result: ${responses(body)[0].response.result.status}.`)
      : { text: 'Cutting them together.', calls: [{ name: 'create_scene', args: { clip_ids: selectedVideos(body), name: 'Coffee cut' } }] }),
    updateScene: (body) => {
      if (responses(body).length) return say(`Update result: ${responses(body)[0].response.result.status}.`);
      const sys = sysOf(body);
      const line = sys.split('\n').find((l) => l.includes('"Coffee cut"'));
      const clipsLine = sys.split('\n')[sys.split('\n').indexOf(line) + 1] || '';
      const ids = [...clipsLine.matchAll(/\d+\. ([^\s]+) "/g)].map((m) => m[1]);
      return { text: 'Reordering.', calls: [{ name: 'update_scene', args: { scene_id: sceneIdOf(body, 'Coffee cut'), name: 'Coffee cut v2', clip_ids: [...ids].reverse(), add_clip_ids: [ids[0]] } }] };
    },
    storyboard: (body) => {
      const rs = responses(body);
      if (!rs.length) {
        return { text: 'Shooting two shots.', calls: [
          { name: 'generate_video', args: { prompt: 'Shot 1: a coffee cup steams on a wooden table', count: 1 } },
          { name: 'generate_video', args: { prompt: 'Shot 2: a hand lifts the cup', count: 1 } },
        ] };
      }
      if (rs[0].name === 'generate_video') {
        const ids = rs.map((r) => r.response.result.items?.[0]?.id).filter(Boolean);
        return { text: 'Cutting them together.', calls: [{ name: 'create_scene', args: { clip_ids: ids, name: 'Morning coffee' } }] };
      }
      return say(`Scene result: ${rs[0].response.result.status}.`);
    },
    characterNoModel: (body) => (responses(body).length
      ? say(`Character result: ${responses(body)[0].response.result.status}.`)
      : { text: 'Trying.', calls: [{ name: 'create_character', args: { name: 'Nobody', description: 'A test person' } }] }),
    approvalCharacter: (body) => (responses(body).length
      ? say(`Character result: ${responses(body)[0].response.result.status}.`)
      : { text: 'Asking first.', calls: [{ name: 'create_character', args: { name: 'Kai', description: 'A tall mechanic in grease-stained overalls' } }] }),
    mentionEcho: () => say('Got it.'),
    lookTurn: (body) => (responses(body).length
      ? { thoughts: ['**Checking the results**\n\nBoth images finished.\n\n'], thoughtDelay: 3500, text: 'Here are two lighthouse shots.' }
      : {
          thoughts: ['**Reading the request**\n\nThe user wants a lighthouse at dusk.\n\n', '**Planning two shots**\n\nTwo takes of the same view.\n\n'],
          thoughtDelay: 3500,
          text: 'Making two lighthouse shots.',
          calls: [{ name: 'generate_image', args: { prompt: 'An old stone lighthouse on a cliff at dusk', count: 2 } }],
        }),
    listEverything: (body) => (responses(body).length
      ? say('Listed.')
      : { text: 'Looking.', calls: [{ name: 'list_media', args: { kind: 'character' } }, { name: 'list_media', args: { kind: 'scene' } }] }),
    // A character made between two stretches of text, then an image of it: its card goes where it was made.
    characterThenImage: (body) => {
      const rs = responses(body);
      if (!rs.length) return { text: 'Here is the plan for Lio.', calls: [{ name: 'create_character', args: { name: 'Lio', description: 'A young lighthouse keeper in a wool cap and a yellow raincoat, cinematic realism' } }] };
      if (rs[0].name === 'create_character') {
        return { text: 'Now a shot of him at work.', calls: [{ name: 'generate_image', args: { prompt: 'Lio polishing the lighthouse lamp at night', character_ids: [rs[0].response.result.character?.id].filter(Boolean), count: 1 } }] };
      }
      return say('All done with Lio.');
    },
    // Three shots one after another, slow enough to be stopped during the second.
    threeShots: (body) => {
      const lastAsk = body.contents.map((c, i) => ({ c, i })).filter(({ c }) => c.role === 'user' && (c.parts || []).some((p) => typeof p.text === 'string')).pop()?.i ?? 0;
      const done = body.contents.slice(lastAsk).flatMap((c) => c.parts || []).filter((p) => p.functionResponse).length;
      if (done >= 3) return say('All three shots are done.');
      return { text: `Shot ${done + 1} of 3.`, calls: [{ name: 'generate_image', args: { prompt: `Lighthouse shot ${done + 1}: the beam sweeping over the sea`, count: 1 } }] };
    },
    continueEcho: () => say('Picking up where I stopped.'),
    longReply: () => say(Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1}: a harbour wakes slowly, boats knock against the pier, gulls circle the masts and the mist lifts off the water as the light comes up over the hills.`).join('\n\n')),
    fourShots: (body) => (responses(body).length
      ? say('Four shots of the harbour.')
      : { text: 'Making four shots of the harbour.', calls: [{ name: 'generate_image', args: { prompt: 'A small harbour at dawn, fishing boats, mist', count: 4 } }] }),
  };
}

// ── In the page: a seeded project of images and two clips ───────────────────
async function seedProject(page) {
  return page.evaluate(async (videoB64) => {
    const urls = performance.getEntriesByType('resource').map((e) => e.name);
    const find = (s) => urls.find((u) => u.includes(s));
    const reg = await import(find('/platform/projects/src/registry.ts'));
    const ms = await import(find('/platform/storage/src/media-storage.ts'));
    const now = Date.now();
    const id = 'agent-sim';
    reg.writeProjectRegistry([{ id, name: 'Agent Sim', kind: 'media', createdAt: now, updatedAt: now }]);
    const items = [];
    for (let i = 0; i < 6; i++) {
      const c = document.createElement('canvas');
      c.width = 384; c.height = 216;
      const g = c.getContext('2d');
      g.fillStyle = `hsl(${i * 60} 70% 45%)`;
      g.fillRect(0, 0, 384, 216);
      items.push({ id: `seed-${i}`, kind: 'image', status: 'completed', url: c.toDataURL('image/png'), prompt: `Seed image ${i}`, shortenedPrompt: `Seed ${i}`, modelId: 'gemini-3-pro-image', modelName: 'Nano Banana Pro', ratio: '16:9', timestamp: now - (i + 10) * 1000 });
    }
    const video = `data:video/mp4;base64,${videoB64}`;
    items.push({ id: 'clip-early', kind: 'video', status: 'completed', url: video, prompt: 'Early coffee clip', shortenedPrompt: 'Early coffee', modelId: 'veo-3.1-fast', modelName: 'Veo 3.1 Fast', ratio: '16:9', timestamp: now - 5000 });
    items.push({ id: 'clip-late', kind: 'video', status: 'completed', url: video, prompt: 'Late coffee clip', shortenedPrompt: 'Late coffee', modelId: 'veo-3.1-fast', modelName: 'Veo 3.1 Fast', ratio: '16:9', timestamp: now - 4000 });
    await ms.saveProjectMedia(id, items);
    return id;
  }, VIDEO_B64);
}

const S = '.agent-sidebar-container';
const PROMPT_BOX = 'textarea[placeholder="What do you want to create?"]';
const results = [];

async function scenario(page, name, fn) {
  if (ONLY && !ONLY.includes(name)) return;
  const problems = [];
  const check = (cond, msg) => { if (!cond) problems.push(msg); };
  try {
    await fn(check);
  } catch (error) {
    problems.push(`threw: ${String(error?.message || error).slice(0, 300)}`);
    if (process.env.DEBUG_SIM) console.log(error?.stack);
  }
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  results.push({ name, ok: problems.length === 0, problems });
  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${name}${problems.length ? `\n      - ${problems.join('\n      - ')}` : ''}`);
}

const setScenario = (page, name, extra = {}) => page.evaluate((name, extra) => {
  Object.assign(window.__sim, extra);
  window.__sim.scenario = window.__sim.scenarios[name];
}, name, extra);
const lastLog = (page, kind) => page.evaluate((kind) => window.__sim.log.filter((l) => l.kind === kind).at(-1), kind);
const logCount = (page, kind) => page.evaluate((kind) => window.__sim.log.filter((l) => l.kind === kind).length, kind);
const lastResult = (page) => page.evaluate(() => {
  const req = window.__sim.log.filter((l) => l.kind === 'stream').at(-1);
  return req?.body.contents.at(-1).parts.filter((p) => p.functionResponse).map((p) => p.functionResponse.response.result);
});
const lastSystemPrompt = (page) => page.evaluate(() => {
  const req = window.__sim.log.filter((l) => l.kind === 'stream').at(-1);
  return (req?.body.systemInstruction?.parts || []).map((p) => p.text || '').join('\n');
});
const sidebarState = (page) => page.evaluate((S) => {
  const root = document.querySelector(S);
  const rows = [...root.querySelectorAll('[id^="media-agent-message-"]')];
  const lastRow = rows[rows.length - 1];
  return {
    visible: getComputedStyle(root).visibility === 'visible',
    rows: rows.length,
    lastText: lastRow ? lastRow.innerText : '',
    characterCards: lastRow ? [...lastRow.querySelectorAll('button[aria-label^="Open "]')].filter((b) => !b.getAttribute('aria-label').includes('Scenebuilder')).map((b) => ({ label: b.getAttribute('aria-label'), img: !!b.querySelector('img'), liquid: !!b.querySelector('.mesh-container-generating') })) : [],
    sceneCards: lastRow ? [...lastRow.querySelectorAll('button[aria-label$="in the Scenebuilder"]')].map((b) => ({ label: b.getAttribute('aria-label'), text: b.innerText })) : [],
    mediaCards: lastRow ? lastRow.querySelectorAll('.smd-media-card').length : 0,
    stopButton: !!root.querySelector('button[title="Stop"]'),
  };
}, S);
const stores = (page) => page.evaluate(async () => {
  const urls = performance.getEntriesByType('resource').map((e) => e.name);
  const find = (s) => urls.find((u) => u.includes(s));
  const chars = await import(find('/features/media/src/characters/character-store.ts'));
  const scenes = await import(find('/features/media/src/scenes/scene-store.ts'));
  return {
    characters: chars.$characters.get(),
    scenes: scenes.$scenes.get().map(({ poster, ...s }) => ({ ...s, hasPoster: !!poster, clips: s.clips.map(({ thumb, ...c }) => ({ ...c, hasThumb: !!thumb })) })),
    items: (window.canvasMediaItems || []).map(({ url, attachments, ...m }) => ({ ...m, hasUrl: !!url, attachmentCount: attachments?.length || 0 })),
  };
});
async function sendInSidebar(page, text) {
  await page.evaluate((S) => document.querySelector(`${S} textarea[placeholder="What do you want to create?"]`).focus(), S);
  await page.keyboard.type(text, { delay: 3 });
  await page.keyboard.press('Enter');
}
/** The main composer's field: a contenteditable textbox (PromptEditor), not the sidebar's textarea. */
const focusMainPrompt = (page) => page.evaluate((S) => {
  const box = [...document.querySelectorAll('[role="textbox"][aria-label="What do you want to create?"]')].find((t) => !t.closest(S));
  box?.focus();
  return !!box;
}, S);
// The reply's last words fade in after the turn ends, so give the reveal time to finish.
const waitIdle = async (page, timeout = 30000) => {
  await sleep(400);
  await page.waitForFunction((S) => !document.querySelector(`${S} button[title="Stop"]`), { timeout }, S);
  await sleep(1500);
};
const newChat = async (page) => {
  await page.evaluate((S) => document.querySelector(`${S} button[title="New chat"]`).click(), S);
  await sleep(400);
};
const galleryCount = (page) => page.evaluate(() => document.querySelectorAll('.gallery-tile').length);
const clickNav = (page, label) => page.evaluate((label) => {
  const el = [...document.querySelectorAll('a, button, [role="button"], [role="link"]')]
    .find((e) => e.innerText.trim().split('\n').pop().toLowerCase() === label.toLowerCase());
  el?.click();
  return !!el;
}, label);
/** A marquee from the gap after the last tile back over the first, as a user drags one. */
async function marqueeSelect(page, ids) {
  const rects = await page.evaluate((ids) => ids.map((id) => document.querySelector(`.gallery-tile[data-id="${id}"]`)?.getBoundingClientRect().toJSON()), ids);
  if (rects.some((r) => !r)) throw new Error(`tiles not found: ${JSON.stringify(rects)}`);
  const top = Math.max(...rects.map((r) => r.top)) + 20;
  const bottom = Math.min(...rects.map((r) => r.bottom)) - 20;
  const right = Math.max(...rects.map((r) => r.right));
  const left = Math.min(...rects.map((r) => r.left));
  const start = await page.evaluate((right, y) => {
    for (let x = right + 1; x < right + 40; x++) {
      const el = document.elementFromPoint(x, y);
      if (el && !el.closest('.gallery-tile, button, a, [role="button"], input, textarea')) return { x, y };
    }
    return null;
  }, right, top);
  if (!start) throw new Error('no empty point beside the tiles to start a marquee from');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(left + 15, bottom, { steps: 12 });
  await sleep(150);
  await page.mouse.up();
  await sleep(300);
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-media-agent-sim-'));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--window-size=1440,980', '--no-first-run', '--no-default-browser-check'],
  protocolTimeout: 600000,
});
const pageErrors = [];
try {
  const page = await browser.newPage();
  await page.exposeFunction('__simVideoBytes', () => VIDEO_B64);
  await page.evaluateOnNewDocument(installFakes);
  page.on('pageerror', (err) => { pageErrors.push(String(err)); console.log('[pageerror]', String(err).slice(0, 400)); });
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/Invalid DOM property|Failed to load resource|favicon|net::ERR/.test(t)) console.log('[console.error]', t.slice(0, 300));
  });

  await page.goto(`${BASE}/media`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector(PROMPT_BOX, { timeout: 180000 });
  await sleep(1500);
  const projectId = await seedProject(page);
  await page.goto(`${BASE}/media?projectId=${projectId}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => document.querySelectorAll('.gallery-tile').length >= 8, { timeout: 120000 });
  await sleep(3000);

  await scenario(page, 'basics', async (check) => {
    await setScenario(page, 'text');
    await page.evaluate(() => document.querySelector('button.agent-pill').click());
    check(await focusMainPrompt(page), 'no main prompt box');
    await page.keyboard.type('hi there', { delay: 5 });
    await page.keyboard.press('Enter');
    await waitIdle(page);
    const s = await sidebarState(page);
    check(s.visible, 'the sidebar did not open');
    check(s.rows === 2 && /make images, videos, characters and scenes/.test(s.lastText), `reply missing: ${s.lastText.slice(0, 120)}`);
    const req = await lastLog(page, 'stream');
    const declared = req.body.tools?.flatMap((t) => t.functionDeclarations || []).map((d) => d.name).sort() || [];
    check(JSON.stringify(declared) === JSON.stringify(['analyze_media', 'create_character', 'create_scene', 'generate_image', 'generate_video', 'list_media', 'update_character', 'update_scene']), `declared: ${declared.join(', ')}`);
    const sys = await lastSystemPrompt(page);
    for (const section of ['On screen now', 'Working with characters', 'Working with scenes', 'Characters\nNone yet.', 'Scenes\nNone yet.']) {
      check(sys.includes(section), `system prompt lacks "${section.split('\n')[0]}"`);
    }
    check(/- clip-late · video · 16:9 · "Late coffee"/.test(sys), 'the seeded clips are not in the inventory');
    const inline = req.body.contents.at(-1).parts.filter((p) => p.inlineData).length;
    check(inline === 6, `expected the 6 seeded images as thumbnails, got ${inline}`);
  });

  await scenario(page, 'look', async (check) => {
    await newChat(page);
    await setScenario(page, 'lookTurn', { imageDelay: 3500 });
    await sendInSidebar(page, 'Make two cinematic shots of an old stone lighthouse on a cliff at dusk, waves breaking below, warm light in the lamp room, a small fishing boat heading home, gulls in the wind, soft fog rolling in from the sea, shot on 35mm film with gentle grain and a muted teal and amber palette.');
    const heading = () => page.evaluate((S) => document.querySelector(`${S} .agent-thinking-row .thought-summary-line`)?.textContent || '', S);
    const waitHeading = (text, timeout) => page.waitForFunction((S, text) => document.querySelector(`${S} .agent-thinking-row .thought-summary-line`)?.textContent === text, { timeout }, S, text).catch(() => {});

    await waitHeading('Reading the request', 8000);
    const thinking = await page.evaluate((S) => ({
      dots: !!document.querySelector(`${S} .agent-thinking-row .gemini-thinking-visualizer svg`),
      lightbulb: !!document.querySelector(`${S} .lucide-lightbulb`),
      staticLabel: /Thinking\.\.\./.test(document.querySelector(S).innerText),
    }), S);
    await page.screenshot({ path: path.join(OUT, 'look-thinking.png') });
    check(thinking.dots, 'no thinking dots while the model thinks');
    check((await heading()) === 'Reading the request', `first thought heading: "${await heading()}"`);
    check(!thinking.lightbulb && !thinking.staticLabel, 'the lightbulb or the static "Thinking..." is still shown');
    await waitHeading('Planning two shots', 9000);
    check((await heading()) === 'Planning two shots', `second thought heading: "${await heading()}"`);

    await page.waitForFunction((S) => document.querySelectorAll(`${S} .smd-media-card`).length >= 2, { timeout: 15000 }, S).catch(() => {});
    await sleep(600);
    const generating = await page.evaluate((S) => {
      const root = document.querySelector(S);
      return { cards: root.querySelectorAll('.smd-media-card').length, lines: /Generating \d+ images?/.test(root.innerText), row: !!root.querySelector('.agent-thinking-row') };
    }, S);
    await page.screenshot({ path: path.join(OUT, 'look-generating.png') });
    check(generating.cards === 2, `cards while generating: ${generating.cards}`);
    check(!generating.lines, 'a "Generating..." line is still shown under the cards');
    check(!generating.row, 'the thinking row shows under cards that are generating');

    await waitHeading('Checking the results', 15000);
    check((await heading()) === 'Checking the results', `the next round's heading: "${await heading()}"`);
    await waitIdle(page);

    const bubble = () => page.evaluate((S) => {
      const b = [...document.querySelectorAll(`${S} .agent-user-bubble`)].pop();
      const clip = b?.querySelector('.overflow-hidden');
      const text = clip?.firstElementChild;
      const reply = [...document.querySelectorAll(`${S} .smd-root`)].pop();
      const t = text ? getComputedStyle(text) : null;
      const r = reply ? getComputedStyle(reply) : null;
      return {
        shown: clip ? Math.round(clip.getBoundingClientRect().height) : 0,
        natural: text ? Math.round(text.getBoundingClientRect().height) : 0,
        expand: !!b?.querySelector('button[aria-label="Expand"]'),
        collapse: !!b?.querySelector('button[aria-label="Collapse"]'),
        font: t && `${t.fontFamily} ${t.fontSize}/${t.lineHeight} ${t.fontVariationSettings}`,
        replyFont: r && `${r.fontFamily} ${r.fontSize}/${r.lineHeight} ${r.fontVariationSettings}`,
      };
    }, S);
    const folded = await bubble();
    await page.screenshot({ path: path.join(OUT, 'look-collapsed.png') });
    check(folded.expand && folded.shown === 96 && folded.natural > 96, `the long prompt is not folded to four lines: ${JSON.stringify(folded)}`);
    check(folded.font === folded.replyFont && /Google Sans Flex/.test(folded.font || ''), `the prompt and the reply differ in type: ${folded.font} vs ${folded.replyFont}`);
    await page.evaluate((S) => [...document.querySelectorAll(`${S} .agent-user-bubble button[aria-label="Expand"]`)].pop()?.click(), S);
    await sleep(500);
    const open = await bubble();
    await page.screenshot({ path: path.join(OUT, 'look-expanded.png') });
    check(open.collapse && open.shown >= open.natural, `expanding did not show the whole prompt: ${JSON.stringify(open)}`);
    await page.evaluate((S) => [...document.querySelectorAll(`${S} .agent-user-bubble button[aria-label="Collapse"]`)].pop()?.click(), S);
    await sleep(500);
    check((await bubble()).shown === 96, 'collapsing did not fold the prompt again');
  });

  await scenario(page, 'character-create', async (check) => {
    await newChat(page);
    await setScenario(page, 'makeCharacter', { imageDelay: 700 });
    const tilesBefore = await galleryCount(page);
    const imagesBefore = await logCount(page, 'image');
    await sendInSidebar(page, 'Make me a character: a red-haired pilot called Mira, with a full-body shot');
    await page.waitForFunction((S) => [...document.querySelectorAll(`${S} button[aria-label="Open Mira"]`)].length > 0, { timeout: 8000 }, S).catch(() => {});
    const mid = await sidebarState(page);
    check(mid.characterCards.some((c) => c.liquid), `no generating character card while the portrait rendered: ${JSON.stringify(mid.characterCards)}`);
    await waitIdle(page, 30000);
    const s = await sidebarState(page);
    const { characters, items } = await stores(page);
    const mira = characters.find((c) => c.name === 'Mira');
    check(!!mira, `no character named Mira: ${JSON.stringify(characters.map((c) => c.name))}`);
    check(mira?.voice?.name === 'Kore' && /Brave/.test(mira?.personality || '') && /red-haired pilot/.test(mira?.prompt || ''), `fields not saved: ${JSON.stringify(mira)}`);
    const portrait = items.find((m) => m.id === mira?.portraitId);
    const body = items.find((m) => m.id === mira?.bodyId);
    check(portrait?.status === 'completed' && portrait?.characterId === mira?.id, `portrait not finished: ${JSON.stringify(portrait)}`);
    check(body?.status === 'completed' && body?.characterId === mira?.id, `full body not finished: ${JSON.stringify(body)}`);
    const requests = await page.evaluate((n) => window.__sim.log.filter((l) => l.kind === 'image').slice(n).map((l) => ({
      text: l.body.contents[0].parts.find((p) => p.text)?.text || '',
      refs: l.body.contents[0].parts.filter((p) => p.inlineData).length,
    })), imagesBefore);
    check(requests.length === 2, `expected 2 image requests (portrait, full body), saw ${requests.length}`);
    check(/^Full body shot, head to toe/.test(requests[1]?.text || '') && requests[1]?.refs === 1, `the full-body request did not reference the portrait: ${JSON.stringify(requests[1])}`);
    check((await galleryCount(page)) === tilesBefore, 'character images leaked into the gallery grid');
    check(s.characterCards.length === 1 && s.characterCards[0].img, `expected one finished character card: ${JSON.stringify(s.characterCards)}`);
    const [result] = await lastResult(page);
    check(result?.status === 'completed' && result?.character?.portrait?.status === 'ready' && result?.character?.full_body?.status === 'ready', `bad result: ${JSON.stringify(result).slice(0, 300)}`);
    check(!JSON.stringify(result).includes('data:'), 'a tool result carried file bytes');
  });

  await scenario(page, 'character-in-image', async (check) => {
    await setScenario(page, 'useCharacter', { imageDelay: 400 });
    const tilesBefore = await galleryCount(page);
    await sendInSidebar(page, 'Now show Mira waving from her cockpit');
    await waitIdle(page, 30000);
    const sys = await page.evaluate(() => (window.__sim.log.filter((l) => l.kind === 'stream').at(-2).body.systemInstruction.parts || []).map((p) => p.text).join('\n'));
    check(/- character-[^\s]+ · "Mira" · portrait and full body ready · voice Kore \(female, firm, mid pitch\)/.test(sys), 'Mira is not listed with her images and voice');
    check(/Info: Brave, dry humour/.test(sys), "Mira's info is not in the prompt");
    const req = await lastLog(page, 'image');
    const parts = req.body.contents[0].parts;
    const text = parts.find((p) => p.text)?.text || '';
    check(parts.filter((p) => p.inlineData).length === 2, `expected portrait and full body as references, got ${parts.filter((p) => p.inlineData).length}`);
    check(/- Mira: reference images 1–2\./.test(text) && /^Mira waving from the cockpit/.test(text), `cast note missing: ${text.slice(0, 300)}`);
    const [result] = await lastResult(page);
    check(result?.status === 'completed' && JSON.stringify(result?.characters) === '["Mira"]', `bad result: ${JSON.stringify(result).slice(0, 200)}`);
    check((await galleryCount(page)) === tilesBefore + 1, 'the image did not reach the gallery');
    const { items } = await stores(page);
    const made = items.find((m) => m.id === result?.items?.[0]?.id);
    check(made && made.prompt === 'Mira waving from the cockpit of a small plane at sunrise', `the tile should keep the agent's prompt, not the cast note: ${made?.prompt}`);
    const firstTurn = await page.evaluate(() => window.__sim.log.filter((l) => l.kind === 'stream').at(-2).body.contents.at(-1).parts);
    check(firstTurn.some((p) => p.text && /portrait of character character-[^\s]+ "Mira"/.test(p.text)), "Mira's portrait was not sent as labelled context");
  });

  await scenario(page, 'character-update', async (check) => {
    await setScenario(page, 'updateCharacter', { imageDelay: 400 });
    const before = (await stores(page)).characters.find((c) => c.name === 'Mira');
    await sendInSidebar(page, 'Rename her Captain Mira and give her short silver hair');
    await waitIdle(page, 30000);
    const { characters, items } = await stores(page);
    const mira = characters.find((c) => c.id === before?.id);
    check(mira?.name === 'Captain Mira', `not renamed: ${mira?.name}`);
    const portrait = items.find((m) => m.id === mira?.portraitId);
    check(mira?.portraitId !== before?.portraitId && portrait?.historyParentId === before?.portraitId && portrait?.status === 'completed', `the new look is not a new version of the portrait: ${JSON.stringify(portrait)}`);
    const req = await lastLog(page, 'image');
    check(req.body.contents[0].parts.filter((p) => p.inlineData).length === 1 && /short silver hair/.test(req.body.contents[0].parts.find((p) => p.text)?.text || ''), 'the edit did not reference the old portrait');
    const s = await sidebarState(page);
    check(s.characterCards.some((c) => c.label === 'Open Captain Mira'), `card not renamed: ${JSON.stringify(s.characterCards)}`);
  });

  await scenario(page, 'scene-from-selection', async (check) => {
    await newChat(page);
    check(await clickNav(page, 'Video'), 'no Video tab in the sidebar');
    await page.waitForFunction(() => location.pathname.endsWith('/video') && document.querySelectorAll('.gallery-tile').length >= 2, { timeout: 15000 });
    await sleep(800);
    await marqueeSelect(page, ['clip-late', 'clip-early']);
    const selected = await page.evaluate(() => [...document.querySelectorAll('.gallery-tile')].filter((t) => /ring|selected/i.test(t.className)).length);
    await setScenario(page, 'sceneFromSelection');
    await sendInSidebar(page, 'Put these two in a scene called Coffee cut');
    await waitIdle(page, 30000);
    const sys = await page.evaluate(() => (window.__sim.log.filter((l) => l.kind === 'stream').at(-2).body.systemInstruction.parts || []).map((p) => p.text).join('\n'));
    check(/- Tab: Videos\./.test(sys), 'the tab is not on screen');
    check(/Selected in the gallery \(2\), oldest first:\n {2}- clip-early · video[^\n]*\n {2}- clip-late · video/.test(sys), `the selection is not on screen in order (tiles marked selected: ${selected}): ${sys.slice(sys.indexOf('On screen now'), sys.indexOf('On screen now') + 400)}`);
    const sent = await page.evaluate(() => window.__sim.log.filter((l) => l.kind === 'stream').at(-2).body.contents.at(-1).parts);
    check(sent.some((p) => p.text && /\[The user attached: video clip-(early|late) "/.test(p.text)), 'the selected clip did not reach the agent by ID');
    check(!sent.some((p) => p.inlineData?.mimeType?.startsWith('video/')), 'video bytes went out with the message');
    const { scenes } = await stores(page);
    const scene = scenes.find((x) => x.name === 'Coffee cut');
    check(scene && JSON.stringify(scene.clips.map((c) => c.mediaId)) === '["clip-early","clip-late"]', `scene clips: ${JSON.stringify(scene?.clips)}`);
    check(scene?.clips.every((c) => c.trimEnd > 1 && c.hasThumb) && scene?.hasPoster, 'the clips were not read (duration, thumbnails, poster)');
    const s = await sidebarState(page);
    check(s.sceneCards.length === 1 && /2 clips/.test(s.sceneCards[0].text), `scene card: ${JSON.stringify(s.sceneCards)}`);
    const [result] = await lastResult(page);
    check(result?.status === 'completed' && result?.scene?.clips?.length === 2, `bad result: ${JSON.stringify(result).slice(0, 300)}`);
    await clickNav(page, 'All media');
    await sleep(800);
  });

  await scenario(page, 'scene-update', async (check) => {
    await setScenario(page, 'updateScene');
    const before = (await stores(page)).scenes.find((x) => x.name === 'Coffee cut');
    const trimmed = before ? { ...before.clips[0], trimStart: 1.5 } : null;
    if (before) {
      await page.evaluate(async (sceneId, clipId) => {
        const urls = performance.getEntriesByType('resource').map((e) => e.name);
        const store = await import(urls.find((u) => u.includes('/features/media/src/scenes/scene-store.ts')));
        store.updateScene(sceneId, (s) => ({ clips: s.clips.map((c) => (c.id === clipId ? { ...c, trimStart: 1.5 } : c)) }));
      }, before.id, trimmed.id);
    }
    await sendInSidebar(page, 'Rename it Coffee cut v2, swap the order and add the first clip again at the end');
    await waitIdle(page, 30000);
    const scene = (await stores(page)).scenes.find((x) => x.id === before?.id);
    check(scene?.name === 'Coffee cut v2', `not renamed: ${scene?.name}`);
    check(JSON.stringify(scene?.clips.map((c) => c.mediaId)) === '["clip-late","clip-early","clip-early"]', `order: ${JSON.stringify(scene?.clips.map((c) => c.mediaId))}`);
    const kept = scene?.clips.find((c) => c.id === trimmed?.id);
    check(kept && kept.trimStart === 1.5, `the trimmed clip lost its trim: ${JSON.stringify(kept)}`);
  });

  await scenario(page, 'list-everything', async (check) => {
    await setScenario(page, 'listEverything');
    await sendInSidebar(page, 'What characters and scenes do I have?');
    await waitIdle(page);
    const [characters, scenes] = await lastResult(page);
    check(characters?.items?.some((c) => c.kind === 'character' && c.name === 'Captain Mira' && c.portrait === 'ready'), `characters: ${JSON.stringify(characters).slice(0, 200)}`);
    check(scenes?.items?.some((s) => s.kind === 'scene' && s.name === 'Coffee cut v2' && s.clips === 3), `scenes: ${JSON.stringify(scenes).slice(0, 200)}`);
  });

  await scenario(page, 'scene-from-new-videos', async (check) => {
    await newChat(page);
    await setScenario(page, 'storyboard');
    const videosBefore = await logCount(page, 'video');
    await sendInSidebar(page, 'Storyboard two shots of a morning coffee and put them in a scene');
    await waitIdle(page, 60000);
    const starts = await page.evaluate((n) => window.__sim.log.filter((l) => l.kind === 'video').slice(n).map((l) => ({ at: l.at, prompt: l.body.instances?.[0]?.prompt })), videosBefore);
    check(starts.length === 2, `expected 2 Veo requests, saw ${starts.length}`);
    check(starts.length === 2 && Math.abs(starts[0].at - starts[1].at) < 1500, 'the two shots did not render at the same time');
    const { scenes, items } = await stores(page);
    const scene = scenes.find((x) => x.name === 'Morning coffee');
    const prompts = (scene?.clips || []).map((c) => items.find((m) => m.id === c.mediaId)?.prompt || '?');
    check(scene?.clips.length === 2 && /^Shot 1/.test(prompts[0]) && /^Shot 2/.test(prompts[1]), `scene clips out of story order: ${JSON.stringify(prompts)}`);
    const s = await sidebarState(page);
    check(s.mediaCards === 2 && s.sceneCards.length === 1, `expected 2 video cards and a scene card: ${s.mediaCards} / ${s.sceneCards.length}`);

    // Finished videos hold still until hovered, as canvas tiles do.
    const playing = () => page.evaluate((S) => [...document.querySelectorAll(`${S} .smd-media-card video`)].map((v) => !v.paused), S);
    await page.mouse.move(5, 5);
    await sleep(800);
    const atRest = await playing();
    check(atRest.length === 2 && atRest.every((p) => !p), `videos playing in the sidebar with nothing hovered: ${JSON.stringify(atRest)}`);
    const box = await page.evaluate((S) => {
      const card = document.querySelector(`${S} .smd-media-card`);
      card?.scrollIntoView({ block: 'center' });
      return card?.getBoundingClientRect().toJSON();
    }, S);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await sleep(1000);
    const onFirst = await playing();
    check(onFirst[0] === true && onFirst[1] === false, `hovering the first card should play it alone: ${JSON.stringify(onFirst)}`);
    await page.mouse.move(5, 5, { steps: 4 });
    await sleep(500);
    check((await playing()).every((p) => !p), 'a video kept playing after the pointer left it');
  });

  await scenario(page, 'veo-character', async (check) => {
    await setScenario(page, 'veoCharacter');
    const videosBefore = await logCount(page, 'video');
    await sendInSidebar(page, 'Make a short video of Captain Mira checking her instruments');
    await waitIdle(page, 60000);
    const req = await page.evaluate((n) => window.__sim.log.filter((l) => l.kind === 'video')[n], videosBefore);
    const prompt = req?.body.instances?.[0]?.prompt || '';
    check(!req?.body.instances?.[0]?.image, 'a Veo request carried a character image as its opening frame');
    check(/- Captain Mira: A red-haired pilot/.test(prompt) && /acts: Brave/.test(prompt) && /voice: Kore/.test(prompt), `Veo was not told the character in words: ${prompt.slice(0, 400)}`);
    const [result] = await lastResult(page);
    check(/make the opening frame with generate_image/.test(result?.character_note || ''), `no keyframe advice in the result: ${JSON.stringify(result).slice(0, 300)}`);
  });

  await scenario(page, 'cards-survive-history', async (check) => {
    await page.evaluate((S) => document.querySelector(`${S} button[title="Chat history"]`).click(), S);
    await sleep(900);
    const opened = await page.evaluate((S) => {
      const rows = [...document.querySelectorAll(`${S} [role="button"]`)];
      const row = rows.find((r) => /character/i.test(r.innerText) || /Mira/.test(r.innerText)) || rows[rows.length - 2];
      row?.click();
      return row?.innerText.split('\n').slice(0, 2).join(' / ');
    }, S);
    await sleep(1500);
    const cards = await page.evaluate((S) => [...document.querySelectorAll(`${S} button[aria-label^="Open "]`)].map((b) => b.getAttribute('aria-label')), S);
    check(cards.some((c) => /Mira/.test(c)), `reopened chat (${opened}) shows no character card: ${JSON.stringify(cards)}`);
  });

  await scenario(page, 'approve-character', async (check) => {
    const setConfirm = async (label) => {
      await page.evaluate((S) => document.querySelector(`${S} button[title="Agent settings"]`).click(), S);
      await sleep(700);
      const found = await page.evaluate((S, label) => {
        const option = [...document.querySelectorAll(`${S} button`)].find((b) => b.innerText.trim().startsWith(label));
        option?.click();
        return !!option;
      }, S, label);
      await sleep(300);
      await page.evaluate((S) => [...document.querySelectorAll(`${S} span`)].find((s) => s.textContent === 'Agent settings')?.previousElementSibling?.click(), S);
      await sleep(700);
      return found;
    };
    check(await setConfirm('Always'), 'no Always option in the agent settings');
    await newChat(page);
    const before = (await stores(page)).characters.length;
    const imagesBefore = await logCount(page, 'image');
    await setScenario(page, 'approvalCharacter');
    await sendInSidebar(page, 'Make a character called Kai');
    await page.waitForFunction((S) => [...document.querySelectorAll(`${S} button`)].some((b) => b.innerText.trim() === 'Create'), { timeout: 10000 }, S).catch(() => {});
    const card = await page.evaluate((S) => [...document.querySelectorAll(`${S} button`)].find((b) => b.innerText.trim() === 'Create')?.closest('.rounded-\\[16px\\]')?.innerText || '', S);
    await page.screenshot({ path: path.join(OUT, 'approve-character-card.png') });
    check(/Create the character "Kai"\?/.test(card) && /tall mechanic/.test(card), `approval card: ${card}`);
    await page.evaluate((S) => [...document.querySelectorAll(`${S} button`)].find((b) => b.innerText.trim() === 'Skip')?.click(), S);
    await waitIdle(page);
    const [result] = await lastResult(page);
    check(result?.status === 'declined', `a skip was not reported as declined: ${JSON.stringify(result)}`);
    check((await stores(page)).characters.length === before && (await logCount(page, 'image')) === imagesBefore, 'a skipped character was still made');
    check(await setConfirm('Never'), 'could not switch confirmation back off');
  });

  await scenario(page, 'mention-character', async (check) => {
    await newChat(page);
    await setScenario(page, 'mentionEcho');
    check(await focusMainPrompt(page), 'no main prompt box');
    await page.keyboard.type('@', { delay: 5 });
    await page.waitForSelector('[role="listbox"][aria-label="Asset list"]', { timeout: 6000 }).catch(() => {});
    const pick = () => page.evaluate(() => {
      const option = [...document.querySelectorAll('[role="listbox"][aria-label="Asset list"] [role="option"]')]
        .find((o) => o.querySelector('.sb-asset__title')?.textContent === 'Captain Mira');
      option?.click();
      return !!option;
    });
    let picked = await pick();
    if (!picked) {
      await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((t) => /character/i.test(t.textContent))?.click());
      await sleep(400);
      picked = await pick();
    }
    check(picked, 'Captain Mira is not in the @ picker');
    await sleep(300);
    await page.keyboard.type('flying over the sea', { delay: 3 });
    await page.keyboard.press('Enter');
    await waitIdle(page);
    const req = await lastLog(page, 'stream');
    const userText = req.body.contents.at(-1).parts.map((p) => p.text || '').join('\n');
    check(/Captain Mira flying over the sea/.test(userText), `the message text: ${userText.slice(0, 200)}`);
    check(/\[The user attached: character character-[^\s]+ "Captain Mira"\]/.test(userText), `the mention did not reach the agent by ID: ${userText.slice(0, 300)}`);
    const labels = [...userText.matchAll(/\[Visual Context for Canvas Image ID: ([^\]]+)\]/g)].map((m) => m[1]);
    check(/the portrait of character character-\S+ "Captain Mira"/.test(labels[0] || ''), `the mentioned character's portrait is not the first picture: ${JSON.stringify(labels)}`);
    check(!labels.some((l) => /character/.test(l) && !/the portrait of character/.test(l)), `a character image went out unlabelled: ${JSON.stringify(labels)}`);
  });

  // Open in a run of these alone too, which skips the scenarios that open it.
  const openSidebar = async () => {
    const open = await page.evaluate((S) => getComputedStyle(document.querySelector(S)).visibility === 'visible', S).catch(() => false);
    if (open) return;
    await page.evaluate(() => document.querySelector('button.agent-pill')?.click());
    await sleep(300);
    await page.evaluate(() => document.querySelector('button[title="Expand"]')?.click());
    await sleep(800);
  };

  await scenario(page, 'character-in-order', async (check) => {
    await openSidebar();
    await newChat(page);
    await setScenario(page, 'characterThenImage', { imageDelay: 600 });
    await sendInSidebar(page, 'Make a character called Lio, then a shot of him');
    await waitIdle(page, 60000);
    const order = await page.evaluate((S) => {
      const row = [...document.querySelectorAll(`${S} [id^="media-agent-message-"]`)].pop();
      return [...row.querySelectorAll('.smd-root, button[aria-label="Open Lio"], .smd-media-card')].map((el) => (el.matches('.smd-root')
        ? `text:${el.innerText.replace(/\s+/g, ' ').trim().slice(0, 60)}`
        : el.matches('.smd-media-card') ? 'media' : 'character'));
    }, S);
    const plan = order.findIndex((o) => o.startsWith('text:Here is the plan'));
    const character = order.indexOf('character');
    const media = order.indexOf('media');
    check(plan >= 0 && character > plan, `the card is not after the text written before it: ${JSON.stringify(order)}`);
    check(media > character, `the image made after the character is above its card: ${JSON.stringify(order)}`);
    check(plan >= 0 && !/Now a shot/.test(order[plan]), `the text after the card is in the stretch before it: ${JSON.stringify(order)}`);
  });

  await scenario(page, 'continue-after-stop', async (check) => {
    await openSidebar();
    await newChat(page);
    await setScenario(page, 'threeShots', { imageDelay: 4000 });
    const imagesBefore = await logCount(page, 'image');
    await sendInSidebar(page, 'Make three lighthouse shots, one after another');
    // Stopped while the second shot generates.
    await page.waitForFunction((n) => window.__sim.log.filter((l) => l.kind === 'image').length >= n, { timeout: 40000 }, imagesBefore + 2);
    await sleep(800);
    await page.evaluate((S) => document.querySelector(`${S} button[title="Stop"]`)?.click(), S);
    await waitIdle(page, 20000);
    await setScenario(page, 'continueEcho');
    await sendInSidebar(page, 'Continue');
    await waitIdle(page, 30000);
    const req = await lastLog(page, 'stream');
    const stopped = req.body.contents.filter((c) => c.role === 'model').pop();
    const said = (stopped?.parts || []).map((p) => p.text || '').join('\n');
    check(/\[What this reply did: generate_image "Lighthouse shot 1[^"]*", made \S+ \(completed\); generate_image "Lighthouse shot 2[^"]*", started \S+, still generating in the gallery \(stopped\)\]/.test(said), `the stopped reply's note: ${said.slice(0, 500)}`);
    check(/\[This reply did not finish: it was stopped before the end\.\]/.test(said), `no note that the reply did not finish: ${said.slice(0, 500)}`);
    check(/carry on with that request from where it stopped/.test(await lastSystemPrompt(page)), 'the prompt has no rule for continuing');
  });

  // Scrolling back down the chat while a reply generates, by wheel and by key: every frame the chat
  // moves back up against the scroll is a jump the user sees.
  await scenario(page, 'scroll-while-generating', async (check) => {
    await openSidebar();
    await newChat(page);
    await setScenario(page, 'longReply');
    await sendInSidebar(page, 'Describe a harbour at dawn');
    await waitIdle(page);
    await setScenario(page, 'fourShots', { imageDelay: 15000 });
    await sendInSidebar(page, 'Make four shots of a small harbour at dawn');
    await page.waitForFunction((S) => document.querySelectorAll(`${S} .smd-media-card`).length >= 1, { timeout: 20000 }, S);
    await sleep(1200);
    const box = await page.evaluate((S) => {
      const chat = [...document.querySelectorAll(`${S} *`)].find((e) => getComputedStyle(e).overflowY === 'auto' && e.scrollHeight > e.clientHeight + 20);
      if (!chat) return null;
      chat.setAttribute('data-sim-chat', '');
      const r = chat.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: chat.scrollTop, end: chat.scrollHeight - chat.clientHeight };
    }, S);
    check(!!box && box.top > 0, `the chat did not sit at the new question: ${JSON.stringify(box)}`);
    if (box && box.top > 0) {
      const record = (ms) => page.evaluate((ms) => {
        const chat = document.querySelector('[data-sim-chat]');
        const log = (window.__scrollLog = []);
        const t0 = performance.now();
        const tick = () => { log.push(Math.round(chat.scrollTop)); if (performance.now() - t0 < ms) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }, ms);
      const jumps = (log) => log.filter((v, i) => i > 0 && v < log[i - 1] - 1).length;
      await page.mouse.move(box.x, box.y);
      await page.mouse.wheel({ deltaY: -500 });
      await sleep(700);
      await record(2200);
      for (let i = 0; i < 10; i++) { await page.mouse.wheel({ deltaY: 120 }); await sleep(60); }
      await sleep(1700);
      const wheelLog = await page.evaluate(() => window.__scrollLog);
      check(wheelLog.some((v) => v > box.top - 400), `the wheel never scrolled the chat back down: ${JSON.stringify(wheelLog)}`);
      check(jumps(wheelLog) === 0, `the chat jumped back up ${jumps(wheelLog)} times under the wheel (rest ${box.top}): ${JSON.stringify(wheelLog)}`);
      await page.mouse.wheel({ deltaY: -500 });
      await sleep(700);
      await page.evaluate(() => { const chat = document.querySelector('[data-sim-chat]'); chat.tabIndex = -1; chat.focus({ preventScroll: true }); });
      await record(2000);
      await page.keyboard.press('PageDown');
      await sleep(300);
      await page.keyboard.press('PageDown');
      await sleep(1500);
      const keyLog = await page.evaluate(() => window.__scrollLog);
      check(jumps(keyLog) === 0, `the chat jumped back up ${jumps(keyLog)} times under PageDown (rest ${box.top}): ${JSON.stringify(keyLog)}`);
      const end = await page.evaluate(() => {
        const chat = document.querySelector('[data-sim-chat]');
        const [question, reply] = [...chat.querySelectorAll('[id^="media-agent-message-"]')].slice(-2);
        const limit = Math.max(Math.max(0, question.offsetTop - 24), reply.offsetTop + reply.offsetHeight - chat.clientHeight + 32);
        return { top: Math.round(chat.scrollTop), end: chat.scrollHeight - chat.clientHeight, limit };
      });
      check(Math.abs(end.top - end.limit) <= 2 && Math.abs(end.end - end.limit) <= 2, `the chat does not end where the reply does (the question at the top, or 32px under the reply): ${JSON.stringify(end)}`);
    }
    await waitIdle(page, 60000);
  });

  // The grid scrolled down while the agent's images start and land: a tile in view that moves
  // with no scroll, or a picture taken down and put back, is a flicker.
  await scenario(page, 'gallery-scroll-while-generating', async (check) => {
    await openSidebar();
    await newChat(page);
    await setScenario(page, 'fourShots', { imageDelay: 5000 });
    const box = await page.evaluate(() => {
      let grid = document.querySelector('.gallery-tile')?.parentElement;
      while (grid && !(/(auto|scroll)/.test(getComputedStyle(grid).overflowY) && grid.scrollHeight > grid.clientHeight + 40)) grid = grid.parentElement;
      if (!grid) return null;
      grid.setAttribute('data-sim-grid', '');
      const r = grid.getBoundingClientRect();
      const point = [0.5, 0.25, 0.1].map((f) => ({ x: Math.round(r.x + r.width * f), y: Math.round(r.y + r.height / 2) }))
        .find((p) => grid.contains(document.elementFromPoint(p.x, p.y)));
      return point && { ...point, range: grid.scrollHeight - grid.clientHeight, tiles: document.querySelectorAll('.gallery-tile').length };
    });
    check(!!box, 'the grid does not scroll here, or none of it is under the pointer');
    if (!box) return;
    const imagesBefore = await logCount(page, 'image');
    await sendInSidebar(page, 'Make four shots of a small harbour at dawn');
    await page.waitForFunction((n) => window.__sim.log.filter((e) => e.kind === 'image').length > n, { timeout: 20000 }, imagesBefore);
    await page.mouse.move(box.x, box.y);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel({ deltaY: 120 }); await sleep(120); }
    await sleep(900);
    await page.evaluate(() => {
      const grid = document.querySelector('[data-sim-grid]');
      const view = grid.getBoundingClientRect();
      const ref = [...grid.querySelectorAll('.gallery-tile')].find((t) => { const r = t.getBoundingClientRect(); return r.top >= view.top && r.bottom <= view.bottom; });
      const rec = (window.__gridRec = { ref: ref?.getAttribute('data-id'), frames: [], removed: [], added: [], tiles: [] });
      const mediaIn = (n) => (n.nodeType === 1 ? (n.matches('img, video') ? [n] : [...n.querySelectorAll('img, video')]) : []);
      const tileOf = (el, m) => el.closest?.('.gallery-tile')?.getAttribute('data-id') ?? m.target.closest?.('.gallery-tile')?.getAttribute('data-id') ?? null;
      new MutationObserver((list) => list.forEach((m) => {
        m.removedNodes.forEach((n) => mediaIn(n).forEach((el) => rec.removed.push({ at: Math.round(performance.now() - t0), tag: el.tagName, tile: tileOf(el, m) })));
        m.addedNodes.forEach((n) => mediaIn(n).forEach((el) => rec.added.push({ at: Math.round(performance.now() - t0), tag: el.tagName, tile: tileOf(el, m) })));
      })).observe(grid, { childList: true, subtree: true });
      const t0 = performance.now();
      const tick = () => {
        const r = ref?.isConnected ? ref.getBoundingClientRect().top : null;
        rec.frames.push([Math.round(performance.now() - t0), Math.round(grid.scrollTop), r === null ? null : Math.round(r)]);
        rec.tiles.push(grid.querySelectorAll('.gallery-tile').length);
        if (performance.now() - t0 < 8000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await sleep(8600);
    const rec = await page.evaluate(() => window.__gridRec);
    const moves = rec.frames.filter((f, i) => i > 0 && f[2] !== null && rec.frames[i - 1][2] !== null && Math.abs(f[2] - rec.frames[i - 1][2]) > 1)
      .map((f) => ({ at: f[0], scrollTop: f[1], top: f[2] }));
    const scrolled = rec.frames.filter((f, i) => i > 0 && f[1] !== rec.frames[i - 1][1]).map((f) => ({ at: f[0], scrollTop: f[1] }));
    console.log(`      grid: ${box.tiles} tiles, range ${box.range}px, scrolled to ${rec.frames[0]?.[1]}, ref ${rec.ref}, tiles ${Math.min(...rec.tiles)}..${Math.max(...rec.tiles)}, frames ${rec.frames.length}`);
    console.log(`      moved: ${JSON.stringify(moves.slice(0, 20))}`);
    console.log(`      scrolled: ${JSON.stringify(scrolled.slice(0, 20))}`);
    console.log(`      media added: ${JSON.stringify(rec.added.slice(0, 20))}`);
    console.log(`      media removed: ${JSON.stringify(rec.removed.slice(0, 20))}`);
    check(!!rec.ref, 'no tile fully in view to watch');
    check((rec.frames[0]?.[1] ?? 0) > 100, 'the wheel did not scroll the grid down');
    check(rec.added.length > 0, 'no picture landed in the grid while it was watched');
    check(moves.length === 0, `a tile in view moved ${moves.length} times with no scroll`);
    check(rec.removed.length === 0, `${rec.removed.length} pictures were taken down and put back in the grid`);
    await waitIdle(page, 60000);
  });

  await scenario(page, 'no-image-model', async (check) => {
    await page.evaluate(() => sessionStorage.setItem('__noImageModels', '1'));
    await page.goto(`${BASE}/media?projectId=${projectId}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => document.querySelectorAll('.gallery-tile').length >= 8, { timeout: 120000 });
    await sleep(3000);
    await page.evaluate(() => document.querySelector('button.agent-pill')?.click());
    await page.evaluate(() => document.querySelector('button[title="Expand"]')?.click());
    await sleep(800);
    await newChat(page);
    const before = (await stores(page)).characters.length;
    await setScenario(page, 'characterNoModel');
    await sendInSidebar(page, 'Make a test character');
    await waitIdle(page, 20000);
    const [result] = await lastResult(page);
    check(result?.status === 'failed' && /No image model is added/.test(result?.error || ''), `create_character did not refuse: ${JSON.stringify(result)}`);
    check((await stores(page)).characters.length === before, 'a character was created with no image model');
    check((await logCount(page, 'image')) === 0, 'an image request went out with no image model');
  });

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} scenarios passed. Page errors: ${pageErrors.length}`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, pageErrors }, null, 2));
} finally {
  await browser.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
