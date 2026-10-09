/**
 * The prose canvas's two-way bridge: Markdown <-> the editor's DOM.
 *
 * A canvas document is stored as Markdown (it is what the model writes and what
 * `.md` export hands back), but Gemini edits it as rich text — headings, bold,
 * lists and equations change in place, with no source view. So the editor shows
 * HTML built from the Markdown, and every edit is serialised back.
 *
 * The HTML side is deliberately small and fixed: `markdownToEditorHtml` emits only
 * the tags `editorDomToMarkdown` reads, plus whatever the browser's own editing
 * commands produce (`<b>`, `<i>`, `<div>` lines), which are normalised on the way
 * back. Math is a non-editable atom carrying its TeX in `data-tex`, so the source
 * survives a round trip that the rendered KaTeX markup never could.
 *
 * `editorDomToMarkdown` reads through `MdNode`, a four-member slice of the DOM, so
 * it runs against real elements in the app and against plain objects in a test.
 */
import katex from 'katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

const PROCESSOR = unified().use(remarkParse).use(remarkGfm).use(remarkMath).freeze();

/** `\(…\)` and `\[…\]` as `$…$` and `$$…$$`, outside code — models write both spellings. */
export const normalizeMathDelimiters = (source: string): string => {
  const parts = source.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, index) => (index % 2 === 1
      ? part
      : part
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => `$$${tex}$$`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => `$${tex}$`)))
    .join('');
};

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const safeHref = (href: string | undefined): string => {
  const value = String(href ?? '').trim();
  return /^(https?:|mailto:|#|\/)/i.test(value) ? value : '';
};

/** KaTeX markup for an equation; the raw TeX when it does not parse, so nothing is lost. */
export const renderTex = (tex: string, display: boolean): string => {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      output: 'htmlAndMathml',
      strict: 'ignore',
      throwOnError: false,
      trust: false,
    });
  } catch {
    return escapeHtml(tex);
  }
};

export const mathAtomHtml = (tex: string, display: boolean): string => {
  const tag = display ? 'div' : 'span';
  return `<${tag} class="cv-math${display ? ' cv-math--block' : ''}" data-tex="${escapeHtml(tex)}"${
    display ? ' data-display="true"' : ''
  } contenteditable="false">${renderTex(tex, display)}</${tag}>`;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mdast = any;

const inlineHtml = (nodes: Mdast[] = []): string => nodes.map((node) => {
  switch (node.type) {
    case 'text': return escapeHtml(node.value);
    case 'strong': return `<strong>${inlineHtml(node.children)}</strong>`;
    case 'emphasis': return `<em>${inlineHtml(node.children)}</em>`;
    case 'delete': return `<s>${inlineHtml(node.children)}</s>`;
    case 'inlineCode': return `<code>${escapeHtml(node.value)}</code>`;
    case 'break': return '<br>';
    case 'inlineMath': return mathAtomHtml(node.value, false);
    case 'link': {
      const href = safeHref(node.url);
      const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
      return href
        ? `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noreferrer">${inlineHtml(node.children)}</a>`
        : inlineHtml(node.children);
    }
    case 'image': {
      const src = safeHref(node.url);
      return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(node.alt || '')}">` : escapeHtml(node.alt || '');
    }
    case 'footnoteReference': return escapeHtml(`[^${node.identifier}]`);
    case 'html': return escapeHtml(node.value);
    default: return node.children ? inlineHtml(node.children) : escapeHtml(node.value ?? '');
  }
}).join('');

const listItemHtml = (item: Mdast, spread: boolean): string => {
  const checked = typeof item.checked === 'boolean' ? ` data-checked="${item.checked}"` : '';
  const inner = (item.children || []).map((child: Mdast) => (
    child.type === 'paragraph' && !spread ? inlineHtml(child.children) : blockHtml(child)
  )).join('');
  return `<li${checked}>${inner || '<br>'}</li>`;
};

const blockHtml = (node: Mdast): string => {
  switch (node.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, node.depth));
      return `<h${level}>${inlineHtml(node.children) || '<br>'}</h${level}>`;
    }
    case 'paragraph': return `<p>${inlineHtml(node.children) || '<br>'}</p>`;
    case 'blockquote': return `<blockquote>${(node.children || []).map(blockHtml).join('')}</blockquote>`;
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      const start = node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : '';
      return `<${tag}${start}>${(node.children || []).map((item: Mdast) => listItemHtml(item, !!node.spread)).join('')}</${tag}>`;
    }
    case 'code': {
      const lang = node.lang ? ` data-lang="${escapeHtml(node.lang)}"` : '';
      return `<pre${lang}><code>${escapeHtml(node.value)}</code></pre>`;
    }
    case 'thematicBreak': return '<hr>';
    case 'math': return mathAtomHtml(node.value, true);
    case 'table': {
      const align: (string | null)[] = node.align || [];
      const rows: Mdast[] = node.children || [];
      const cell = (tag: string, c: Mdast, i: number) => `<${tag}${align[i] ? ` data-align="${align[i]}"` : ''}>${inlineHtml(c.children)}</${tag}>`;
      const head = rows[0] ? `<thead><tr>${(rows[0].children || []).map((c: Mdast, i: number) => cell('th', c, i)).join('')}</tr></thead>` : '';
      const body = rows.slice(1).map((r) => `<tr>${(r.children || []).map((c: Mdast, i: number) => cell('td', c, i)).join('')}</tr>`).join('');
      return `<table>${head}<tbody>${body}</tbody></table>`;
    }
    case 'html': return `<p>${escapeHtml(node.value)}</p>`;
    case 'footnoteDefinition':
      return `<p>${escapeHtml(`[^${node.identifier}]: `)}${(node.children || []).map((c: Mdast) => (c.type === 'paragraph' ? inlineHtml(c.children) : '')).join(' ')}</p>`;
    case 'definition': return `<p>${escapeHtml(`[${node.label || node.identifier}]: ${node.url}`)}</p>`;
    default: return node.children ? `<p>${inlineHtml(node.children)}</p>` : '';
  }
};

/** The editor's starting DOM for a Markdown document. An empty document is one empty paragraph. */
export const markdownToEditorHtml = (markdown: string): string => {
  const tree = PROCESSOR.parse(normalizeMathDelimiters(markdown || ''));
  const html = (tree.children || []).map(blockHtml).join('');
  return html || '<p><br></p>';
};

/* ------------------------------------------------------------------ DOM -> Markdown */

/** The slice of a DOM node the serialiser reads. Real elements satisfy it; so does a test's object. */
export interface MdNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<MdNode>;
  getAttribute?: (name: string) => string | null;
}

const ELEMENT = 1;
const TEXT = 3;
const tagOf = (node: MdNode) => node.nodeName.toLowerCase();
const attr = (node: MdNode, name: string) => (node.getAttribute ? node.getAttribute(name) : null);
const kids = (node: MdNode): MdNode[] => Array.from(node.childNodes || []);

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'table', 'thead', 'tbody', 'tr']);
const isMathBlock = (node: MdNode) => node.nodeType === ELEMENT && attr(node, 'data-display') === 'true' && attr(node, 'data-tex') !== null;
const isBlock = (node: MdNode) => node.nodeType === ELEMENT && (BLOCK_TAGS.has(tagOf(node)) || isMathBlock(node));

/** Escape what would otherwise turn plain text into syntax. Line-start markers are handled per block. */
const escapeText = (value: string): string => value
  .replace(/\u00a0/g, ' ')
  .replace(/\\/g, '\\\\')
  .replace(/([*_`[\]$~<])/g, '\\$1');

const escapeLineStart = (line: string): string => line
  .replace(/^(\s*)([#>+=-])/, '$1\\$2')
  .replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3');

const wrap = (marker: string, inner: string): string => {
  if (!inner.trim()) return inner;
  // Markers cannot hug whitespace in CommonMark, so it moves outside them.
  const lead = inner.match(/^\s*/)?.[0] ?? '';
  const trail = inner.match(/\s*$/)?.[0] ?? '';
  return `${lead}${marker}${inner.trim()}${marker}${trail}`;
};

const codeSpan = (value: string): string => {
  const runs = value.match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(0, ...runs.map((r) => r.length)) + 1);
  const pad = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${value}${pad}${fence}`;
};

const inlineMd = (nodes: MdNode[]): string => nodes.map((node) => {
  if (node.nodeType === TEXT) return escapeText((node.textContent || '').replace(/[\r\n]+/g, ' '));
  if (node.nodeType !== ELEMENT) return '';
  const tex = attr(node, 'data-tex');
  if (tex !== null) return attr(node, 'data-display') === 'true' ? `$$${tex}$$` : `$${tex}$`;
  switch (tagOf(node)) {
    case 'strong': case 'b': return wrap('**', inlineMd(kids(node)));
    case 'em': case 'i': return wrap('*', inlineMd(kids(node)));
    case 's': case 'del': case 'strike': return wrap('~~', inlineMd(kids(node)));
    case 'code': return codeSpan(node.textContent || '');
    case 'br': return '\\\n';
    case 'a': {
      const href = attr(node, 'href') || '';
      const title = attr(node, 'title');
      const text = inlineMd(kids(node));
      return href ? `[${text}](${href}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})` : text;
    }
    case 'img': return `![${(attr(node, 'alt') || '').replace(/[[\]]/g, '')}](${attr(node, 'src') || ''})`;
    case 'input': return '';
    default: return inlineMd(kids(node));
  }
}).join('');

/** Inline Markdown for a block's direct inline content, trailing hard breaks dropped. */
const lineOf = (nodes: MdNode[]): string => inlineMd(nodes).replace(/(\\\n)+$/, '').replace(/[ \t]+$/gm, '');

const indent = (text: string, by: string): string => text.split('\n').map((line, i) => (i === 0 || !line ? line : by + line)).join('\n');

const listMd = (list: MdNode, ordered: boolean): string => {
  const items = kids(list).filter((n) => n.nodeType === ELEMENT && tagOf(n) === 'li');
  let n = Number(attr(list, 'start')) || 1;
  return items.map((item) => {
    const marker = ordered ? `${n++}. ` : '- ';
    const checked = attr(item, 'data-checked');
    const task = checked === 'true' ? '[x] ' : checked === 'false' ? '[ ] ' : '';
    const inline: MdNode[] = [];
    const blocks: string[] = [];
    for (const child of kids(item)) {
      if (isBlock(child)) blocks.push(blockMd(child));
      else inline.push(child);
    }
    const head = escapeLineStart(lineOf(inline));
    const body = [head, ...blocks].filter((part) => part !== '').join('\n');
    return marker + task + indent(body, ' '.repeat(marker.length));
  }).join('\n');
};

const tableMd = (table: MdNode): string => {
  const rows: MdNode[] = [];
  const collect = (node: MdNode) => {
    for (const child of kids(node)) {
      if (child.nodeType !== ELEMENT) continue;
      if (tagOf(child) === 'tr') rows.push(child);
      else collect(child);
    }
  };
  collect(table);
  if (!rows.length) return '';
  const cells = rows.map((row) => kids(row).filter((c) => c.nodeType === ELEMENT && /^t[hd]$/.test(tagOf(c))));
  const width = Math.max(...cells.map((r) => r.length));
  const text = (c?: MdNode) => (c ? lineOf(kids(c)).replace(/\|/g, '\\|').replace(/\\\n/g, ' ') : '');
  const align = Array.from({ length: width }, (_, i) => {
    const a = cells[0][i] ? attr(cells[0][i], 'data-align') : null;
    return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
  });
  const line = (row: MdNode[]) => `| ${Array.from({ length: width }, (_, i) => text(row[i])).join(' | ')} |`;
  return [line(cells[0]), `| ${align.join(' | ')} |`, ...cells.slice(1).map(line)].join('\n');
};

const blockMd = (node: MdNode): string => {
  if (isMathBlock(node)) return `$$\n${attr(node, 'data-tex')}\n$$`;
  const tag = tagOf(node);
  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const text = lineOf(kids(node)).replace(/\\\n/g, ' ');
      return text ? `${'#'.repeat(Number(tag[1]))} ${text}` : '';
    }
    case 'ul': return listMd(node, false);
    case 'ol': return listMd(node, true);
    case 'blockquote': {
      const inner = blocksMd(kids(node));
      return inner.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
    }
    case 'pre': {
      const code = (node.textContent || '').replace(/\n$/, '');
      const runs = code.match(/`{3,}/g) || [];
      const fence = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
      return `${fence}${attr(node, 'data-lang') || ''}\n${code}\n${fence}`;
    }
    case 'hr': return '---';
    case 'table': return tableMd(node);
    default: {
      // p, div, li outside a list, anything else block-level: its inline content, unless it holds blocks.
      if (kids(node).some(isBlock)) return blocksMd(kids(node));
      return escapeLineStart(lineOf(kids(node)));
    }
  }
};

/** Blocks separated by a blank line; loose inline runs between blocks become paragraphs. */
const blocksMd = (nodes: MdNode[]): string => {
  const out: string[] = [];
  let run: MdNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const text = escapeLineStart(lineOf(run));
    if (text.trim()) out.push(text);
    run = [];
  };
  for (const node of nodes) {
    if (isBlock(node)) {
      flush();
      const md = blockMd(node);
      if (md.trim()) out.push(md);
    } else {
      run.push(node);
    }
  }
  flush();
  return out.join('\n\n');
};

/** The editor's DOM as Markdown, ending in exactly one newline (or empty). */
export const editorDomToMarkdown = (root: MdNode): string => {
  const md = blocksMd(kids(root)).replace(/\n{3,}/g, '\n\n').trim();
  return md ? `${md}\n` : '';
};

/** Which block the caret is in, for the Styles button's label. */
export type CanvasBlockKind = 'p' | 'h1' | 'h2' | 'h3';

export const CANVAS_BLOCK_LABELS: Record<CanvasBlockKind, string> = {
  p: 'Normal text',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
};
