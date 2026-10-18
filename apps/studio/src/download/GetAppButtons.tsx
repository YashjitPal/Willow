import React from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { ANDROID_DOWNLOAD_PATH } from './app-download';
import { usePressRipple } from './use-press-ripple';
import './get-app.css';

/**
 * Gemini's `desktop-get-app-button`: the top bar's tonal "Get app" pill on a new chat, which opens
 * `/app/download`. The ripple grows from the press, as on Gemini's text buttons.
 */
export const DesktopGetAppButton: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const ripple = usePressRipple('gm-get-app-ripple');
  return (
    <button type="button" className="gm-get-app" onClick={onOpen} {...ripple.handlers}>
      <span ref={ripple.ripplesRef} className="gm-get-app-ripples" aria-hidden="true" />
      <span className="gm-get-app-content">
        <MaterialSymbol name="download" family="luminous" size={24} weight={300} roundness={100} opticalSize={24} />
        <span className="gm-get-app-label">Get app</span>
      </span>
    </button>
  );
};

const openAndroidApp = () => {
  window.open(ANDROID_DOWNLOAD_PATH, '_blank', 'noopener');
};

/**
 * Gemini's `get-app-button`, on a phone's new chat: "Try the app" as an icon below 480px, a pill
 * reading "App" to 600px and "Try app" beyond. Gemini's opens its app in a new tab; Willow's
 * downloads Willow's Android app.
 */
export const PhoneGetAppButton: React.FC = () => {
  const pillRipple = usePressRipple('gm-get-app-ripple gm-get-app-ripple--pill');
  const iconRipple = usePressRipple('gm-get-app-ripple gm-get-app-ripple--icon', true);
  return (
    <div className="gm-phone-get-app">
      <button type="button" className="gm-phone-get-app-pill" onClick={openAndroidApp} {...pillRipple.handlers}>
        <span ref={pillRipple.ripplesRef} className="gm-get-app-ripples" aria-hidden="true" />
        <MaterialSymbol name="install_mobile" family="google-symbols" size={18} weight={400} className="gm-phone-get-app-pill-icon" />
        <span className="gm-phone-get-app-label gm-phone-get-app-label--long">Try app</span>
        <span className="gm-phone-get-app-label gm-phone-get-app-label--medium">App</span>
      </button>
      <button type="button" className="gm-phone-get-app-icon" aria-label="Try the app" onClick={openAndroidApp} {...iconRipple.handlers}>
        <span ref={iconRipple.ripplesRef} className="gm-get-app-ripples" aria-hidden="true" />
        <MaterialSymbol name="install_mobile" family="google-symbols" size={24} weight={400} className="gm-phone-get-app-glyph" />
      </button>
    </div>
  );
};
