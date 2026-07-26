/**
 * Vector stores: create/list/delete stores, add text files (chunk + embed),
 * cosine-similarity search. Chunks (with embeddings) persist in storage under
 * the `vector_chunks` collection, ref'd by store id.
 */

import type {
  EmbeddingOperationUsage,
  JsonObject,
  ProviderKeys,
  VectorSearchResult,
  VectorStore,
  VectorStoreFile,
} from '../domain/types.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { ids, nowIso } from '../util/id.ts';
import { chunkText } from './chunker.ts';
import { cosineSimilarity, createLocalEmbedder, embedderById, selectEmbedder } from './embeddings.ts';
import { extractDocumentText } from './extractText.ts';
import { priceEmbeddingUsage } from '../services/pricing.ts';
import { DEFAULT_SUBJECT_ID, DEFAULT_WORKSPACE_ID, type AuthPrincipal } from '../services/governance.ts';

interface StoredChunk {
  id: string;
  storeId: string;
  fileId: string;
  filename: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
}

class IngestionShutdownError extends Error {
  constructor() {
    super('server shutting down');
    this.name = 'IngestionShutdownError';
  }
}

export class VectorStoreService {
  private storage: Storage;
  private dataDir: string;
  private storeLocks = new Map<string, Promise<void>>();
  private ingestionControllers = new Map<string, AbortController>();
  private ingestionTasks = new Map<string, Promise<void>>();
  constructor(storage: Storage, dataDir = path.resolve('data')) {
    this.storage = storage;
    this.dataDir = dataDir;
  }

  private normalizeOwnership(store: VectorStore): VectorStore {
    return { ...store, ownerId: store.ownerId ?? DEFAULT_SUBJECT_ID, workspaceId: store.workspaceId ?? DEFAULT_WORKSPACE_ID };
  }

  private canAccess(store: VectorStore, access?: Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'> & Partial<Pick<AuthPrincipal, 'authority'>>): boolean {
    return !access || access.authority === 'platform'
      || (store.workspaceId === access.workspaceId && (access.role === 'admin' || store.ownerId === access.subjectId));
  }

  private sourcePath(fileId: string): string {
    return path.join(this.dataDir, 'uploads', `${fileId}.bin`);
  }

  private async updateFile(file: VectorStoreFile, patch: Partial<VectorStoreFile>): Promise<void> {
    Object.assign(file, patch, { updatedAt: nowIso() });
    await this.storage.put(COLLECTIONS.vectorFiles, file.id, file, file.storeId);
  }

  async getFile(storeId: string, fileId: string): Promise<VectorStoreFile | undefined> {
    const file = await this.storage.get<VectorStoreFile>(COLLECTIONS.vectorFiles, fileId);
    return file?.storeId === storeId ? file : undefined;
  }

  private async withStoreLock<T>(storeId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.storeLocks.get(storeId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.storeLocks.set(storeId, queued);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.storeLocks.get(storeId) === queued) this.storeLocks.delete(storeId);
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('ingestion cancelled');
    }
  }

  private isShutdown(signal?: AbortSignal): boolean {
    return signal?.aborted === true && signal.reason instanceof IngestionShutdownError;
  }

  private async deleteChunks(storeId: string, fileId: string): Promise<number> {
    const chunks = await this.storage.list<StoredChunk>(COLLECTIONS.vectorChunks, { ref: storeId });
    let removed = 0;
    for (const chunk of chunks) {
      if (chunk.doc.fileId === fileId && await this.storage.delete(COLLECTIONS.vectorChunks, chunk.id)) removed++;
    }
    return removed;
  }

  private async refreshStoreCounts(storeId: string): Promise<void> {
    const files = await this.listFiles(storeId);
    const ready = files.filter((file) => file.status === 'ready');
    await this.storage.mutateVectorStore({
      storeId,
      updatedAt: nowIso(),
      patch: { fileCount: ready.length, chunkCount: ready.reduce((sum, file) => sum + file.chunkCount, 0) },
    });
  }

  private async recordEmbeddingUsage(storeId: string, usage: EmbeddingOperationUsage): Promise<void> {
    await this.storage.mutateVectorStore({
      storeId,
      updatedAt: nowIso(),
      usage: {
        operation: usage.operation,
        operations: 1,
        requestCount: usage.requestCount,
        reportedInputTokens: usage.inputTokens ?? 0,
        unreportedTokenOperations: usage.tokenStatus === 'not_reported' ? 1 : 0,
        unpricedOperations: usage.pricing.status === 'unpriced' ? 1 : 0,
        estimatedCostUsd: usage.pricing.status === 'priced' ? usage.pricing.estimatedCostUsd ?? 0 : 0,
      },
    });
  }

  private failedEmbeddingUsage(embedderId: string, operation: 'ingestion' | 'search', cancelled: boolean): EmbeddingOperationUsage {
    const model = embedderId === 'openai' ? 'text-embedding-3-small' : embedderId === 'gemini' ? 'text-embedding-004' : 'local-hash-512';
    return {
      provider: embedderId === 'openai' ? 'openai' : embedderId === 'gemini' ? 'gemini' : 'local',
      model, operation, status: cancelled ? 'cancelled' : 'failed', requestCount: cancelled ? 0 : 1,
      tokenStatus: embedderId === 'local' ? 'not_applicable' : 'not_reported',
      pricing: priceEmbeddingUsage(model), at: nowIso(),
    };
  }

  async createStore(name: string, keys: ProviderKeys | undefined, access?: Pick<AuthPrincipal, 'subjectId' | 'workspaceId'>): Promise<VectorStore> {
    const embedder = selectEmbedder(keys);
    const store: VectorStore = {
      id: ids.vectorStore(),
      ownerId: access?.subjectId ?? DEFAULT_SUBJECT_ID,
      workspaceId: access?.workspaceId ?? DEFAULT_WORKSPACE_ID,
      name: name || 'Untitled store',
      fileCount: 0,
      chunkCount: 0,
      embedder: embedder.id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.storage.put(COLLECTIONS.vectorStores, store.id, store);
    return store;
  }

  async getStore(id: string, access?: Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'> & Partial<Pick<AuthPrincipal, 'authority'>>): Promise<VectorStore | undefined> {
    const store = await this.storage.get<VectorStore>(COLLECTIONS.vectorStores, id);
    if (!store) return undefined;
    const normalized = this.normalizeOwnership(store);
    return this.canAccess(normalized, access) ? normalized : undefined;
  }

  async listStores(access?: Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'> & Partial<Pick<AuthPrincipal, 'authority'>>): Promise<VectorStore[]> {
    const rows = await this.storage.list<VectorStore>(COLLECTIONS.vectorStores);
    return rows.map((r) => this.normalizeOwnership(r.doc)).filter((store) => this.canAccess(store, access));
  }

  async deleteStore(id: string, access?: Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'> & Partial<Pick<AuthPrincipal, 'authority'>>): Promise<boolean> {
    if (!await this.getStore(id, access)) return false;
    return this.withStoreLock(id, async () => {
      const ok = await this.storage.delete(COLLECTIONS.vectorStores, id);
      if (ok) {
        await this.storage.deleteWhere(COLLECTIONS.vectorChunks, id);
        await this.storage.deleteWhere(COLLECTIONS.vectorFiles, id);
      }
      return ok;
    });
  }

  async listFiles(storeId: string, access?: Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'> & Partial<Pick<AuthPrincipal, 'authority'>>): Promise<VectorStoreFile[]> {
    if (!await this.getStore(storeId, access)) return [];
    const rows = await this.storage.list<VectorStoreFile>(COLLECTIONS.vectorFiles, {
      ref: storeId,
    });
    return rows.map((r) => r.doc);
  }

  /**
   * Extract, chunk, embed, and persist a supported document.
   */
  async addFile(
    storeId: string,
    filename: string,
    content: string | Buffer,
    keys: ProviderKeys | undefined,
    mimeType?: string,
    signal?: AbortSignal,
  ): Promise<VectorStoreFile> {
    return this.withStoreLock(storeId, () => this.addFileLocked(storeId, filename, content, keys, mimeType, signal));
  }

  /** Persist an upload and return immediately while ingestion continues. */
  async enqueueFile(
    storeId: string,
    filename: string,
    content: string | Buffer,
    keys: ProviderKeys | undefined,
    mimeType?: string,
    access?: Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'>,
  ): Promise<VectorStoreFile> {
    const store = await this.getStore(storeId, access);
    if (!store) throw new Error(`vector store '${storeId}' not found`);
    const file = this.newFile(storeId, filename, content, mimeType);
    const source = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    await fs.mkdir(path.dirname(this.sourcePath(file.id)), { recursive: true });
    await fs.writeFile(this.sourcePath(file.id), source);
    await this.storage.put(COLLECTIONS.vectorFiles, file.id, file, storeId);
    this.scheduleIngestion(file, keys);
    return structuredClone(file);
  }

  private newFile(
    storeId: string,
    filename: string,
    content: string | Buffer,
    mimeType?: string,
  ): VectorStoreFile {
    const createdAt = nowIso();
    return {
      id: ids.vectorStoreFile(),
      storeId,
      filename: filename || 'untitled.txt',
      bytes: typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.byteLength,
      chunkCount: 0,
      status: 'processing',
      stage: 'queued',
      processedUnits: 0,
      totalUnits: 0,
      mimeType,
      createdAt,
      updatedAt: createdAt,
    };
  }

  private scheduleIngestion(file: VectorStoreFile, keys: ProviderKeys | undefined): void {
    if (this.ingestionTasks.has(file.id)) return;
    const controller = new AbortController();
    this.ingestionControllers.set(file.id, controller);
    const task = (async () => {
      try {
        const content = await fs.readFile(this.sourcePath(file.id));
        await this.withStoreLock(file.storeId, () => this.processFileLocked(file, content, keys, controller.signal));
      } catch {
        // processFileLocked persists terminal errors. A missing source is
        // handled here because processing never starts.
        const current = await this.getFile(file.storeId, file.id);
        if (current?.status === 'processing' && !this.isShutdown(controller.signal)) {
          await this.updateFile(current, {
            status: controller.signal.aborted ? 'cancelled' : 'error',
            stage: 'completed',
            error: controller.signal.aborted ? 'ingestion cancelled' : 'uploaded source is unavailable',
            completedAt: nowIso(),
          });
        }
      } finally {
        this.ingestionControllers.delete(file.id);
        this.ingestionTasks.delete(file.id);
        if (!this.isShutdown(controller.signal)) {
          await fs.rm(this.sourcePath(file.id), { force: true }).catch(() => undefined);
        }
      }
    })();
    this.ingestionTasks.set(file.id, task);
  }

  async cancelIngestion(storeId: string, fileId: string, access?: Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'>): Promise<VectorStoreFile | undefined> {
    if (!await this.getStore(storeId, access)) return undefined;
    const file = await this.getFile(storeId, fileId);
    if (!file) return undefined;
    if (file.status !== 'processing') return file;
    this.ingestionControllers.get(fileId)?.abort(new Error('ingestion cancelled'));
    const activeTask = this.ingestionTasks.get(fileId);
    if (activeTask) {
      // Do not acknowledge cancellation until cleanup and the terminal file
      // state are durable. Otherwise a caller can observe `processing` after a
      // successful cancel and a restart may recover work it considers stopped.
      await activeTask.catch(() => undefined);
    } else {
      await this.updateFile(file, {
        status: 'cancelled',
        stage: 'completed',
        error: 'ingestion cancelled',
        completedAt: nowIso(),
      });
      await fs.rm(this.sourcePath(file.id), { force: true }).catch(() => undefined);
    }
    return (await this.getFile(storeId, fileId)) ?? file;
  }

  async recoverPendingIngestions(
    keys: ProviderKeys | undefined | ((workspaceId: string) => Promise<ProviderKeys | undefined>),
  ): Promise<number> {
    const rows = await this.storage.list<VectorStoreFile>(COLLECTIONS.vectorFiles);
    let recovered = 0;
    for (const { doc: file } of rows) {
      if (file.status !== 'processing') continue;
      try {
        await fs.access(this.sourcePath(file.id));
        const store = await this.getStore(file.storeId);
        const workspaceKeys = typeof keys === 'function'
          ? await keys(store?.workspaceId ?? DEFAULT_WORKSPACE_ID)
          : keys;
        this.scheduleIngestion(file, workspaceKeys);
        recovered++;
      } catch {
        await this.updateFile(file, {
          status: 'error',
          stage: 'completed',
          error: 'server restarted before the uploaded source was durably stored',
          completedAt: nowIso(),
        });
      }
    }
    return recovered;
  }

  async close(): Promise<void> {
    for (const controller of this.ingestionControllers.values()) {
      controller.abort(new IngestionShutdownError());
    }
    await Promise.allSettled(this.ingestionTasks.values());
  }

  private async addFileLocked(
    storeId: string,
    filename: string,
    content: string | Buffer,
    keys: ProviderKeys | undefined,
    mimeType?: string,
    signal?: AbortSignal,
  ): Promise<VectorStoreFile> {
    this.throwIfAborted(signal);
    const store = await this.getStore(storeId);
    if (!store) throw new Error(`vector store '${storeId}' not found`);
    const file = this.newFile(storeId, filename, content, mimeType);
    await this.storage.put(COLLECTIONS.vectorFiles, file.id, file, storeId);
    return this.processFileLocked(file, content, keys, signal, store);
  }

  private async processFileLocked(
    file: VectorStoreFile,
    content: string | Buffer,
    keys: ProviderKeys | undefined,
    signal?: AbortSignal,
    knownStore?: VectorStore,
  ): Promise<VectorStoreFile> {
    const store = knownStore ?? await this.getStore(file.storeId);
    if (!store) throw new Error(`vector store '${file.storeId}' not found`);
    try {
      await this.updateFile(file, { stage: 'extracting' });
      const text = await extractDocumentText(file.filename, content, file.mimeType);
      this.throwIfAborted(signal);
      await this.updateFile(file, { stage: 'chunking' });
      const chunks = chunkText(text);
      if (!chunks.length) throw new Error('file contains no extractable text');
      await this.updateFile(file, { stage: 'embedding', totalUnits: chunks.length });
      let embedder = embedderById(store.embedder, keys);
      let embeddings: number[][];
      const fileUsage: EmbeddingOperationUsage[] = [];
      try {
        const embedded = await embedder.embed(chunks.map((c) => c.text), signal);
        embeddings = embedded.vectors;
        const usage = { ...embedded.usage, operation: 'ingestion' } satisfies EmbeddingOperationUsage;
        fileUsage.push(usage);
        await this.recordEmbeddingUsage(store.id, usage);
      } catch (error) {
        const failedUsage = this.failedEmbeddingUsage(embedder.id, 'ingestion', Boolean(signal?.aborted));
        fileUsage.push(failedUsage);
        await this.recordEmbeddingUsage(store.id, failedUsage);
        await this.updateFile(file, { embeddingUsage: fileUsage });
        // Keep File Search usable when a configured remote key is expired or
        // temporarily unavailable. Persist the fallback space so later
        // queries use the same dimensions as the ingested chunks.
        if (signal?.aborted || embedder.id === 'local' || store.chunkCount > 0) throw error;
        embedder = createLocalEmbedder();
        const embedded = await embedder.embed(chunks.map((c) => c.text), signal);
        embeddings = embedded.vectors;
        const usage = { ...embedded.usage, operation: 'ingestion' } satisfies EmbeddingOperationUsage;
        fileUsage.push(usage);
        await this.recordEmbeddingUsage(store.id, usage);
        await this.storage.mutateVectorStore({ storeId: store.id, updatedAt: nowIso(), patch: { embedder: embedder.id } });
      }
      await this.updateFile(file, { embeddingUsage: fileUsage });
      await this.updateFile(file, { stage: 'indexing' });
      for (let i = 0; i < chunks.length; i++) {
        this.throwIfAborted(signal);
        const chunk: StoredChunk = {
          id: `${file.id}_c${i}`,
          storeId: file.storeId,
          fileId: file.id,
          filename: file.filename,
          chunkIndex: i,
          text: chunks[i].text,
          embedding: embeddings[i],
        };
        await this.storage.put(COLLECTIONS.vectorChunks, chunk.id, chunk, file.storeId);
        await this.updateFile(file, { processedUnits: i + 1 });
      }
      file.chunkCount = chunks.length;
      file.status = 'ready';
      await this.updateFile(file, { stage: 'completed', completedAt: nowIso() });

      await this.refreshStoreCounts(file.storeId);
      return file;
    } catch (e) {
      await this.deleteChunks(file.storeId, file.id);
      if (this.isShutdown(signal)) {
        file.chunkCount = 0;
        file.status = 'processing';
        delete file.error;
        await this.updateFile(file, {
          stage: 'queued',
          processedUnits: 0,
          totalUnits: 0,
          completedAt: undefined,
        });
        await this.refreshStoreCounts(file.storeId);
        throw e;
      }
      file.chunkCount = 0;
      file.status = signal?.aborted ? 'cancelled' : 'error';
      file.error = (e as Error).message;
      await this.updateFile(file, { stage: 'completed', processedUnits: 0, completedAt: nowIso() });
      await this.refreshStoreCounts(file.storeId);
      throw e;
    }
  }

  async deleteFile(storeId: string, fileId: string, access?: Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'>): Promise<boolean> {
    if (!await this.getStore(storeId, access)) return false;
    return this.withStoreLock(storeId, () => this.deleteFileLocked(storeId, fileId));
  }

  private async deleteFileLocked(storeId: string, fileId: string): Promise<boolean> {
    const file = await this.storage.get<VectorStoreFile>(COLLECTIONS.vectorFiles, fileId);
    if (!file || file.storeId !== storeId) return false;
    await this.storage.delete(COLLECTIONS.vectorFiles, fileId);
    // delete this file's chunks
    await this.deleteChunks(storeId, fileId);
    await this.refreshStoreCounts(storeId);
    return true;
  }

  async search(
    storeIds: string[],
    query: string,
    keys: ProviderKeys | undefined,
    opts: { maxResults?: number; scoreThreshold?: number; signal?: AbortSignal; onEmbeddingUsage?: (usage: EmbeddingOperationUsage) => void } = {},
    access?: Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'>,
  ): Promise<VectorSearchResult[]> {
    if (typeof query !== 'string' || !query.trim()) {
      throw new Error('file search query must not be empty');
    }
    const maxResults = Math.max(1, Math.min(opts.maxResults ?? 8, 50));
    const threshold = opts.scoreThreshold ?? 0;

    const results: VectorSearchResult[] = [];
    for (const storeId of storeIds) {
      if (opts.signal?.aborted) throw opts.signal.reason instanceof Error ? opts.signal.reason : new Error('run cancelled');
      const store = await this.getStore(storeId, access);
      if (!store) throw new Error(`vector store '${storeId}' not found`);
      const chunks = await this.storage.list<StoredChunk>(COLLECTIONS.vectorChunks, {
        ref: storeId,
      });
      if (!chunks.length) continue;
      const files = await this.listFiles(storeId, access);
      const readyFileIds = new Set(files.filter((file) => file.status === 'ready').map((file) => file.id));
      const embedder = embedderById(store.embedder, keys);
      let qvec: number[];
      try {
        const embedded = await embedder.embed([query], opts.signal);
        [qvec] = embedded.vectors;
        const usage = { ...embedded.usage, operation: 'search' } satisfies EmbeddingOperationUsage;
        await this.recordEmbeddingUsage(store.id, usage);
        opts.onEmbeddingUsage?.(usage);
      } catch (error) {
        const usage = this.failedEmbeddingUsage(embedder.id, 'search', Boolean(opts.signal?.aborted));
        await this.recordEmbeddingUsage(store.id, usage);
        opts.onEmbeddingUsage?.(usage);
        throw error;
      }
      for (const { doc } of chunks) {
        if (!readyFileIds.has(doc.fileId)) continue;
        const score = cosineSimilarity(qvec, doc.embedding);
        if (score >= threshold) {
          results.push({
            fileId: doc.fileId,
            filename: doc.filename,
            chunkIndex: doc.chunkIndex,
            score,
            text: doc.text,
          });
        }
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /** Concatenated top chunks — used by the hallucination guardrail. */
  async knowledgeContext(
    storeId: string,
    query: string,
    keys: ProviderKeys | undefined,
    maxChars = 6000,
    signal?: AbortSignal,
  ): Promise<string> {
    const results = await this.search([storeId], query, keys, { maxResults: 12, signal });
    let out = '';
    for (const r of results) {
      if (out.length + r.text.length > maxChars) break;
      out += `${r.text}\n\n`;
    }
    return out.trim();
  }
}

export type { JsonObject };
