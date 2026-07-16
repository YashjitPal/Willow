/**
 * Vector stores: create/list/delete stores, add text files (chunk + embed),
 * cosine-similarity search. Chunks (with embeddings) persist in storage under
 * the `vector_chunks` collection, ref'd by store id.
 */

import type {
  JsonObject,
  ProviderKeys,
  VectorSearchResult,
  VectorStore,
  VectorStoreFile,
} from '../domain/types.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { ids, nowIso } from '../util/id.ts';
import { chunkText } from './chunker.ts';
import { cosineSimilarity, createLocalEmbedder, embedderById, selectEmbedder } from './embeddings.ts';

interface StoredChunk {
  id: string;
  storeId: string;
  fileId: string;
  filename: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
}

export class VectorStoreService {
  private storage: Storage;
  constructor(storage: Storage) {
    this.storage = storage;
  }

  async createStore(name: string, keys: ProviderKeys | undefined): Promise<VectorStore> {
    const embedder = selectEmbedder(keys);
    const store: VectorStore = {
      id: ids.vectorStore(),
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

  async getStore(id: string): Promise<VectorStore | undefined> {
    return this.storage.get<VectorStore>(COLLECTIONS.vectorStores, id);
  }

  async listStores(): Promise<VectorStore[]> {
    const rows = await this.storage.list<VectorStore>(COLLECTIONS.vectorStores);
    return rows.map((r) => r.doc);
  }

  async deleteStore(id: string): Promise<boolean> {
    const ok = await this.storage.delete(COLLECTIONS.vectorStores, id);
    if (ok) {
      await this.storage.deleteWhere(COLLECTIONS.vectorChunks, id);
      await this.storage.deleteWhere(COLLECTIONS.vectorFiles, id);
    }
    return ok;
  }

  async listFiles(storeId: string): Promise<VectorStoreFile[]> {
    const rows = await this.storage.list<VectorStoreFile>(COLLECTIONS.vectorFiles, {
      ref: storeId,
    });
    return rows.map((r) => r.doc);
  }

  /**
   * Add a text file: chunk, embed, persist. `content` is plain text
   * (the API layer decodes base64 uploads before calling this).
   */
  async addFile(
    storeId: string,
    filename: string,
    content: string,
    keys: ProviderKeys | undefined,
  ): Promise<VectorStoreFile> {
    const store = await this.getStore(storeId);
    if (!store) throw new Error(`vector store '${storeId}' not found`);

    const file: VectorStoreFile = {
      id: ids.vectorStoreFile(),
      storeId,
      filename: filename || 'untitled.txt',
      bytes: Buffer.byteLength(content, 'utf8'),
      chunkCount: 0,
      status: 'processing',
      createdAt: nowIso(),
    };
    await this.storage.put(COLLECTIONS.vectorFiles, file.id, file, storeId);

    try {
      const chunks = chunkText(content);
      if (!chunks.length) throw new Error('file contains no extractable text');
      let embedder = embedderById(store.embedder, keys);
      let embeddings: number[][];
      try {
        embeddings = await embedder.embed(chunks.map((c) => c.text));
      } catch (error) {
        // Keep File Search usable when a configured remote key is expired or
        // temporarily unavailable. Persist the fallback space so later
        // queries use the same dimensions as the ingested chunks.
        if (embedder.id === 'local') throw error;
        embedder = createLocalEmbedder();
        embeddings = await embedder.embed(chunks.map((c) => c.text));
        store.embedder = embedder.id;
        await this.storage.put(COLLECTIONS.vectorStores, store.id, store);
      }
      for (let i = 0; i < chunks.length; i++) {
        const chunk: StoredChunk = {
          id: `${file.id}_c${i}`,
          storeId,
          fileId: file.id,
          filename: file.filename,
          chunkIndex: i,
          text: chunks[i].text,
          embedding: embeddings[i],
        };
        await this.storage.put(COLLECTIONS.vectorChunks, chunk.id, chunk, storeId);
      }
      file.chunkCount = chunks.length;
      file.status = 'ready';
      await this.storage.put(COLLECTIONS.vectorFiles, file.id, file, storeId);

      store.fileCount += 1;
      store.chunkCount += chunks.length;
      store.updatedAt = nowIso();
      await this.storage.put(COLLECTIONS.vectorStores, store.id, store);
      return file;
    } catch (e) {
      file.status = 'error';
      file.error = (e as Error).message;
      await this.storage.put(COLLECTIONS.vectorFiles, file.id, file, storeId);
      throw e;
    }
  }

  async deleteFile(storeId: string, fileId: string): Promise<boolean> {
    const file = await this.storage.get<VectorStoreFile>(COLLECTIONS.vectorFiles, fileId);
    if (!file || file.storeId !== storeId) return false;
    await this.storage.delete(COLLECTIONS.vectorFiles, fileId);
    // delete this file's chunks
    const chunks = await this.storage.list<StoredChunk>(COLLECTIONS.vectorChunks, { ref: storeId });
    let removed = 0;
    for (const c of chunks) {
      if (c.doc.fileId === fileId) {
        await this.storage.delete(COLLECTIONS.vectorChunks, c.id);
        removed++;
      }
    }
    const store = await this.getStore(storeId);
    if (store) {
      store.fileCount = Math.max(0, store.fileCount - 1);
      store.chunkCount = Math.max(0, store.chunkCount - removed);
      store.updatedAt = nowIso();
      await this.storage.put(COLLECTIONS.vectorStores, store.id, store);
    }
    return true;
  }

  async search(
    storeIds: string[],
    query: string,
    keys: ProviderKeys | undefined,
    opts: { maxResults?: number; scoreThreshold?: number } = {},
  ): Promise<VectorSearchResult[]> {
    const maxResults = Math.max(1, Math.min(opts.maxResults ?? 8, 50));
    const threshold = opts.scoreThreshold ?? 0;

    const results: VectorSearchResult[] = [];
    for (const storeId of storeIds) {
      const store = await this.getStore(storeId);
      if (!store) continue;
      const chunks = await this.storage.list<StoredChunk>(COLLECTIONS.vectorChunks, {
        ref: storeId,
      });
      if (!chunks.length) continue;
      const embedder = embedderById(store.embedder, keys);
      const [qvec] = await embedder.embed([query]);
      for (const { doc } of chunks) {
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
  ): Promise<string> {
    const results = await this.search([storeId], query, keys, { maxResults: 12 });
    let out = '';
    for (const r of results) {
      if (out.length + r.text.length > maxChars) break;
      out += `${r.text}\n\n`;
    }
    return out.trim();
  }
}

export type { JsonObject };
