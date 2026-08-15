import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { useAuth } from '@willow/auth/AuthContext';
import {
  authorizationStore,
  connectProducts,
  connectionsStore,
  connectorsConfigured,
  disconnectProduct,
  initConnectorTokenSources,
  readGithubLogin,
  saveGithubToken,
  spotifyConfigured,
  type ConnectOutcome,
  type ConnectorProvider,
} from '@willow/personal';

import { connectorsForCard, isCardConnectable, providersForCard } from './connector-map';

/**
 * The Connected Apps tab's state, kept out of the tab itself.
 *
 * Everything here follows from one fact: a card's switch is not a boolean this
 * page owns. Turning a card on means asking a provider for scopes, which can be
 * declined, can fail, and takes as long as the user takes to read a consent
 * screen. So the switch reads from `connectionsStore`, which only ever records
 * grants that actually arrived, and this hook owns the three things a plain
 * boolean cannot express: which card is mid-request, why the last attempt did
 * nothing, and whether that card's provider is configured at all.
 *
 * There is one switch per card. There used to be two — connect, and a second one
 * for whether the product could describe the user — and the second is gone. It
 * asked the user to maintain a distinction the app did not really keep: a
 * connected product was readable by the live tools whatever that switch said, so
 * it governed the stored profile while appearing to govern access. What a product
 * may contribute is now a property of the product, in the registry.
 *
 * The tab renders; this decides. That includes why a switch is disabled — the
 * reason is computed here and handed over as a string, because every input to it
 * (busy, connectable, which provider, whether that provider is set up) lives here.
 */

/** Whether a provider's OAuth is usable. `null` while its script is still loading. */
export type ConfiguredState = boolean | null;

/** Per-provider setup, because Google's client id and Spotify's are separate. */
export type ProviderSetup = Record<ConnectorProvider, ConfiguredState>;

export interface CardConnectionState {
  /** There is at least one real connector behind this card. */
  connectable: boolean;
  /**
   * What the switch shows: connected *and* readable.
   *
   * Not the stored connection list. Google issues no refresh token to a browser
   * app, so access lasts about an hour and does not survive the tab — a switch
   * wired to the stored list sits proudly on while every tool behind it is
   * withdrawn, which is a lie the user can see. Off is the honest reading, and it
   * makes the fix the obvious gesture: switch it back on.
   */
  connected: boolean;
  /**
   * The stored connection is still there; only the token lapsed.
   *
   * Drives the notice at the top of the tab, and nothing else. The distinction
   * never reaches the card, because on the card there is nothing to say — the
   * switch is off and turning it on is the same click either way.
   */
  expired: boolean;
  busy: boolean;
  /** Why this switch cannot be used, or null when it can. Also its tooltip. */
  disabledReason: string | null;
}

const declineNotice = (name: string, outcome: ConnectOutcome): string | null => {
  /*
   * `'reason' in outcome`, not `if (outcome.ok)`.
   *
   * This repo compiles with strictNullChecks off (tsconfig.base.json sets no
   * `strict`), and in that mode TypeScript does not narrow a union by the
   * truthiness of a boolean discriminant — `outcome.reason` below then fails to
   * compile. The `in` check narrows either way, so leave it as is.
   */
  if (!('reason' in outcome)) return null;
  switch (outcome.reason) {
    case 'declined':
      // Covers a closed popup and a blocked one; they are indistinguishable here.
      return `${name} wasn’t connected. The permission window was closed or blocked.`;
    case 'needs-token':
      // GitHub only. There is no popup to have closed, so saying one was closed
      // would send the user looking for a permission window that never opened.
      return `${name} needs a read-only access token you create yourself. Paste one on the ${name} card to connect it.`;
    default:
      return `${name} can’t be connected in this build.`;
  }
};

/**
 * What a provider needs before its switches do anything, said in terms of the fix.
 *
 * Named per provider rather than as one "connectors aren't set up" line, because
 * the two are set up independently and the user pointed at the wrong environment
 * variable goes looking for a problem that is not there.
 *
 * GitHub is deliberately absent, and its absence is what keeps this list meaning what
 * it says. These are build problems, shown as a banner at the top of the page, and the
 * user can do nothing about any of them. GitHub is never unconfigured — it has no
 * client id to configure — it is only ever missing a token the user has not pasted yet,
 * which is normal on every fresh tab and is fixed on the card itself. Announcing it up
 * here would put a permanent banner over the page for something that is not wrong.
 */
const SETUP_HINTS: Partial<Record<ConnectorProvider, string>> = {
  google:
    'Connecting Google apps isn’t set up in this build. It needs a Google OAuth client id (VITE_GOOGLE_OAUTH_CLIENT_ID); until then those switches stay off.',
  spotify:
    'Connecting Spotify isn’t set up in this build. It needs a Spotify client id (VITE_SPOTIFY_CLIENT_ID) and this app’s redirect URI registered in the Spotify dashboard.',
};

/**
 * Why a card's switch is unusable, per provider, as a tooltip on the switch itself.
 *
 * Separate from `SETUP_HINTS` because these are two different sentences about two
 * different situations. Google's and Spotify's say the build is missing something and
 * the user cannot act; GitHub's names an action they can take, on the card they are
 * already looking at. One string for both would have to be vague enough to cover both,
 * and a vague reason on a disabled switch is the thing being fixed here.
 */
const NOT_READY_REASONS: Record<ConnectorProvider, string> = {
  google: 'Connecting Google apps isn’t set up in this build.',
  spotify: 'Connecting Spotify isn’t set up in this build.',
  github: 'GitHub needs a read-only access token you create. Paste one on this card first.',
};

/**
 * Fold several providers' setup into one answer for a card.
 *
 * `false` wins over `null`: a card that needs two providers and is missing one is
 * unusable now, and showing "getting ready…" for something that will never be
 * ready is worse than saying so. Every card today has exactly one provider, so
 * this only matters the first time one does not.
 */
const foldSetup = (providers: ConnectorProvider[], setup: ProviderSetup): ConfiguredState => {
  const states = providers.map((provider) => setup[provider]);
  if (states.some((state) => state === false)) return false;
  if (states.some((state) => state === null)) return null;
  return true;
};

export const useConnections = () => {
  const { user } = useAuth();
  const connections = useStore(connectionsStore);
  const authorization = useStore(authorizationStore);
  /*
   * `null` where a client id exists but the source has not finished installing,
   * `false` where there is no client id at all. Reading the environment
   * synchronously here is what keeps an unconfigured build from flashing "getting
   * ready…" over switches that will never work.
   *
   * GitHub's entry is not about the build at all: there is nothing to configure, so it
   * reports whether a token is held, and it is never `null` because there is no script
   * to wait for.
   */
  const [setup, setSetup] = useState<ProviderSetup>(() => ({
    google: connectorsConfigured() ? null : false,
    spotify: spotifyConfigured() ? null : false,
    github: Boolean(readGithubLogin()),
  }));
  const [githubLogin, setGithubLogin] = useState<string | null>(() => readGithubLogin());
  const [busyCardId, setBusyCardId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Install the token sources, naming the signed-in account.
   *
   * The app already does this at boot — see the effect in App.tsx, and
   * `connectors/install.ts` for why it has to happen there rather than here. This
   * call is not a duplicate of it: both installs are idempotent, and this one is
   * how the tab learns the per-provider answer it needs to render. Sharing the one
   * entry point is the point, so the two cannot drift into disagreeing about which
   * providers are usable.
   *
   * The email is what turns Google's consent flow into a single Allow click: the
   * user is already signed into Willow with this account, so passing it as the
   * login hint removes the account chooser. Re-running on an account switch is the
   * point of the dependency — the hint is baked into the source, and a stale one
   * sends the previous user's email to the consent screen.
   *
   * Installing also kicks a silent check of which grants survived the reload,
   * which is what fills in `expired` below without anyone clicking anything.
   */
  useEffect(() => {
    let alive = true;
    void initConnectorTokenSources({ loginHint: user?.email ?? undefined }).then((status) => {
      if (alive) setSetup(status);
    });
    return () => {
      alive = false;
    };
  }, [user?.email]);

  /**
   * A card is "connected" only when every connector behind it is.
   *
   * `every` rather than `some`, because of the Workspace card, whose single
   * switch stands for five products. Showing it on because Gmail alone was
   * connected would claim four grants that were never made.
   *
   * `expired` is `some`, and the asymmetry is deliberate: one lapsed product out
   * of five is enough to take the switch off, because the switch stands for all
   * five and four-fifths of a connection is not a state the card can show.
   *
   * Note which way `unknown` falls. At load the silent refresh has not answered
   * yet, and treating that as expired would flick every switch off and back on a
   * second later on every visit. Only an explicit `expired` turns a card off, so
   * the in-flight case shows the last thing that was true.
   */
  const stateFor = useCallback(
    (cardId: string): CardConnectionState => {
      const ids = connectorsForCard(cardId);
      const stored = ids.length > 0 && ids.every((id) => connections.enabled.includes(id));
      const expired = stored && ids.some((id) => authorization[id] === 'expired');
      const connectable = isCardConnectable(cardId);
      const providers = providersForCard(cardId);
      const configured = foldSetup(providers, setup);
      const busy = busyCardId === cardId;
      const unready = providers.filter((provider) => setup[provider] === false);

      // Ordered by what the user can do about it. "Not available in Willow" is
      // permanent, an unready provider is either the build's problem or a token to
      // paste, and busy is a second away — announcing the last of those first would
      // hide the first two.
      const disabledReason = !connectable
        ? 'This app isn’t available to connect in Willow yet.'
        : unready.length > 0
          ? unready.map((provider) => NOT_READY_REASONS[provider]).join(' ')
          : configured === null
            ? 'Getting ready…'
            : busy
              ? 'Waiting for the permission window…'
              : null;

      return {
        connectable,
        connected: stored && !expired,
        expired,
        busy,
        disabledReason,
      };
    },
    [busyCardId, connections, authorization, setup],
  );


  /**
   * Ask for a card's connectors, whatever card it is.
   *
   * Split out of `toggleConnection` because GitHub connects from somewhere else — the
   * token row on its card, once a pasted token has been verified — and both routes must
   * end in the same call. Two copies of this would be two places for the busy flag and
   * the decline notice to drift apart.
   *
   * Nothing is awaited before `connectProducts`, which is load-bearing for the two
   * providers that open a popup: a browser blocks a popup that is not traceable to the
   * click, and the failure is silent.
   */
  const connectCard = useCallback(
    async (cardId: string, cardName: string): Promise<boolean> => {
      const ids = connectorsForCard(cardId);
      if (ids.length === 0) return false;

      setBusyCardId(cardId);
      setNotice(null);
      try {
        const outcome = await connectProducts(ids);
        setNotice(declineNotice(cardName, outcome));
        return outcome.ok;
      } finally {
        setBusyCardId(null);
      }
    },
    [],
  );

  /**
   * Verify a pasted GitHub token, keep it, and connect the card.
   *
   * The whole of GitHub's consent flow, which happens here rather than at a provider
   * because GitHub has no flow a browser can complete — see
   * `connectors/github/pat-token-source.ts`. Verifying first is what makes this
   * honest: a switch that flips on and then reads nothing is the failure this feature
   * keeps working to avoid, and a mistyped token is the most likely thing to go wrong
   * with a credential a person types by hand.
   *
   * `setup.github` is updated here rather than left to the next install, because the
   * switch is disabled while it is false and the user has just done the one thing that
   * makes it true.
   *
   * A rejected token sets no notice, which is the one place this hook deliberately
   * stays quiet. The notice renders as a banner at the top of the tab, GitHub's card is
   * most of a page below it, and a message about the field the user is looking at is no
   * use where they cannot see it. The caller gets `false` and says so beside the input.
   */
  const connectGithubToken = useCallback(
    async (token: string): Promise<boolean> => {
      setNotice(null);
      const identity = await saveGithubToken(token);
      if (!identity) return false;

      setGithubLogin(identity.login);
      setSetup((prev) => ({ ...prev, github: true }));
      return connectCard('github', 'GitHub');
    },
    [connectCard],
  );

  /**
   * Flip a card, which means opening a consent popup or dropping a token.
   *
   * Connecting always goes through `connectProducts`, even for a one-connector
   * card. It takes a list, so a single id is the same call, and it means the
   * Workspace card's five products are asked for in one consent screen — a loop
   * of five separate requests would open five popups and the browser would block
   * four of them, leaving the user staring at a switch that half-worked.
   *
   * `isOn` has to be read the way the switch is drawn, not from the stored list.
   * A card whose access lapsed shows off while its ids are still stored, so
   * reading the store here would make the click that looks like "connect this"
   * run the disconnect branch — the switch would refuse to move and the user
   * would have deleted their connection to find that out. Reconnecting is then
   * the same code path as connecting, and usually costs no consent screen at all,
   * since the grant still stands on the provider's side.
   *
   * This must run straight off the click. Anything that awaits before calling
   * `request` loses the user-gesture the browser requires for a popup, and the
   * failure is silent.
   */
  const toggleConnection = useCallback(
    async (cardId: string, cardName: string) => {
      const ids = connectorsForCard(cardId);
      if (ids.length === 0 || busyCardId) return;

      const isOn = stateFor(cardId).connected;
      if (isOn) {
        // Local only: this stops Willow using the token and drops any durable
        // grant it held, and leaves revoking the grant itself to the user's own
        // account page at Google or Spotify.
        for (const id of ids) disconnectProduct(id);
        // GitHub's durable grant *is* the pasted token, and `disconnectProduct` has
        // just deleted it, so the card goes back to needing one. Nothing else can
        // notice that on its own: there is no environment variable to re-read.
        if (ids.includes('github')) {
          setGithubLogin(null);
          setSetup((prev) => ({ ...prev, github: false }));
        }
        setNotice(`${cardName} disconnected. Anything already saved to Memory stays until you delete it.`);
        return;
      }

      await connectCard(cardId, cardName);
    },
    [busyCardId, connectCard, stateFor],
  );

  /*
   * The build-level notices, one per unconfigured provider.
   *
   * Said at the top of the tab rather than on each dead switch, because it is one
   * fact with one cause and repeating it beside every card turns a missing
   * environment variable into the loudest thing on the page.
   */
  const setupHints = (Object.keys(SETUP_HINTS) as ConnectorProvider[])
    .filter((provider) => setup[provider] === false)
    .map((provider) => SETUP_HINTS[provider]);

  return {
    setup,
    setupHints,
    githubLogin,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    stateFor,
    toggleConnection,
    connectGithubToken,
  };
};
