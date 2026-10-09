/**
 * The preview runtime the harness builds for: the in-browser bundler, npm
 * packages from esm.sh, and the strict mode the harness checks with.
 *
 * `fetch` is replaced with a fake CDN so these run offline and deterministically;
 * the real esm.sh responses have the same shape (an entry that re-exports from
 * an absolute path, with React left as a bare import).
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const preview = (file) => path.join(repoRoot, 'features', 'code', 'src', 'runtime', 'preview', file);

const packages = await importTs(preview('packages.ts'));
const bundler = await importTs(preview('bundler.ts'));

const CDN = {
  'https://esm.sh/tiny-pkg@^1.2.0?external=react,react-dom&target=es2022':
    'export * from "/tiny-pkg@1.2.3/es2022/tiny-pkg.mjs";\nexport { default } from "/tiny-pkg@1.2.3/es2022/tiny-pkg.mjs";',
  'https://esm.sh/tiny-pkg@1.2.3/es2022/tiny-pkg.mjs':
    'import { useState } from "react";\nimport { helper } from "./helper.mjs";\nexport const greet = () => helper("hi");\nexport default function useTiny() { return useState; }',
  'https://esm.sh/tiny-pkg@1.2.3/es2022/helper.mjs': 'export const helper = (value) => value.toUpperCase();',
  'https://esm.sh/lucide-react@^0.460.0?exports=Camera,Home&external=react,react-dom&target=es2022':
    'export const Camera = () => "camera";\nexport const Home = () => "home";',
};

const requested = [];
globalThis.fetch = async (url) => {
  requested.push(String(url));
  const body = CDN[String(url)];
  return body === undefined
    ? new Response('not found', { status: 404 })
    : new Response(body, { status: 200, headers: { 'content-type': 'application/javascript' } });
};

const buildErrors = async (files) => {
  try {
    await bundler.bundleFiles(files, { strict: true });
    return [];
  } catch (error) {
    return (error.errors ?? [{ text: error.message }]).map((entry) => entry.text);
  }
};

it('bundles npm packages from the CDN, with React left to the page', async () => {
  const code = await bundler.bundleFiles({
    '/package.json': JSON.stringify({ dependencies: { 'tiny-pkg': '^1.2.0', 'lucide-react': '^0.460.0' } }),
    '/App.tsx': 'import useTiny, { greet } from "tiny-pkg";\nimport { Camera, Home } from "lucide-react";\nexport default function App() { useTiny(); return <p>{greet()}<Camera /><Home /></p>; }',
  }, { strict: true });

  assert.match(code, /toUpperCase/, 'a relative import inside a CDN module was followed');
  assert.match(code, /__require\("react"\)/, 'React is the page\'s copy, not bundled');
  // Icon libraries ask the CDN for only the icons the project imports.
  assert.ok(requested.some((url) => url.includes('lucide-react@^0.460.0?exports=Camera,Home')));
});

it('fails a strict build on a missing file, a Node built-in, or a package that does not exist', async () => {
  assert.match((await buildErrors({ '/App.tsx': 'import X from "./Missing";\nexport default function App() { return <X />; }' }))[0], /Could not resolve "\.\/Missing"/);
  assert.match((await buildErrors({ '/App.tsx': 'import fs from "fs";\nexport default function App() { return <p>{String(fs)}</p>; }' }))[0], /Node\.js module/);
  assert.match((await buildErrors({ '/App.tsx': 'import x from "no-such-pkg";\nexport default function App() { return <p>{String(x)}</p>; }' }))[0], /not found on npm \(HTTP 404\)/);
  assert.match((await buildErrors({ '/App.tsx': 'export default function App() { return <div>; }' })).join('\n'), /closing "div" tag/);
});

it('keeps the live preview forgiving about a missing file', async () => {
  const code = await bundler.bundleFiles({ '/App.tsx': 'import X from "./Missing";\nexport default function App() { return <X />; }' });
  assert.match(code, /Could not find module/);
});

it('resolves the @/ alias, JSON, SVG markup and Vite-style env reads', async () => {
  const code = await bundler.bundleFiles({
    '/App.tsx': [
      'import Header from "@/components/Header";',
      'import data from "./data.json";',
      'import logo from "./logo.svg";',
      'export default function App() { return <div><Header /><img src={logo} />{data.title}{import.meta.env.MODE}{process.env.NODE_ENV}</div>; }',
    ].join('\n'),
    '/components/Header.tsx': 'export default function Header() { return <h1>Hi</h1>; }',
    '/data.json': '{"title": "Hello"}',
    '/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  }, { strict: true });
  assert.match(code, /"Hello"/);
  assert.match(code, /data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.match(code, /"production"/);
});

it('builds a page whose errors use the channel it is given', () => {
  const page = bundler.generatePreviewHTML('/* bundle */', undefined, { errorMessageType: 'PROBE', headScript: 'window.probed = true;' });
  assert.match(page, /type: "PROBE"/);
  assert.match(page, /<script>window\.probed = true;<\/script>/);
  // Packages compiled with the automatic JSX runtime get one.
  assert.match(page, /'react\/jsx-runtime': __jsxRuntime/);
  assert.match(page, /'react-dom\/client': window\.ReactDOM/);

  const live = bundler.generatePreviewHTML('/* bundle */');
  assert.match(live, /type: "PREVIEW_ERROR"/, 'the live preview keeps the channel the workbench listens on');
});

it('reads versions and import shapes the way npm would', () => {
  assert.equal(packages.cleanVersion('^1.2.0'), '^1.2.0');
  assert.equal(packages.cleanVersion('latest'), '');
  assert.equal(packages.cleanVersion('workspace:*'), '');
  assert.equal(packages.cleanVersion('npm:other@^2.0.0'), '^2.0.0');
  assert.deepEqual(packages.splitPackageSpecifier('@scope/pkg/sub/path'), { name: '@scope/pkg', subpath: '/sub/path' });
  assert.deepEqual(packages.splitPackageSpecifier('react-icons/fa'), { name: 'react-icons', subpath: '/fa' });

  const uses = packages.collectPackageImports({
    '/a.tsx': 'import { Camera, Home as House } from "lucide-react";\nimport type { Props } from "tiny-pkg";\nimport Default from "other";',
    '/b.tsx': 'import { Star } from "lucide-react";\nimport "side-effect/style.css";',
  });
  assert.deepEqual([...uses.get('lucide-react')].sort(), ['Camera', 'Home', 'Star']);
  assert.equal(uses.get('other'), 'all');
  assert.equal(uses.get('side-effect/style.css'), 'all');
  assert.equal(uses.has('tiny-pkg'), false, 'type-only imports are erased before bundling');

  assert.deepEqual(
    packages.undeclaredPackages({ '/package.json': '{"dependencies":{"lucide-react":"1"}}', '/a.tsx': 'import { A } from "lucide-react";\nimport z from "zod";\nimport React from "react";' }),
    ['zod'],
  );
  assert.equal(packages.RUNTIME_PROVIDED.test('react-router-dom'), false);
  assert.equal(packages.RUNTIME_PROVIDED.test('react/jsx-runtime'), true);
});
