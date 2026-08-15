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

/**
 * True when a provider-supplied `type` or `name` names web search, however the
 * endpoint chooses to spell it.
 *
 * Anthropic's own strings are `web_search_tool_result`, `web_search_result` and
 * `web_search_result_location`, and the tool itself carries a dated version
 * suffix (`web_search_20250305`) that changes as the tool evolves. Matching any
 * of those literally is a trap on two fronts: a new tool version renames the
 * strings out from under us, and a gateway that implements the same tool is
 * under no obligation to copy the spelling -- `Web_Search`, `WebSearch`,
 * `web-search` and `websearch` are all things a relay can plausibly emit. An
 * unrecognised block is dropped silently, so the failure is not an error; the
 * search runs, the model answers, and no source card ever renders.
 *
 * So separators and case are discarded before comparing: everything that is not
 * a letter or digit goes, the rest lowercases, and the remainder has to contain
 * `websearch`. That accepts every spelling above and any version suffix, needs
 * nothing configured or stored, and still rejects the neighbouring block types
 * it must not swallow -- `char_location`, `page_location`,
 * `code_execution_tool_result`, `bash_code_execution_tool_result`.
 */
export const namesWebSearch = (value: unknown): boolean =>
  typeof value === 'string'
  && value.replace(/[^a-z0-9]/gi, '').toLowerCase().includes('websearch');

/**
 * True when a `type` names a failure rather than a result.
 *
 * `web_search_tool_result_error` normalises to something containing `websearch`
 * like every success shape does, and it arrives in the same `content` array, so
 * `namesWebSearch` alone would let it through. It carries `error_code` instead of
 * a url, so it would be dropped a step later anyway -- rejecting it by name keeps
 * that from being an accident.
 */
const namesAnError = (value: unknown): boolean =>
  typeof value === 'string' && /error/i.test(value);

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
    // An entry with no `type` is trusted -- not every endpoint sets one. A typed
    // entry has to name web search in some spelling, and must not be the failure
    // object that arrives in this same array.
    if (result?.type && (!namesWebSearch(result.type) || namesAnError(result.type))) continue;
    intern(result);
  }

  const citations: GroundingCitation[] = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || block.end <= block.start || !Array.isArray(block.citations)) continue;
    const sourceIndices: number[] = [];
    for (const citation of block.citations) {
      // Same tolerance as the results above. A document citation (`char_location`,
      // `page_location`) names no search and is correctly skipped -- it carries a
      // document index rather than a url, so it could not fill a source card.
      if (citation?.type && (!namesWebSearch(citation.type) || namesAnError(citation.type))) continue;
      const index = intern(citation);
      if (index !== null && !sourceIndices.includes(index)) sourceIndices.push(index);
    }
    if (!sourceIndices.length) continue;
    citations.push({ startIndex: block.start, endIndex: block.end, sourceIndices });
  }

  // Sources without citations are kept, and the distinction matters: chips are
  // driven by `citations` and the sources panel by `sources`, so a search that
  // ran and produced no citation renders the panel and no chips rather than
  // chips over no text. This is the measured case on a relay that returns real
  // `web_search_tool_result` blocks but emits zero `citations_delta` -- the
  // results exist, only the spans are missing, and dropping them lost the whole
  // search rather than just its inline anchors.
  if (!sources.length) return empty;
  citations.sort((a, b) => a.endIndex - b.endIndex || a.startIndex - b.startIndex);
  return { sources, citations };
};

/**
 * Everything search-shaped harvested from one OpenAI-compatible stream.
 *
 * Two buckets because the providers split into two kinds, and the difference is
 * whether a chip can be anchored:
 *
 *  - `annotations` carry character offsets, so they become real inline citations.
 *    OpenAI's Responses API documents `{type: 'url_citation', url, title,
 *    start_index, end_index}` on `output_text`, and xAI's Responses API copies
 *    that shape exactly.
 *  - `sources` are bare lists with no offsets: xAI's chat path returns a flat
 *    `citations` array of URL strings, Zhipu returns a top-level `web_search`
 *    array of `{title, link, content, publish_date, refer}`. There is nothing to
 *    anchor, so these fill the sources panel and produce no chips.
 */
export interface CompatSearchHarvest {
  annotations: any[];
  sources: any[];
}

/** True when a `type` names an OpenAI-style url citation, however it is spelled. */
export const namesUrlCitation = (value: unknown): boolean =>
  typeof value === 'string'
  && value.replace(/[^a-z0-9]/gi, '').toLowerCase().includes('urlcitation');

/**
 * Reads one OpenAI-compatible source entry.
 *
 * Accepts a bare URL string, because xAI's `citations` is a string array, and
 * otherwise tries every field name the four providers use for the same three
 * things. `link` is Zhipu's, `url` is everyone else's; `content` is Zhipu's page
 * excerpt, `cited_text` is Anthropic's wording reused by relays that proxy it.
 */
const readCompatSource = (raw: any): GroundingSource | null => {
  if (typeof raw === 'string') {
    const uri = raw.trim();
    if (!/^https?:\/\//i.test(uri)) return null;
    let domain = '';
    try { domain = new URL(uri).hostname; } catch { return null; }
    return { uri, title: domain, domain };
  }
  if (!raw || typeof raw !== 'object') return null;
  const uri = asString(raw.url) || asString(raw.link) || asString(raw.uri);
  const title = asString(raw.title) || asString(raw.name);
  if (!uri && !title) return null;
  let domain = '';
  try { if (uri) domain = new URL(uri).hostname; } catch { domain = ''; }
  const source: GroundingSource = { uri, title: title || domain, domain };
  const snippet = asString(raw.cited_text) || asString(raw.snippet)
    || asString(raw.content) || asString(raw.description);
  // Capped because Zhipu's `content` is page body rather than an excerpt, and
  // this value is persisted with the message. The card renders two lines; the
  // cap only stops an unbounded blob reaching storage.
  if (snippet) source.snippet = snippet.length > 300 ? `${snippet.slice(0, 300)}…` : snippet;
  return source;
};

/**
 * Converts an OpenAI-compatible harvest into the same `MessageCitations` the
 * Gemini and Anthropic paths produce.
 *
 * Unlike those two this can legitimately return sources with **no** citations,
 * and callers must keep them: for xAI and Zhipu a bare source list is all the
 * provider sends, so dropping it for want of offsets would mean their search
 * never shows anything at all.
 *
 * `start_index`/`end_index` are treated as JS string indices and clamped to the
 * answer. They are documented as indices into the output text; a provider that
 * counts code points rather than UTF-16 units would drift on astral characters,
 * and there is no `cited_text` here to verify against the way the Gemini path
 * does, so the offsets are trusted as sent and only range-checked.
 */
export const resolveCompatCitations = (
  harvest: CompatSearchHarvest,
  answerText: string,
): MessageCitations => {
  const sources: GroundingSource[] = [];
  const byKey = new Map<string, number>();

  const intern = (raw: any): number | null => {
    const source = readCompatSource(raw);
    if (!source) return null;
    const key = source.uri || `${source.title}|${source.domain}`;
    const existing = byKey.get(key);
    if (existing !== undefined) {
      const kept = sources[existing];
      if (!kept.snippet && source.snippet) kept.snippet = source.snippet;
      if (source.title && source.title !== source.domain && kept.title === kept.domain) {
        kept.title = source.title;
      }
      return existing;
    }
    const next = sources.length;
    byKey.set(key, next);
    sources.push(source);
    return next;
  };

  const citations: GroundingCitation[] = [];
  const text = typeof answerText === 'string' ? answerText : '';

  for (const annotation of Array.isArray(harvest?.annotations) ? harvest.annotations : []) {
    if (!annotation || typeof annotation !== 'object') continue;
    // An untyped entry is trusted; a typed one has to name a url citation or web
    // search in some spelling. `file_citation` names neither and is skipped.
    const type = (annotation as any).type;
    if (type && !namesUrlCitation(type) && !namesWebSearch(type)) continue;
    // The payload sits either inline or nested under a key matching the type.
    const body = (annotation as any).url_citation
      || (annotation as any).urlCitation
      || annotation;
    const index = intern(body);
    if (index === null) continue;
    const start = Number((body as any).start_index ?? (body as any).startIndex);
    const end = Number((body as any).end_index ?? (body as any).endIndex);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const from = Math.max(0, Math.min(Math.trunc(start), text.length));
    const to = Math.max(0, Math.min(Math.trunc(end), text.length));
    if (to <= from) continue;
    citations.push({ startIndex: from, endIndex: to, sourceIndices: [index] });
  }

  for (const source of Array.isArray(harvest?.sources) ? harvest.sources : []) intern(source);

  if (!sources.length) return { sources: [], citations: [] };

  // When bare sources are present (the provider/relay sent sources but no annotations array),
  // distribute them paragraph-wise across the response based on keyword relevance so distinct
  // source chips appear on their corresponding sections, just like Gemini.
  const hadAnnotations = Array.isArray(harvest?.annotations) && harvest.annotations.length > 0;
  if (!hadAnnotations && !citations.length && text.length > 0) {
    citations.push(...distributeSourcesAcrossBlocks(text, sources));
  }

  citations.sort((a, b) => a.endIndex - b.endIndex || a.startIndex - b.startIndex);
  return { sources, citations };
};

/**
 * Partitions a text into markdown paragraphs/blocks and associates each source
 * with its most relevant paragraph based on keyword overlap.
 */
function distributeSourcesAcrossBlocks(
  text: string,
  sources: GroundingSource[],
): GroundingCitation[] {
  if (!text.trim() || !sources.length) return [];

  const blocks: { start: number; end: number; text: string }[] = [];
  const lines = text.split('\n');
  let currentOffset = 0;
  let blockStart = -1;
  let blockContent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = currentOffset;
    const lineEnd = currentOffset + line.length;
    currentOffset = lineEnd + 1; // +1 for the \n

    if (line.trim().length === 0) {
      if (blockStart !== -1 && blockContent.trim().length > 0) {
        blocks.push({ start: blockStart, end: lineStart - 1, text: blockContent.trim() });
        blockStart = -1;
        blockContent = '';
      }
    } else {
      if (blockStart === -1) {
        blockStart = lineStart;
      }
      blockContent += (blockContent ? '\n' : '') + line;
    }
  }

  if (blockStart !== -1 && blockContent.trim().length > 0) {
    blocks.push({ start: blockStart, end: text.length, text: blockContent.trim() });
  }

  const substantiveBlocks = blocks.filter((b) => b.text.length > 15);
  const targetBlocks = substantiveBlocks.length > 0 ? substantiveBlocks : blocks;

  if (!targetBlocks.length) {
    return [{ startIndex: 0, endIndex: text.length, sourceIndices: sources.map((_, i) => i) }];
  }

  const extractKeywords = (str: string): string[] =>
    str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4);

  const blockWordSets = targetBlocks.map((b) => new Set(extractKeywords(b.text)));
  const blockSourceMap = new Map<number, number[]>();

  sources.forEach((source, sourceIdx) => {
    const sourceWords = extractKeywords(`${source.title} ${source.domain} ${source.snippet || ''}`);
    let bestBlockIdx = -1;
    let maxScore = 0;

    targetBlocks.forEach((_, blockIdx) => {
      const blockWords = blockWordSets[blockIdx];
      let score = 0;
      for (const w of sourceWords) {
        if (blockWords.has(w)) score++;
      }
      if (score > maxScore) {
        maxScore = score;
        bestBlockIdx = blockIdx;
      }
    });

    if (bestBlockIdx === -1 || maxScore === 0) {
      bestBlockIdx = sourceIdx % targetBlocks.length;
    }

    const current = blockSourceMap.get(bestBlockIdx) || [];
    current.push(sourceIdx);
    blockSourceMap.set(bestBlockIdx, current);
  });

  const citations: GroundingCitation[] = [];
  for (let i = 0; i < targetBlocks.length; i++) {
    const sourceIndices = blockSourceMap.get(i);
    if (sourceIndices && sourceIndices.length > 0) {
      citations.push({
        startIndex: targetBlocks[i].start,
        endIndex: targetBlocks[i].end,
        sourceIndices,
      });
    }
  }

  return citations.length > 0
    ? citations
    : [{ startIndex: 0, endIndex: text.length, sourceIndices: sources.map((_, i) => i) }];
}
