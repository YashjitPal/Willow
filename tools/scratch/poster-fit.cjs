// One-off (headless Chrome, no app needed): does a <video preload="none" poster> draw its poster
// with object-fit: cover? A 400x100 striped poster in a 200x200 box: cover crops it to the middle
// 100x100 (scaled 2x); contain would letterbox it. Prints the box's sampled pixels.
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, defaultViewport: { width: 400, height: 300 } });
  const page = await browser.newPage();
  await page.setContent('<body style="margin:0;background:#00f"></body>');
  const out = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 100;
    const g = c.getContext('2d');
    g.fillStyle = '#f00'; g.fillRect(0, 0, 100, 100);
    g.fillStyle = '#0f0'; g.fillRect(100, 0, 200, 100);
    g.fillStyle = '#ff0'; g.fillRect(300, 0, 100, 100);
    const url = URL.createObjectURL(await new Promise((r) => c.toBlob(r, 'image/png')));
    const v = document.createElement('video');
    v.preload = 'none';
    v.muted = true;
    v.poster = url;
    v.src = 'data:video/mp4;base64,AAAA';
    v.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:200px;object-fit:cover;display:block';
    document.body.appendChild(v);
    await new Promise((r) => setTimeout(r, 500));
    return { networkState: v.networkState, readyState: v.readyState };
  });
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 200, height: 200 }, encoding: 'base64' });
  const px = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const at = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)].join(',');
    return { topLeft: at(5, 5), center: at(100, 100), leftMid: at(5, 100), rightMid: at(195, 100), topMid: at(100, 5) };
  }, shot);
  console.log(JSON.stringify({ ...out, ...px, expectCover: 'all green (0,255,0)', expectContain: 'top/bottom blue, sides red/yellow' }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
