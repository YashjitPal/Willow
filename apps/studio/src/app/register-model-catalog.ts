import { registerSyncedFolder } from '@willow/storage/synced-folders';
import {
  MODEL_CATALOG_UPDATED_EVENT,
  MODEL_CONFIG_STORAGE_KEY,
  extractModelCatalogSnapshot,
  mergeModelCatalogSnapshot,
  parseModelCatalogSnapshot,
} from './model-catalog-storage';

registerSyncedFolder('model-catalog', {
  folder: 'Models',
  extension: '.json',

  async readLocal() {
    try {
      const raw = localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
      if (!raw) return [];
      const modelConfig = JSON.parse(raw);
      return [{
        id: 'catalog',
        contents: JSON.stringify(extractModelCatalogSnapshot(modelConfig), null, 2),
      }];
    } catch {
      return [];
    }
  },

  async applyRemote(items) {
    const catalog = items.find((item) => item.id === 'catalog');
    if (!catalog) return;
    const snapshot = parseModelCatalogSnapshot(catalog.contents);
    if (!snapshot) return;

    try {
      const raw = localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
      const current = raw ? JSON.parse(raw) : {};
      localStorage.setItem(MODEL_CONFIG_STORAGE_KEY, JSON.stringify(mergeModelCatalogSnapshot(current, snapshot)));
    } catch {
      // The live event still lets the current tab adopt the disk catalog.
    }
    window.dispatchEvent(new CustomEvent(MODEL_CATALOG_UPDATED_EVENT, { detail: snapshot }));
  },
});
