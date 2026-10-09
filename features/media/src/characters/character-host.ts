// What the character pages need from the Media view: everything the Scenebuilder's host gives,
// plus image generation (MediaView owns the models, the keys and the gallery).
import type React from 'react';
import type { MediaItem } from '../types';
import type { SceneHost } from '../scenes/scene-host';

export type CharacterSlot = 'portrait' | 'body';

export interface CharacterGenerateRequest {
  prompt: string;
  modelId: string;
  /** Images the generation should follow: the portrait for a body, the current image for an edit. */
  references: MediaItem[];
  characterId: string;
  slot: CharacterSlot;
  /** The version an edit is made from; it joins that version's history. */
  parent?: MediaItem;
}

export interface CharacterHost extends SceneHost {
  imageModels: { id: string; name: string }[];
  defaultImageModelId: string;
  /** Shown above the prompt when a generation cannot start (no model, no key). */
  notice?: React.ReactNode;
  /** Starts an image for one of a character's slots; returns the pending item, or null. */
  generate(req: CharacterGenerateRequest): MediaItem | null;
  /** Flow's Format: a rough description rewritten as a detailed one, with the user's Gemini key. */
  formatPrompt(text: string): Promise<string>;
  /** Adds a character's image to the gallery's prompt box as an ingredient. */
  addToPrompt(item: MediaItem): void;
}
