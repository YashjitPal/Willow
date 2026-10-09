// The Media panel at phone, tablet and desktop sizes, on the :3101 test origin, in a headless
// Chrome of its own (OPFS stands in for the connected folder; nothing of the user's is read or
// changed, and no model is called). Seeds one project — images of every ratio, a collection, three
// videos, a song, a scene and a character — then opens every surface at each size and writes a
// screenshot and a metrics record per surface: the page's scroll width, controls that leave the
// viewport, touch targets under 32px, and controls that overlap. A contact sheet per surface puts
// the sizes side by side.
//   node tools/scratch/w-responsive.cjs [--sizes=phone,tablet,desktop] [--only=gallery,agent] [--fresh] [--dump=<sel>|<sel>]
//     sizes: phone 390x844, small 360x740, tablet 800x1280, sideways 844x390, landscape 1180x820,
//     laptop 1280x720, desktop 1536x826
//     the profile and its seeded project are kept between runs; --fresh seeds anew
//     --only=selftest-overlap (never run otherwise) checks that the overlap count catches a known fault
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const ROOT = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const PROJECT = 'Responsive';
const OUT = path.join(__dirname, '../ui-research/captures/willow/responsive');
const PROFILE = path.join(os.tmpdir(), 'willow-responsive-profile');
const SIZES = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  small: { width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { width: 800, height: 1280, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  // A phone on its side: a tablet's width, half a phone's height.
  sideways: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  landscape: { width: 1180, height: 820, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  laptop: { width: 1280, height: 720, deviceScaleFactor: 1.25 },
  desktop: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
};
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const SIZE_NAMES = (arg('sizes') || 'phone,tablet,desktop').split(',').filter((s) => SIZES[s]);
const ONLY = arg('only').split(',').filter(Boolean);
const FRESH = process.argv.includes('--fresh');
// --dump=<selector>|<selector>: after each surface, print where the first match of each sits.
const DUMP = arg('dump').split('|').filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (FRESH) fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir: PROFILE,
    defaultViewport: SIZES.desktop,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
    protocolTimeout: 600000,
  });
  let page = (await browser.pages())[0];
  const errors = [];
  const IGNORED = [/Invalid DOM property .*stroke-width/, /stroke-width strokeWidth/, /tailwindcss' violates/];
  const listen = (p) => {
    p.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 240)));
    p.on('console', (m) => { if (m.type() === 'error' && !IGNORED.some((re) => re.test(m.text()))) errors.push(`console: ${m.text().slice(0, 240)}`); });
  };
  listen(page);
  /** A page that crashed (a detached frame, a closed session) is replaced, and the surface retried. */
  const replacePage = async (size) => {
    try { await page.close(); } catch { /* already gone */ }
    page = await browser.newPage();
    listen(page);
    await page.setViewport(size);
  };
  const evalIn = (fn, ...args) => page.evaluate(fn, ...args);
  const waitFor = async (fn, ms = 20000, ...args) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await page.evaluate(fn, ...args).catch(() => null);
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(250);
    }
  };
  let projectId = null;
  const go = async (p, extra = '') => {
    // Each surface starts from the default view settings: the batch step's G would otherwise stay on.
    await evalIn(() => { try { localStorage.removeItem('willow-media-view-settings'); localStorage.removeItem('dashboard-background'); } catch { /* another origin */ } }).catch(() => {});
    const sep = p.includes('?') ? '&' : '?';
    await page.goto(`${ORIGIN}${p}${projectId ? `${sep}projectId=${encodeURIComponent(projectId)}` : ''}${extra}`, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});
    // The Loading page fades out once the project's media is read.
    await waitFor(() => !document.querySelector('.flow-loading-host') && document.readyState === 'complete', 60000);
    await sleep(900);
  };
  const clickSel = (sel, index = 0) => evalIn((s, i) => { const el = document.querySelectorAll(s)[i]; el?.click(); return !!el; }, sel, index);
  const clickText = (sel, text) => evalIn((s, t) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t); el?.click(); return !!el; }, sel, text);
  // The last match: a portalled panel sits at the end of <body>. Text includes icon ligature names.
  const clickLastMatching = (sel, pattern) => evalIn((s, p) => { const re = new RegExp(p); const el = [...document.querySelectorAll(s)].filter((e) => re.test(e.textContent.trim())).pop(); el?.click(); return !!el; }, sel, pattern);
  // Media's home, where Willow's own rail lands: the promo, then every project. Five more projects
  // fill the grid (registry entries only), and the promo's video holds one frame so runs compare.
  // The home draws My Apps only over a background other than the default solid one.
  const homePage = async ({ withApps = false } = {}) => {
    await evalIn(async (root, apps) => {
      if (apps) localStorage.setItem('dashboard-background', 'waves');
      else localStorage.removeItem('dashboard-background');
      const reg = await import(`${root}/platform/projects/src/registry.ts`);
      const list = reg.readProjectRegistry();
      const extra = ['Beach trip', 'Product shots', 'Music video', 'Storyboard', 'Logo ideas']
        .filter((name) => !list.some((p) => p.name === name))
        .map((name, i) => ({ id: `home-${i}`, name, kind: 'media' }));
      if (extra.length) reg.writeProjectRegistry([...list, ...extra]);
    }, ROOT, withApps).catch(() => {});
    await page.goto(`${ORIGIN}/?mode=media`, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});
    await waitFor(() => !!document.querySelector('video') && document.readyState === 'complete', 60000);
    await sleep(1500);
    await evalIn(() => Promise.all([...document.querySelectorAll('video')].map((v) => new Promise((done) => {
      v.pause();
      v.addEventListener('seeked', done, { once: true });
      v.currentTime = 1;
      setTimeout(done, 1500);
    }))));
    await sleep(800);
  };
  // The composer's settings: its trigger is the pill that shows the output count.
  const openSettings = () => evalIn(() => [...document.querySelectorAll('.prompt-container-box button')].find((b) => /x[1-4]\b/.test(b.textContent))?.click());
  const tap = async (sel, index = 0) => {
    const box = await evalIn((s, i) => { const el = document.querySelectorAll(s)[i]; if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel, index);
    if (!box) return false;
    await page.mouse.click(box.x, box.y);
    return true;
  };

  // ---- Seed the project, once per profile ------------------------------------------------------
  await page.goto(`${ORIGIN}/media`, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});
  await sleep(1500);
  const seeded = await evalIn(async (name) => {
    try {
      const root = await navigator.storage.getDirectory();
      const proj = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle(name);
      return JSON.parse(await (await (await proj.getFileHandle('.willow.json')).getFile()).text()).id;
    } catch { return null; }
  }, PROJECT);
  if (seeded) {
    projectId = seeded;
  } else {
    console.log('seeding…');
    await evalIn(async (root, name) => {
      const { writeMp4 } = await import(`${root}/features/media/src/scenes/mp4-write.ts`);
      const opfs = await navigator.storage.getDirectory();
      const base = await opfs.getDirectoryHandle('willow-test-root', { create: true });
      const proj = await (await base.getDirectoryHandle('Media', { create: true })).getDirectoryHandle(name, { create: true });
      const put = async (folder, file, blob) => {
        const dir = await proj.getDirectoryHandle(folder, { create: true });
        const w = await (await dir.getFileHandle(file, { create: true })).createWritable();
        await w.write(blob);
        await w.close();
      };
      const picture = async (w, h, hue, label) => {
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, `hsl(${hue} 55% 38%)`);
        grad.addColorStop(1, `hsl(${(hue + 60) % 360} 60% 22%)`);
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = `bold ${Math.round(Math.min(w, h) / 6)}px sans-serif`;
        g.fillText(label, Math.round(w * 0.08), Math.round(h * 0.6));
        return c.convertToBlob({ type: 'image/png' });
      };
      const shapes = [
        ['Mountain lake', 1280, 720, 200], ['City at night', 1280, 720, 260], ['Red fox', 1024, 1024, 20],
        ['Portrait study', 720, 1280, 330], ['Desert road', 1280, 720, 35], ['Ocean waves', 1200, 900, 190],
        ['Tall tower', 900, 1200, 280], ['Coffee cup', 1024, 1024, 25], ['Forest path', 1280, 720, 120],
        ['Skyline', 720, 1280, 230], ['Garden', 1200, 900, 95], ['Robot friend', 1024, 1024, 300],
        ['Snow peaks', 1280, 720, 210],
      ];
      for (const [label, w, h, hue] of shapes) await put('Images', `${label}.png`, await picture(w, h, hue, label));
      await put('Trips', 'Sunset beach.png', await picture(1280, 720, 15, 'Sunset'));
      await put('Trips', 'Harbor.png', await picture(1024, 1024, 185, 'Harbor'));
      const clip = async (w, h, hue, label) => {
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
        enc.configure({ codec: 'avc1.640028', width: w, height: h, bitrate: 1_000_000, framerate: fps, avc: { format: 'avc' } });
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext('2d');
        for (let i = 0; i < fps * 2; i += 1) {
          g.fillStyle = `hsl(${(hue + i * 3) % 360}, 50%, 35%)`; g.fillRect(0, 0, w, h);
          g.fillStyle = '#fff'; g.font = `bold ${Math.round(Math.min(w, h) / 5)}px sans-serif`; g.fillText(`${label} ${i}`, 24, Math.round(h * 0.55));
          const frame = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
          enc.encode(frame, { keyFrame: i % fps === 0 });
          frame.close();
        }
        await enc.flush();
        enc.close();
        return writeMp4({ width: w, height: h, description, chunks }, null);
      };
      await put('Videos', 'Cat running.mp4', await clip(640, 360, 20, 'CAT'));
      await put('Videos', 'Waves.mp4', await clip(640, 360, 200, 'WAVE'));
      await put('Videos', 'Tall city.mp4', await clip(360, 640, 280, 'CITY'));
      // A two-second WAV, for the Music tab.
      const rate = 22050;
      const samples = rate * 2;
      const wav = new DataView(new ArrayBuffer(44 + samples * 2));
      const text = (at, s) => { for (let i = 0; i < s.length; i += 1) wav.setUint8(at + i, s.charCodeAt(i)); };
      text(0, 'RIFF'); wav.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
      wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, rate, true);
      wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); text(36, 'data'); wav.setUint32(40, samples * 2, true);
      for (let i = 0; i < samples; i += 1) wav.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 330 * i) / rate) * 8000), true);
      await put('Audio', 'Theme song.wav', new Blob([wav.buffer], { type: 'audio/wav' }));
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('WillowLocalFS', 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('handles')) req.result.createObjectStore('handles'); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put({ handle: base, rootId: 'opfs-test-root' }, 'local_projects_dir');
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, ROOT, PROJECT);
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    projectId = await waitFor(async (name) => {
      const root = await navigator.storage.getDirectory();
      const proj = await (await (await root.getDirectoryHandle('willow-test-root')).getDirectoryHandle('Media')).getDirectoryHandle(name);
      return JSON.parse(await (await (await proj.getFileHandle('.willow.json')).getFile()).text()).id;
    }, 60000, PROJECT);
    if (!projectId) throw new Error('the project never registered');
    await go('/media');
    await waitFor(() => document.querySelectorAll('.gallery-tile').length >= 12, 60000);
    await sleep(3000);
    // A scene of two clips and a character, through the stores the app reads.
    await evalIn(async (root, id) => {
      const ms = await import(`${root}/platform/storage/src/media-storage.ts`);
      const sc = await import(`${root}/platform/storage/src/media-scenes.ts`);
      const ch = await import(`${root}/platform/storage/src/media-characters.ts`);
      const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const keys = await new Promise((res) => { const tx = db.transaction('project_media', 'readonly'); const q = tx.objectStore('project_media').getAllKeys(); q.onsuccess = () => res(q.result); });
      db.close();
      const scopes = keys.map(String).filter((k) => k.endsWith(`:project:${id}`)).map((k) => decodeURIComponent(k.slice('scope:'.length, k.lastIndexOf(':project:'))));
      const now = Date.now();
      for (const scope of scopes) {
        const media = await ms.loadProjectMedia(id, scope);
        const videos = media.filter((m) => m.kind === 'video').slice(0, 2);
        if (videos.length) {
          await sc.saveScene(id, {
            id: 'responsive-scene', name: 'Beach day', createdAt: now, updatedAt: now, aspectRatio: '16:9',
            clips: videos.map((v, i) => ({ id: `k${i}`, mediaId: v.id, trimStart: 0, trimEnd: 2, sourceDuration: 2 })),
          }, scope);
        }
        await ch.saveCharacter(id, { id: 'responsive-character', name: 'Ava', createdAt: now, updatedAt: now, prompt: 'A cheerful explorer' }, scope);
      }
    }, ROOT, projectId);
  }
  console.log('project', projectId);

  // ---- Surfaces ----------------------------------------------------------------------------------
  const gallery = async () => { await go('/media'); await waitFor(() => document.querySelectorAll('.gallery-tile').length >= 8, 30000); await sleep(600); };
  // A template opens as your copy, which navigates again: Edit exists once the copy's header does.
  const openToolEdit = async () => {
    await go('/media/tools');
    await waitFor(() => !!document.querySelector('.applet-section'), 30000);
    await clickText('.marketplace-toggles .mat-button-toggle-button', 'Templates');
    await waitFor(() => !!document.querySelector('.applet-grid-gallery'), 15000);
    await sleep(800);
    await clickSel('.applet-grid-gallery .ng-flow-applet-card .applet-card-main');
    await waitFor(() => !!document.querySelector('.applet-view-toggles'), 30000);
    await clickText('.applet-view-toggles .mat-button-toggle-button', 'Edit');
    await waitFor(() => !!document.querySelector('.sidebar-wrapper.sidebar-visible'), 15000);
    await sleep(2500);
  };
  // A phone's header keeps View settings and Filters in More.
  const fromMore = async (label) => {
    await clickSel('header button[aria-label="More options"]');
    await sleep(500);
    return evalIn((t) => { const el = [...document.querySelectorAll('.sb-menu-item')].find((e) => e.textContent.includes(t)); el?.click(); return !!el; }, label);
  };
  const surfaces = [
    { name: 'media-home', run: homePage },
    { name: 'media-home-projects', run: async () => { await homePage(); await evalIn(() => document.querySelector('.grid.grid-cols-3')?.scrollIntoView({ block: 'start' })); await sleep(700); } },
    // A touch screen's card menu is a sheet from the card's three dots; a mouse hovers the card.
    { name: 'media-home-menu', run: async () => { await homePage(); if (!(await clickSel('.mh-card-more'))) await page.hover('.mh-card').catch(() => {}); await sleep(800); } },
    { name: 'media-home-apps', run: async () => { await homePage({ withApps: true }); await evalIn(() => document.querySelector('.showcase-panel')?.scrollIntoView({ block: 'start' })); await sleep(900); } },
    { name: 'media-home-rename', run: async () => {
      await homePage();
      if (await clickSel('.mh-card-more')) {
        await sleep(600);
        await clickLastMatching('button, [role="menuitem"]', 'Rename$');
      } else {
        await page.hover('.mh-card').catch(() => {});
        await sleep(300);
        await clickSel('.mh-card .mh-caption button');
      }
      await sleep(800);
    } },
    { name: 'gallery', run: gallery },
    { name: 'drawer', run: async () => { await gallery(); await clickSel('button[aria-label="Open menu"]'); await sleep(700); } },
    { name: 'gallery-scrolled', run: async () => { await gallery(); await evalIn(() => { const m = document.querySelector('main'); m?.scrollBy(0, 500); }); await sleep(900); } },
    { name: 'images-tab', run: async () => { await go('/media/images'); await sleep(800); } },
    { name: 'video-tab', run: async () => { await go('/media/video'); await sleep(1200); } },
    { name: 'characters-tab', run: async () => { await go('/media/characters'); await sleep(1200); } },
    { name: 'music-tab', run: async () => { await go('/media/music'); await sleep(1200); } },
    { name: 'scenes-tab', run: async () => { await go('/media/scenes'); await sleep(1200); } },
    { name: 'uploads-tab', run: async () => { await go('/media/uploads'); await sleep(800); } },
    { name: 'collection', run: async () => { await gallery(); await evalIn(() => [...document.querySelectorAll('[data-drop-collection]')].find((el) => /Trips/.test(el.textContent))?.click()); await sleep(1500); } },
    { name: 'batch', run: async () => { await gallery(); await page.keyboard.press('g'); await sleep(1200); } },
    { name: 'menu-view-settings', run: async () => { await gallery(); if (!(await clickSel('button[aria-label="Tile grid settings"]'))) await fromMore('View settings'); await sleep(700); }, after: async () => { await page.keyboard.press('Escape'); await page.keyboard.press('g').catch(() => {}); } },
    { name: 'menu-filter', run: async () => { await gallery(); if (!(await clickSel('button[title="Filtering and sorting options"]'))) await fromMore('Filter and sort'); await sleep(700); } },
    { name: 'menu-add', run: async () => { await gallery(); await clickSel('button[aria-label="Add media menu"]'); await sleep(700); } },
    { name: 'menu-more', run: async () => { await gallery(); await clickSel('header button[aria-label="More options"]'); await sleep(700); } },
    { name: 'menu-project', run: async () => { await gallery(); await clickSel('button[aria-label="More options for the project"]'); await sleep(700); } },
    { name: 'menu-account', run: async () => { await gallery(); await clickSel('button[aria-label="Open account menu"]'); await sleep(700); } },
    { name: 'search-open', run: async () => { await gallery(); await clickSel('button[title="Search"]'); await sleep(700); } },
    { name: 'composer-settings', run: async () => { await gallery(); await openSettings(); await sleep(800); } },
    { name: 'composer-settings-video', run: async () => { await gallery(); await openSettings(); await sleep(500); await clickLastMatching('button', 'Video$'); await sleep(800); } },
    { name: 'composer-settings-model', run: async () => { await gallery(); await openSettings(); await sleep(500); await clickLastMatching('button', 'Video$'); await sleep(500); await clickLastMatching('button', '^No video model'); await sleep(800); } },
    { name: 'composer-add', run: async () => { await gallery(); await clickSel('button[aria-label="Add ingredients to the prompt box"]'); await sleep(900); } },
    { name: 'composer-typed', run: async () => { await gallery(); await tap('[contenteditable="true"]'); await page.keyboard.type('A cinematic shot of a red fox running through a snowy forest at dawn, golden light, shallow depth of field'); await sleep(500); } },
    { name: 'agent', run: async () => { await gallery(); await clickText('.prompt-container-box button', 'Agent'); await sleep(500); await clickSel('button[title="Expand"]'); await sleep(1500); } },
    { name: 'tile-menu', run: async () => { await gallery(); await evalIn(() => { const t = document.querySelector('.gallery-tile'); const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); }); await sleep(800); } },
    // A DOM click: on a short screen the composer covers the tile's middle, where a tap lands.
    { name: 'image-view', run: async () => { await gallery(); await clickSel('.gallery-tile[data-id^="disk_image_"]'); await waitFor(() => !!document.querySelector('.ie-read-only-image'), 15000); await sleep(1500); } },
    { name: 'image-edit-settings', run: async () => { await gallery(); await clickSel('.gallery-tile[data-id^="disk_image_"]'); await waitFor(() => !!document.querySelector('.ie-settings-trigger'), 15000); await sleep(1200); await clickSel('.ie-settings-trigger'); await sleep(800); } },
    { name: 'video-view', run: async () => { await gallery(); await clickSel('.gallery-tile[data-id^="disk_video_"]'); await waitFor(() => !!document.querySelector('.sb-editor'), 20000); await sleep(2500); } },
    { name: 'scene', run: async () => { await go('/media/scenes', '&scene=responsive-scene'); await waitFor(() => !!document.querySelector('.sb-editor'), 20000); await sleep(2500); } },
    { name: 'character-new', run: async () => { await go('/media/characters', '&character=new'); await waitFor(() => document.querySelectorAll('.cn-card__thumb').length >= 6 && [...document.querySelectorAll('.cn-card__thumb')].every((i) => i.complete), 20000); await sleep(800); } },
    { name: 'character-page', run: async () => { await go('/media/characters', '&character=responsive-character'); await waitFor(() => !!document.querySelector('.ce-page .ce-slots'), 20000); await sleep(1500); } },
    { name: 'music-player', run: async () => { await go('/media/music'); await sleep(1000); await tap('.gallery-tile'); await sleep(1500); } },
    // An audio tile in the gallery opens the music player beside it.
    { name: 'music-sidebar', run: async () => { await gallery(); if (await clickSel('.gallery-tile[data-id^="disk_audio_"]')) await waitFor(() => !!document.querySelector('.music-player-sidebar[style*="translateX(0"]'), 10000); await sleep(1500); } },
    { name: 'tools', run: async () => { await go('/media/tools'); await waitFor(() => !!document.querySelector('.applet-section'), 30000); await sleep(1000); } },
    { name: 'tools-templates', run: async () => { await go('/media/tools'); await waitFor(() => !!document.querySelector('.applet-section'), 30000); await clickText('.marketplace-toggles .mat-button-toggle-button', 'Templates'); await waitFor(() => !!document.querySelector('.applet-grid-gallery'), 15000); await sleep(1200); } },
    { name: 'tool-view', run: async () => { await go('/media/tools'); await waitFor(() => !!document.querySelector('.applet-section'), 30000); await clickText('.marketplace-toggles .mat-button-toggle-button', 'Templates'); await sleep(800); await clickSel('.applet-grid-gallery .ng-flow-applet-card .applet-card-main'); await waitFor(() => !!document.querySelector('.applet-view-header'), 30000); await sleep(4000); } },
    { name: 'tool-edit', run: openToolEdit },
    { name: 'tool-edit-preview', run: async () => { await openToolEdit(); if (await clickText('.wt-edit-pane', 'Preview')) await sleep(2500); } },
    { name: 'create-tool', run: async () => { await go('/media/create-tool'); await waitFor(() => document.querySelectorAll('.suggestion-card').length >= 3, 20000); await sleep(1200); } },
    { name: 'tv', run: async () => { await page.goto(`${ORIGIN}/tv`, { waitUntil: 'domcontentloaded' }).catch(() => {}); await sleep(5000); } },
    // Only when named in --only, and last: puts back, in this browser alone, the settings sheet's
    // fixed 34px and 42px rows under 44px toggles, so the overlap check must report them.
    { name: 'selftest-overlap', optIn: true, run: async () => {
      await gallery();
      await evalIn(() => { const s = document.createElement('style'); s.textContent = '.media-settings-sheet .h-\\[34px\\] { height: 34px !important; } .media-settings-sheet .h-\\[42px\\] { height: 42px !important; }'; document.head.append(s); });
      await openSettings(); await sleep(500); await clickLastMatching('button', 'Video$'); await sleep(800);
    } },
  ].filter((s) => (ONLY.length ? ONLY.includes(s.name) : !s.optIn));

  const metrics = () => evalIn((dump) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dumped = dump.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return `${sel}: none`;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return `${sel}: [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}] ${s.position} height ${s.height} max ${s.maxHeight} inline ${el.style.height || '-'} padding ${s.padding}`;
    });
    const describe = (el) => {
      const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim().slice(0, 28);
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${label ? ` "${label}"` : ''}`;
    };
    const shown = (el) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
      }
      return true;
    };
    const controls = [...document.querySelectorAll('button, a[href], input, textarea, select, [role="button"], [role="menuitem"], [role="tab"], [contenteditable="true"]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && shown(el); });
    const offscreen = controls
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.right > vw + 1 || r.left < -1)
      .map(({ el, r }) => `${describe(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    const small = controls
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width < 32 || r.height < 32)
      .map(({ el, r }) => `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    // Controls running into each other: two in the same layer (a fixed, sticky or z-indexed
    // absolute ancestor, else the page), neither inside the other, whose visible parts overlap.
    // A sheet over the gallery is another layer, so layering on purpose is not counted.
    const layerOf = (el) => {
      for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.position === 'fixed' || s.position === 'sticky' || (s.position === 'absolute' && s.zIndex !== 'auto')) return e;
      }
      return document.body;
    };
    // A text field's padding holds no text, so only its content box can run under a neighbour.
    const textField = (el) => el.matches('input, textarea, [contenteditable="true"]');
    const visibleRect = (el) => {
      const r = el.getBoundingClientRect();
      let { left, top, right, bottom } = r;
      if (textField(el)) {
        const s = getComputedStyle(el);
        left += parseFloat(s.paddingLeft) || 0; right -= parseFloat(s.paddingRight) || 0;
        top += parseFloat(s.paddingTop) || 0; bottom -= parseFloat(s.paddingBottom) || 0;
      }
      for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        const c = e.getBoundingClientRect();
        left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
      }
      return right - left > 0 && bottom - top > 0 ? { left, top, right, bottom } : null;
    };
    // One no tap can reach (at its centre or its quarters' centres) is wholly behind something, a
    // stacked player say, not running into it.
    const reachable = (el, r) => [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].some(([fx, fy]) => {
      const hit = document.elementFromPoint(r.left + (r.right - r.left) * fx, r.top + (r.bottom - r.top) * fy);
      return !!hit && (hit === el || el.contains(hit));
    });
    const boxes = controls.map((el) => ({ el, r: visibleRect(el), layer: layerOf(el) })).filter((b) => b.r && reachable(b.el, b.r));
    const overlaps = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > 2) overlaps.push(`${describe(a.el)} x ${describe(b.el)} ${Math.round(w)}x${Math.round(h)}`);
      }
    }
    return {
      viewport: `${vw}x${vh}`,
      scrollWidth: document.documentElement.scrollWidth,
      overflowsX: document.documentElement.scrollWidth > vw + 1,
      offscreen: [...new Set(offscreen)].slice(0, 15),
      smallTargets: small.length,
      smallSample: [...new Set(small)].slice(0, 10),
      overlaps: overlaps.length,
      overlapSample: overlaps.slice(0, 12),
      dumped,
    };
  }, DUMP);

  const report = {};
  for (const sizeName of SIZE_NAMES) {
    const size = SIZES[sizeName];
    await page.setViewport(size);
    const dir = path.join(OUT, sizeName);
    fs.mkdirSync(dir, { recursive: true });
    for (const surface of surfaces) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        errors.length = 0;
        try {
          await surface.run();
          await page.screenshot({ path: path.join(dir, `${surface.name}.png`) });
          report[`${sizeName}/${surface.name}`] = { ...(await metrics()), errors: errors.slice(0, 4) };
          const m = report[`${sizeName}/${surface.name}`];
          console.log(`${sizeName.padEnd(9)} ${surface.name.padEnd(20)} scroll ${m.scrollWidth}/${size.width}${m.overflowsX ? ' OVERFLOW' : ''} off ${m.offscreen.length} small ${m.smallTargets}${m.overlaps ? ` OVERLAP ${m.overlaps}` : ''}${m.errors.length ? ` errors ${m.errors.length}` : ''}`);
          for (const line of m.dumped) console.log(`    ${line}`);
          break;
        } catch (e) {
          const message = String(e.message || e);
          const crashed = /detached Frame|Session closed|Target closed|crashed/i.test(message);
          if (crashed && attempt === 0) { await replacePage(size); continue; }
          report[`${sizeName}/${surface.name}`] = { failed: message.slice(0, 240) };
          console.log(`${sizeName.padEnd(9)} ${surface.name.padEnd(20)} FAILED ${message.slice(0, 120)}`);
          if (crashed) await replacePage(size);
          break;
        }
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  fs.writeFileSync(path.join(OUT, `metrics-${SIZE_NAMES.join('-')}.json`), JSON.stringify(report, null, 2));

  // ---- Contact sheets: the sizes side by side, scaled to one height ------------------------------
  const sheet = await browser.newPage();
  for (const surface of surfaces) {
    const shots = SIZE_NAMES
      .map((s) => ({ s, file: path.join(OUT, s, `${surface.name}.png`) }))
      .filter(({ file }) => fs.existsSync(file))
      .map(({ s, file }) => ({ s, data: `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` }));
    if (!shots.length) continue;
    await sheet.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    await sheet.setContent(`<body style="margin:0;background:#222;display:flex;gap:12px;align-items:flex-start;padding:12px;font:14px sans-serif;color:#ddd">${shots.map(({ s, data }) => `<figure style="margin:0"><figcaption>${s}</figcaption><img src="${data}" style="height:760px;display:block;border:1px solid #444"></figure>`).join('')}</body>`);
    await sleep(300);
    const box = await sheet.evaluate(() => ({ w: document.body.scrollWidth, h: document.body.scrollHeight }));
    await sheet.setViewport({ width: Math.min(box.w, 3000), height: box.h, deviceScaleFactor: 1 });
    await sheet.screenshot({ path: path.join(OUT, `sheet-${surface.name}.png`) });
  }
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
