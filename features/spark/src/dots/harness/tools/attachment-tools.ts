/** `open_attachment`: the files that came with one of the user's messages, opened again after the turn they arrived in. */
import { readDotAttachments } from '../runtime/dot-attachments';
import { getDotThread } from '../thread/thread-store';
import { fail, type DotToolEntry, type DotToolEnv } from './tool-env';

const MAX_TEXT = 40_000;

export const openAttachmentTool = (env: DotToolEnv): DotToolEntry => ({
  doc: {
    name: 'open_attachment',
    args: '{"message": "i482"}',
    description: 'Open the files the user sent with one of their messages. They come with the turn they arrive in; open them to look again later.',
  },
  handler: {
    id: 'open_attachment',
    async run(args) {
      const id = typeof args.message === 'string' ? args.message.trim() : '';
      const item = getDotThread(env.dotId)?.items.find((entry) => entry.id === id && entry.kind === 'user');
      if (!item) return fail(`${id || 'That'} is not one of the user's messages.`);
      if (!item.attachments?.length) return fail(`${id} came with no files.`);
      const files = await readDotAttachments(item.attachments).catch(() => []);
      if (!files.length) return fail(`The files sent with ${id} can no longer be opened.`);
      const texts = files.filter((file) => file.type === 'text');
      const rest = files.filter((file) => file.type !== 'text');
      const opened = `Opened ${files.map((file) => file.name ?? 'a file').join(', ')} from ${id}.`;
      const inline = texts.map((file) => `\n\n--- ${file.name ?? 'file'} ---\n${file.data.length > MAX_TEXT ? `${file.data.slice(0, MAX_TEXT)}\n[cut at ${MAX_TEXT} characters]` : file.data}`).join('');
      const shown = rest.length ? ` ${rest.length === 1 ? 'It comes' : 'They come'} with this step's results.` : '';
      return { observation: `${opened}${shown}${inline}`, ...(rest.length ? { images: rest } : {}) };
    },
  },
});
