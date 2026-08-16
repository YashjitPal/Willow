/**
 * Public surface of the notebooks feature. Import from `@willow/notebooks/index`.
 *
 * The split is deliberate: `notebooks-backend` is persistence and knows nothing
 * about React, `notebooks-store` is the reactive layer over it, and the three
 * page components plus the sidebar section are the only UI. Nothing outside this
 * folder should reach past `notebooks-store` into the backend — the scope wiring
 * in `LocalFSContext` is the single exception, and it imports only
 * `setNotebookStorageScope`.
 */
export type {
  Notebook,
  NotebookSource,
  NotebookVertical,
} from './notebook-types';
export {
  DEFAULT_NOTEBOOK_EMOJI,
  NOTEBOOK_VERTICALS,
  UNTITLED_NOTEBOOK_TITLE,
  formatSourceCount,
} from './notebook-types';

export {
  NOTEBOOKS_UPDATED_EVENT,
  getNotebookStorageScope,
  getNotebooksStorageKey,
  isActiveNotebooksStorageKey,
  setNotebookStorageScope,
} from './notebooks-backend';

export {
  addChatToNotebook,
  addNotebookSource,
  createNotebook,
  deleteNotebook,
  findNotebookForChat,
  getNotebook,
  hydrateNotebooks,
  notebooksHydratedStore,
  notebooksStore,
  removeChatFromNotebook,
  removeNotebookSource,
  renameNotebook,
  setNotebookEmoji,
  subscribeToNotebookWrites,
  toggleNotebookPinned,
  updateNotebook,
} from './notebooks-store';

export { NotebooksSection } from './NotebooksSection';
export type { NotebooksSectionProps } from './NotebooksSection';
export { NotebookCreatePage } from './NotebookCreatePage';
export type { NotebookCreatePageProps } from './NotebookCreatePage';
export { AllNotebooksPage } from './AllNotebooksPage';
export type { AllNotebooksPageProps } from './AllNotebooksPage';
export { NotebooksSplashScreen } from './NotebooksSplashScreen';
export type { NotebooksSplashScreenProps } from './NotebooksSplashScreen';
export { NotebookPage } from './NotebookPage';
export type { NotebookPageProps } from './NotebookPage';
