// Willow TV: Flow TV (labs.google/flow/tv), with Willow's own videos. Every Media project with a
// finished video is a channel and every scene a short film; nothing is fetched. Opened from the
// Willow TV item in Media's More menus, at /tv.
import './willow-tv.css';
import './tv-willow.css';
import './tv-responsive.css';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate, type Location } from 'react-router-dom';
import { TV_ICON_SPRITE } from './tv-icons';
import { randomGeneration } from './tv-library';
import { isChannelRoute, parseTvPath, tvClipPath, type TvRoute } from './tv-routes';
import { TvShareDialog } from './TvDialogs';
import { TvHeader, TvSubHeader } from './TvHeader';
import { TvChannelsPage, TvEmptyPage, TvErrorPage, TvFaqPage, TvSearchPage, TvShortFilmsPage } from './TvPages';
import { TvChannelLayout, resolveChannelRoute } from './TvPlayer';
import {
  TvFullscreenProvider, TvIdleProvider, TvLibraryProvider, TvRemoteProvider, TvShaderTransitionProvider, TvShellProvider, useTvLibrary,
} from './TvState';

/** Flow TV's home picks a clip at random and plays it in Mixing; a fresh `h` picks again. */
const Home: React.FC = () => {
  const { library } = useTvLibrary();
  const navigate = useNavigate();
  const { search } = useLocation();
  useEffect(() => {
    if (!library) return;
    const g = randomGeneration(library);
    if (g) navigate(tvClipPath(g.channelSlug, g.id, { random: true }), { replace: true });
  }, [library, search, navigate]);
  return library && !library.channels.length ? <TvEmptyPage /> : null;
};

type PageKind = 'home' | 'channel' | 'channels' | 'short-films' | 'faq' | 'search' | 'not-found' | 'loading';

function pageKind(route: TvRoute, location: Location, library: ReturnType<typeof useTvLibrary>['library']): PageKind {
  if (!isChannelRoute(route)) return route.kind;
  if (!library) return 'loading';
  return resolveChannelRoute(library, route, location.search) ? 'channel' : 'not-found';
}

const Page: React.FC<{ kind: PageKind }> = ({ kind }) => {
  switch (kind) {
    case 'home': return <Home />;
    case 'channel': return <TvChannelLayout />;
    case 'channels': return <TvChannelsPage />;
    case 'short-films': return <TvShortFilmsPage />;
    case 'faq': return <TvFaqPage />;
    case 'search': return <TvSearchPage />;
    case 'not-found': return <TvErrorPage />;
    default: return null;
  }
};

/** A page as it was at `location`: the one on its way out keeps seeing the route it was for. */
const FrozenPage: React.FC<{ location: Location; kind: PageKind }> = ({ location, kind }) => (
  <Routes location={location}>
    <Route path="*" element={<Page kind={kind} />} />
  </Routes>
);

/**
 * Flow TV's SharedRouterTransition: between pages, the old one fades out (0.2s) before the new
 * fades in, and the page starts at the top. A channel's pages count as one: its own transitions
 * run inside it.
 */
const PageTransition: React.FC<{ scroller: React.RefObject<HTMLElement | null> }> = ({ scroller }) => {
  const location = useLocation();
  const { library } = useTvLibrary();
  const kind = pageKind(parseTvPath(location.pathname), location, library);
  const ref = useRef<HTMLElement>(null);
  const [shownKind, setShownKind] = useState<PageKind>(kind);
  const leaving = shownKind !== kind;
  const lastLocation = useRef(location);
  if (!leaving) lastLocation.current = location;
  useEffect(() => {
    if (!leaving) return;
    const out = ref.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'linear', fill: 'forwards' });
    let live = true;
    void (out ? out.finished.catch(() => undefined) : Promise.resolve()).then(() => {
      if (!live) return;
      scroller.current?.scrollTo(0, 0);
      setShownKind(kind);
    });
    return () => { live = false; };
  }, [leaving, kind, scroller]);
  const entered = useRef(shownKind);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || leaving || entered.current === shownKind) return;
    entered.current = shownKind;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear' });
  }, [shownKind, leaving]);
  return (
    <main ref={ref}>
      <FrozenPage key={shownKind} location={leaving ? lastLocation.current : location} kind={shownKind} />
    </main>
  );
};

const Shell: React.FC<{ rootRef: React.RefObject<HTMLDivElement | null> }> = ({ rootRef }) => {
  const { pathname } = useLocation();
  const [hasPrevious, setHasPrevious] = useState(false);
  const first = useRef(pathname);
  useEffect(() => {
    if (pathname !== first.current) setHasPrevious(true);
  }, [pathname]);
  return (
    <>
      <TvHeader />
      <TvSubHeader hasPrevious={hasPrevious} />
      <PageTransition scroller={rootRef} />
      <TvShareDialog />
    </>
  );
};

export default function WillowTV(): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.title;
    document.title = 'Willow TV';
    return () => { document.title = before; };
  }, []);
  return (
    <div ref={rootRef} className="wtv-root">
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden dangerouslySetInnerHTML={{ __html: TV_ICON_SPRITE }} />
      <TvShellProvider>
        <TvLibraryProvider>
          <TvRemoteProvider>
            <TvFullscreenProvider rootRef={rootRef}>
              <TvIdleProvider>
                <TvShaderTransitionProvider>
                  <Shell rootRef={rootRef} />
                </TvShaderTransitionProvider>
              </TvIdleProvider>
            </TvFullscreenProvider>
          </TvRemoteProvider>
        </TvLibraryProvider>
      </TvShellProvider>
    </div>
  );
}
