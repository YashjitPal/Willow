/**
 * Installing the token sources — one call, every provider.
 *
 * There are three flows behind Connected Apps and they have nothing in common at the
 * wire level: Google is a vendor script and a hidden iframe, Spotify is a hash, a popup
 * and a refresh token on disk, GitHub is a string the user pasted. Callers should not
 * have to know that. They ask for connectors to be usable and get told, per provider,
 * whether they are.
 *
 * This has to run at app boot rather than when Settings opens, and that is the
 * correction it exists to make. Installing the source is what lets
 * `refreshAuthorizations` find out which grants survived the reload, and the tool
 * surface is built from that answer — so while the only caller was the Connected
 * Apps tab, a user who reloaded and went straight to the chat had every connector
 * marked unauthorized and every connector tool withheld. Nothing was broken and
 * nothing worked, until they happened to open Settings.
 *
 * All three installs are idempotent and cheap on a second call, which they need to be:
 * this runs from a React effect that re-runs on an account switch, twice in
 * development under StrictMode.
 */

import { initBrowserTokenSource } from './gis-token-source';
import { initGithubTokenSource } from './github/pat-token-source';
import { initSpotifyTokenSource } from './spotify/pkce-token-source';

export interface TokenSourceStatus {
  /** Google Identity Services loaded and a client id was configured. */
  google: boolean;
  /** A Spotify client id was configured. No script to load, so this is immediate. */
  spotify: boolean;
  /**
   * A GitHub token is held for this tab.
   *
   * The one status that is not about the build. There is nothing to configure — no
   * client id exists, because there is no OAuth client — so this reports whether the
   * user has actually pasted a token, which is the only thing that can stop GitHub
   * working. It is therefore false on every fresh tab, and the card says what to do
   * about that rather than blaming the build.
   */
  github: boolean;
}

export interface InstallOptions {
  /**
   * The signed-in Google account, passed to Google's consent screen as the login
   * hint. It is what turns connecting into one Allow click instead of an account
   * chooser followed by a sign-in. Spotify has no equivalent and needs none.
   */
  loginHint?: string;
}

/**
 * Install every configured provider's token source.
 *
 * The two synchronous ones first, so that by the time Google's install kicks the
 * silent authorization refresh there are Spotify and GitHub sources in place for it to
 * use. The other order costs a second refresh — harmless, since the refresh is
 * single-flighted, but it would leave those two unauthorized for the length of a
 * Google round trip and a chat turn inside that window would be missing its tools.
 */
export const initConnectorTokenSources = async (
  options: InstallOptions = {},
): Promise<TokenSourceStatus> => {
  const spotify = initSpotifyTokenSource();
  const github = initGithubTokenSource();
  const google = await initBrowserTokenSource({ loginHint: options.loginHint });
  return { google, spotify, github };
};
