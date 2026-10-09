import { create } from "zustand";
import { defaultSlashCapabilities, type SlashCapabilities } from "../slash-options";

interface PageEditorUiState {
  capabilities: SlashCapabilities;
  /** Comments sidebar (`Rv` drawer) toggled from the header. */
  commentsOpen: boolean;
  /** "Show attribution" from the page menu; drives `--page-attribution-progress`. */
  showAttribution: boolean;
  activeThreadId: string | null;
  /** A text or visualization generation is running (`SlashContext.generating`). */
  generating: boolean;
  setCapabilities: (patch: Partial<SlashCapabilities>) => void;
  setGenerating: (generating: boolean) => void;
  setCommentsOpen: (open: boolean) => void;
  setShowAttribution: (show: boolean) => void;
  setActiveThreadId: (threadId: string | null) => void;
  resetPageEditorUi: (patch?: Partial<Pick<PageEditorUiState, "capabilities" | "commentsOpen" | "showAttribution">>) => void;
}

const initialUi = {
  capabilities: defaultSlashCapabilities,
  commentsOpen: false,
  showAttribution: false,
  activeThreadId: null,
  generating: false,
} satisfies Partial<PageEditorUiState>;

export const usePageEditorUiStore = create<PageEditorUiState>((set) => ({
  ...initialUi,
  setCapabilities: (patch) => set((state) => ({ capabilities: { ...state.capabilities, ...patch } })),
  setGenerating: (generating) => set({ generating }),
  setCommentsOpen: (commentsOpen) => set({ commentsOpen }),
  setShowAttribution: (showAttribution) => set({ showAttribution }),
  setActiveThreadId: (activeThreadId) => set({ activeThreadId }),
  resetPageEditorUi: (patch = {}) => set({ ...initialUi, ...patch }),
}));
