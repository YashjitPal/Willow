import type { Attachment } from '@willow/ai/chat';

/**
 * The files the user sent this turn, with a request: on its last message — the bot's view of now — with a line naming
 * which message each came with, and any that could not be opened.
 */
export const withSentFiles = <T extends { messages: { role: string; content: string; attachments?: Attachment[] }[] }>(
  context: T,
  sent: ReadonlyMap<string, { names: string[]; files: Attachment[] }>,
): T => {
  const entries = [...sent.entries()];
  const last = context.messages.at(-1);
  if (!entries.length || !last || last.role !== 'user') return context;
  const lines = entries.map(([id, { names, files }]) => {
    const missing = names.filter((name) => !files.some((file) => file.name === name));
    const shown = names.filter((name) => !missing.includes(name));
    return [shown.length ? `${shown.join(', ')} (from ${id})` : '', missing.length ? `${missing.join(', ')} from ${id} could not be opened` : '']
      .filter(Boolean)
      .join('; ');
  });
  const note = `The files the user sent this turn come with this request: ${lines.join('; ')}.`;
  return {
    ...context,
    messages: [...context.messages.slice(0, -1), { ...last, content: `${last.content}\n\n${note}`, attachments: [...(last.attachments ?? []), ...entries.flatMap(([, { files }]) => files)] }],
  };
};
