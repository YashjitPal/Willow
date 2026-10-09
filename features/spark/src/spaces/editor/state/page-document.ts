import { markdownLink } from "../../navigation";
import type { PageActor } from "../../state";

/**
 * Client-side stand-in for the collaborative Page document (a Yjs doc projected into a ProseMirror
 * schema in Codex). Node names follow the page schema (`paragraph`, `heading`, `code_block`, `list`,
 * `ordered_list`, `task_list_item`, `table`, `horizontal_rule`, `callout`, `page_image`, `page_visualization`).
 */
export type PageMark = "bold" | "italic" | "underline" | "strikethrough" | "code";

export interface PageTextRun {
  kind: "text";
  text: string;
  marks?: PageMark[];
  href?: string;
  /** Comment thread anchored on this text (`page-comment-highlight`). */
  threadId?: string;
}

/** `data-page-task-mention` atom: a ChatGPT task or a request sent to a bot. */
export interface PageTaskMentionRun {
  kind: "taskMention";
  mentionId: string;
}

/** `person_mention` atom (`person:<account id>#<mention id>`, title `@Name`). */
export interface PagePersonMentionRun {
  kind: "personMention";
  accountUserId: string;
  mentionId: string;
  title: string;
}

/** `pageReferenceMention` atom (`path` `page://<page id>`); an empty `title` shows the linked Page's own title. */
export interface PagePageReferenceRun {
  kind: "pageReference";
  path: string;
  title: string;
}

export type PageInline = PageTextRun | PageTaskMentionRun | PagePersonMentionRun | PagePageReferenceRun;

export interface PageListItem {
  id: string;
  content: PageInline[];
  /** Set on `task_list_item` rows (checklists). */
  checked?: boolean;
}

/** `pageLayout` attribute on top-level blocks; tables default to `full-width`. */
export type PageBlockLayout = "normal" | "flexible" | "full-width";

/** `table_cell.align` (`text-align`). */
export type PageTableAlign = "left" | "center" | "right";

/** Rich `table_cell` content (one paragraph). Cells of `rows[0]` have `rowIndex` 0 and render as `th`. */
export interface PageTableCell {
  content: PageInline[];
  align?: PageTableAlign;
}

export interface PageTableRow {
  cells: PageTableCell[];
  /** `table_row.pageRowHeight` (`data-page-row-height`). */
  height?: number;
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

interface PageBlockBase {
  id: string;
  layout?: PageBlockLayout;
}

export type PageBlock = PageBlockBase &
  (
    | { type: "paragraph"; content: PageInline[] }
    | { type: "heading"; level: HeadingLevel; content: PageInline[] }
    | { type: "blockquote"; content: PageInline[] }
    | { type: "callout"; emoji: string; content: PageInline[] }
    /** `lang: "codex-prompt"` is the Prompt block readers can send to chat. */
    | { type: "code_block"; lang: string | null; text: string }
    | { type: "horizontal_rule" }
    | { type: "list"; items: PageListItem[]; task?: boolean }
    | { type: "ordered_list"; items: PageListItem[]; start?: number }
    /** `columnWidths`: `pageColumnWidth` per column (the block's `tableWidths` metadata); null until resized or fitted. */
    | { type: "table"; rows: PageTableRow[]; columnWidths?: (number | null)[] }
    | { type: "page_image"; src: string; alt: string }
    | { type: "page_visualization"; fileId: string; title: string; status: "ready" | "generating"; prompt?: string }
  );

export type PageBlockType = PageBlock["type"];

export type TextBlock = Extract<PageBlock, { content: PageInline[] }>;

export interface PageCommentReaction {
  emoji: string;
  reactorIds: string[];
}

export type PageCommentAuthor = { kind: "user"; accountUserId: string } | { kind: "dot"; accountUserId: string; conversationId: string } | { kind: "chatgpt"; accountUserId: string };

export interface PageCommentMessage {
  id: string;
  author: PageCommentAuthor;
  body: PageInline[];
  createdAt: number;
  editedAt?: number;
  deletedAt?: number;
  reactions: PageCommentReaction[];
}

export interface PageCommentThread {
  id: string;
  /** Text the thread is anchored on; `null` once the anchor was deleted ("Original text unavailable"). */
  quote: string | null;
  blockId: string | null;
  state: "open" | "resolved";
  resolvedAt?: number;
  messages: PageCommentMessage[];
  createdAt: number;
}

export type PageTaskMentionStatus = "composing" | "pending" | "started" | "failed";

/** Attributes of a `data-page-task-mention` atom (`PL` in app-initial) plus its client-side status. */
export interface PageTaskMention {
  id: string;
  source: "page" | "comment";
  /** Account that owns the task or the bot. */
  owner: string;
  ownerName?: string;
  /** Task thread once started; `null` while composing or when it failed to start. */
  threadId: string | null;
  /** Present when the mention sends the request to the owner's bot instead of starting a ChatGPT task. */
  orbit?: { threadId: string };
  prompt: string;
  status: PageTaskMentionStatus;
  commentThreadId?: string;
}

/** `Ndr`: the `task:` URL stored in `data-page-task-mention` and in Markdown links. */
export function taskMentionPath(mention: Pick<PageTaskMention, "id" | "owner" | "ownerName" | "threadId" | "orbit" | "source">) {
  const url = new URL(`task:${mention.id}`);
  url.searchParams.set("owner", mention.owner);
  if (mention.ownerName) url.searchParams.set("name", mention.ownerName);
  if (mention.threadId != null) url.searchParams.set("thread", mention.threadId);
  if (mention.orbit != null) url.searchParams.set("orbit", mention.orbit.threadId);
  if (mention.source != null) url.searchParams.set("source", mention.source);
  return url.href;
}

/** `NL`: mention id encoded in a `task:` URL. */
export function taskMentionIdFromPath(path: string) {
  if (!path.startsWith("task:")) return null;
  try {
    return new URL(path).pathname || null;
  } catch {
    return null;
  }
}

/** `Mdr`: leaf text of a task mention atom. */
export function taskMentionLeafText(mention: Pick<PageTaskMention, "orbit"> | undefined) {
  return mention?.orbit == null ? "@Willow" : "@dot";
}

export interface PageBlockAttribution {
  actor: PageActor;
  changedAt: string;
}

export type PageDocumentStatus = "loading" | "ready" | "error";

export interface PageDocument {
  pageId: string;
  status: PageDocumentStatus;
  blocks: PageBlock[];
  threads: PageCommentThread[];
  taskMentions: Record<string, PageTaskMention>;
  attribution: Record<string, PageBlockAttribution>;
}

let idCounter = 0;

export function createPageId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function text(value: string, marks?: PageMark[]): PageTextRun {
  return marks == null ? { kind: "text", text: value } : { kind: "text", text: value, marks };
}

export function isTextBlock(block: PageBlock): block is TextBlock {
  return "content" in block;
}

export function inlinePlainText(content: PageInline[]) {
  return content.map((run) => (run.kind === "text" ? run.text : run.kind === "personMention" ? run.title : "")).join("");
}

/** Like `inlinePlainText`, with Page references serialized as `[title](path)` links. */
function inlineMarkdown(content: PageInline[]) {
  return content.map((run) => (run.kind === "pageReference" ? markdownLink(run.title, run.path) : inlinePlainText([run]))).join("");
}

export function emptyParagraph(): PageBlock {
  return { id: createPageId("block"), type: "paragraph", content: [] };
}

export function blockPlainText(block: PageBlock): string {
  if (isTextBlock(block)) return inlinePlainText(block.content);
  if (block.type === "list" || block.type === "ordered_list") return block.items.map((item) => inlinePlainText(item.content)).join("\n");
  if (block.type === "code_block") return block.text;
  if (block.type === "table") return block.rows.map((row) => row.cells.map((cell) => inlinePlainText(cell.content)).join("\t")).join("\n");
  return "";
}

function tableCellMarkdown(cell: PageTableCell) {
  return inlineMarkdown(cell.content).replace(/\|/g, "\\|");
}

function tableAlignRule(align: PageTableAlign | undefined) {
  return align === "center" ? ":---:" : align === "right" ? "---:" : align === "left" ? ":---" : "---";
}

/** Markdown used by "Copy as Markdown" and the bot request preview. */
export function blockToMarkdown(block: PageBlock): string {
  switch (block.type) {
    case "paragraph":
      return inlineMarkdown(block.content);
    case "heading":
      return `${"#".repeat(block.level)} ${inlineMarkdown(block.content)}`;
    case "blockquote":
      return `> ${inlineMarkdown(block.content)}`;
    case "callout":
      return `> ${block.emoji} ${inlineMarkdown(block.content)}`;
    case "code_block":
      return `\`\`\`${block.lang ?? ""}\n${block.text}\n\`\`\``;
    case "horizontal_rule":
      return "---";
    case "list":
      return block.items.map((item) => `${block.task ? `- [${item.checked ? "x" : " "}] ` : "- "}${inlineMarkdown(item.content)}`).join("\n");
    case "ordered_list":
      return block.items.map((item, index) => `${(block.start ?? 1) + index}. ${inlineMarkdown(item.content)}`).join("\n");
    case "table":
      return block.rows
        .map((row, index) => `| ${row.cells.map(tableCellMarkdown).join(" | ")} |${index === 0 ? `\n| ${row.cells.map((cell) => tableAlignRule(cell.align)).join(" | ")} |` : ""}`)
        .join("\n");
    case "page_image":
      return `![${block.alt}](${block.src})`;
    case "page_visualization":
      return block.title;
  }
}
