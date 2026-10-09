import { create } from 'zustand';
import { prefillSparkDotComposer } from '../../../../dots/dots-store';

/** Codex's composer drafts, as Spaces writes them: a draft for a bot's conversation prefills Willow's bot composer. */
interface ComposerStore {
  setText: (roomId: string, text: string) => void;
}

export const useComposerStore = create<ComposerStore>(() => ({
  setText: (roomId, text) => prefillSparkDotComposer(roomId, text),
}));
