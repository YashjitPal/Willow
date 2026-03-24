import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

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
    plugins: [react(), conditionalCrossOriginHeaders()],
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
      },
    },
    optimizeDeps: {
      include: ['nanostores', '@nanostores/react', '@webcontainer/api'],
    },
  };
});
