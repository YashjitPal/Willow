import React from 'react';
import { useStore } from '@nanostores/react';
import { useAuth } from '@willow/auth/AuthContext';
import { experimentsStore, setExperiment, type ExperimentId } from '@willow/core/experiments-store';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';
import { LABS_DESCRIPTION, LABS_EXPERIMENTS } from '../../labs-experiments';
import './LabsPage.css';

/*
 * Labs as a standalone page, reached from the sidebar's settings menu.
 *
 * The second surface over one store, exactly like `ModelsApiPage`: the modal's
 * `tabs/LabsTab.tsx` stays where it is, Settings → Labs still opens it, and both
 * render the shared roster in `settings/labs-experiments.ts` over the shared
 * `experimentsStore`. There is no state here to keep in sync — the store is the
 * single writer, so a flag flipped on this page is already flipped on the tab
 * behind it, even though `SettingsModal` stays mounted once opened.
 *
 * What differs from the tab is only the drawing: a #0f0f0f page, one centred
 * column and #1e1f20 cards, in the language of the other full-page settings
 * rather than a dialog's content pane.
 */

/**
 * The MDC slide toggle, tinted by the workspace colour.
 *
 * Geometry is `PersonalIntelligenceTab`'s Memory switch reproduced in
 * `LabsPage.css`, so a toggle is the same object on every settings surface.
 *
 * `onChange` absent means the row has no flag behind it — the button is disabled
 * and draws whatever state it was given. That is how the two unwired rows in the
 * roster render as controls without pretending to be ones.
 */
const LabsSwitch: React.FC<{
  checked: boolean;
  label: string;
  onChange?: (next: boolean) => void;
}> = ({ checked, label, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={!onChange}
    title={onChange ? undefined : 'Not available yet'}
    onClick={onChange ? () => onChange(!checked) : undefined}
    className={`lp-switch${checked ? ' lp-switch-checked' : ''}`}
  >
    <span aria-hidden="true" className="lp-switch-track" />
    <span aria-hidden="true" className="lp-switch-handle">
      <svg viewBox="0 0 24 24" className="lp-switch-icon">
        <path d="M19.69,5.23L8.96,15.96l-4.23-4.23L2.96,13.5l6,6L21.46,7L19.69,5.23z" />
      </svg>
    </span>
  </button>
);

export const LabsPage: React.FC = () => {
  const experiments = useStore(experimentsStore);
  /*
   * Accents follow the workspace colour, like the rest of the app and like the
   * Models & API page beside it: the pastel `creamy` tone fills a switched-on
   * track, and the deeper `sendButton` tone is the handle riding on it. Handed to
   * the CSS as variables, which is how the notebooks pages do it.
   */
  const { userProfile } = useAuth();
  const theme = getWorkspaceTheme(userProfile?.workspaceColor);

  return (
    <div
      className="labs-page-container gemini-chat-scrollbar"
      style={{
        '--lp-switch-on-track': theme.creamy.hex,
        '--lp-switch-on-handle': theme.sendButton.bg,
      } as React.CSSProperties}
    >
      <div className="lp-page-content">
        <div className="lp-page-header">
          <div>
            <h1 className="lp-display-s">Labs</h1>
          </div>
        </div>

        <div className="lp-page-description lp-body-l">{LABS_DESCRIPTION}</div>

        <div className="lp-section">
          <div className="lp-section-heading">
            <h2 className="lp-title-l">Experimental features</h2>
          </div>

          <div className="lp-row-list">
            {LABS_EXPERIMENTS.map((row) => {
              const enabled = row.id ? experiments[row.id] : !!row.staticEnabled;
              return (
                <div key={row.id ?? row.title} className="lp-row">
                  <div className="lp-row-text">
                    <h3 className="lp-title-m">{row.title}</h3>
                    <div className="lp-row-description lp-body-m">{row.description}</div>
                  </div>
                  <div className="lp-row-control">
                    <LabsSwitch
                      checked={enabled}
                      label={row.title}
                      onChange={
                        row.id
                          ? (next) => setExperiment(row.id as ExperimentId, next)
                          : undefined
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="lp-section-note lp-body-m">
            Turning a surface off hides its sidebar entry and stops its code from loading at all.
          </div>
        </div>
      </div>
    </div>
  );
};
