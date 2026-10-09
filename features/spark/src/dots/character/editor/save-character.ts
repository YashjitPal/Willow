import { useCharacterStore } from "../../state/character-store";
import { useDotStore } from "../../state/dot-store";
import { DotNameRejectedError } from "../appearance-picker/dot-names";
import { writeSavedAvatar } from "../avatar/saved-avatar-capture";
import type { CharacterEditorClient } from "../orbit/character-frame";
import { blobToDataUrl } from "../orbit/snapshot-cache";
import type { CodexPet } from "../pets/codex-pets";

const SAVE_TIMEOUT_MS = 60000;

export class CharacterSnapshotError extends Error {}

export interface SaveCharacterOptions {
  conversationId: string;
  controller: AbortController;
  /** New nickname, already normalized; `undefined` keeps the current one. */
  name?: string;
  pet?: CodexPet | null;
  /** The editor's engine client; when present the edited appearance is snapshotted and saved. */
  client?: CharacterEditorClient;
  /** Appearance to restore into the client before the snapshot. */
  state?: Uint8Array;
  renderOffscreen?: boolean;
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Stands in for the profile PATCH; the outcome is picked by the character scenarios. */
async function saveProfile(name: string | undefined, signal: AbortSignal) {
  const { saveOutcome, saveDelayMs } = useCharacterStore.getState();
  await wait(saveDelayMs, signal);
  if (saveOutcome === "error") throw Error("Character save was not confirmed");
  if (saveOutcome === "changed-elsewhere") throw Error("Character changed on another device; reopen the editor");
  if (saveOutcome === "name-rejected" && name != null) throw new DotNameRejectedError();
}

/**
 * Saves a bot's character like the save-character flow (`te`): restore and snapshot the edited character
 * in the engine, save the profile, then show the new avatar.
 */
export async function saveCharacter({ conversationId, controller, name, pet, client, state, renderOffscreen }: SaveCharacterOptions) {
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(SAVE_TIMEOUT_MS)]);
  let savedState: Uint8Array | undefined;
  let imageSrc: string | undefined;
  if (pet != null || client == null) {
    await saveProfile(name, signal);
  } else {
    let snapshot;
    try {
      if (state != null) {
        const restored = await client.request({ action: "restore", state });
        signal.throwIfAborted();
        if (restored.rejected) throw Error("Character appearance unavailable");
      }
      snapshot = await client.request({ action: "snapshot", renderOffscreen });
      if (!snapshot.state || !snapshot.png) throw Error("Character snapshot unavailable");
    } catch (cause) {
      signal.throwIfAborted();
      throw new CharacterSnapshotError("Could not render character snapshot", { cause });
    }
    signal.throwIfAborted();
    const png = new Blob([new Uint8Array(snapshot.png)], { type: "image/png" });
    try {
      imageSrc = await blobToDataUrl(png);
    } catch (error) {
      console.warn("Failed to prepare a character snapshot for Mini", error);
    }
    // Codex keeps this image on the bot's profile; Willow keeps it with the avatar captures, so the next page load
    // shows it at once instead of rendering the new appearance again.
    void writeSavedAvatar(snapshot.state, png);
    signal.throwIfAborted();
    await saveProfile(name, signal);
    savedState = snapshot.state;
  }
  signal.throwIfAborted();

  const { updateDot } = useDotStore.getState();
  const { setSelectedAvatarId, setSavedImage } = useCharacterStore.getState();
  const renamed = name == null ? {} : { name };
  if (pet != null) {
    setSelectedAvatarId(pet.id);
    updateDot(conversationId, { ...renamed, petId: pet.id });
    return;
  }
  if (savedState == null) {
    updateDot(conversationId, renamed);
    return;
  }
  updateDot(conversationId, { ...renamed, identity: "orbit", appearance: savedState, petId: null });
  if (imageSrc != null) setSavedImage(conversationId, { src: imageSrc, state: savedState, updatedAt: Date.now() });
}
