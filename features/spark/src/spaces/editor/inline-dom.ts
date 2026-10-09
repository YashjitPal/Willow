import { taskMentionIdFromPath, taskMentionPath, type PageInline, type PageMark, type PageTaskMention, type PageTextRun } from "./state/page-document";

const markTags: Record<PageMark, string> = { code: "code", bold: "strong", italic: "em", underline: "u", strikethrough: "s" };
const markOrder: PageMark[] = ["bold", "italic", "underline", "strikethrough", "code"];
const tagMarks: Record<string, PageMark> = { STRONG: "bold", B: "bold", EM: "italic", I: "italic", U: "underline", S: "strikethrough", DEL: "strikethrough", STRIKE: "strikethrough", CODE: "code" };

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** `Tr`: only web, mail and phone links render as `href`. */
export function safeHref(href: string) {
  try {
    const { protocol } = new URL(href, "https://collaborative-editor.invalid");
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:" || protocol === "tel:" ? href : null;
  } catch {
    return null;
  }
}

export function personMentionPath(accountUserId: string, mentionId: string) {
  return `person:${encodeURIComponent(accountUserId)}#${mentionId}`;
}

function renderTextRun(run: PageTextRun) {
  let html = escapeHtml(run.text);
  const marks = markOrder.filter((mark) => run.marks?.includes(mark));
  for (const mark of [...marks].reverse()) html = `<${markTags[mark]}>${html}</${markTags[mark]}>`;
  if (run.href != null) {
    const href = safeHref(run.href);
    html = `<a${href == null ? "" : ` href="${escapeHtml(href)}"`}>${html}</a>`;
  }
  if (run.threadId != null) {
    const id = escapeHtml(run.threadId);
    html = `<span class="page-comment-highlight" aria-hidden="true" data-markdown-copy="exclude"></span><span class="cursor-interaction" data-page-comment-thread="${id}">${html}</span>`;
  }
  return html;
}

const trailingBreak = '<br class="ProseMirror-trailingBreak">';

function isTrailingBreak(node: Node) {
  return node instanceof HTMLBRElement && node.classList.contains("ProseMirror-trailingBreak");
}

const atomSelector = "[data-page-task-mention], [person-mention-path], [page-reference-mention-path]";

/** HTML for one editable unit; task mention and Page reference atoms are empty hosts that React portals fill. */
export function renderInlineHtml(content: PageInline[], mentions: Record<string, PageTaskMention>) {
  const last = content[content.length - 1];
  const needsBreak = last == null || (last.kind === "text" && last.text.endsWith("\n"));
  return (
    content
      .map((run) => {
      if (run.kind === "text") return renderTextRun(run);
      if (run.kind === "personMention") {
        const path = escapeHtml(personMentionPath(run.accountUserId, run.mentionId));
        return `<span class="font-semibold" contenteditable="false" person-mention-path="${path}" person-mention-title="${escapeHtml(run.title)}">${escapeHtml(run.title.slice(1))}</span>`;
      }
      if (run.kind === "pageReference") {
        return `<span contenteditable="false" page-reference-mention-path="${escapeHtml(run.path)}" page-reference-mention-title="${escapeHtml(run.title)}"></span>`;
      }
      const mention = mentions[run.mentionId];
      const path = mention == null ? `task:${run.mentionId}` : taskMentionPath(mention);
      return `<span data-page-task-mention="${escapeHtml(path)}" contenteditable="false"></span>`;
      })
      .join("")
      .replace(/\n/g, "<br>") + (needsBreak ? trailingBreak : "")
  );
}

/** HTML for a plain-text unit (code block, table cell); newlines stay literal inside `pre`. */
export function renderPlainHtml(value: string) {
  return escapeHtml(value) + (value === "" || value.endsWith("\n") ? trailingBreak : "");
}

function sameRunFormat(a: PageTextRun, b: PageTextRun) {
  return a.href === b.href && a.threadId === b.threadId && (a.marks ?? []).join() === (b.marks ?? []).join();
}

function pushText(out: PageInline[], run: PageTextRun) {
  if (run.text === "") return;
  const previous = out[out.length - 1];
  if (previous?.kind === "text" && sameRunFormat(previous, run)) {
    out[out.length - 1] = { ...previous, text: previous.text + run.text };
    return;
  }
  out.push(run);
}

interface Format {
  marks: PageMark[];
  href?: string;
  threadId?: string;
}

function walk(node: Node, format: Format, out: PageInline[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = (node.textContent ?? "").replace(/\u200b/g, "");
    pushText(out, { kind: "text", text: value, ...(format.marks.length > 0 ? { marks: [...format.marks] } : {}), ...(format.href == null ? {} : { href: format.href }), ...(format.threadId == null ? {} : { threadId: format.threadId }) });
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  if (node.classList.contains("page-comment-highlight") || isTrailingBreak(node)) return;
  if (node.tagName === "BR") {
    pushText(out, { kind: "text", text: "\n" });
    return;
  }
  const taskPath = node.getAttribute("data-page-task-mention");
  if (taskPath != null) {
    const mentionId = taskMentionIdFromPath(taskPath);
    if (mentionId != null) out.push({ kind: "taskMention", mentionId });
    return;
  }
  const personPath = node.getAttribute("person-mention-path");
  if (personPath != null) {
    const match = /^person:([^#]+)#([^#]+)$/.exec(personPath);
    if (match != null) out.push({ kind: "personMention", accountUserId: decodeURIComponent(match[1]), mentionId: match[2], title: node.getAttribute("person-mention-title") ?? "" });
    return;
  }
  const referencePath = node.getAttribute("page-reference-mention-path");
  if (referencePath != null) {
    out.push({ kind: "pageReference", path: referencePath, title: node.getAttribute("page-reference-mention-title") ?? "" });
    return;
  }
  const next: Format = { ...format, marks: [...format.marks] };
  const mark = tagMarks[node.tagName];
  if (mark != null && !next.marks.includes(mark)) next.marks = markOrder.filter((entry) => entry === mark || next.marks.includes(entry));
  if (node.tagName === "A") next.href = node.getAttribute("href") ?? format.href;
  const threadId = node.getAttribute("data-page-comment-thread");
  if (threadId != null) next.threadId = threadId;
  node.childNodes.forEach((child) => walk(child, next, out));
}

/** Reads an editable unit back into inline runs (marks, links, comment anchors, mentions). */
export function readInline(element: HTMLElement): PageInline[] {
  const out: PageInline[] = [];
  element.childNodes.forEach((child) => walk(child, { marks: [] }, out));
  return out;
}

export function inlineLength(content: PageInline[]) {
  return content.reduce((total, run) => total + (run.kind === "text" ? run.text.length : 1), 0);
}

/** Splits runs at a character offset (atoms count as one character). */
export function splitInline(content: PageInline[], offset: number): [PageInline[], PageInline[]] {
  const before: PageInline[] = [];
  const after: PageInline[] = [];
  let position = 0;
  for (const run of content) {
    const length = run.kind === "text" ? run.text.length : 1;
    if (position + length <= offset) before.push(run);
    else if (position >= offset) after.push(run);
    else if (run.kind === "text") {
      before.push({ ...run, text: run.text.slice(0, offset - position) });
      after.push({ ...run, text: run.text.slice(offset - position) });
    }
    position += length;
  }
  return [before, after];
}

export function concatInline(a: PageInline[], b: PageInline[]) {
  const out: PageInline[] = [];
  for (const run of [...a, ...b]) {
    if (run.kind === "text") pushText(out, run);
    else out.push(run);
  }
  return out;
}

/** Applies or removes a comment anchor over `[from, to)`. */
export function setThreadOnRange(content: PageInline[], from: number, to: number, threadId: string | undefined) {
  const [head, rest] = splitInline(content, from);
  const [middle, tail] = splitInline(rest, to - from);
  const anchored = middle.map((run) => (run.kind === "text" ? { ...run, threadId } : run));
  return concatInline(concatInline(head, anchored), tail);
}

/** Adds a mark over `[from, to)`, or removes it when every text run there already has it. */
export function toggleMark(content: PageInline[], from: number, to: number, mark: PageMark) {
  const [head, rest] = splitInline(content, from);
  const [middle, tail] = splitInline(rest, to - from);
  const textRuns = middle.filter((run): run is PageTextRun => run.kind === "text");
  const active = textRuns.length > 0 && textRuns.every((run) => run.marks?.includes(mark));
  const toggled = middle.map((run) => {
    if (run.kind !== "text") return run;
    const marks = active ? (run.marks ?? []).filter((entry) => entry !== mark) : markOrder.filter((entry) => entry === mark || run.marks?.includes(entry));
    return { ...run, marks: marks.length === 0 ? undefined : marks };
  });
  return concatInline(concatInline(head, toggled), tail);
}

export function removeThread(content: PageInline[], threadId: string) {
  return concatInline(
    [],
    content.map((run) => (run.kind === "text" && run.threadId === threadId ? { ...run, threadId: undefined } : run)),
  );
}

export function inlineText(content: PageInline[]) {
  return content.map((run) => (run.kind === "text" ? run.text : "")).join("");
}

/** Caret offset (atoms count as one) of a DOM point inside `element`. */
export function offsetInElement(element: HTMLElement, node: Node, nodeOffset: number) {
  let offset = 0;
  let done = false;
  const visit = (current: Node) => {
    if (done) return;
    if (current === node && current.nodeType === Node.TEXT_NODE) {
      offset += Math.min(nodeOffset, (current.textContent ?? "").replace(/\u200b/g, "").length);
      done = true;
      return;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      offset += (current.textContent ?? "").replace(/\u200b/g, "").length;
      return;
    }
    if (!(current instanceof HTMLElement)) return;
    if (current.classList.contains("page-comment-highlight") || isTrailingBreak(current)) return;
    const atom = current.matches(atomSelector);
    if (current === node) {
      const children = Array.from(current.childNodes);
      for (let index = 0; index < nodeOffset && index < children.length; index += 1) visit(children[index]);
      done = true;
      return;
    }
    if (atom) {
      if (current.contains(node)) {
        done = true;
        return;
      }
      offset += 1;
      return;
    }
    if (current.tagName === "BR") {
      offset += 1;
      return;
    }
    current.childNodes.forEach(visit);
  };
  if (element === node) {
    const children = Array.from(element.childNodes);
    for (let index = 0; index < nodeOffset && index < children.length; index += 1) visit(children[index]);
    return offset;
  }
  element.childNodes.forEach(visit);
  return offset;
}

/** DOM point for a caret offset inside `element` (inverse of `offsetInElement`). */
export function pointInElement(element: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = offset;
  let result: { node: Node; offset: number } | null = null;
  const visit = (current: Node): boolean => {
    if (current.nodeType === Node.TEXT_NODE) {
      const length = (current.textContent ?? "").length;
      if (remaining <= length) {
        result = { node: current, offset: remaining };
        return true;
      }
      remaining -= length;
      return false;
    }
    if (!(current instanceof HTMLElement) || current.classList.contains("page-comment-highlight") || isTrailingBreak(current)) return false;
    const atom = current.matches(atomSelector) || current.tagName === "BR";
    if (atom) {
      const parent = current.parentNode as Node;
      const index = Array.from(parent.childNodes).indexOf(current as ChildNode);
      if (remaining === 0) {
        result = { node: parent, offset: index };
        return true;
      }
      remaining -= 1;
      if (remaining === 0) {
        result = { node: parent, offset: index + 1 };
        return true;
      }
      return false;
    }
    for (const child of Array.from(current.childNodes)) if (visit(child)) return true;
    return false;
  };
  for (const child of Array.from(element.childNodes)) if (visit(child)) break;
  return result ?? { node: element, offset: element.childNodes.length };
}
