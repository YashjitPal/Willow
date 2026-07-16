/**
 * Willow Agent Builder backend — entry point.
 *
 *   node src/index.ts        (Node >= 23.6, no build step needed)
 *
 * Environment:
 *   AGENT_BUILDER_PORT          default 8787
 *   AGENT_BUILDER_HOST          default 127.0.0.1
 *   AGENT_BUILDER_DATA_DIR      default <package>/data
 *   AGENT_BUILDER_STORAGE       auto | sqlite | json
 *   AGENT_BUILDER_CORS_ORIGINS  comma-separated; default localhost:3000/3001
 *   AGENT_BUILDER_API_TOKEN     optional bearer token for all /api routes
 *   GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY   fallback LLM keys
 */

import { registerRoutes } from './api/routes.ts';
import { loadConfig } from './config.ts';
import { RunEngine } from './engine/executor.ts';
import { createHttpServer } from './http/server.ts';
import { Router } from './http/router.ts';
import { McpManager } from './mcp/manager.ts';
import { VectorStoreService } from './rag/vectorStore.ts';
import { ChatService } from './services/chat.ts';
import { EvaluationService } from './services/evaluations.ts';
import { WorkflowService } from './services/workflows.ts';
import { createStorage } from './storage/index.ts';
import { createLogger } from './util/log.ts';

const log = createLogger('main');

export async function createApp() {
  const config = loadConfig();
  const storage = await createStorage(config.dataDir);
  const mcp = new McpManager(storage);
  const vectorStores = new VectorStoreService(storage);
  const engine = new RunEngine(storage, config, mcp, vectorStores);
  const workflows = new WorkflowService(storage);
  const chat = new ChatService(storage, engine, config);
  const evaluations = new EvaluationService(storage);

  const router = new Router();
  registerRoutes(router, { storage, workflows, engine, chat, mcp, vectorStores, evaluations });

  await engine.recoverInterruptedRuns();

  const server = createHttpServer(router, config);

  const close = async () => {
    // Stop accepting traffic first, then tear down connections, then storage
    // (in-flight writes must land before the store closes).
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
      // resolve even if the server was never listening
      if (!server.listening) resolve();
    });
    await mcp.closeAll();
    await storage.close();
  };

  return { config, storage, mcp, vectorStores, engine, workflows, chat, evaluations, router, server, close };
}

// Only boot when run directly (tests import createApp instead).
const isMain = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href;

if (isMain) {
  const app = await createApp();
  app.server.listen(app.config.port, app.config.host, () => {
    log.info(
      `Willow Agent Builder backend listening on http://${app.config.host}:${app.config.port}`,
    );
    log.info(`data dir: ${app.config.dataDir}`);
    log.info(`CORS origins: ${app.config.corsOrigins.join(', ')}`);
  });

  const shutdown = async (signal: string) => {
    log.info(`${signal} received, shutting down…`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
