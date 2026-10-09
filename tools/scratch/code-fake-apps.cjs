/**
 * Willow (never the media tab): shows the Code landing's "Your apps" section with three
 * made-up code projects, entirely in page memory. localStorage reads of the project
 * registry get the fakes appended; writes and removals of any registry, project-state or
 * tombstone key are dropped, so nothing reaches storage. `off` reloads the tab, which
 * removes every patch.
 *
 *   node tools/scratch/code-fake-apps.cjs on|off
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const mode = process.argv[2] || 'on';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no Willow tab');

  if (mode === 'off') {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 2500));
    console.log('reloaded; patches gone');
    browser.disconnect();
    return;
  }

  const result = await page.evaluate(() => {
    if (window.__fakeApps) return 'already on';
    const isRegistryKey = (k) => typeof k === 'string' && (
      k.startsWith('willow_projects_list') || k.startsWith('willow_project_state:v2:') || k.startsWith('willow_project_delete')
    );
    const proto = Storage.prototype;
    const get = proto.getItem;
    const set = proto.setItem;
    const remove = proto.removeItem;
    const covers = [...document.querySelectorAll('.code-bento-media img')].map((img) => img.src);
    const fakes = [
      { id: 'zz-fake-app-1', name: 'Todo Board', kind: 'code', coverUrl: covers[0] },
      { id: 'zz-fake-app-2', name: 'Weather Glance with a much longer project name', kind: 'code', coverUrl: covers[1], isStarred: true },
      { id: 'zz-fake-app-3', name: 'Budget Buddy', kind: 'code' },
    ];
    proto.getItem = function (k) {
      const value = get.call(this, k);
      if (this !== localStorage || typeof k !== 'string' || !k.startsWith('willow_projects_list:v2:')) return value;
      let list = [];
      try { list = JSON.parse(value || '[]'); } catch {}
      return JSON.stringify([...(Array.isArray(list) ? list : []), ...fakes]);
    };
    proto.setItem = function (k, v) {
      if (this === localStorage && isRegistryKey(k)) return console.warn('[fake-apps] dropped write', k);
      return set.call(this, k, v);
    };
    proto.removeItem = function (k) {
      if (this === localStorage && isRegistryKey(k)) return console.warn('[fake-apps] dropped remove', k);
      return remove.call(this, k);
    };
    window.__fakeApps = true;
    window.dispatchEvent(new Event('willow_projects_updated'));
    return `on (${covers.length} covers)`;
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const scroller = document.querySelector('.code-idle');
    const section = document.querySelector('.code-apps-section');
    if (scroller && section) scroller.scrollTop = section.offsetTop;
  });
  await new Promise((r) => setTimeout(r, 800));
  console.log(result);
  browser.disconnect();
})();
