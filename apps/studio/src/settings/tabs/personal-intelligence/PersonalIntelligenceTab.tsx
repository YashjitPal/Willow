import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './PersonalIntelligenceTab.css';

export const PersonalIntelligenceTab: React.FC = () => {
  const navigate = useNavigate();
  const [isMemoryEnabled, setIsMemoryEnabled] = useState(true);

  return (
    <div className="w-full h-full overflow-y-auto bg-[#0f0f0f] personal-intelligence-container">
      {/* HTML structures match Willow precisely using standard tags with the exact classes */}
      <div className="page-content">
        <div>
          <h1 className="gds-display-s page-headline"> Personal Intelligence </h1>
          <div className="gds-body-l page-description">
            Get more helpful responses and recommendations based on info about you and your world
          </div>
        </div>

        {/* Memory Section */}
        <div className="section">
          <div className="header">
            <div className="gem-icon" data-fonticonname="search_activity">
              <span
                role="img"
                className="mat-icon notranslate lm-icon-xl lumi-symbols mat-ligature-font mat-icon-no-color"
                aria-hidden="true"
                data-mat-icon-type="font"
                data-mat-icon-name="search_activity"
                data-mat-icon-namespace="lumi-symbols"
                data-fonticon="search_activity"
              >
                search_activity
              </span>
            </div>
            <div className="space-filler"></div>
            <div className="toggle-container">
              <div
                className={`mat-mdc-slide-toggle mat-accent ${
                  isMemoryEnabled ? 'mat-mdc-slide-toggle-checked' : ''
                }`}
                id="mat-mdc-slide-toggle-0"
              >
                <div className="mdc-form-field mat-internal-form-field">
                  <button
                    role="switch"
                    type="button"
                    className={`mdc-switch ${
                      isMemoryEnabled ? 'mdc-switch--selected mdc-switch--checked' : ''
                    }`}
                    tabIndex={0}
                    id="mat-mdc-slide-toggle-0-button"
                    aria-label="Enables or disables the use of personal Willow context"
                    aria-checked={isMemoryEnabled}
                    onClick={() => setIsMemoryEnabled(!isMemoryEnabled)}
                  >
                    <div className="mat-mdc-slide-toggle-touch-target"></div>
                    <span className="mdc-switch__track"></span>
                    <span className="mdc-switch__handle-track">
                      <span className="mdc-switch__handle">
                        <span className="mdc-switch__shadow">
                          <span className="mdc-elevation-overlay"></span>
                        </span>
                        <span className="mdc-switch__ripple">
                          <span className="mat-ripple mat-mdc-slide-toggle-ripple mat-focus-indicator"></span>
                        </span>
                        <span className="mdc-switch__icons">
                          <svg viewBox="0 0 24 24" aria-hidden="true" className="mdc-switch__icon mdc-switch__icon--on">
                            <path d="M19.69,5.23L8.96,15.96l-4.23-4.23L2.96,13.5l6,6L21.46,7L19.69,5.23z"></path>
                          </svg>
                          <svg viewBox="0 0 24 24" aria-hidden="true" className="mdc-switch__icon mdc-switch__icon--off">
                            <path d="M20 13H4v-2h16v2z"></path>
                          </svg>
                        </span>
                      </span>
                    </span>
                  </button>
                  <label
                    className="mdc-label"
                    htmlFor="mat-mdc-slide-toggle-0-button"
                    id="mat-mdc-slide-toggle-0-label"
                  ></label>
                </div>
              </div>
            </div>
          </div>
          <div className="title-container">
            <h2 className="gds-title-l"> Memory </h2>
          </div>
          <div className="description gds-body-l">
            <span> Willow learns from your past chats to understand more about you. Coming soon to Live. </span>
            <div className="links gds-label-m">
              <a href="https://support.google.com/gemini?p=man_del" target="_blank" rel="noopener noreferrer">
                Manage and delete
              </a>{' '}
              your past chats anytime.{' '}
              <a href="https://support.google.com/gemini?p=personalization" target="_blank" rel="noopener noreferrer">
                Learn more
              </a>
            </div>
          </div>
        </div>

        {/* Connected Apps Section */}
        <div className="section">
          <div className="header">
            <div className="gem-icon" data-fonticonname="extension">
              <span
                role="img"
                className="mat-icon notranslate lm-icon-xl lumi-symbols mat-ligature-font mat-icon-no-color"
                aria-hidden="true"
                data-mat-icon-type="font"
                data-mat-icon-name="extension"
                data-mat-icon-namespace="lumi-symbols"
                data-fonticon="extension"
              >
                extension
              </span>
            </div>
            <div className="space-filler"></div>
            <div className="link-icon-container">
              <div className="gem-icon" data-fonticonname="chevron_right">
                <span
                  role="img"
                  className="mat-icon notranslate lm-icon-xl lumi-symbols mat-ligature-font mat-icon-no-color"
                  aria-hidden="true"
                  data-mat-icon-type="font"
                  data-mat-icon-name="chevron_right"
                  data-mat-icon-namespace="lumi-symbols"
                  data-fonticon="chevron_right"
                >
                  chevron_right
                </span>
              </div>
            </div>
          </div>
          <div className="title-container">
            <h2 className="gds-title-l">Connected Apps</h2>
          </div>
          <div className="description gds-body-l">
            <span>
              You can choose to have Willow use insights about you from some Connected Apps to personalize your
              experience and help you get more done
            </span>
          </div>
          <a
            aria-label="Go to Connected Apps section"
            className="section-link-overlay"
            href="https://gemini.google.com/apps"
            target="_blank"
            rel="noopener noreferrer"
          ></a>
        </div>

        {/* Instructions for Willow Section */}
        <div className="section">
          <div className="header">
            <div className="gem-icon" data-fonticonname="assignment">
              <span
                role="img"
                className="mat-icon notranslate lm-icon-xl lumi-symbols mat-ligature-font mat-icon-no-color"
                aria-hidden="true"
                data-mat-icon-type="font"
                data-mat-icon-name="assignment"
                data-mat-icon-namespace="lumi-symbols"
                data-fonticon="assignment"
              >
                assignment
              </span>
            </div>
            <div className="space-filler"></div>
            <div className="link-icon-container">
              <div className="gem-icon" data-fonticonname="chevron_right">
                <span
                  role="img"
                  className="mat-icon notranslate lm-icon-xl lumi-symbols mat-ligature-font mat-icon-no-color"
                  aria-hidden="true"
                  data-mat-icon-type="font"
                  data-mat-icon-name="chevron_right"
                  data-mat-icon-namespace="lumi-symbols"
                  data-fonticon="chevron_right"
                >
                  chevron_right
                </span>
              </div>
            </div>
          </div>
          <div className="title-container">
            <h2 className="gds-title-l"> Instructions for Willow </h2>
          </div>
          <div className="description gds-body-l">
            <span>Customize Willow’s responses, like “Use bullet points for long paragraphs”</span>
          </div>
          <a
            aria-label="Go to Instructions for Willow section"
            className="section-link-overlay cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              navigate('/saved-info');
            }}
          ></a>
        </div>
      </div>
    </div>
  );
};
