/**
 * The popup half of the PKCE flow.
 *
 * Spotify sends the user back to `/oauth/spotify?code=…&state=…`, which under the
 * SPA rewrite is served `index.html` — so without this, the popup would boot a
 * second full copy of Willow: another React tree, another auth listener, another
 * set of stores reading the same localStorage. It would work, and it would be an
 * absurd amount of machinery to read two query parameters.
 *
 * So this runs first, from `main.tsx`, before anything is rendered. It posts the
 * code to the opener, closes the window, and reports that the caller should render
 * nothing at all.
 *
 * The verifier is deliberately *not* used here. It lives in the opener's
 * `sessionStorage` and the exchange happens there, so this window never holds
 * anything that could be redeemed — it carries a single-use code across a
 * same-origin `postMessage` and then ceases to exist.
 */

const CALLBACK_PATH = '/oauth/spotify';

/** The message shape the token source listens for. */
export interface SpotifyCallbackMessage {
  source: 'willow-oauth-spotify';
  code?: string;
  state?: string;
  error?: string;
}

export const isSpotifyCallback = (): boolean =>
  typeof window !== 'undefined' && window.location.pathname === CALLBACK_PATH;

/**
 * Hand the code to the opener and close. Returns true when this window was a
 * callback and the caller must not boot the app.
 *
 * `window.location.origin` as the target origin, not `'*'`: the opener is Willow on
 * this same origin, and a wildcard would broadcast an authorization code to whatever
 * else might be listening.
 */
export const handleSpotifyCallback = (): boolean => {
  if (!isSpotifyCallback()) return false;

  const params = new URLSearchParams(window.location.search);
  const message: SpotifyCallbackMessage = {
    source: 'willow-oauth-spotify',
    ...(params.get('code') ? { code: params.get('code')! } : {}),
    ...(params.get('state') ? { state: params.get('state')! } : {}),
    ...(params.get('error') ? { error: params.get('error')! } : {}),
  };

  try {
    window.opener?.postMessage(message, window.location.origin);
  } catch {
    // No opener, or a closed one. Nothing to hand the code to.
  }

  try {
    window.close();
  } catch {
    // Some browsers refuse to close a window script did not open. The document
    // below is what the user sees if that happens, so it must say something.
  }

  // A window that refused to close should not sit on a blank page. No markup from
  // the query string reaches this — `textContent`, never `innerHTML`, because the
  // one thing in scope here is attacker-supplied URL parameters.
  try {
    document.title = 'Spotify connected';
    const note = document.createElement('p');
    note.textContent = params.get('error')
      ? 'Spotify was not connected. You can close this window.'
      : 'Spotify connected. You can close this window.';
    note.setAttribute(
      'style',
      'font: 15px system-ui, sans-serif; padding: 32px; color: #e3e3e3; background: #1b1b1b;',
    );
    document.body.replaceChildren(note);
  } catch {
    // Nothing worth failing over.
  }

  return true;
};
