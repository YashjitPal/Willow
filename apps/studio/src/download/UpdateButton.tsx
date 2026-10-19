import React from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { usePressRipple } from './use-press-ripple';
import './get-app.css';

export interface UpdateButtonProps {
  version?: string;
  onClick: () => void;
}

/**
 * Top bar's tonal "Update" pill, appearing in the exact position and manner as "Get app"
 * when a newer release of Willow is available.
 */
export const DesktopUpdateButton: React.FC<UpdateButtonProps> = ({ version, onClick }) => {
  const ripple = usePressRipple('gm-get-app-ripple');
  return (
    <button
      type="button"
      className="gm-get-app gm-update-btn"
      onClick={onClick}
      title={version ? `Willow ${version} is available — click to download update` : 'Update available'}
      aria-label={version ? `Update Willow to ${version}` : 'Update Willow'}
      {...ripple.handlers}
    >
      <span ref={ripple.ripplesRef} className="gm-get-app-ripples" aria-hidden="true" />
      <span className="gm-get-app-content">
        <MaterialSymbol name="update" family="google-symbols" size={20} weight={400} />
        <span className="gm-get-app-label">Update</span>
      </span>
    </button>
  );
};

/**
 * Phone counterpart for the top-bar Update button: compact pill / icon button below 960px.
 */
export const PhoneUpdateButton: React.FC<UpdateButtonProps> = ({ version, onClick }) => {
  const pillRipple = usePressRipple('gm-get-app-ripple gm-get-app-ripple--pill');
  const iconRipple = usePressRipple('gm-get-app-ripple gm-get-app-ripple--icon', true);
  return (
    <div className="gm-phone-get-app">
      <button
        type="button"
        className="gm-phone-get-app-pill"
        onClick={onClick}
        title={version ? `Willow ${version} is available` : 'Update available'}
        {...pillRipple.handlers}
      >
        <span ref={pillRipple.ripplesRef} className="gm-get-app-ripples" aria-hidden="true" />
        <MaterialSymbol name="update" family="google-symbols" size={18} weight={400} className="gm-phone-get-app-pill-icon" />
        <span className="gm-phone-get-app-label gm-phone-get-app-label--long">Update</span>
        <span className="gm-phone-get-app-label gm-phone-get-app-label--medium">Update</span>
      </button>
      <button
        type="button"
        className="gm-phone-get-app-icon"
        aria-label={version ? `Update Willow to ${version}` : 'Update Willow'}
        onClick={onClick}
        {...iconRipple.handlers}
      >
        <span ref={iconRipple.ripplesRef} className="gm-get-app-ripples" aria-hidden="true" />
        <MaterialSymbol name="update" family="google-symbols" size={24} weight={400} className="gm-phone-get-app-glyph" />
      </button>
    </div>
  );
};
