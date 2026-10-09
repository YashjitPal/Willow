import { matchPath, type Location, type NavigateFunction } from "react-router-dom";
import { sparkPathFor } from "../spark-routes";
import { useSpacesStore, WORKSPACE_ID } from "./state";

export interface PageListOrigin {
  accountId: string;
  location: Location;
  pageId: string;
}

/** Location state the Pages screens read and write. */
export interface SpacesLocationState {
  sidebarDestinationId?: string;
  spaceSidebarAccountId?: string;
  spaceSidebarPersonal?: boolean;
  spaceSidebarPageId?: string;
  spaceSidebarRootPageId?: string;
  pageListOrigin?: PageListOrigin;
  scrollPageToTop?: boolean;
  focusPageTitle?: boolean;
}

/** `q8` (`YX`): remembers the Pages home a Page was opened from. */
export function pageListOriginState(location: Location, accountId: string, pageId: string): Pick<SpacesLocationState, "pageListOrigin"> {
  return { pageListOrigin: location.pathname === "/space" ? { accountId, location, pageId } : undefined };
}

/** `H8` (`Jza`): the Page the current route shows. */
export function currentSpacePageId(pathname: string) {
  return matchPath("/space/:pageId", pathname)?.params.pageId;
}

/** Opens a Page, remembering the list it was opened from. */
export function openPage(navigate: NavigateFunction, location: Location, pageId: string) {
  void navigate(`/space/${pageId}`, {
    state: { ...pageListOriginState(location, WORKSPACE_ID, pageId), scrollPageToTop: currentSpacePageId(location.pathname) === pageId } satisfies SpacesLocationState,
  });
}

/** Creates an untitled Page, a subpage when `parentPageId` is given, and opens it with its title focused. */
export function createAndOpenPage(navigate: NavigateFunction, location: Location, parentPageId?: string) {
  const page = useSpacesStore.getState().createPage({ parentPageId });
  void navigate(`/space/${page.page_id}`, {
    state: { ...pageListOriginState(location, WORKSPACE_ID, page.page_id), focusPageTitle: true } satisfies SpacesLocationState,
  });
  return page;
}

/** `GZ` for Pages. */
export function pageUri(pageId: string) {
  return `page://${pageId}`;
}

/** `Gq` without a title: a Markdown link with its label and destination escaped. */
export function markdownLink(text: string, url: string) {
  const label = text.replaceAll("\\", "\\\\").replaceAll("](", "]\\(").replaceAll("]", "\\]");
  const destination = url.replaceAll("\\", "\\\\").replaceAll(")", "\\)");
  return `[${label}](${destination})`;
}

/** `MH`: composer text that references a Page, followed by an encoded space. */
export function pageMentionPrompt(pageId: string, title: string | null | undefined) {
  return `${markdownLink(title?.replace(/[\r\n]+/gu, " ").replaceAll("](", "] (").trim() || pageId, pageUri(pageId))}&#x20;`;
}

/** `tW` with `prefillPrompt`: an unsent chat on Home. */
export function startChatWithPrompt(navigate: NavigateFunction, prefillPrompt: string) {
  void navigate("/", { state: { prefillPrompt, focusComposerNonce: Date.now() } });
}

/** The shareable URL `uko` copies for a Page, at Willow's own address for it. */
export function pageShareUrl(pageId: string) {
  return new URL(sparkPathFor({ page: "pages", path: `/space/${encodeURIComponent(pageId)}` }), window.location.origin).toString();
}
