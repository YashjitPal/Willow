/**
 * Gemini's Library, at `/library` (the overview) and `/library/documents`.
 *
 * Overview: the headline, then Documents — the newest three, with View all once there is a
 * fourth — and Media, a grid of everything generated, paged 30 at a time as the end of it comes
 * into view. While the first page is read only the headline and a 4px bar along the top show,
 * as Gemini's do; the next page's place is held by a row of skeleton tiles. The Documents page
 * holds eight skeleton rows while it reads, four more for each next page.
 *
 * Opening a document opens its chat and the document in it (`library-open`); an image opens the
 * lightbox; a video or a track opens its chat. Delete asks first, then takes the item out of the
 * message that made it. Layout and motion: `library.css`; what is read: `library-items.ts`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { checkCodeChat } from '@willow/storage/code-chat-storage';
import { requestCodeChatOpen } from '@willow/storage/code-chat-open-store';
import { showCopyToast } from '@willow/ui/copy-toast-store';
import { copyImage, downloadMedia } from '../media/GeneratedImage';
import {
  DOCUMENTS_PREVIEW,
  LIBRARY_PAGE_SIZE,
  documentIcon,
  formatLibraryDate,
  mediaFileName,
  mediaTitle,
  withoutMedia,
  type LibraryDocument,
  type LibraryMedia,
} from './library-items';
import { LibraryScanner, forgetLibraryChat } from './library-scan';
import { requestLibraryOpen } from './library-open';
import { DeleteDialog, Icon, IconButton, ItemSheet } from './LibraryOverlays';
import { LibraryTile, SkeletonTiles, type LoadMediaUrl } from './LibraryTile';
import { LibraryLightbox } from './LibraryLightbox';
import './library.css';

export type LibrarySubpage = 'overview' | 'documents';

export interface LibraryPageProps {
  subpage: LibrarySubpage;
  /** In-app navigation between the two pages. */
  onNavigate: (path: '/library' | '/library/documents') => void;
  /** The chat has been selected: show Chat (the Library's rows and Go to chat). */
  onOpenChat: (chatId: string) => void;
  onNewChat: () => void;
  /** The chat's own address, so a row is a real link (middle click, copy link). */
  chatHref: (chatId: string) => string;
}

const useMatchMedia = (query: string): boolean => {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
};

/** Each edge of the scroller fades by how far it has scrolled from it, up to 40px (Base UI's overflow vars). */
const useScrollFade = (ref: React.RefObject<HTMLDivElement | null>) => {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const end = Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop);
      el.style.setProperty('--gm-lib-overflow-start', `${Math.max(0, el.scrollTop)}px`);
      el.style.setProperty('--gm-lib-overflow-end', `${end}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    el.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
};

/**
 * A 1px line at the end of a list; in view, it asks for the next page. It stays while that page
 * loads, unobserved, so the skeleton sits 1px under the list, and once loaded it looks again.
 */
const InfiniteTrigger: React.FC<{ onReach: () => void; loading: boolean }> = ({ onReach, loading }) => {
  const ref = useRef<HTMLDivElement>(null);
  const reach = useRef(onReach);
  reach.current = onReach;
  useEffect(() => {
    const el = ref.current;
    if (!el || loading) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) reach.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading]);
  return <div ref={ref} style={{ width: '100%', height: 1 }} />;
};

type Phase = 'loading' | 'ready' | 'error';

interface PageDepth {
  documents: number;
  media: number;
}

interface LibraryState {
  phase: Phase;
  documents: LibraryDocument[];
  media: LibraryMedia[];
  /** How many are shown: it moves a whole page at a time, once that page is read. */
  shown: PageDepth;
  /** Whether more chats are left to read. */
  more: boolean;
  loadingNext: boolean;
  nextFailed: boolean;
}

/**
 * The Library's data: read on mount (and again when the chat list or account changes), a page
 * at a time. `want` is how many documents and media the page on screen asks for. What is shown
 * is the last published read, so a scanner that is still reading never empties the page.
 */
const useLibraryData = (subpage: LibrarySubpage) => {
  const fs = useLocalFS();
  const { localChats, loadLocalFSChat, getChatTimestamp, chatScopeId, isChatListHydrated } = fs;
  const chats = useMemo(
    () => [...localChats].sort((a, b) => (getChatTimestamp(b) - getChatTimestamp(a)) || a.localeCompare(b)),
    // The list's identity changes on every save; its contents decide whether to read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localChats.join('\u0000'), chatScopeId],
  );
  // Read through refs: the context hands out new functions as it updates, and each new scanner
  // reads the Library again.
  const readRef = useRef(loadLocalFSChat);
  readRef.current = loadLocalFSChat;
  const stampRef = useRef(getChatTimestamp);
  stampRef.current = getChatTimestamp;
  const scanner = useMemo(
    () => new LibraryScanner(chats, chatScopeId, (chatId) => readRef.current(chatId), (chatId) => stampRef.current(chatId)),
    [chats, chatScopeId],
  );
  const firstPage = subpage === 'overview'
    ? { documents: DOCUMENTS_PREVIEW + 1, media: LIBRARY_PAGE_SIZE }
    : { documents: LIBRARY_PAGE_SIZE, media: 0 };
  const want = useRef<PageDepth>(firstPage);
  const [state, setState] = useState<LibraryState>({ phase: 'loading', documents: [], media: [], shown: firstPage, more: true, loadingNext: false, nextFailed: false });
  const [attempt, setAttempt] = useState(0);
  const scannerRef = useRef(scanner);
  scannerRef.current = scanner;
  const shownRef = useRef(state.shown);
  shownRef.current = state.shown;

  /** Shows what `from` has read, unless a newer scanner has taken over meanwhile. */
  const publish = useCallback((from: LibraryScanner, patch: Partial<LibraryState>) => {
    if (scannerRef.current !== from) return;
    setState((current) => ({
      ...current,
      documents: [...from.documents],
      media: [...from.media],
      more: !from.done,
      ...patch,
    }));
  }, []);

  const enough = useCallback((s: LibraryScanner) =>
    s.documents.length >= want.current.documents && s.media.length >= want.current.media, []);

  // Opening the page, another subpage or account, and Retry start from the progress bar. A new
  // chat list (any chat saved, a Library delete included) is read again behind what is shown,
  // to the same depth, so nothing flashes and the scroll stays; unchanged chats come from cache.
  const shownFor = useRef<string | null>(null);
  const loadingNextRef = useRef(false);
  useEffect(() => {
    if (!isChatListHydrated) return undefined;
    let cancelled = false;
    const key = `${subpage}\u0000${chatScopeId}\u0000${attempt}`;
    const refresh = shownFor.current === key;
    if (!refresh) {
      shownFor.current = null;
      want.current = firstPage;
      setState({ phase: 'loading', documents: [], media: [], shown: firstPage, more: true, loadingNext: false, nextFailed: false });
    }
    loadingNextRef.current = false;
    scanner.scan(enough, () => cancelled).then(() => {
      if (cancelled) return;
      scanner.settle();
      shownFor.current = key;
      publish(scanner, { phase: 'ready', loadingNext: false, shown: { ...want.current } });
    }, () => {
      if (cancelled) return;
      setState((current) => (refresh ? { ...current, loadingNext: false } : { ...current, phase: 'error' }));
    });
    return () => { cancelled = true; };
    // `firstPage` is derived from `subpage`, which is in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner, isChatListHydrated, subpage, chatScopeId, attempt, enough, publish]);

  const loadNext = useCallback(() => {
    if (loadingNextRef.current) return;
    loadingNextRef.current = true;
    const shown = shownRef.current;
    want.current = subpage === 'overview'
      ? { ...shown, media: shown.media + LIBRARY_PAGE_SIZE }
      : { ...shown, documents: shown.documents + LIBRARY_PAGE_SIZE };
    setState((current) => ({ ...current, loadingNext: true, nextFailed: false }));
    scanner.scan(enough).then(() => {
      loadingNextRef.current = false;
      publish(scanner, { loadingNext: false, shown: { ...want.current } });
    }, () => {
      loadingNextRef.current = false;
      if (scannerRef.current === scanner) setState((current) => ({ ...current, loadingNext: false, nextFailed: true }));
    });
  }, [scanner, subpage, enough, publish]);

  /** Off the screen and out of the scanner at once; `restoreItem` undoes it. */
  const removeItem = useCallback((key: string) => {
    const from = scannerRef.current;
    const taken = from.remove(key);
    setState((current) => ({
      ...current,
      media: current.media.filter((item) => item.key !== key),
      documents: current.documents.filter((doc) => doc.key !== key),
    }));
    return taken ? { from, ...taken } : null;
  }, []);
  // A scanner that replaced `from` meanwhile reads the chat itself, item and all.
  const restoreItem = useCallback((removed: NonNullable<ReturnType<typeof removeItem>>) => {
    if (scannerRef.current !== removed.from) return;
    removed.from.restore(removed.index, removed.item);
    publish(removed.from, {});
  }, [publish]);

  const shownMedia = Math.min(state.media.length, state.shown.media);
  const shownDocuments = Math.min(state.documents.length, state.shown.documents);
  return {
    ...state,
    shownMedia,
    shownDocuments,
    hasNext: subpage === 'overview'
      ? state.media.length > shownMedia || state.more
      : state.documents.length > shownDocuments || state.more,
    loadNext,
    removeItem,
    restoreItem,
    retry: () => setAttempt((n) => n + 1),
    fs,
  };
};

/** Object URLs for the Library's files, made once per file for the session. */
const urlCache = new Map<string, Promise<string | null>>();

const DocumentRow: React.FC<{ doc: LibraryDocument; href: string; onOpen: () => void }> = ({ doc, href, onOpen }) => {
  const date = formatLibraryDate(doc.updatedAt);
  return (
    <li className="gm-library-row">
      <a
        href={href}
        aria-label={doc.title ? `Open ${doc.title}` : 'Open document'}
        className="gm-library-row-link gm-library-press"
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onOpen();
        }}
      >
        <div className="gm-library-row-body">
          <span style={{ display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}><Icon name={documentIcon(doc.kind)} size={24} /></span>
          <div className="gm-library-row-text">
            <span className="gm-library-body gm-library-truncate">{doc.title || 'Untitled'}</span>
            {date && <span className="gm-library-small gm-library-muted gm-library-truncate">{date}</span>}
          </div>
        </div>
      </a>
    </li>
  );
};

const SkeletonRows: React.FC<{ count: number }> = ({ count }) => (
  <ul className="gm-library-list" aria-hidden="true">
    {Array.from({ length: count }, (_, index) => (
      <li key={index} className="gm-library-skeleton-row">
        <div className="gm-library-row-body">
          <span className="gm-library-skeleton-icon"><span className="gm-library-skeleton gm-library-skeleton--square" style={{ width: 40, height: 40 }} /></span>
          <div className="gm-library-skeleton-lines">
            <span className="gm-library-skeleton" style={{ width: '60%', height: 20 }} />
            <span className="gm-library-skeleton" style={{ width: '30%', height: 16 }} />
          </div>
        </div>
      </li>
    ))}
  </ul>
);

const Section: React.FC<{ title: string; viewAll?: { href: string; onClick: () => void }; children: React.ReactNode }> = ({ title, viewAll, children }) => (
  <section className="gm-library-section">
    <div className="gm-library-section-head">
      <span className="gm-library-title-large">{title}</span>
      {viewAll && (
        <IconButton
          icon="keyboard_arrow_right"
          label="View all"
          variant="tonal"
          tooltip={false}
          href={viewAll.href}
          onClick={(event) => { event.preventDefault(); viewAll.onClick(); }}
        />
      )}
    </div>
    <div>{children}</div>
  </section>
);

const ErrorRegion: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: '4px 12px' }}>
    <span className="gm-library-small gm-library-muted">Something went wrong.</span>
    <button type="button" className="gm-library-button gm-library-button--xs gm-library-button--tonal gm-library-press" onClick={onRetry}>
      <span className="gm-library-small gm-library-truncate">Retry</span>
    </button>
  </div>
);

export const LibraryPage: React.FC<LibraryPageProps> = ({ subpage, onNavigate, onOpenChat, onNewChat, chatHref }) => {
  const data = useLibraryData(subpage);
  const { fs } = data;
  const isMobile = useMatchMedia('(max-width: 768px)');
  const viewportRef = useRef<HTMLDivElement>(null);
  useScrollFade(viewportRef);
  const [lightbox, setLightbox] = useState<LibraryMedia | null>(null);
  const [sheetFor, setSheetFor] = useState<LibraryMedia | null>(null);
  const [confirmFor, setConfirmFor] = useState<LibraryMedia | null>(null);
  useEffect(() => { viewportRef.current?.scrollTo({ top: 0 }); }, [subpage]);

  // The context's value is a new object on every update; the tiles need one stable loader.
  const fsRef = useRef(fs);
  fsRef.current = fs;
  const loadUrl = useCallback<LoadMediaUrl>((item, which) => {
    const attachment = which === 'thumbnail' ? item.thumbnail : item.file;
    if (!attachment) return Promise.resolve(null);
    const { chatScopeId, loadLocalFSChatAttachment } = fsRef.current;
    const key = `${chatScopeId}\u0000${attachment.id}`;
    const hit = urlCache.get(key);
    if (hit) return hit;
    const pending = loadLocalFSChatAttachment(attachment.id, { chatId: item.chatId, attachment })
      .then((stored) => (stored?.blob ? URL.createObjectURL(stored.blob) : null))
      .catch(() => null);
    pending.then((url) => { if (!url) urlCache.delete(key); });
    urlCache.set(key, pending);
    return pending;
  }, []);

  /* As the sidebar and Search open a chat: one started in Code reopens there. */
  const openChat = useCallback((chatId: string) => {
    void checkCodeChat(fs.chatScopeId, chatId, fs.loadLocalFSChat).then((isCode) => {
      if (isCode) {
        requestCodeChatOpen(chatId);
        return;
      }
      void fs.selectLocalFSInboxChat(chatId);
      onOpenChat(chatId);
    });
  }, [fs, onOpenChat]);

  const openDocument = useCallback((doc: LibraryDocument) => {
    requestLibraryOpen(doc.kind === 'research'
      ? { chatId: doc.chatId, researchMessageId: doc.messageId }
      : { chatId: doc.chatId, docId: doc.docId });
    openChat(doc.chatId);
  }, [openChat]);

  const openMedia = useCallback((item: LibraryMedia) => {
    if (item.kind === 'image') setLightbox(item);
    else openChat(item.chatId);
  }, [openChat]);

  /* Taken out of the grid at once; put back where it was if the chat cannot be written. */
  const { removeItem, restoreItem } = data;
  const deleteItem = useCallback(async (item: LibraryMedia) => {
    if (lightbox?.key === item.key) setLightbox(null);
    const removed = removeItem(item.key);
    try {
      const messages = await fs.loadLocalFSChat(item.chatId);
      const next = messages ? withoutMedia(messages, item.messageId, item.mediaId) : null;
      const saved = next ? await fs.saveLocalFSChat(item.chatId, next, null, undefined, { openInChat: false }) : !!messages;
      if (!saved) throw new Error('not saved');
      forgetLibraryChat(fs.chatScopeId, item.chatId);
      showCopyToast('Item deleted');
    } catch {
      if (removed) restoreItem(removed);
      showCopyToast('Failed to delete item');
    }
  }, [fs, lightbox, removeItem, restoreItem]);

  const media = data.media.slice(0, data.shownMedia);
  const documents = data.documents;
  const loading = data.phase === 'loading';

  const header = subpage === 'documents' ? (
    <div className="gm-library-header-row">
      <IconButton
        icon="arrow_back"
        label="Back to library"
        size="m"
        variant="variant"
        tooltip={false}
        className="gm-library-back"
        href="/library"
        onClick={(event) => { event.preventDefault(); onNavigate('/library'); }}
      />
      <h1 className="gm-library-headline">Documents</h1>
    </div>
  ) : (
    <h1 className="gm-library-headline">Library</h1>
  );

  let body: React.ReactNode = null;
  if (data.phase === 'error') {
    body = <ErrorRegion onRetry={data.retry} />;
  } else if (subpage === 'documents') {
    if (loading) body = <SkeletonRows count={8} />;
    else if (!documents.length) {
      body = (
        <div className="gm-library-empty">
          <Icon name="article" size={32} />
          <span className="gm-library-body gm-library-muted">No documents saved in your library</span>
        </div>
      );
    } else {
      body = (
        <>
          <ul className="gm-library-list">
            {documents.slice(0, data.shownDocuments).map((doc) => (
              <DocumentRow key={doc.key} doc={doc} href={chatHref(doc.chatId)} onOpen={() => openDocument(doc)} />
            ))}
          </ul>
          {data.hasNext && !data.nextFailed && <InfiniteTrigger onReach={data.loadNext} loading={data.loadingNext} />}
          {data.loadingNext && <SkeletonRows count={4} />}
          {data.nextFailed && (
            <div className="gm-library-more">
              <button type="button" className="gm-library-button gm-library-button--s gm-library-button--tonal gm-library-press" onClick={data.loadNext}>
                <span className="gm-library-body">Couldn&apos;t load more. Retry</span>
              </button>
            </div>
          )}
        </>
      );
    }
  } else if (!loading) {
    if (!documents.length && !data.media.length) {
      body = (
        <div className="gm-library-empty gm-library-empty--page">
          <Icon name="image_create" size={40} />
          <span className="gm-library-body gm-library-muted" style={{ textAlign: 'center' }}>Any documents or media that you create will appear here</span>
          <a
            href="/app"
            className="gm-library-button gm-library-button--s gm-library-button--tonal gm-library-press"
            style={{ textDecoration: 'none' }}
            onClick={(event) => { event.preventDefault(); void fs.selectLocalFSInboxChat(null); onNewChat(); }}
          >
            <Icon name="gemini_chat" size={20} />
            <span className="gm-library-body">New chat</span>
          </a>
        </div>
      );
    } else {
      body = (
        <div className="gm-library-sections">
          <Section
            title="Documents"
            viewAll={documents.length > DOCUMENTS_PREVIEW ? { href: '/library/documents', onClick: () => onNavigate('/library/documents') } : undefined}
          >
            {documents.length === 0 ? (
              <div className="gm-library-empty">
                <Icon name="article" size={32} />
                <span className="gm-library-body gm-library-muted">Documents that you create will appear here</span>
              </div>
            ) : (
              <ul className="gm-library-list">
                {documents.slice(0, DOCUMENTS_PREVIEW).map((doc) => (
                  <DocumentRow key={doc.key} doc={doc} href={chatHref(doc.chatId)} onOpen={() => openDocument(doc)} />
                ))}
              </ul>
            )}
          </Section>
          <Section title="Media">
            {media.length === 0 && !data.loadingNext ? (
              <div className="gm-library-empty">
                <Icon name="image_create" size={32} />
                <span className="gm-library-body gm-library-muted">Images, videos and music that you create will appear here</span>
              </div>
            ) : (
              <>
                <div className="gm-library-grid">
                  {media.map((item) => (
                    <LibraryTile
                      key={item.key}
                      item={item}
                      loadUrl={loadUrl}
                      onOpen={() => openMedia(item)}
                      onDelete={() => setConfirmFor(item)}
                      onMore={() => setSheetFor(item)}
                    />
                  ))}
                </div>
                {data.hasNext && !data.nextFailed && <InfiniteTrigger onReach={data.loadNext} loading={data.loadingNext} />}
                {data.loadingNext && <SkeletonTiles count={isMobile ? 3 : 5} />}
                {data.nextFailed && (
                  <div className="gm-library-more">
                    <button type="button" className="gm-library-button gm-library-button--s gm-library-button--tonal gm-library-press" onClick={data.loadNext}>
                      <span className="gm-library-body">Couldn&apos;t load more. Retry</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </Section>
        </div>
      );
    }
  }

  return (
    <div className="gm-library">
      {loading && (
        <div aria-busy="true" aria-label="Loading items in the library" aria-valuemax={100} aria-valuemin={0} role="progressbar" className="gm-library-progress">
          <div className="gm-library-progress-bar" />
        </div>
      )}
      <header className="gm-library-header">
        <div className="gm-library-guard">{header}</div>
      </header>
      <div className="gm-library-scroll">
        <div ref={viewportRef} className="gm-library-viewport" tabIndex={0} role="presentation">
          <div className="gm-library-content">
            <div className="gm-library-guard">{body}</div>
          </div>
        </div>
      </div>

      <LibraryLightbox
        item={lightbox}
        loadUrl={loadUrl}
        onClose={() => setLightbox(null)}
        onCopy={(url) => { void copyImage(url); }}
        onDownload={(url) => { if (lightbox) downloadMedia(url, mediaFileName(lightbox)); }}
        onGoToChat={() => { const item = lightbox; setLightbox(null); if (item) openChat(item.chatId); }}
        onDelete={() => { if (lightbox) setConfirmFor(lightbox); }}
      />
      <ItemSheet
        open={!!sheetFor}
        title={sheetFor ? mediaTitle(sheetFor) : ''}
        onClose={() => setSheetFor(null)}
        actions={sheetFor ? [
          { icon: 'delete', label: 'Delete', onSelect: () => setConfirmFor(sheetFor) },
          { icon: 'chat', label: 'Go to chat', onSelect: () => openChat(sheetFor.chatId) },
        ] : []}
      />
      <DeleteDialog
        open={!!confirmFor}
        onCancel={() => setConfirmFor(null)}
        onConfirm={() => { const item = confirmFor; setConfirmFor(null); if (item) void deleteItem(item); }}
      />
    </div>
  );
};

export default LibraryPage;
