// What a generation is sent for the composer's ingredients. A character ingredient stands for its
// portrait and body: each becomes those images, and the text gains a line saying which of the
// images are that character, so its name in the prompt means the person in them.
import type { ImageAttachment, MediaItem } from '../types';

export function expandCharacterReferences(
  prompt: string,
  refs: ImageAttachment[],
  /** A character's finished images, portrait first. */
  imagesOf: (characterId: string) => MediaItem[],
): { prompt: string; attachments: ImageAttachment[] } {
  if (!refs.some((att) => att.characterId)) return { prompt, attachments: refs };
  const out: ImageAttachment[] = [];
  const notes: string[] = [];
  for (const att of refs) {
    if (!att.characterId) { out.push(att); continue; }
    const images = imagesOf(att.characterId).filter((m) => !!m.url);
    if (!images.length) continue;
    const first = out.length + 1;
    const last = first + images.length - 1;
    for (const m of images) out.push({ id: m.id, url: m.url!, name: att.name, kind: 'image' });
    const which = images.length === 1 ? `reference image ${first}`
      : images.length === 2 ? `reference images ${first} and ${last}`
        : `reference images ${first} to ${last}`;
    notes.push(`"${att.name}" is the character shown in ${which}`);
  }
  return { prompt: notes.length ? `${prompt}\n\n(${notes.join('; ')}.)` : prompt, attachments: out };
}
