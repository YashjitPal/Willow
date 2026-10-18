/**
 * Reads the Library out of the chats, a page at a time.
 *
 * Gemini pages its artifacts on the server (30 a page, the next one when the end of the grid
 * comes into view). Willow has no server, so a page is however many chats it takes to fill
 * one: they are read newest first, a few at a time, until the page is full or the chats run out.
 * Each chat's items are kept per session against the chat's timestamp, so coming back to the
 * Library reads nothing that has not changed since.
 *
 * Reads go through `loadLocalFSChat`, the same path a click on a chat takes, but never more than
 * `CONCURRENCY` at once and only as far as the page on screen needs — the sidebar learned that a
 * walk over every body queues the user's own clicks behind it.
 */
import {
  libraryItemsFromChat,
  sortDocuments,
  sortMedia,
  type ChatLibraryItems,
  type LibraryDocument,
  type LibraryMedia,
} from './library-items';

export type ReadChat = (chatId: string) => Promise<unknown[] | null>;

const CONCURRENCY = 4;

const cache = new Map<string, { stamp: number; items: ChatLibraryItems }>();
const cacheKey = (scope: string, chatId: string): string => `${scope}\u0000${chatId}`;

/** Forget a chat's items, after the Library itself changed the chat. */
export const forgetLibraryChat = (scope: string, chatId: string): void => {
  cache.delete(cacheKey(scope, chatId));
};

export class LibraryScanner {
  readonly documents: LibraryDocument[] = [];
  readonly media: LibraryMedia[] = [];
  private next = 0;
  private sorted = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly chats: readonly string[],
    private readonly scope: string,
    private readonly read: ReadChat,
    private readonly stamp: (chatId: string) => number,
  ) {}

  get done(): boolean {
    return this.next >= this.chats.length;
  }

  /**
   * Reads chats until `enough` says so or none are left. Everything found before the first
   * `settle()` is ordered by time; after it, each batch is ordered and appended, so tiles
   * already on screen never move when the next page arrives.
   *
   * Scans run one after another, never interleaved, and a batch read for a caller that has
   * since gone (StrictMode's second mount, a page left mid-read) is still kept: the chats it
   * covered are behind the cursor, and the next scan would otherwise never see them.
   */
  scan(enough: (scanner: LibraryScanner) => boolean, cancelled: () => boolean = () => false): Promise<void> {
    const run = this.queue.then(() => this.run(enough, cancelled));
    this.queue = run.catch(() => {});
    return run;
  }

  private async run(enough: (scanner: LibraryScanner) => boolean, cancelled: () => boolean): Promise<void> {
    while (!this.done && !enough(this) && !cancelled()) {
      const batch = this.chats.slice(this.next, this.next + CONCURRENCY);
      this.next += batch.length;
      const found = await Promise.all(batch.map((chatId) => this.items(chatId)));
      const docs = found.flatMap((items) => items.documents);
      const media = found.flatMap((items) => items.media);
      if (this.sorted) {
        this.documents.push(...sortDocuments(docs));
        this.media.push(...sortMedia(media));
      } else {
        this.documents.push(...docs);
        this.media.push(...media);
      }
    }
  }

  /** The first page is shown: order what was found, and append from here on. */
  settle(): void {
    if (this.sorted) return;
    this.sorted = true;
    sortDocuments(this.documents);
    sortMedia(this.media);
  }

  remove(key: string): { index: number; item: LibraryMedia } | null {
    const index = this.media.findIndex((item) => item.key === key);
    if (index < 0) return null;
    const [item] = this.media.splice(index, 1);
    return { index, item };
  }

  restore(index: number, item: LibraryMedia): void {
    this.media.splice(Math.min(index, this.media.length), 0, item);
  }

  private async items(chatId: string): Promise<ChatLibraryItems> {
    const stamp = this.stamp(chatId);
    const key = cacheKey(this.scope, chatId);
    const hit = cache.get(key);
    if (hit && hit.stamp === stamp) return hit.items;
    try {
      const messages = await this.read(chatId);
      const items = libraryItemsFromChat(chatId, Array.isArray(messages) ? messages : [], stamp);
      cache.set(key, { stamp, items });
      return items;
    } catch {
      return { documents: [], media: [] };
    }
  }
}
