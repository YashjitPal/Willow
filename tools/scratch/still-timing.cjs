// One-off (own headless Chrome): is a video's frame drawable at 'loadeddata', or only a moment
// later? Samples the canvas mean brightness at loadeddata, after a requestVideoFrameCallback, and
// after a seek to 0. The source is %TEMP%/willow-perf/source.mp4.
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

(async () => {
  const sw = process.argv.includes('--sw-video');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', ...(sw ? ['--disable-accelerated-video-decode'] : [])],
  });
  const page = await browser.newPage();
  await page.goto('about:blank');
  const b64 = fs.readFileSync(path.join(os.tmpdir(), 'willow-perf', 'source.mp4')).toString('base64');
  const out = await page.evaluate(async (data) => {
    const url = URL.createObjectURL(await (await fetch(`data:video/mp4;base64,${data}`)).blob());
    const mean = (v) => {
      const c = document.createElement('canvas');
      c.width = 160; c.height = 90;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(v, 0, 0, 160, 90);
      const d = g.getImageData(0, 0, 160, 90).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return Math.round(s / (d.length / 4));
    };
    const runs = [];
    for (let k = 0; k < 4; k += 1) {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.src = url;
      await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
      const atLoaded = mean(v);
      await new Promise((r) => { v.requestVideoFrameCallback?.(() => r()); setTimeout(r, 300); });
      const afterFrameCb = mean(v);
      v.currentTime = 0;
      await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
      const afterSeek = mean(v);
      runs.push({ readyState: v.readyState, atLoaded, afterFrameCb, afterSeek });
      v.removeAttribute('src');
      v.load();
    }
    return runs;
  }, b64);
  console.log(sw ? 'software decode' : 'hardware decode', JSON.stringify(out));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
