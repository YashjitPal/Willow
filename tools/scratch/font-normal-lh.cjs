/**
 * The height of a 16px line of a font family at `line-height: normal`, and the face's source,
 * in a marked window — to compare the vertical metrics two pages give the same family.
 *
 *   node tools/scratch/font-normal-lh.cjs <marker> ["Google Sans Flex"]
 */
const puppeteer = require('puppeteer-core');

const [marker, family = 'Google Sans Flex'] = process.argv.slice(2);

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 30_000 });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().includes(`#${marker}`));
  if (!target) throw new Error(`no window marked #${marker}`);
  const page = await target.page();
  console.log(JSON.stringify(await page.evaluate(async (fam) => {
    await document.fonts.ready;
    const probe = (style) => {
      const s = document.createElement('span');
      s.style.cssText = `position:absolute;left:-9999px;top:0;font-family:"${fam}";font-size:16px;line-height:normal;white-space:nowrap;${style}`;
      s.textContent = 'Delete Copy image';
      document.body.appendChild(s);
      const h = s.getBoundingClientRect().height;
      s.remove();
      return Math.round(h * 100) / 100;
    };
    const faces = [...document.fonts].filter((f) => f.family.replace(/"/g, '') === fam).map((f) => `${f.status} ${f.weight} ${f.stretch} ${f.style}`).slice(0, 6);
    return { inline16: probe('display:inline-block'), weight470: probe('display:inline-block;font-variation-settings:"wght" 470'), faces };
  }, family)));
  await browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
