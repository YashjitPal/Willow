// One-off: which WebCodecs encoders/decoders this Chrome has (the user's machine), for the export.
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:3101/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  console.log(JSON.stringify(await page.evaluate(async () => {
    const out = {};
    for (const codec of ['avc1.640028', 'avc1.64001f', 'avc1.4d0028', 'avc1.42001f']) {
      for (const hw of ['prefer-hardware', 'prefer-software']) {
        const r = await VideoEncoder.isConfigSupported({ codec, width: 1280, height: 720, bitrate: 10_000_000, framerate: 24, hardwareAcceleration: hw, avc: { format: 'avc' } }).catch((e) => ({ supported: `err ${e.message}` }));
        out[`enc ${codec} ${hw}`] = r.supported;
      }
    }
    for (const [codec, extra] of [['mp4a.40.2', {}], ['opus', {}]]) {
      const r = await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000, ...extra }).catch((e) => ({ supported: `err ${e.message}` }));
      out[`audio ${codec}`] = r.supported;
    }
    for (const codec of ['avc1.64001f', 'hvc1.1.6.L93.B0', 'vp09.00.10.08', 'av01.0.04M.08']) {
      const r = await VideoDecoder.isConfigSupported({ codec, codedWidth: 1280, codedHeight: 720 }).catch((e) => ({ supported: `err ${e.message}` }));
      out[`dec ${codec}`] = r.supported;
    }
    return out;
  }), null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
