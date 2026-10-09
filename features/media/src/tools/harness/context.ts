/**
 * What the model is shown about the project and the conversation.
 *
 * ## The project: contents, not just a list
 *
 * Projects built here are small — usually a few dozen files — so the snapshot
 * sends their contents, ranked and within a budget, rather than a bare file
 * list. A model that already has the file it needs edits it straight away; one
 * that has to `read_file` first spends a whole round trip (several seconds and a
 * re-sent conversation) before it can start. Files past the budget are listed so
 * the model knows they exist and can read them on demand.
 *
 * The snapshot states facts and nothing else. An instruction riding along on
 * every message ("create /App.tsx to begin") turns "hi" into a scaffold nobody
 * asked for; only the user's message says what to do.
 *
 * ## The conversation: what was said and what changed
 *
 * Earlier turns go back as their prose plus a one-line record of the files they
 * changed — never the code. The current contents are in the snapshot, so old
 * code would only cost tokens and contradict it.
 */

import { stepsText, type TurnMode, type TurnStep } from './protocol';
import { countLines, isBinaryAsset } from './workspace';

/* ------------------------------------------------------------------------ */
/* The project snapshot                                                      */
/* ------------------------------------------------------------------------ */

export interface SnapshotOptions {
  /** The user's message, so files it names are shown first. */
  prompt: string;
  /** Paths changed by recent turns, which the user is most likely to mean. */
  recentPaths?: string[];
  /** Total characters of file contents. */
  maxChars?: number;
  /** A single file larger than this is listed, not inlined. */
  maxFileChars?: number;
}

const DEFAULT_MAX_CHARS = 140_000;
const DEFAULT_MAX_FILE_CHARS = 36_000;
const MAX_LISTED_PATHS = 400;

const ENTRY_FILES = new Set(['/App.tsx', '/App.jsx', '/src/App.tsx', '/src/App.jsx']);

function mentions(prompt: string, path: string): boolean {
  const lower = prompt.toLowerCase();
  if (lower.includes(path.toLowerCase())) return true;
  const base = path.split('/').pop()!;
  const stem = base.replace(/\.[^.]+$/, '');
  if (stem.length < 3) return false;
  return new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(prompt);
}

function relevance(path: string, contents: string, options: SnapshotOptions, recent: Set<string>): number {
  let score = 0;
  if (mentions(options.prompt, path)) score += 100;
  if (ENTRY_FILES.has(path)) score += 80;
  if (path === '/package.json') score += 70;
  if (recent.has(path)) score += 60;
  if (/\.(css)$/.test(path)) score += 25;
  if (/^\/(src\/)?(components|hooks|lib|utils|pages|views|context|store|types)\//.test(path)) score += 10;
  score -= Math.min(40, contents.length / 2_000);
  return score;
}

export function buildProjectSnapshot(files: Record<string, string>, options: SnapshotOptions): string {
  const paths = Object.keys(files).sort();
  if (paths.length === 0) {
    return '<project>\nThe project is empty: it has no files yet.\n</project>';
  }

  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxFileChars = options.maxFileChars ?? DEFAULT_MAX_FILE_CHARS;
  const recent = new Set(options.recentPaths ?? []);

  const textual = paths.filter((path) => !isBinaryAsset(path, files[path]!));
  const ranked = [...textual].sort(
    (a, b) => relevance(b, files[b]!, options, recent) - relevance(a, files[a]!, options, recent) || a.localeCompare(b),
  );

  const included = new Set<string>();
  let used = 0;
  for (const path of ranked) {
    const size = files[path]!.length;
    if (size > maxFileChars) continue;
    if (used + size > maxChars) continue;
    included.add(path);
    used += size;
  }

  const listing = paths.slice(0, MAX_LISTED_PATHS).map((path) => {
    const contents = files[path]!;
    if (isBinaryAsset(path, contents)) return `${path} (binary asset)`;
    const lines = countLines(contents);
    return `${path} (${lines} line${lines === 1 ? '' : 's'})`;
  });
  if (paths.length > MAX_LISTED_PATHS) listing.push(`…and ${paths.length - MAX_LISTED_PATHS} more`);

  const sections = [
    `<project>`,
    `The project has ${paths.length} file${paths.length === 1 ? '' : 's'}:`,
    ...listing,
  ];

  if (included.size > 0) {
    sections.push('', 'Current contents:');
    for (const path of textual) {
      if (!included.has(path)) continue;
      sections.push(`<file path="${path}">`, files[path]!.replace(/\n$/, ''), '</file>');
    }
  }

  const omitted = textual.filter((path) => !included.has(path));
  if (omitted.length > 0) {
    sections.push(
      '',
      `Not shown above, to save space (read them with read_file if you need them): ${omitted.join(', ')}`,
    );
  }

  sections.push('</project>');
  return sections.join('\n');
}

/* ------------------------------------------------------------------------ */
/* Conversation history                                                      */
/* ------------------------------------------------------------------------ */

export interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  /** Present on assistant messages this harness produced. */
  steps?: TurnStep[];
  /** Plan mode turns keep their whole plan, since "implement it" refers to it. */
  mode?: TurnMode;
  attachments?: { name?: string; type?: string }[];
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface HistoryOptions {
  maxMessages?: number;
  maxChars?: number;
  maxAssistantChars?: number;
  maxUserChars?: number;
}

/** "Edited /App.tsx, /components/Card.tsx; created /hooks/useTimer.ts." */
export function describeChanges(steps: readonly TurnStep[]): string {
  const groups: Record<string, string[]> = { created: [], edited: [], deleted: [], renamed: [] };
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.kind !== 'file' || step.status !== 'done') continue;
    const key = `${step.action}:${step.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (step.action === 'delete') groups.deleted!.push(step.path);
    else if (step.action === 'rename') groups.renamed!.push(`${step.path} → ${step.toPath}`);
    else if (step.created) groups.created!.push(step.path);
    else groups.edited!.push(step.path);
  }
  const parts = Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([verb, list]) => `${verb} ${list.join(', ')}`);
  return parts.length > 0 ? `${parts.join('; ')}.` : '';
}

/** Paths changed by the last few turns, most recent first. */
export function recentlyChangedPaths(entries: readonly HistoryEntry[], turns = 3): string[] {
  const out: string[] = [];
  let seenTurns = 0;
  for (let index = entries.length - 1; index >= 0 && seenTurns < turns; index -= 1) {
    const entry = entries[index]!;
    if (entry.role !== 'assistant') continue;
    seenTurns += 1;
    for (const step of entry.steps ?? []) {
      if (step.kind === 'file' && step.status === 'done') {
        const path = step.action === 'rename' && step.toPath ? step.toPath : step.path;
        if (!out.includes(path)) out.push(path);
      }
    }
    for (const match of entry.content.matchAll(/filePath="([^"]+)"/g)) {
      const path = match[1]!.startsWith('/') ? match[1]! : `/${match[1]}`;
      if (!out.includes(path)) out.push(path);
    }
  }
  return out;
}

/** An assistant message from the Code tab's previous loop, with its artifacts reduced to a file list. */
function legacyAssistantText(content: string): string {
  const paths = [...content.matchAll(/<boltAction\s+type="file"\s+filePath="([^"]+)"/g)].map((match) => match[1]!);
  const prose = content
    .replace(/<boltArtifact[\s\S]*?(<\/boltArtifact>|$)/g, ' ')
    .replace(/<willow-[\s\S]*?(<\/willow-[\w-]+>|\/>)/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return paths.length > 0 ? `${prose}\n\n[Files changed: ${paths.join(', ')}]`.trim() : prose;
}

function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${text.slice(0, head)}\n[…]\n${text.slice(text.length - tail)}`;
}

/**
 * Earlier turns as plain messages, newest kept when the budget runs out.
 *
 * Consecutive messages from the same side are merged and a leading assistant
 * message is dropped, because several providers reject anything but a strict
 * user/assistant alternation that starts with the user.
 */
export function compactHistory(entries: readonly HistoryEntry[], options: HistoryOptions = {}): ConversationMessage[] {
  const maxMessages = options.maxMessages ?? 30;
  const maxChars = options.maxChars ?? 36_000;
  const maxAssistant = options.maxAssistantChars ?? 3_000;
  const maxUser = options.maxUserChars ?? 6_000;

  const rendered: ConversationMessage[] = entries.slice(-maxMessages).map((entry) => {
    if (entry.role === 'user') {
      const names = (entry.attachments ?? []).map((attachment) => attachment.name).filter(Boolean);
      const note = names.length > 0 ? `\n\n[Attached: ${names.join(', ')}]` : '';
      return { role: 'user', content: truncateMiddle(entry.content, maxUser) + note };
    }
    if (entry.steps) {
      const prose = stepsText(entry.steps);
      const changes = describeChanges(entry.steps);
      const limit = entry.mode === 'plan' ? maxAssistant * 4 : maxAssistant;
      const text = [truncateMiddle(prose, limit), changes ? `[Changes made: ${changes}]` : ''].filter(Boolean).join('\n\n');
      return { role: 'assistant', content: text || '(no reply)' };
    }
    return { role: 'assistant', content: truncateMiddle(legacyAssistantText(entry.content), maxAssistant) || '(no reply)' };
  });

  // Keep the newest messages that fit.
  const kept: ConversationMessage[] = [];
  let used = 0;
  for (let index = rendered.length - 1; index >= 0; index -= 1) {
    const message = rendered[index]!;
    if (used + message.content.length > maxChars && kept.length > 0) break;
    kept.unshift(message);
    used += message.content.length;
  }

  const merged: ConversationMessage[] = [];
  for (const message of kept) {
    if (!message.content.trim()) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) last.content = `${last.content}\n\n${message.content}`;
    else merged.push({ ...message });
  }
  while (merged.length > 0 && merged[0]!.role === 'assistant') merged.shift();
  return merged;
}
