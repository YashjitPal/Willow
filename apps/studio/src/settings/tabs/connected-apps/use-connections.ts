import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { useAuth } from '@willow/auth/AuthContext';
import {
  authorizationStore,
  connectProducts,
  connectionsStore,
  connectorsConfigured,
  disconnectProduct,
  initBrowserTokenSource,
  type ConnectOutcome,
} from '@willow/personal';

import { connectorsForCard, isCardConnectable } from './connector-map';

/**
 * The Connected Apps tab's state, kept out of the tab itself.
 *
 * Everything here follows from one fact: a card's switch is not a boolean this
 * page owns. Turning a card on means asking Google for scopes, which can be
 * declined, can fail, and takes as long as the user takes to read a consent
 * screen. So the switch reads from `connectionsStore`, which only ever records
 * grants that actually arrived, and this hook owns the three things a plain
 * boolean cannot express: which card is mid-request, why the last attempt did
 * nothing, and whether connectors are configured at all.
 *
 * There is one switch per card. There used to be two — connect, and a second one
 * for whether the product could describe the user — and the second is gone. It
 * asked the user to maintain a distinction the app did not really keep: a
 * connected product was readable by the live tools whatever that switch said, so
 * it governed the stored profile while appearing to govern access. What a product
 * may contribute is now a property of the product, in the registry.
 *
 * The tab renders; this decides.
 */

/** Whether OAuth is usable. `null` while the GIS script is still loading. */
export type ConfiguredState = boolean | null;

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
    default:
      return `${name} can’t be connected in this build.`;
  }
};

export const useConnections = () => {
  const { user } = useAuth();
  const connections = useStore(connectionsStore);
  const authorization = useStore(authorizationStore);
  const [configured, setConfigured] = useState<ConfiguredState>(() =>
    connectorsConfigured() ? null : false,
  );
  const [busyCardId, setBusyCardId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Install the token source, naming the signed-in account.
   *
   * The email is what turns the consent flow into a single Allow click: the user
   * is already signed into Willow with this Google account, so passing it as the
   * login hint removes the account chooser. Re-running on an account switch is
   * the point of the dependency — the hint is baked into the source, and a stale
   * one sends the previous user's email to the consent screen.
   *
   * Installing also kicks a silent check of which grants survived the reload,
   * which is what fills in `expired` below without anyone clicking anything.
   */
  useEffect(() => {
    if (!connectorsConfigured()) {
      setConfigured(false);
      return;
    }
    let alive = true;
    void initBrowserTokenSource({ loginHint: user?.email ?? undefined }).then((ready) => {
      if (alive) setConfigured(ready);
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
      return {
        connectable: isCardConnectable(cardId),
        connected: stored && !expired,
        expired,
        busy: busyCardId === cardId,
      };
    },
    [busyCardId, connections, authorization],
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
   * since the grant still stands on Google's side.
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
        // Local only: this stops Willow using the token, and leaves revoking the
        // grant itself to the user's own Google account page.
        for (const id of ids) disconnectProduct(id);
        setNotice(`${cardName} disconnected. Anything already saved to Memory stays until you delete it.`);
        return;
      }

      setBusyCardId(cardId);
      setNotice(null);
      try {
        const outcome = await connectProducts(ids);
        setNotice(declineNotice(cardName, outcome));
      } finally {
        setBusyCardId(null);
      }
    },
    [busyCardId, stateFor],
  );

  return {
    configured,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    stateFor,
    toggleConnection,
  };
};
