import { atom } from 'nanostores';
import type { NotebookSource } from '@willow/notebooks/notebook-types';
import { selectChunks, type EmbeddingModel } from '@willow/notebooks/source-retrieval';

import type { GemDefaultTool, GemKnowledgeFile } from './gem-types';
import { gemsStore, resolveGem, type ResolvedGem } from './gems-store';

/**
 * Chat ↔ Gem wiring, on the same pattern as `notebook-chat-store`.
 *
 * A Gem has no chat of its own: `/gem/<id>` opens the ordinary chat surface with this atom
 * set, and `ChatView` reads it for three things — the zero state (the Gem's card instead of
 * the greeting), the composer's starting tool, and the per-turn system prompt. It stays set
 * for the life of the chat, and `gemChatIndexStore` remembers it for when the chat is
 * reopened from Recents.
 */
export const $chatGemId = atom<string | null>(null);

/** Everything a prompt needs from a Gem, premade or the user's own. */
export interface GemPromptSource {
  name: string;
  instructions: string;
  knowledge: readonly GemKnowledgeFile[];
  hideCitations: boolean;
}

export const gemPromptSource = (resolved: ResolvedGem): GemPromptSource => (
  resolved.kind === 'custom'
    ? resolved.gem
    : { name: resolved.gem.name, instructions: resolved.gem.instructions, knowledge: [], hideCitations: false }
);

const asSources = (files: readonly GemKnowledgeFile[]): NotebookSource[] => files.map((file) => ({
  id: file.id,
  title: file.name,
  kind: 'file',
  mimeType: file.mimeType,
  size: file.size,
  createdAt: file.addedAt,
  ...(file.content ? { content: file.content } : {}),
}));

/**
 * The Gem's contribution to a turn's system prompt: its instructions, then the passages
 * of its knowledge that bear on this question.
 *
 * Instructions come first and are labelled as the user's, so the knowledge block's own
 * wording cannot read as overriding them. Retrieval is the notebooks' `selectChunks`: the
 * whole set when it fits, ranked passages when it does not.
 */
export const buildGemSystemPrompt = async (
  gem: GemPromptSource,
  options: { query?: string; model?: EmbeddingModel | null } = {},
): Promise<string> => {
  const parts: string[] = [];
  const instructions = gem.instructions.trim();
  parts.push(instructions
    ? [
      `You are "${gem.name}", a Gem: a custom version of the assistant that the user set up for a purpose.`,
      'Follow these instructions for every response unless they conflict with a safety requirement.',
      '',
      instructions,
    ].join('\n')
    : `You are "${gem.name}", a Gem: a custom version of the assistant that the user set up.`);

  if (gem.knowledge.length) {
    const sources = asSources(gem.knowledge);
    const selection = await selectChunks({ query: options.query ?? '', sources, model: options.model ?? null });
    const withText = new Set(selection.chunks.map((chunk) => chunk.sourceId));
    const blocks = gem.knowledge.map((file, index) => {
      const head = `[${index + 1}] ${file.name}`;
      if (file.content && withText.has(file.id)) {
        const body = selection.chunks
          .filter((chunk) => chunk.sourceId === file.id)
          .map((chunk) => chunk.text)
          .join('\n\n…\n\n');
        return `${head}\n${body}`;
      }
      if (file.content) return `${head}\n(no passage of this file matched the question closely enough to include)`;
      return `${head}\n(${file.problem || 'contents could not be read'} — do not invent them)`;
    });
    parts.push([
      'The user attached these files to the Gem as its knowledge. Use them where they apply,',
      'and say so plainly when the answer is not in them.',
      gem.hideCitations
        ? 'Do not name, quote the titles of, or cite these files in your responses; use what they say without attribution.'
        : 'When an answer draws on a file, you may name it.',
      '',
      '--- KNOWLEDGE ---',
      blocks.join('\n\n'),
      '--- END KNOWLEDGE ---',
    ].join('\n'));
  }
  return parts.join('\n\n');
};

/** The prompt block for whichever Gem the open chat belongs to, or `''`. */
export const getActiveGemSystemPrompt = async (
  options: { query?: string; model?: EmbeddingModel | null } = {},
): Promise<string> => {
  const resolved = resolveGem($chatGemId.get(), gemsStore.get());
  return resolved ? buildGemSystemPrompt(gemPromptSource(resolved), options) : '';
};

/** The composer tool a new chat with this Gem starts with, if any. */
export const gemStartingTool = (resolved: ResolvedGem | null): Exclude<GemDefaultTool, 'none'> | null => {
  const tool = resolved?.gem.defaultTool;
  return tool && tool !== 'none' ? tool : null;
};
