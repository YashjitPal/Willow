import { usePageDocumentsStore } from "../editor/state/page-documents-store";
import { PAGES_REPLACED_EVENT, isSavedPages, readSavedPages, writeSavedPages, type SavedPages } from "./pages-saved";
import { useSpacesStore } from "./spaces-store";

const SAVE_DELAY_MS = 300;

let started = false;

function currentPages(): SavedPages {
  const { pages, recentPageIds, pinnedKeys, dotAccess, welcomePageId } = useSpacesStore.getState();
  return { pages, documents: usePageDocumentsStore.getState().documents, recentPageIds, pinnedKeys, dotAccess, welcomePageId };
}

function showPages(saved: SavedPages): void {
  const { pages, recentPageIds, pinnedKeys, dotAccess, welcomePageId, documents } = saved;
  useSpacesStore.setState({ pages, recentPageIds, pinnedKeys, dotAccess, welcomePageId });
  usePageDocumentsStore.setState({ documents });
}

/**
 * Shows the Pages this browser saved, and saves every change after. Until they are read, `pagesStatus`
 * is `loading`, which keeps a Page from opening on the seed and an edit from landing on it.
 */
export function keepPagesSaved(): void {
  if (started) return;
  started = true;
  useSpacesStore.setState({ pagesStatus: "loading" });

  let replacedWhileReading = false;
  window.addEventListener(PAGES_REPLACED_EVENT, (event) => {
    const saved = (event as CustomEvent<unknown>).detail;
    if (!isSavedPages(saved)) return;
    replacedWhileReading = true;
    showPages(saved);
  });

  void readSavedPages()
    .catch(() => undefined)
    .then((saved) => {
      if (saved && !replacedWhileReading) showPages(saved);
      useSpacesStore.setState({ pagesStatus: "ready" });
      // Saved Pages that couldn't be read mustn't be overwritten with the seed this session shows instead.
      if (saved === undefined) return;

      let timer: number | undefined;
      const save = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void writeSavedPages(currentPages()).catch(() => undefined), SAVE_DELAY_MS);
      };
      useSpacesStore.subscribe((state, previous) => {
        if (
          state.pages !== previous.pages ||
          state.recentPageIds !== previous.recentPageIds ||
          state.pinnedKeys !== previous.pinnedKeys ||
          state.dotAccess !== previous.dotAccess ||
          state.welcomePageId !== previous.welcomePageId
        ) {
          save();
        }
      });
      usePageDocumentsStore.subscribe((state, previous) => {
        if (state.documents !== previous.documents) save();
      });
    });
}
