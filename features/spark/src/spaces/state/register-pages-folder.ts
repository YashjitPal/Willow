import { registerSyncedFolder } from "@willow/storage/local-sync";
import { pagesFolder } from "./pages-folder";
import { PAGES_REPLACED_EVENT, readSavedPages, writeSavedPages } from "./pages-saved";

registerSyncedFolder(
  "spark-pages",
  pagesFolder({
    read: readSavedPages,
    write: writeSavedPages,
    replaced: (saved) => window.dispatchEvent(new CustomEvent(PAGES_REPLACED_EVENT, { detail: saved })),
  }),
);
