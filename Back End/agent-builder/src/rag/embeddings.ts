/**
 * Embeddings: Gemini (gemini-embedding / text-embedding-004) or OpenAI
 * (text-embedding-3-small), falling back to a deterministic local
 * hashing-based embedder when no key is available (keeps File search usable
 * offline; quality is bag-of-words-ish but stable and fast).
 */

import { createHash } from 'node:crypto';
import type { ProviderKeys } from '../domain/types.ts';
import { fetchWithRetry, ProviderError } from '../providers/types.ts';

export interface Embedder {
  id: string;
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

const GEMINI_MODEL = 'text-embedding-004';
const OPENAI_MODEL = 'text-embedding-3-small';

export function createGeminiEmbedder(apiKey: string): Embedder {
  return {
    id: 'gemini',
    dim: 768,
    async embed(texts: string[]): Promise<number[][]> {
      const out: number[][] = [];
      // batchEmbedContents supports up to 100 requests per call
      for (let i = 0; i < texts.length; i += 100) {
        const batch = texts.slice(i, i + 100);
        const res = await fetchWithRetry(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              requests: batch.map((t) => ({
                model: `models/${GEMINI_MODEL}`,
                content: { parts: [{ text: t.slice(0, 8000) }] },
              })),
            }),
            timeoutMs: 60_000,
          },
          'gemini',
        );
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new ProviderError('gemini', `embeddings HTTP ${res.status}: ${body.slice(0, 400)}`, res.status);
        }
        const data = (await res.json()) as { embeddings?: Array<{ values: number[] }> };
        for (const e of data.embeddings ?? []) out.push(e.values);
      }
      return out;
    },
  };
}

export function createOpenAiEmbedder(apiKey: string): Embedder {
  return {
    id: 'openai',
    dim: 1536,
    async embed(texts: string[]): Promise<number[][]> {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 100) {
        const batch = texts.slice(i, i + 100);
        const res = await fetchWithRetry(
          'https://api.openai.com/v1/embeddings',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: OPENAI_MODEL,
              input: batch.map((t) => t.slice(0, 8000)),
            }),
            timeoutMs: 60_000,
          },
          'openai',
        );
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new ProviderError('openai', `embeddings HTTP ${res.status}: ${body.slice(0, 400)}`, res.status);
        }
        const data = (await res.json()) as { data?: Array<{ index: number; embedding: number[] }> };
        const sorted = (data.data ?? []).sort((a, b) => a.index - b.index);
        for (const e of sorted) out.push(e.embedding);
      }
      return out;
    },
  };
}

/**
 * Local fallback: 512-dim hashed bag-of-words with sublinear tf weighting.
 * Deterministic, no network. Not semantic, but supports keyword-ish recall.
 */
export function createLocalEmbedder(): Embedder {
  const DIM = 512;
  const tokenIndex = (token: string): { idx: number; sign: number } => {
    const h = createHash('sha1').update(token).digest();
    const idx = ((h[0] << 8) | h[1]) % DIM;
    const sign = h[2] % 2 === 0 ? 1 : -1;
    return { idx, sign };
  };
  return {
    id: 'local',
    dim: DIM,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((text) => {
        const vec = new Array<number>(DIM).fill(0);
        const tokens = text
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length > 1);
        const counts = new Map<string, number>();
        for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
        for (const [t, c] of counts) {
          const { idx, sign } = tokenIndex(t);
          vec[idx] += sign * (1 + Math.log(c));
          // lightweight bigram-ish smoothing using token prefix
          if (t.length > 4) {
            const { idx: i2, sign: s2 } = tokenIndex(t.slice(0, 4));
            vec[i2] += s2 * 0.5;
          }
        }
        // L2 normalize
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map((v) => v / norm);
      });
    },
  };
}

/** Pick the best available embedder given configured keys. */
export function selectEmbedder(keys: ProviderKeys | undefined): Embedder {
  const gemini = keys?.gemini?.[0] || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (gemini) return createGeminiEmbedder(gemini);
  const openai = keys?.openai?.[0] || process.env.OPENAI_API_KEY;
  if (openai) return createOpenAiEmbedder(openai);
  return createLocalEmbedder();
}

/** Get an embedder by recorded id (so search uses the same space as ingest). */
export function embedderById(id: string, keys: ProviderKeys | undefined): Embedder {
  if (id === 'gemini') {
    const key = keys?.gemini?.[0] || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (key) return createGeminiEmbedder(key);
    throw new Error('vector store was built with Gemini embeddings but no Gemini key is configured');
  }
  if (id === 'openai') {
    const key = keys?.openai?.[0] || process.env.OPENAI_API_KEY;
    if (key) return createOpenAiEmbedder(key);
    throw new Error('vector store was built with OpenAI embeddings but no OpenAI key is configured');
  }
  return createLocalEmbedder();
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
