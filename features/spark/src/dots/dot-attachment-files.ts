/**
 * Files the user sent a bot, kept beside it in the user's folder as
 * `Spark/Dots/<bot>/Attachments/<name [hash].ext>` — named as a task's are — from their payloads in
 * IndexedDB, and read back from there into a browser that has none: its storage was cleared, or it is
 * a new copy of Willow on the folder.
 *
 * Which files a bot has is read from its own file, `Spark/Dots/<bot>.json`, which carries its whole
 * conversation (`dots-folder.ts`): what the browser that kept a file wrote, and what one starting over
 * restores the conversation from. The dots folder reads only the `.json` files directly in
 * `Spark/Dots/`, so the folder beside each is never taken for a bot.
 */
import { isValidItemId } from '@willow/storage/local-sync';
import { readConversationFile, writeConversationFiles } from '@willow/storage/local-fs/conversation-files';
import {
  MAX_SPARK_ATTACHMENT_BYTES,
  loadSparkAttachmentBlob,
  missingSparkAttachmentPayloads,
  putSparkAttachmentPayload,
} from '../attachment-storage';
import { sparkAttachmentPath } from '../spark-task-files';
import type { SparkTaskAttachment } from '../spark-types';
import { DOTS_FOLDER, parseDotFile } from './dots-folder-plan';
import { sparkDots } from './dots-store';
import type { DotAttachmentRef } from './harness/thread/thread-types';

/** As `harness/runtime/dot-attachments.ts` keeps a bot's file in Spark's attachment storage. */
const asSpark = (ref: DotAttachmentRef): SparkTaskAttachment => ({
  id: ref.id,
  name: ref.name,
  mimeType: ref.mimeType ?? 'application/octet-stream',
  size: ref.size ?? 0,
  ...(ref.type ? { type: ref.type } : {}),
});

/** A payload that is in neither place is looked for again only this often, since that means reading the bot's file. */
const RETRY_AFTER_MS = 5 * 60_000;

/** Each bot's file as last read (scope, size and time), and until when that read stands. */
const scanned = new Map<string, { stamp: string; until: number }>();
/** The files `writeConversationFiles` found in a bot's folder or wrote there: `${scope}\0${bot}`. */
const known = new Map<string, Set<string>>();

const refsIn = (contents: string, dotId: string): DotAttachmentRef[] => {
  const refs = new Map<string, DotAttachmentRef>();
  for (const item of parseDotFile(dotId, contents)?.thread?.items ?? []) {
    for (const ref of item.attachments ?? []) {
      if (typeof ref?.id === 'string' && ref.id && typeof ref.name === 'string') refs.set(ref.id, ref);
    }
  }
  return [...refs.values()];
};

/** Whether everything the bot's file names is now in both places, or can never be. */
const keepBot = async (dots: FileSystemDirectoryHandle, dotId: string, contents: string, scopeId: string): Promise<boolean> => {
  const refs = refsIn(contents, dotId);
  if (refs.length === 0) return true;
  const missing = new Set(await missingSparkAttachmentPayloads(refs.map((ref) => ref.id), scopeId));
  let settled = true;
  const here = refs.filter((ref) => !missing.has(ref.id));
  if (here.length > 0) {
    const knownKey = `${scopeId}\u0000${dotId}`;
    if (!known.has(knownKey)) known.set(knownKey, new Set());
    settled = await writeConversationFiles(dots, dotId, here.map((ref) => ({
      path: sparkAttachmentPath(asSpark(ref)),
      read: () => loadSparkAttachmentBlob(asSpark(ref), scopeId),
    })), known.get(knownKey));
  }
  for (const ref of refs.filter((candidate) => missing.has(candidate.id))) {
    const file = await readConversationFile(dots, dotId, sparkAttachmentPath(asSpark(ref)));
    // Larger than an attachment can be: something else saved under its name.
    if (file && file.size > MAX_SPARK_ATTACHMENT_BYTES) continue;
    if (file && await putSparkAttachmentPayload(asSpark(ref), file, scopeId).then(() => true, () => false)) continue;
    settled = false;
  }
  return settled;
};

/** One pass over every bot in the list. Nothing throws: what fails waits for the next pass. */
export const syncDotAttachmentFiles = async (root: FileSystemDirectoryHandle, scopeId: string): Promise<void> => {
  let dots: FileSystemDirectoryHandle = root;
  try {
    for (const part of DOTS_FOLDER.split('/')) dots = await dots.getDirectoryHandle(part);
  } catch {
    // No bot written to the folder yet: no file names anything.
    return;
  }
  for (const dot of sparkDots.get().dots) {
    if (!isValidItemId(dot.id)) continue;
    try {
      const file = await (await dots.getFileHandle(`${dot.id}.json`)).getFile();
      const stamp = `${scopeId}\u0000${file.size}\u0000${file.lastModified}`;
      const last = scanned.get(dot.id);
      if (last?.stamp === stamp && Date.now() < last.until) continue;
      const settled = await keepBot(dots, dot.id, await file.text(), scopeId);
      scanned.set(dot.id, { stamp, until: settled ? Infinity : Date.now() + RETRY_AFTER_MS });
    } catch {
      // Not written to the folder yet, or unreadable right now: the next pass looks again.
    }
  }
};
