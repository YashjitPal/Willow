/**
 * The document a tool runs in: Flow's runner page (P1b in its bundle; the live copy is in
 * tools/ui-research/captures/flow/tools/runtime/), built from a compiled tool. Its CSP, Tailwind's
 * browser build, fonts, base styles and the three bootstrap scripts — the SDK port, the error
 * reporters, the mount — are Flow's, as is the import map: React pinned to 19.1.1, every other
 * package from esm.sh with React external, p5 and pixi.js from jsDelivr, and `flow-sdk` and the
 * tool itself as data URLs.
 *
 * Willow runs the document in a frame with an opaque origin, where Flow runs it on a sandbox
 * domain of its own: a tool never shares Willow's origin, so it cannot read the keys and chats
 * stored there. An opaque origin has no Web Storage, so a shim (the first script) stands in for
 * localStorage and sessionStorage, seeded from what the host saved for the tool and reporting
 * every change back to it (WILLOW_TOOL_STORAGE). The page posts WILLOW_RUNNER_READY once the
 * port listener is in place, which is when the host hands over the SDK's port.
 */
import { FLOW_SDK_SOURCE } from './flow-sdk-source';

const PINNED_VERSIONS: Record<string, string> = { react: '19.1.1', 'react-dom': '19.1.1' };
const CDN_PREFIX = /^https?:\/\/(?:esm\.sh|cdn\.jsdelivr\.net\/npm|unpkg\.com)\//;
const PROVIDED = new Set(['flow-sdk']);
const SPECIAL_SOURCES: Record<string, { kind: 'jsdelivr-esm' } | { kind: 'jsdelivr-dist'; file: string }> = {
  // CJS interop: gifenc named exports broken on esm.sh
  p5: { kind: 'jsdelivr-esm' },
  // Module splitting causes batcher double-registration
  'pixi.js': { kind: 'jsdelivr-dist', file: 'dist/pixi.min.mjs' },
};
const BARE_IMPORT = /\bfrom\s+['"]([^'"./][^'"]*)['"]|import\s*\(\s*['"]([^'"./][^'"]*)['"]|\bimport\s+['"]([^'"./][^'"]*)['"]/g;

interface Specifier {
  name: string;
  version: string | null;
  subpath: string | null;
}

/** `@scope/pkg@1.2/sub` → name, version, subpath (`d$` in Flow's bundle). */
export function parseSpecifier(spec: string): Specifier {
  const parts = spec.split('/');
  const first = parts[0] ?? '';
  if (spec.startsWith('@')) {
    const second = parts[1] ?? '';
    const at = second.indexOf('@');
    const subpath = parts.length > 2 ? parts.slice(2).join('/') : null;
    if (at > 0) return { name: `${first}/${second.slice(0, at)}`, version: second.slice(at + 1) || null, subpath };
    return { name: `${first}/${second}`, version: null, subpath };
  }
  const at = first.indexOf('@');
  const subpath = parts.length > 1 ? parts.slice(1).join('/') : null;
  if (at > 0) return { name: first.slice(0, at), version: first.slice(at + 1) || null, subpath };
  return { name: first, version: null, subpath };
}

/** Where a package import is fetched from (`e$`). */
export function packageUrl(spec: string): string {
  const { name, version, subpath } = parseSpecifier(spec);
  const resolved = PINNED_VERSIONS[name] ?? version ?? 'latest';
  const special = SPECIAL_SOURCES[name];
  if (special?.kind === 'jsdelivr-dist') return `https://cdn.jsdelivr.net/npm/${name}@${resolved}/${special.file}`;
  if (special?.kind === 'jsdelivr-esm') {
    return subpath
      ? `https://cdn.jsdelivr.net/npm/${name}@${resolved}/${subpath}/+esm`
      : `https://cdn.jsdelivr.net/npm/${name}@${resolved}/+esm`;
  }
  let url = subpath ? `https://esm.sh/${name}@${resolved}/${subpath}` : `https://esm.sh/${name}@${resolved}`;
  if (name !== 'react' && name !== 'react-dom') url += '?external=react,react-dom';
  return url;
}

/** UTF-8 safe `data:text/javascript;base64,` URL (`H1b`). */
export function moduleDataUrl(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]!);
  return `data:text/javascript;base64,${btoa(binary)}`;
}

/** The import map for a compiled tool (`L1b`). `externals` is the compiler's list, when it has one. */
export function buildImportMap(code: string, externals?: readonly string[] | null): Record<string, string> {
  const map: Record<string, string> = {};
  map.react = packageUrl('react');
  map['react/'] = `https://esm.sh/react@${PINNED_VERSIONS.react}/`;
  map['react-dom'] = packageUrl('react-dom');
  map['react-dom/'] = `https://esm.sh/react-dom@${PINNED_VERSIONS['react-dom']}/`;
  map['react-dom/client'] = packageUrl('react-dom/client');
  map['react/jsx-runtime'] = packageUrl('react/jsx-runtime');
  map['flow-sdk'] = moduleDataUrl(FLOW_SDK_SOURCE);
  map['@app'] = moduleDataUrl(code);
  let specs: string[];
  if (externals != null) {
    specs = [...externals];
  } else {
    const found = new Set<string>();
    for (const match of code.matchAll(BARE_IMPORT)) {
      const raw = match[1] ?? match[2] ?? match[3];
      if (!raw) continue;
      const bare = raw.replace(CDN_PREFIX, '');
      const { name, version } = parseSpecifier(bare);
      const pinned = version ? `${name}@${version}` : name;
      found.add(pinned);
      if (bare !== pinned) found.add(bare);
      if (raw !== bare) found.add(raw);
    }
    specs = [...found];
  }
  for (const spec of specs) {
    const bare = spec.replace(CDN_PREFIX, '');
    const { name } = parseSpecifier(bare);
    if (PROVIDED.has(name)) continue;
    if (map[bare]) continue;
    const url = packageUrl(bare);
    map[bare] = url;
    if (spec !== bare) map[spec] = url;
    if (bare !== name && !map[name] && !parseSpecifier(bare).subpath) map[name] = url;
  }
  return map;
}

/** The entry script's quote, kept out of the source text so the test loader reads no import there. */
const Q = "'";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CSP = `
    default-src 'none';
    script-src https://esm.sh https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://docs.opencv.org 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:;
    connect-src https://esm.sh https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://docs.opencv.org https://huggingface.co https://cdn-lfs.huggingface.co https://*.hf.co https://fonts.googleapis.com https://fonts.gstatic.com https://storage.googleapis.com https://img.youtube.com blob: data:;
    style-src 'unsafe-inline' https://esm.sh https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com;
    font-src https://fonts.gstatic.com https://esm.sh https://cdn.jsdelivr.net;
    img-src * data: blob:;
    media-src * data: blob:;
  `;

/** Willow's shim for an opaque origin; see the file comment. Runs before anything else. */
const STORAGE_SHIM = `(function (seed) {
  var post = function (msg) { try { window.parent.postMessage(msg, '*'); } catch (e) {} };
  var make = function (kind, initial) {
    var map = new Map(Object.entries(initial || {}));
    var timer = 0;
    var report = function () {
      if (kind !== 'local') return;
      clearTimeout(timer);
      timer = setTimeout(function () { post({ type: 'WILLOW_TOOL_STORAGE', entries: Object.fromEntries(map) }); }, 150);
    };
    var api = {
      key: function (i) { return Array.from(map.keys())[i] ?? null; },
      getItem: function (k) { k = String(k); return map.has(k) ? map.get(k) : null; },
      setItem: function (k, v) { map.set(String(k), String(v)); report(); },
      removeItem: function (k) { map.delete(String(k)); report(); },
      clear: function () { map.clear(); report(); },
    };
    return new Proxy(api, {
      get: function (t, p) { if (p === 'length') return map.size; if (p in t) return t[p]; return typeof p === 'string' && map.has(p) ? map.get(p) : undefined; },
      set: function (t, p, v) { api.setItem(p, v); return true; },
      deleteProperty: function (t, p) { api.removeItem(p); return true; },
      has: function (t, p) { return p in t || map.has(p); },
      ownKeys: function () { return Array.from(map.keys()); },
      getOwnPropertyDescriptor: function (t, p) { return map.has(p) ? { value: map.get(p), enumerable: true, configurable: true, writable: true } : undefined; },
    });
  };
  var usable = true;
  try { void window.localStorage.length; } catch (e) { usable = false; }
  if (!usable) {
    try { Object.defineProperty(window, 'localStorage', { value: make('local', seed), configurable: true }); } catch (e) {}
    try { Object.defineProperty(window, 'sessionStorage', { value: make('session', {}), configurable: true }); } catch (e) {}
    try { Object.defineProperty(Document.prototype, 'cookie', { get: function () { return ''; }, set: function () {}, configurable: true }); } catch (e) {}
  }
})`;

const PORT_INIT = `(function(a){if(!a)throw Error("vj");var b=c=>{c.origin===a&&
typeof c.data==="object"&&c.data!==null&&"kind"in c.data&&c.data.kind==="port_init"&&(window.FLOW_PORT=c.ports[0],window.dispatchEvent(new CustomEvent("flow_port_ready")),window.removeEventListener("message",b))};window.addEventListener("message",b)})`;

const ERROR_REPORTERS = `(function(a){if(!a)throw Error("vj");window.onerror=(b,c,d,e,f)=>{c=!c||c.startsWith("data:")||c.startsWith("blob:")?"":c;var g;window.parent.postMessage({type:"FLOW_RUNTIME_ERROR",payload:{error:String(b)+(c?" at "+c+":"+String(d):""),stack:f instanceof Error?(g=f.stack)!=null?g:"":""}},a)};window.addEventListener("unhandledrejection",b=>{b=b.reason;var c;window.parent.postMessage({type:"FLOW_RUNTIME_ERROR",payload:{error:"Unhandled Promise: "+(b instanceof Error?b.message:String(b)),
stack:(c=b instanceof Error?b.stack:void 0)!=null?c:""}},a)});document.addEventListener("securitypolicyviolation",b=>{window.parent.postMessage({type:"FLOW_CSP_VIOLATION",payload:{blockedURI:b.blockedURI,violatedDirective:b.violatedDirective,effectiveDirective:b.effectiveDirective}},a)})})`;

const MOUNT = `(function(a,b,c,d,e,f){if(!d)throw Error("vj");var g=document.getElementById("root");if(!g)throw Error("wj");return c().then(h=>{(h=h["default"]||h.App)?(b(g).render(a.createElement(h)),window.parent.postMessage({type:"FLOW_APP_MOUNTED"},
d)):(h=document.createElement("div"),h.className="p-8 text-red-500",h.textContent=e,g.replaceChildren(h))}).catch(h=>{var k=document.createElement("div");k.className="p-8 text-red-500";k.textContent=f+(h instanceof Error?h.message:String(h));g.replaceChildren(k);var l;window.parent.postMessage({type:"FLOW_RUNTIME_ERROR",payload:{error:h instanceof Error?h.message:String(h),stack:(l=h instanceof Error?h.stack:void 0)!=null?l:""}},d)})})`;

const BASE_STYLES = `
    * { box-sizing: border-box; }
    html { height: 100%; }
    :root {
      --mat-sys-background: #ffffff;
      --mat-sys-on-background: #1e293b;
      --scrollbar-thumb: #cbd5e1;
      --scrollbar-thumb-hover: #94a3b8;
    }
    .dark {
      --mat-sys-background: #1a1a1a;
      --mat-sys-on-background: #e2e8f0;
      --scrollbar-thumb: #475569;
      --scrollbar-thumb-hover: #64748b;
    }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background-color: var(--mat-sys-background);
      color: var(--mat-sys-on-background);
    }
    #root { height: 100%; }

    /* Custom scrollbar */
    ::-webkit-scrollbar { width: 0.5rem; height: 0.5rem; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb {
      background: var(--scrollbar-thumb);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--scrollbar-thumb-hover);
    }
  `;

export interface RunnerDocumentOptions {
  /** The compiled tool (`compileTool`'s `code`). */
  code: string;
  externalImports?: readonly string[] | null;
  /** The tool's stylesheets, each embedded as Flow embeds them. */
  styles?: readonly { name: string; content: string }[];
  /** The origin the SDK talks to: Willow's own. */
  parentOrigin: string;
  /** What the tool saved in localStorage last time. */
  localStorage?: Record<string, string>;
  dark?: boolean;
  /** A script to run before anything else: the Tool Builder's check uses one to read the page. */
  probeScript?: string;
}

export function buildRunnerDocument({ code, externalImports, styles = [], parentOrigin, localStorage = {}, dark = true, probeScript }: RunnerDocumentOptions): string {
  const styleTags = styles
    .map((s) => `<style>/* ${escapeHtml(s.name).replace(/\*\//g, '* /')} */\n${s.content.replace(/<\/style>/gi, '<\\/style>')}</style>`)
    .join('\n');
  const importMap = JSON.stringify({ imports: buildImportMap(code, externalImports) }, null, 2).replace(/<\//g, '<\\/');
  const seed = JSON.stringify(localStorage).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html>
<html lang="en" class="${dark ? 'dark' : ''}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- 
    CSP justification: 'unsafe-eval' and 'wasm-unsafe-eval' are required for
    dynamic applet execution which compiles and runs user-provided code
    and libraries (like OpenCV or custom scripts) in the browser.
  -->
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <title>Flow app</title>
  ${probeScript ? `<script>${probeScript.replace(/<\/script>/gi, '<\\/script>')}</script>\n  ` : ''}<script>${STORAGE_SHIM}(${seed});</script>
  <script>window.FLOW_PARENT_ORIGIN = ${JSON.stringify(parentOrigin)};</script>
  <script>
    (${PORT_INIT})(window.FLOW_PARENT_ORIGIN);
  </script>
  <script>window.parent.postMessage({ type: 'WILLOW_RUNNER_READY' }, '*');</script>


  <!-- Tailwind CSS v4 (browser build) -->
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <style type="text/tailwindcss">
    @custom-variant dark (&:where(.dark, .dark *));
    @theme {
      --color-slate-850: #1a1f2e;
      --color-slate-950: #0d1117;
      --color-app-bg-dark: #1a1a1a;
    }
  </style>

  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&family=Google+Sans+Flex:wght@400;500;600;700&family=Google+Sans+Text:wght@400;500;600;700&display=swap">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0">

  <!-- Dynamic Import Map (resolves npm packages via esm.sh) -->
  <script type="importmap">
${importMap}
  </script>

${styleTags}

  <style>${BASE_STYLES}</style>
</head>
<body class="h-full m-0 p-0">
  <div id="root"></div>

  <!-- Global error handlers -->
  <script>
    (${ERROR_REPORTERS})(window.FLOW_PARENT_ORIGIN);
  </script>

  <!-- ESM App Entry Point -->
  <script type="module">
    import React from ${Q}react${Q};
    import { createRoot } from ${Q}react-dom/client${Q};
    await (${MOUNT})(
      React, createRoot, () => import('@app'),
      window.FLOW_PARENT_ORIGIN,
      "Error: No default export found",
      "Runtime error: "
    );
  </script>
</body>
</html>`;
}
