import React, { useState, useRef, useEffect, useMemo } from 'react';
import './UsageLimitsView.css';

interface UsageLimitsViewProps {
  onBack?: () => void;
}

const InfoIcon: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    height={size}
    width={size}
    viewBox="0 -960 960 960"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z" />
  </svg>
);

export const UsageLimitsView: React.FC<UsageLimitsViewProps> = () => {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const infoButtonRef = useRef<HTMLButtonElement>(null);

  // Compute dynamic reset times to match authentic Gemini behavior
  const { currentResetLabel, weeklyResetLabel } = useMemo(() => {
    const now = new Date();
    
    // 5-hour window reset
    const fiveHoursLater = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const timeOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
    const formattedCurrent = fiveHoursLater.toLocaleTimeString('en-US', timeOptions);

    // Weekly window reset
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const month = nextWeek.toLocaleString('en-US', { month: 'short' });
    const day = nextWeek.getDate();
    const formattedWeekly = `Resets ${month} ${day} at ${formattedCurrent}`;

    return {
      currentResetLabel: `Resets at ${formattedCurrent}`,
      weeklyResetLabel: formattedWeekly,
    };
  }, []);

  // Handle open/close for popover
  const openPopover = () => setIsInfoOpen(true);
  const closePopover = () => setIsInfoOpen(false);
  const togglePopover = () => setIsInfoOpen((prev) => !prev);

  // Click outside and Escape listener
  useEffect(() => {
    if (!isInfoOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        infoButtonRef.current &&
        !infoButtonRef.current.contains(target)
      ) {
        closePopover();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePopover();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isInfoOpen]);

  return (
    <div className="usage-limits-root">
      <div className="usage-limits-container">
        {/* Header */}
        <header className="usage-header">
          <div className="usage-header-top">
            <h1 className="usage-h1">Usage limits</h1>
            <span className="usage-pro-badge">
              <span className="usage-pro-badge-text">PRO</span>
            </span>
          </div>
          <div className="usage-header-meta">
            <p className="usage-description">
              Your plan's limits determine how much you can use Gemini over time. Advanced models and features can take up more usage.{' '}
              <a
                className="usage-link"
                href="https://support.google.com/gemini?p=plan_updates"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Learn more about Gemini plan usage limits"
              >
                Learn more
              </a>
            </p>
            <p className="usage-updated" data-testid="usage-updated">
              Updated 1 min ago
            </p>
          </div>
        </header>

        {/* Usage Windows Region */}
        <section className="usage-windows-region" aria-label="Usage windows">
          {/* Card 1: Current usage */}
          <div className="usage-current-card" data-testid="current-usage">
            <div className="usage-card-top-row">
              <div className="usage-current-title-group">
                <strong className="usage-current-title">Current usage</strong>
                <button
                  ref={infoButtonRef}
                  type="button"
                  className="usage-info-button"
                  aria-label="Information about usage limits"
                  aria-haspopup="dialog"
                  aria-expanded={isInfoOpen}
                  onClick={togglePopover}
                >
                  <InfoIcon size={20} />
                </button>

                {/* Popover dialog anchored to Info button */}
                {isInfoOpen && (
                  <div
                    ref={popoverRef}
                    role="dialog"
                    aria-label="How limits work"
                    className="usage-popover"
                  >
                    <strong className="usage-popover-subtitle">How limits work</strong>
                    <div className="usage-popover-sections">
                      <div className="usage-popover-section">
                        <strong className="usage-popover-subtitle">Current usage</strong>
                        <span className="usage-popover-text">Your usage over a 5-hour window.</span>
                      </div>
                      <div className="usage-popover-section">
                        <strong className="usage-popover-subtitle">Weekly limit</strong>
                        <span className="usage-popover-text">Your total usage for the week.</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <strong className="usage-current-pct">1% used</strong>
            </div>

            {/* Progress track */}
            <div className="usage-progress-container">
              <div className="usage-progress-track">
                <span className="usage-progress-fill" style={{ width: '1%' }} />
              </div>
            </div>

            <span className="usage-reset-label">{currentResetLabel}</span>
          </div>

          {/* Card 2: Weekly limit */}
          <div className="usage-weekly-card" data-testid="weekly-usage">
            <span className="usage-weekly-info">
              <strong className="usage-weekly-title">Weekly limit</strong>
              <span className="usage-weekly-reset">{weeklyResetLabel}</span>
            </span>
            <strong className="usage-weekly-pct">3% used</strong>
          </div>
        </section>
      </div>
    </div>
  );
};

export default UsageLimitsView;
