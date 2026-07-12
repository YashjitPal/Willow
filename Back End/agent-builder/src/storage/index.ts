/**
 * Persistence: a small document store with two drivers:
 *  - SQLite via the built-in `node:sqlite` (Node >= 22.5 behind flag, >= 23.4 stable)
 *  - JSON files (atomic writes) as a portable fallback
 *
 * Documents are JSON blobs keyed by (collection, id) with an optional `ref`
 * column for parent lookups (spans by run, runs by workflow, chunks by store).
 */

export interface ListOptions {
  ref?: string;
  limit?: number;
  offset?: number;
  /** 'asc' (default) or 'desc' by createdAt insertion ordering. */
  order?: 'asc' | 'desc';
}

export interface StoredDoc<T = unknown> {
  id: string;
  ref?: string;
  createdAt: string;
  doc: T;
}

export interface Storage {
  put(collection: string, id: string, doc: unknown, ref?: string): Promise<void>;
  get<T = unknown>(collection: string, id: string): Promise<T | undefined>;
  delete(collection: string, id: string): Promise<boolean>;
  deleteWhere(collection: string, ref: string): Promise<number>;
  list<T = unknown>(collection: string, opts?: ListOptions): Promise<StoredDoc<T>[]>;
  count(collection: string, ref?: string): Promise<number>;
  close(): Promise<void>;
}

export const COLLECTIONS = {
  workflows: 'workflows',
  versions: 'versions',
  runs: 'runs',
  spans: 'spans',
  mcpServers: 'mcp_servers',
  vectorStores: 'vector_stores',
  vectorFiles: 'vector_files',
  vectorChunks: 'vector_chunks',
  sessions: 'sessions',
  threads: 'threads',
  settings: 'settings',
} as const;

import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from '../util/log.ts';

const log = createLogger('storage');

export async function createStorage(dataDir: string): Promise<Storage> {
  fs.mkdirSync(dataDir, { recursive: true });
  const driver = (process.env.AGENT_BUILDER_STORAGE || 'auto').toLowerCase();

  if (driver === 'json') {
    const { JsonFileStorage } = await import('./jsonfile.ts');
    log.info(`using JSON file storage at ${dataDir}`);
    return new JsonFileStorage(dataDir);
  }

  if (driver === 'sqlite' || driver === 'auto') {
    try {
      const { SqliteStorage } = await import('./sqlite.ts');
      const s = new SqliteStorage(path.join(dataDir, 'agent-builder.db'));
      log.info(`using SQLite storage at ${path.join(dataDir, 'agent-builder.db')}`);
      return s;
    } catch (err) {
      if (driver === 'sqlite') throw err;
      log.warn(
        `node:sqlite unavailable (${(err as Error).message}); falling back to JSON file storage`,
      );
    }
  }

  const { JsonFileStorage } = await import('./jsonfile.ts');
  log.info(`using JSON file storage at ${dataDir}`);
  return new JsonFileStorage(dataDir);
}
