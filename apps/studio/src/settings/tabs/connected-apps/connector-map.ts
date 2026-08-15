import { providerOf, type ConnectorId, type ConnectorProvider } from '@willow/personal';

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
  spotify: ['spotify'],
  github: ['github'],
};

/** Connectors a card controls, or `[]` when the card is a catalogue entry only. */
export const connectorsForCard = (cardId: string): ConnectorId[] => CARD_CONNECTORS[cardId] ?? [];

/** Whether this card can be connected at all. Drives the inert state in the UI. */
export const isCardConnectable = (cardId: string): boolean => connectorsForCard(cardId).length > 0;

/**
 * Which OAuth providers a card's switch depends on.
 *
 * Needed because "is OAuth set up?" stopped being one question when Spotify arrived.
 * Google's client id and Spotify's are separate environment variables, either can be
 * absent, and a card whose provider is unconfigured has to say so about *its*
 * provider — telling a user their Spotify card needs a Google client id would send
 * them to fix the wrong thing.
 *
 * A list rather than a single value, because nothing stops a future card from
 * spanning two providers. Every card today has exactly one.
 */
export const providersForCard = (cardId: string): ConnectorProvider[] => [
  ...new Set(connectorsForCard(cardId).map(providerOf)),
];

/*
 * There is no `cardProvidesSignals` any more, and its absence is the point.
 *
 * It existed to decide whether to draw a card's second switch, the one asking
 * whether that product could describe the user. One switch per card now: whether a
 * product feeds the profile is `providesSignals` in the registry, a property of the
 * product rather than a preference, and Drive and Docs still never describe anyone.
 */
