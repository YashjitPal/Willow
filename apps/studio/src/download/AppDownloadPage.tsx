import React, { useId, useMemo } from 'react';
import { useThemeMode } from '@willow/core/theme-mode';
import { useCompactViewport } from '@willow/chat/use-compact-viewport';
import desktopDark from '@willow/assets/app-download/desktop-dark.webp';
import desktopLight from '@willow/assets/app-download/desktop-light.webp';
import phoneDark from '@willow/assets/app-download/phone-dark.webp';
import phoneLight from '@willow/assets/app-download/phone-light.webp';
import {
  ANDROID_DOWNLOAD_PATH,
  DOWNLOAD_COPY,
  androidDownloadUrl,
  currentAgent,
  desktopOffer,
  desktopPlatformOf,
  showsDesktopRow,
} from './app-download';
import { qrModulesFor, styledQr } from './styled-qr';
import { usePressRipple } from './use-press-ripple';
import './app-download.css';

const DownloadQr: React.FC<{ value: string }> = ({ value }) => {
  const clipId = useId();
  const qr = useMemo(() => styledQr(qrModulesFor(value)), [value]);
  return (
    <svg className="gm-download-qr-image" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={DOWNLOAD_COPY.qrAlt}>
      <defs>
        <clipPath id={clipId}>
          <path d={qr.dots} />
        </clipPath>
      </defs>
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      <rect width={qr.size} height={qr.size} fill="#000000" clipPath={`url(#${clipId})`} />
      <path d={qr.finders} fill="#000000" fillRule="evenodd" />
    </svg>
  );
};

/**
 * Gemini's `/app/download` (`app-download-page`): a row for this computer's app and one for the
 * phone's, two side by side above 960px, the phone's alone below it with a button for the QR code.
 * Gemini's rows neither animate in nor out; the page swaps in with the route.
 */
export const AppDownloadPage: React.FC = () => {
  const { isLight } = useThemeMode();
  const compact = useCompactViewport();
  const platform = useMemo(() => desktopPlatformOf(currentAgent()), []);
  const offer = desktopOffer(platform);
  const desktopRipple = usePressRipple('gm-download-ripple gm-download-ripple--tonal');
  const mobileRipple = usePressRipple('gm-download-ripple gm-download-ripple--accent');
  const qrValue = typeof window === 'undefined' ? ANDROID_DOWNLOAD_PATH : androidDownloadUrl(window.location.origin);

  return (
    <div className={`gm-download${compact ? ' gm-download--compact' : ''}`}>
      <div className="gm-download-page">
        <main className="gm-download-content">
          {!compact && showsDesktopRow(platform) && (
            <section className="gm-download-row gm-download-row--desktop">
              <div className="gm-download-info">
                <h1 className="gm-download-title">{offer.title}</h1>
                <p className="gm-download-text">{DOWNLOAD_COPY.desktopText}</p>
                <a className="gm-download-cta" href={offer.href} target="_blank" rel="noopener" {...desktopRipple.handlers}>
                  <span ref={desktopRipple.ripplesRef} className="gm-download-ripples" aria-hidden="true" />
                  <span className="gm-download-cta-label">{offer.cta}</span>
                </a>
              </div>
              <div className="gm-download-mockup gm-download-mockup--desktop">
                <img className="gm-download-mockup-image" src={isLight ? desktopLight : desktopDark} alt={DOWNLOAD_COPY.desktopAlt} />
              </div>
            </section>
          )}
          <section className="gm-download-row gm-download-row--phone">
            <div className="gm-download-info">
              <h1 className="gm-download-title">{DOWNLOAD_COPY.phoneTitle}</h1>
              <p className="gm-download-text">{DOWNLOAD_COPY.phoneText}</p>
              {compact ? (
                <a className="gm-download-mobile-cta" href={ANDROID_DOWNLOAD_PATH} target="_blank" rel="noopener" {...mobileRipple.handlers}>
                  <span ref={mobileRipple.ripplesRef} className="gm-download-ripples" aria-hidden="true" />
                  <span className="gm-download-cta-label">{DOWNLOAD_COPY.phoneCta}</span>
                </a>
              ) : (
                <div className="gm-download-qr">
                  <DownloadQr value={qrValue} />
                  <span className="gm-download-qr-label">{DOWNLOAD_COPY.phoneCta}</span>
                </div>
              )}
            </div>
            <div className="gm-download-mockup gm-download-mockup--phone">
              <img className="gm-download-mockup-image" src={isLight ? phoneLight : phoneDark} alt={DOWNLOAD_COPY.phoneAlt} />
            </div>
          </section>
        </main>
        {/* Gemini's footer is its empty disclaimer: a line's worth of space under the rows. */}
        <footer className="gm-download-footer" aria-hidden="true" />
      </div>
    </div>
  );
};

export default AppDownloadPage;
