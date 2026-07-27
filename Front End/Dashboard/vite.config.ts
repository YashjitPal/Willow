import path from "path";
import { pathToFileURL } from "url";
import http from "http";
import https from "https";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

// Vite plugin: mount the Agent Builder backend (Back End/agent-builder) as
// in-process dev middleware so `npm run dev` serves the whole thing on
// localhost:3000 — one command, one origin, no second port, no CORS. The
// backend stays a standalone package (its own deps/port) for production.
function agentBuilderBackend(): Plugin {
  let close: (() => Promise<void>) | undefined;
  return {
    name: "agent-builder-backend",
    apply: "serve", // dev only; production deploys the backend separately
    async configureServer(server) {
      // Computed (non-literal) path + runtime import() so esbuild leaves it
      // alone and Node resolves the backend's own node_modules at runtime.
      const entry = pathToFileURL(
        path.resolve(__dirname, "../..", "Back End", "agent-builder", "src", "vite-middleware.ts"),
      ).href;
      try {
        const mod = await import(/* @vite-ignore */ entry);
        const { middleware, close: closeFn, prefix, attachRealtime } = await mod.createAgentBuilderMiddleware();
        close = closeFn;
        // Add directly (before Vite's SPA fallback) so /api/* is ours.
        server.middlewares.use(middleware);
        if (server.httpServer) attachRealtime(server.httpServer);
        server.config.logger.info(`  \x1b[32m➜\x1b[0m  Agent Builder API: \x1b[36mmounted at ${prefix}v1\x1b[0m`);
        server.httpServer?.once("close", () => void close?.());
      } catch (e) {
        server.config.logger.error(
          `[agent-builder] failed to mount backend middleware: ${(e as Error).message}\n` +
          `  The Agent Builder canvas will show "Backend offline". ` +
          `Run it standalone with: cd "Back End/agent-builder" && npm start`,
        );
      }
    },
    async closeBundle() {
      await close?.();
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
        // Only apply isolation headers when serving the WebContainer staging page
        if (url.startsWith('/project1')) {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        }
        next();
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

        const proxyReq = transport.request(
          {
            hostname: parsed.hostname,
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
      // Allow imports from parent directory (for defaultmodel.ts in Willow Code root)
      fs: {
        allow: [
          path.resolve(__dirname, "."),           // Dashboard folder
          path.resolve(__dirname, "../.."),       // Willow Code root
        ],
      },
    },
    plugins: [react(), agentBuilderBackend(), conditionalCrossOriginHeaders(), dynamicLlmProxy()],
    define: {
      // @babel/types checks these build-time flags while loading the visual editor.
      // Replace only the flags it needs instead of exposing a Node `process` shim.
      'process.env.BABEL_8_BREAKING': 'false',
      'process.env.BABEL_TYPES_8_BREAKING': 'false',
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
        "~": path.resolve(__dirname, "."),
        "path": "path-browserify",
        // Alias for the root defaultmodel file
        "@models": path.resolve(__dirname, "../../defaultmodel"),
        // Agent Builder backend client (zero-dep typed SDK). Aliased so the
        // space in "Back End" never appears in an import specifier.
        "@agentbuilder": path.resolve(__dirname, "../../Back End/agent-builder/client/index.ts"),
      },
    },
    optimizeDeps: {
      include: ['nanostores', '@nanostores/react', '@webcontainer/api'],
    },
  };
});
