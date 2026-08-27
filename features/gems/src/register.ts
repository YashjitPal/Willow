/**
 * Gems' contribution to the synced workspace.
 *
 * This is the whole cost of making a feature sync to disk: declare the folder,
 * say how an item serializes, and say what to do when disk hands items back.
 * Revisions, tombstones, dirty tracking, in-tab and cross-tab locking, conflict
 * copies and the delete-safety rules all live in the engine — do not
 * reimplement them here. See platform/storage/ARCHITECTURE.md §13.
 *
 * Importing this module is what performs the registration. It is pulled in
 * exactly once, from apps/studio/src/app/register-features.ts.
 */

import { registerSyncedFolder } from '@willow/storage/local-sync';
import { type Gem, gemsStore } from './gems-store';

/** Narrow untrusted JSON from disk; a malformed file is skipped, never thrown on. */
const parseGem = (id: string, contents: string): Gem | null => {
  try {
    const raw = JSON.parse(contents) as Partial<Gem>;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.name !== 'string') return null;
    return {
      id,
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description : '',
      instructions: typeof raw.instructions === 'string' ? raw.instructions : '',
      defaultTool: typeof raw.defaultTool === 'string' ? raw.defaultTool : 'No default tool',
      createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : 0,
      updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : 0,
    };
  } catch {
    return null;
  }
};

registerSyncedFolder('gems', {
  folder: 'Gems',
  extension: '.json',

  async readLocal() {
    return gemsStore.get().map((gem) => ({
      id: gem.id,
      // Pretty-printed because these files are meant to be readable and
      // hand-editable in the user's workspace folder.
      contents: JSON.stringify(gem, null, 2),
    }));
  },

  async applyRemote(items) {
    const gems = items
      .map((item) => parseGem(item.id, item.contents))
      .filter((gem): gem is Gem => gem !== null);
    gemsStore.set(gems);
  },
});
