import { useEffect, useLayoutEffect, useRef } from 'react';
import { IntlProvider, type IntlConfig } from 'react-intl';
import {
  MemoryRouter,
  Navigate,
  UNSAFE_LocationContext,
  UNSAFE_RouteContext,
  useLocation,
  useNavigate,
  useNavigationType,
  useRoutes,
  type RouteObject,
} from 'react-router-dom';
import { sparkLocationForPath } from './spark-routes';
import { goToSparkHome, goToSparkHomeWithPrompt, navigateSpark, replaceSparkLocation } from './spark-store';
import { spacesRoutes } from './spaces/routes';
import { SpacesShell } from './spaces/willow/SpacesShell';
import { resetRightPanel } from './spaces/willow/shell/right-panel-state';

const isPagesPath = (pathname: string) => /^\/space(\/|$)/.test(pathname);

/** A Pages path no route names goes to the Pages home; a path outside Pages is Spark's (`PagesRouterSync`). */
function UnknownPagesPath() {
  const { pathname } = useLocation();
  return isPagesPath(pathname) ? <Navigate to="/space" replace /> : null;
}

const routes: RouteObject[] = [...spacesRoutes, { path: '*', element: <UnknownPagesPath /> }];

/** A Codex composer prompt as plain text for Spark's composer: a Page link reads as its title. */
const plainPrompt = (prompt: string) =>
  prompt
    .replace(/\[((?:\\.|[^\]\\])*)\]\((?:\\.|[^)\\])*\)/g, (_, label: string) => label.replace(/\\(.)/g, '$1'))
    .replaceAll('&#x20;', ' ');

function PagesRoutes() {
  return useRoutes(routes);
}

/** Willow is English only: every message renders its default copy, so missing translations are expected. */
const reportIntlError: IntlConfig['onError'] = (error) => {
  if (error.code !== 'MISSING_TRANSLATION') console.error(error);
};

/** React Router refuses a router inside another; Pages' router starts outside the shell's routes. */
const NO_PARENT_ROUTE = { outlet: null, matches: [], isDataRoute: false };

/**
 * Keeps Spark's location and Pages' router in step. Pages navigates with
 * Codex's own paths (`/space`, `/space/<page>`), which become Spark's `pages`
 * page; a path outside Pages (a bot's conversation, Home) is handed to Spark.
 * Back/Forward and the sidebar move the router the other way.
 */
function PagesRouterSync({ path }: { path: string }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const routerPath = `${location.pathname}${location.search}${location.hash}`;
  const syncedPath = useRef(routerPath);

  useLayoutEffect(() => {
    if (path === syncedPath.current) return;
    syncedPath.current = path;
    if (path !== routerPath) navigate(path, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useLayoutEffect(() => {
    if (routerPath === syncedPath.current) return;
    syncedPath.current = routerPath;
    if (!isPagesPath(location.pathname)) {
      if (location.pathname === '/') {
        const prompt = (location.state as { prefillPrompt?: unknown } | null)?.prefillPrompt;
        if (typeof prompt === 'string' && prompt.trim() !== '') goToSparkHomeWithPrompt(plainPrompt(prompt));
        else goToSparkHome();
        return;
      }
      const spark = sparkLocationForPath(location.pathname.startsWith('/spark') ? location.pathname : `/spark${location.pathname}`);
      if (spark != null) navigateSpark(spark);
      else navigate('/space', { replace: true });
      return;
    }
    const next = { page: 'pages', path: routerPath } as const;
    if (navigationType === 'PUSH') navigateSpark(next);
    else replaceSparkLocation(next);
  }, [routerPath, navigationType, location.pathname, location.state, navigate]);

  return null;
}

/** `/spark/pages…`: Codex's Pages inside Spark. */
export default function SparkPagesPage({ path }: { path: string }) {
  useEffect(() => resetRightPanel, []);
  return (
    <IntlProvider locale="en" defaultLocale="en" onError={reportIntlError}>
      <UNSAFE_LocationContext.Provider value={null as never}>
        <UNSAFE_RouteContext.Provider value={NO_PARENT_ROUTE}>
          <MemoryRouter initialEntries={[path]}>
            <PagesRouterSync path={path} />
            <SpacesShell>
              <PagesRoutes />
            </SpacesShell>
          </MemoryRouter>
        </UNSAFE_RouteContext.Provider>
      </UNSAFE_LocationContext.Provider>
    </IntlProvider>
  );
}
