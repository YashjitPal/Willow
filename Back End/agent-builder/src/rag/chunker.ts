/**
 * Text chunking for vector-store ingestion: paragraph-aware sliding window.
 */

export interface Chunk {
  index: number;
  text: string;
}

export interface ChunkOptions {
  /** Target chunk size in characters. */
  size?: number;
  /** Overlap between consecutive chunks in characters. */
  overlap?: number;
}

export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const size = Math.max(200, opts.size ?? 1600);
  const overlap = Math.min(Math.max(0, opts.overlap ?? 200), Math.floor(size / 2));
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= size) return [{ index: 0, text: clean }];

  // Split into paragraphs, then pack into windows.
  const paragraphs = clean.split(/\n{2,}/);
  const units: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= size) {
      units.push(p);
      continue;
    }
    // split long paragraphs by sentence-ish boundaries
    const sentences = p.split(/(?<=[.!?])\s+/);
    let cur = '';
    for (const s of sentences) {
      if (s.length > size) {
        // hard-split very long "sentences"
        if (cur) {
          units.push(cur);
          cur = '';
        }
        for (let i = 0; i < s.length; i += size) units.push(s.slice(i, i + size));
        continue;
      }
      if (cur.length + s.length + 1 > size) {
        units.push(cur);
        cur = s;
      } else {
        cur = cur ? `${cur} ${s}` : s;
      }
    }
    if (cur) units.push(cur);
  }

  const chunks: Chunk[] = [];
  let buffer = '';
  for (const unit of units) {
    if (buffer && buffer.length + unit.length + 2 > size) {
      chunks.push({ index: chunks.length, text: buffer });
      // start next buffer with tail overlap
      buffer = overlap > 0 ? buffer.slice(-overlap) + '\n\n' + unit : unit;
      // if overlap made it exceed size already, flush
      if (buffer.length > size * 1.5) {
        chunks.push({ index: chunks.length, text: buffer });
        buffer = '';
      }
    } else {
      buffer = buffer ? `${buffer}\n\n${unit}` : unit;
    }
  }
  if (buffer.trim()) chunks.push({ index: chunks.length, text: buffer });
  return chunks;
}
