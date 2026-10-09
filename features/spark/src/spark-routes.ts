import type { SparkLocation } from './spark-types';

/**
 * Spark's URLs, Gemini's own: `/spark`, `/spark/tasks`, `/spark/schedules`,
 * `/spark/skills`, `/spark/apps` and `/spark/chat/<id>`, plus Willow's
 * `/spark/dots`, `/spark/pages` and the desktop app's `/spark/pets`. Pages runs Codex's router, whose paths are
 * `/space` and `/space/<page id>`; they appear as `/spark/pages…`, without their
 * query, which stays in the history entry's state. The schedule and skill
 * editors have none of their own in Gemini, and stay on the list they edit.
 *
 * The page itself lives in `sparkLocation` (and in each history entry's state,
 * `SPARK_HISTORY_STATE_KEY`); the shell keeps the address bar in step with it
 * (`apps/studio` ShellRouteSync).
 */
export const sparkPathFor = (location: SparkLocation): string => {
  switch (location.page) {
    case 'home':
      return '/spark';
    case 'all-tasks':
      return '/spark/tasks';
    case 'task':
      return `/spark/chat/${encodeURIComponent(location.taskId)}`;
    case 'schedules':
    case 'schedule-editor':
      return '/spark/schedules';
    case 'skills':
    case 'skill-editor':
      return '/spark/skills';
    case 'apps':
      return '/spark/apps';
    case 'pets':
      return '/spark/pets';
    case 'dots':
      return location.dotId ? `/spark/dots/${encodeURIComponent(location.dotId)}` : '/spark/dots';
    case 'pages':
      return `/spark/pages${location.path.replace(/[?#].*$/, '').replace(/^\/space(?=\/|$)/, '')}`;
  }
};

/** A Pages URL, already encoded, or the `/spark/space…` one it had before it was named Pages. */
const PAGES_PATH = /^\/spark\/(?:pages|space)(\/.*)?$/;

/** The page a Spark URL names, or null for a path that is not one of them. */
export const sparkLocationForPath = (pathname: string): SparkLocation | null => {
  const pages = PAGES_PATH.exec(pathname);
  if (pages) return { page: 'pages', path: `/space${(pages[1] ?? '').replace(/\/$/, '')}` };
  const match = /^\/spark(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/.exec(pathname);
  if (!match) return null;
  const [, section, id] = match;
  if (!section) return { page: 'home' };
  if (id === undefined) {
    if (section === 'tasks') return { page: 'all-tasks' };
    if (section === 'schedules') return { page: 'schedules' };
    if (section === 'skills') return { page: 'skills' };
    if (section === 'apps') return { page: 'apps' };
    if (section === 'pets') return { page: 'pets' };
    if (section === 'dots') return { page: 'dots' };
    return null;
  }
  if (section !== 'chat' && section !== 'dots') return null;
  try {
    const decoded = decodeURIComponent(id);
    if (!decoded) return null;
    return section === 'dots' ? { page: 'dots', dotId: decoded } : { page: 'task', taskId: decoded };
  } catch {
    return null;
  }
};
