// One-off: does the scene export keep sound and picture together? Builds a 3s source in the page
// (WebCodecs + the app's own mp4-write): black frames with one white frame at 1.000s, silence with
// a 1kHz beep starting at 1.000s. Exports a scene of it trimmed to 0.5-2.5s with the app's
// exportScene, then finds the flash and the beep in both files (frames decoded with WebCodecs,
// audio with decodeAudioData as a player would) and prints the beep-minus-flash offset of each.
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');

const FS = '/@fs/C:/Users/Yashjit 2/Workspace/Willow Code/features/media/src/scenes/';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir: path.join(os.tmpdir(), 'willow-perf', 'export-profile'),
    args: ['--use-angle=d3d11', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
    protocolTimeout: 600000,
  });
  const page = (await browser.pages())[0];
  page.on('console', (m) => { if (m.type() === 'warn' && /scene-export/.test(m.text())) console.log('[page warn]', m.text()); });
  await page.goto('http://localhost:3101/media', { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
  const out = await page.evaluate(async (base) => {
    const { writeMp4 } = await import(encodeURI(`${base}mp4-write.ts`));
    const { readMp4VideoTrack } = await import(encodeURI(`${base}mp4-read.ts`));
    const { exportScene } = await import(encodeURI(`${base}scene-export.ts`));
    const W = 1280; const H = 720; const FPS = 24; const SR = 48000;
    // Source video.
    const vChunks = []; let vDesc = null;
    const venc = new VideoEncoder({ output: (c, m) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); vChunks.push({ data: d, timestamp: c.timestamp, duration: c.duration, key: c.type === 'key' }); if (m?.decoderConfig?.description && !vDesc) vDesc = new Uint8Array(m.decoderConfig.description); }, error: (e) => { throw e; } });
    venc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 4e6, framerate: FPS, avc: { format: 'avc' } });
    const cv = new OffscreenCanvas(W, H); const g = cv.getContext('2d');
    for (let i = 0; i < 3 * FPS; i += 1) {
      g.fillStyle = i === FPS ? '#fff' : '#000'; g.fillRect(0, 0, W, H);
      const f = new VideoFrame(cv, { timestamp: Math.round((i / FPS) * 1e6), duration: Math.round(1e6 / FPS) });
      venc.encode(f, { keyFrame: i % FPS === 0 }); f.close();
    }
    await venc.flush(); venc.close();
    // Source audio.
    const total = 3 * SR;
    const pcm = new Float32Array(total);
    for (let s = SR; s < SR + SR / 10; s += 1) pcm[s] = 0.8 * Math.sin((2 * Math.PI * 1000 * (s - SR)) / SR);
    const aChunks = []; let aDesc = null;
    const aenc = new AudioEncoder({ output: (c, m) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); aChunks.push({ data: d, timestamp: c.timestamp, duration: c.duration }); if (m?.decoderConfig?.description && !aDesc) aDesc = new Uint8Array(m.decoderConfig.description); }, error: (e) => { throw e; } });
    aenc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 128000 });
    for (let at = 0; at < total; at += 1024) {
      const n = Math.min(1024, total - at);
      const planar = new Float32Array(n * 2); planar.set(pcm.subarray(at, at + n), 0); planar.set(pcm.subarray(at, at + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at / SR) * 1e6), data: planar });
      aenc.encode(ad); ad.close();
    }
    await aenc.flush(); aenc.close();
    const source = writeMp4({ width: W, height: H, description: vDesc, chunks: vChunks }, { sampleRate: SR, channels: 2, description: aDesc, chunks: aChunks });
    const firstAudioTs = aChunks[0].timestamp;

    // Export a trimmed scene of it.
    const srcUrl = URL.createObjectURL(source);
    let captured = null;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { captured = this.href; return undefined; } return click.call(this); };
    try {
      await exportScene({ id: 'sync', name: 'sync', createdAt: 0, updatedAt: 0, aspectRatio: '16:9', clips: [{ id: 'a', mediaId: 'x', trimStart: 0.5, trimEnd: 2.5, sourceDuration: 3 }] }, () => srcUrl);
    } finally { HTMLAnchorElement.prototype.click = click; }
    const exported = await (await fetch(captured)).blob();

    // Where the flash and the beep are, in a file.
    const measure = async (blob) => {
      const buf = await blob.arrayBuffer();
      const track = readMp4VideoTrack(buf);
      let flash = null;
      const dec = new VideoDecoder({ output: (f) => { const c = new OffscreenCanvas(16, 9); const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(f, 0, 0, 16, 9); const p = x.getImageData(8, 4, 1, 1).data[0]; if (p > 200 && flash === null) flash = f.timestamp / 1e6; f.close(); }, error: () => {} });
      dec.configure({ codec: track.codec, description: track.description, codedWidth: track.width, codedHeight: track.height });
      for (const s of [...track.samples].sort((a, b) => a.dts - b.dts)) dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.pts * 1e6), data: new Uint8Array(buf, s.offset, s.size) }));
      await dec.flush(); dec.close();
      const audio = await new OfflineAudioContext(2, SR, SR).decodeAudioData(buf.slice(0));
      const ch = audio.getChannelData(0);
      let onset = null;
      for (let s = 0; s < ch.length; s += 1) if (Math.abs(ch[s]) > 0.1) { onset = s / audio.sampleRate; break; }
      return { flashAt: flash, beepAt: onset === null ? null : Math.round(onset * 10000) / 10000, offsetMs: flash === null || onset === null ? null : Math.round((onset - flash) * 10000) / 10 };
    };
    return { encoderFirstAudioTimestampUs: firstAudioTs, source: await measure(source), exported: await measure(exported) };
  }, FS);
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
