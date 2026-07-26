import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const dashboardDir = path.resolve(import.meta.dirname, '..');
const workspaceDir = path.resolve(dashboardDir, '..', '..');
const outdir = path.join(dashboardDir, 'dist', 'test-only', 'agent-builder-qa');
const backendClient = path.join(workspaceDir, 'Back End', 'agent-builder', 'client', 'index.ts');
const middlewareEntry = path.join(workspaceDir, 'Back End', 'agent-builder', 'src', 'vite-middleware.ts');
const mockUserData = path.join(dashboardDir, 'test', 'agent-builder-qa-user-data.ts');

async function buildHarness() {
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  await build({
    entryPoints: [path.join(dashboardDir, 'test', 'agent-builder-qa.entry.tsx')],
    outdir,
    entryNames: 'app',
    assetNames: 'assets/[name]-[hash]',
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2022'],
    jsx: 'automatic',
    alias: { '@agentbuilder': backendClient },
    plugins: [{
      name: 'qa-user-data-only-mock',
      setup(buildApi) {
        buildApi.onResolve({ filter: /UserDataContext$/ }, () => ({ path: mockUserData }));
      },
    }],
    logLevel: 'info',
  });
  const productionIndex = fs.readFileSync(path.join(dashboardDir, 'index.html'), 'utf8');
  const tailwindCdn = productionIndex.match(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/)?.[0];
  const tailwindConfig = productionIndex.match(/<script>\s*tailwind\.config\s*=[\s\S]*?<\/script>/)?.[0];
  const fontLinks = [...productionIndex.matchAll(/<link[^>]+href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"]*"[^>]*>/g)].map((match) => match[0]).join('');
  const inlineStyles = [...productionIndex.matchAll(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/g)].map((match) => match[0]).join('');
  if (!tailwindCdn || !tailwindConfig) throw new Error('production Tailwind CDN/config blocks were not found in index.html');
  const stylesheet = fs.existsSync(path.join(outdir, 'app.css')) ? '<link rel="stylesheet" href="/app.css">' : '';
  fs.writeFileSync(path.join(outdir, 'index.html'), `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TEST ONLY - Agent Builder QA</title>${tailwindCdn}${fontLinks}${tailwindConfig}${inlineStyles}${stylesheet}</head><body style="margin:0"><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
  process.stdout.write(`Built test-only Agent Builder QA harness at ${outdir}\n`);
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

async function serveHarness() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-agent-builder-qa-data-'));
  process.env.AGENT_BUILDER_DATA_DIR = dataDir;
  process.env.AGENT_BUILDER_STORAGE = 'json';
  process.env.AGENT_BUILDER_LOG = process.env.AGENT_BUILDER_LOG ?? 'info';
  const { createAgentBuilderMiddleware } = await import(pathToFileURL(middlewareEntry).href);
  const backend = await createAgentBuilderMiddleware();
  const server = http.createServer((req, res) => {
    backend.middleware(req, res, () => {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(outdir, relative);
      if (file !== outdir && !file.startsWith(`${outdir}${path.sep}`)) { res.writeHead(403).end('Forbidden'); return; }
      fs.readFile(file, (error, bytes) => {
        if (error) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
        res.end(bytes);
      });
    });
  });
  backend.attachRealtime(server);
  const port = Number(process.env.AGENT_BUILDER_QA_PORT ?? 4178);
  const host = process.env.AGENT_BUILDER_QA_HOST ?? '127.0.0.1';
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  process.stdout.write(`Agent Builder QA: http://${host}:${port}\n`);
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  process.once('SIGINT', () => void close().then(() => process.exit(0)));
  process.once('SIGTERM', () => void close().then(() => process.exit(0)));
}

await buildHarness();
if (process.argv.includes('--serve')) await serveHarness();
