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
import { type Gem, gemsStore, hydrateGems, parseGem as parseGemRecord, sortGems } from './gems-store';

/** Narrow untrusted JSON from disk; a malformed file is skipped, never thrown on. */
const parseGem = (id: string, contents: string): Gem | null => {
  try {
    return parseGemRecord(id, JSON.parse(contents));
  } catch {
    return null;
  }
};

registerSyncedFolder('gems', {
  folder: 'Gems',
  extension: '.json',
  // One list, shared by every tab through localStorage, which a deletion leaves at once: what it
  // holds is the user's. So a Gem named like a deleted one is written, not refused for good.
  reviveLocal: true,

  async readLocal() {
    // Until it has read this browser's Gems the store is empty, which the engine would take for
    // every Gem deleted here; a pass runs on pages that never show Gems (Media, Code) too.
    hydrateGems();
    return gemsStore.get().map((gem) => ({
      id: gem.id,
      // Pretty-printed because these files are meant to be readable and
      // hand-editable in the user's workspace folder.
      contents: JSON.stringify(gem, null, 2),
    }));
  },

  async applyRemote(items) {
    // Replaced before this browser's Gems were read, the store would be merged with them later,
    // bringing back whatever disk had deleted.
    hydrateGems();
    const gems = items
      .map((item) => parseGem(item.id, item.contents))
      .filter((gem): gem is Gem => gem !== null);
    gemsStore.set(sortGems(gems));
  },
});
