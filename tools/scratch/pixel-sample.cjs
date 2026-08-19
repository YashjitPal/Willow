/**
 * Sample pixels out of the two chip crops, by decoding them in a blank tab's canvas.
 * Computed styles can disagree with what actually paints (overlays, ripples), so this
 * is the tiebreaker.
 */
const { connect } = require('../ui-research/scrapers/notebooks/lib.cjs');
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '../ui-research/captures/notebooks/src-chip');

const PROBE = `(dataUrl) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = (x, y) => {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
    };
    const counts = {};
    const all = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < all.length; i += 4) {
      const k = 'rgb(' + all[i] + ',' + all[i + 1] + ',' + all[i + 2] + ')';
      counts[k] = (counts[k] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    resolve({
      size: [c.width, c.height],
      corner: px(1, 1),
      chipMidRight: px(c.width - 14, Math.round(c.height / 2)),
      iconCentre: px(18, Math.round(c.height / 2)),
      justLeftOfIcon: px(11, Math.round(c.height / 2)),
      top,
    });
  };
  img.src = dataUrl;
})`;

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => p.url() === 'about:blank');
    if (!page) throw new Error('no about:blank tab to borrow');
    for (const name of ['gemini-chip.png', 'willow-chip.png']) {
      const buf = fs.readFileSync(path.join(DIR, name));
      const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
      const res = await page.evaluate(new Function('return ' + PROBE)(), dataUrl);
      console.log(`\n${name}  ${res.size.join('x')}`);
      console.log(`  corner          ${res.corner}`);
      console.log(`  chip mid-right  ${res.chipMidRight}`);
      console.log(`  just left of icon ${res.justLeftOfIcon}`);
      console.log(`  icon centre     ${res.iconCentre}`);
      console.log('  most common:');
      for (const [c, n] of res.top) console.log(`    ${c} x${n}`);
    }
  } finally {
    await browser.disconnect();
  }
})();
