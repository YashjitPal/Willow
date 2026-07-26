/** Shared test helpers: isolated app instances + run polling. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.ts';
import type { Run } from '../src/domain/types.ts';

export type App = Awaited<ReturnType<typeof createApp>>;

export async function makeApp(): Promise<{ app: App; cleanup: () => Promise<void> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-test-'));
  process.env.AGENT_BUILDER_DATA_DIR = dir;
  process.env.AGENT_BUILDER_STORAGE = 'json';
  process.env.AGENT_BUILDER_LOG = 'silent';
  process.env.AGENT_BUILDER_ALLOW_PRIVATE_NETWORKS = 'true';
  delete process.env.AGENT_BUILDER_API_TOKEN;
  // Tests must remain deterministic even when a developer shell exports a
  // provider key for local development. Vector-store coverage explicitly
  // exercises the offline embedder and should never make network calls.
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const app = await createApp();
  return {
    app,
    cleanup: async () => {
      await app.close();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* windows file locks */ }
    },
  };
}

export async function waitForRun(
  app: App,
  runId: string,
  statuses: string[] = ['completed', 'failed', 'cancelled', 'awaiting_approval', 'awaiting_client_tool'],
  timeoutMs = 15_000,
): Promise<Run> {
  const started = Date.now();
  for (;;) {
    const run = await app.engine.getRun(runId);
    if (run && statuses.includes(run.status)) return run;
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `run ${runId} did not reach [${statuses.join(',')}] within ${timeoutMs}ms (status: ${run?.status})`,
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Boot the HTTP server on an ephemeral port; returns base url. */
export async function listen(app: App): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        app.server.close(() => resolve());
        app.server.closeAllConnections?.();
      }),
  };
}
