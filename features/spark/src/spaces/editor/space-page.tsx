import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FormattedMessage } from "react-intl";
import { useParams } from "react-router-dom";
import { useReducedMotion } from "../../codex/lib/theme-engine";
import { SideDrawer } from "../../codex/ui/side-drawer";
import { useAppShellHeader } from "../willow/shell/main-area";
import { AccessDenied } from "../components/access-denied";
import { usePage, useSpacesStore, type PageMetadata } from "../state";
import { pageCss } from "./css";
import { pageMessages } from "./messages";
import { PageCommentsRail, PageCommentsSidebar, type PageCommentsProps, type PendingComment } from "./page-comments";
import { PageEditor, type PageEditorHandle } from "./page-editor";
import { PageHeader } from "./page-header";
import { PageContentLoading, PageDocumentPresentation, PageLayout, pageLayoutSpring, type PageCommentsLayout } from "./page-layout";
import { PageOutline } from "./page-outline";
import { PageTitle } from "./page-title";
import { usePageDocument, usePageDocumentsStore } from "./state/page-documents-store";
import { usePageEditorUiStore } from "./state/page-editor-ui-store";

function pageAccess(page: PageMetadata) {
  const requestChanges = page.interaction_mode === "request_changes";
  const canWrite = page.access.can_write && !requestChanges;
  return { canWrite, canComment: requestChanges || (page.access.can_comment ?? page.access.can_write), requestChanges };
}

/** Reports whether the canvas fits the floating comments rail. */
function RoomReporter({ hasRoom, onChange }: { hasRoom: boolean; onChange: (hasRoom: boolean) => void }) {
  useLayoutEffect(() => onChange(hasRoom), [hasRoom, onChange]);
  return null;
}

/** `/space/:pageId`: header in the app shell, then the Page document with its comments. */
export function SpacePage() {
  const { pageId = "" } = useParams();
  const page = usePage(pageId);
  // Saved Pages are still being read: a Page opened now would show the seed's copy, or none.
  const pagesLoading = useSpacesStore((state) => state.pagesStatus === "loading");
  if (pagesLoading) return null;
  if (page == null) return <AccessDenied target={{ kind: "page", id: pageId }} />;
  return <SpacePageContent key={pageId} page={page} />;
}

export interface SpacePageContentProps {
  page: PageMetadata;
  /** `side-panel` keeps the header in the tab (`YC`) instead of the app shell header. */
  surface?: "route" | "side-panel";
  focusTitle?: boolean;
  onTitleFocused?: () => void;
}

/** `x` (PageEditorContent) for the main Page route and the Page side panel tab. */
export function SpacePageContent({ page, surface = "route", focusTitle = false, onTitleFocused }: SpacePageContentProps) {
  const pageId = page.page_id;
  const sidePanel = surface === "side-panel";
  const reducedMotion = useReducedMotion();
  const pageDocument = usePageDocument(pageId);
  const commentsOpen = usePageEditorUiStore((state) => state.commentsOpen);
  const setCommentsOpen = usePageEditorUiStore((state) => state.setCommentsOpen);
  const showAttribution = usePageEditorUiStore((state) => state.showAttribution);
  const activeThreadId = usePageEditorUiStore((state) => state.activeThreadId);
  const setActiveThreadId = usePageEditorUiStore((state) => state.setActiveThreadId);
  const editorRef = useRef<PageEditorHandle>(null);
  const [readingColumn, setReadingColumn] = useState<HTMLDivElement | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [drawerContainer, setDrawerContainer] = useState<HTMLDivElement | null>(null);
  const [pending, setPending] = useState<PendingComment | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [highlightedThreadId, setHighlightedThreadId] = useState<string | null>(null);
  const [hasRoom, setHasRoom] = useState(true);
  const [attributionMounted, setAttributionMounted] = useState(showAttribution);

  useEffect(() => {
    if (usePageDocumentsStore.getState().documents[pageId] == null) usePageDocumentsStore.getState().ensureDocument(pageId);
  }, [pageId]);

  const { canWrite, canComment, requestChanges } = pageAccess(page);
  const documentReady = pageDocument?.status === "ready";
  const editable = canWrite && documentReady;
  const commentsAvailable = documentReady && canComment;

  const pageHeader = useMemo(
    () => (
      <PageHeader
        pageId={pageId}
        editor={editorRef}
        canWrite={canWrite}
        requestChanges={requestChanges}
        canComment={canComment}
        documentReady={documentReady}
        inset={sidePanel}
        contentFade={sidePanel}
      />
    ),
    [pageId, canWrite, requestChanges, canComment, documentReady, sidePanel],
  );
  useAppShellHeader({ pageHeader: sidePanel ? undefined : pageHeader });

  const commentsVisible = commentsAvailable && (commentsOpen || revealed || activeThreadId != null || pending != null);
  const sidebarOpen = commentsVisible && (commentsOpen || !hasRoom);
  const railOpen = commentsVisible && !sidebarOpen;

  const reveal = () => setRevealed(true);
  const hideComments = () => {
    setPending(null);
    setActiveThreadId(null);
    setRevealed(false);
    setHighlightedThreadId(null);
  };

  const commentsProps: PageCommentsProps | null =
    pageDocument == null
      ? null
      : {
          pageId,
          document: pageDocument,
          canComment,
          canWrite,
          activeThreadId,
          pending,
          onPendingChange: (next) => {
            setPending(next);
            if (next == null && activeThreadId == null) setRevealed(false);
          },
          onActiveThreadChange: (threadId) => {
            setActiveThreadId(threadId);
            setHighlightedThreadId(null);
            if (threadId != null) reveal();
          },
          onHighlightThread: setHighlightedThreadId,
        };

  const renderComments = (layout: PageCommentsLayout) => {
    if (commentsProps == null || !commentsAvailable) return null;
    return (
      <>
        <RoomReporter hasRoom={layout.hasRoom} onChange={setHasRoom} />
        {sidebarOpen && drawerContainer != null
          ? createPortal(
              <PageCommentsSidebar
                {...commentsProps}
                onClose={() => {
                  setCommentsOpen(false);
                  hideComments();
                }}
              />,
              drawerContainer,
            )
          : null}
        {railOpen && layout.hasRoom && layout.container != null ? createPortal(<PageCommentsRail {...commentsProps} editorElement={layout.scrollElement} />, layout.container) : null}
      </>
    );
  };

  let body;
  if (pageDocument == null || pageDocument.status === "loading") body = <PageContentLoading pageId={pageId} />;
  else if (pageDocument.status === "error") {
    body = (
      <div className={clsx(pageCss.PageReadingColumn, "text-secondary")} role="alert">
        <FormattedMessage {...pageMessages.loadFailed} />
      </div>
    );
  } else {
    body = (
      <PageEditor
        ref={editorRef}
        pageId={pageId}
        document={pageDocument}
        editable={editable}
        canComment={canComment}
        showAttribution={showAttribution || attributionMounted}
        activeThreadId={activeThreadId}
        highlightedThreadId={highlightedThreadId}
        onSelectThread={(threadId) => {
          setActiveThreadId(threadId);
          reveal();
        }}
        onRequestComment={(target) => {
          setActiveThreadId(null);
          setPending({ kind: "comment", target });
          reveal();
        }}
        onComposeTaskMention={(mentionId) => {
          setPending({ kind: "task", mentionId });
          reveal();
        }}
      />
    );
  }

  const focusBody = () => {
    if (!editable || editorRef.current == null) return false;
    editorRef.current.focus("start");
    return true;
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {sidePanel ? <div className="pointer-events-none z-30 shrink-0 absolute inset-x-0 top-0">{pageHeader}</div> : null}
      <div className="@container/page-activity relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="@container/page-comments relative flex min-h-0 flex-1">
            <PageLayout
              headerOverlay={sidePanel}
              open={railOpen}
              readingColumn={readingColumn}
              scrollElement={scrollElement}
              scrollElementRef={setScrollElement}
              sidebarOpen={sidebarOpen}
              sidebar={
                <div className="flex h-full min-h-0 max-w-full">
                  <SideDrawer open={sidebarOpen} size="compact">
                    <div ref={setDrawerContainer} className="flex h-full min-h-0 flex-col" />
                  </SideDrawer>
                </div>
              }
              comments={renderComments}
              navigation={(inlineComments) => (
                <PageOutline
                  disabled={inlineComments}
                  contentElement={readingColumn}
                  scrollElement={scrollElement}
                  title={page.title ?? ""}
                  blocks={documentReady ? pageDocument.blocks : []}
                />
              )}
            >
              <PageDocumentPresentation
                initial={false}
                animate={{ "--page-attribution-progress": showAttribution ? 1 : 0 }}
                transition={reducedMotion ? { duration: 0 } : pageLayoutSpring}
                onAnimationStart={() => {
                  if (showAttribution) setAttributionMounted(true);
                }}
                onAnimationComplete={() => setAttributionMounted(showAttribution)}
                headingRef={setReadingColumn}
                heading={
                  <PageTitle
                    pageId={pageId}
                    canWrite={canWrite}
                    documentReady={documentReady}
                    isMainPage={!sidePanel}
                    focusTitle={focusTitle}
                    onTitleFocused={onTitleFocused}
                    onFocusBody={focusBody}
                    onEnter={focusBody}
                  />
                }
              >
                {body}
              </PageDocumentPresentation>
              <div
                aria-hidden
                className={clsx("h-[50cqh]", canWrite && "cursor-text")}
                data-page-document-end=""
                data-page-document-trailing-space=""
                onClick={() => {
                  if (editable) editorRef.current?.focus("end");
                }}
              />
            </PageLayout>
          </div>
        </div>
      </div>
    </div>
  );
}
