import { UNTITLED_NOTEBOOK_TITLE, type Notebook } from '@willow/notebooks/notebook-types';
import type { GemKnowledgeFile } from './gem-types';
import { MAX_KNOWLEDGE_CHARS } from './gems-store';

export const knowledgeId = (): string => `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * A notebook added as knowledge: a snapshot of the text of its sources, one heading per
 * source, taken when it is added. Later changes to the notebook do not reach the Gem.
 */
export const notebookKnowledge = (notebook: Notebook): GemKnowledgeFile => {
  const readable = notebook.sources.filter((source) => source.content?.trim());
  let content = readable.map((source) => `## ${source.title}\n\n${source.content!.trim()}`).join('\n\n');
  let problem = readable.length ? undefined : 'no sources Willow can read';
  if (content.length > MAX_KNOWLEDGE_CHARS) {
    content = content.slice(0, MAX_KNOWLEDGE_CHARS);
    problem = `text truncated at ${MAX_KNOWLEDGE_CHARS.toLocaleString()} characters`;
  }
  return {
    id: knowledgeId(),
    name: notebook.title || UNTITLED_NOTEBOOK_TITLE,
    mimeType: 'text/markdown',
    size: content.length,
    ...(content ? { content } : {}),
    ...(problem ? { problem } : {}),
    addedAt: Date.now(),
  };
};
