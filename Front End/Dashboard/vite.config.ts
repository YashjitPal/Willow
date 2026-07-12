import path from "path";
import { pathToFileURL } from "url";
import { defineConfig, loadEnv } from "vite";
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
        const { middleware, close: closeFn, prefix } = await mod.createAgentBuilderMiddleware();
        close = closeFn;
        // Add directly (before Vite's SPA fallback) so /api/* is ours.
        server.middlewares.use(middleware);
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    server: {
      port: 3000,
      host: "0.0.0.0",
      open: true,
      // Allow imports from parent directory (for defaultmodel.ts in Willow Code root)
      fs: {
        allow: [
          path.resolve(__dirname, "."),           // Dashboard folder
          path.resolve(__dirname, "../.."),       // Willow Code root
        ],
      },
    },
    plugins: [react(), agentBuilderBackend(), conditionalCrossOriginHeaders()],
    define: {
      "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY),
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
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
