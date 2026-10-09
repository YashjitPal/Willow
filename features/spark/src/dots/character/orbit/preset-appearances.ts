import encodedPresetAppearances from "./preset-appearances.json";

/**
 * ORBAST1 bytes of every engine preset, captured from the bundled runtime's
 * `presetAppearance(id)`. They stand in for the appearance a saved bot carries on the server.
 */
const presetAppearances: Record<string, string> = encodedPresetAppearances;
const decoded = new Map<string, Uint8Array>();

/** Decoded once per preset so callers can compare by reference. */
export function getPresetAppearance(presetId: string): Uint8Array | null {
  const cached = decoded.get(presetId);
  if (cached) return cached;
  const encoded = presetAppearances[presetId];
  if (encoded == null) return null;
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  decoded.set(presetId, bytes);
  return bytes;
}
