/**
 * Signing in to a site for a program that reads it as the user (X Reader): the companion opens the site's sign-in in a
 * browser window of its own and hands back the session's cookies once the user is in
 * (`services/local-companion/src/site-sign-in.mjs`). Desktop app only, as the programs are.
 */
import { localCompanion } from '@willow/code/local-companion';
import { isDesktopApp } from '@willow/core/desktop-bridge';
import type { McpSession } from './mcp-catalog';

/** Whether this window can open a site's sign-in: the desktop app, with a companion that does. */
export const canSignInToSites = async (): Promise<boolean> => {
  if (!isDesktopApp()) return false;
  try {
    return (await localCompanion.connect(1_500)) && localCompanion.capabilities.includes('site-sign-in');
  } catch {
    return false;
  }
};

let signsIn: Promise<boolean> | null = null;
/** `canSignInToSites` for the rows that offer it, asked again only while the answer is no (the companion may still be starting). */
export const canSignInToSitesHere = (): Promise<boolean> => {
  signsIn ??= canSignInToSites().then((yes) => {
    if (!yes) signsIn = null;
    return yes;
  });
  return signsIn;
};

/** How a site's sign-in ended: its cookies as `presetServer` takes them, the user giving up, or what went wrong. */
export type SiteSignIn = { entry: string } | { cancelled: true } | { problem: string };

/** Opens `session.site`'s sign-in and waits for the user, as long as the companion keeps its window open. */
export const signInToSite = async (session: McpSession): Promise<SiteSignIn> => {
  let answer: { cookies?: Record<string, string>; cancelled?: boolean };
  try {
    answer = await localCompanion.request('site.signIn', { site: session.site }, 11 * 60_000);
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
  const cookies = answer.cookies;
  if (!cookies) return { cancelled: true };
  if (session.cookies.some((name) => !cookies[name])) {
    return { problem: `Signing in to ${session.site} didn’t give Willow its session. Try again, or paste the cookies instead.` };
  }
  return { entry: session.cookies.map((name) => `${name}=${cookies[name]}`).join('; ') };
};

/** Closes the sign-in window this window opened, if one is open. */
export const cancelSiteSignIn = (): void => {
  void localCompanion.request('site.cancel', {}, 5_000).catch(() => undefined);
};
