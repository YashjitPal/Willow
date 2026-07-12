import { DatabaseSync } from 'node:sqlite';
import { nowIso } from '../util/id.ts';
import type { ListOptions, Storage, StoredDoc } from './index.ts';

/**
 * SQLite driver on the built-in node:sqlite. Synchronous under the hood
 * (fine for a local single-user service) but exposed via the async Storage
 * interface so drivers are interchangeable.
 */
export class SqliteStorage implements Storage {
  private db: DatabaseSync;
  private seq = 0;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        ref TEXT,
        created_at TEXT NOT NULL,
        seq INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_docs_ref ON docs (collection, ref);
      CREATE INDEX IF NOT EXISTS idx_docs_seq ON docs (collection, seq);
    `);
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM docs').get() as
      | { m: number }
      | undefined;
    this.seq = Number(row?.m ?? 0);
  }

  async put(collection: string, id: string, doc: unknown, ref?: string): Promise<void> {
    const existing = this.db
      .prepare('SELECT created_at, seq, ref FROM docs WHERE collection = ? AND id = ?')
      .get(collection, id) as { created_at: string; seq: number; ref: string | null } | undefined;

    if (existing) {
      this.db
        .prepare('UPDATE docs SET json = ?, ref = ? WHERE collection = ? AND id = ?')
        .run(JSON.stringify(doc), ref ?? existing.ref, collection, id);
    } else {
      this.seq += 1;
      this.db
        .prepare(
          'INSERT INTO docs (collection, id, ref, created_at, seq, json) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(collection, id, ref ?? null, nowIso(), this.seq, JSON.stringify(doc));
    }
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    const row = this.db
      .prepare('SELECT json FROM docs WHERE collection = ? AND id = ?')
      .get(collection, id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as T) : undefined;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const res = this.db
      .prepare('DELETE FROM docs WHERE collection = ? AND id = ?')
      .run(collection, id);
    return Number(res.changes) > 0;
  }

  async deleteWhere(collection: string, ref: string): Promise<number> {
    const res = this.db
      .prepare('DELETE FROM docs WHERE collection = ? AND ref = ?')
      .run(collection, ref);
    return Number(res.changes);
  }

  async list<T>(collection: string, opts: ListOptions = {}): Promise<StoredDoc<T>[]> {
    const order = opts.order === 'desc' ? 'DESC' : 'ASC';
    const limit = opts.limit ?? -1;
    const offset = opts.offset ?? 0;
    let rows: Array<{ id: string; ref: string | null; created_at: string; json: string }>;
    if (opts.ref !== undefined) {
      rows = this.db
        .prepare(
          `SELECT id, ref, created_at, json FROM docs WHERE collection = ? AND ref = ? ORDER BY seq ${order} LIMIT ? OFFSET ?`,
        )
        .all(collection, opts.ref, limit, offset) as typeof rows;
    } else {
      rows = this.db
        .prepare(
          `SELECT id, ref, created_at, json FROM docs WHERE collection = ? ORDER BY seq ${order} LIMIT ? OFFSET ?`,
        )
        .all(collection, limit, offset) as typeof rows;
    }
    return rows.map((r) => ({
      id: r.id,
      ref: r.ref ?? undefined,
      createdAt: r.created_at,
      doc: JSON.parse(r.json) as T,
    }));
  }

  async count(collection: string, ref?: string): Promise<number> {
    if (ref !== undefined) {
      const row = this.db
        .prepare('SELECT COUNT(*) AS c FROM docs WHERE collection = ? AND ref = ?')
        .get(collection, ref) as { c: number };
      return Number(row.c);
    }
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM docs WHERE collection = ?')
      .get(collection) as { c: number };
    return Number(row.c);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
