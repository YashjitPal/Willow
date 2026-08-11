import React, { useCallback, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  APP_CATEGORIES,
  DEFAULT_CONNECTIONS,
  LEARN_MORE_URL,
  PRIVACY_HUB_URL,
  SUBSCRIPTIONS_URL,
  type ChildApp,
  type ConnectedApp,
} from './connectedAppsData';
import './ConnectedAppsTab.css';

/**
 * Connected Apps — a clone of gemini.google.com/apps.
 *
 * UI only: toggles and "Learn more" drive local state, prompts are inert. The
 * geometry, colours and animation timings were measured off the live Gemini
 * page; see connectedAppsData.ts for where the copy came from.
 */

interface SwitchProps {
  checked: boolean;
  label: string;
  onChange: () => void;
}

/** Gemini's opt-in toggle. No check/cross glyphs — it doesn't render them here. */
const Switch: React.FC<SwitchProps> = ({ checked, label, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className="ca-switch"
    onClick={onChange}
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
  connected: boolean;
  expanded: boolean;
  onToggle: (id: string) => void;
  onToggleExpanded: (id: string) => void;
}

/** The Workspace card: full grid width, description beside a grid of child apps. */
const ParentCard: React.FC<CardProps> = ({ app, connected, onToggle }) => (
  <div className="ca-parent-card">
    <div className="ca-opt-in-row">
      <img alt="" aria-hidden="true" className="ca-logo" src={app.logo} />
      <div className="ca-toggle-slot">
        <Switch
          checked={connected}
          label={`Enables or disables the extension of ${app.name}`}
          onChange={() => onToggle(app.id)}
        />
      </div>
    </div>
    <div className="ca-parent-content">
      <div className="ca-parent-title">
        <div className="ca-card-name ca-title-l">{app.name}</div>
        <div className="ca-parent-description ca-body-m">{app.description}</div>
      </div>
      <div className="ca-child-grid">
        {app.children?.map((child) => (
          <ChildCard app={child} key={child.id} />
        ))}
      </div>
    </div>
  </div>
);

const AppCard: React.FC<CardProps> = ({ app, connected, expanded, onToggle, onToggleExpanded }) => {
  const hasExpandedContent = Boolean(app.can?.length || app.cannot?.length || app.prompts?.length);

  return (
    <div className={`ca-card${expanded ? ' ca-expanded' : ''}`}>
      <div className="ca-opt-in-row">
        <img alt="" aria-hidden="true" className="ca-logo" src={app.logo} />
        <div className="ca-toggle-slot">
          <Switch
            checked={connected}
            label="Enables or disables the extension"
            onChange={() => onToggle(app.id)}
          />
        </div>
      </div>

      <div>
        <div className="ca-card-name ca-title-l">{app.name}</div>
        {app.handle ? <div className="ca-handle ca-label-s">{app.handle}</div> : null}
      </div>

      <div className="ca-collapsed-content">
        <div className="ca-description ca-body-m">{app.description}</div>
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
        {app.heroPrompt && !expanded ? (
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
  const [connections, setConnections] = useState<Record<string, boolean>>(DEFAULT_CONNECTIONS);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const toggleConnection = useCallback((id: string) => {
    setConnections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

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
                  connected: Boolean(connections[app.id]),
                  expanded: expandedIds.has(app.id),
                  onToggle: toggleConnection,
                  onToggleExpanded: toggleExpanded,
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
