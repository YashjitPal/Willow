import { atom } from 'nanostores';
import type { SparkLocation } from '@willow/spark/spark-types';

/** A Spark page that is not one of Bots': what the rail's Spark goes back to. */
type SparkPlace = Exclude<SparkLocation, { page: 'dots' }>;

type RailReturns = {
  media: string | null;
  code: string | null;
  /** The bot left open in Bots, by id. */
  dots: string | null;
  spark: SparkPlace | null;
};

const EMPTY: RailReturns = { media: null, code: null, dots: null, spark: null };

/** Kept for the session: the page reloads under the user (an update, the agents starting), and the places stay. */
const STORAGE_KEY = 'willow:rail-returns';

const readStored = (): RailReturns => {
  try {
    const saved = JSON.parse(globalThis.sessionStorage?.getItem(STORAGE_KEY) ?? 'null') as Record<string, unknown> | null;
    const spark = saved?.spark as { page?: unknown } | null | undefined;
    return {
      media: typeof saved?.media === 'string' ? saved.media : null,
      code: typeof saved?.code === 'string' ? saved.code : null,
      dots: typeof saved?.dots === 'string' ? saved.dots : null,
      // Checked in full as it is opened (rail-navigation.ts), with Spark's own rules.
      spark: spark && typeof spark === 'object' && typeof spark.page === 'string' && spark.page !== 'dots'
        ? spark as SparkPlace
        : null,
    };
  } catch {
    return EMPTY;
  }
};

/**
 * Where the desktop rail's buttons go back to, each its own tab: the Media or Code project the user
 * left there (its address, `/media…` or `/project1?…`), the bot left open in Bots, the page left in
 * Spark — or null for the landing (`/create`, `/code`, the bots list, Spark's home). Left for another
 * rail destination, a project waits there as it was, its screen kept mounted (App's MediaKeepAlive
 * and CodeProjectScreens), until the user goes to that landing. Bots and Spark share one location in
 * Spark's store, so each keeps its own here.
 */
export const $railReturns = atom<RailReturns>(readStored());

const remember = (next: RailReturns): void => {
  const current = $railReturns.get();
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  $railReturns.set(next);
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Unstored, the places last until the page reloads.
  }
};

/** Whether the page has noted its first address since it loaded. */
let noted = false;

/**
 * Notes where the user is, from the address. A landing's address clears its place only once the user
 * goes there with it on show: an agent tab opened from a project puts the shell, behind it, back on
 * the surface it last showed — `/create` from a Media project — and the project was not left for
 * that; nor for the address a reload comes back on, which is where the shell behind such a tab was.
 */
export const noteRailPlace = (pathname: string, search: string, landingOnShow = true): void => {
  const leaving = landingOnShow && noted;
  noted = true;
  const current = $railReturns.get();
  let { media, code } = current;
  if (pathname === '/media' || pathname.startsWith('/media/')) media = pathname + search;
  else if (pathname === '/create' && leaving) media = null;
  if (pathname === '/project1') code = pathname + search;
  else if ((pathname === '/code' || pathname.startsWith('/code/')) && leaving) code = null;
  remember({ ...current, media, code });
};

/** Notes where Spark is: a bot in Bots, or a page of Spark's own. Its home and the bots list are landings. */
export const noteSparkPlace = (location: SparkLocation): void => {
  const current = $railReturns.get();
  if (location.page === 'dots') remember({ ...current, dots: location.dotId ?? null });
  else remember({ ...current, spark: location.page === 'home' ? null : location });
};
