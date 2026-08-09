/**
 * How a remote image is fetched — the referrer policy, the optional proxy, and
 * the three call sites that must all go through them.
 *
 * WHY ANY OF THIS EXISTS. Every image on a live Gemini response page — all 11,
 * measured — is served from a Google-owned host (`encrypted-tbn{0,1,3}
 * .gstatic.com`, `lh3.googleusercontent.com`, `www.gstatic.com`). Not one
 * third-party URL is hotlinked. Gemini's retrieval pipeline resolves a picture
 * server-side and rewrites it through an image proxy, so the client only ever
 * handles URLs guaranteed to load.
 *
 * Willow's model hands us whatever URL it found instead, which fails three
 * different ways: hotlink refusal (fixed on the client with `no-referrer`),
 * mixed content (fixable only by a server re-serving over https), and the
 * privacy leak of every publisher seeing the user's IP. Hence a client-side
 * policy that is unconditional, and a proxy that is optional.
 *
 * `image-source.ts` is plain TypeScript with no React or CSS imports, so unlike
 * the components it can be executed here rather than asserted against as text.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const uiSrc = (...parts) => path.join(repoRoot, 'platform', 'ui', 'src', ...parts);

const load = () => importTs(uiSrc('image-source.ts'));
const codeOnly = (source) => source
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

// ── The policy ──────────────────────────────────────────────────────────────

it('sends no referer at all, which is what a hotlink check reads', async () => {
  const { IMAGE_REFERRER_POLICY } = await load();
  // Not `origin` and not `no-referrer-when-downgrade`: both still tell the
  // publisher another site asked, which is the thing being refused.
  assert.equal(IMAGE_REFERRER_POLICY, 'no-referrer');
});

it('applies the policy at every remote image, not just the cards', () => {
  const files = ['GeminiBentoCard.tsx', 'GeminiInlineImage.tsx', 'GeminiSingleImage.tsx'];
  for (const file of files) {
    const source = codeOnly(fs.readFileSync(uiSrc(file), 'utf8'));
    assert.match(source, /referrerPolicy=\{IMAGE_REFERRER_POLICY\}/, file);
    // Imported, never inlined: a literal here would drift from the constant and
    // the drift would be invisible until a publisher started refusing.
    assert.ok(!/referrerPolicy="/.test(source), `${file} hardcodes a policy`);
  }
});

it('routes every remote image through the resolver', () => {
  const files = ['GeminiBentoCard.tsx', 'GeminiInlineImage.tsx', 'GeminiSingleImage.tsx'];
  for (const file of files) {
    const source = codeOnly(fs.readFileSync(uiSrc(file), 'utf8'));
    assert.match(source, /src=\{resolveImageSource\(/, file);
  }
});

it('gives every remote image an error handler', () => {
  // Without one a refused URL is a silent hole — the blank card in the report.
  for (const file of ['GeminiBentoCard.tsx', 'GeminiInlineImage.tsx', 'GeminiSingleImage.tsx']) {
    const source = codeOnly(fs.readFileSync(uiSrc(file), 'utf8'));
    assert.match(source, /onError=/, file);
  }
});

// ── The proxy, when there is one ────────────────────────────────────────────

it('leaves images alone until a proxy is configured', async () => {
  const { resolveImageSource, configureImageProxy, getImageProxyEndpoint } = await load();
  configureImageProxy(null);
  assert.equal(getImageProxyEndpoint(), null);
  // The default, and the only possibility on a static host. Unproxied images
  // still carry `no-referrer`, so this path is not a degraded one.
  const url = 'https://example.com/a.jpg';
  assert.equal(resolveImageSource(url), url);
});

it('wraps a remote url once a proxy is configured', async () => {
  const { resolveImageSource, configureImageProxy } = await load();
  configureImageProxy('/api/image');
  assert.equal(
    resolveImageSource('https://example.com/a.jpg?w=2&h=1'),
    '/api/image?url=' + encodeURIComponent('https://example.com/a.jpg?w=2&h=1')
  );
  // The target's own query must survive intact, or a CDN's sizing parameters
  // are silently dropped and the wrong image comes back.
  assert.match(resolveImageSource('https://example.com/a.jpg?w=2&h=1'), /w%3D2%26h%3D1/);
  configureImageProxy(null);
});

it('appends rather than overwrites when the endpoint already has a query', async () => {
  const { resolveImageSource, configureImageProxy } = await load();
  configureImageProxy('/api/image?v=2');
  assert.equal(
    resolveImageSource('https://example.com/a.jpg'),
    '/api/image?v=2&url=' + encodeURIComponent('https://example.com/a.jpg')
  );
  configureImageProxy(null);
});

it('treats a blank endpoint as no endpoint', async () => {
  const { configureImageProxy, getImageProxyEndpoint } = await load();
  // `import.meta.env.VITE_IMAGE_PROXY` is the empty string when the variable is
  // declared but left blank, which must mean "off" and not "proxy to ''".
  for (const value of ['', '   ', undefined, null]) {
    configureImageProxy(value);
    assert.equal(getImageProxyEndpoint(), null, JSON.stringify(value));
  }
});

// ── What the proxy must not touch ───────────────────────────────────────────

it('never proxies a url that is already local', async () => {
  const { isProxyableImageUrl, resolveImageSource, configureImageProxy } = await load();
  configureImageProxy('/api/image');
  // A data: or blob: URL is already bytes in hand; a round trip would corrupt
  // it and cost an invocation for nothing.
  for (const url of ['data:image/png;base64,iVBORw0KGgo=', 'blob:http://x/y', '/local.png', '']) {
    assert.equal(isProxyableImageUrl(url), false, url);
    assert.equal(resolveImageSource(url), url, url);
  }
  configureImageProxy(null);
});

it('leaves an unparseable url to the error handler', async () => {
  const { isProxyableImageUrl, resolveImageSource, configureImageProxy } = await load();
  configureImageProxy('/api/image');
  // Proxying garbage turns a visible broken image into a confusing server
  // error, and the `<img>`'s own onError already handles it correctly.
  assert.equal(isProxyableImageUrl('http://['), false);
  assert.equal(resolveImageSource('http://['), 'http://[');
  configureImageProxy(null);
});

it('proxies http as well as https, because that is a reason it exists', async () => {
  const { isProxyableImageUrl } = await load();
  // An http:// image on an https:// page is blocked by the browser outright.
  // Refusing to proxy it would leave the one failure no client fix can reach.
  assert.equal(isProxyableImageUrl('http://example.com/a.jpg'), true);
  assert.equal(isProxyableImageUrl('https://example.com/a.jpg'), true);
});

// ── Wiring ──────────────────────────────────────────────────────────────────

it('injects the endpoint from the app, not from inside the UI package', () => {
  // `platform/ui` also runs under Node in this suite, where `import.meta.env`
  // does not exist. The app reads it once and injects; the package only ever
  // asks its own module.
  const main = fs.readFileSync(
    path.join(repoRoot, 'apps', 'studio', 'src', 'main.tsx'), 'utf8'
  );
  assert.match(main, /configureImageProxy\(import\.meta\.env\.VITE_IMAGE_PROXY\)/);

  const source = codeOnly(fs.readFileSync(uiSrc('image-source.ts'), 'utf8'));
  assert.ok(
    !/import\.meta\.env/.test(source),
    'image-source.ts must not read the environment itself'
  );
});
