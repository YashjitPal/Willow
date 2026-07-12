import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppConfig {
  port: number;
  host: string;
  /** Directory for the SQLite db / JSON store / uploaded files. */
  dataDir: string;
  /** CORS origins allowed to call the API. */
  corsOrigins: string[];
  /** Optional bearer token protecting all API routes. */
  apiToken?: string;
  /** Default cap for while-loop iterations. */
  defaultMaxIterations: number;
  /** Default cap for agent tool-loop turns. */
  defaultMaxTurns: number;
  /** Max concurrent runs executing. */
  maxConcurrentRuns: number;
  /** ChatKit session lifetime, seconds. */
  sessionTtlSeconds: number;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): AppConfig {
  const dataDir =
    process.env.AGENT_BUILDER_DATA_DIR ||
    path.resolve(__dirname, '..', 'data');

  const corsEnv = process.env.AGENT_BUILDER_CORS_ORIGINS;

  return {
    port: intEnv('AGENT_BUILDER_PORT', 8787),
    host: process.env.AGENT_BUILDER_HOST || '127.0.0.1',
    dataDir,
    corsOrigins: corsEnv
      ? corsEnv.split(',').map((s) => s.trim()).filter(Boolean)
      : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001'],
    apiToken: process.env.AGENT_BUILDER_API_TOKEN || undefined,
    defaultMaxIterations: intEnv('AGENT_BUILDER_MAX_ITERATIONS', 100),
    defaultMaxTurns: intEnv('AGENT_BUILDER_MAX_TURNS', 8),
    maxConcurrentRuns: intEnv('AGENT_BUILDER_MAX_CONCURRENT_RUNS', 8),
    sessionTtlSeconds: intEnv('AGENT_BUILDER_SESSION_TTL', 3600),
  };
}
