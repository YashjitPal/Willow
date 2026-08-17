import path from "path";
import { pathToFileURL } from "url";
import http from "http";
import https from "https";
import { execSync } from "child_process";

/**
 * Resolve the WSL2 virtual NIC IP so the Vite dev proxy can reach services
 * running inside WSL (e.g. Sub2API) that bind to 0.0.0.0 but are unreachable
 * at 127.0.0.1 from the Windows host.
 */
function getWslIp(): string | null {
  try {
    return execSync('wsl hostname -I', { encoding: 'utf-8' }).trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}
const WSL_IP = getWslIp();
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

/** Repo root, two levels up from apps/studio. */
const ROOT = path.resolve(__dirname, "../..");

// Vite plugin: mount the Agent Builder backend (services/agent-builder) as
// in-process dev middleware so `npm run dev` serves the whole thing on
// localhost:3000 — one command, one origin, no second port, no CORS. The
// backend stays a standalone package (its own deps/port) for production.
function agentBuilderBackend(): Plugin {
  let close: (() => Promise<void>) | undefined;
  // A dev restart (editing this file) fires the httpServer 'close' event *and*
  // closeBundle, so guard the teardown against running twice.
  let closing: Promise<void> | undefined;
  const closeOnce = () => (closing ??= close ? close() : Promise.resolve());
  return {
    name: "agent-builder-backend",
    apply: "serve", // dev only; production deploys the backend separately
    async configureServer(server) {
      // Computed (non-literal) path + runtime import() so esbuild leaves it
      // alone and Node resolves the backend's own node_modules at runtime.
      const entry = pathToFileURL(
        path.resolve(ROOT, "services", "agent-builder", "src", "vite-middleware.ts"),
      ).href;
      try {
        const mod = await import(/* @vite-ignore */ entry);
        const { middleware, close: closeFn, prefix, attachRealtime } = await mod.createAgentBuilderMiddleware();
        close = closeFn;
        // Add directly (before Vite's SPA fallback) so /api/* is ours.
        server.middlewares.use(middleware);
        if (server.httpServer) attachRealtime(server.httpServer);
        server.config.logger.info(`  \x1b[32m➜\x1b[0m  Agent Builder API: \x1b[36mmounted at ${prefix}v1\x1b[0m`);
        server.httpServer?.once("close", () => void closeOnce());
      } catch (e) {
        server.config.logger.error(
          `[agent-builder] failed to mount backend middleware: ${(e as Error).message}\n` +
          `  The Agent Builder canvas will show "Backend offline". ` +
          `Run it standalone with: npm run agent-builder:start`,
        );
      }
    },
    async closeBundle() {
      await closeOnce();
    },
  };
}


// Vite plugin: Apply COOP/COEP headers only on WebContainer routes (e.g. /project1).
// These headers are required for SharedArrayBuffer but break Firebase signInWithPopup,
// so they must NOT be set on the login page or any other auth-related route.
function conditionalCrossOriginHeaders(): Plugin {
  return {
    name: 'conditional-cross-origin-headers',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        // Only apply isolation headers when serving the WebContainer workbench page
        if (url.startsWith('/project1')) {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        }
        next();
      });
    },
  };
}

function webSearchMiddleware(): Plugin {
  return {
    name: 'web-search-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/llm-search')) return next();

        const url = new URL(req.url, 'http://localhost:3000');
        const query = (url.searchParams.get('q') || '').trim();
        const searchType = url.searchParams.get('type') || 'web_search';

        if (!query) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing query parameter q', results: [] }));
          return;
        }

        const results: { title: string; snippet: string; link: string }[] = [];
        const seenLinks = new Set<string>();

        // 1. If searching X (Twitter), provide targeted live search URL card
        if (searchType === 'x_search') {
          results.push({
            title: `Live Posts & Discussions on X: "${query}"`,
            snippet: `Search real-time tweets, verified updates, and community commentary on X (formerly Twitter) regarding ${query}.`,
            link: `https://x.com/search?q=${encodeURIComponent(query)}&f=live`,
          });
        }

        // 2. Wikipedia Real-Time Knowledge Search (Official, never blocked, instant)
        try {
          const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1`;
          const wikiRes = await fetch(wikiUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            },
          });
          if (wikiRes.ok) {
            const wikiData = await wikiRes.json();
            const hits = wikiData.query?.search || [];
            for (const hit of hits.slice(0, 4)) {
              const link = `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`;
              if (!seenLinks.has(link)) {
                seenLinks.add(link);
                results.push({
                  title: hit.title,
                  snippet: (hit.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#039;/g, "'"),
                  link,
                });
              }
            }
          }
        } catch {}

        // 3. Fallback direct web search URL for citation cards
        if (results.length === 0) {
          results.push({
            title: `Web Search Results for "${query}"`,
            snippet: `Comprehensive web search results for ${query}.`,
            link: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ query, results }));
      });
    },
  };
}

// Vite plugin: Dynamic LLM proxy that routes requests to any user-specified
// base URL. Unlike a static Vite proxy entry (which hardcodes the TLS target),
// this middleware reads the real target from the `x-proxy-target` header and
// opens a fresh connection to that domain, so Cloudflare/SNI checks pass.
function dynamicLlmProxy(): Plugin {
  return {
    name: 'dynamic-llm-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/llm-proxy')) return next();

        const targetUrl = req.headers['x-proxy-target'];
        if (!targetUrl || typeof targetUrl !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing x-proxy-target header' }));
          return;
        }

        let parsed: URL;
        try {
          parsed = new URL(targetUrl);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid x-proxy-target URL' }));
          return;
        }

        // Strip the /llm-proxy prefix and rebuild the full upstream path
        const strippedPath = req.url.replace(/^\/llm-proxy/, '');
        const upstreamPath = (parsed.pathname !== '/' ? parsed.pathname : '') + strippedPath;

        // Forward all headers except browser-only ones that upstream gateways reject
        const forwardHeaders: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (!value) continue;
          const lower = key.toLowerCase();
          if (lower === 'host' || lower === 'origin' || lower === 'referer' || lower === 'x-proxy-target') continue;
          forwardHeaders[key] = value;
        }
        forwardHeaders['host'] = parsed.host;

        const isHttps = parsed.protocol === 'https:';
        const transport = isHttps ? https : http;

        // When the target points at 127.0.0.1 or localhost but we're on
        // Windows with WSL, reroute to the WSL virtual NIC IP so the
        // connection actually reaches the service inside WSL.
        let connectHost = parsed.hostname;
        if (WSL_IP && (connectHost === '127.0.0.1' || connectHost === 'localhost')) {
          connectHost = WSL_IP;
        }

        const proxyReq = transport.request(
          {
            hostname: connectHost,
            port: parsed.port || (isHttps ? 443 : 80),
            path: upstreamPath,
            method: req.method,
            headers: forwardHeaders,
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(res);
          },
        );

        proxyReq.on('error', (err) => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
          }
        });

        req.pipe(proxyReq);
      });
    },
  };
}

export default defineConfig(() => {
  return {
    server: {
      port: 3000,
      strictPort: true,
      host: "localhost",

      open: false,
      // Source lives outside apps/studio (features/, platform/, assets/), so the
      // whole repo root has to be readable by the dev server.
      fs: {
        allow: [ROOT],
      },
    },
    plugins: [react(), agentBuilderBackend(), conditionalCrossOriginHeaders(), dynamicLlmProxy(), webSearchMiddleware()],
    define: {
      // @babel/types checks these build-time flags while loading the visual editor.
      // Replace only the flags it needs instead of exposing a Node `process` shim.
      'process.env.BABEL_8_BREAKING': 'false',
      'process.env.BABEL_TYPES_8_BREAKING': 'false',
    },
    resolve: {
      // Mirrors `paths` in tsconfig.base.json — keep the two in sync. Ordered
      // longest-prefix-first because Vite takes the first entry that matches.
      alias: [
        { find: "@willow/agent-builder", replacement: path.resolve(ROOT, "features/agent-builder/src") },
        { find: "@willow/project-browser", replacement: path.resolve(ROOT, "features/projects/src") },
        { find: "@willow/onboarding", replacement: path.resolve(ROOT, "features/onboarding/src") },
        { find: "@willow/personal", replacement: path.resolve(ROOT, "platform/personal/src") },
        { find: "@willow/projects", replacement: path.resolve(ROOT, "platform/projects/src") },
        { find: "@willow/storage", replacement: path.resolve(ROOT, "platform/storage/src") },
        { find: "@willow/account", replacement: path.resolve(ROOT, "features/auth/src") },
        { find: "@willow/design", replacement: path.resolve(ROOT, "features/design/src") },
        { find: "@willow/studio", replacement: path.resolve(ROOT, "apps/studio/src") },
        { find: "@willow/assets", replacement: path.resolve(ROOT, "assets") },
        { find: "@willow/figma", replacement: path.resolve(ROOT, "features/figma/src") },
        { find: "@willow/media", replacement: path.resolve(ROOT, "features/media/src") },
        { find: "@willow/spark", replacement: path.resolve(ROOT, "features/spark/src") },
        { find: "@willow/chat", replacement: path.resolve(ROOT, "features/chat/src") },
        // Must precede "@willow/code": Vite takes the first match, so the
        // shorter prefix would otherwise swallow every code-beta import.
        { find: "@willow/code-beta", replacement: path.resolve(ROOT, "features/code-beta/src") },
        { find: "@willow/code", replacement: path.resolve(ROOT, "features/code/src") },
        { find: "@willow/gems", replacement: path.resolve(ROOT, "features/gems/src") },
        { find: "@willow/notebooks", replacement: path.resolve(ROOT, "features/notebooks/src") },
        { find: "@willow/core", replacement: path.resolve(ROOT, "platform/core/src") },
        { find: "@willow/auth", replacement: path.resolve(ROOT, "platform/auth/src") },
        { find: "@willow/ui", replacement: path.resolve(ROOT, "platform/ui/src") },
        { find: "@willow/ai", replacement: path.resolve(ROOT, "platform/ai/src") },

        // Model defaults and the Agent Builder backend's zero-dep typed client.
        { find: "@models", replacement: path.resolve(ROOT, "platform/ai/src/models/defaults.ts") },
        { find: "@agentbuilder", replacement: path.resolve(ROOT, "services/agent-builder/client/index.ts") },

        // Browser shim for code that imports Node's `path`.
        { find: "path", replacement: "path-browserify" },
      ],
    },
    optimizeDeps: {
      include: ['nanostores', '@nanostores/react'],
    },
  };
});
