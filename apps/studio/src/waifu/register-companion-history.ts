import { registerSyncedFolder } from '@willow/storage/local-sync';
import {
  COMPANION_HISTORY_EVENT,
  COMPANION_HISTORY_KEY,
  hasConversation,
  parseCompanionHistory,
  readCompanionHistory,
} from './companion-history';

registerSyncedFolder('companion-history', {
  folder: 'Labs/Companion',
  extension: '.json',
  // One list every tab shares: cleared here, the file goes to the Recycle Bin, and the next
  // conversation writes it again.
  reviveLocal: true,

  async readLocal() {
    const history = readCompanionHistory();
    // The greeting alone is nothing to keep — and on a browser starting over, nothing to write
    // over the folder's conversation, which the pass then hands back.
    if (!history || !hasConversation(history)) return [];
    return [{ id: 'history', contents: JSON.stringify(history, null, 2) }];
  },

  async applyRemote(items) {
    const item = items.find((entry) => entry.id === 'history');
    if (!item) return;
    let history: ReturnType<typeof parseCompanionHistory>;
    try {
      history = parseCompanionHistory(JSON.parse(item.contents));
    } catch {
      return;
    }
    if (!history) return;
    try {
      localStorage.setItem(COMPANION_HISTORY_KEY, JSON.stringify(history));
    } catch {
      // The live event still hands it to the open companion.
    }
    window.dispatchEvent(new CustomEvent(COMPANION_HISTORY_EVENT, { detail: history }));
  },
});
