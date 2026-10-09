/**
 * The Tools pages' addresses, inside Media (Flow's are /project/<id>/tools, /tool/<id>,
 * /create-tool): /media/tools, /media/tool/<id>?mode=APP|EDIT&fromViewSource=tools and
 * /media/create-tool. Every one keeps the Media query (`projectId`), so the project stays open
 * underneath. The manager's tab is not in the address, as in Flow, but in the user's prefs.
 */

export type ToolMode = 'APP' | 'EDIT';

export type ToolsRoute =
  | { page: 'manager' }
  | { page: 'create' }
  | { page: 'view'; toolId: string; mode: ToolMode | null; from: string | null };

export const TOOLS_PATH = '/media/tools';
export const CREATE_TOOL_PATH = '/media/create-tool';
const TOOL_PREFIX = '/media/tool/';

export function parseToolsRoute(pathname: string, search: string): ToolsRoute | null {
  const path = pathname.replace(/\/+$/, '');
  if (path === TOOLS_PATH) return { page: 'manager' };
  if (path === CREATE_TOOL_PATH) return { page: 'create' };
  if (path.startsWith(TOOL_PREFIX)) {
    const toolId = decodeURIComponent(path.slice(TOOL_PREFIX.length).split('/')[0] || '');
    if (!toolId) return null;
    const params = new URLSearchParams(search);
    const mode = params.get('mode');
    return { page: 'view', toolId, mode: mode === 'EDIT' || mode === 'APP' ? mode : null, from: params.get('fromViewSource') };
  }
  return null;
}

export const isToolsPath = (pathname: string): boolean => parseToolsRoute(pathname, '') !== null;

/** The Media query to carry, without the Tools pages' own parameters. */
function mediaQuery(search: string): URLSearchParams {
  const params = new URLSearchParams(search);
  params.delete('mode');
  params.delete('fromViewSource');
  return params;
}

const withQuery = (pathname: string, params: URLSearchParams): { pathname: string; search: string } => {
  const q = params.toString();
  return { pathname, search: q ? `?${q}` : '' };
};

export const toolsLocation = (search: string) => withQuery(TOOLS_PATH, mediaQuery(search));

export const createToolLocation = (search: string) => withQuery(CREATE_TOOL_PATH, mediaQuery(search));

export function toolLocation(search: string, toolId: string, options: { mode?: ToolMode; from?: string | null } = {}) {
  const params = mediaQuery(search);
  if (options.mode) params.set('mode', options.mode);
  if (options.from) params.set('fromViewSource', options.from);
  return withQuery(`${TOOL_PREFIX}${encodeURIComponent(toolId)}`, params);
}

/** Back to the gallery from a Tools page. */
export const galleryLocation = (search: string) => withQuery('/media', mediaQuery(search));
