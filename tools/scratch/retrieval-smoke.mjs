/**
 * Exercise notebook retrieval's pure halves — chunking and BM25 ranking — without
 * a browser, a key, or the app. Throwaway; lives in tools/scratch.
 *
 *   node tools/scratch/retrieval-smoke.mjs
 *
 * The module imports `@willow/ai/embeddings`, which is a TS path alias Node cannot
 * resolve, so it is bundled first with that import aliased to a stub. Only the
 * embedding path uses it, and this exercises the lexical path.
 */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'willow-retrieval-'));
const stub = path.join(dir, 'embeddings-stub.mjs');
writeFileSync(stub, `
export const embedGeminiText = async () => { throw new Error('not used in this smoke test'); };
export const embedGeminiTexts = async () => { throw new Error('not used in this smoke test'); };
`);

const out = path.join(dir, 'retrieval.mjs');
await build({
  entryPoints: ['features/notebooks/src/source-retrieval.ts'],
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  alias: { '@willow/ai/embeddings': stub },
  logLevel: 'silent',
});

const { chunkText, chunkSources, rankLexically, selectChunks } = await import(
  'file:///' + out.replace(/\\/g, '/')
);

// A synthetic document whose answer is deliberately at the END, which is exactly
// what the old head-slice could never reach.
const paragraphs = [];
for (let i = 0; i < 40; i += 1) {
  paragraphs.push(
    `Section ${i}. This paragraph discusses general administrative matters, meeting minutes, and routine scheduling notes that have nothing to do with the question being asked. `.repeat(3),
  );
}
paragraphs.push(
  'Appendix B. The mitochondrion generates adenosine triphosphate through oxidative phosphorylation, using the electron transport chain across the inner membrane.',
);
const document = paragraphs.join('\n\n');

const sources = [
  { id: 's1', title: 'Lab notes.pdf', kind: 'file', content: document, createdAt: 0 },
  { id: 's2', title: 'Budget.csv', kind: 'file', content: 'Line item,Cost\nPipettes,120\nGloves,45\n', createdAt: 0 },
];

console.log(`document: ${document.length} chars`);
const chunks = chunkText(document);
console.log(`chunks:   ${chunks.length}, sizes ${Math.min(...chunks.map((c) => c.text.length))}–${Math.max(...chunks.map((c) => c.text.length))}`);
console.log(`all chunks: ${chunkSources(sources).length} across ${sources.length} sources`);

const query = 'how does the mitochondrion make ATP';
const all = chunkSources(sources);
const scores = rankLexically(query, all);
const best = all
  .map((chunk, index) => ({ chunk, score: scores[index] }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 3);

console.log(`\nquery: "${query}"`);
for (const { chunk, score } of best) {
  console.log(`  ${score.toFixed(3)}  ${chunk.title} @${chunk.offset}  ${chunk.text.slice(0, 90).replace(/\s+/g, ' ')}…`);
}

// Budget forced low so selection has to rank rather than send everything.
const selected = await selectChunks({ query, sources, budget: 3_000 });
console.log(`\nselected: ${selected.chunks.length} chunks via ${selected.method}, ${selected.chunks.reduce((n, c) => n + c.text.length, 0)} chars`);
const hit = selected.chunks.some((chunk) => chunk.text.includes('oxidative phosphorylation'));
console.log(hit ? 'PASS: the answer paragraph was retrieved' : 'FAIL: the answer paragraph was NOT retrieved');
console.log(`order preserved: ${selected.chunks.every((c, i, a) => i === 0 || a[i - 1].offset <= c.offset || a[i - 1].ordinal < c.ordinal)}`);

// And the small-notebook path: everything fits, so no ranking should happen.
const tiny = await selectChunks({ query, sources: [sources[1]], budget: 3_000 });
console.log(`small notebook: method=${tiny.method} (expect "all")`);
