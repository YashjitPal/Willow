/** `memory` (the notebook) and `recall` (the record). */
import { applyNotebookEdit, NOTEBOOK_FILES, parseNotebookEdit, viewNotebook } from '../memory/notebook';
import { parseRecallQuery, recallFromThread } from '../memory/recall';
import { getDotThread, writeDotNotebookFile } from '../thread/thread-store';
import { fail, ok, type DotToolEntry, type DotToolEnv } from './tool-env';

/**
 * The notebook is in view on every turn, so nothing hidden may ride into it from a page or an email the bot read:
 * zero-width and direction-changing characters are dropped from every write.
 */
const INVISIBLE = /[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;

/** Credentials by their shape: private keys, and the prefixes of common API keys and tokens. */
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|ya29\.[0-9A-Za-z_-]{20,})\b/;

export const memoryTool = (env: DotToolEnv): DotToolEntry => ({
  doc: {
    name: 'memory',
    args: '{"action": "view" | "write" | "append" | "replace" | "delete", "file": "commitments.md", "content": "…", "old": "…", "new": "…"}',
    description: `Read and edit your notebook. Its files are ${NOTEBOOK_FILES.map((file) => file.name).join(', ')}; add another only for a subject that needs its own page. "write" replaces a whole file, "replace" swaps one exact passage, "append" adds lines, "view" shows a file or lists them all. Change part of a file with "replace", so the rest stays as it was, and write what is true rather than orders to yourself.`,
  },
  handler: {
    id: 'memory',
    async run(args) {
      const thread = getDotThread(env.dotId);
      if (!thread) return fail('Your notebook is not loaded.');
      let edit;
      try {
        edit = parseNotebookEdit(args);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
      if (edit.action === 'view') return ok(viewNotebook(thread.notebook, edit.file, env.timeZone));
      try {
        const written = applyNotebookEdit(thread.notebook, edit);
        const next = written === null ? null : written.replace(INVISIBLE, '');
        if (next !== null && SECRET.test(next)) {
          return fail('That looks like it contains a password, key or token. Secrets never go in the notebook: note where the user keeps it instead.');
        }
        writeDotNotebookFile(env.dotId, edit.file, next);
        if (next === null) return ok(`Deleted ${edit.file}.`);
        return ok(`Saved ${edit.file} (${next.length.toLocaleString('en-US')} characters).`);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  },
});

export const recallTool = (env: DotToolEnv): DotToolEntry => ({
  doc: {
    name: 'recall',
    args: '{"query": "…"} or {"ids": ["i482"]} or {"around": "i482", "radius": 8}',
    description: 'Read your full record: search it, read items by id, or read what was said around an item. Use it before relying on a precise detail from outside your recent window, and to read collapsed tool output in full. When a search finds nothing, try other words, or one distinctive word, before concluding it was never said.',
  },
  handler: {
    id: 'recall',
    async run(args) {
      const thread = getDotThread(env.dotId);
      if (!thread) return fail('Your record is not loaded.');
      return ok(recallFromThread(thread, parseRecallQuery(args), env.timeZone));
    },
  },
});
