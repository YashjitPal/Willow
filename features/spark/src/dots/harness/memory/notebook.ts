/**
 * The notebook: the memory a bot curates for itself.
 *
 * Episodes are written by the harness and are lossy by design. The notebook is
 * written by the bot, deliberately, and is always in view — it is where anything
 * the bot must not lose lives: who the user is, the people around them, and
 * above all the commitments in flight, with the ids of the messages they came
 * from. A promise made in March survives into June because it was written here,
 * not because a summary happened to keep it.
 *
 * Files are plain Markdown with fixed purposes, so the notebook stays organised
 * as it grows and the bot can always find where a fact belongs.
 */
import { estimateTokens } from './tokens';
import type { DotNotebookFile } from '../thread/thread-types';
import { formatStamp } from './render';

export interface NotebookFileSpec {
  name: string;
  purpose: string;
}

export const NOTEBOOK_FILES: readonly NotebookFileSpec[] = [
  { name: 'user.md', purpose: 'Who the user is: identity, role, goals, how they like to work and be communicated with, preferences, boundaries.' },
  { name: 'people.md', purpose: 'People in the user’s life and work: who they are, how they relate to the user, what is worth remembering about each.' },
  { name: 'commitments.md', purpose: 'Open loops: what you or the user committed to, who owns it, when it is due, its status, and the ids it came from. Remove items once closed.' },
  { name: 'projects.md', purpose: 'Ongoing projects and priorities, with their current state and next steps.' },
  { name: 'routines.md', purpose: 'Standing arrangements: when and how the user wants updates, recurring work, and anything you do on a schedule.' },
];

export const NOTEBOOK_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}\.md$/;
export const MAX_NOTEBOOK_FILE_CHARS = 16_000;
const MAX_NOTEBOOK_FILES = 16;

const orderOf = (name: string) => {
  const index = NOTEBOOK_FILES.findIndex((spec) => spec.name === name);
  return index === -1 ? NOTEBOOK_FILES.length : index;
};

export const sortedNotebookNames = (notebook: Record<string, DotNotebookFile>): string[] =>
  Object.keys(notebook).sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b));

/**
 * The notebook as the model reads it. When it is over budget, each file is cut
 * proportionally and the bot is told to condense — truncating silently would
 * hide exactly the facts the notebook exists to keep.
 */
export const notebookProjection = (
  notebook: Record<string, DotNotebookFile>,
  budgetTokens: number,
  charsPerToken: number | undefined,
  timeZone: string,
): string => {
  const names = sortedNotebookNames(notebook).filter((name) => notebook[name]!.text.trim());
  const missing = NOTEBOOK_FILES.filter((spec) => !notebook[spec.name]?.text.trim()).map((spec) => spec.name);
  const sections = names.map((name) => ({
    name,
    header: `### ${name} (updated ${formatStamp(notebook[name]!.updatedAt, timeZone)})`,
    text: notebook[name]!.text.trim(),
  }));
  const total = sections.reduce((sum, section) => sum + estimateTokens(section.text, charsPerToken), 0);
  const over = total > budgetTokens;
  const ratio = over ? budgetTokens / total : 1;
  const body = sections.map((section) => {
    if (!over) return `${section.header}\n${section.text}`;
    const keep = Math.max(200, Math.floor(section.text.length * ratio));
    const cut = section.text.length > keep ? `${section.text.slice(0, keep)}\n[… cut to fit; condense this file]` : section.text;
    return `${section.header}\n${cut}`;
  });
  const lines = [...body];
  if (missing.length) lines.push(`Empty so far: ${missing.join(', ')}.`);
  if (over) lines.push(`Your notebook is over its size budget (about ${total.toLocaleString('en-US')} of ${budgetTokens.toLocaleString('en-US')} tokens). Condense it: merge duplicates, drop what is resolved or no longer true.`);
  return lines.join('\n\n');
};

export type NotebookEdit =
  | { action: 'view'; file?: string }
  | { action: 'write'; file: string; content: string }
  | { action: 'append'; file: string; content: string }
  | { action: 'replace'; file: string; old: string; new: string }
  | { action: 'delete'; file: string };

export const parseNotebookEdit = (args: Record<string, unknown>): NotebookEdit => {
  const action = String(args.action ?? 'view');
  const file = typeof args.file === 'string' ? args.file.trim() : undefined;
  const content = typeof args.content === 'string' ? args.content : undefined;
  switch (action) {
    case 'view':
      return { action, file };
    case 'write':
    case 'append':
      if (!file || content === undefined) throw new Error(`"${action}" needs "file" and "content".`);
      return { action, file, content };
    case 'replace':
      if (!file || typeof args.old !== 'string' || typeof args.new !== 'string') throw new Error('"replace" needs "file", "old" and "new".');
      return { action, file, old: args.old, new: args.new };
    case 'delete':
      if (!file) throw new Error('"delete" needs "file".');
      return { action, file };
    default:
      throw new Error(`Unknown action "${action}". Use view, write, append, replace or delete.`);
  }
};

/**
 * Applies an edit and returns the file's new text (null when deleted), or
 * throws with a message the bot can act on.
 */
export const applyNotebookEdit = (
  notebook: Record<string, DotNotebookFile>,
  edit: Exclude<NotebookEdit, { action: 'view' }>,
): string | null => {
  if (!NOTEBOOK_NAME_PATTERN.test(edit.file)) {
    throw new Error(`"${edit.file}" is not a valid notebook file name. Use lowercase words joined by hyphens, ending in .md.`);
  }
  const current = notebook[edit.file]?.text ?? '';
  if (!(edit.file in notebook) && edit.action !== 'delete' && Object.keys(notebook).length >= MAX_NOTEBOOK_FILES) {
    throw new Error(`The notebook already has ${MAX_NOTEBOOK_FILES} files. Fold this into an existing file instead.`);
  }
  let next: string | null;
  switch (edit.action) {
    case 'write':
      next = edit.content.trim();
      break;
    case 'append':
      next = current.trim() ? `${current.trimEnd()}\n${edit.content.trim()}` : edit.content.trim();
      break;
    case 'replace': {
      const count = current.split(edit.old).length - 1;
      if (count === 0) throw new Error(`The text to replace was not found in ${edit.file}. View the file and copy the exact text.`);
      if (count > 1) throw new Error(`The text to replace appears ${count} times in ${edit.file}. Include more surrounding text so it is unique.`);
      next = current.replace(edit.old, edit.new).trim();
      break;
    }
    case 'delete':
      if (NOTEBOOK_FILES.some((spec) => spec.name === edit.file)) {
        next = '';
        break;
      }
      next = null;
      break;
  }
  if (next !== null && next.length > MAX_NOTEBOOK_FILE_CHARS) {
    throw new Error(`${edit.file} would be ${next.length.toLocaleString('en-US')} characters; the limit is ${MAX_NOTEBOOK_FILE_CHARS.toLocaleString('en-US')}. Condense it first.`);
  }
  return next;
};

export const viewNotebook = (notebook: Record<string, DotNotebookFile>, file: string | undefined, timeZone: string): string => {
  if (file) {
    const entry = notebook[file];
    if (!entry) return `${file} does not exist yet.`;
    return `### ${file} (updated ${formatStamp(entry.updatedAt, timeZone)})\n${entry.text || '(empty)'}`;
  }
  const names = sortedNotebookNames(notebook);
  const specs = NOTEBOOK_FILES.map((spec) => `- ${spec.name}${notebook[spec.name]?.text.trim() ? '' : ' (empty)'} — ${spec.purpose}`);
  const extra = names.filter((name) => !NOTEBOOK_FILES.some((spec) => spec.name === name)).map((name) => `- ${name}`);
  return ['Notebook files:', ...specs, ...extra].join('\n');
};
