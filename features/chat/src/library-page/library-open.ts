/**
 * A document picked in the Library, waiting for its chat to open.
 *
 * Gemini's rows link to the chat at the response that wrote the document. Willow opens the
 * chat and then the document itself: ChatView reads this once the chosen chat's messages are
 * in (switching chats clears the canvas panel first, so it cannot be set beforehand), opens the
 * canvas or the Deep Research report, and clears it. A request older than `MAX_AGE_MS` is
 * dropped, so a chat that never finished loading cannot open a panel much later.
 */
import { atom } from 'nanostores';

export interface LibraryOpenRequest {
  chatId: string;
  docId?: string;
  researchMessageId?: string;
  at: number;
}

const MAX_AGE_MS = 15_000;

export const $libraryOpenRequest = atom<LibraryOpenRequest | null>(null);

export const requestLibraryOpen = (request: Omit<LibraryOpenRequest, 'at'>): void => {
  $libraryOpenRequest.set({ ...request, at: Date.now() });
};

/** The request for this chat, if one is waiting and still fresh. */
export const pendingLibraryOpen = (request: LibraryOpenRequest | null, chatId: string | null, now = Date.now()): LibraryOpenRequest | null =>
  request && chatId && request.chatId === chatId && now - request.at <= MAX_AGE_MS ? request : null;
