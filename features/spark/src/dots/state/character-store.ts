import { create } from "../lib/create-store";
import type { OrbitAppearance } from "../character/orbit/appearance-codec";
import { ActivityKind, type OrbitActivity } from "../character/orbit/engine-enums";

/** What the mocked `/tbo/{id}` PATCH answers when a character is saved. */
export type CharacterSaveOutcome = "success" | "error" | "name-rejected" | "changed-elsewhere";

/** How the lazily loaded character editor chunk behaves. */
export type CharacterEditorLoad = "default" | "pending" | "error";

/** How the mocked saved-pets queries answer. */
export type PetsLoad = "default" | "pending" | "error";

/** The saved `avatar_url` image of a bot, valid for the appearance bytes it was rendered from. */
export interface SavedAvatarImage {
  src: string;
  state: Uint8Array | null;
  updatedAt: number;
}

interface CharacterStore {
  /** Agent activity shown by conversation characters; missing entries are idle. */
  activityByConversation: Record<string, OrbitActivity>;
  savedImages: Record<string, SavedAvatarImage>;
  /** Locally selected avatar (`codex` pet ids or `default`), used by draft and local bots. */
  selectedAvatarId: string | null;
  /** Legacy appearance picked for a bot that has not been created yet. */
  legacyDraftAppearance: { color: string; avatar: string };
  /** The last custom character built in the editor (`orbit-custom-character`). */
  customCharacter: OrbitAppearance | null;
  rendererFailure: boolean;
  editorLoad: CharacterEditorLoad;
  petsLoad: PetsLoad;
  /** The `2631431308` gate that shows pets in the avatar chooser. */
  petsEnabled: boolean;
  saveOutcome: CharacterSaveOutcome;
  saveDelayMs: number;
  setActivity: (conversationId: string, kind: ActivityKind, turnId?: string | null) => void;
  clearActivity: (conversationId: string) => void;
  setSavedImage: (conversationId: string, image: SavedAvatarImage | null) => void;
  setSelectedAvatarId: (avatarId: string | null) => void;
  setLegacyDraftAppearance: (appearance: { color: string; avatar: string }) => void;
  setCustomCharacter: (appearance: OrbitAppearance | null) => void;
  setRendererFailure: (rendererFailure: boolean) => void;
  setEditorLoad: (editorLoad: CharacterEditorLoad) => void;
  setPetsLoad: (petsLoad: PetsLoad) => void;
  setPetsEnabled: (petsEnabled: boolean) => void;
  setSaveOutcome: (saveOutcome: CharacterSaveOutcome) => void;
}

export const useCharacterStore = create<CharacterStore>((set) => ({
  activityByConversation: {},
  savedImages: {},
  selectedAvatarId: null,
  legacyDraftAppearance: { color: "pink", avatar: "sunglasses" },
  customCharacter: null,
  rendererFailure: false,
  editorLoad: "default",
  petsLoad: "default",
  petsEnabled: true,
  saveOutcome: "success",
  saveDelayMs: 600,
  setActivity: (conversationId, kind, turnId = null) =>
    set((s) => ({ activityByConversation: { ...s.activityByConversation, [conversationId]: { kind, turnId } } })),
  clearActivity: (conversationId) =>
    set((s) => {
      const { [conversationId]: _removed, ...rest } = s.activityByConversation;
      return { activityByConversation: rest };
    }),
  setSavedImage: (conversationId, image) =>
    set((s) => {
      if (image != null) return { savedImages: { ...s.savedImages, [conversationId]: image } };
      const { [conversationId]: _removed, ...rest } = s.savedImages;
      return { savedImages: rest };
    }),
  setSelectedAvatarId: (selectedAvatarId) => set({ selectedAvatarId }),
  setLegacyDraftAppearance: (legacyDraftAppearance) => set({ legacyDraftAppearance }),
  setCustomCharacter: (customCharacter) => set({ customCharacter }),
  setRendererFailure: (rendererFailure) => set({ rendererFailure }),
  setEditorLoad: (editorLoad) => set({ editorLoad }),
  setPetsLoad: (petsLoad) => set({ petsLoad }),
  setPetsEnabled: (petsEnabled) => set({ petsEnabled }),
  setSaveOutcome: (saveOutcome) => set({ saveOutcome }),
}));

/** Puts the mocked character services back to their defaults, then applies `patch`. */
export function resetCharacterState(patch: Partial<CharacterStore> = {}) {
  useCharacterStore.setState({
    activityByConversation: {},
    rendererFailure: false,
    editorLoad: "default",
    petsLoad: "default",
    petsEnabled: true,
    saveOutcome: "success",
    ...patch,
  });
}

export const IDLE_ACTIVITY: OrbitActivity = { kind: ActivityKind.None, turnId: null };
