/**
 * Turn an uploaded file into text a model can be grounded on.
 *
 * ── Why this runs in the browser ───────────────────────────────────────────
 *
 * `services/agent-builder` already extracts PDF and DOCX server-side (see
 * `src/rag/extractText.ts`) and it is mounted same-origin in dev, so routing
 * uploads through it was the obvious alternative. It was not taken: notebooks are
 * documented to work with **nothing else connected** — no local folder, no
 * backend — and posting every upload to a service would make "add a source" fail
 * on a profile that has never started one. The registry is scoped localStorage for
 * the same reason.
 *
 * So extraction happens here, and the heavy parsers are loaded only when a file
 * that needs them actually arrives.
 *
 * ── The parsers ───────────────────────────────────────────────────────────
 *
 * `pdfjs-dist` for PDF, `mammoth` for DOCX. Both are dynamically imported inside
 * the branch that needs them, so a notebook of plain `.md` files never downloads
 * either: pdf.js alone is ~1MB with its worker.
 *
 * ── What extraction can and cannot do ─────────────────────────────────────
 *
 * pdf.js returns the text layer. A PDF that has one — anything produced by a word
 * processor or a LaTeX toolchain — comes out clean. A **scanned** PDF is a series
 * of images with no text layer, and there is no OCR here, so it comes back empty.
 * That is reported as such rather than stored as a blank source, because a source
 * that is silently empty is worse than one that says it could not be read: the
 * grounding block would list it as available and the model would fill the gap.
 */

/**
 * Fetch a website's text through `/api/fetch-source`.
 *
 * A browser cannot read a cross-origin page, so this is the one source type that
 * genuinely needs a server. Gemini does the same thing — its docs describe a URL
 * being scraped when it is added and stored as a static copy, text only.
 *
 * Returns `null` rather than throwing when the endpoint is absent or refuses:
 * that is the expected state on a static deployment with no functions, and the
 * caller stores the source as link-only, which is what it did for every URL
 * before this existed. A reason comes back with it so the dialog can say why.
 */
export const fetchWebsiteText = async (
  url: string,
): Promise<{ title?: string; text?: string; problem?: string }> => {
  try {
    const response = await fetch(`/api/fetch-source?url=${encodeURIComponent(url)}`);
    /*
     * A 404 means no endpoint — a static host, or the function not deployed. Said
     * differently from a refusal so the user can tell "not available here" from
     * "that page would not load".
     */
    if (response.status === 404) {
      return { problem: 'link saved; page text needs the fetch endpoint, which is not available here' };
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.text) {
      return { problem: payload?.error ? `link saved — ${payload.error}` : 'link saved; the page could not be read' };
    }
    return {
      title: typeof payload.title === 'string' ? payload.title : undefined,
      text: payload.text,
      problem: payload.truncated ? 'page text was truncated' : undefined,
    };
  } catch {
    return { problem: 'link saved; the page could not be reached' };
  }
};

/** Extracted text plus how it was obtained, for the UI to report honestly. */
export interface ExtractionResult {
  text: string;
  /** Which parser ran, or why none did. */
  via: 'text' | 'pdf' | 'docx' | 'none';
  /** Pages, for a PDF — used in the source's meta line. */
  pages?: number;
  /**
   * Set when a parser ran but found nothing usable. The caller stores the source
   * WITHOUT content and surfaces this, rather than pretending the file is empty.
   */
  problem?: string;
}

const TEXT_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.h', '.cpp', '.cs',
  '.sh', '.sql', '.css', '.scss', '.log', '.ini', '.toml', '.env', '.srt', '.vtt',
];

export const isTextFile = (file: File): boolean => {
  if (file.type.startsWith('text/')) return true;
  if (/^application\/(json|xml|x-yaml|javascript|typescript)/.test(file.type)) return true;
  const lower = file.name.toLowerCase();
  return TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension));
};

const isPdf = (file: File): boolean =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

const isDocx = (file: File): boolean =>
  file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  || file.name.toLowerCase().endsWith('.docx');

/** True for any file this module can turn into text. */
export const isExtractable = (file: File): boolean =>
  isTextFile(file) || isPdf(file) || isDocx(file);

/**
 * Cap on stored text per source, in characters.
 *
 * Sources live in localStorage, whose quota is a few megabytes for the whole
 * origin — and this feature shares it with the notebook registry, media index and
 * chat metadata. A 400-page PDF runs to well over a million characters, so
 * storing one whole would evict everything else. 400k is roughly 100k tokens: far
 * more than any single turn will use once retrieval selects from it, and small
 * enough that several sources coexist.
 */
export const MAX_STORED_CHARS = 400_000;

const capped = (text: string): { text: string; truncated: boolean } => {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= MAX_STORED_CHARS) return { text: normalized, truncated: false };
  return { text: normalized.slice(0, MAX_STORED_CHARS), truncated: true };
};

const readAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });

/**
 * PDF text, page by page.
 *
 * Items are joined with spaces and pages with blank lines. pdf.js hands back
 * positioned text runs rather than lines, so some layouts (multi-column papers,
 * tables) interleave — acceptable for grounding, where the model reads prose, and
 * not worth reconstructing layout for.
 *
 * Each page is released with `page.cleanup()` as it is consumed; without it a
 * large document holds every rasterised page in memory at once.
 */
const extractPdf = async (file: File): Promise<ExtractionResult> => {
  const pdfjs = await import('pdfjs-dist');
  /*
   * The worker is addressed by URL through Vite's `?url` suffix rather than by
   * copying a file into `public/`. pdf.js will otherwise try to fetch a worker
   * from a path that does not exist in this build and fall back to running the
   * parse on the main thread, which freezes the UI on a large document.
   */
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = new Uint8Array(await file.arrayBuffer());
  /*
   * The LOADING TASK is what gets destroyed, not the document — `PDFDocumentProxy`
   * has no `destroy`. Holding the task is the only way to release the worker and
   * the transport when the parse finishes or throws.
   */
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/[ \t]+/g, ' ')
          .trim();
        if (text) pages.push(text);
      } finally {
        page.cleanup();
      }
    }
    const joined = pages.join('\n\n');
    if (!joined.trim()) {
      return {
        text: '',
        via: 'pdf',
        pages: doc.numPages,
        problem: `no text layer found across ${doc.numPages} page${doc.numPages === 1 ? '' : 's'} — this looks like a scanned PDF, and there is no OCR here`,
      };
    }
    const { text, truncated } = capped(joined);
    return {
      text,
      via: 'pdf',
      pages: doc.numPages,
      problem: truncated ? `text truncated at ${MAX_STORED_CHARS.toLocaleString()} characters` : undefined,
    };
  } finally {
    await loadingTask.destroy();
  }
};

const extractDocx = async (file: File): Promise<ExtractionResult> => {
  // The browser build, not the package root: the default entry pulls in Node's
  // `fs` and fails to bundle.
  const mammoth = await import('mammoth/mammoth.browser.js');
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const { text, truncated } = capped(result.value ?? '');
  if (!text) return { text: '', via: 'docx', problem: 'the document had no extractable text' };
  return {
    text,
    via: 'docx',
    problem: truncated ? `text truncated at ${MAX_STORED_CHARS.toLocaleString()} characters` : undefined,
  };
};

/**
 * Extract what text this file can yield.
 *
 * Never throws for an unsupported type — returns `via: 'none'` with a reason, so
 * the caller can still record the source by name. A parser that fails on a file
 * it should have handled DOES reject, because that is a bug or a corrupt file and
 * the user needs to see it.
 */
export const extractSourceText = async (file: File): Promise<ExtractionResult> => {
  if (isTextFile(file)) {
    const { text, truncated } = capped(await readAsText(file));
    return {
      text,
      via: 'text',
      problem: truncated ? `text truncated at ${MAX_STORED_CHARS.toLocaleString()} characters` : undefined,
    };
  }
  if (isPdf(file)) return extractPdf(file);
  if (isDocx(file)) return extractDocx(file);
  return {
    text: '',
    via: 'none',
    problem: `${file.type || 'this file type'} cannot be read as text here`,
  };
};
