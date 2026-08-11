import { canProvideSignals, type ConnectorId } from '@willow/personal';

/**
 * Bridges this tab's card ids to the connectors that actually exist.
 *
 * The two id sets overlap but are not the same set, and pretending otherwise is
 * how a card ends up with a working-looking switch that grants nothing. The card
 * list is a catalogue of everything Gemini shows; `CONNECTORS` is the much
 * shorter list Willow can really request scopes for. Anything absent here has no
 * connector at all and must stay visibly inert rather than flip a local boolean.
 *
 * `keep` is the interesting omission: it is a Workspace child like the other
 * five, but Google publishes no OAuth scope a public client can use for it, so
 * it is unmapped on purpose, not by oversight.
 */

/** Workspace children, in the order the card renders them. */
export const WORKSPACE_CONNECTORS: ConnectorId[] = ['gmail', 'calendar', 'docs', 'drive', 'tasks'];

/**
 * Card id -> connectors that card controls.
 *
 * The `workspace` parent owns five at once because its card has a single switch.
 * That is also why connecting it must go through `connectProducts`: five separate
 * `connectProduct` calls would open five popups and the browser would block
 * four of them.
 */
export const CARD_CONNECTORS: Record<string, ConnectorId[]> = {
  workspace: WORKSPACE_CONNECTORS,
  gmail: ['gmail'],
  calendar: ['calendar'],
  docs: ['docs'],
  drive: ['drive'],
  tasks: ['tasks'],
  youtube: ['youtube'],
  contacts: ['contacts'],
};

/** Connectors a card controls, or `[]` when the card is a catalogue entry only. */
export const connectorsForCard = (cardId: string): ConnectorId[] => CARD_CONNECTORS[cardId] ?? [];

/** Whether this card can be connected at all. Drives the inert state in the UI. */
export const isCardConnectable = (cardId: string): boolean => connectorsForCard(cardId).length > 0;

/**
 * Whether any connector behind this card feeds the profile.
 *
 * Read from the registry rather than hardcoded, so a connector that flips
 * `providesSignals` does not need a second edit here. Drive and Docs are `false`
 * there deliberately — they are never read for personalization, which is a
 * different statement from "not implemented yet".
 */
export const cardProvidesSignals = (cardId: string): boolean =>
  connectorsForCard(cardId).some((id) => canProvideSignals(id));

/**
 * Just the connectors behind this card that can feed the profile.
 *
 * The Workspace card is why this is separate from `connectorsForCard`: its one
 * "Use for personalization" switch covers five products, of which Drive and Docs
 * are never read for personalization. Flipping that switch over the whole list
 * would mark them as profile sources, which is the exact thing the registry set
 * out to prevent.
 */
export const signalConnectorsForCard = (cardId: string): ConnectorId[] =>
  connectorsForCard(cardId).filter((id) => canProvideSignals(id));
