/** Public web API from https://github.com/openai/orbit-character-engine/blob/44565ad33ed9ac0da064fee79eb15aa148698769/sdk/web/picker-thumbnails.mjs. */
export class OrbitPickerThumbnails {
  constructor(baseURL?: URL);
  load(options: {
    shape: string;
    category: "eyes" | "eyewear" | "accessory";
    option: string;
    dark?: boolean;
    signal?: AbortSignal;
  }): Promise<{ draw(canvas: HTMLCanvasElement): void } | null>;
  clearCache(): void;
}
