import type { SparkLocation } from '@willow/spark/spark-types';
import { sparkLocationForPath, sparkPathFor } from '@willow/spark/spark-routes';

/**
 * The main shell's surfaces and their URLs.
 *
 * Gemini's where Gemini has the surface — `/app` for a new chat, `/app/<id>` for
 * one, `/images` and `/videos` for a new chat on a creation page, Spark's `/spark/…` —
 * and Willow's own otherwise: `/code` and
 * `/code/<chat>` for the Code tab and its chats, `/create` for the Media home
 * (`/media` is the Media editor's, project and all). `/` is no surface: the shell
 * replaces it with the one on show.
 *
 * A chat's id is its name, so that is what the address shows.
 */
/** Gemini's creation pages: a new chat with the Images or Videos tool picked from the sidebar. */
export type CreationPage = 'images' | 'videos';

export type ShellRoute =
  | { surface: 'chat'; chatId: string | null; page?: CreationPage }
  | { surface: 'code'; chatId: string | null }
  | { surface: 'media' }
  | { surface: 'spark'; location: SparkLocation };

/*
 * `encodeURIComponent` leaves dots alone, and a last segment with a dot in it reads
 * as a file to a dev server deciding whether to serve the app.
 */
const encodeChatId = (chatId: string): string => encodeURIComponent(chatId).replace(/\./g, '%2E');

const decodeChatId = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment) || null;
  } catch {
    return null;
  }
};

export const shellPathFor = (route: ShellRoute): string => {
  switch (route.surface) {
    case 'chat':
      if (route.chatId) return `/app/${encodeChatId(route.chatId)}`;
      return route.page ? `/${route.page}` : '/app';
    case 'code':
      return route.chatId ? `/code/${encodeChatId(route.chatId)}` : '/code';
    case 'media':
      return '/create';
    case 'spark':
      return sparkPathFor(route.location);
  }
};

/** The surface a path names, or null for `/` and for every path that is not one. */
export const parseShellPath = (pathname: string): ShellRoute | null => {
  const chat = /^\/(app|code)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (chat) {
    const chatId = chat[2] === undefined ? null : decodeChatId(chat[2]);
    if (chat[2] !== undefined && chatId === null) return null;
    return chat[1] === 'app' ? { surface: 'chat', chatId } : { surface: 'code', chatId };
  }
  const page = /^\/(images|videos)\/?$/.exec(pathname);
  if (page) return { surface: 'chat', chatId: null, page: page[1] as CreationPage };
  if (/^\/create\/?$/.test(pathname)) return { surface: 'media' };
  const location = sparkLocationForPath(pathname);
  return location ? { surface: 'spark', location } : null;
};

/** A path the shell owns: `/` or one of the surfaces'. Every other path keeps its own URL. */
export const isShellPath = (pathname: string): boolean => pathname === '/' || parseShellPath(pathname) !== null;

/** The query the shell keeps when it rewrites a path: `?mode=` (and `?tab=`) are read once, into the surface. */
export const shellSearch = (search: string): string => {
  const params = new URLSearchParams(search);
  params.delete('mode');
  params.delete('tab');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
};
