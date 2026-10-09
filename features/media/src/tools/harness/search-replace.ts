/**
 * SEARCH/REPLACE edits.
 *
 *     <<<<<<< SEARCH
 *       const [tasks, setTasks] = useState([]);
 *     =======
 *       const [tasks, setTasks] = useLocalStorage('tasks', []);
 *     >>>>>>> REPLACE
 *
 * The format models reproduce most reliably, because it is everywhere in their
 * training data as a merge conflict. What they get wrong is the SEARCH text:
 * the shape is right and the whitespace is not, or a blank line went missing.
 * So matching climbs a ladder, stopping at the first rung that finds exactly one
 * region — strict enough that a match is the region the model meant:
 *
 * 1. whole lines, exactly;
 * 2. whole lines, ignoring trailing whitespace;
 * 3. whole lines, ignoring indentation — and the replacement is re-indented by
 *    the same amount, so the fix lands at the file's own indentation;
 * 4. whole lines, ignoring blank lines;
 * 5. an exact substring, when it occurs once (a SEARCH of part of a line).
 *
 * When nothing matches, the error names the closest region with line numbers,
 * which is what lets a model fix its SEARCH in one more try instead of three.
 */

export interface SearchReplaceBlock {
  search: string;
  replace: string;
}

export interface ParsedEdit {
  blocks: SearchReplaceBlock[];
  /** Set when the body could not be read as SEARCH/REPLACE blocks at all. */
  error?: string;
}

const SEARCH_MARKER = /^[ \t]*(?:<{5,9}|-{5,9})[ \t]*SEARCH[ \t]*$/i;
const DIVIDER = /^[ \t]*={5,9}[ \t]*$/;
const REPLACE_MARKER = /^[ \t]*(?:>{5,9}|\+{5,9})[ \t]*REPLACE[ \t]*$/i;
const FENCE = /^[ \t]*```[\w+.-]*[ \t]*$/;

export function parseSearchReplace(body: string): ParsedEdit {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: SearchReplaceBlock[] = [];
  let state: 'outside' | 'search' | 'replace' = 'outside';
  let search: string[] = [];
  let replace: string[] = [];
  let strayText = false;

  for (const line of lines) {
    if (state === 'outside') {
      if (SEARCH_MARKER.test(line)) {
        state = 'search';
        search = [];
        replace = [];
      } else if (line.trim() && !FENCE.test(line)) {
        strayText = true;
      }
      continue;
    }
    if (state === 'search') {
      if (DIVIDER.test(line)) {
        state = 'replace';
      } else if (SEARCH_MARKER.test(line)) {
        // A second SEARCH before a divider: the model restarted the block.
        search = [];
      } else {
        search.push(line);
      }
      continue;
    }
    if (REPLACE_MARKER.test(line)) {
      blocks.push({ search: search.join('\n'), replace: replace.join('\n') });
      state = 'outside';
      continue;
    }
    if (SEARCH_MARKER.test(line)) {
      // REPLACE ran straight into the next SEARCH.
      blocks.push({ search: search.join('\n'), replace: replace.join('\n') });
      state = 'search';
      search = [];
      replace = [];
      continue;
    }
    replace.push(line);
  }

  // The body ended inside REPLACE: the closing marker was forgotten.
  if (state === 'replace') {
    while (replace.length > 0 && (replace[replace.length - 1]!.trim() === '' || FENCE.test(replace[replace.length - 1]!))) {
      replace.pop();
    }
    blocks.push({ search: search.join('\n'), replace: replace.join('\n') });
  }

  if (blocks.length === 0) {
    return {
      blocks,
      error: strayText
        ? 'This edit has no SEARCH/REPLACE blocks. Each change needs `<<<<<<< SEARCH`, the exact current lines, `=======`, the new lines, and `>>>>>>> REPLACE`. To replace the whole file, use <willow-write> instead.'
        : 'This edit is empty.',
    };
  }
  return { blocks };
}

export interface EditFailure {
  /** 1-based, as the model would count its blocks. */
  index: number;
  message: string;
}

export interface EditResult {
  content: string;
  applied: number;
  failures: EditFailure[];
  /** True when some block needed a looser rung than an exact match. */
  fuzzy: boolean;
}

interface Match {
  start: number;
  end: number;
  rung: number;
  /** Matched with indentation ignored, so the replacement needs re-indenting. */
  reindent?: boolean;
}

const leading = (line: string): string => /^[ \t]*/.exec(line)![0];

function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

function findLineMatch(
  fileLines: string[],
  searchLines: string[],
  from: number,
  normalize: (line: string) => string,
): number {
  const target = searchLines.map(normalize);
  const scan = (start: number, stop: number): number => {
    for (let i = start; i + target.length <= stop; i += 1) {
      let ok = true;
      for (let k = 0; k < target.length; k += 1) {
        if (normalize(fileLines[i + k]!) !== target[k]) {
          ok = false;
          break;
        }
      }
      if (ok) return i;
    }
    return -1;
  };
  const after = scan(from, fileLines.length);
  return after !== -1 ? after : scan(0, Math.min(fileLines.length, from + target.length - 1));
}

/** Rung 4: the non-blank lines of SEARCH, matched in order with blank lines skipped. */
function findIgnoringBlankLines(fileLines: string[], searchLines: string[], from: number): { start: number; end: number } | null {
  const wanted = searchLines.map((line) => line.trim()).filter(Boolean);
  if (wanted.length === 0) return null;
  const tryAt = (start: number): number => {
    let j = start;
    for (const line of wanted) {
      while (j < fileLines.length && fileLines[j]!.trim() === '') j += 1;
      if (j >= fileLines.length || fileLines[j]!.trim() !== line) return -1;
      j += 1;
    }
    return j;
  };
  const order = [...Array(fileLines.length).keys()];
  const sorted = [...order.slice(from), ...order.slice(0, from)];
  for (const start of sorted) {
    if (fileLines[start]!.trim() !== wanted[0]) continue;
    const end = tryAt(start);
    if (end !== -1) return { start, end };
  }
  return null;
}

function locate(fileLines: string[], searchLines: string[], from: number): Match | null {
  const exact = findLineMatch(fileLines, searchLines, from, (line) => line);
  if (exact !== -1) return { start: exact, end: exact + searchLines.length, rung: 1 };

  const trailing = findLineMatch(fileLines, searchLines, from, (line) => line.trimEnd());
  if (trailing !== -1) return { start: trailing, end: trailing + searchLines.length, rung: 2 };

  const indented = findLineMatch(fileLines, searchLines, from, (line) => line.trim());
  if (indented !== -1) return { start: indented, end: indented + searchLines.length, rung: 3, reindent: true };

  const blankless = findIgnoringBlankLines(fileLines, searchLines, from);
  if (blankless) return { ...blankless, rung: 4, reindent: true };

  return null;
}

/**
 * Re-indents a replacement to the file's own indentation.
 *
 * The matched lines say how SEARCH's indentation maps onto the file's — not
 * just an offset ("two spaces short") but a unit ("two-space steps where the
 * file uses four"). Each replacement line's indentation is translated through
 * that map; a level SEARCH never used is extrapolated from the nearest known
 * level at the file's step size.
 */
function reindent(replaceLines: string[], searchLines: string[], matchedLines: string[]): string[] {
  const searchContent = searchLines.filter((line) => line.trim() !== '');
  const fileContent = matchedLines.filter((line) => line.trim() !== '');
  const map = new Map<string, string>();
  for (let k = 0; k < Math.min(searchContent.length, fileContent.length); k += 1) {
    const from = leading(searchContent[k]!);
    if (!map.has(from)) map.set(from, leading(fileContent[k]!));
  }
  if (map.size === 0 || [...map].every(([from, to]) => from === to)) return replaceLines;

  // The file's indentation step per step of SEARCH's, from two distinct levels.
  const levels = [...map].sort(([a], [b]) => a.length - b.length);
  let scale = 1;
  let unit = levels[0]![1].includes('\t') ? '\t' : ' ';
  for (let i = 1; i < levels.length; i += 1) {
    const [lowFrom, lowTo] = levels[0]!;
    const [highFrom, highTo] = levels[i]!;
    if (highFrom.length > lowFrom.length && highTo.length > lowTo.length) {
      scale = (highTo.length - lowTo.length) / (highFrom.length - lowFrom.length);
      unit = highTo.slice(lowTo.length)[0] ?? unit;
      break;
    }
  }

  return replaceLines.map((line) => {
    if (!line.trim()) return line;
    const own = leading(line);
    const body = line.slice(own.length);
    const exact = map.get(own);
    if (exact !== undefined) return exact + body;
    // The deepest known level this line's indentation extends.
    const base = levels.filter(([from]) => own.startsWith(from)).pop();
    if (base) {
      const extra = own.length - base[0].length;
      return base[1] + unit.repeat(Math.max(0, Math.round(extra * scale))) + body;
    }
    // Shallower than anything SEARCH used: shift by the first level's offset.
    const [firstFrom, firstTo] = levels[0]!;
    const delta = firstTo.length - firstFrom.length;
    return (delta >= 0 ? unit.repeat(delta) + own : own.slice(Math.min(own.length, -delta))) + body;
  });
}

/** Similarity of two lines, 0–1, from shared character pairs. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const pair = a.slice(i, i + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const pair = b.slice(i, i + 2);
    const count = pairs.get(pair) ?? 0;
    if (count > 0) {
      shared += 1;
      pairs.set(pair, count - 1);
    }
  }
  return (2 * shared) / (a.length + b.length - 2);
}

/**
 * The region of the file most like a SEARCH that did not match, numbered, so
 * the model can copy the real text.
 */
export function closestRegion(fileLines: string[], searchLines: string[]): string {
  const wanted = searchLines.map((line) => line.trim());
  const counted = wanted.filter(Boolean).length;
  if (fileLines.length === 0) return '(the file is empty)';
  if (counted === 0) return '';
  let best = -1;
  let bestScore = 0;
  const limit = Math.min(fileLines.length, 4_000);
  for (let i = 0; i < limit; i += 1) {
    let score = 0;
    for (let k = 0; k < wanted.length && i + k < fileLines.length; k += 1) {
      const target = wanted[k]!;
      if (target) score += similarity(fileLines[i + k]!.trim(), target);
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  // Only worth showing when the region genuinely resembles what was asked for.
  if (best === -1 || bestScore / counted < 0.45) return '';
  const from = Math.max(0, best - 3);
  const to = Math.min(fileLines.length, best + Math.max(searchLines.length, 1) + 3, from + 40);
  const width = String(to).length;
  return fileLines
    .slice(from, to)
    .map((line, offset) => `${String(from + offset + 1).padStart(width)} | ${line}`)
    .join('\n');
}

/**
 * Applies blocks in order. Blocks that match are applied even when a later one
 * fails, and each failure says exactly which block and why — resending only the
 * failed block is the cheapest recovery there is.
 */
export function applySearchReplace(source: string, blocks: SearchReplaceBlock[], path = 'the file'): EditResult {
  const hadTrailingNewline = source.endsWith('\n');
  let lines = splitLines(source.replace(/\r\n/g, '\n').replace(/\n$/, ''));
  let cursor = 0;
  let applied = 0;
  let fuzzy = false;
  const failures: EditFailure[] = [];

  blocks.forEach((block, position) => {
    const index = position + 1;
    const searchLines = splitLines(block.search.replace(/\r\n/g, '\n'));
    const replaceLines = splitLines(block.replace.replace(/\r\n/g, '\n'));

    if (searchLines.every((line) => line.trim() === '')) {
      if (lines.every((line) => line.trim() === '')) {
        lines = [...replaceLines];
        cursor = lines.length;
        applied += 1;
        return;
      }
      failures.push({
        index,
        message:
          `Block ${index}: SEARCH is empty, but ${path} is not. Include the lines next to where ` +
          'the change goes so it can be placed.',
      });
      return;
    }

    if (block.search === block.replace) {
      applied += 1;
      return;
    }

    let match = locate(lines, searchLines, cursor);

    // Rung 5: part of a line, when that part occurs exactly once.
    if (!match) {
      const joined = lines.join('\n');
      const first = joined.indexOf(block.search);
      if (first !== -1 && joined.indexOf(block.search, first + 1) === -1) {
        const next = joined.slice(0, first) + block.replace + joined.slice(first + block.search.length);
        lines = splitLines(next);
        cursor = splitLines(joined.slice(0, first) + block.replace).length;
        applied += 1;
        fuzzy = true;
        return;
      }
    }

    if (!match) {
      const region = closestRegion(lines, searchLines);
      failures.push({
        index,
        message:
          `Block ${index}: SEARCH did not match ${path}. It must be copied exactly from the file's current contents.` +
          (region ? ` The closest match is:\n${region}` : ''),
      });
      return;
    }

    const replacement = match.reindent
      ? reindent(replaceLines, searchLines, lines.slice(match.start, match.end))
      : replaceLines;
    lines = [...lines.slice(0, match.start), ...replacement, ...lines.slice(match.end)];
    cursor = match.start + replacement.length;
    applied += 1;
    if (match.rung > 1) fuzzy = true;
  });

  let content = lines.join('\n');
  if (hadTrailingNewline || (source === '' && content !== '')) content += '\n';
  return { content, applied, failures, fuzzy };
}
