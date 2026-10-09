// Willow TV on the :3101 test origin, in its own headless Chrome (a fresh profile, so nothing of
// the user's): three projects of generated clips and two scenes are seeded, then every part of the
// TV is driven with real input and checked. Screenshots, at Flow TV's capture size, with --shots.
// --keep reuses one profile (seeded once) across runs; --only=nav,grid,... runs just those steps.
//   node tools/scratch/w-tv.cjs [--shots] [--keep] [--only=home,nav,loop,prompt,grid,pages,search,dialogs]
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const ROOT = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const SHOTS = process.argv.includes('--shots') ? path.join(__dirname, '../ui-research/captures/willow/tv') : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};

// Clips long enough that none ends (and plays on to the next) while a step is looking at it.
const PROJECTS = [
  { id: 'tv-ocean', name: 'Ocean Days', hue: 200, clips: [['A whale breaching at dawn', 8], ['Waves rolling over black sand', 8], ['A gull hanging in the wind', 7]] },
  { id: 'tv-city', name: 'City Lights', hue: 30, clips: [['Neon signs in the rain', 8], ['A night train crossing a bridge', 8]] },
  { id: 'tv-forest', name: 'Forest Walk', hue: 120, clips: [['Sunlight through tall pines', 8], ['A deer at the edge of a clearing', 7, 'Veo 2'], ['Moss on a fallen log', 7], ['Mist over a forest lake', 8]] },
];

const KEEP = process.argv.includes('--keep');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).split(',').filter(Boolean);
const runs = (step) => !ONLY.length || ONLY.includes(step);

(async () => {
  const userDataDir = KEEP ? path.join(os.tmpdir(), 'willow-tv-probe') : fs.mkdtempSync(path.join(os.tmpdir(), 'willow-tv-'));
  fs.mkdirSync(userDataDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const url = () => page.url().replace(ORIGIN, '');
  // Coerced to a boolean in the page: an element cannot come back over the protocol, and would
  // read as undefined, so a wait for one would always run out its time.
  const waitFor = async (fn, arg, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await page.evaluate(`!!((${fn})(${JSON.stringify(arg ?? null)}))`).catch(() => false)) return true;
      await sleep(150);
    }
    return false;
  };
  const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
  const count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
  const clickSel = async (sel) => {
    const box = await page.evaluate((s) => {
      const r = document.querySelector(s)?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    }, sel);
    if (!box) return false;
    await page.mouse.move(box.x, box.y, { steps: 6 });
    await page.mouse.click(box.x, box.y);
    return true;
  };
  // Every route change, with how many clips are mounted then: transitions leave none behind.
  await page.evaluateOnNewDocument(() => {
    window.__wtvLog = [];
    const log = (kind) => window.__wtvLog.push(`${(performance.now() / 1000).toFixed(2)} ${kind} ${location.pathname}${location.search} clips=${document.querySelectorAll('.wtv-video__outerContainer').length}`);
    for (const m of ['pushState', 'replaceState']) {
      const orig = history[m].bind(history);
      history[m] = (...a) => { const r = orig(...a); log(m); return r; };
    }
    window.addEventListener('popstate', () => log('pop'));
  });
  const dumpLog = async (label) => console.log(`  log (${label}):\n    ${(await page.evaluate(() => window.__wtvLog.splice(0)).catch(() => [])).join('\n    ')}`);
  try {
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    await sleep(2000);
    const seeded = KEEP && await page.evaluate(async (root) => {
      const reg = await import(`${root}/platform/projects/src/registry.ts`);
      return reg.readProjectRegistry().some((e) => e.id === 'tv-forest');
    }, ROOT).catch(() => false);
    if (!seeded) {
    // ---- Three projects of clips, and two scenes -------------------------------------------------
    const seed = await page.evaluate(async (root, projects) => {
      const mw = await import(`${root}/features/media/src/scenes/mp4-write.ts`);
      const encode = async (hue, label, secs) => {
        const fps = 24;
        const chunks = [];
        let description = null;
        const enc = new VideoEncoder({
          output: (chunk, meta) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            chunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? Math.round(1e6 / fps), key: chunk.type === 'key' });
            if (meta?.decoderConfig?.description && !description) description = new Uint8Array(meta.decoderConfig.description);
          },
          error: () => {},
        });
        enc.configure({ codec: 'avc1.640028', width: 640, height: 360, bitrate: 800_000, framerate: fps, avc: { format: 'avc' } });
        const c = new OffscreenCanvas(640, 360);
        const g = c.getContext('2d');
        for (let i = 0; i < Math.round(secs * fps); i += 1) {
          const grad = g.createLinearGradient(0, 0, 640, 360);
          grad.addColorStop(0, `hsl(${hue}, 60%, ${25 + (i % 24)}%)`);
          grad.addColorStop(1, `hsl(${hue + 40}, 70%, 15%)`);
          g.fillStyle = grad; g.fillRect(0, 0, 640, 360);
          g.fillStyle = 'rgba(255,255,255,.9)'; g.font = 'bold 150px sans-serif'; g.fillText(label, 60 + (i * 3) % 120, 240);
          const frame = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
          enc.encode(frame, { keyFrame: i % fps === 0 });
          frame.close();
        }
        await enc.flush();
        enc.close();
        const blob = mw.writeMp4({ width: 640, height: 360, description, chunks }, null);
        return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      };
      const reg = await import(`${root}/platform/projects/src/registry.ts`);
      const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
      const now = Date.UTC(2026, 9, 3, 12, 0, 0);
      const out = { items: {}, scenes: {} };
      let t = 0;
      for (const [pi, p] of projects.entries()) {
        reg.writeProjectRegistry([...reg.readProjectRegistry().filter((e) => e.id !== p.id), { id: p.id, name: p.name, kind: 'media' }]);
        const items = [];
        for (const [ci, [prompt, secs, model]] of p.clips.entries()) {
          t += 1;
          items.push({
            id: `${p.id}-v${ci}`, kind: 'video', status: 'completed', url: await encode(p.hue + ci * 25, `${p.name[0]}${ci + 1}`, secs),
            prompt, modelId: model ? 'veo-2' : 'veo-3.1-fast', modelName: model || 'Veo 3.1 Fast', ratio: '16:9', timestamp: now - (100 - pi * 10 - ci) * 1000,
          });
        }
        out.items[p.id] = items;
        await ms.saveProjectMedia(p.id, items);
      }
      const clip = (pid, i, a, b) => ({ id: `${pid}-sc${i}`, mediaId: `${pid}-v${i}`, trimStart: a, trimEnd: b, sourceDuration: b });
      out.scenes['tv-city'] = [{ id: 'tv-film-night', name: 'Night Drive', createdAt: now, updatedAt: now + 2, aspectRatio: '16:9', clips: [clip('tv-city', 0, 0, 5), clip('tv-city', 1, 0, 6), clip('tv-city', 0, 1, 6)] }];
      out.scenes['tv-forest'] = [{ id: 'tv-film-woods', name: 'Into the Woods', createdAt: now, updatedAt: now + 1, aspectRatio: '16:9', clips: [clip('tv-forest', 0, 0, 6), clip('tv-forest', 3, 0, 6)] }];
      return out;
    }, ROOT, PROJECTS);
    // The app may read a scope the storage default doesn't: open a project once, then seed each scope.
    await page.goto(`${ORIGIN}/media?projectId=tv-ocean`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(8000);
    await page.evaluate(async (root, s) => {
      const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
      const sc = await import(`${root}/platform/storage/src/media-scenes.ts`);
      const reg = await import(`${root}/platform/projects/src/registry.ts`);
      const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const keys = await new Promise((res) => { const tx = db.transaction('project_media', 'readonly'); const q = tx.objectStore('project_media').getAllKeys(); q.onsuccess = () => res(q.result); });
      db.close();
      const scopes = [...new Set(keys.map(String).filter((k) => k.includes(':project:tv-')).map((k) => decodeURIComponent(k.slice('scope:'.length, k.lastIndexOf(':project:')))))];
      for (const scope of scopes) {
        const listed = reg.readProjectRegistry(scope);
        const missing = Object.keys(s.items).filter((id) => !listed.some((e) => e.id === id));
        if (missing.length) reg.writeProjectRegistry([...listed, ...missing.map((id) => ({ id, name: { 'tv-ocean': 'Ocean Days', 'tv-city': 'City Lights', 'tv-forest': 'Forest Walk' }[id], kind: 'media' }))], scope);
        for (const [pid, items] of Object.entries(s.items)) {
          if ((await ms.loadProjectMedia(pid, scope)).length < items.length) await ms.saveProjectMedia(pid, items, scope);
          for (const scene of s.scenes[pid] ?? []) await sc.saveScene(pid, scene, scope);
        }
      }
    }, ROOT, seed);
    }
    errors.length = 0;

    if (runs('home')) {
    // ---- Home: a random clip, in Mixing ---------------------------------------------------------
    await page.goto(`${ORIGIN}/tv`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    const landed = await waitFor(() => /\/tv\/channel\/[^/]+\/[^/?]+\?random=true$/.test(location.pathname + location.search), null, 30000);
    check('home plays a random clip in Mixing', landed, url());
    await waitFor(() => document.querySelector('video.wtv-video__video[data-is-loaded="true"]'), null, 20000);
    await sleep(1500);
    const rest = await page.evaluate(() => {
      const v = document.querySelector('video.wtv-video__video');
      const remote = document.querySelector('.wtv-tv-remote__outerContainer');
      return {
        playing: v && !v.paused && v.currentTime > 0,
        muted: v?.muted,
        theme: remote?.style.getPropertyValue('--theme-700'),
        controls: document.querySelectorAll('.wtv-controls__controlsContainer .wtv-controls__button').length,
        home: !!document.querySelector('.wtv-controls__button[data-is-home]'),
        prompt: document.querySelector('.wtv-video-data__description')?.textContent,
        genType: document.querySelector('.wtv-video-data__genType')?.textContent,
        channel: document.querySelector('.wtv-channel-nav__name .wtv-channel-name__nameMeasurer')?.textContent,
        header: !!document.querySelector('.wtv-header__container .wtv-wordmark'),
        unmute: !!document.querySelector('.wtv-video__buttonUnmuteToPlayAudio'),
        innerOpacity: getComputedStyle(document.querySelector('.wtv-video__innerContainer')).opacity,
      };
    });
    check('the clip plays, muted, in its channel\'s colours', rest.playing && rest.muted && /\d+,\d+,\d+/.test(rest.theme || ''), rest);
    check('the remote has Home and seven controls', rest.home && rest.controls === 7, rest.controls);
    check('the prompt and its label show', !!rest.prompt && /Text to Video/.test(rest.genType || ''), { prompt: rest.prompt, genType: rest.genType });
    check('the channel nav names the channel', !!rest.channel, rest.channel);
    check('the video faded in', rest.innerOpacity === '1', rest.innerOpacity);
    check('Unmute to hear audio shows until audio is allowed', rest.unmute);
    await shot('01-lightbox');
    await page.mouse.move(700, 400, { steps: 4 });
    await clickSel('.wtv-video__buttonUnmuteToPlayAudio');
    await sleep(500);
    check('unmuting plays the sound', await page.evaluate(() => document.querySelector('video.wtv-video__video')?.muted === false));
    }

    if (runs('nav')) {
    // ---- A known clip, then the next one in its channel (a fade) ---------------------------------
    // A clip that ends plays on to the next by itself; Repeat Video holds each one where it is.
    const t0 = Date.now();
    await page.goto(`${ORIGIN}/tv/channel/ocean-days/tv-ocean-v0`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    const t1 = Date.now();
    await waitFor(() => document.querySelector('video.wtv-video__video[data-is-loaded="true"]'), null, 20000);
    console.log(`  goto ${t1 - t0}ms, video loaded ${Date.now() - t1}ms later`);
    for (let i = 0; i < 4 && (await text('.wtv-controls__button[data-is-loop] .wtv-tooltip__tooltip')) !== 'Unloop'; i += 1) {
      await clickSel('.wtv-controls__button[data-is-loop]');
      await sleep(300);
    }
    check('Repeat Video is on for the walk through the clips', (await text('.wtv-controls__button[data-is-loop] .wtv-tooltip__tooltip')) === 'Unloop');
    await waitFor(() => document.querySelector('.wtv-controls__button[data-is-next]')?.getAttribute('data-is-disabled') === 'false', null, 8000);
    await dumpLog('landed');
    await page.keyboard.press('ArrowRight');
    const both = await waitFor(() => document.querySelectorAll('.wtv-video__outerContainer').length === 2, null, 3000);
    check('Next Clip fades one clip into the next', both);
    await waitFor(() => location.pathname.endsWith('/tv-ocean-v1') && document.querySelectorAll('.wtv-video__outerContainer').length === 1, null, 5000);
    check('Next Clip stays in the channel', url() === '/tv/channel/ocean-days/tv-ocean-v1', url());
    check('the old clip leaves once it has faded', (await count('.wtv-video__outerContainer')) === 1, await count('.wtv-video__outerContainer'));
    await dumpLog('next clip');
    await sleep(800);
    await page.keyboard.press('ArrowLeft');
    await waitFor(() => location.pathname.endsWith('/tv-ocean-v0') && document.querySelectorAll('.wtv-video__outerContainer').length === 1, null, 5000);
    check('Previous Clip goes back', url() === '/tv/channel/ocean-days/tv-ocean-v0', url());
    await dumpLog('previous clip');
    await sleep(1200);

    // ---- The next channel: Flow TV's shader ---------------------------------------------------------
    await page.keyboard.press('ArrowDown');
    const shader = await waitFor(() => document.querySelector('.wtv-channel-shader-transition__canvas'), null, 3000);
    check('a channel change runs the shader', shader, url());
    await sleep(1800);
    const mid = await page.evaluate(() => ({
      opacity: getComputedStyle(document.querySelector('.wtv-channel-shader-transition__container') || document.body).opacity,
      step2: document.querySelector('.wtv-channel-shader-transition__container')?.getAttribute('data-step-2-complete'),
      name: document.querySelector('.wtv-video__channelName')?.textContent,
      rect: (() => {
        const r = document.querySelector('.wtv-channel-shader-transition__canvas')?.getBoundingClientRect();
        return r ? { x: r.x + r.width * 0.2, y: r.y + r.height * 0.2, width: r.width * 0.6, height: r.height * 0.6 } : null;
      })(),
    }));
    // WebGL clears its buffer once a frame is shown, so the canvas cannot be read back: the screen can.
    if (mid.rect) {
      const png = await page.screenshot({ clip: mid.rect, encoding: 'base64' });
      mid.screen = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, 32, 32);
        const d = g.getImageData(0, 0, 32, 32).data;
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; sq += l * l; }
        const n = d.length / 4;
        return { mean: Math.round(sum / n), spread: Math.round(Math.sqrt(sq / n - (sum / n) ** 2)) };
      }, png);
      delete mid.rect;
    }
    check('the shader draws the clips and names the new channel', mid.opacity === '1' && mid.screen?.mean > 10 && mid.screen?.spread > 2 && !!mid.name, mid);
    await shot('02-shader');
    const settled = await waitFor(() => !document.querySelector('.wtv-channel-shader-transition__canvas') && document.querySelectorAll('.wtv-video__outerContainer').length === 1, null, 9000);
    check('the shader settles into the new channel', settled && url().startsWith('/tv/channel/forest-walk/'), url());
    await dumpLog('next channel');
    await clickSel('.wtv-controls__button[data-is-loop]');
    await sleep(1000);
    }

    if (runs('loop')) {
    // ---- Loop: Mixing, Loop Channel, Repeat Video ---------------------------------------------------
    if (!url().startsWith('/tv/channel/')) {
      await page.goto(`${ORIGIN}/tv/channel/city-lights/tv-city-v0`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await waitFor(() => document.querySelector('video.wtv-video__video[data-is-loaded="true"]'), null, 20000);
    }
    const loopTip = () => text('.wtv-controls__button[data-is-loop] .wtv-tooltip__tooltip');
    const tips = [await loopTip()];
    for (let i = 0; i < 3; i += 1) {
      await clickSel('.wtv-controls__button[data-is-loop]');
      await sleep(350);
      tips.push(await loopTip());
    }
    check('Loop cycles Loop Channel, Repeat Video, Unloop', JSON.stringify(tips) === JSON.stringify(['Loop Channel', 'Repeat Video', 'Unloop', 'Loop Channel']), tips);
    await clickSel('.wtv-controls__button[data-is-loop]');
    await clickSel('.wtv-controls__button[data-is-loop]');
    await sleep(400);
    check('Repeat Video loops the clip', await page.evaluate(() => document.querySelector('video.wtv-video__video')?.loop === true));
    }

    if (runs('prompt')) {
    // ---- Pause, and the prompt toggle ------------------------------------------------------------
    await page.mouse.move(760, 300, { steps: 3 });
    await page.keyboard.press('Space');
    await sleep(400);
    const pausedState = await page.evaluate(() => ({ paused: document.querySelector('video.wtv-video__video')?.paused, big: !!document.querySelector('.wtv-button-playback__button'), tip: document.querySelector('.wtv-controls__button[data-is-playback] .wtv-tooltip__tooltip')?.textContent }));
    check('Space pauses, with the big play button on the video', pausedState.paused && pausedState.big && pausedState.tip === 'Play', pausedState);
    await shot('03-paused');
    await page.keyboard.press('Space');
    await sleep(300);
    await clickSel('.wtv-control-checkbox__button');
    await waitFor(() => !document.querySelector('.wtv-video-data__promptContainer'), null, 2000);
    check('Hide Prompt closes the prompt', (await count('.wtv-video-data__promptContainer')) === 0 && (await text('.wtv-video-data__toggleLabel')) === 'Show Prompt', await text('.wtv-video-data__toggleLabel'));
    await shot('04-prompt-hidden');
    await clickSel('.wtv-control-checkbox__button');
    await waitFor(() => document.querySelector('.wtv-video-data__promptContainer'), null, 2000);
    await sleep(500);
    }

    if (runs('grid')) {
    // ---- Grid view, and a tile growing into the lightbox ----------------------------------------
    if (!url().startsWith('/tv/channel/')) {
      await page.goto(`${ORIGIN}/tv/channel/forest-walk/tv-forest-v0`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await waitFor(() => document.querySelector('video.wtv-video__video[data-is-loaded="true"]'), null, 20000);
      await sleep(800);
    }
    await clickSel('.wtv-view-toggle__button:nth-child(2)');
    await waitFor(() => /\/tv\/channel\/[^/]+$/.test(location.pathname), null, 4000);
    await waitFor(() => document.querySelectorAll('.wtv-grid-generations__gridItemContainer').length > 0, null, 4000);
    await sleep(1200);
    const grid = await page.evaluate(() => ({ tiles: document.querySelectorAll('.wtv-grid-generations__gridItemContainer').length, prompt: !!document.querySelector('.wtv-video-data__container'), path: location.pathname }));
    check('grid view shows the channel\'s clips without the prompt', grid.tiles >= 2 && !grid.prompt, grid);
    await page.mouse.move(400, 200, { steps: 4 });
    await sleep(300);
    check('the tile under the pointer is the active one', await page.evaluate(() => document.querySelector('.wtv-grid-generations__container')?.getAttribute('data-has-active') === 'true'));
    await shot('05-grid');
    await clickSel('.wtv-grid-generations__gridItemContainer:nth-child(2) a');
    await waitFor(() => /\/tv\/channel\/[^/]+\/[^/]+$/.test(location.pathname) && document.querySelector('video.wtv-video__video'), null, 4000);
    const flip = await page.evaluate(() => document.querySelector('video.wtv-video__video')?.getAttribute('data-has-flip-transition'));
    check('a grid tile opens its clip, growing into place', flip === 'true', { flip, path: url() });
    await dumpLog('grid tile');
    await sleep(1500);
    }

    if (runs('pages')) {
    // ---- Channels, Shuffle All, Short Films ---------------------------------------------------------
    if (!url().startsWith('/tv/channel/')) {
      await page.goto(`${ORIGIN}/tv/channel/forest-walk/tv-forest-v0`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await waitFor(() => document.querySelector('video.wtv-video__video[data-is-loaded="true"]'), null, 20000);
      await sleep(800);
    }
    await clickSel('.wtv-controls__button[data-is-home]');
    await waitFor(() => location.pathname === '/tv/channels' && document.querySelector('.wtv-channels-grid__container'), null, 4000);
    await sleep(800);
    const channels = await page.evaluate(() => [...document.querySelectorAll('.wtv-list-item__text')].map((e) => e.textContent));
    check('Channels lists Shuffle All and every channel', channels[0] === 'Shuffle All' && channels.length === 4, channels);
    check('the sub-header has its back arrow and tabs', (await count('.wtv-sub-header__buttonArrowBack')) === 1 && (await count('.wtv-channels-and-short-films-sub-header__link')) === 2);
    await shot('06-channels');
    await clickSel('.wtv-channels-and-short-films-sub-header__link[href$="/short-films"]');
    await waitFor(() => location.pathname === '/tv/short-films' && document.querySelector('.wtv-selected-short-film__title'), null, 4000);
    await sleep(1000);
    const films = await page.evaluate(() => ({ title: document.querySelector('.wtv-selected-short-film__title')?.textContent, slides: document.querySelectorAll('.wtv-selector-carousel__carouselSlide').length }));
    check('Short Films shows the newest scene and every film', films.title === 'Night Drive' && films.slides === 2, films);
    await shot('07-short-films');
    await clickSel('.wtv-selector-carousel__carouselSlide:nth-child(2) button');
    await waitFor(() => document.querySelector('.wtv-selected-short-film__title')?.textContent === 'Into the Woods', null, 3000);
    check('a carousel slide selects its film', (await text('.wtv-selected-short-film__title')) === 'Into the Woods');
    await clickSel('.wtv-selected-short-film__buttonWatch');
    await waitFor(() => location.pathname === '/tv/channel/short-films/tv-film-woods', null, 4000);
    await waitFor(() => document.querySelector('canvas.wtv-video__video[data-is-loaded="true"]'), null, 15000);
    await sleep(1000);
    const film = await page.evaluate(() => ({
      label: document.querySelector('.wtv-video-controls__videoLengthLabel')?.textContent,
      header: document.querySelector('.wtv-channel-nav__header')?.textContent,
      name: document.querySelector('.wtv-channel-nav__name .wtv-channel-name__nameMeasurer')?.textContent,
      data: document.querySelector('.wtv-video-data__toggleLabel')?.textContent,
    }));
    check('a short film plays with its time and the Short Film remote', /^00:0\d \/ 00:12$/.test(film.label || '') && film.header === 'SHORT FILM' && film.data === 'Hide Data' && film.name === 'Into\u00a0the\nWoods', film);
    await shot('08-short-film');
    await dumpLog('short film');
    }

    if (runs('search')) {
    // ---- Search ---------------------------------------------------------------------------------
    await page.mouse.click(760, 36);
    await page.keyboard.type('forest');
    await sleep(400);
    check('typing offers Search “forest”', /Search “forest”/.test((await text('.wtv-search-input__queriesContainer')) || ''), await text('.wtv-search-input__queriesContainer'));
    await shot('09-search-typed');
    await page.keyboard.press('Enter');
    await waitFor(() => location.pathname === '/tv/search' && document.querySelector('.wtv-page-search__resultsContainer'), null, 4000);
    await sleep(800);
    const results = await count('.wtv-page-search__resultLink');
    check('search finds the channel\'s clips', results === 4, results);
    check('the sub-header names the search', /Search results for “forest”/.test((await text('.wtv-search-sub-header__title')) || ''));
    await shot('10-search');
    await clickSel('.wtv-page-search__resultLink');
    await waitFor(() => location.pathname.startsWith('/tv/channel/search/'), null, 4000);
    await sleep(1200);
    check('a result plays in the search channel', (await text('.wtv-channel-nav__header')) === 'SEARCH', url());
    await page.goto(`${ORIGIN}/tv/search?q=zzqqxxnothing`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => document.querySelector('.wtv-page-search__errorDescription'), null, 10000);
    check('no results says so', (await text('.wtv-page-search__errorDescription')) === 'No results found. Please try another search.');
    await shot('11-search-empty');
    }

    if (runs('dialogs')) {
    // ---- More, FAQ, 404, About, Share, fullscreen ------------------------------------------------
    await clickSel('.wtv-button-more-dropdown__container > button');
    await sleep(300);
    const more = await page.evaluate(() => [...document.querySelectorAll('.wtv-button-more-dropdown__dropdownLink')].map((e) => e.textContent.trim()));
    check('More lists feedback, legal and FAQ', more.join('|') === 'Send app feedback|Report legal issue|FAQ', more);
    await shot('12-more');
    await clickSel('.wtv-button-more-dropdown__dropdownLink[href$="/faq"]');
    await waitFor(() => location.pathname === '/tv/faq' && document.querySelector('.wtv-page-faq__question'), null, 4000);
    check('FAQ answers', (await count('.wtv-page-faq__question')) === 5);
    await shot('13-faq');
    await page.goto(`${ORIGIN}/tv/channel/zzz-not-a-channel`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => document.querySelector('.wtv-page-error__errorMessage'), null, 10000);
    check('an unknown channel is a 404', (await text('.wtv-page-error__errorMessage')) === '404. Page not found.');
    await shot('14-404');
    await page.goto(`${ORIGIN}/tv/channel/ocean-days/tv-ocean-v2`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitFor(() => document.querySelector('video.wtv-video__video[data-is-loaded="true"]'), null, 20000);
    await sleep(1200);
    await clickSel('.wtv-header__buttonsContainer button[aria-label="About Willow TV"]');
    await waitFor(() => document.querySelector('dialog.wtv-button-help-dialog__dialog[open]'), null, 3000);
    await sleep(300);
    check('About opens in the channel\'s colours', (await text('.wtv-button-help-dialog__modalTitle')) === 'About Willow TV');
    await shot('15-about');
    await clickSel('.wtv-button-help-dialog__modalButton');
    await waitFor(() => !document.querySelector('dialog.wtv-button-help-dialog__dialog'), null, 3000);
    await clickSel('.wtv-button-share-tablet__container button');
    await waitFor(() => document.querySelector('dialog.wtv-share-dialog__dialog[open]'), null, 3000);
    await sleep(800);
    const share = await page.evaluate(() => ({ title: document.querySelector('.wtv-share-dialog__title')?.textContent, copy: document.querySelector('.wtv-share-dialog__buttonCopyInnerContainer')?.textContent, download: !!document.querySelector('.wtv-share-dialog__buttonDownload'), video: !!document.querySelector('.wtv-share-dialog__videoContainer video') }));
    check('Share shows the clip, Copy Link and Download', share.title === 'Share' && share.copy === 'Copy Link' && share.download && share.video, share);
    await shot('16-share');
    await page.keyboard.press('Escape');
    await waitFor(() => !document.querySelector('dialog.wtv-share-dialog__dialog'), null, 3000);
    check('Escape closes Share', (await count('dialog.wtv-share-dialog__dialog')) === 0);
    await clickSel('.wtv-controls__button[data-is-fullscreen]');
    const full = await waitFor(() => document.fullscreenElement?.classList.contains('wtv-root'), null, 3000);
    check('Full Screen fills the screen with the TV', full);
    if (full) {
      await sleep(1500);
      await shot('17-fullscreen');
      await page.evaluate(() => document.exitFullscreen());
      await sleep(500);
    }
    }
    check('no page errors on Willow TV', errors.length === 0, errors.slice(0, 6));
  } catch (e) {
    console.error('FAILED:', e.stack || e.message);
    failures += 1;
  } finally {
    await browser.close();
    if (!KEEP) fs.rmSync(userDataDir, { recursive: true, force: true });
    console.log(`${failures ? `${failures} FAILED` : 'ALL PASSED'}${SHOTS ? ` (shots in ${SHOTS})` : ''}`);
    process.exit(failures ? 1 : 0);
  }
})();
