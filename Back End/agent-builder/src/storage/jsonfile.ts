import fs from 'node:fs';
import path from 'node:path';
import { nowIso } from '../util/id.ts';
import type { ListOptions, Storage, StoredDoc } from './index.ts';

interface Row {
  id: string;
  ref?: string;
  createdAt: string;
  seq: number;
  doc: unknown;
}

/**
 * Portable JSON-file driver: one file per collection under <dataDir>/store/.
 * Whole collection kept in memory; writes are atomic (tmp file + rename) and
 * debounced per collection.
 */
export class JsonFileStorage implements Storage {
  private dir: string;
  private collections = new Map<string, Map<string, Row>>();
  private dirty = new Set<string>();
  private seq = 0;
  private flushTimer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'store');
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      const name = f.slice(0, -'.json'.length);
      try {
        const rows = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as Row[];
        const map = new Map<string, Row>();
        for (const r of rows) {
          map.set(r.id, r);
          if (r.seq > this.seq) this.seq = r.seq;
        }
        this.collections.set(name, map);
      } catch {
        // Corrupt file: keep a backup, start fresh for that collection.
        try {
          fs.copyFileSync(path.join(this.dir, f), path.join(this.dir, `${f}.corrupt`));
        } catch {
          /* ignore */
        }
        this.collections.set(name, new Map());
      }
    }
    // Durability backstop: flush pending writes on process exit.
    this.exitFlush = () => this.flushSync();
    process.once('exit', this.exitFlush);
  }

  private exitFlush: () => void;

  private col(name: string): Map<string, Row> {
    let m = this.collections.get(name);
    if (!m) {
      m = new Map();
      this.collections.set(name, m);
    }
    return m;
  }

  private scheduleFlush(collection: string): void {
    this.dirty.add(collection);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flushSync();
    }, 100);
    // Don't hold the process open just for pending flushes.
    this.flushTimer.unref?.();
  }

  private flushSync(): void {
    for (const name of this.dirty) {
      const rows = [...this.col(name).values()];
      const file = path.join(this.dir, `${name}.json`);
      const tmp = `${file}.tmp`;
      try {
        fs.writeFileSync(tmp, JSON.stringify(rows));
        fs.renameSync(tmp, file);
      } catch {
        /* best-effort persistence */
      }
    }
    this.dirty.clear();
  }

  async put(collection: string, id: string, doc: unknown, ref?: string): Promise<void> {
    const m = this.col(collection);
    const existing = m.get(id);
    // Clone: callers keep mutating their objects (e.g. the run executor);
    // the store must hold the committed snapshot, not a live reference.
    const snapshot = structuredClone(doc);
    if (existing) {
      existing.doc = snapshot;
      if (ref !== undefined) existing.ref = ref;
    } else {
      this.seq += 1;
      m.set(id, { id, ref, createdAt: nowIso(), seq: this.seq, doc: snapshot });
    }
    this.scheduleFlush(collection);
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    const row = this.col(collection).get(id);
    return row ? (structuredClone(row.doc) as T) : undefined;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const ok = this.col(collection).delete(id);
    if (ok) this.scheduleFlush(collection);
    return ok;
  }

  async deleteWhere(collection: string, ref: string): Promise<number> {
    const m = this.col(collection);
    let n = 0;
    for (const [id, row] of m) {
      if (row.ref === ref) {
        m.delete(id);
        n++;
      }
    }
    if (n > 0) this.scheduleFlush(collection);
    return n;
  }

  async list<T>(collection: string, opts: ListOptions = {}): Promise<StoredDoc<T>[]> {
    let rows = [...this.col(collection).values()];
    if (opts.ref !== undefined) rows = rows.filter((r) => r.ref === opts.ref);
    rows.sort((a, b) => (opts.order === 'desc' ? b.seq - a.seq : a.seq - b.seq));
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? rows.length;
    return rows.slice(offset, offset + limit).map((r) => ({
      id: r.id,
      ref: r.ref,
      createdAt: r.createdAt,
      doc: structuredClone(r.doc) as T,
    }));
  }

  async count(collection: string, ref?: string): Promise<number> {
    if (ref === undefined) return this.col(collection).size;
    let n = 0;
    for (const row of this.col(collection).values()) if (row.ref === ref) n++;
    return n;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    process.removeListener('exit', this.exitFlush);
    this.flushSync();
  }
}
