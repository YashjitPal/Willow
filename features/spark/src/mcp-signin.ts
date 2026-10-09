/**
 * Signing in to an MCP server from the desktop app. The companion opens a one-off address on this computer's loopback
 * and the sign-in page in the user's own browser, and hands back where the page sent them
 * (`services/local-companion/src/oauth.mjs`); the protocol itself — discovery, registration, PKCE, tokens — is
 * `@willow/ai/mcp/mcp-oauth`, run through the store's `signInMcpServer`.
 */
import { McpOAuthError } from '@willow/ai/mcp/mcp-oauth';
import { signInMcpServer, type McpServerConfig } from '@willow/ai/mcp/mcp-store';
import { localCompanion } from '@willow/code/local-companion';
import { isDesktopApp } from '@willow/core/desktop-bridge';

type Answer = { id?: string; code?: string; state?: string; error?: string; errorDescription?: string };

/** Whether this window can sign in to apps: the desktop app, with a companion that offers it. */
export const canSignIn = async (): Promise<boolean> => {
  if (!isDesktopApp()) return false;
  try {
    return (await localCompanion.connect(1_500)) && localCompanion.capabilities.includes('oauth');
  } catch {
    return false;
  }
};

let signsIn: Promise<boolean> | null = null;
/** `canSignIn` for the rows that offer it, asked again only while the answer is no (the companion may still be starting). */
export const canSignInHere = (): Promise<boolean> => {
  signsIn ??= canSignIn().then((yes) => {
    if (!yes) signsIn = null;
    return yes;
  });
  return signsIn;
};

/** What a failed sign-in says: the sentence, and the service's own words when it gave any. */
export const signInProblem = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof McpOAuthError && error.detail && !/^\d+$/.test(error.detail) ? ` (${error.detail.slice(0, 140)})` : '';
  return `${message}${detail}`;
};

/** Whether a sign-in failed because the service wants an app of the user's own. */
export const needsOwnApp = (error: unknown): boolean => error instanceof McpOAuthError && error.code === 'no-registration';

/** A redirect address a user's own app was registered with, as the listener's port, path and host. */
export const listenerFor = (redirect?: string): { port?: number; path?: string; host?: 'localhost' | '127.0.0.1' } => {
  if (!redirect) return {};
  const url = new URL(redirect);
  return { port: Number(url.port) || 80, path: url.pathname || '/', host: url.hostname === 'localhost' ? 'localhost' : '127.0.0.1' };
};

/**
 * Signs in to a server and connects it. `client` and `redirect` are the user's own app, for services that do not let
 * apps register themselves; the redirect is the address that app was registered with.
 */
export async function signInFromDesktop(config: McpServerConfig, options: { client?: { clientId: string; clientSecret?: string }; redirect?: string } = {}): Promise<void> {
  if (!(await canSignIn())) throw new Error('Signing in to apps works in the Willow desktop app.');
  const { id, redirectUri } = await localCompanion.request<{ id: string; redirectUri: string }>('oauth.listen', listenerFor(options.redirect), 15_000);
  try {
    await signInMcpServer(config, {
      redirectUri,
      ...(options.client ? { client: options.client } : {}),
      openAndWait: (url) => new Promise<Answer>((resolve, reject) => {
        const off = localCompanion.onMessage((message) => {
          if (message.type !== 'event' || message.event !== 'oauth.callback') return;
          const answer = message.payload as Answer;
          if (answer.id !== id) return;
          off();
          resolve(answer);
        });
        localCompanion.request('oauth.open', { url }, 15_000).catch((error) => {
          off();
          reject(error);
        });
      }),
    });
  } finally {
    void localCompanion.request('oauth.cancel', { id }, 5_000).catch(() => undefined);
  }
}
