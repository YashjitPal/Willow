// The Tool Builder's success path on the :3101 test origin, in its own headless Chrome, against a
// local stand-in for an OpenAI-compatible endpoint: no real model is called and nothing is spent.
// A new tool from Create, an edit, a fix round after the real check finds a runtime error,
// Restore, Stop in the middle of a reply, and a reload.
//   node tools/scratch/w-tools-builder.cjs [--shots] [--keep]
// The stand-in listens on 127.0.0.2: the dev proxy reroutes 127.0.0.1 and localhost to WSL.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const ROOT = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const PROJECT = 'wt-builder';
const MOCK_HOST = '127.0.0.2';
const MOCK_PORT = 3199;
const SHOTS = process.argv.includes('--shots') ? path.join(__dirname, '../ui-research/captures/willow/tools-builder') : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const KEEP = process.argv.includes('--keep');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};

/* ---- The model ------------------------------------------------------------------------------ */

const CREATE_PROMPT = 'Build a tap counter with one big button';
const MAIN_V1 = `    <main className="h-screen w-screen bg-[#1f1f1f] text-white flex flex-col items-center justify-center gap-4" style={{ fontFamily: "'Google Sans Text', 'Google Sans', sans-serif" }}>`;
const MAIN_DARK = MAIN_V1.replace('bg-[#1f1f1f]', 'bg-black');
const REPLIES = {
  create: `I'll build it.
<willow-write path="/App.tsx">
import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  return (
${MAIN_V1}
      <button id="tap" className="rounded-xl bg-[#969696] text-black px-6 py-3 text-sm" onClick={() => setCount((n) => n + 1)}>
        Tapped {count}
      </button>
    </main>
  );
}
</willow-write>
Built a **tap counter**: one big button that counts your taps.`,
  edit: `<willow-edit path="/App.tsx">
<<<<<<< SEARCH
${MAIN_V1}
=======
${MAIN_DARK}
>>>>>>> REPLACE
</willow-edit>
Made the background **black**.`,
  broken: `<willow-edit path="/App.tsx">
<<<<<<< SEARCH
      </button>
    </main>
=======
      </button>
      <p id="subtitle" className="text-xs">{subtitleText}</p>
    </main>
>>>>>>> REPLACE
</willow-edit>
Added a subtitle under the button.`,
  fix: `<willow-edit path="/App.tsx">
<<<<<<< SEARCH
      <p id="subtitle" className="text-xs">{subtitleText}</p>
=======
      <p id="subtitle" className="text-xs">Tap the button to count</p>
>>>>>>> REPLACE
</willow-edit>
Fixed the subtitle: it now reads "Tap the button to count".`,
  stop: `<willow-write path="/components/Reset.tsx">
export default function Reset({ onReset }: { onReset: () => void }) {
  return <button id="reset" onClick={onReset}>Reset</button>;
}
</willow-write>
`,
  stopTail: 'Now wiring the reset button into the app, next to the counter, so one press puts the count back to zero. '.repeat(6),
  sdk: `<willow-write path="/App.tsx">
import { useState } from 'react';
import { Flow } from 'flow-sdk';

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [status, setStatus] = useState('Images will appear here');
  const [last, setLast] = useState<{ base64: string; mimeType: string } | null>(null);
  const run = (label: string, job: () => Promise<void>) => async () => {
    setStatus(\`GENERATING \${label}\`);
    try { await job(); setStatus(\`Done: \${label}\`); } catch (e) { setStatus(\`Failed: \${e instanceof Error ? e.message : String(e)}\`); }
  };
  return (
    <main className="h-screen w-screen bg-black text-white flex flex-col gap-3 p-4">
      <div className="flex gap-2">
        <button id="gen-image" onClick={run('image', async () => { const r = await Flow.generate.image({ prompt: 'A small harbour at dawn', aspectRatio: '16:9' }); setLast(r); setImage(\`data:\${r.mimeType};base64,\${r.base64}\`); })}>Generate image</button>
        <button id="gen-text" onClick={run('text', async () => { const r = await Flow.generate.text('Write a caption for a harbour at dawn'); setCaption(r.text); })}>Caption</button>
        <button id="save" onClick={run('save', async () => { if (!last) throw new Error('nothing yet'); await Flow.save({ base64: last.base64, mimeType: last.mimeType, name: 'Harbour copy' }); })}>Save copy</button>
        <button id="gen-video" onClick={run('video', async () => { const r = await Flow.generate.video({ prompt: 'Boats rocking at dawn', durationSeconds: 4 }); setVideo(\`data:\${r.mimeType};base64,\${r.base64}\`); })}>Make video</button>
      </div>
      <p id="status">{status}</p>
      <p id="caption">{caption}</p>
      {image && <img id="result" src={image} className="max-w-[320px]" />}
      {video && <video id="clip" src={video} className="max-w-[320px]" />}
    </main>
  );
}
</willow-write>
Built a **harbour shot maker**.`,
};
const SDK_PROMPT = 'Build a harbour shot maker';
const CAPTION = 'Boats knock against the pier as the mist lifts.';

const requests = [];
const mock = { slowStarted: false, slowClosed: false };
const contentText = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => p?.text ?? '').join('') : '');
const pick = (last) => {
  if (/found problems/.test(last) && /subtitleText/.test(last)) return 'fix';
  if (last.includes(`<user_message>\n${CREATE_PROMPT}`)) return 'create';
  if (last.includes('<user_message>\nMake the background darker')) return 'edit';
  if (last.includes('<user_message>\nAdd a subtitle')) return 'broken';
  if (last.includes('<user_message>\nAdd a reset button')) return 'stop';
  if (last.includes(`<user_message>\n${SDK_PROMPT}`)) return 'sdk';
  return null;
};

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `not faked: ${req.method} ${req.url}` } }));
      return;
    }
    const body = JSON.parse(raw || '{}');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const last = contentText([...messages].reverse().find((m) => m.role === 'user')?.content);
    const scenario = pick(last);
    requests.push({ url: req.url, model: body.model, stream: body.stream, roles: messages.map((m) => m.role), system: contentText(messages.find((m) => m.role === 'system' || m.role === 'developer')?.content), last, scenario });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    let closed = false;
    res.on('close', () => { closed = true; });
    const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    const stream = async (text, size, delay) => {
      for (let i = 0; i < text.length && !closed; i += size) {
        send({ content: text.slice(i, i + size) });
        await sleep(delay);
      }
    };
    send({ role: 'assistant', content: '' });
    await stream(scenario ? REPLIES[scenario] : 'OK.', 24, 8);
    if (scenario === 'stop') {
      mock.slowStarted = true;
      await stream(REPLIES.stopTail, 4, 150);
      mock.slowClosed = closed;
    }
    if (closed) return;
    send({}, 'stop');
    res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});

const MODEL_CONFIG = {
  gemini: { savedModels: [] },
  openai: { savedModels: [{ id: 'mock-coder', name: 'Mock Coder', modelId: 'mock-coder', thinkingLevel: 0 }] },
  providerProfiles: [{
    id: 'openai-default', name: 'OpenAI', transportProvider: 'openai', apiFormat: 'openai-chat-completions',
    baseUrl: `http://${MOCK_HOST}:${MOCK_PORT}/v1`, apiKeyId: 'openai', toolPolicy: 'disabled', enabled: true, modelIds: [], createdAt: 1, updatedAt: 1,
  }],
  profileSchemaVersion: 1,
  modelOrder: [],
};
const API_KEYS = { gemini: [], openai: ['sk-mock-not-a-key'], anthropic: [], moonshot: [], spacexai: [], zhipuai: [] };
// For the flow-sdk tool: an image and a video model, and a Gemini key, all answered by the
// in-page fake below. No Gemini chat model, so the builder stays on the stand-in.
const added = (modelId, name) => ({ id: `sim-${modelId}`, modelId, name, thinkingLevel: 0, thinkingLabel: 'None' });
const SDK_CONFIG = { ...MODEL_CONFIG, gemini: { savedModels: [added('gemini-3-pro-image', 'Nano Banana Pro'), added('veo-3.1-fast', 'Veo 3.1 Fast')] } };
const SDK_KEYS = { ...API_KEYS, gemini: ['FAKE-GEMINI-KEY'] };
const VIDEO_B64 = fs.readFileSync(path.join(__dirname, '../../assets/media-samples/Coffee.mp4')).toString('base64');

/* ---- The browser ---------------------------------------------------------------------------- */

(async () => {
  await new Promise((resolve, reject) => server.once('error', reject).listen(MOCK_PORT, MOCK_HOST, resolve));
  const userDataDir = KEEP ? path.join(os.tmpdir(), 'willow-tools-builder-probe') : fs.mkdtempSync(path.join(os.tmpdir(), 'willow-tools-builder-'));
  fs.mkdirSync(userDataDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  const errors = [];
  // Media's own icons spell SVG attributes in kebab case; a tool's `@import "tailwindcss"` is
  // refused by its frame's CSP as in Flow's runner; the broken subtitle only ever runs in the check.
  const IGNORED = [/Invalid DOM property .*stroke-width/, /stroke-width strokeWidth/, /tailwindcss' violates the following Content Security Policy/, /subtitleText is not defined/];
  page.on('pageerror', (e) => { const t = String(e.message || e); if (!IGNORED.some((re) => re.test(t))) errors.push(t.slice(0, 300)); });
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !IGNORED.some((re) => re.test(t))) errors.push(`console: ${t.slice(0, 300)}`);
  });
  await page.exposeFunction('__simVideoBytes', () => VIDEO_B64);
  await page.evaluateOnNewDocument((config, keys, caption) => {
    if (window.top !== window) return;
    // The app loads far more than the default 250 modules; `store` finds its own by these entries.
    performance.setResourceTimingBufferSize(100000);
    try {
      if (!localStorage.getItem('__builderSeeded')) {
        localStorage.setItem('modelConfig', JSON.stringify(config));
        localStorage.setItem('willow:apiKeys:device', JSON.stringify(keys));
        localStorage.setItem('__builderSeeded', '1');
      }
    } catch { /* an opaque frame has no storage */ }
    // Gemini, faked in the page as media-agent-sim.mjs does: images, Veo's operation, text.
    const realFetch = window.fetch.bind(window);
    const fake = (window.__fakeGemini = { log: [] });
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const text = (t) => json({ candidates: [{ index: 0, content: { role: 'model', parts: [{ text: t }] }, finishReason: 'STOP' }] });
    const png = () => {
      const c = document.createElement('canvas');
      c.width = 320; c.height = 180;
      const g = c.getContext('2d');
      g.fillStyle = 'hsl(200 70% 45%)';
      g.fillRect(0, 0, 320, 180);
      return c.toDataURL('image/png').split(',')[1];
    };
    let ops = 0;
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('generativelanguage.googleapis.com')) return realFetch(input, init);
      let body = {};
      try { body = init.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
      const model = (url.match(/models\/([^:?/]+)/) || [])[1] || '';
      const said = JSON.stringify(body.contents || body.instances || '');
      if (url.includes(':predictLongRunning')) {
        fake.log.push({ kind: 'video', model, said });
        return json({ name: `models/${model}/operations/op-${++ops}` });
      }
      if (/\/operations\/op-\d+/.test(url)) {
        const n = url.match(/op-(\d+)/)[1];
        return json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `https://generativelanguage.googleapis.com/v1beta/files/vid-${n}:download?alt=media` } }] } } });
      }
      if (url.includes(':download')) {
        const b64 = await window.__simVideoBytes();
        return new Response(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), { status: 200, headers: { 'Content-Type': 'video/mp4' } });
      }
      if (url.includes(':generateContent')) {
        if (body?.generationConfig?.responseModalities?.includes('IMAGE')) {
          fake.log.push({ kind: 'image', model, said });
          return json({ candidates: [{ index: 0, content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: png() } }] }, finishReason: 'STOP' }] });
        }
        if (said.includes('Name this creative tool')) {
          fake.log.push({ kind: 'name', model });
          return text(JSON.stringify({ name: 'Harbour Shot Maker', description: 'Makes harbour shots, captions and clips' }));
        }
        if (said.includes('Rephrase this image generation prompt')) {
          fake.log.push({ kind: 'rename', model });
          return text('Harbour at dawn');
        }
        fake.log.push({ kind: 'text', model, said });
        return text(caption);
      }
      fake.log.push({ kind: 'other', url });
      return json({ error: { code: 404, message: 'not faked' } }, 404);
    };
  }, MODEL_CONFIG, API_KEYS, CAPTION);

  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const url = () => page.url().replace(ORIGIN, '');
  const waitFor = async (fn, arg, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await page.evaluate(`!!((${fn})(${JSON.stringify(arg ?? null)}))`).catch(() => false)) return true;
      await sleep(150);
    }
    return false;
  };
  const waitUntil = async (fn, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (fn()) return true; await sleep(100); }
    return false;
  };
  const go = async (p) => {
    await page.goto(`${ORIGIN}${p}${p.includes('?') ? '&' : '?'}projectId=${PROJECT}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  };
  /** The app's own instance of a module: imported by the URL the app loaded it from. */
  const store = (toolId, what) => page.evaluate(async (id, kind) => {
    const src = performance.getEntriesByType('resource').map((e) => e.name).find((u) => u.includes('/features/media/src/tools/tools-store.ts'));
    if (!src) return { error: 'tools-store.ts not loaded' };
    const s = await import(src);
    const tool = s.getTool(id);
    if (kind === 'tool') return tool ? { name: tool.name, versionId: tool.versionId, pending: !!tool.pending } : null;
    if (kind === 'files') return Object.fromEntries((await s.loadToolFiles(id)).map((f) => [f.path, f.content]));
    if (kind === 'chat') return (await s.loadBuilderChat(id)).map((m) => ({ role: m.role, status: m.status, versionId: m.versionId ?? null, text: m.text.slice(0, 80), restoredPrompt: m.restoredPrompt }));
    return null;
  }, toolId, what).catch((e) => ({ error: String(e.message || e) }));
  const replies = () => page.evaluate(() => [...document.querySelectorAll('.ng-flow-applet-chat-sidebar .agent-chat-bubble')].map((b) => ({ text: b.textContent.trim().slice(0, 120), restore: !!b.querySelector('.restore-button') }))).catch(() => []);
  const streaming = () => page.evaluate(() => !!document.querySelector('.ng-flow-applet-chat-sidebar .stop-button')).catch(() => true);
  /** Sends a prompt in the builder and waits for the turn to end with `n` replies on screen. */
  const sendInBuilder = async (prompt, n, ms = 150000) => {
    await page.click('.prompt-textarea');
    await page.keyboard.type(prompt);
    await page.keyboard.press('Enter');
    await waitFor(() => document.querySelector('.ng-flow-applet-chat-sidebar .stop-button'), null, 10000);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (!(await streaming()) && (await replies()).length >= n) return true;
      await sleep(250);
    }
    return false;
  };
  /** The visible runner's document, once the tool mounted. */
  const runnerFrame = async (ms = 90000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const ready = await page.evaluate(() => !document.querySelector('.loading-overlay') && !!document.querySelector('.iframe-container iframe') && !document.querySelector('.iframe-container-hidden')).catch(() => false);
      if (ready) {
        const handle = await page.$('.iframe-container iframe');
        const frame = handle && (await handle.contentFrame());
        if (frame) return frame;
      }
      await sleep(250);
    }
    return null;
  };
  const inTool = async (fn, ms = 30000, arg = null) => {
    const end = Date.now() + ms;
    let last = null;
    while (Date.now() < end) {
      const frame = await runnerFrame(5000);
      if (frame) {
        last = await frame.evaluate(fn, arg).catch(() => null);
        if (last && last.ok) return last;
      }
      await sleep(300);
    }
    return last;
  };

  try {
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    await sleep(1500);
    await page.evaluate(async (root, project) => {
      const reg = await import(`${root}/platform/projects/src/registry.ts`);
      reg.writeProjectRegistry([...reg.readProjectRegistry().filter((e) => e.id !== project), { id: project, name: 'Builder test', kind: 'media' }]);
    }, ROOT, PROJECT);
    const seeded = await page.evaluate(() => JSON.parse(localStorage.getItem('modelConfig') || 'null')?.openai?.savedModels?.[0]?.id);
    check('the test browser holds only the stand-in model', seeded === 'mock-coder', seeded);
    errors.length = 0;

    // ---- Create: the first request builds the tool ----------------------------------------------
    await go('/media/create-tool');
    await waitFor(() => document.querySelector('.create-applet-hero-title'), null, 60000);
    await sleep(500);
    await page.click('.wt-rich-input');
    await page.keyboard.type(CREATE_PROMPT);
    await page.keyboard.press('Enter');
    const opened = await waitFor(() => /\/media\/tool\/[^?]+/.test(location.pathname) && /mode=EDIT/.test(location.search), null, 15000);
    const toolId = (url().match(/\/media\/tool\/([^?]+)/) || [])[1];
    check('Create opens the new tool in Edit', opened && !!toolId, url());
    await shot('01-create-building');
    const built = await waitUntil(() => requests.length >= 1, 30000) && (await (async () => {
      const end = Date.now() + 150000;
      while (Date.now() < end) {
        if (!(await streaming()) && (await replies()).length >= 1) return true;
        await sleep(250);
      }
      return false;
    })());
    const first = requests[0];
    check('the builder asked the chat model once, as the Tool Builder, with the request',
      built && first?.model === 'mock-coder' && first.stream === true && /^You are the Tool Builder in Willow's Media app/.test(first.system || '') && first.last.includes(`<user_message>\n${CREATE_PROMPT}\n</user_message>`) && /The project is empty/.test(first.last),
      first && { model: first.model, roles: first.roles, system: first.system?.slice(0, 60), scenario: first.scenario, requests: requests.length });
    let chat = await store(toolId, 'chat');
    check('the reply is saved with the version it made', chat?.length === 2 && chat[1].role === 'agent' && chat[1].status === 'done' && !!chat[1].versionId, chat);
    const toolName = () => page.evaluate(() => document.querySelector('.applet-view-header .editable-text-input')?.value ?? document.querySelector('.applet-view-header .applet-name')?.textContent ?? null).catch(() => null);
    const named = await waitFor(() => (document.querySelector('.applet-view-header .editable-text-input')?.value ?? document.querySelector('.applet-view-header .applet-name')?.textContent) === 'Build A Tap Counter', null, 10000);
    check('with no Gemini key, the tool is named from its first words', named, { header: await toolName(), stored: (await store(toolId, 'tool'))?.name });
    const r1 = await replies();
    check('the reply shows in the chat with its Restore', r1.length === 1 && /Built a tap counter/.test(r1[0].text) && r1[0].restore, r1);
    const v1 = await store(toolId, 'tool');
    let ran = await inTool(() => ({ ok: document.body.innerText.includes('Tapped 0'), text: document.body.innerText.slice(0, 80) }), 90000);
    check('the new tool runs: "Tapped 0"', ran?.ok, ran);
    const frame1 = await runnerFrame();
    await frame1?.click('#tap').catch(() => {});
    ran = await inTool(() => ({ ok: document.body.innerText.includes('Tapped 1'), text: document.body.innerText.slice(0, 80) }), 10000);
    check('and counts a tap: "Tapped 1"', ran?.ok, ran);
    await shot('02-created');

    // ---- Edit: a SEARCH/REPLACE on the tool's file ----------------------------------------------
    const beforeEdit = requests.length;
    const edited = await sendInBuilder('Make the background darker', 2);
    const editRequest = requests[beforeEdit];
    check('an edit request carries the tool\'s current file', edited && requests.length === beforeEdit + 1 && editRequest?.last.includes('<file path="/App.tsx">') && editRequest.last.includes('bg-[#1f1f1f]'), editRequest && { scenario: editRequest.scenario, n: requests.length - beforeEdit });
    let files = await store(toolId, 'files');
    check('the edit is saved as the tool\'s file', /bg-black/.test(files?.['App.tsx'] || '') && !/bg-\[#1f1f1f\]/.test(files?.['App.tsx'] || ''), Object.keys(files || {}));
    ran = await inTool(() => { const bg = getComputedStyle(document.querySelector('main')).backgroundColor; return { ok: bg === 'rgb(0, 0, 0)', bg }; }, 60000);
    check('the tool reloads with the darker background', ran?.ok, ran);
    await shot('03-edited');

    // ---- A fix round: the real check catches a runtime error -----------------------------------
    const beforeFix = requests.length;
    const fixed = await sendInBuilder('Add a subtitle', 3);
    const fixRequests = requests.slice(beforeFix);
    check('the check ran the broken tool and sent its error back for a fix round',
      fixed && fixRequests.map((r) => r.scenario).join(',') === 'broken,fix' && /found problems/.test(fixRequests[1]?.last || '') && /subtitleText is not defined/.test(fixRequests[1]?.last || ''),
      fixRequests.map((r) => ({ scenario: r.scenario, tail: r.last.slice(-300) })));
    files = await store(toolId, 'files');
    check('only the fixed code is saved', /Tap the button to count/.test(files?.['App.tsx'] || '') && !/subtitleText/.test(files?.['App.tsx'] || ''));
    ran = await inTool(() => ({ ok: document.querySelector('#subtitle')?.textContent === 'Tap the button to count', text: document.body.innerText.slice(0, 80) }), 60000);
    check('the tool shows the subtitle', ran?.ok, ran);
    chat = await store(toolId, 'chat');
    check('three replies, each with its own version', chat?.filter((m) => m.role === 'agent').map((m) => m.status).join(',') === 'done,done,done' && new Set(chat.filter((m) => m.role === 'agent').map((m) => m.versionId)).size === 3, chat);
    await shot('04-fixed');

    // ---- Restore: back to the first version -----------------------------------------------------
    const restoreStates = () => page.evaluate(() => [...document.querySelectorAll('.ng-flow-applet-chat-sidebar .agent-chat-bubble .restore-button')].map((b) => b.disabled)).catch(() => []);
    const latestDisabled = await restoreStates();
    check('the running version\'s Restore is the disabled one', JSON.stringify(latestDisabled) === JSON.stringify([false, false, true]), latestDisabled);
    const beforeRestore = await store(toolId, 'tool');
    await page.evaluate(() => document.querySelectorAll('.ng-flow-applet-chat-sidebar .agent-chat-bubble .restore-button')[0]?.click());
    const marked = await waitFor(() => document.querySelector('.reverted-container'), null, 15000);
    const mark = await page.evaluate(() => ({ head: document.querySelector('.reverted-header')?.textContent.replace('flag', '').trim(), pill: document.querySelector('.reverted-prompt-pill')?.textContent })).catch(() => null);
    check('Restore adds "Restored from" with the request that made that version', marked && mark?.head === 'Restored from' && mark.pill === CREATE_PROMPT, mark);
    const afterRestore = await store(toolId, 'tool');
    files = await store(toolId, 'files');
    check('the tool runs the first version again', afterRestore?.versionId !== beforeRestore?.versionId && /bg-\[#1f1f1f\]/.test(files?.['App.tsx'] || '') && !/subtitle/.test(files?.['App.tsx'] || ''), { before: beforeRestore?.versionId, after: afterRestore?.versionId, v1: v1?.versionId });
    ran = await inTool(() => { const bg = getComputedStyle(document.querySelector('main')).backgroundColor; return { ok: bg === 'rgb(31, 31, 31)' && !document.querySelector('#subtitle'), bg }; }, 60000);
    check('the frame shows the first version', ran?.ok, ran);
    const restoredStates = await restoreStates();
    check('a restore is a new version, so every Restore can be pressed again', JSON.stringify(restoredStates) === JSON.stringify([false, false, false]), restoredStates);
    await shot('05-restored');

    // ---- Stop in the middle of a reply ----------------------------------------------------------
    await page.click('.prompt-textarea');
    await page.keyboard.type('Add a reset button');
    await page.keyboard.press('Enter');
    const slow = await waitUntil(() => mock.slowStarted, 60000);
    await sleep(600);
    const stopShown = await page.evaluate(() => !!document.querySelector('.ng-flow-applet-chat-sidebar .stop-button')).catch(() => false);
    await shot('06-stopping');
    await page.click('.ng-flow-applet-chat-sidebar .stop-button').catch(() => {});
    const stopped = await waitFor(() => !document.querySelector('.ng-flow-applet-chat-sidebar .stop-button'), null, 20000);
    check('Stop ends the reply mid-stream', slow && stopShown && stopped, { slow, stopShown, stopped });
    await sleep(500);
    // Not the builder's: the dev server's /llm-proxy pipes the upstream reply without ever ending
    // the upstream request when the browser cancels, so the stand-in keeps streaming. Outside dev
    // the browser reaches the endpoint directly and the cancel reaches it.
    console.log(`NOTE the stand-in ${mock.slowClosed ? 'saw' : 'did not see'} the cancel through the dev proxy`);
    chat = await store(toolId, 'chat');
    const lastAgent = chat?.filter((m) => m.role === 'agent').at(-1);
    files = await store(toolId, 'files');
    check('what finished before the stop is kept, as a version', lastAgent?.status === 'stopped' && !!lastAgent.versionId && 'components/Reset.tsx' in (files || {}) && /bg-\[#1f1f1f\]/.test(files?.['App.tsx'] || ''), { lastAgent, files: Object.keys(files || {}) });
    await shot('07-stopped');

    // ---- A reload keeps the conversation and the tool -------------------------------------------
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => document.querySelectorAll('.ng-flow-applet-chat-sidebar .agent-chat-bubble').length >= 4, null, 60000);
    const after = await page.evaluate(() => ({
      users: [...document.querySelectorAll('.ng-flow-applet-chat-sidebar .user-bubble-container .message-text')].map((e) => e.textContent),
      replies: document.querySelectorAll('.ng-flow-applet-chat-sidebar .agent-chat-bubble').length,
      reverted: document.querySelectorAll('.ng-flow-applet-chat-sidebar .reverted-container').length,
      name: document.querySelector('.applet-view-header .editable-text-input')?.value ?? document.querySelector('.applet-view-header .applet-name')?.textContent,
    })).catch(() => null);
    check('after a reload: four requests, four replies, one Restore mark, the same name',
      after?.users.join('|') === `${CREATE_PROMPT}|Make the background darker|Add a subtitle|Add a reset button` && after.replies === 4 && after.reverted === 1 && after.name === 'Build A Tap Counter', after);
    ran = await inTool(() => ({ ok: document.body.innerText.includes('Tapped 0'), text: document.body.innerText.slice(0, 80) }), 90000);
    check('and the tool runs', ran?.ok, ran);
    await shot('08-reloaded');

    // ---- A tool that generates through flow-sdk, against the in-page Gemini fake ---------------
    await page.evaluate((config, keys) => {
      localStorage.setItem('modelConfig', JSON.stringify(config));
      localStorage.setItem('willow:apiKeys:device', JSON.stringify(keys));
    }, SDK_CONFIG, SDK_KEYS);
    await go('/media/create-tool');
    await waitFor(() => document.querySelector('.create-applet-hero-title'), null, 60000);
    await sleep(500);
    const beforeSdk = requests.length;
    await page.click('.wt-rich-input');
    await page.keyboard.type(SDK_PROMPT);
    await page.keyboard.press('Enter');
    await waitFor(() => /\/media\/tool\/[^?]+/.test(location.pathname) && /mode=EDIT/.test(location.search), null, 15000);
    const sdkBuilt = await waitUntil(() => requests.length > beforeSdk, 30000) && (await (async () => {
      const end = Date.now() + 150000;
      while (Date.now() < end) {
        if (!(await streaming()) && (await replies()).length >= 1) return true;
        await sleep(250);
      }
      return false;
    })());
    const fakeLog = () => page.evaluate(() => (window.__fakeGemini?.log ?? []).map((e) => ({ kind: e.kind, model: e.model, said: (e.said || '').slice(0, 300) }))).catch(() => []);
    check('the flow-sdk tool is built by one request', sdkBuilt && requests.length === beforeSdk + 1 && requests[beforeSdk]?.scenario === 'sdk', requests.slice(beforeSdk).map((r) => r.scenario));
    const sdkNamed = await waitFor(() => (document.querySelector('.applet-view-header .editable-text-input')?.value ?? document.querySelector('.applet-view-header .applet-name')?.textContent) === 'Harbour Shot Maker', null, 15000);
    check('with a Gemini key, Gemini names the new tool', sdkNamed, { header: await toolName(), log: (await fakeLog()).map((e) => e.kind) });
    const gallery = () => page.evaluate(async (project) => {
      const src = performance.getEntriesByType('resource').map((e) => e.name).find((u) => u.includes('/platform/storage/src/media-storage.ts'));
      if (!src) return null;
      const ms = await import(src);
      return (await ms.loadProjectMedia(project)).map((m) => ({ kind: m.kind, status: m.status, prompt: m.prompt, name: m.shortenedPrompt }));
    }, PROJECT).catch(() => null);
    const galleryUntil = async (fn, ms = 20000) => {
      const end = Date.now() + ms;
      let items = null;
      while (Date.now() < end) {
        items = await gallery();
        if (items && fn(items)) return items;
        await sleep(500);
      }
      return items;
    };
    const mediaBefore = (await gallery())?.length ?? 0;
    const press = async (sel) => { const frame = await runnerFrame(); await frame?.click(sel).catch(() => {}); };
    const toolReached = (want) => {
      const s = { status: document.querySelector('#status')?.textContent, caption: document.querySelector('#caption')?.textContent, image: document.querySelector('#result')?.naturalWidth ?? 0, video: !!document.querySelector('#clip') };
      return { ...s, ok: s.status === want.status && (!want.image || s.image > 0) && (!want.video || s.video) };
    };

    await press('#gen-image');
    ran = await inTool(toolReached, 60000, { status: 'Done: image', image: true });
    let log = await fakeLog();
    check('Flow.generate.image runs the project\'s image model and hands the picture to the tool',
      ran?.ok && log.some((e) => e.kind === 'image' && e.model === 'gemini-3-pro-image' && e.said.includes('A small harbour at dawn')), { ran, log: log.map((e) => `${e.kind}:${e.model}`) });
    let items = await galleryUntil((list) => list.length >= mediaBefore + 1);
    check('and the picture lands in the project\'s gallery', items?.length === mediaBefore + 1 && items.some((m) => m.kind === 'image' && m.prompt === 'A small harbour at dawn'), items);
    await shot('09-sdk-image');

    await press('#gen-text');
    ran = await inTool(toolReached, 30000, { status: 'Done: text' });
    check('Flow.generate.text answers with the model\'s text', ran?.ok && ran.caption === CAPTION, ran);

    await press('#save');
    const saved = await waitFor(() => /Saved to gallery/.test(document.querySelector('.sb-snackbar')?.textContent || ''), null, 15000);
    items = await galleryUntil((list) => list.length >= mediaBefore + 2);
    check('Flow.save says "Saved to gallery" and adds the file', saved && items?.length === mediaBefore + 2, { saved, items });
    await shot('10-sdk-saved');

    await press('#gen-video');
    ran = await inTool(toolReached, 150000, { status: 'Done: video', video: true });
    log = await fakeLog();
    check('Flow.generate.video runs the project\'s video model and hands the clip to the tool',
      ran?.ok && log.some((e) => e.kind === 'video' && e.model.startsWith('veo-3.1-fast') && e.said.includes('Boats rocking at dawn')), { ran, log: log.map((e) => `${e.kind}:${e.model}`) });
    items = await galleryUntil((list) => list.some((m) => m.kind === 'video' && m.status === 'completed'), 30000);
    check('and the clip lands in the gallery', items?.some((m) => m.kind === 'video' && m.status === 'completed' && m.prompt === 'Boats rocking at dawn'), items);
    check('nothing reached Gemini that the fake does not know', !log.some((e) => e.kind === 'other'), log.filter((e) => e.kind === 'other'));
    await shot('11-sdk-video');

    check('every request went to the stand-in, none elsewhere', requests.every((r) => r.url === '/v1/chat/completions'), requests.map((r) => r.url));
    check('no page errors', errors.length === 0, errors.slice(0, 8));
  } catch (e) {
    console.error('FAILED:', e.stack || e.message);
    failures += 1;
  } finally {
    await browser.close();
    server.close();
    if (!KEEP) fs.rmSync(userDataDir, { recursive: true, force: true });
    console.log(`${failures ? `${failures} FAILED` : 'ALL PASSED'} (${requests.length} model requests)${SHOTS ? ` (shots in ${SHOTS})` : ''}`);
    process.exit(failures ? 1 : 0);
  }
})();
