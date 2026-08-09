/**
 * Normalises Gemini grounding metadata into the shape the inline source chips
 * consume.
 *
 * Two provider quirks drive the defensive reads here:
 *
 *  1. The repo pins `@google/generative-ai@0.24.1`, whose `GroundingSupport`
 *     declares `segment?: string` and misspells the index array as
 *     `groundingChunckIndices`. `@google/genai@1.38.0` (also installed) uses the
 *     correct `segment?: Segment` object and `groundingChunkIndices`. The runtime
 *     payload follows whichever the API returns, so both spellings and both
 *     segment shapes are accepted.
 *  2. `segment.startIndex` / `endIndex` are UTF-8 **byte** offsets, not JS string
 *     indices. They coincide only for ASCII. `byteOffsetToCharIndex` converts.
 */

export interface GroundingSource {
  /** Absolute URL of the cited page. Usually a vertexaisearch redirect. */
  uri: string;
  /** Publisher title as the provider reports it, e.g. "NDTV". */
  title: string;
  /** Host as the provider reports it, e.g. "www.hindustantimes.com". */
  domain: string;
  /**
   * A short excerpt of the cited page, when the provider sends one.
   *
   * Optional because no two providers agree. Measured against each one's live
   * response schema:
   *
   *  - Gemini `groundingChunks[].web` carries `uri`, `title`, `domain` and
   *    `searchResultMapping` and nothing else, so this stays undefined. Gemini's
   *    own app fills its third row by resolving the redirect server-side and
   *    reading the destination page, which the public API does not do for us.
   *  - Anthropic `web_search_result_location.cited_text` is documented as "up to
   *    150 characters of the cited content" -- real source text, so this is set.
   *  - OpenAI `url_citation` is `{url, title, start_index, end_index}` with no
   *    excerpt field, and xAI's citations carry a URL alone. Both stay undefined.
   *
   * Consumers must treat an absent value as "this provider cannot supply one"
   * and render the shorter card, never a blank row.
   */
  snippet?: string;
}

export interface GroundingCitation {
  /** Character index into the answer text, one past the cited run's last char. */
  endIndex: number;
  /** Character index of the cited run's first char. */
  startIndex: number;
  /** Indices into `MessageCitations.sources`. Never empty. */
  sourceIndices: number[];
}

export interface MessageCitations {
  sources: GroundingSource[];
  citations: GroundingCitation[];
}

/** UTF-8 byte length of the code point starting at `i`, plus units consumed. */
const codePointBytes = (text: string, i: number): [bytes: number, units: number] => {
  const cp = text.codePointAt(i) ?? 0;
  if (cp < 0x80) return [1, 1];
  if (cp < 0x800) return [2, 1];
  if (cp < 0x10000) return [3, 1];
  return [4, 2];
};

/**
 * Maps a UTF-8 byte offset to a JS (UTF-16) string index. Offsets past the end
 * clamp to `text.length`, which is what a truncated stream produces.
 */
export const byteOffsetToCharIndex = (text: string, byteOffset: number): number => {
  if (byteOffset <= 0) return 0;
  let bytes = 0;
  let i = 0;
  while (i < text.length) {
    if (bytes >= byteOffset) return i;
    const [b, u] = codePointBytes(text, i);
    bytes += b;
    i += u;
  }
  return text.length;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Reads a chunk's web payload under either SDK's field names. */
const readSource = (chunk: any): GroundingSource | null => {
  const web = chunk?.web ?? chunk?.retrievedContext ?? null;
  if (!web) return null;
  const uri = asString(web.uri ?? web.url);
  const title = asString(web.title);
  let domain = asString(web.domain);
  if (!domain) {
    // The 1.5-era payload omits `domain`; derive it from the title when the
    // title is itself a host, else leave it empty rather than inventing one.
    domain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title) ? title : '';
  }
  if (!uri && !title && !domain) return null;
  // No observed Gemini payload carries any of these, but the read costs nothing
  // and means a server-side addition starts filling the card without a code
  // change. Absent stays absent -- never substitute the answer text, which is
  // what `groundingSupports[].segment.text` holds.
  const snippet = asString(web.snippet ?? web.description ?? web.excerpt);
  const source: GroundingSource = { uri, title: title || domain, domain };
  if (snippet) source.snippet = snippet;
  return source;
};

/** Reads a support's chunk indices under either SDK's spelling. */
const readChunkIndices = (support: any): number[] => {
  const raw = support?.groundingChunkIndices ?? support?.groundingChunckIndices ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((n: unknown): n is number => typeof n === 'number' && n >= 0);
};

interface RawSegment {
  startIndex: number;
  endIndex: number;
  text: string;
}

/** Reads a support's segment as byte offsets, tolerating the string form. */
const readSegment = (support: any): RawSegment | null => {
  const seg = support?.segment;
  if (typeof seg === 'string') {
    // v0.24.1's declared shape: the cited text with no offsets. Located by
    // search in `resolveCitations`, signalled by -1.
    return seg ? { startIndex: -1, endIndex: -1, text: seg } : null;
  }
  if (!seg || typeof seg !== 'object') return null;
  const startIndex = typeof seg.startIndex === 'number' ? seg.startIndex : 0;
  const endIndex = typeof seg.endIndex === 'number' ? seg.endIndex : -1;
  const text = asString(seg.text);
  if (endIndex < 0 && !text) return null;
  return { startIndex, endIndex, text };
};

/**
 * Picks the single most complete `groundingMetadata` from those seen during a
 * stream.
 *
 * Supports reference sources by index into the *same* metadata object, so
 * merging two objects would corrupt those indices. Choosing one whole object
 * keeps them coherent; ties resolve to the later one, which is the more complete
 * during an incremental stream.
 */
export const pickGroundingMetadata = (candidates: any[]): any | null => {
  let best: any = null;
  let bestScore = -1;
  for (const meta of candidates) {
    if (!meta) continue;
    const supports = Array.isArray(meta.groundingSupports) ? meta.groundingSupports.length : 0;
    const chunks = Array.isArray(meta.groundingChunks) ? meta.groundingChunks.length : 0;
    if (supports === 0 && chunks === 0) continue;
    const score = supports * 1000 + chunks;
    if (score >= bestScore) {
      bestScore = score;
      best = meta;
    }
  }
  return best;
};

/**
 * Converts one `groundingMetadata` object plus the answer text it describes into
 * character-indexed citations.
 *
 * `textOffset` shifts every resolved index, so a tool loop that streams text
 * across several provider calls can report each call's metadata against the
 * answer accumulated so far.
 */
export const resolveCitations = (
  metadata: any,
  answerText: string,
  textOffset = 0,
): MessageCitations => {
  const empty: MessageCitations = { sources: [], citations: [] };
  if (!metadata || typeof answerText !== 'string') return empty;

  const rawChunks: any[] = Array.isArray(metadata.groundingChunks) ? metadata.groundingChunks : [];
  const rawSupports: any[] = Array.isArray(metadata.groundingSupports) ? metadata.groundingSupports : [];
  if (!rawChunks.length || !rawSupports.length) return empty;

  // Keep chunk indices stable: a chunk that fails to parse becomes a hole, not a
  // shift of every later index.
  const sources: GroundingSource[] = [];
  const chunkToSource = new Map<number, number>();
  rawChunks.forEach((chunk, i) => {
    const source = readSource(chunk);
    if (!source) return;
    chunkToSource.set(i, sources.length);
    sources.push(source);
  });
  if (!sources.length) return empty;

  const citations: GroundingCitation[] = [];
  for (const support of rawSupports) {
    const seg = readSegment(support);
    if (!seg) continue;

    const sourceIndices: number[] = [];
    for (const chunkIndex of readChunkIndices(support)) {
      const mapped = chunkToSource.get(chunkIndex);
      if (mapped !== undefined && !sourceIndices.includes(mapped)) sourceIndices.push(mapped);
    }
    if (!sourceIndices.length) continue;

    let start: number;
    let end: number;
    if (seg.endIndex >= 0) {
      start = byteOffsetToCharIndex(answerText, seg.startIndex);
      end = byteOffsetToCharIndex(answerText, seg.endIndex);
      // Byte math is authoritative, but verify against the provider's own copy
      // of the text when it sent one; a mismatch means the offsets are stale.
      if (seg.text && answerText.slice(start, end) !== seg.text) {
        const found = answerText.indexOf(seg.text);
        if (found !== -1) {
          start = found;
          end = found + seg.text.length;
        }
      }
    } else {
      const found = answerText.indexOf(seg.text);
      if (found === -1) continue;
      start = found;
      end = found + seg.text.length;
    }
    if (end <= start) continue;

    citations.push({
      startIndex: start + textOffset,
      endIndex: end + textOffset,
      sourceIndices,
    });
  }
  if (!citations.length) return empty;

  citations.sort((a, b) => a.endIndex - b.endIndex || a.startIndex - b.startIndex);
  return { sources, citations };
};

/** Concatenates per-iteration results, re-basing each one's source indices. */
export const mergeCitations = (parts: MessageCitations[]): MessageCitations => {
  const sources: GroundingSource[] = [];
  const citations: GroundingCitation[] = [];
  // Identical URLs across iterations are the same page; collapse them so a chip
  // does not read "NDTV +1" for one source cited twice.
  const seen = new Map<string, number>();
  for (const part of parts) {
    if (!part?.citations?.length) continue;
    const remap = part.sources.map((source) => {
      const key = source.uri || `${source.title}|${source.domain}`;
      const existing = seen.get(key);
      if (existing !== undefined) {
        // Same page, seen again. Anthropic sends a search result before it sends
        // the citation that quotes it, and only the citation carries
        // `cited_text` -- so the first copy of a URL is routinely the one
        // WITHOUT a snippet. Keeping the first blindly would drop the excerpt
        // and silently downgrade the card to two rows.
        const kept = sources[existing];
        if (!kept.snippet && source.snippet) kept.snippet = source.snippet;
        if (!kept.domain && source.domain) kept.domain = source.domain;
        // A real headline beats a bare host, which is what `title` falls back to.
        if (source.title && source.title !== source.domain && kept.title === kept.domain) {
          kept.title = source.title;
        }
        return existing;
      }
      const next = sources.length;
      seen.set(key, next);
      sources.push({ ...source });
      return next;
    });
    for (const citation of part.citations) {
      const mapped = citation.sourceIndices
        .map((i) => remap[i])
        .filter((i): i is number => i !== undefined);
      if (mapped.length) citations.push({ ...citation, sourceIndices: mapped });
    }
  }
  if (!citations.length) return { sources: [], citations: [] };
  citations.sort((a, b) => a.endIndex - b.endIndex || a.startIndex - b.startIndex);
  return { sources, citations };
};

/* -------------------------------------------------------------------------- *
 * Anthropic
 * -------------------------------------------------------------------------- */

/**
 * One text content block, with the citations Anthropic attached to it and the
 * range it occupies in the accumulated answer.
 *
 * The range has to come from the caller because Anthropic's citations carry no
 * offsets into the answer -- unlike Gemini's `segment.startIndex/endIndex` and
 * unlike OpenAI's `start_index/end_index`. A `web_search_result_location` says
 * *which page* was used and quotes it, but locates it only by which content
 * block it hangs off. So the block's own span in the answer IS the cited span,
 * and only the stream reader knows where each block started.
 */
export interface AnthropicCitedBlock {
  /** Character index in the accumulated answer where this block's text begins. */
  start: number;
  /** Character index one past this block's last character. */
  end: number;
  /** Raw `web_search_result_location` objects streamed via `citations_delta`. */
  citations: any[];
}

/** Reads one Anthropic search result or citation into a source. */
const readAnthropicSource = (raw: any): GroundingSource | null => {
  const uri = asString(raw?.url);
  const title = asString(raw?.title);
  if (!uri && !title) return null;
  let domain = '';
  try {
    // Anthropic returns the publisher's real URL, not a redirect, so the host is
    // the publisher's own -- no `.google.com` guard is needed here, unlike the
    // Gemini path where every `uri` is a vertexaisearch redirect.
    if (uri) domain = new URL(uri).hostname;
  } catch {
    domain = '';
  }
  const source: GroundingSource = { uri, title: title || domain, domain };
  // `cited_text` is documented as up to 150 characters of the cited content.
  // It is a quotation of the passage the model actually used, which is a
  // narrower thing than the page description Gemini's own card shows -- but it
  // is real text from the real page, so it fills the row honestly.
  const cited = asString(raw?.cited_text);
  if (cited) source.snippet = cited;
  return source;
};

/**
 * Converts Anthropic's streamed search results and per-block citations into the
 * same `MessageCitations` the Gemini path produces.
 *
 * `searchResults` are the `web_search_result` entries from
 * `web_search_tool_result` blocks; they carry `url` and `title` but never an
 * excerpt. `blocks` are the text blocks that cited them. Sources are seeded from
 * the search results first so that a page the model consulted keeps its real
 * title even when the citation object is the thing that carries the quote.
 */
export const resolveAnthropicCitations = (
  searchResults: any[],
  blocks: AnthropicCitedBlock[],
): MessageCitations => {
  const empty: MessageCitations = { sources: [], citations: [] };
  const sources: GroundingSource[] = [];
  const byUrl = new Map<string, number>();

  const intern = (raw: any): number | null => {
    const source = readAnthropicSource(raw);
    if (!source) return null;
    const key = source.uri || `${source.title}|${source.domain}`;
    const existing = byUrl.get(key);
    if (existing !== undefined) {
      // Merge rather than discard: the search result has the title, the citation
      // has the quote, and they arrive as two separate objects for one page.
      const kept = sources[existing];
      if (!kept.snippet && source.snippet) kept.snippet = source.snippet;
      if (source.title && source.title !== source.domain && kept.title === kept.domain) {
        kept.title = source.title;
      }
      return existing;
    }
    const next = sources.length;
    byUrl.set(key, next);
    sources.push(source);
    return next;
  };

  for (const result of Array.isArray(searchResults) ? searchResults : []) {
    if (result?.type && result.type !== 'web_search_result') continue;
    intern(result);
  }

  const citations: GroundingCitation[] = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || block.end <= block.start || !Array.isArray(block.citations)) continue;
    const sourceIndices: number[] = [];
    for (const citation of block.citations) {
      if (citation?.type && citation.type !== 'web_search_result_location') continue;
      const index = intern(citation);
      if (index !== null && !sourceIndices.includes(index)) sourceIndices.push(index);
    }
    if (!sourceIndices.length) continue;
    citations.push({ startIndex: block.start, endIndex: block.end, sourceIndices });
  }

  // A search that ran but produced no citation leaves nothing to anchor a chip
  // to. Returning the sources anyway would render chips over no text.
  if (!citations.length) return empty;
  citations.sort((a, b) => a.endIndex - b.endIndex || a.startIndex - b.startIndex);
  return { sources, citations };
};
