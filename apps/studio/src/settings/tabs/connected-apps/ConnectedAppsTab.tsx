import React, { useCallback, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  APP_CATEGORIES,
  LEARN_MORE_URL,
  PRIVACY_HUB_URL,
  SUBSCRIPTIONS_URL,
  type ChildApp,
  type ConnectedApp,
} from './connectedAppsData';
import { useConnections, type CardConnectionState } from './use-connections';
import { GithubTokenRow } from './GithubTokenRow';
import './ConnectedAppsTab.css';

/**
 * Connected Apps — a clone of gemini.google.com/apps.
 *
 * The geometry, colours and animation timings were measured off the live Gemini
 * page; see connectedAppsData.ts for where the copy came from.
 *
 * The toggles are real. A card with a connector behind it opens that provider's
 * consent screen and, if the user allows it, the product becomes readable by
 * Willow; `use-connections.ts` owns that flow and `connector-map.ts` says which
 * cards have a connector at all. The rest of the catalogue is still here, because
 * it is what the page shows, but those switches are disabled rather than pretending
 * — a switch that flips and grants nothing is worse than one that plainly can't.
 *
 * Spotify's card is the one entry that is not Gemini's. It sits in "Other" with the
 * same chrome as the rest, because a connector Willow added should not look like a
 * different kind of thing from a connector Willow cloned.
 *
 * GitHub's card is Gemini's, but only the logo and the slot survive: theirs imports a
 * repository and reads the code in it, Willow's reads pull requests and issue titles
 * and no code at all, so the copy is rewritten in connectedAppsData.ts. It is also the
 * one card a switch cannot connect, because GitHub publishes no browser sign-in — it
 * carries a `GithubTokenRow` in the `extra` slot instead, and its switch stays disabled
 * until a token has been pasted and verified.
 *
 * "Prompts to try" pills remain inert; they are illustrations of what to ask,
 * not buttons, on Gemini's page too.
 */

interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
  title?: string;
}

/** Gemini's opt-in toggle. No check/cross glyphs — it doesn't render them here. */
const Switch: React.FC<SwitchProps> = ({ checked, disabled = false, label, onChange, title }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    aria-disabled={disabled}
    className={`ca-switch${disabled ? ' ca-switch-disabled' : ''}`}
    disabled={disabled}
    onClick={onChange}
    title={title}
  >
    <span className="ca-switch-track" />
    <span className="ca-switch-handle" />
  </button>
);

interface CapabilityListProps {
  icon: 'check' | 'close';
  items: string[];
  title: string;
}

const CapabilityList: React.FC<CapabilityListProps> = ({ icon, items, title }) => (
  <div className="ca-capability-group">
    <span className="ca-capability-title ca-label-s">{title}</span>
    <div className="ca-capability-list">
      {items.map((item) => (
        <div className="ca-capability-item ca-body-m" key={item}>
          <MaterialSymbol
            className="ca-capability-icon"
            family="google-symbols"
            name={icon}
            size={20}
            weight={400}
          />
          <span>{item}</span>
        </div>
      ))}
    </div>
  </div>
);

const ChildCard: React.FC<{ app: ChildApp }> = ({ app }) => (
  <div className="ca-child-card">
    <div className="ca-child-content">
      <img alt="" aria-hidden="true" className="ca-child-logo" src={app.logo} />
      <div>
        <div className="ca-child-name ca-body-m">{app.name}</div>
        {app.handle ? <div className="ca-child-handle ca-label-s">{app.handle}</div> : null}
        <a className="ca-learn-more" href={LEARN_MORE_URL} rel="noopener noreferrer" target="_blank">
          Learn more
        </a>
      </div>
    </div>
  </div>
);

interface CardProps {
  app: ConnectedApp;
  expanded: boolean;
  state: CardConnectionState;
  onToggle: (id: string, name: string) => void;
  onToggleExpanded: (id: string) => void;
  /**
   * A card-specific control, below the description.
   *
   * One card needs one, and it is GitHub: it cannot be connected by a switch, because
   * GitHub has no browser sign-in, so it carries a field to paste a token into. A slot
   * rather than an `app.id === 'github'` branch inside the card, so the card keeps
   * knowing nothing about which app it is drawing, and so the next connector that needs
   * a control of its own does not add a second branch here.
   */
  extra?: React.ReactNode;
}

/** `[a]` → `a`; `[a, b]` → `a and b`; `[a, b, c]` → `a, b and c`. */
const listNames = (names: string[]): string =>
  names.length <= 1
    ? names[0] ?? ''
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** The Workspace card: full grid width, description beside a grid of child apps. */
const ParentCard: React.FC<CardProps> = ({ app, state, onToggle }) => {
  const reason = state.disabledReason;
  return (
    <div className="ca-parent-card">
      <div className="ca-opt-in-row">
        <img alt="" aria-hidden="true" className="ca-logo" src={app.logo} />
        <div className="ca-toggle-slot">
          <Switch
            checked={state.connected}
            disabled={Boolean(reason)}
            label={`Enables or disables the extension of ${app.name}`}
            onChange={() => onToggle(app.id, app.name)}
            title={reason ?? undefined}
          />
        </div>
      </div>
      <div className="ca-parent-content">
        <div className="ca-parent-title">
          <div className="ca-card-name ca-title-l">{app.name}</div>
          <div className="ca-parent-description ca-body-m">{app.description}</div>
          {/* One switch covers all five children, because Google grants their
              scopes in a single consent screen. Saying so is cheaper than
              letting the user wonder why the children have no switches. */}
          <div className="ca-parent-note ca-label-s">
            One permission screen covers every Workspace app listed here.
          </div>
        </div>
        <div className="ca-child-grid">
          {app.children?.map((child) => (
            <ChildCard app={child} key={child.id} />
          ))}
        </div>
      </div>
    </div>
  );
};

const AppCard: React.FC<CardProps> = ({
  app,
  expanded,
  extra,
  state,
  onToggle,
  onToggleExpanded,
}) => {
  const hasExpandedContent = Boolean(app.can?.length || app.cannot?.length || app.prompts?.length);
  const reason = state.disabledReason;

  return (
    <div
      className={`ca-card${expanded ? ' ca-expanded' : ''}${extra ? ' ca-card-with-control' : ''}`}
    >
      <div className="ca-opt-in-row">
        <img alt="" aria-hidden="true" className="ca-logo" src={app.logo} />
        <div className="ca-toggle-slot">
          <Switch
            checked={state.connected}
            disabled={Boolean(reason)}
            label="Enables or disables the extension"
            onChange={() => onToggle(app.id, app.name)}
            title={reason ?? undefined}
          />
        </div>
      </div>

      <div>
        <div className="ca-card-name ca-title-l">{app.name}</div>
        {app.handle ? <div className="ca-handle ca-label-s">{app.handle}</div> : null}
      </div>


      <div className="ca-collapsed-content">
        <div className="ca-description ca-body-m">{app.description}</div>
        {/* Above "Learn more" because it is the thing to do, and Learn more only
            describes what the app can do once it is connected. It sits in its own
            tinted block so its inner links read as part of the control rather than
            as more of the card's copy. */}
        {extra}
        {hasExpandedContent ? (
          <button
            aria-expanded={expanded}
            className="ca-learn-more"
            onClick={() => onToggleExpanded(app.id)}
            type="button"
          >
            {expanded ? 'Show less' : 'Learn more'}
          </button>
        ) : null}
        {/* Dropped on a card that has a control, which is what keeps that card near
            the height of its neighbours. The pill is 164px of illustration and is not
            clickable here or on Gemini's page; a field that connects the app is worth
            more than an example of what to ask it once it is connected. */}
        {app.heroPrompt && !expanded && !extra ? (
          <div className="ca-hero-prompt-slot">
            <button className="ca-hero-prompt" type="button">
              <span>{app.heroPrompt}</span>
            </button>
          </div>
        ) : null}
      </div>

      {hasExpandedContent ? (
        <div className="ca-expanded-content">
          <div className="ca-expanded-inner">
            {/* One rule per section, as a leading separator — cards with no
                can/cannot list (Search services, Canva) would otherwise show
                two adjacent dividers above "Prompts to try". */}
            {app.can?.length ? (
              <>
                <hr className="ca-divider" />
                <CapabilityList
                  icon="check"
                  items={app.can}
                  title={`Using the ${app.name} app, Willow can:`}
                />
              </>
            ) : null}
            {app.cannot?.length ? (
              <>
                <hr className="ca-divider" />
                <CapabilityList
                  icon="close"
                  items={app.cannot}
                  title={`Using the ${app.name} app, Willow cannot:`}
                />
              </>
            ) : null}
            {app.prompts?.length ? (
              <>
                <hr className="ca-divider" />
                <span className="ca-capability-title ca-label-s">Prompts to try</span>
                <div className="ca-prompt-list">
                  {app.prompts.map((prompt) => (
                    <button className="ca-prompt-pill" key={prompt} type="button">
                      {prompt}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const ConnectedAppsTab: React.FC = () => {
  const {
    setupHints,
    githubLogin,
    notice,
    dismissNotice,
    stateFor,
    toggleConnection,
    connectGithubToken,
  } = useConnections();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleToggle = useCallback(
    (id: string, name: string) => {
      void toggleConnection(id, name);
    },
    [toggleConnection],
  );

  /*
   * Which apps went quiet, named.
   *
   * Their switches are already off — an app Willow cannot read is not connected in
   * any sense the user cares about — so without this the tab would just show a
   * switch that was on last time and is off now, with no account of why. Said once
   * at the top rather than on each card: it is one fact with one cause, the tokens
   * all expire together, and repeating it beside every switch turns a small piece
   * of housekeeping into the loudest thing on the page.
   */
  const expiredNames = APP_CATEGORIES.flatMap((category) => category.apps)
    .filter((app) => stateFor(app.id).expired)
    .map((app) => app.name);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Gemini's category chips scroll the heading to the top of the scroller;
  // they don't filter, and they never latch on as "selected".
  const scrollToCategory = useCallback((categoryId: string) => {
    categoryRefs.current[categoryId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="w-full h-full overflow-y-auto connected-apps-container gemini-chat-scrollbar">
      <div className="ca-window">
        <div className="ca-header">
          <h1 className="ca-title ca-display-s">Connected Apps</h1>
          <div className="ca-subtitle ca-body-l">
            Connect your favorite apps for smarter help.{' '}
            <a href={LEARN_MORE_URL} rel="noopener noreferrer" target="_blank">
              Learn more
            </a>
          </div>
        </div>

        <div className="ca-chip-row">
          {APP_CATEGORIES.map((category) => (
            <button
              className="ca-chip"
              key={category.id}
              onClick={() => scrollToCategory(category.id)}
              type="button"
            >
              {category.name}
            </button>
          ))}
        </div>

        {/* Said once, at the top, rather than on every disabled switch. Without
            it a page of dead toggles reads as a bug. One per provider, because
            Google and Spotify are set up independently and a user sent to fix the
            wrong environment variable goes looking for a problem that isn't there. */}
        {setupHints.map((hint) => (
          <div className="ca-banner" key={hint} role="status">
            <MaterialSymbol
              className="ca-banner-icon"
              family="google-symbols"
              name="info"
              size={20}
              weight={400}
            />
            <div className="ca-banner-text ca-body-m">{hint}</div>
          </div>
        ))}

        {expiredNames.length > 0 ? (
          <div className="ca-banner ca-banner-attention" role="status">
            <MaterialSymbol
              className="ca-banner-icon"
              family="google-symbols"
              name="link_off"
              size={20}
              weight={400}
            />
            <div className="ca-banner-text ca-body-m">
              Your session expired for {listNames(expiredNames)}, so {expiredNames.length > 1 ? 'they have' : 'it has'}{' '}
              been switched off. Turn {expiredNames.length > 1 ? 'them' : 'it'} back on to reconnect — you
              won’t have to grant permission again.
            </div>
          </div>
        ) : null}

        {notice ? (
          <div className="ca-banner" role="status">
            <MaterialSymbol
              className="ca-banner-icon"
              family="google-symbols"
              name="info"
              size={20}
              weight={400}
            />
            <div className="ca-banner-text ca-body-m">{notice}</div>
            <button className="ca-banner-dismiss" onClick={dismissNotice} type="button">
              Dismiss
            </button>
          </div>
        ) : null}

        {APP_CATEGORIES.map((category) => (
          <div key={category.id}>
            <div
              className="ca-category-header"
              ref={(node) => {
                categoryRefs.current[category.id] = node;
              }}
            >
              <div className="ca-category-name ca-title-l">{category.name}</div>
            </div>
            <div className="ca-card-grid">
              {category.apps.map((app) => {
                const props: CardProps = {
                  app,
                  expanded: expandedIds.has(app.id),
                  state: stateFor(app.id),
                  onToggle: handleToggle,
                  onToggleExpanded: toggleExpanded,
                  // The one card that needs a control of its own. Decided here rather
                  // than in the card, so the card never has to know which app it is.
                  extra:
                    app.id === 'github' ? (
                      <GithubTokenRow login={githubLogin} onConnect={connectGithubToken} />
                    ) : undefined,
                };
                return app.children?.length ? (
                  <ParentCard key={app.id} {...props} />
                ) : (
                  <AppCard key={app.id} {...props} />
                );
              })}
            </div>
          </div>
        ))}

        <div className="ca-premium">
          <MaterialSymbol
            className="ca-premium-icon"
            family="luminous"
            name="extension"
            size={24}
            weight={300}
          />
          <div>
            <h2 className="ca-premium-title ca-title-l">Your premium content</h2>
            <div className="ca-premium-description ca-body-l">
              Willow prioritizes your paid subscriptions to generate better answers for you. Here you can
              control which sources are included in the related responses.
            </div>
            <div className="ca-premium-links">
              <a href={SUBSCRIPTIONS_URL} rel="noopener noreferrer" target="_blank">
                Manage subscriptions linked to your Google Account
              </a>
            </div>
          </div>
        </div>

        <div className="ca-privacy">
          <MaterialSymbol
            className="ca-privacy-icon"
            family="google-symbols"
            name="info"
            size={24}
            weight={400}
          />
          <div className="ca-privacy-text ca-body-l">
            Learn how your data is used and what Willow shares with other apps by visiting the{' '}
            <a href={PRIVACY_HUB_URL} rel="noopener noreferrer" target="_blank">
              Willow Apps Privacy Hub
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
