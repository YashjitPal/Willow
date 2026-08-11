import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { useAuth } from '@willow/auth/AuthContext';
import {
  connectProducts,
  connectionsStore,
  connectorsConfigured,
  disconnectProduct,
  initBrowserTokenSource,
  setFeedsProfile,
  type ConnectOutcome,
} from '@willow/personal';

import {
  cardProvidesSignals,
  connectorsForCard,
  isCardConnectable,
  signalConnectorsForCard,
} from './connector-map';

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
 * The tab renders; this decides.
 */

/** Whether OAuth is usable. `null` while the GIS script is still loading. */
export type ConfiguredState = boolean | null;

export interface CardConnectionState {
  /** There is at least one real connector behind this card. */
  connectable: boolean;
  connected: boolean;
  /** Whether this card's data may describe the user. */
  feedsProfile: boolean;
  /** Whether it could, if the user allowed it. */
  providesSignals: boolean;
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
   */
  const stateFor = useCallback(
    (cardId: string): CardConnectionState => {
      const ids = connectorsForCard(cardId);
      return {
        connectable: isCardConnectable(cardId),
        connected: ids.length > 0 && ids.every((id) => connections.enabled.includes(id)),
        feedsProfile: ids.some((id) => connections.signalSources.includes(id)),
        providesSignals: cardProvidesSignals(cardId),
        busy: busyCardId === cardId,
      };
    },
    [busyCardId, connections],
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
   * This must run straight off the click. Anything that awaits before calling
   * `request` loses the user-gesture the browser requires for a popup, and the
   * failure is silent.
   */
  const toggleConnection = useCallback(
    async (cardId: string, cardName: string) => {
      const ids = connectorsForCard(cardId);
      if (ids.length === 0 || busyCardId) return;

      const isOn = ids.every((id) => connectionsStore.get().enabled.includes(id));
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
    [busyCardId],
  );

  /**
   * Whether a connected product may describe the user.
   *
   * A separate decision from connecting it, and separately reversible. Someone
   * can connect Calendar so Willow can see their week without agreeing that
   * their meeting titles become stored facts about them.
   */
  const toggleFeedsProfile = useCallback((cardId: string) => {
    const ids = signalConnectorsForCard(cardId);
    if (ids.length === 0) return;
    const { signalSources } = connectionsStore.get();
    const feeds = ids.some((id) => signalSources.includes(id));
    for (const id of ids) setFeedsProfile(id, !feeds);
  }, []);

  return {
    configured,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    stateFor,
    toggleConnection,
    toggleFeedsProfile,
  };
};
