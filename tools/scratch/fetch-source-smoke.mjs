/**
 * Drive `api/fetch-source.js` the way Vercel and the dev middleware do, without a
 * browser or a server. Throwaway: lives in tools/scratch, not in the test suite.
 *
 *   node tools/scratch/fetch-source-smoke.mjs
 */
import handler from '../../api/fetch-source.js';

const call = async (url, { enabled = true } = {}) => {
  if (enabled) process.env.SOURCE_FETCH_ENABLED = '1';
  else delete process.env.SOURCE_FETCH_ENABLED;

  const chunks = [];
  const res = {
    statusCode: 0,
    headers: {},
    status(code) { res.statusCode = code; return res; },
    setHeader(key, value) { res.headers[key] = value; },
    end(body) { if (body) chunks.push(body); },
  };
  await handler({ method: 'GET', url: `/api/fetch-source?url=${encodeURIComponent(url)}` }, res);
  let payload = null;
  try {
    payload = JSON.parse(chunks.join(''));
  } catch {
    payload = { raw: chunks.join('').slice(0, 200) };
  }
  return { status: res.statusCode, payload };
};

const show = (label, { status, payload }) => {
  const detail = payload?.text
    ? `${payload.text.length} chars, title "${payload.title}"`
    : payload?.error ?? JSON.stringify(payload).slice(0, 120);
  console.log(`${String(status).padEnd(4)} ${label.padEnd(46)} ${detail}`);
  if (payload?.text) console.log(`     first 160: ${payload.text.slice(0, 160).replace(/\n/g, ' ⏎ ')}`);
};

console.log('status  case                                           result');
show('disabled (no SOURCE_FETCH_ENABLED)', await call('https://example.com', { enabled: false }));
show('loopback is refused', await call('http://127.0.0.1:3000/'));
show('private range is refused', await call('http://192.168.1.1/'));
show('cloud metadata is refused', await call('http://169.254.169.254/latest/meta-data/'));
show('file:// is refused', await call('file:///etc/passwd'));
show('example.com', await call('https://example.com'));
show('a real article', await call('https://en.wikipedia.org/wiki/Photosynthesis'));
