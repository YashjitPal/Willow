import { MODEL_PROVIDER_IDS } from '@willow/core/model-catalog';
import { registerSyncedFolder, syncedFolderKeys } from '@willow/storage/local-sync';
import {
  MODEL_CATALOG_UPDATED_EVENT,
  MODEL_CONFIG_STORAGE_KEY,
  extractModelCatalogSnapshot,
  mergeModelCatalogSnapshot,
  parseModelCatalogSnapshot,
  type ModelCatalogSnapshot,
} from './model-catalog-storage';

/** This browser's stored config, and its open tabs, onto `snapshot`'s catalog. */
const adoptCatalog = (snapshot: ModelCatalogSnapshot): void => {
  try {
    const raw = localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
    const current = raw ? JSON.parse(raw) : {};
    localStorage.setItem(MODEL_CONFIG_STORAGE_KEY, JSON.stringify(mergeModelCatalogSnapshot(current, snapshot)));
  } catch {
    // The live event still lets the current tab adopt the disk catalog.
  }
  window.dispatchEvent(new CustomEvent(MODEL_CATALOG_UPDATED_EVENT, { detail: snapshot }));
};

/** Whether this browser has synced the catalog with this folder before: the driver keeps a hash of each item it has. */
const hasSyncedCatalog = (scopeId: string): boolean => {
  try {
    const hashes = JSON.parse(localStorage.getItem(syncedFolderKeys('Models', scopeId).hashes) || 'null');
    return Boolean(hashes && typeof hashes === 'object' && typeof hashes.catalog === 'string');
  } catch {
    return false;
  }
};

/** Willow's own starting models (`DEFAULT_MODEL_CONFIG` in App): every new browser holds them, kept or not. */
const isShippedModel = (model: Record<string, unknown>): boolean => String(model.id).startsWith('default-');

/** The folder's catalog, and after it the models this browser added that the folder lacks. */
const folderFirst = (folder: ModelCatalogSnapshot, browser: ModelCatalogSnapshot): ModelCatalogSnapshot => {
  const savedModels = { ...folder.savedModels };
  const addedKeys = new Set<string>();
  for (const provider of MODEL_PROVIDER_IDS) {
    const held = new Set(folder.savedModels[provider].map((model) => model.id));
    const added = browser.savedModels[provider].filter((model) => !held.has(model.id) && !isShippedModel(model));
    if (!added.length) continue;
    savedModels[provider] = [...folder.savedModels[provider], ...added];
    for (const model of added) addedKeys.add(`${provider}:${model.id}`);
  }
  if (!addedKeys.size) return folder;
  return {
    version: 1,
    savedModels,
    modelOrder: [...folder.modelOrder, ...browser.modelOrder.filter((key) => addedKeys.has(key) && !folder.modelOrder.includes(key))],
  };
};

registerSyncedFolder('model-catalog', {
  folder: 'Models',
  extension: '.json',

  async readLocal({ scopeId, readDisk }) {
    let browser: ModelCatalogSnapshot | null = null;
    try {
      const raw = localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
      if (raw) browser = extractModelCatalogSnapshot(JSON.parse(raw));
    } catch {
      browser = null;
    }
    /*
     * A browser that has never synced the catalog with this folder — Willow's own storage cleared,
     * a reinstall, another copy of Willow on the folder — holds only the models it starts with, and
     * what it hands the engine reads as a change to write over the folder's, which are the user's.
     * So the folder's catalog is taken first, as it stands, and this browser's own additions follow
     * as a change of its own on the next pass. An unreadable file throws, and the pass waits.
     */
    if (readDisk && !hasSyncedCatalog(scopeId)) {
      const disk = await readDisk('catalog');
      const folder = disk === null ? null : parseModelCatalogSnapshot(disk);
      if (disk !== null && folder) {
        adoptCatalog(browser ? folderFirst(folder, browser) : folder);
        return [{ id: 'catalog', contents: disk }];
      }
    }
    if (!browser) return [];
    return [{ id: 'catalog', contents: JSON.stringify(browser, null, 2) }];
  },

  async applyRemote(items) {
    const catalog = items.find((item) => item.id === 'catalog');
    if (!catalog) return;
    const snapshot = parseModelCatalogSnapshot(catalog.contents);
    if (!snapshot) return;
    adoptCatalog(snapshot);
  },
});
