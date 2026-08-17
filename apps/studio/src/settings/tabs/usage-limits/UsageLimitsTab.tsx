/**
 * Settings > Usage limits.
 *
 * A clone of Gemini's `/usage` route: a plan badge, an explanation, and two grouped cards —
 * a current-usage meter with a reset time, and a weekly limit. Transcribed from the live
 * page; captures are in `tools/ui-research/captures/settings/usage-limits/`.
 *
 * **This is UI only.** Willow tracks no quota, so the percentages below are placeholder
 * display values held in one place (`USAGE`) rather than scattered through the markup —
 * wiring this up later means replacing that object, not rewriting the component. The reset
 * times *are* computed from the clock, so the page never shows a stale timestamp.
 */
import React, { useMemo } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import './UsageLimitsTab.css';

/** Placeholder figures, matching the shape Gemini renders. Replace when quota is tracked. */
const USAGE = {
  tier: 'PRO',
  currentPercent: 1,
  weeklyPercent: 3,
  /** Gemini's current-usage window is rolling; its weekly one lands a week out. */
  currentResetInHours: 5,
  weeklyResetInDays: 7,
};

const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export const UsageLimitsTab: React.FC = () => {
  const { currentReset, weeklyReset } = useMemo(() => {
    const now = Date.now();
    const current = new Date(now + USAGE.currentResetInHours * 3600_000);
    const weekly = new Date(now + USAGE.weeklyResetInDays * 86_400_000);
    return {
      currentReset: timeFormatter.format(current),
      weeklyReset: `${dateFormatter.format(weekly)} at ${timeFormatter.format(weekly)}`,
    };
  }, []);

  return (
    <div className="usage-limits">
      <div className="usage-limits__container">
        <div className="usage-limits__header">
          <div className="usage-limits__header-title">
            <h2 className="usage-limits__title">Usage limits</h2>
            <span className="usage-limits__pill">{USAGE.tier}</span>
          </div>

          <div className="usage-limits__description">
            <p>
              Your plan&apos;s limits determine how much you can use Willow over time. Advanced
              models and features can take up more usage.{' '}
              <button type="button" className="usage-limits__link">
                Learn more
              </button>
            </p>
            <p>Updated just now</p>
          </div>
        </div>

        <div className="usage-limits__items">
          <div className="usage-limits__current">
            <div className="usage-limits__item-header">
              <div className="usage-limits__current-usage">
                <p className="usage-limits__emphasized-l">Current usage</p>
                <button
                  type="button"
                  className="usage-limits__info-button"
                  aria-label="Information about usage limits"
                  aria-haspopup="dialog"
                >
                  <MaterialSymbol
                    name="info"
                    family="luminous"
                    size={20}
                    weight={320}
                    roundness={100}
                    opticalSize={20}
                  />
                </button>
              </div>
              <p className="usage-limits__emphasized-l">{USAGE.currentPercent}% used</p>
            </div>

            <div className="usage-limits__track">
              <div
                className="usage-limits__indicator"
                style={{ width: `${USAGE.currentPercent}%` }}
              />
            </div>

            <p className="usage-limits__emphasized-m usage-limits__reset-time">
              Resets at {currentReset}
            </p>
          </div>

          <div className="usage-limits__weekly">
            <div>
              <p className="usage-limits__emphasized-m">Weekly limit</p>
              <p className="usage-limits__emphasized-s usage-limits__reset-time">
                Resets {weeklyReset}
              </p>
            </div>
            <p className="usage-limits__emphasized-m">{USAGE.weeklyPercent}% used</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UsageLimitsTab;
