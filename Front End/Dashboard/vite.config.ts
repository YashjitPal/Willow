import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    server: {
      port: 3000,
      host: "0.0.0.0",
      open: true,
      // Required headers for WebContainer (SharedArrayBuffer)
      // Using 'credentialless' instead of 'require-corp' to allow cross-origin resources
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      // Allow imports from parent directory (for defaultmodel.ts in Willow Code root)
      fs: {
        allow: [
          path.resolve(__dirname, "."),           // Dashboard folder
          path.resolve(__dirname, "../.."),       // Willow Code root
        ],
      },
    },
    plugins: [react()],
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
