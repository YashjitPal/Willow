/**
 * Settings > Willow Spark settings.
 *
 * A clone of Gemini's `/gemini-spark` route: three cards, each pairing an explanation with
 * one destructive action — turn Spark off, clear the remote browser's data, clear the
 * remote code-execution data. Transcribed from the live page; captures and the scrapers
 * that produced them are in `tools/ui-research/captures/settings/spark-settings/`.
 *
 * **This is UI only, and deliberately inert.** Every button on this surface destroys
 * something, so none of them are wired: `onAction` is where a confirmation flow would go.
 * The cards were captured read-only for exactly that reason — a scraper that clicked one of
 * Gemini's equivalents would have deleted real data.
 */
import React from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import './SparkSettingsTab.css';

type CardIcon = {
  name: string;
  family: 'luminous' | 'google-symbols';
};

type SettingsCard = {
  id: string;
  icon: CardIcon;
  title: string;
  /** Split so the trailing link can be rendered as its own node. */
  body: string;
  linkText: string;
  /** Gemini's first card has a bare label; the two delete cards carry a trash glyph. */
  action: { label: string; icon?: CardIcon };
};

/*
 * Icon families are per-glyph and not guessable: `power_settings_new` and `monitor` come
 * from Google Symbols while `code` and `delete` come from Luminous. That is what Gemini
 * requests (`data-mat-icon-namespace`), and `features/spark/AGENTS.md` records the same
 * split for `monitor`, which Luminous does not carry at all.
 */
const CARDS: SettingsCard[] = [
  {
    id: 'disable-agent',
    icon: { name: 'power_settings_new', family: 'google-symbols' },
    title: 'Turn off Willow Spark',
    body:
      'Turning off Willow Spark deletes your browsing data and remote code execution files, ' +
      'and stops your schedules.',
    linkText: 'Learn more about how to manage this setting.',
    action: { label: 'Turn off' },
  },
  {
    id: 'browser-data',
    icon: { name: 'monitor', family: 'google-symbols' },
    title: 'Delete remote browser data',
    body:
      'Delete the browsing data Willow uses to complete tasks for you. This clears your ' +
      'cookies and signs you out of websites.',
    linkText: 'Learn more.',
    action: { label: 'Delete', icon: { name: 'delete', family: 'luminous' } },
  },
  {
    id: 'remote-computer-data',
    icon: { name: 'code', family: 'luminous' },
    title: 'Delete remote code execution data',
    body:
      'Delete the saved files and other data Willow uses to run code for you through your ' +
      'remote computer.',
    linkText: 'Learn more.',
    action: { label: 'Delete', icon: { name: 'delete', family: 'luminous' } },
  },
];

export const SparkSettingsTab: React.FC = () => (
  <div className="spark-settings">
    <div className="spark-settings__container">
      <div className="spark-settings__header">
        <h2 className="spark-settings__title">Willow Spark Settings</h2>
      </div>

      <div className="spark-settings__options">
        {CARDS.map((card) => (
          <div className={`spark-settings__card spark-settings__card--${card.id}`} key={card.id}>
            <MaterialSymbol
              name={card.icon.name}
              family={card.icon.family}
              size={28}
              weight={260}
              roundness={100}
              opticalSize={28}
            />

            <div className="spark-settings__section-title">{card.title}</div>

            <div className="spark-settings__section-description">
              <span>
                {card.body}{' '}
                <button type="button" className="spark-settings__link">
                  {card.linkText}
                  <span className="spark-settings__sr-only">Opens in a new window</span>
                </button>
              </span>
            </div>

            <div className="spark-settings__card-actions">
              <button
                type="button"
                className={`spark-settings__button${card.action.icon ? ' spark-settings__button--with-icon' : ''}`}
              >
                {card.action.icon && (
                  <MaterialSymbol
                    name={card.action.icon.name}
                    family={card.action.icon.family}
                    size={24}
                    weight={300}
                    roundness={100}
                    opticalSize={24}
                  />
                )}
                <span>{card.action.label}</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default SparkSettingsTab;
