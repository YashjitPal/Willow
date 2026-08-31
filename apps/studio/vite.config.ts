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

/*
 * Mounts `api/fetch-source.js` at `/api/fetch-source` for the dev server.
 *
 * The SAME handler that Vercel serves in production, imported at runtime rather
 * than reimplemented, so the two environments cannot drift — the alternative was
 * a second HTML-to-text path that only ever ran locally.
 *
 * `SOURCE_FETCH_ENABLED` is set here because the handler is closed by default:
 * deployed, it is an open scraping relay and an SSRF surface, so it must be opted
 * into. On a dev machine the "deployment" is the user's own laptop and fetching
 * public pages is the whole feature, so the opt-in is implicit.
 *
 * The handler expects Vercel's `res.status()/setHeader()/end()` shape, which
 * Node's bare `ServerResponse` does not have; `status` is the only piece missing
 * and it is adapted below.
 */
function sourceFetchEndpoint(): Plugin {
  return {
    name: 'source-fetch-endpoint',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/fetch-source')) return next();
        process.env.SOURCE_FETCH_ENABLED ??= '1';
        try {
          const entry = pathToFileURL(path.resolve(ROOT, 'api', 'fetch-source.js')).href;
          const { default: handler } = await import(entry);
          const shim = Object.assign(res, {
            status(code: number) {
              res.statusCode = code;
              return shim;
            },
          });
          await handler(req, shim);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: (error as Error)?.message || 'fetch-source failed' }));
        }
      });
    },
  };
}

/*
 * Writes the Agent tool's model-request log to disk during dev.
 *
 * The log is gathered in the browser, where a turn's timings actually happen,
 * but that is also where it is hardest to look at — a long turn is dozens of
 * console groups, and a reload loses them. Appending to a file means a session
 * can simply be read afterwards, by the user or by anyone helping them.
 *
 * Append-only JSONL: each request is one self-describing line, so a crashed or
 * cancelled session still leaves a readable file rather than truncated JSON.
 *
 * Dev only. There is no production equivalent and there should not be — this
 * writes to the developer's own working tree.
 */
function agentRequestLog(): Plugin {
  const dir = path.resolve(ROOT, '.agent');
  const file = path.resolve(dir, 'requests.jsonl');

  return {
    name: 'agent-request-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__agent/log')) return next();

        const { mkdir, appendFile, writeFile } = await import('fs/promises');

        if (req.method === 'DELETE') {
          await mkdir(dir, { recursive: true });
          await writeFile(file, '');
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method !== 'POST') return next();

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          // A runaway client must not be able to fill the disk.
          if (body.length > 1_000_000) req.destroy();
        });

        req.on('end', async () => {
          try {
            const entries = JSON.parse(body);
            const lines = (Array.isArray(entries) ? entries : [entries])
              .map((entry) => JSON.stringify(entry))
              .join('\n');
            await mkdir(dir, { recursive: true });
            await appendFile(file, lines + '\n');
            res.writeHead(204);
            res.end();
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
        });
      });

      server.config.logger.info(
        `  \x1b[32m➜\x1b[0m  Agent request log: \x1b[36m.agent/requests.jsonl\x1b[0m`,
      );
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
    /*
     * `sourceFetchEndpoint` MUST precede `agentBuilderBackend`.
     *
     * The backend middleware claims the whole `/api/` prefix — not `/api/v1/`, see
     * its `vite-middleware.ts` — so every `/api/*` request reaches its router, and
     * anything it does not recognise comes back 404. Registered after it,
     * `/api/fetch-source` was answered by the Agents API instead of by its own
     * handler, and website sources reported the endpoint as unavailable.
     *
     * Plugin order is middleware order here, so going first means this one gets
     * first refusal on its own path and calls `next()` for everything else.
     */
    plugins: [react(), sourceFetchEndpoint(), agentBuilderBackend(), conditionalCrossOriginHeaders(), dynamicLlmProxy(), agentRequestLog()],
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
