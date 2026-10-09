/** Prebuilt picker artwork. This module does not import or start the engine. */
export class OrbitPickerThumbnails {
  #base;
  #index;
  #gridIndices = new Map();
  #images = new Map();
  #pending = new Map();
  #bytes = 0;
  #generation = 0;
  #active = 0;
  #waiting = [];

  constructor(baseURL = new URL('./orbit-thumbnails/', import.meta.url)) {
    this.#base = new URL(baseURL, import.meta.url);
  }

  async #readIndex(path, allowMissing = false) {
    // Metadata uses stable URLs and may change between releases. Ask the
    // browser to validate any cached response before using it.
    const response = await fetch(new URL(path, this.#base), { cache: 'no-cache' });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error('Picker index could not be loaded');
    const index = await response.json();
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!record(index) || index.version !== 1 || !record(index.entries) || !record(index.aliases) || !Array.isArray(index.files)) {
      throw new Error('Invalid picker index');
    }
    return index;
  }

  async #manifest(shape, category, theme) {
    const path = `grids/${shape}/${category}/${theme}.json`;
    let request = this.#gridIndices.get(path);
    if (!request) {
      request = this.#readIndex(path, true).catch(error => {
        if (this.#gridIndices.get(path) === request) this.#gridIndices.delete(path);
        throw error;
      });
    }
    // Refresh recency and bound metadata, including missing shards in old bundles.
    this.#gridIndices.delete(path);
    this.#gridIndices.set(path, request);
    while (this.#gridIndices.size > 16) this.#gridIndices.delete(this.#gridIndices.keys().next().value);
    const grid = await request;
    if (grid) return grid;
    if (!this.#index) {
      this.#index = this.#readIndex('index.json')
        .catch(error => { this.#index = undefined; throw error; });
    }
    return this.#index;
  }

  async #image(hash, width, height) {
    const cached = this.#images.get(hash);
    if (cached) {
      this.#images.delete(hash);
      this.#images.set(hash, cached);
      return cached;
    }
    if (this.#pending.has(hash)) return this.#pending.get(hash);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid picker image');
    const generation = this.#generation;
    const request = this.#decode(async () => {
      const image = new Image();
      image.decoding = 'async';
      image.crossOrigin = 'anonymous';
      image.src = new URL(`images/${hash}.png`, this.#base).href;
      await image.decode();
      if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error('Wrong picker image dimensions');
      if (generation === this.#generation) {
        const bytes = width * height * 4;
        while (this.#bytes + bytes > 8 * 1024 * 1024 && this.#images.size) {
          const [key, oldest] = this.#images.entries().next().value;
          this.#images.delete(key);
          this.#bytes -= oldest.naturalWidth * oldest.naturalHeight * 4;
        }
        this.#images.set(hash, image);
        this.#bytes += bytes;
      }
      return image;
    });
    this.#pending.set(hash, request);
    try { return await request; }
    finally { this.#pending.delete(hash); }
  }

  async #decode(work) {
    // Bound transient decoded memory as well as retained cache memory.
    // A released slot goes directly to its next waiter without oversubscription.
    if (this.#active === 4) await new Promise(resolve => this.#waiting.push(resolve));
    else this.#active++;
    try { return await work(); }
    finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#active--;
    }
  }

  /** Load only requested layers. A cancelled caller never receives stale artwork.
   * Shared downloads continue for other callers. Network failures reject and may be retried.
   */
  async load({ shape, category, option, dark = false, signal }) {
    if (signal?.aborted || !shape || !option) return null;
    if (!/^[a-z0-9_]+$/.test(shape) || !['eyes', 'eyewear', 'accessory'].includes(category)) return null;
    const theme = dark ? 'dark' : 'light';
    const index = await this.#manifest(shape, category, theme);
    if (signal?.aborted) return null;
    const canonical = Object.hasOwn(index.aliases, shape) ? index.aliases[shape] : shape;
    const key = `${canonical}/${category}/${option}/${theme}`;
    const recipe = Object.hasOwn(index.entries, key) ? index.entries[key] : null;
    if (!recipe) return null;
    if (!Array.isArray(recipe) || recipe.length < 1 || recipe.length > 2) throw new Error('Invalid picker recipe');
    const layers = await Promise.all(recipe.map(async placement => {
      if (!Array.isArray(placement) || placement.length !== 3 || !placement.every(Number.isInteger)) throw new Error('Invalid picker placement');
      const [file, x, y] = placement;
      const record = index.files[file];
      if (!Array.isArray(record) || record.length !== 3) throw new Error('Invalid picker file');
      const [hash, width, height] = record;
      if (![x, y, width, height].every(Number.isInteger) || width < 1 || height < 1 || x < 0 || y < 0 || x + width > 384 || y + height > 384) {
        throw new Error('Invalid picker bounds');
      }
      const image = await this.#image(hash, width, height);
      if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error('Wrong picker image dimensions');
      return { image, x, y, width, height };
    }));
    if (signal?.aborted) return null;
    return {
      /** Replace a dedicated thumbnail canvas. Set its backing size for the display's pixel density. */
      draw(canvas) {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Picker needs a 2D canvas');
        const scale = Math.min(canvas.width, canvas.height) / 384;
        const dx = (canvas.width - 384 * scale) / 2, dy = (canvas.height - 384 * scale) / 2;
        context.save();
        context.resetTransform();
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        context.imageSmoothingEnabled = true;
        context.translate(dx, dy);
        context.scale(scale, scale);
        layers.forEach((layer, i) => {
          context.save();
          if (i) {
            // Clip inside the identical two-pixel guard, aligned to output
            // pixels. Copy must clear only this patch, never the whole canvas.
            const left = Math.round(dx + (layer.x + 1) * scale);
            const top = Math.round(dy + (layer.y + 1) * scale);
            const right = Math.round(dx + (layer.x + layer.width - 1) * scale);
            const bottom = Math.round(dy + (layer.y + layer.height - 1) * scale);
            context.resetTransform();
            context.beginPath();
            context.rect(layer.x === 0 ? dx : left, layer.y === 0 ? dy : top,
              (layer.x + layer.width === 384 ? dx + 384 * scale : right) - (layer.x === 0 ? dx : left),
              (layer.y + layer.height === 384 ? dy + 384 * scale : bottom) - (layer.y === 0 ? dy : top));
            context.clip();
            context.translate(dx, dy);
            context.scale(scale, scale);
            context.globalCompositeOperation = 'copy';
          }
          context.drawImage(layer.image, layer.x, layer.y, layer.width, layer.height);
          context.restore();
        });
        context.restore();
      },
    };
  }

  /** Drop cache ownership, including retention by work already in flight.
   * Loaded artwork remains valid. Call when the picker is dismissed.
   */
  clearCache() {
    this.#generation++;
    this.#images.clear();
    this.#bytes = 0;
  }
}

// Reuse one store across cells so they share downloads and decoded body layers.
export const orbitPickerThumbnails = new OrbitPickerThumbnails();
